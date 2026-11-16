"""The survey of the region's gas points (Faza 30) against a mocked ENTSOG platform.

The rows follow the shape of ``test_gas.py`` (verified live on 2026-09-19); the interconnection, LNG and
storage points and their flows are invented, to test the survey, not to describe the real grid.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from energymap import cli
from energymap.gas import points
from energymap.gas.entsog import EntsogError

NOW = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)  # 10:00 CET: gas day 2026-11-14 is complete
SCOPE = frozenset({"HR", "SI"})


def row(point_key: str, label: str, direction: str, country: str, **extra: Any) -> dict[str, Any]:
    operator = f"{country}-TSO-0001"
    return {
        "id": f"5{operator}{point_key}{direction}",
        "pointKey": point_key,
        "pointLabel": label,
        "operatorKey": operator,
        "operatorLabel": f"Operator {country}",
        "directionKey": direction,
        "tSOCountry": country,
        **extra,
    }


ROWS = [
    row("ITP-00001", "Border A", "entry", "HR", adjacentCountry="SI", pointType="Cross-Border IP"),
    row("ITP-00001", "Border A", "exit", "HR", adjacentCountry="SI"),
    row("LNG-00002", "LNG terminal", "entry", "HR", pointType="LNG Entry point"),
    row("UGS-00003", "Storage", "exit", "HR"),
    row("PRD-00004", "Domestic production", "entry", "HR"),  # listed, but its flow is the gas layer's
    row("ITP-00005", "Border B", "entry", "AT"),  # out of scope
    row("ITP-00006", "Border C", "exit", "SI"),
]
# kWh/d by point direction and gas day; the exit at Border A reports nothing
FLOWS = {
    "HR-TSO-0001ITP-00001entry": {"2026-11-13": 12_000_000.0, "2026-11-14": 15_500_000.0},
    "HR-TSO-0001LNG-00002entry": {"2026-11-14": 40_000_000.0},
    "HR-TSO-0001UGS-00003exit": {"2026-11-12": 3_000_000.0},
    "SI-TSO-0001ITP-00006exit": {},
}


class Platform:
    def __init__(self) -> None:
        self.asked: list[str] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        resource = request.url.path.rsplit("/", 1)[-1]
        if resource == "operatorpointdirections":
            return httpx.Response(200, json={"operatorpointdirections": [*ROWS, ROWS[0]]})
        direction = request.url.params["pointDirection"]
        self.asked.append(direction)
        days = FLOWS.get(direction, {})
        if not days:
            return httpx.Response(404)
        rows = [
            {"periodFrom": f"{day}T06:00:00+01:00", "value": value, "unit": "kWh/d", "isNA": False}
            for day, value in days.items()
        ]
        return httpx.Response(200, json={"operationalData": rows})

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handle))


@pytest.fixture
def platform() -> Platform:
    return Platform()


def test_the_kind_comes_from_the_point_key() -> None:
    assert points.kind_of("ITP-00078") == "ITP"
    assert points.kind_of("ugs-00369") == "UGS"
    assert points.kind_of("weird") == "?"


def test_the_survey_lists_the_scope_and_asks_flows_only_where_the_map_needs_them(platform: Platform) -> None:
    with platform.client() as client:
        survey = points.survey(client, NOW, SCOPE)
    found = {(p["country"], p["kind"], p["direction"]) for p in survey["points"]}
    assert found == {
        ("HR", "ITP", "entry"),
        ("HR", "ITP", "exit"),
        ("HR", "LNG", "entry"),
        ("HR", "UGS", "exit"),
        ("HR", "PRD", "entry"),
        ("SI", "ITP", "exit"),
    }
    assert len(survey["points"]) == 6  # the duplicate row counts once
    # production is the existing gas layer's: no flow request for it
    assert not any("PRD" in asked for asked in platform.asked)
    by_label = {(p["label"], p["direction"]): p for p in survey["points"]}
    border = by_label[("Border A", "entry")]
    assert (border["latestDay"], border["latestKwhPerDay"]) == ("2026-11-14", 15_500_000.0)
    assert border["fields"] == {"adjacentCountry": "SI", "pointType": "Cross-Border IP"}
    assert by_label[("Border A", "exit")]["latestDay"] is None
    assert by_label[("Storage", "exit")]["latestDay"] == "2026-11-12"
    assert "adjacentCountry" in survey["fieldsReturned"] and "tSOCountry" in survey["fieldsReturned"]
    assert survey["days"] == ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]


def test_the_summary_is_a_table_with_flows_in_gwh(platform: Platform) -> None:
    with platform.client() as client:
        text = points.markdown(points.survey(client, NOW, SCOPE))
    assert "| HR | LNG | LNG terminal | entry | Operator HR |" in text
    assert "| 2026-11-14 | 40.0 | `HR-TSO-0001LNG-00002entry` |" in text
    assert "`adjacentCountry`" in text


def test_cli_points_writes_the_file_and_prints_the_table(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, platform: Platform, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("energymap.cli.make_client", platform.client)
    monkeypatch.setattr("energymap.config.SCOPE_CODES", SCOPE)
    assert cli.main(["gas", "points", "--data-dir", str(tmp_path)]) == cli.EXIT_OK
    written = json.loads((tmp_path / "gas" / "points.json").read_text(encoding="utf-8"))
    assert len(written["points"]) == 6
    assert "## Plinske točke na ENTSOG-u" in capsys.readouterr().out


def test_one_failing_point_is_noted_and_the_survey_goes_on() -> None:
    class Flaky(Platform):
        def handle(self, request: httpx.Request) -> httpx.Response:
            if request.url.params.get("pointDirection") == "HR-TSO-0001LNG-00002entry":
                return httpx.Response(503, text="busy")
            return super().handle(request)

    with Flaky().client() as client:
        survey = points.survey(client, NOW, SCOPE)
    lng = next(p for p in survey["points"] if p["kind"] == "LNG")
    assert lng["error"] and lng["latestDay"] is None
    border = next(p for p in survey["points"] if p["label"] == "Border A" and p["direction"] == "entry")
    assert border["latestDay"] == "2026-11-14"
    assert "| greška |" in points.markdown(survey)


def test_an_empty_answer_is_an_error_not_an_empty_table() -> None:
    def empty(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"operatorpointdirections": []})

    with httpx.Client(transport=httpx.MockTransport(empty)) as client, pytest.raises(EntsogError):
        points.survey(client, NOW, SCOPE)
