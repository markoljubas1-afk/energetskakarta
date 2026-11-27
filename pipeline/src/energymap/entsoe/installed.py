"""Installed generation capacity per production type (ENTSO-E A68), by country and year, for the site.

The survey (``capacity.py``, 2026-11-27) showed what the platform has: every country of the map from 2015
(Bosnia and Herzegovina from 2017), published for the year ahead (process type A33), so a December run
already finds the next year for some countries and not yet for others. Italy publishes on the country's
area only (its bidding zones came back empty), so each country's own area is asked, every year from 2015
to the next.

A year's figure is the capacity at the start of that year. The production types are joined into the map's
technologies (``PSR_TECHNOLOGY``: run-of-river and reservoir are both hydro); a type reported with 0 MW is
not a source the country has and is left out. Slovenia's nuclear line is the whole of Krško (700 MW); half
of it is Croatia's by treaty, which the pages say where they show it.

The document is published only when it is whole: any failed request fails the fetch, every country has at
least one year, a country's latest total is not less than half of the year before, and against the published
document no country lost a year (``--allow-drop`` accepts that). Licence: the platform's terms of use, source
acknowledged (as for the generation data).
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Iterable
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from energymap.entsoe.capacity import FIRST_YEAR, PER_TYPE, YEAR_AHEAD, parse_capacity, year_window
from energymap.entsoe.client import AREAS, EntsoeClient, NoData
from energymap.entsoe.energy import PSR_TECHNOLOGY
from energymap.publish import ObjectMeta, ObjectStore
from energymap.schema import Technology

log = logging.getLogger(__name__)

VERSION = 1
KEY = "energy/capacity.json"
# changes about once a year; an hour in caches is nothing
META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")
SOURCE = "ENTSO-E Transparency Platform"
SOURCE_URL = "https://transparency.entsoe.eu/"
LICENSE = "ENTSO-E Transparency Platform terms of use"
#: a country's latest total below this share of the year before is a broken answer, not a closure
MIN_KEPT = 0.5

_CONFIG = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)


class InstalledDataError(ValueError):
    """The installed capacity document is not publishable."""


class Year(BaseModel):
    """One country's year: MW per technology at its start, and their sum."""

    model_config = _CONFIG

    year: int
    total: float = Field(gt=0)
    mw: dict[Technology, float]

    @model_validator(mode="after")
    def _total_is_the_sum(self) -> Year:
        if any(value <= 0 for value in self.mw.values()):
            raise ValueError(f"{self.year}: every technology listed must have capacity")
        if abs(self.total - round(sum(self.mw.values()), 1)) > 0.05:
            raise ValueError(f"{self.year}: total {self.total} is not the sum of the technologies")
        return self


class Installed(BaseModel):
    model_config = _CONFIG

    version: Literal[1]
    source: str
    source_url: str
    license: str
    document_type: Literal["A68"]
    retrieved_at: str
    #: the latest year every country has: the year the countries are compared in
    year: int
    #: per country, its years ascending
    countries: dict[str, list[Year]]
    #: of the countries and their years only, so a run that found the same figures changes nothing
    content_hash: str

    @model_validator(mode="after")
    def _whole(self) -> Installed:
        if not self.countries:
            raise ValueError("no country")
        for code, years in self.countries.items():
            if code not in AREAS:
                raise ValueError(f"{code} is not a country of the map")
            listed = [each.year for each in years]
            if not listed:
                raise ValueError(f"{code} has no year")
            if listed != sorted(set(listed)):
                raise ValueError(f"{code}: years must ascend")
            if len(years) > 1 and years[-1].total < MIN_KEPT * years[-2].total:
                raise ValueError(
                    f"{code}: the total fell from {years[-2].total:g} MW in {years[-2].year} "
                    f"to {years[-1].total:g} MW in {years[-1].year}"
                )
        shared = set.intersection(*({each.year for each in years} for years in self.countries.values()))
        if not shared or self.year != max(shared):
            raise ValueError(f"year {self.year} is not the latest year every country has")
        if self.content_hash != content_hash(self.countries):
            raise ValueError("contentHash does not match the content")
        return self


def content_hash(countries: dict[str, list[Year]]) -> str:
    canonical = json.dumps(
        {code: [each.model_dump(mode="json") for each in years] for code, years in countries.items()},
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _year_of(client: EntsoeClient, country: str, year: int) -> Year | None:
    """The country's capacity at the start of the year, per technology; None when the platform has none."""
    start, end = year_window(year)
    try:
        body = client.raw(
            {"documentType": PER_TYPE, "processType": YEAR_AHEAD, "in_Domain": AREAS[country]}, start, end
        )
    except NoData:
        return None
    by_tech: dict[Technology, float] = {}
    for row in parse_capacity(body):
        if row.year != year or row.mw <= 0:
            continue
        tech = PSR_TECHNOLOGY.get(row.psr_type or "")
        if tech is None:
            raise InstalledDataError(f"{country} {year}: unknown production type {row.psr_type}")
        by_tech[tech] = by_tech.get(tech, 0.0) + row.mw
    if not by_tech:
        return None
    mw = {tech: round(value, 1) for tech, value in sorted(by_tech.items())}
    return Year(year=year, total=round(sum(mw.values()), 1), mw=mw)


def collect(client: EntsoeClient, now: datetime, countries: Iterable[str]) -> Installed:
    """Every country's years from FIRST_YEAR to the next one. A failed request raises: nothing is half
    fetched."""
    found: dict[str, list[Year]] = {}
    for country in countries:
        years = [
            each
            for year in range(FIRST_YEAR, now.year + 2)
            if (each := _year_of(client, country, year)) is not None
        ]
        if not years:
            raise InstalledDataError(f"{country} has no year of installed capacity")
        found[country] = years
        log.info(
            "installed capacity", extra={"country": country, "first": years[0].year, "last": years[-1].year}
        )
    shared = set.intersection(*({each.year for each in years} for years in found.values()))
    if not shared:
        raise InstalledDataError("no year is published for every country")
    try:
        return Installed(
            version=VERSION,
            source=SOURCE,
            source_url=SOURCE_URL,
            license=LICENSE,
            document_type=PER_TYPE,
            retrieved_at=now.isoformat(),
            year=max(shared),
            countries=found,
            content_hash=content_hash(found),
        )
    except ValueError as exc:
        raise InstalledDataError(str(exc)) from exc


def parse(raw: Any) -> Installed:
    """A document read back from disk or the bucket, checked as strictly as one just collected."""
    try:
        return Installed.model_validate(raw)
    except ValueError as exc:
        raise InstalledDataError(f"not an installed capacity document: {exc}") from exc


def dump(document: Installed) -> dict[str, Any]:
    return document.model_dump(mode="json", by_alias=True)


def losses(published: Installed, document: Installed) -> list[str]:
    """Every published country and year the new document no longer has."""
    lost: list[str] = []
    for code, years in published.countries.items():
        have = {each.year for each in document.countries.get(code, [])}
        lost += [f"{code} {each.year}" for each in years if each.year not in have]
    return lost


def publish_installed(store: ObjectStore, document: Installed, *, allow_drop: bool = False) -> bool:
    """Replace the published document; ``False`` when its content is unchanged.

    A document that lost a published country or year (a truncated answer, not a revision) is refused unless
    ``allow_drop``, and the published one stays. The bucket decides (L-015).
    """
    raw = store.get_bytes(KEY)
    if raw is not None:
        try:
            published = parse(json.loads(raw))
        except json.JSONDecodeError as exc:
            raise InstalledDataError(f"the published {KEY} is not JSON ({exc})") from exc
        lost = losses(published, document)
        if lost and not allow_drop:
            shown = ", ".join(lost[:6]) + ("…" if len(lost) > 6 else "")
            raise InstalledDataError(
                f"{len(lost)} published years are missing ({shown}); use --allow-drop if that is right"
            )
        if published.content_hash == document.content_hash:
            log.info("installed capacity unchanged", extra={"year": document.year})
            return False
    store.put_bytes(KEY, json.dumps(dump(document), separators=(",", ":")).encode(), META)
    log.info(
        "published installed capacity",
        extra={"year": document.year, "countries": {c: y[-1].year for c, y in document.countries.items()}},
    )
    return True
