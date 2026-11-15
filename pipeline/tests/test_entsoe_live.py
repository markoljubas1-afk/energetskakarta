from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from energymap import cli, publish
from energymap.entsoe import live
from energymap.entsoe.client import AREAS, EntsoeClient, EntsoeError, NoData, RateLimiter
from energymap.entsoe.energy import TIMEZONE
from energymap.entsoe.parse import Interval, Series
from entsoe_xml import document, period, series

NOW = datetime(2026, 9, 16, 10, tzinfo=UTC)  # 12:00 in Zagreb
START, END = live.window(NOW)
CODE = {v: k for k, v in AREAS.items()}


def hourly_series(start: datetime, values: list[float], step: timedelta = timedelta(hours=1)) -> Series:
    intervals = tuple(Interval(start + i * step, start + (i + 1) * step, v) for i, v in enumerate(values))
    return Series(None, False, intervals)


class FakeLive:
    """HR exports 300 MW to SI and imports 100 MW back; BA-ME has no data; BA and ME have no market."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []

    def flows(self, sender: str, receiver: str, start: datetime, end: datetime) -> list[Series]:
        pair = (CODE[sender], CODE[receiver])
        self.calls.append(("flow", *pair))
        hours = int((end - start).total_seconds() // 3600)
        if set(pair) == {"BA", "ME"}:
            raise NoData("no flows")
        if pair == ("HR", "SI"):
            return [hourly_series(start, [300.0] * hours)]
        if pair == ("SI", "HR"):
            values = [100.0] * hours
            # 15-minute data with one missing quarter in the second hour
            quarters = hourly_series(start, [100.0] * 4 + [100.0] * 3, timedelta(minutes=15))
            rest = hourly_series(start + timedelta(hours=2), values[2:])
            return [quarters, rest]
        return [hourly_series(start, [50.0] * hours)]

    def generation(self, area: str, start: datetime, end: datetime) -> list[Series]:
        """HR: hydro 800 + wind 200 MW, reported for the first 30 hours; ME has nothing."""
        self.calls.append(("generation", CODE[area], ""))
        if CODE[area] == "ME":
            raise NoData("no generation")
        hydro = Series("B12", False, hourly_series(start, [800.0] * 30).intervals)
        wind = Series("B19", False, hourly_series(start, [200.0] * 30).intervals)
        pumping = Series("B10", True, hourly_series(start, [999.0] * 30).intervals)
        return [hydro, wind, pumping]

    def prices(self, zone: str, start: datetime, end: datetime) -> list[Series]:
        self.calls.append(("price", zone, ""))
        if zone in (AREAS["BA"], AREAS["ME"]):
            raise NoData("no market")
        hours = int((end - start).total_seconds() // 3600)
        quarters = [80.0, 90.0, 100.0, 110.0] * hours
        auction = Series(
            None, False, hourly_series(start, quarters, timedelta(minutes=15)).intervals, sequence=1
        )
        other = Series(None, False, hourly_series(start, [999.0] * hours).intervals, sequence=2)
        return [other, auction]


def test_window_covers_yesterday_to_tomorrow() -> None:
    assert datetime(2026, 9, 15, tzinfo=TIMEZONE) == START
    assert datetime(2026, 9, 18, tzinfo=TIMEZONE) == END
    assert len(live.local_hours(START, END)) == 72


def test_clock_change_days_have_the_right_number_of_hours() -> None:
    autumn = datetime(2026, 10, 25, 12, tzinfo=UTC)  # a 25-hour day in the middle of the window
    start, end = live.window(autumn)
    assert len(live.local_hours(start, end)) == 73


def test_collect_nets_flows_and_averages_prices() -> None:
    doc = live.collect(FakeLive(), NOW)
    assert len(doc["hours"]) == 72
    hr_si = next(f for f in doc["flows"] if (f["from"], f["to"]) == ("SI", "HR"))
    # the border is listed as SI-HR: 100 - 300 = -200, i.e. 200 MW from HR to SI
    assert hr_si["mw"][0] == -200.0
    assert hr_si["mw"][1] is None  # a quarter missing in one direction: no net value for that hour
    assert hr_si["mw"][2] == -200.0
    assert doc["prices"]["HR"]["eurPerMwh"][0] == 95.0  # mean of the four quarters, sequence 1 only
    assert doc["missing"] == {"flows": ["ME-BA"], "prices": ["BA", "ME"], "generation": ["ME"]}
    assert "HR-ME" not in {f"{f['from']}-{f['to']}" for f in doc["flows"]}
    live.validate(doc)


def test_flow_direction_parameters() -> None:
    seen: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        seen.append(params)
        xml = document(series([period(START, "PT60M", [1.0], timedelta(hours=1))]))
        if params["documentType"] == "A44":
            xml = xml.replace(b"quantity>", b"price.amount>")
        return httpx.Response(200, content=xml)

    client = EntsoeClient(
        "t",
        http=httpx.Client(transport=httpx.MockTransport(handler)),
        limiter=RateLimiter(per_minute=100_000, sleep=lambda _: None),
    )
    client.flows(AREAS["HR"], AREAS["SI"], START, START + timedelta(hours=1))
    client.prices(AREAS["HR"], START, START + timedelta(hours=1))
    assert (seen[0]["documentType"], seen[0]["out_Domain"], seen[0]["in_Domain"]) == (
        "A11",
        AREAS["HR"],
        AREAS["SI"],
    )
    assert seen[1]["documentType"] == "A44"
    assert seen[1]["contract_MarketAgreement.type"] == "A01"
    assert seen[1]["in_Domain"] == seen[1]["out_Domain"] == AREAS["HR"]


def test_prices_are_read_from_price_amount() -> None:
    xml = (
        document(series([period(START, "PT15M", [80.5, 90.5], timedelta(minutes=15))]))
        .replace(b"<quantity>", b"<price.amount>")
        .replace(b"</quantity>", b"</price.amount>")
    )
    from energymap.entsoe.parse import parse_document

    [prices] = parse_document(xml, "price.amount")
    assert [iv.value for iv in prices.intervals] == [80.5, 90.5]


def test_hourly_ignores_values_outside_the_window() -> None:
    hours = live.local_hours(START, START + timedelta(hours=2))
    before = hourly_series(START - timedelta(hours=5), [7.0] * 5)
    assert live.hourly(before.intervals, hours, complete=False) == [None, None]


def test_validation_keeps_the_last_good_document() -> None:
    doc = live.collect(FakeLive(), NOW)
    store = publish.MemoryStore()
    live.publish_live(store, doc)
    good = store.get_bytes(live.LIVE_KEY)
    empty = {**doc, "flows": [], "prices": {}}
    with pytest.raises(live.LiveDataError, match="no flows and no prices"):
        live.publish_live(store, empty)
    assert store.get_bytes(live.LIVE_KEY) == good
    with pytest.raises(live.LiveDataError, match="about 72 hours"):
        live.validate({**doc, "hours": doc["hours"][:10]})
    broken = json.loads(json.dumps(doc))
    broken["flows"][0]["mw"] = [1.0]
    with pytest.raises(live.LiveDataError, match="malformed flow"):
        live.validate(broken)
    _, meta = store.objects[live.LIVE_KEY]
    assert "max-age=300" in meta.cache_control


def test_cli_live_fetch_and_publish(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    class StandIn(FakeLive):
        def __enter__(self) -> StandIn:
            return self

        def __exit__(self, *exc: object) -> None:
            return None

    assert cli.main(["live", "publish-dir", "--data-dir", str(tmp_path), "--out", str(tmp_path / "b")]) == 1
    monkeypatch.setattr(EntsoeClient, "from_env", classmethod(lambda cls, env=None: StandIn()))
    assert cli.main(["live", "fetch", "--data-dir", str(tmp_path)]) == 0
    assert (tmp_path / "live" / "current.json").exists()
    assert cli.main(["live", "publish-dir", "--data-dir", str(tmp_path), "--out", str(tmp_path / "b")]) == 0
    assert json.loads((tmp_path / "b" / "live" / "current.json").read_text())["version"] == 1


def test_collect_adds_hourly_generation_per_technology() -> None:
    doc = live.collect(FakeLive(), NOW)
    hr = doc["generation"]["HR"]
    assert set(hr) == {"hydro", "wind"}  # pumping is consumption, not generation
    assert hr["hydro"][0] == 800.0 and hr["wind"][29] == 200.0
    assert hr["hydro"][30] is None  # not reported yet
    assert "ME" not in doc["generation"] and doc["missing"]["generation"] == ["ME"]
    live.validate(doc)


def test_an_hour_counts_only_when_every_series_reports_it() -> None:
    hours = live.local_hours(START, START + timedelta(hours=3))
    hydro = Series("B12", False, hourly_series(START, [500.0, 500.0, 500.0]).intervals)
    late_wind = Series("B19", False, hourly_series(START, [100.0, 100.0]).intervals)
    ror = Series("B11", False, hourly_series(START, [50.0, 50.0, 50.0]).intervals)
    silent = Series("B16", False, ())
    result = live.hourly_generation([hydro, late_wind, ror, silent], hours)
    assert result == {"hydro": [550.0, 550.0, None], "wind": [100.0, 100.0, None]}


def test_validation_rejects_malformed_generation() -> None:
    doc = live.collect(FakeLive(), NOW)
    doc["generation"]["HR"]["hydro"] = [1.0]
    with pytest.raises(live.LiveDataError):
        live.validate(doc)


def test_a_failing_generation_query_does_not_block_flows_and_prices(caplog: pytest.LogCaptureFixture) -> None:
    class Flaky(FakeLive):
        def generation(self, area: str, start: datetime, end: datetime) -> list[Series]:
            if CODE[area] == "SI":
                raise EntsoeError("HTTP 503 after retries")
            return super().generation(area, start, end)

    doc = live.collect(Flaky(), NOW)
    assert doc["flows"] and doc["prices"]["HR"]
    assert "SI" in doc["missing"]["generation"] and "HR" in doc["generation"]
    assert any(record.getMessage() == "generation unavailable" for record in caplog.records)
    live.validate(doc)
