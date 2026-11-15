"""From inventory rows to one ``CityEnergy`` per city.

A city may have several inventories (a baseline and later monitoring ones). The record shows the most
recent one; when that is a monitoring inventory, the baseline year and its electricity ride along so
the change can be shown. Nothing is estimated: a sector a city did not report is absent.
"""

from __future__ import annotations

import logging
import math
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from energymap.schema import CityEnergy, Provenance, Sector, SectorEnergy

from .read import BASE_URL

log = logging.getLogger(__name__)

#: keyword → sector, checked in order against the lower-cased sector text
SECTOR_RULES: tuple[tuple[str, Sector], ...] = (
    ("municipal build", Sector.MUNICIPAL_BUILDINGS),
    ("municipal fleet", Sector.MUNICIPAL_FLEET),
    ("public light", Sector.PUBLIC_LIGHTING),
    ("street light", Sector.PUBLIC_LIGHTING),
    ("public transport", Sector.PUBLIC_TRANSPORT),
    ("tertiary", Sector.TERTIARY),
    ("residential", Sector.RESIDENTIAL),
    ("industr", Sector.INDUSTRY),
    ("private", Sector.PRIVATE_TRANSPORT),
    ("commercial transport", Sector.PRIVATE_TRANSPORT),
)
#: activity_reporting_unit → factor to MWh
UNIT_FACTORS: dict[str, float] = {
    "mwh": 1.0,
    "mwh/year": 1.0,
    "mwh/y": 1.0,
    "gwh": 1000.0,
    "gwh/year": 1000.0,
}
TRUE_WORDS = frozenset({"yes", "y", "true", "1", "baseline", "bei"})
#: alpha-3 codes the file may use for the scope countries
ALPHA3: dict[str, str] = {
    "HRV": "HR",
    "SVN": "SI",
    "HUN": "HU",
    "SRB": "RS",
    "BIH": "BA",
    "MNE": "ME",
    "ITA": "IT",
    "AUT": "AT",
}


def sector_of(text: Any) -> Sector:
    lowered = str(text or "").casefold()
    for needle, sector in SECTOR_RULES:
        if needle in lowered:
            return sector
    return Sector.OTHER


def is_electricity(carrier: Any) -> bool:
    return "electric" in str(carrier or "").casefold()


def is_true(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().casefold() in TRUE_WORDS


def country_code(value: Any) -> str | None:
    text = str(value or "").strip().upper()
    if len(text) == 2:
        return text
    return ALPHA3.get(text)


def to_mwh(energy: Any, unit: Any) -> float | None:
    """The row's energy in MWh, or None when the number or the unit cannot be trusted."""
    try:
        value = float(energy)
    except (TypeError, ValueError):
        return None
    if math.isnan(value) or value < 0:
        return None
    factor = UNIT_FACTORS.get(str(unit or "mwh").strip().casefold())
    return None if factor is None else value * factor


@dataclass(slots=True)
class Inventory:
    organisation_id: str
    year: int
    baseline: bool
    monitoring: bool
    population: int | None
    sectors: dict[Sector, SectorEnergy]


@dataclass(frozen=True, slots=True)
class Signatory:
    organisation_id: str
    name: str
    country: str
    lon: float
    lat: float
    population: int | None


def signatories(
    rows: Iterable[Mapping[str, Any]], scope: frozenset[str], stats: Counter[str]
) -> dict[str, Signatory]:
    result: dict[str, Signatory] = {}
    for row in rows:
        stats["signatory_rows"] += 1
        code = country_code(row.get("country"))
        if code is None or code not in scope:
            stats["signatories_outside_scope"] += 1
            continue
        try:
            lon = float(row["lon"])
            lat = float(row["lat"])
        except (TypeError, ValueError, KeyError):
            stats["signatories_without_location"] += 1
            continue
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            stats["signatories_without_location"] += 1
            continue
        organisation_id = str(row.get("organisation_id") or "").strip()
        name = str(row.get("name") or "").strip()
        if not organisation_id or not name:
            stats["signatories_without_id"] += 1
            continue
        result[organisation_id] = Signatory(
            organisation_id, name, code, lon, lat, _population(row.get("population"))
        )
    return result


def _population(value: Any) -> int | None:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _year(value: Any) -> int | None:
    try:
        year = int(float(value))
    except (TypeError, ValueError):
        return None
    return year if 1990 <= year <= 2100 else None


def inventories(
    rows: Iterable[Mapping[str, Any]],
    links: Mapping[str, str],
    *,
    monitoring: bool,
    stats: Counter[str],
) -> list[Inventory]:
    """Group sector-by-carrier rows into inventories. ``links`` maps plan/report ids to organisation ids
    for files whose inventory sheet lacks the organisation id."""
    grouped: dict[tuple[str, str, int, bool], Inventory] = {}
    kind = "monitoring" if monitoring else "plan"
    for row in rows:
        stats[f"{kind}_rows"] += 1
        plan_id = str(row.get("plan_id") or "").strip()
        organisation_id = str(row.get("organisation_id") or "").strip() or links.get(plan_id, "")
        year = _year(row.get("year"))
        mwh = to_mwh(row.get("energy"), row.get("unit"))
        if not organisation_id or year is None:
            stats[f"{kind}_rows_unlinked"] += 1
            continue
        if mwh is None:
            stats[f"{kind}_rows_unusable"] += 1
            continue
        inventory_id = str(row.get("inventory_id") or plan_id)
        baseline = is_true(row.get("baseline")) if not monitoring else False
        key = (organisation_id, inventory_id, year, baseline)
        inventory = grouped.get(key)
        if inventory is None:
            inventory = Inventory(
                organisation_id, year, baseline, monitoring, _population(row.get("population")), {}
            )
            grouped[key] = inventory
        sector = sector_of(row.get("sector"))
        if sector is Sector.OTHER:
            stats["rows_in_other_sector"] += 1
        current = inventory.sectors.get(sector, SectorEnergy(electricity_mwh=0.0, total_mwh=0.0))
        electricity = current.electricity_mwh + (mwh if is_electricity(row.get("carrier")) else 0.0)
        inventory.sectors[sector] = SectorEnergy(
            electricity_mwh=electricity, total_mwh=current.total_mwh + mwh
        )
    return list(grouped.values())


def links(rows: Iterable[Mapping[str, Any]]) -> dict[str, str]:
    return {
        str(row["plan_id"]).strip(): str(row["organisation_id"]).strip()
        for row in rows
        if row.get("plan_id") not in (None, "") and row.get("organisation_id") not in (None, "")
    }


def _pick(inventories_of_city: list[Inventory]) -> tuple[Inventory, Inventory | None]:
    """The inventory to show (latest year; a monitoring one wins a tie) and the baseline, if another."""
    shown = max(
        inventories_of_city,
        key=lambda inv: (inv.year, inv.monitoring, sum(s.total_mwh for s in inv.sectors.values())),
    )
    baselines = [inv for inv in inventories_of_city if inv.baseline and inv is not shown]
    baseline = min(baselines, key=lambda inv: inv.year) if baselines else None
    return shown, baseline


def build_cities(
    signatories_by_id: Mapping[str, Signatory],
    all_inventories: Iterable[Inventory],
    *,
    release: str,
    retrieved_at: datetime,
    stats: Counter[str],
) -> list[CityEnergy]:
    by_city: dict[str, list[Inventory]] = defaultdict(list)
    for inventory in all_inventories:
        if inventory.sectors:
            by_city[inventory.organisation_id].append(inventory)
    result: list[CityEnergy] = []
    for organisation_id, city_inventories in sorted(by_city.items()):
        signatory = signatories_by_id.get(organisation_id)
        if signatory is None:
            stats["inventories_without_signatory"] += 1
            continue
        shown, baseline = _pick(city_inventories)
        electricity = sum(s.electricity_mwh for s in shown.sectors.values())
        total = sum(s.total_mwh for s in shown.sectors.values())
        if total <= 0:
            stats["cities_with_empty_inventory"] += 1
            continue
        result.append(
            CityEnergy(
                id=f"com:{organisation_id}",
                name=signatory.name,
                country=signatory.country,
                location=(signatory.lon, signatory.lat),
                population=shown.population or signatory.population,
                inventory_year=shown.year,
                baseline=shown.baseline,
                sectors=dict(sorted(shown.sectors.items())),
                electricity_mwh=electricity,
                total_mwh=total,
                baseline_year=baseline.year if baseline else None,
                baseline_electricity_mwh=(
                    sum(s.electricity_mwh for s in baseline.sectors.values()) if baseline else None
                ),
                provenance=(
                    Provenance(
                        source="com",
                        source_id=organisation_id,
                        license="CC-BY-4.0",
                        retrieved_at=retrieved_at,
                        url=f"{BASE_URL}{release}/",
                    ),
                ),
            )
        )
        stats["cities"] += 1
    return result
