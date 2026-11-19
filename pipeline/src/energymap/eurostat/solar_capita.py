"""Solar electricity per inhabitant, by country and year (Faza 46): a calculation from two official figures.

Eurostat publishes how much electricity a country's photovoltaic plants made in a year (``nrg_bal_peh``,
``nrg_bal=GEP`` gross electricity production, ``siec=RA420`` solar photovoltaic, GWh) and how many people
lived there on average that year (``demo_gind``, ``indic_de=AVG``). The one divided by the other is the
kilowatt-hours of solar electricity per inhabitant: not a figure Eurostat publishes, so it is always shown
as a calculation, with both of its parts next to it.

Both come from one office under one method, for all eight countries, which is what makes the countries
comparable; national reports differ in what they count (rooftop plants are in some and not in others).
The average population is used rather than the one on 1 January (``demo_pjan``), which has nothing for
Bosnia and Herzegovina; its average population is marked provisional there, and the mark is kept.

Checked against the live API on 2026-11-19: 2024 is the latest year of production for all eight (dataset
updated 2026-06-02); Croatia 820.0 GWh and 3,868,159 people, 212.0 kWh per inhabitant.

Licence: CC BY 4.0, source acknowledged with the links of both datasets.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from energymap.config import COUNTRIES
from energymap.eurostat.renewables import (
    LICENSE,
    SOURCE,
    EurostatDataError,
    EurostatSourceError,
    _error_text,
    _updated,
    _year,
    cells,
)
from energymap.publish import ObjectMeta, ObjectStore

log = logging.getLogger(__name__)

API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"
BROWSER = "https://ec.europa.eu/eurostat/databrowser/view"
GENERATION = "nrg_bal_peh"
POPULATION = "demo_gind"
VERSION = 1
KEY = "eurostat/solarcapita.json"
META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")

#: photovoltaic plants' gross electricity production, in gigawatt-hours, yearly
GENERATION_FIXED = {"freq": "A", "nrg_bal": "GEP", "siec": "RA420", "unit": "GWH"}
#: the average population of the year
POPULATION_FIXED = {"freq": "A", "indic_de": "AVG"}
GEOS: tuple[str, ...] = tuple(country.code for country in COUNTRIES)
#: the years asked for: enough to see the growth, and no year in which a zero could mean "not reported"
SINCE = 2015
#: more than any country of the map makes from the sun in a year (Italy: about 36,000 GWh in 2024)
MAX_GWH = 500_000.0
#: between the smallest country of the map and well above the largest
MIN_PEOPLE, MAX_PEOPLE = 100_000.0, 100_000_000.0

_CONFIG = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)


class Dataset(BaseModel):
    model_config = _CONFIG

    dataset: str
    url: str
    #: Eurostat's last update of the dataset; None when the answer did not say
    updated: str | None


class Year(BaseModel):
    """One country's year: the two official figures and what they give."""

    model_config = _CONFIG

    year: int
    gwh: float = Field(ge=0, le=MAX_GWH)
    people: float = Field(ge=MIN_PEOPLE, le=MAX_PEOPLE)
    #: gwh times 1,000,000 over people, to one decimal
    kwh_per_person: float = Field(ge=0)
    #: Eurostat's flag on either figure ("p" provisional, "e" estimated …); None when neither has one
    generation_flag: str | None
    population_flag: str | None

    @model_validator(mode="after")
    def _is_the_division(self) -> Year:
        if abs(self.kwh_per_person - per_person(self.gwh, self.people)) > 0.05:
            raise ValueError(f"{self.year}: {self.kwh_per_person} is not {self.gwh} GWh over {self.people}")
        return self


class SolarCapita(BaseModel):
    model_config = _CONFIG

    version: Literal[1]
    source: str
    license: str
    generation: Dataset
    population: Dataset
    retrieved_at: str
    #: the latest year every country has both figures for: the year the countries are compared in
    year: int
    #: per country, its years with both figures, ascending
    countries: dict[str, list[Year]]
    flag_labels: dict[str, str]

    @model_validator(mode="after")
    def _every_country_has_the_year(self) -> SolarCapita:
        if set(self.countries) != set(GEOS):
            raise ValueError(f"countries must be exactly {', '.join(GEOS)}")
        for geo, years in self.countries.items():
            listed = [each.year for each in years]
            if listed != sorted(set(listed)):
                raise ValueError(f"{geo}: years must ascend")
            if self.year not in listed:
                raise ValueError(f"{geo} has no figures for {self.year}")
        return self


def per_person(gwh: float, people: float) -> float:
    """Kilowatt-hours per inhabitant, to one decimal."""
    return round(gwh * 1_000_000 / people, 1)


def _query(fixed: dict[str, str]) -> tuple[tuple[str, str], ...]:
    return (
        ("format", "JSON"),
        ("lang", "EN"),
        ("sinceTimePeriod", str(SINCE)),
        *fixed.items(),
        *(("geo", code) for code in GEOS),
    )


def fetch(client: httpx.Client, dataset: str, fixed: dict[str, str]) -> dict[str, Any]:
    response = client.get(
        f"{API}/{dataset}", params=_query(fixed), headers={"Accept": "application/json"}, timeout=60
    )
    try:
        body: object = response.json()
    except json.JSONDecodeError:
        body = None
    if response.status_code != 200:
        raise EurostatSourceError(
            f"{dataset}: HTTP {response.status_code}: {_error_text(body) or 'no error details'}"
        )
    if not isinstance(body, dict):
        raise EurostatSourceError(f"{dataset}: the answer is not a JSON object")
    return body


def _table(
    answer: dict[str, Any], fixed: dict[str, str], dataset: str
) -> tuple[dict[str, dict[int, float]], dict[str, dict[int, str]]]:
    """Country → year → value, and the flags the same way, of the cells the request asked for."""
    values: dict[str, dict[int, float]] = {}
    flags: dict[str, dict[int, str]] = {}
    for cell in cells(answer):
        for name, code in fixed.items():
            if cell.codes.get(name) != code:
                raise EurostatSourceError(f"{dataset}: unexpected {name}={cell.codes.get(name)!r}")
        geo = cell.codes.get("geo", "")
        if geo not in GEOS or cell.value is None:
            continue
        year = _year(cell.codes.get("time", ""))
        values.setdefault(geo, {})[year] = cell.value
        if cell.flag:
            flags.setdefault(geo, {})[year] = cell.flag
    return values, flags


def _flag_labels(answers: tuple[dict[str, Any], ...], used: set[str]) -> dict[str, str]:
    found: dict[str, str] = {}
    for answer in answers:
        extension = answer.get("extension")
        status = extension.get("status") if isinstance(extension, dict) else None
        labels = status.get("label") if isinstance(status, dict) else None
        if isinstance(labels, dict):
            found.update({flag: str(labels[flag]) for flag in used if isinstance(labels.get(flag), str)})
    return dict(sorted(found.items()))


def solar_capita_document(
    generation: dict[str, Any], population: dict[str, Any], now: datetime
) -> SolarCapita:
    """Both answers joined: per country, every year that has both figures, and the year all share."""
    made, made_flags = _table(generation, GENERATION_FIXED, GENERATION)
    people, people_flags = _table(population, POPULATION_FIXED, POPULATION)
    countries: dict[str, list[Year]] = {}
    for geo in GEOS:
        both = sorted(made.get(geo, {}).keys() & people.get(geo, {}).keys())
        if not both:
            raise EurostatDataError(f"{geo} has no year with both solar production and population")
        try:
            countries[geo] = [
                Year(
                    year=year,
                    gwh=made[geo][year],
                    people=people[geo][year],
                    kwh_per_person=per_person(made[geo][year], people[geo][year]),
                    generation_flag=made_flags.get(geo, {}).get(year),
                    population_flag=people_flags.get(geo, {}).get(year),
                )
                for year in both
            ]
        except ValueError as exc:
            raise EurostatDataError(f"{geo}: {exc}") from exc
    shared = set.intersection(*({each.year for each in years} for years in countries.values()))
    if not shared:
        raise EurostatDataError("no year has both figures for every country")
    used = {
        flag
        for years in countries.values()
        for each in years
        for flag in (each.generation_flag, each.population_flag)
        if flag
    }
    try:
        return SolarCapita(
            version=VERSION,
            source=SOURCE,
            license=LICENSE,
            generation=Dataset(
                dataset=GENERATION,
                url=f"{BROWSER}/{GENERATION}/default/table",
                updated=_updated(generation),
            ),
            population=Dataset(
                dataset=POPULATION,
                url=f"{BROWSER}/{POPULATION}/default/table",
                updated=_updated(population),
            ),
            retrieved_at=now.isoformat(),
            year=max(shared),
            countries=countries,
            flag_labels=_flag_labels((generation, population), used),
        )
    except ValueError as exc:
        raise EurostatDataError(str(exc)) from exc


def collect(client: httpx.Client, now: datetime) -> SolarCapita:
    return solar_capita_document(
        fetch(client, GENERATION, GENERATION_FIXED), fetch(client, POPULATION, POPULATION_FIXED), now
    )


def parse(raw: Any) -> SolarCapita:
    """A document read back from disk or the bucket, checked as strictly as one just collected."""
    try:
        return SolarCapita.model_validate(raw)
    except ValueError as exc:
        raise EurostatDataError(f"not a solar-per-inhabitant document: {exc}") from exc


def dump(document: SolarCapita) -> dict[str, Any]:
    return document.model_dump(mode="json", by_alias=True)


def publish_solar_capita(store: ObjectStore, document: SolarCapita) -> None:
    """Replace the published document, unless its year of comparison went back.

    An older year than the published one is a truncated answer, not a revision: refused, and the published
    document stays. The bucket decides (L-015).
    """
    raw = store.get_bytes(KEY)
    if raw is not None:
        try:
            published = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise EurostatDataError(f"the published {KEY} is not JSON ({exc})") from exc
        before = published.get("year") if isinstance(published, dict) else None
        if isinstance(before, int) and document.year < before:
            raise EurostatDataError(
                f"the year of comparison went back from {before} to {document.year}; not published"
            )
    store.put_bytes(KEY, json.dumps(dump(document), separators=(",", ":")).encode(), META)
    log.info("published solar electricity per inhabitant", extra={"year": document.year})
