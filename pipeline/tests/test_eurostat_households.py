"""Households' electricity use (Eurostat ``nrg_d_hhq``) against a mocked Statistics API.

The answer is built in the shape the API returned on 2026-11-17: dimensions freq, nrg_bal, siec, unit, geo,
time; ``value`` keyed by the flat position; a 0 where a country did not report a year. The numbers are
invented, except that shape.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from energymap import publish
from energymap.eurostat import households
from energymap.eurostat.renewables import EurostatDataError, EurostatSourceError

NOW = datetime(2026, 11, 17, 14, 0, tzinfo=UTC)
YEARS = list(range(2010, 2025))


def answer(series: dict[str, list[float | None]], *, unit: str = "GWH") -> dict[str, Any]:
    geos = list(series)
    values: dict[str, float] = {}
    for g, geo in enumerate(geos):
        for y, value in enumerate(series[geo]):
            if value is not None:
                values[str(g * len(YEARS) + y)] = value

    def dimension(codes: list[str]) -> dict[str, Any]:
        return {"category": {"index": {code: i for i, code in enumerate(codes)}}}

    return {
        "version": "2.0",
        "class": "dataset",
        "updated": "2026-06-09T11:00:00+0200",
        "id": ["freq", "nrg_bal", "siec", "unit", "geo", "time"],
        "size": [1, 1, 1, 1, len(geos), len(YEARS)],
        "dimension": {
            "freq": dimension(["A"]),
            "nrg_bal": dimension(["FC_OTH_HH_E"]),
            "siec": dimension(["E7000"]),
            "unit": dimension([unit]),
            "geo": dimension(geos),
            "time": dimension([str(year) for year in YEARS]),
        },
        "value": values,
    }


SERIES: dict[str, list[float | None]] = {
    "HR": [6000.0 + 30 * i for i in range(len(YEARS))],
    # did not report the first five years: Eurostat writes zeros there
    "HU": [*([0.0] * 5), *(12000.0 + 50 * i for i in range(len(YEARS) - 5))],
    # a year behind
    "BA": [4000.0 + 80 * i for i in range(len(YEARS) - 1)] + [None],
}


def client(body: object, status: int = 200) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        params = request.url.params
        assert (params["siec"], params["nrg_bal"], params["unit"]) == ("E7000", "FC_OTH_HH_E", "GWH")
        assert "HR" in params.get_list("geo") and "IT" in params.get_list("geo")
        return httpx.Response(status, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_reads_yearly_use_by_country_and_treats_a_zero_as_a_gap() -> None:
    document = households.collect(client(answer(SERIES)), NOW)

    assert document["years"] == YEARS and document["unit"] == "GWh"
    assert document["series"]["HR"][-1] == 6420.0
    assert document["series"]["HU"][:5] == [None] * 5 and document["series"]["HU"][5] == 12000.0
    assert document["series"]["BA"][-1] is None
    assert document["missing"] == ["SI", "RS", "ME", "IT", "AT"]
    assert document["updated"] == "2026-06-09T11:00:00+02:00"
    assert (document["source"], document["license"]) == ("Eurostat", "CC-BY-4.0")
    households.validate(document)
    assert households.last_year(document) == 2024 and households.last_year(document, "BA") == 2023


def test_an_answer_in_another_unit_or_an_error_is_refused() -> None:
    with pytest.raises(EurostatSourceError, match="unexpected unit"):
        households.collect(client(answer(SERIES, unit="TJ")), NOW)
    with pytest.raises(EurostatSourceError, match="HTTP 503"):
        households.collect(client({"error": [{"status": 503, "label": "busy"}]}, status=503), NOW)
    with pytest.raises(EurostatSourceError, match="no values"):
        households.collect(client(answer({"XX": [1.0] * len(YEARS)})), NOW)


def test_publishes_only_a_plausible_document_that_does_not_go_back_in_time(tmp_path: Path) -> None:
    store = publish.DirectoryStore(tmp_path)
    document = households.collect(client(answer(SERIES)), NOW)
    households.publish_households(store, document)
    published = (tmp_path / "eurostat" / "households.json").read_text(encoding="utf-8")
    assert json.loads(published)["series"]["HR"][-1] == 6420.0

    # a truncated answer (Croatia's last year gone), a short series and an absurd figure never replace it
    truncated = households.collect(client(answer({**SERIES, "HR": [*SERIES["HR"][:-1], None]})), NOW)
    with pytest.raises(EurostatDataError, match="went back from 2024 to 2023"):
        households.publish_households(store, truncated)
    short = households.collect(client(answer({"HR": [*([None] * 9), *SERIES["HR"][9:]]})), NOW)
    with pytest.raises(EurostatDataError, match="6 years of data"):
        households.publish_households(store, short)
    absurd = json.loads(json.dumps(document))
    absurd["series"]["HR"][-1] = 9_000_000.0
    with pytest.raises(EurostatDataError, match="not a plausible"):
        households.publish_households(store, absurd)
    assert (tmp_path / "eurostat" / "households.json").read_text(encoding="utf-8") == published
