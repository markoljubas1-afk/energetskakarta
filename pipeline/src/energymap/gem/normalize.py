"""Turn raw GIPT unit rows into plant records ready for conflation.

GEM rows are generating units or project phases. The map shows plants, so units are grouped by GEM
location and status: a plant with two operating units and a planned third one becomes an operating
record and a separate planned record, which keeps expansions visible.
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from energymap.osm.tags import parse_year
from energymap.schema import Status, Technology

# GEM country/area names for the countries in scope. Coordinates decide in the end (see conflate.py).
COUNTRY_CODES: dict[str, str] = {
    "croatia": "HR",
    "slovenia": "SI",
    "hungary": "HU",
    "serbia": "RS",
    "bosnia and herzegovina": "BA",
    "montenegro": "ME",
    "italy": "IT",
    "austria": "AT",
}

_STATUS: dict[str, Status] = {
    "operating": Status.OPERATING,
    "construction": Status.CONSTRUCTION,
    "pre-construction": Status.PLANNED,
    "announced": Status.PLANNED,
}
# Statuses that are deliberately not mapped (their prefixes; GEM adds "- inferred ..." sub-statuses).
EXCLUDED_STATUSES = ("shelved", "cancelled", "retired", "mothballed")

# "L1" followed by 11 digits, e.g. L100000603791 (GEM methodology, 2024 id format)
_LOCATION_ID = re.compile(r"^L1\d{11}$")
_TRANSITIONZERO = re.compile(r"\bTZ\b")


@dataclass(frozen=True, slots=True)
class Skip:
    """Why a row does not become a unit: a stable code used in the build statistics.

    ``out_of_scope`` and ``excluded_status`` are expected; codes starting with ``invalid_`` mean the row
    is in scope but broken."""

    reason: str


def status_of(raw: Any) -> Status | None:
    """Mapped status, or None for statuses the map does not show. Unknown values raise ValueError."""
    text = str(raw or "").strip().casefold()
    if text in _STATUS:
        return _STATUS[text]
    if text.startswith(EXCLUDED_STATUSES):
        return None
    raise ValueError(f"unknown GEM status {raw!r}")


def technology_of(type_: Any, technology: Any, fuel: Any) -> Technology:
    kind = str(type_ or "").strip().casefold()
    tech = str(technology or "").casefold()
    fuels = str(fuel or "").casefold()
    if kind in {"hydropower", "hydro"}:
        return Technology.PUMPED_STORAGE if "pumped" in tech else Technology.HYDRO
    if kind == "coal":
        return Technology.LIGNITE if "lignite" in fuels else Technology.COAL
    if kind in {"oil/gas", "gas", "oil"}:
        # "fossil gas: natural gas", "fossil liquids: fuel oil", ... ; gas wins when both are listed
        if "gas" in fuels or kind == "gas":
            return Technology.GAS
        return Technology.OIL
    simple = {
        "solar": Technology.SOLAR,
        "wind": Technology.WIND,
        "nuclear": Technology.NUCLEAR,
        "geothermal": Technology.GEOTHERMAL,
        "bioenergy": Technology.BIOMASS,
        "battery": Technology.BATTERY,
    }
    return simple.get(kind, Technology.OTHER)


_GEM_THOUSANDS = re.compile(r"^-?\d{1,3}(,\d{3})+(\.\d+)?$")


def _number(raw: Any) -> float | None:
    """GEM files are English: "." is the decimal mark and "," groups thousands ("1,200.5").
    A lone comma with one or two decimals ("9,9") comes from hand-edited exports and is read as decimal."""
    if raw is None or raw == "" or isinstance(raw, bool):
        return None
    if isinstance(raw, int | float):
        return float(raw)
    text = str(raw).strip().replace("\u00a0", "").replace(" ", "")
    if _GEM_THOUSANDS.match(text):
        text = text.replace(",", "")
    elif re.fullmatch(r"-?\d+,\d{1,2}", text):
        text = text.replace(",", ".")
    try:
        value = float(text)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def _year(raw: Any) -> int | None:
    if isinstance(raw, int | float) and not isinstance(raw, bool):
        raw = str(int(raw))
    return parse_year(None if raw is None else str(raw))


def _text(raw: Any) -> str | None:
    text = re.sub(r"\s+", " ", str(raw or "")).strip()
    return text or None


@dataclass(frozen=True, slots=True)
class GemUnit:
    unit_id: str
    location_id: str
    country: str
    plant_name: str
    status: Status
    technology: Technology
    capacity_mw: float | None
    start_year: int | None
    operator: str | None
    latitude: float
    longitude: float
    approximate: bool
    wiki_url: str | None
    non_commercial: bool


def parse_unit(row: Mapping[str, Any]) -> GemUnit | Skip:
    """A unit in scope that the map shows, or the reason it is skipped."""
    country = COUNTRY_CODES.get(str(row.get("country") or "").strip().casefold())
    if country is None:
        return Skip("out_of_scope")
    try:
        status = status_of(row.get("status"))
    except ValueError:
        return Skip("invalid_status")
    if status is None:
        return Skip("excluded_status")
    location_id = str(row.get("location_id") or "").strip()
    if not _LOCATION_ID.match(location_id):
        return Skip("invalid_location_id")
    lat, lon = _number(row.get("latitude")), _number(row.get("longitude"))
    if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return Skip("invalid_coordinates")
    capacity = _number(row.get("capacity_mw"))
    if capacity is not None and capacity < 0:
        return Skip("invalid_capacity")
    wiki = _text(row.get("wiki_url"))
    return GemUnit(
        unit_id=str(row.get("unit_id") or "").strip(),
        location_id=location_id,
        country=country,
        plant_name=_text(row.get("plant_name")) or location_id,
        status=status,
        technology=technology_of(row.get("type"), row.get("technology"), row.get("fuel")),
        capacity_mw=capacity,
        start_year=_year(row.get("start_year")),
        operator=_text(row.get("operator")),
        latitude=lat,
        longitude=lon,
        approximate=str(row.get("location_accuracy") or "").strip().casefold().startswith("approx"),
        wiki_url=wiki if wiki and wiki.startswith("https://") else None,
        non_commercial=bool(_TRANSITIONZERO.search(str(row.get("other_ids") or ""))),
    )


@dataclass(frozen=True, slots=True)
class RetiredUnit:
    """A unit GEM lists as retired. Never on the map (``EXCLUDED_STATUSES``); kept only for the time machine,
    which needs to know what ran when (Faza 18-3)."""

    location_id: str
    country: str
    plant_name: str
    technology: Technology
    capacity_mw: float
    start_year: int
    retired_year: int
    latitude: float
    longitude: float


def parse_retired(row: Mapping[str, Any]) -> RetiredUnit | None:
    """A retired unit in scope with everything the time machine needs, else None. A unit without a start
    year, a retirement year or a capacity cannot be placed in time, so it is left out rather than guessed."""
    country = COUNTRY_CODES.get(str(row.get("country") or "").strip().casefold())
    if country is None or not str(row.get("status") or "").strip().casefold().startswith("retired"):
        return None
    location_id = str(row.get("location_id") or "").strip()
    lat, lon = _number(row.get("latitude")), _number(row.get("longitude"))
    capacity = _number(row.get("capacity_mw"))
    start, retired = _year(row.get("start_year")), _year(row.get("retired_year"))
    if (
        not _LOCATION_ID.match(location_id)
        or lat is None
        or lon is None
        or not (-90 <= lat <= 90 and -180 <= lon <= 180)
        or capacity is None
        or capacity <= 0
        or start is None
        or retired is None
        or retired < start
    ):
        return None
    return RetiredUnit(
        location_id=location_id,
        country=country,
        plant_name=_text(row.get("plant_name")) or location_id,
        technology=technology_of(row.get("type"), row.get("technology"), row.get("fuel")),
        capacity_mw=capacity,
        start_year=start,
        retired_year=retired,
        latitude=lat,
        longitude=lon,
    )


@dataclass(frozen=True, slots=True)
class GemPlant:
    """All units of one GEM location that share a status."""

    location_id: str
    status: Status
    name: str
    technology: Technology
    capacity_mw: float | None
    commissioning_year: int | None
    operator: str | None
    country: str
    latitude: float
    longitude: float
    approximate: bool
    wiki_url: str | None
    non_commercial: bool
    units: int

    @property
    def key(self) -> str:
        return f"{self.location_id}:{self.status.value}"


def aggregate(units: Iterable[GemUnit]) -> list[GemPlant]:
    groups: dict[tuple[str, Status], list[GemUnit]] = {}
    for unit in units:
        groups.setdefault((unit.location_id, unit.status), []).append(unit)
    plants = []
    for (location_id, status), members in sorted(
        groups.items(), key=lambda item: (item[0][0], item[0][1].value)
    ):
        known = [u.capacity_mw for u in members if u.capacity_mw is not None]
        # the technology carrying the most capacity describes the plant
        by_tech: defaultdict[Technology, float] = defaultdict(float)
        for unit in members:
            by_tech[unit.technology] += unit.capacity_mw or 0.0
        technology = max(by_tech.items(), key=lambda item: (item[1], item[0].value))[0]
        years = [u.start_year for u in members if u.start_year is not None]
        operators = Counter(u.operator for u in members if u.operator)
        first = members[0]
        plants.append(
            GemPlant(
                location_id=location_id,
                status=status,
                name=first.plant_name,
                technology=technology,
                capacity_mw=round(sum(known), 3) if known else None,
                commissioning_year=min(years) if years else None,
                operator=operators.most_common(1)[0][0] if operators else None,
                country=first.country,
                latitude=first.latitude,
                longitude=first.longitude,
                approximate=any(u.approximate for u in members),
                wiki_url=next((u.wiki_url for u in members if u.wiki_url), None),
                non_commercial=any(u.non_commercial for u in members),
                units=len(members),
            )
        )
    return plants


@dataclass(slots=True)
class GemLoad:
    plants: list[GemPlant] = field(default_factory=list)
    stats: Counter[str] = field(default_factory=Counter)
    retired: list[RetiredUnit] = field(default_factory=list)


def load(rows: Iterable[Mapping[str, Any]]) -> GemLoad:
    result = GemLoad()
    units: list[GemUnit] = []
    for row in rows:
        result.stats["rows"] += 1
        parsed = parse_unit(row)
        if isinstance(parsed, Skip):
            result.stats[parsed.reason] += 1
            if parsed.reason == "excluded_status" and (retired := parse_retired(row)) is not None:
                result.retired.append(retired)
        else:
            units.append(parsed)
    result.stats["units_in_scope"] = len(units)
    result.stats["retired_units"] = len(result.retired)
    result.plants = aggregate(units)
    result.stats["plants"] = len(result.plants)
    return result
