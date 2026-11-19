"""Solar electricity per inhabitant against the two answers the Statistics API gave on 2026-11-19.

The fixtures are Eurostat's real answers of that day (CC BY 4.0), asked for from 2021: photovoltaic
production (``nrg_bal_peh``) to 2024 and the average population (``demo_gind``) to 2025, with Bosnia and
Herzegovina's population marked provisional.
"""

from __future__ import annotations

import copy
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from energymap import cli, publish
from energymap.eurostat import solar_capita
from energymap.eurostat.renewables import EurostatDataError, EurostatSourceError

NOW = datetime(2026, 11, 19, 20, 0, tzinfo=UTC)
FIXTURES = Path(__file__).parent / "fixtures"


def answer(name: str) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return loaded


@pytest.fixture
def generation() -> dict[str, Any]:
    return answer("eurostat_solar_generation.json")


@pytest.fixture
def population() -> dict[str, Any]:
    return answer("eurostat_population_average.json")


def test_divides_production_by_people_for_the_year_all_countries_share(
    generation: dict[str, Any], population: dict[str, Any]
) -> None:
    document = solar_capita.solar_capita_document(generation, population, NOW)
    # production ends in 2024, the population goes on to 2025: the year both have is 2024
    assert document.year == 2024
    latest = {geo: years[-1] for geo, years in document.countries.items()}
    assert {geo: each.year for geo, each in latest.items()} == dict.fromkeys(solar_capita.GEOS, 2024)
    croatia = latest["HR"]
    assert (croatia.gwh, croatia.people, croatia.kwh_per_person) == (820.0, 3868159.0, 212.0)
    assert {geo: each.kwh_per_person for geo, each in latest.items()} == {
        "HR": 212.0,
        "SI": 596.1,
        "HU": 962.1,
        "RS": 24.7,
        "BA": 176.2,
        "ME": 102.2,
        "IT": 610.5,
        "AT": 887.3,
    }
    # Bosnia and Herzegovina's population is provisional, and says so in Eurostat's word
    assert latest["BA"].population_flag == "p" and latest["HR"].population_flag is None
    assert document.flag_labels == {"p": "provisional"}
    # it has no population for 2021 at all: that year is simply not there
    assert [each.year for each in document.countries["BA"]] == [2022, 2023, 2024]
    assert [each.year for each in document.countries["HR"]] == [2021, 2022, 2023, 2024]
    assert document.generation.updated == "2026-06-02T23:00:00+02:00"
    assert document.population.dataset == "demo_gind"
    published = solar_capita.dump(document)
    assert published["countries"]["HR"][-1] == {
        "year": 2024,
        "gwh": 820.0,
        "people": 3868159.0,
        "kwhPerPerson": 212.0,
        "generationFlag": None,
        "populationFlag": None,
    }
    assert solar_capita.parse(published) == document


def test_a_country_without_both_figures_stops_the_run(
    generation: dict[str, Any], population: dict[str, Any]
) -> None:
    # Serbia is the last country of the answer, 2024 its last year: without it no year is shared by all
    del generation["value"][str(len(generation["value"]) - 1)]
    document = solar_capita.solar_capita_document(generation, population, NOW)
    assert document.year == 2023
    for position in list(generation["value"]):
        if int(position) >= 28:
            del generation["value"][position]
    with pytest.raises(EurostatDataError, match="RS has no year"):
        solar_capita.solar_capita_document(generation, population, NOW)


def test_another_unit_an_error_or_an_implausible_figure_is_refused(
    generation: dict[str, Any], population: dict[str, Any]
) -> None:
    other = copy.deepcopy(generation)
    other["dimension"]["unit"]["category"]["index"] = {"TJ": 0}
    with pytest.raises(EurostatSourceError, match="unexpected unit"):
        solar_capita.solar_capita_document(other, population, NOW)
    with pytest.raises(EurostatSourceError, match="error"):
        solar_capita.solar_capita_document({"error": [{"status": 400}]}, population, NOW)
    # a population in thousands instead of people
    small = copy.deepcopy(population)
    small["value"] = {position: value / 1000 for position, value in small["value"].items()}
    with pytest.raises(EurostatDataError, match="people"):
        solar_capita.solar_capita_document(generation, small, NOW)
    tampered = solar_capita.dump(solar_capita.solar_capita_document(generation, population, NOW))
    tampered["countries"]["HR"][-1]["kwhPerPerson"] = 400.0
    with pytest.raises(EurostatDataError, match=r"is not 820.0 GWh"):
        solar_capita.parse(tampered)


def test_publishes_and_refuses_a_year_that_went_back(
    generation: dict[str, Any], population: dict[str, Any], tmp_path: Path
) -> None:
    store = publish.DirectoryStore(tmp_path)
    document = solar_capita.solar_capita_document(generation, population, NOW)
    solar_capita.publish_solar_capita(store, document)
    raw = store.get_bytes(solar_capita.KEY)
    assert raw is not None and json.loads(raw)["year"] == 2024
    del generation["value"][str(len(generation["value"]) - 1)]
    older = solar_capita.solar_capita_document(generation, population, NOW)
    with pytest.raises(EurostatDataError, match="went back from 2024 to 2023"):
        solar_capita.publish_solar_capita(store, older)
    kept = store.get_bytes(solar_capita.KEY)
    assert kept is not None and json.loads(kept)["year"] == 2024


def test_cli_fetches_both_datasets_and_publishes(
    generation: dict[str, Any],
    population: dict[str, Any],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    asked: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        asked.append(request)
        dataset = request.url.path.rsplit("/", 1)[-1]
        assert request.url.params["sinceTimePeriod"] == "2015"
        assert request.url.params.get_list("geo") == list(solar_capita.GEOS)
        if dataset == "nrg_bal_peh":
            assert request.url.params["siec"] == "RA420" and request.url.params["nrg_bal"] == "GEP"
            return httpx.Response(200, json=generation)
        assert dataset == "demo_gind" and request.url.params["indic_de"] == "AVG"
        return httpx.Response(200, json=population)

    monkeypatch.setattr(cli, "make_client", lambda: httpx.Client(transport=httpx.MockTransport(handle)))
    data, out = tmp_path / "data", tmp_path / "out"
    assert cli.main(["eurostat", "solar-fetch", "--data-dir", str(data)]) == 0
    assert len(asked) == 2
    summary = json.loads(capsys.readouterr().out)
    assert summary["year"] == 2024 and summary["kwhPerPerson"]["HR"] == 212.0
    assert cli.main(["eurostat", "solar-publish-dir", "--data-dir", str(data), "--out", str(out)]) == 0
    assert (
        json.loads((out / "eurostat" / "solarcapita.json").read_text())["countries"]["RS"][-1]["gwh"]
        == 162.68
    )
