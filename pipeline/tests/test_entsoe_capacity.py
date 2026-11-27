"""The survey of installed capacity on ENTSO-E, against a mocked platform shaped like the documents of
IEC 62325-451-6 (A68 per production type, A71 per production unit)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from energymap import cli
from energymap.entsoe import capacity
from energymap.entsoe import client as ec
from energymap.entsoe.parse import EntsoeParseError
from entsoe_xml import GL_NS, no_data

NOW = datetime(2026, 11, 27, 12, tzinfo=UTC)


def _series(year: int, psr: str, mw: float, unit: tuple[str, str] | None = None) -> str:
    resource = (
        f"<PowerSystemResources><mRID codingScheme='A01'>{unit[0]}</mRID><name>{unit[1]}</name>"
        "</PowerSystemResources>"
        if unit
        else ""
    )
    return (
        "<TimeSeries><mRID>1</mRID><businessType>A37</businessType>"
        "<inBiddingZone_Domain.mRID codingScheme='A01'>10YHR-HEP------M</inBiddingZone_Domain.mRID>"
        "<quantity_Measure_Unit.name>MAW</quantity_Measure_Unit.name><curveType>A01</curveType>"
        f"<MktPSRType><psrType>{psr}</psrType>{resource}</MktPSRType>"
        f"<Period><timeInterval><start>{year - 1}-12-31T23:00Z</start><end>{year}-12-31T23:00Z</end>"
        f"</timeInterval><resolution>P1Y</resolution><Point><position>1</position><quantity>{mw:g}</quantity>"
        "</Point></Period></TimeSeries>"
    )


def _document(*series: str) -> bytes:
    body = "".join(series)
    return f'<?xml version="1.0"?><GL_MarketDocument xmlns="{GL_NS}">{body}</GL_MarketDocument>'.encode()


def test_a_year_of_capacity_per_type_and_per_unit() -> None:
    rows = capacity.parse_capacity(
        _document(_series(2025, "B16", 556), _series(2025, "B11", 2_200.5, ("14W-KRSKO--0001", "NEK")))
    )
    # the period from 31 December 23:00Z is the next calendar year in central Europe
    assert [(row.psr_type, row.year, row.mw) for row in rows] == [("B16", 2025, 556), ("B11", 2025, 2_200.5)]
    assert (rows[1].unit_id, rows[1].unit_name) == ("14W-KRSKO--0001", "NEK")
    assert rows[0].unit_id is None
    assert "MktPSRType/PowerSystemResources/name" in capacity.fields_of(
        _document(_series(2025, "B14", 1, ("x", "y")))
    )
    with pytest.raises(EntsoeParseError, match="unexpected document"):
        capacity.parse_capacity(b"<Other/>")


class Platform:
    """Croatia publishes per type from 2024, units for 2025 only; one year fails on the platform's side."""

    def __init__(self) -> None:
        self.asked: list[dict[str, str]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        self.asked.append(params)
        assert params["processType"] == "A33"
        year = int(params["periodEnd"][:4])
        if params["in_Domain"] != ec.AREAS["HR"]:
            return httpx.Response(200, content=no_data())
        if params["documentType"] == "A68":
            if year == 2023:
                return httpx.Response(400, text="something else went wrong")
            if year < 2024:
                return httpx.Response(200, content=no_data())
            return httpx.Response(
                200, content=_document(_series(year, "B16", 500 + year - 2024), _series(year, "B12", 1_500))
            )
        if year == 2025:
            return httpx.Response(
                200, content=_document(_series(year, "B12", 420, ("15W-ZAKUCAC", "HE Zakucac")))
            )
        return httpx.Response(200, content=no_data())


def _client(platform: Platform) -> ec.EntsoeClient:
    return ec.EntsoeClient(
        "token",
        http=httpx.Client(transport=httpx.MockTransport(platform.handle)),
        limiter=ec.RateLimiter(per_minute=100_000, sleep=lambda _: None),
        sleep=lambda _: None,
    )


def test_the_survey_writes_what_came_back_and_goes_on_after_a_failure() -> None:
    platform = Platform()
    result = capacity.survey(_client(platform), NOW, ["HR", "SI"])
    hr = result["countries"]["HR"]["10YHR-HEP------M"]
    assert result["years"][0] == 2015 and result["years"][-1] == 2027
    assert hr["perType"]["2025"] == {"B16": 501, "B12": 1_500}
    assert 2015 in hr["noData"] and "2023" in hr["errors"]
    assert hr["units"]["year"] == 2025
    assert hr["units"]["units"] == [{"id": "15W-ZAKUCAC", "name": "HE Zakucac", "psrType": "B12", "mw": 420}]
    si = result["countries"]["SI"]["10YSI-ELES-----O"]
    assert si["perType"] == {} and si["units"] is None
    table = capacity.markdown(result)
    assert "| 2025 | 2,001 | Hydro reservoir 1,500, Solar 501 |" in table
    assert "| HE Zakucac | `15W-ZAKUCAC` | Hydro reservoir | 420 |" in table
    assert "Jedinice (A71): nema ni za jednu godinu." in table


def test_italy_is_asked_per_bidding_zone_too() -> None:
    platform = Platform()
    result = capacity.survey(_client(platform), NOW, ["IT"])
    assert set(result["countries"]["IT"]) == {ec.AREAS["IT"], *ec.ITALY_ZONES}


def test_cli_capacity_survey(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    platform = Platform()
    monkeypatch.setattr(ec.EntsoeClient, "from_env", classmethod(lambda cls: _client(platform)))
    assert cli.main(["energy", "capacity-survey", "--data-dir", str(tmp_path), "--countries", "HR"]) == 0
    written = json.loads((tmp_path / "entsoe" / "capacity.json").read_text(encoding="utf-8"))
    assert written["countries"]["HR"]["10YHR-HEP------M"]["perType"]["2026"] == {"B16": 502, "B12": 1_500}
