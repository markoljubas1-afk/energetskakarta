"""ENTSOG production points and their daily flows, against a mocked platform shaped like the real one
(field names and quirks as verified live on 2026-09-19)."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest

from energymap import cli, publish
from energymap.gas import entsog

NOW = datetime(2026, 9, 19, 9, 0, tzinfo=UTC)  # 11:00 CEST: gas day 2026-09-18 is complete
SCOPE = frozenset({"HR", "IT", "SI"})

POINTS: list[dict[str, Any]] = [
    {
        "id": "5HR-TSO-0001PRD-00197entry",
        "pointKey": "PRD-00197",
        "pointLabel": "Domestic production",
        "operatorKey": "HR-TSO-0001",
        "operatorLabel": "Plinacro",
        "directionKey": "entry",
        "tSOCountry": "HR",
        "pointType": "Aggregated production point - TP",
        "idPointType": 3,
        "hasData": True,
    },
    {  # the same point listed again: kept once
        "id": "5HR-TSO-0001PRD-00197entry",
        "pointKey": "PRD-00197",
        "pointLabel": "Domestic production",
        "operatorKey": "HR-TSO-0001",
        "operatorLabel": "Plinacro",
        "directionKey": "entry",
        "tSOCountry": "HR",
    },
    {  # an exit direction is not production
        "id": "5HR-TSO-0001PRD-00197exit",
        "pointKey": "PRD-00197",
        "pointLabel": "Domestic production",
        "operatorKey": "HR-TSO-0001",
        "operatorLabel": "Plinacro",
        "directionKey": "exit",
        "tSOCountry": "HR",
    },
    {
        "id": "5IT-TSO-0001PRD-00050entry",
        "pointKey": "PRD-00050",
        "pointLabel": "Produzione nazionale",
        "operatorKey": "IT-TSO-0001",
        "operatorLabel": "Snam Rete Gas",
        "directionKey": "entry",
        "tSOCountry": "IT",
    },
    {  # out of scope
        "id": "5DE-TSO-0001PRD-00001entry",
        "pointKey": "PRD-00001",
        "pointLabel": "Produktion",
        "operatorKey": "DE-TSO-0001",
        "operatorLabel": "Someone",
        "directionKey": "entry",
        "tSOCountry": "DE",
    },
]


def flow_rows(
    point_direction: str, days: list[str], values: list[float | str | None]
) -> list[dict[str, Any]]:
    return [
        {
            "pointDirection": point_direction,
            "periodFrom": f"{day} 06:00",
            "periodTo": f"{day} 06:00",
            "value": value,
            "unit": "kWh/d",
            "flowStatus": "Provisional",
            "isNA": value == "",
        }
        for day, value in zip(days, values, strict=True)
    ]


class Platform:
    """A stand-in for transparency.entsog.eu: the HR point reports, the IT point has nothing (404)."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.status = 200

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status, text="boom")
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "operatorpointdirections":
            assert request.url.params["idPointType"] == "3"
            return httpx.Response(200, json={"operatorpointdirections": POINTS})
        assert path == "operationalData"
        assert request.url.params["indicator"] == "Physical Flow"
        assert request.url.params["periodType"] == "day"
        if request.url.params["pointDirection"] == "5IT-TSO-0001PRD-00050entry":
            return httpx.Response(404, json={"message": "No Data Found"})
        start = date.fromisoformat(request.url.params["from"])
        end = date.fromisoformat(request.url.params["to"])
        # answer for the window asked, not for NOW: the CLI asks for the days before today (L-055)
        days = [(start + timedelta(days=offset)).isoformat() for offset in range((end - start).days + 1)]
        # the last day is not yet reported (""), the day before has a number as text
        values: list[float | str | None] = [12_500_000.0] * (len(days) - 2) + ["9800000.5", ""]
        return httpx.Response(
            200, json={"operationalData": flow_rows("5HR-TSO-0001PRD-00197entry", days, values)}
        )


@pytest.fixture
def platform() -> Platform:
    return Platform()


@pytest.fixture
def client(platform: Platform) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(platform.handle))


def test_gas_days_end_with_the_last_complete_day() -> None:
    days = entsog.gas_days(NOW, 3)
    assert days == [date(2026, 9, 16), date(2026, 9, 17), date(2026, 9, 18)]
    # at 04:30 UTC (06:30 CEST) the gas day of the 18th has just started: the 17th is the last complete one
    early = datetime(2026, 9, 19, 3, 30, tzinfo=UTC)  # 05:30 CEST
    assert entsog.gas_days(early, 1) == [date(2026, 9, 17)]
    assert entsog.gas_days(datetime(2026, 9, 19, 4, 30, tzinfo=UTC), 1) == [date(2026, 9, 18)]


def test_production_points_are_entry_points_in_scope_listed_once(client: httpx.Client) -> None:
    points = entsog.production_points(client, SCOPE)
    assert [p.point_direction for p in points] == ["5HR-TSO-0001PRD-00197entry", "5IT-TSO-0001PRD-00050entry"]
    assert points[0] == entsog.ProductionPoint(
        country="HR",
        key="PRD-00197",
        point_direction="5HR-TSO-0001PRD-00197entry",
        label="Domestic production",
        operator_key="HR-TSO-0001",
        operator_label="Plinacro",
    )


def test_collect_reads_numbers_and_blanks_and_reports_what_is_missing(
    client: httpx.Client, platform: Platform
) -> None:
    document = entsog.collect(client, NOW, SCOPE, days=5)
    assert document["days"] == ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"]
    assert document["unit"] == "kWh/d"
    assert document["points"] == [
        {
            "key": "PRD-00197",
            "pointDirection": "5HR-TSO-0001PRD-00197entry",
            "label": "Domestic production",
            "country": "HR",
            "operator": "Plinacro",
            "kwhPerDay": [12_500_000, 12_500_000, 12_500_000, 9_800_000, None],
        }
    ]
    # the IT point answered 404, SI has no production point at all
    assert document["missing"] == {"points": ["5IT-TSO-0001PRD-00050entry"], "countries": ["IT", "SI"]}
    # every request asked for the whole window at once
    flows = [r for r in platform.requests if r.url.path.endswith("operationalData")]
    assert len(flows) == 2 and flows[0].url.params["from"] == "2026-09-14"
    assert flows[0].url.params["to"] == "2026-09-18" and flows[0].url.params["limit"] == "-1"
    entsog.validate(document)


def test_platform_errors_are_reported_not_swallowed(client: httpx.Client, platform: Platform) -> None:
    platform.status = 500
    with pytest.raises(entsog.EntsogError, match="HTTP 500"):
        entsog.production_points(client, SCOPE)


def test_an_unexpected_unit_stops_the_build() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        rows = flow_rows("x", ["2026-09-18"], [1.0])
        rows[0]["unit"] = "m3/d"
        return httpx.Response(200, json={"operationalData": rows})

    point = entsog.ProductionPoint("HR", "k", "x", "l", "o", "o")
    with (
        httpx.Client(transport=httpx.MockTransport(handle)) as client,
        pytest.raises(entsog.EntsogError, match="unit"),
    ):
        entsog.daily_flows(client, point, date(2026, 9, 18), date(2026, 9, 18))


def test_validation_refuses_a_stale_or_malformed_document() -> None:
    good = {
        "version": 1,
        "unit": "kWh/d",
        "days": ["2026-09-17", "2026-09-18"],
        "points": [{"pointDirection": "x", "country": "HR", "kwhPerDay": [1, None]}],
        "missing": {"points": [], "countries": []},
    }
    entsog.validate(good)
    with pytest.raises(entsog.GasDataError, match="last 7 days"):
        entsog.validate(
            {**good, "points": [{"pointDirection": "x", "country": "HR", "kwhPerDay": [None, None]}]}
        )
    with pytest.raises(entsog.GasDataError, match="malformed"):
        entsog.validate({**good, "points": [{"pointDirection": "x", "country": "HR", "kwhPerDay": [1]}]})
    with pytest.raises(entsog.GasDataError, match="unit"):
        entsog.validate({**good, "unit": "MWh/d"})
    with pytest.raises(entsog.GasDataError, match="days"):
        entsog.validate({**good, "days": []})


def test_publish_leaves_the_old_document_when_the_new_one_is_bad() -> None:
    store = publish.MemoryStore()
    store.put_bytes(entsog.GAS_KEY, b'{"old": true}', entsog.GAS_META)
    with pytest.raises(entsog.GasDataError):
        entsog.publish_gas(store, {"version": 1, "unit": "kWh/d", "days": [], "points": [], "missing": {}})
    assert store.get_bytes(entsog.GAS_KEY) == b'{"old": true}'


def test_cli_gas_fetch_and_publish(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, platform: Platform
) -> None:
    out = tmp_path / "mirror"
    assert cli.main(["gas", "publish-dir", "--data-dir", str(tmp_path), "--out", str(out)]) == 1
    monkeypatch.setattr(
        "energymap.cli.make_client", lambda: httpx.Client(transport=httpx.MockTransport(platform.handle))
    )
    assert cli.main(["gas", "fetch", "--data-dir", str(tmp_path), "--days", "3"]) == 0
    document = json.loads((tmp_path / "live" / "gas.json").read_text())
    assert len(document["days"]) == 3 and document["points"][0]["country"] == "HR"
    assert cli.main(["gas", "publish-dir", "--data-dir", str(tmp_path), "--out", str(out)]) == 0
    assert json.loads((out / "live" / "gas.json").read_text())["version"] == 1
    platform.status = 503
    assert cli.main(["gas", "fetch", "--data-dir", str(tmp_path)]) == cli.EXIT_FAILED
