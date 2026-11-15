"""Fetch daily energy for countries and keep the local yearly files up to date."""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Protocol

from energymap.entsoe.client import AREAS, ITALY_ZONES, NoData
from energymap.entsoe.energy import (
    TIMEZONE,
    DailyEnergy,
    combine_areas,
    daily_generation,
    daily_load,
    local_years,
)
from energymap.entsoe.parse import Series
from energymap.entsoe.store import YearFile, periods
from energymap.files import read_json, write_json_atomic

log = logging.getLogger(__name__)

# Countries whose data may be published per bidding zone only (see tasks/todo.md, Faza 3).
ZONE_FALLBACK: dict[str, tuple[str, ...]] = {"IT": ITALY_ZONES}

Query = Callable[[str, datetime, datetime], list[Series]]


class EnergySource(Protocol):
    """What the fetcher needs from a client (EntsoeClient, or a stand-in in tests)."""

    def generation(self, area: str, start: datetime, end: datetime) -> list[Series]: ...
    def load(self, area: str, start: datetime, end: datetime) -> list[Series]: ...


@dataclass(frozen=True, slots=True)
class Fetched:
    energy: DailyEnergy
    areas: tuple[str, ...]


def _one_kind(
    code: str, query: Query, to_daily: Callable[[list[Series]], DailyEnergy], start: datetime, end: datetime
) -> tuple[DailyEnergy, tuple[str, ...]]:
    try:
        return to_daily(query(AREAS[code], start, end)), (AREAS[code],)
    except NoData:
        pass  # an empty country-level answer: try the country's zones, if it has any
    zones = ZONE_FALLBACK.get(code, ())
    if not zones:
        return DailyEnergy(), ()
    parts = []
    used = []
    for zone in zones:
        try:
            parts.append(to_daily(query(zone, start, end)))
            used.append(zone)
        except NoData:
            parts.append(DailyEnergy())  # counts as 0 % coverage in combine_areas
    if not used:
        return DailyEnergy(), ()
    # A national total is stored only for days on which every zone reported (combine_areas takes the
    # minimum coverage); a partial sum would look like a real drop in generation.
    log.info("country data assembled from zones", extra={"country": code, "zones": used})
    return combine_areas(parts), tuple(used)


def fetch_window(client: EnergySource, code: str, start: datetime, end: datetime) -> Fetched:
    generation, gen_areas = _one_kind(code, client.generation, daily_generation, start, end)
    load, load_areas = _one_kind(code, client.load, daily_load, start, end)
    generation.load.update(load.load)
    generation.load_coverage.update(load.load_coverage)
    if generation.unknown_psr:
        log.warning(
            "unknown production types", extra={"country": code, "codes": dict(generation.unknown_psr)}
        )
    return Fetched(generation, tuple(sorted(set(gen_areas) | set(load_areas))))


def daily_path(root: Path, year: int) -> Path:
    return root / "daily" / f"{year}.json"


def load_year(root: Path, year: int) -> YearFile:
    path = daily_path(root, year)
    return YearFile.from_json(read_json(path)) if path.exists() else YearFile(year)


def update(
    client: EnergySource,
    root: Path,
    countries: Sequence[str],
    start: datetime,
    end: datetime,
) -> dict[int, int]:
    """Fetch [start, end) for each country, merge into the yearly files, rewrite periods.json.

    Returns changed days per year. Requests are aligned to local calendar years.
    """
    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("start and end must be timezone-aware")
    unknown = [c for c in countries if c not in AREAS]
    if unknown:
        raise ValueError(f"no ENTSO-E area for {', '.join(unknown)}")
    local_start, local_end = start.astimezone(TIMEZONE), end.astimezone(TIMEZONE)
    changed: dict[int, int] = {}
    for year_start, year_end in local_years(local_start.year, local_end.year, local_end):
        window = (max(year_start, local_start), min(year_end, local_end))
        if window[0] >= window[1]:
            continue
        year = window[0].year
        yearly = load_year(root, year)
        for code in countries:
            fetched = fetch_window(client, code, *window)
            changed[year] = changed.get(year, 0) + yearly.merge(code, fetched.energy, fetched.areas)
        write_json_atomic(daily_path(root, year), yearly.to_json())
        log.info("energy year updated", extra={"year": year, "changed_days": changed[year]})
    write_periods(root)
    return changed


def write_periods(root: Path) -> Path:
    files = sorted((root / "daily").glob("*.json")) if (root / "daily").exists() else []
    years = [YearFile.from_json(read_json(path)) for path in files]
    target = root / "periods.json"
    write_json_atomic(target, periods(years))
    return target
