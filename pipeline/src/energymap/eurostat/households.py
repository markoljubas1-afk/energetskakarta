"""Electricity used by households, by country and year (Eurostat, ``nrg_d_hhq``), for the "what does a
megawatt mean" comparison in the map's green card.

Eurostat publishes how much electricity (``siec=E7000``) all households of a country used in a year
(``nrg_bal=FC_OTH_HH_E``, final consumption of households), in GWh. Divided by the hours of that year it is
the average power all households of the country draw together: a real, official yardstick to hold a
generation figure against, with no assumption about an "average appliance" or an "average home". Nothing here
divides by a number of households: Eurostat's household counts come from another survey with other years.

The answer is JSON-stat 2.0, read by ``renewables.cells``. Licence: CC BY 4.0, source acknowledged with the
dataset's link.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

import httpx

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

DATASET = "nrg_d_hhq"
API_URL = f"https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{DATASET}"
SOURCE_URL = f"https://ec.europa.eu/eurostat/databrowser/view/{DATASET}/default/table"
VERSION = 1
UNIT = "GWh"
KEY = "eurostat/households.json"
META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")

#: electricity, used by households, in gigawatt-hours, yearly
FIXED = {"freq": "A", "siec": "E7000", "nrg_bal": "FC_OTH_HH_E", "unit": "GWH"}
GEOS: tuple[str, ...] = tuple(country.code for country in COUNTRIES)
HOME = "HR"
#: Croatia has data from the 1990s; far fewer years means a broken answer, not a short series
MIN_YEARS = 10
#: more than any country of the map could use in a year (Italy's households use about 65,000 GWh)
MAX_GWH = 500_000.0


def query() -> tuple[tuple[str, str], ...]:
    return (("format", "JSON"), ("lang", "EN"), *FIXED.items(), *(("geo", code) for code in GEOS))


def households_document(answer: object, now: datetime) -> dict[str, Any]:
    """Yearly consumption by country, as arrays aligned with ``years`` (``None`` where Eurostat has none)."""
    if not isinstance(answer, dict):
        raise EurostatSourceError("the answer is not a JSON object")
    table: dict[str, dict[int, float]] = {}
    years: set[int] = set()
    for cell in cells(answer):
        for name, code in FIXED.items():
            if cell.codes.get(name) != code:
                raise EurostatSourceError(f"unexpected {name}={cell.codes.get(name)!r} in the answer")
        geo = cell.codes.get("geo", "")
        # Eurostat writes 0 for years a country did not report (Hungary before 2000): the households of a
        # country never used no electricity in a year, so a zero is a gap, not a figure
        if geo not in GEOS or cell.value is None or cell.value == 0:
            continue
        year = _year(cell.codes.get("time", ""))
        table.setdefault(geo, {})[year] = cell.value
        years.add(year)
    if not years:
        raise EurostatSourceError("the answer has no values for the countries asked for")
    span = list(range(min(years), max(years) + 1))
    return {
        "version": VERSION,
        "dataset": DATASET,
        "source": SOURCE,
        "sourceUrl": SOURCE_URL,
        "license": LICENSE,
        "unit": UNIT,
        "updated": _updated(answer),
        "retrievedAt": now.isoformat(),
        "years": span,
        "series": {geo: [table[geo].get(year) for year in span] for geo in GEOS if geo in table},
        "missing": [geo for geo in GEOS if geo not in table],
    }


def fetch(client: httpx.Client) -> object:
    response = client.get(API_URL, params=query(), headers={"Accept": "application/json"}, timeout=60)
    try:
        body: object = response.json()
    except json.JSONDecodeError:
        body = None
    if response.status_code != 200:
        raise EurostatSourceError(f"HTTP {response.status_code}: {_error_text(body) or 'no error details'}")
    if body is None:
        raise EurostatSourceError("the answer is not JSON")
    return body


def collect(client: httpx.Client, now: datetime) -> dict[str, Any]:
    document = households_document(fetch(client), now)
    if document["missing"]:
        log.warning("countries without household consumption", extra={"missing": document["missing"]})
    return document


def last_year(document: dict[str, Any], geo: str = HOME) -> int | None:
    values = document.get("series", {}).get(geo)
    years = document.get("years")
    if not isinstance(values, list) or not isinstance(years, list):
        return None
    present = [year for year, value in zip(years, values, strict=False) if value is not None]
    return max(present) if present else None


def validate(document: dict[str, Any]) -> None:
    if (
        document.get("version") != VERSION
        or document.get("dataset") != DATASET
        or document.get("unit") != UNIT
    ):
        raise EurostatDataError(f"document must be version {VERSION} of {DATASET} in {UNIT}")
    years, series = document.get("years"), document.get("series")
    if not isinstance(years, list) or not isinstance(series, dict) or years != sorted(set(years)):
        raise EurostatDataError("the document needs ascending years and a series per country")
    for geo, values in series.items():
        if not isinstance(values, list) or len(values) != len(years):
            raise EurostatDataError(f"{geo} does not have one value per year")
        for value in values:
            if value is not None and not 0 < value <= MAX_GWH:
                raise EurostatDataError(f"{geo}: {value} GWh is not a plausible yearly consumption")
    home = [value for value in series.get(HOME, []) if value is not None]
    if len(home) < MIN_YEARS:
        raise EurostatDataError(f"{HOME} has {len(home)} years of data, expected at least {MIN_YEARS}")


def publish_households(store: ObjectStore, document: dict[str, Any]) -> None:
    """Validate, then replace the published document. A failed validation leaves the old one.

    A document whose latest year for Croatia is older than the published one is a truncated answer, not a
    revision, and is refused; the bucket decides (L-015).
    """
    validate(document)
    raw = store.get_bytes(KEY)
    if raw is not None:
        try:
            published = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise EurostatDataError(f"the published {KEY} is not JSON ({exc})") from exc
        before, after = last_year(published), last_year(document)
        if before is not None and (after is None or after < before):
            raise EurostatDataError(f"{HOME}'s latest year went back from {before} to {after}; not published")
    store.put_bytes(KEY, json.dumps(document, separators=(",", ":")).encode(), META)
    log.info("published household consumption", extra={"lastYear": last_year(document)})
