"""A country's daily gas balance from ENTSOG, against a mocked platform shaped like the real one
(field names and behaviour as verified live on 2026-11-19)."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import ValidationError

from energymap import cli, publish
from energymap.gas import flows
from energymap.gas.entsog import EntsogError

NOW = datetime(2026, 11, 19, 10, 0, tzinfo=UTC)  # 11:00 CET: gas day 2026-11-18 is complete
OPERATOR = "HR-TSO-0001"

#: point key, label, direction, GWh/d on every reported day
SERIES: list[tuple[str, str, str, float]] = [
    ("LNG-00032", "Croatia LNG", "entry", 98.4),
    ("PRD-00197", "Production (HR)", "entry", 19.5),
    ("UGS-00028", "UGS Croatia", "entry", 3.3),
    ("UGS-00028", "UGS Croatia", "exit", 0.0),
    ("ITP-00042", "Rogatec", "entry", 0.0),
    ("ITP-00042", "Rogatec", "exit", 25.3),
    ("ITP-00011", "Dravaszerdahely", "exit", 26.3),
    ("FNC-00018", "Final Consumers and Distribution (HR)", "exit", 71.9),
]

DIRECTIONS: list[dict[str, Any]] = [
    {"operatorKey": OPERATOR, "pointKey": "ITP-00042", "directionKey": "entry", "adjacentCountry": "SI"},
    {"operatorKey": OPERATOR, "pointKey": "ITP-00011", "directionKey": "exit", "adjacentCountry": "HU"},
    # a point inside the country, and another operator's row: neither names a neighbour
    {"operatorKey": OPERATOR, "pointKey": "LNG-00032", "directionKey": "entry", "adjacentCountry": "HR"},
    {"operatorKey": "HR-SSO-0001", "pointKey": "UGS-00028", "directionKey": "exit", "adjacentCountry": "AT"},
]


def row(point_key: str, label: str, direction: str, day: date, value: Any) -> dict[str, Any]:
    return {
        "operatorKey": OPERATOR,
        "operatorLabel": "Plinacro Ltd",
        "pointKey": point_key,
        "pointLabel": label,
        "directionKey": direction,
        "periodFrom": f"{day.isoformat()}T06:00:00+01:00",
        "periodTo": f"{(day + timedelta(days=1)).isoformat()}T06:00:00+01:00",
        "value": value,
        "unit": "kWh/d",
        "flowStatus": "Provisional",
        "isNA": value == "",
    }


class Platform:
    """A stand-in for transparency.entsog.eu: Plinacro reports every day asked but the last."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.status = 200
        self.extra: list[dict[str, Any]] = []
        self.empty = False

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status, text="boom")
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "operatorpointdirections":
            assert request.url.params["tSOCountry"] == "HR"
            return httpx.Response(200, json={"operatorpointdirections": DIRECTIONS})
        assert path == "operationalData"
        assert request.url.params["indicator"] == "Physical Flow"
        assert request.url.params["periodType"] == "day"
        assert request.url.params["operatorKey"] == OPERATOR
        if self.empty:
            return httpx.Response(404, json={"message": "No result found"})
        start = date.fromisoformat(request.url.params["from"])
        end = date.fromisoformat(request.url.params["to"])
        days = [start + timedelta(days=offset) for offset in range((end - start).days)]
        rows = [
            row(key, label, direction, day, gwh * 1e6)
            for key, label, direction, gwh in SERIES
            for day in days
        ]
        return httpx.Response(200, json={"operationalData": rows + self.extra})


@pytest.fixture
def platform() -> Platform:
    return Platform()


@pytest.fixture
def client(platform: Platform) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(platform.handle))


def test_collect_reads_every_point_direction_of_the_operator(client: httpx.Client) -> None:
    document = flows.collect(client, NOW, days=3)
    assert document.days == [date(2026, 11, 16), date(2026, 11, 17), date(2026, 11, 18)]
    assert document.unit == "kWh/d" and document.missing == []
    croatia = document.countries["HR"]
    assert croatia.operator == "Plinacro Ltd" and croatia.operator_key == OPERATOR
    by_key = {(point.key, point.direction): point for point in croatia.points}
    assert len(by_key) == len(SERIES)
    terminal = by_key[("LNG-00032", "entry")]
    # the last day asked is not reported yet: a gap, not a zero
    assert terminal.kwh_per_day == [98_400_000, 98_400_000, None]
    assert terminal.status == ["P", "P", None]
    assert terminal.kind == "LNG" and terminal.neighbour is None
    # a point through which nothing flowed is a zero, which is information
    assert by_key[("ITP-00042", "entry")].kwh_per_day == [0, 0, None]
    # an interconnection names the country across the border, whichever direction listed it
    assert by_key[("ITP-00042", "exit")].neighbour == "SI"
    assert by_key[("ITP-00011", "exit")].neighbour == "HU"
    assert by_key[("FNC-00018", "exit")].kind == "FNC"
    assert by_key[("UGS-00028", "exit")].neighbour is None


def test_blank_and_broken_values_are_gaps(client: httpx.Client, platform: Platform) -> None:
    day = date(2026, 11, 17)
    platform.extra = [
        row("ITP-00099", "Elsewhere", "entry", day, ""),
        row("ITP-00098", "Text", "entry", day, "12000000.4"),
        row("XYZ-00001", "Something new", "exit", day, 5e6),
        {**row("ITP-00097", "No day", "entry", day, 1e6), "periodFrom": "soon"},
        {**row("ITP-00096", "Sideways", "entry", day, 1e6), "directionKey": "both"},
    ]
    points = {
        (point.key, point.direction): point
        for point in flows.collect(client, NOW, days=3).countries["HR"].points
    }
    assert ("ITP-00099", "entry") not in points
    assert ("ITP-00097", "entry") not in points and ("ITP-00096", "entry") not in points
    assert points[("ITP-00098", "entry")].kwh_per_day == [None, 12_000_000, None]
    # a kind the balance does not know is kept under its own label
    assert points[("XYZ-00001", "exit")].kind == "OTHER"


def test_what_does_not_belong_stops_the_run(client: httpx.Client, platform: Platform) -> None:
    day = date(2026, 11, 17)
    platform.extra = [{**row("ITP-00042", "Rogatec", "exit", day, 1e6), "unit": "m3/d"}]
    with pytest.raises(EntsogError, match="unexpected unit"):
        flows.collect(client, NOW, days=3)
    # the country filter is known not to work on this resource: another operator's row is refused
    platform.extra = [{**row("ITP-00042", "Rogatec", "exit", day, 1e6), "operatorKey": "SI-TSO-0001"}]
    with pytest.raises(EntsogError, match="rows of 'SI-TSO-0001'"):
        flows.collect(client, NOW, days=3)
    platform.extra = [row("ITP-00042", "Rogatec", "exit", day, -5.0)]
    with pytest.raises(EntsogError, match="negative"):
        flows.collect(client, NOW, days=3)
    platform.extra = []
    platform.status = 500
    with pytest.raises(EntsogError, match="HTTP 500"):
        flows.collect(client, NOW, days=3)


def test_a_country_without_an_answer_is_named_and_nothing_is_published(
    client: httpx.Client, platform: Platform
) -> None:
    platform.empty = True
    document = flows.collect(client, NOW, days=3)
    assert document.countries == {} and document.missing == ["HR"]
    with pytest.raises(flows.FlowDataError, match="no entry point"):
        flows.validate(document)
    store = publish.MemoryStore()
    with pytest.raises(flows.FlowDataError):
        flows.publish_flows(store, document)
    assert store.objects == {}


def test_a_document_is_checked_when_read_back(client: httpx.Client) -> None:
    raw = flows.collect(client, NOW, days=3).model_dump(mode="json", by_alias=True)
    assert flows.parse(raw).countries["HR"].points[0].key
    raw["countries"]["HR"]["points"][0]["kwhPerDay"].append(1.0)
    with pytest.raises(ValidationError, match="not one value per day"):
        flows.parse(raw)


def test_stale_entries_are_not_published(client: httpx.Client) -> None:
    document = flows.collect(client, NOW, days=3)
    flows.validate(document)
    for point in document.countries["HR"].points:
        if point.direction == "entry":
            point.kwh_per_day = [None] * 3
    with pytest.raises(flows.FlowDataError):
        flows.validate(document)


def test_cli_gas_flows_fetch_and_publish(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, platform: Platform
) -> None:
    out = tmp_path / "mirror"
    assert cli.main(["gas", "flows-publish-dir", "--data-dir", str(tmp_path), "--out", str(out)]) == 1
    monkeypatch.setattr(
        "energymap.cli.make_client", lambda: httpx.Client(transport=httpx.MockTransport(platform.handle))
    )
    assert cli.main(["gas", "flows-fetch", "--data-dir", str(tmp_path), "--days", "5"]) == 0
    document = json.loads((tmp_path / "live" / "gasflows.json").read_text())
    assert len(document["days"]) == 5 and "HR" in document["countries"]
    assert cli.main(["gas", "flows-publish-dir", "--data-dir", str(tmp_path), "--out", str(out)]) == 0
    published = json.loads((out / "live" / "gasflows.json").read_text())
    assert published["version"] == 1 and published["source"] == "ENTSOG Transparency Platform"
    platform.status = 503
    assert cli.main(["gas", "flows-fetch", "--data-dir", str(tmp_path)]) == cli.EXIT_FAILED
