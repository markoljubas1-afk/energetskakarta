"""Pure functions that turn raw OpenStreetMap tags into typed values. No I/O, no global state.

OSM tagging in the region is inconsistent, so every parser here is defensive: anything ambiguous
returns ``None`` (or is skipped) instead of guessing, and callers count those cases.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from energymap.schema import ENERGY_SUBSTANCES, ExtractionKind, Status, Substance, Technology

Tags = Mapping[str, str]

MIN_VOLTAGE_KV = 60.0
MAX_VOLTAGE_KV = 1200.0


class Kind(StrEnum):
    LINE = "line"
    MINOR_LINE = "minor_line"
    CABLE = "cable"
    SUBSTATION = "substation"
    PLANT = "plant"


class Role(StrEnum):
    """Which map layer an asset belongs to.

    The two roles hold the same kind of record and differ only in where they are published: the
    transmission grid is the map's backbone, distribution is an opt-in layer that appears from z10.
    """

    TRANSMISSION = "transmission"
    DISTRIBUTION = "distribution"


_KIND_VALUES = frozenset(k.value for k in Kind)

# OSM lifecycle prefixes (https://wiki.openstreetmap.org/wiki/Lifecycle_prefix).
# disused/abandoned/demolished are intentionally absent: those assets are not part of the grid.
_LIFECYCLE: tuple[tuple[str, Status], ...] = (
    ("construction", Status.CONSTRUCTION),
    ("proposed", Status.PLANNED),
    ("planned", Status.PLANNED),
)

# A data centre is not tagged under power=*; these are the keys and values that identify one.
_DATA_CENTER_TAGS: tuple[tuple[str, str], ...] = (("telecom", "data_center"), ("building", "data_center"))

_CHARGING_STATION_TAGS: tuple[tuple[str, str], ...] = (("amenity", "charging_station"),)

# Extraction sites, in the order they are tried: a quarry that is also tagged as a mine is a mine.
_EXTRACTION_TAGS: tuple[tuple[ExtractionKind, tuple[str, str]], ...] = (
    (ExtractionKind.PLATFORM, ("man_made", "offshore_platform")),
    (ExtractionKind.WELL, ("man_made", "petroleum_well")),
    (ExtractionKind.MINE, ("industrial", "mine")),
    (ExtractionKind.SHAFT, ("man_made", "mineshaft")),
    (ExtractionKind.ADIT, ("man_made", "adit")),
    (ExtractionKind.QUARRY, ("landuse", "quarry")),
)
# What the tag itself says is dug when resource=* is silent: an offshore platform and a petroleum well
# are hydrocarbon structures by definition; a mine, shaft or adit can dig anything.
_DEFAULT_SUBSTANCE: dict[ExtractionKind, Substance] = {
    ExtractionKind.PLATFORM: Substance.OIL_GAS,
    ExtractionKind.WELL: Substance.OIL_GAS,
    ExtractionKind.MINE: Substance.UNKNOWN,
    ExtractionKind.SHAFT: Substance.UNKNOWN,
    ExtractionKind.ADIT: Substance.UNKNOWN,
    ExtractionKind.QUARRY: Substance.UNKNOWN,
}
_RESOURCE_TO_SUBSTANCE: dict[str, Substance] = {
    "oil": Substance.OIL,
    "petroleum": Substance.OIL,
    "crude_oil": Substance.OIL,
    "gas": Substance.GAS,
    "natural_gas": Substance.GAS,
    "coal": Substance.COAL,
    "hard_coal": Substance.COAL,
    "anthracite": Substance.COAL,
    "lignite": Substance.LIGNITE,
    "brown_coal": Substance.LIGNITE,
    "peat": Substance.PEAT,
    "uranium": Substance.URANIUM,
}

_EXCLUDED_LINE_TYPES = frozenset({"busbar", "bay"})
_DISTRIBUTION_SUBSTATION_TYPES = frozenset({"minor_distribution"})

_SOURCE_TO_TECHNOLOGY: dict[str, Technology] = {
    "hydro": Technology.HYDRO,
    "solar": Technology.SOLAR,
    "wind": Technology.WIND,
    "gas": Technology.GAS,
    "coal": Technology.COAL,
    "lignite": Technology.LIGNITE,
    "nuclear": Technology.NUCLEAR,
    "biomass": Technology.BIOMASS,
    "biogas": Technology.BIOMASS,
    "biofuel": Technology.BIOMASS,
    "geothermal": Technology.GEOTHERMAL,
    "battery": Technology.BATTERY,
    "oil": Technology.OIL,
    "diesel": Technology.OIL,
}
_PUMPED_STORAGE_METHODS = frozenset({"water-pumped-storage"})

_DIGIT_GROUP_SPACE = re.compile(r"(?<=\d)[\s\u00a0\u202f](?=\d{3}\b)")
_THOUSANDS_COMMA = re.compile(r"^\d{1,3}(,\d{3})+$")
_THOUSANDS_DOT = re.compile(r"^\d{1,3}(\.\d{3})+$")
_NUMBER = re.compile(r"^\d+(?:[.,]\d+)?$")
_VOLTAGE = re.compile(r"^(?P<num>[\d.,]+)\s*(?P<unit>kv|v)?$", re.IGNORECASE)
_POWER = re.compile(r"^(?P<num>[\d.,]+)\s*(?P<unit>gw|mw|kw|w)p?$", re.IGNORECASE)
_YEAR = re.compile(r"^(\d{4})")
_POWER_FACTOR_TO_MW = {"w": 1e-6, "kw": 1e-3, "mw": 1.0, "gw": 1000.0}


@dataclass(frozen=True, slots=True)
class Lifecycle:
    kind: Kind
    status: Status


def lifecycle(tags: Tags) -> Lifecycle | None:
    """Return what the object is and its lifecycle status, or ``None`` if it is not a grid asset we map."""
    power = tags.get("power")
    if power in _KIND_VALUES:
        return Lifecycle(Kind(power), Status.OPERATING)
    for prefix, status in _LIFECYCLE:
        # Current style: construction:power=line
        prefixed = tags.get(f"{prefix}:power")
        if prefixed in _KIND_VALUES:
            return Lifecycle(Kind(prefixed), status)
        # Legacy style: power=construction + construction=line
        legacy = tags.get(prefix)
        if power == prefix and legacy in _KIND_VALUES:
            return Lifecycle(Kind(legacy), status)
    return None


def _tagged(tags: Tags, wanted: tuple[tuple[str, str], ...]) -> Status | None:
    """Status of an object carrying one of ``wanted`` key=value pairs, with lifecycle prefixes."""
    for key, value in wanted:
        if tags.get(key) == value:
            return Status.OPERATING
        for prefix, status in _LIFECYCLE:
            if tags.get(f"{prefix}:{key}") == value:
                return status
            if tags.get(key) == prefix and tags.get(prefix) == value:
                return status
    return None


def data_center(tags: Tags) -> Status | None:
    """The lifecycle status of a data centre, or ``None`` when the object is not one.

    ``telecom=data_center`` is the documented tag; ``building=data_center`` also occurs. Lifecycle
    prefixes carry the planned and under-construction ones, which are the most interesting of all.
    """
    return _tagged(tags, _DATA_CENTER_TAGS)


def charging_station(tags: Tags) -> Status | None:
    return _tagged(tags, _CHARGING_STATION_TAGS)


@dataclass(frozen=True, slots=True)
class Extraction:
    kind: ExtractionKind
    status: Status
    substance: Substance


def substance(tags: Tags, kind: ExtractionKind) -> Substance:
    """What a site digs, from ``resource=*`` (the documented key, ``a;b`` lists) or ``substance=*``.

    Oil and gas together are one value, because a hydrocarbon field yields both. A value we do not know
    (stone, salt, bauxite ...) is ``OTHER``: it says the site digs something that is not energy. Nothing
    at all falls back on what the object's own tag implies.
    """
    raw = tags.get("resource", "").strip() or tags.get("substance", "").strip()
    if not raw:
        return _DEFAULT_SUBSTANCE[kind]
    found = {
        _RESOURCE_TO_SUBSTANCE.get(part.strip().lower(), Substance.OTHER)
        for part in raw.split(";")
        if part.strip()
    }
    hydrocarbons = found & {Substance.OIL, Substance.GAS, Substance.OIL_GAS}
    if hydrocarbons:
        return hydrocarbons.pop() if len(hydrocarbons) == 1 else Substance.OIL_GAS
    energy = found & ENERGY_SUBSTANCES
    if energy:
        return sorted(energy)[0]
    return Substance.OTHER


def extraction_site(tags: Tags) -> Extraction | None:
    """An extraction site's kind, lifecycle status and substance, or ``None`` when the object is not one.

    Quarries are the one kind that is kept only when tagged with an energy resource: open-pit lignite
    mines in the region are usually ``landuse=quarry``, while a stone quarry is not an energy object.
    """
    for kind, pair in _EXTRACTION_TAGS:
        status = _tagged(tags, (pair,))
        if status is None:
            continue
        what = substance(tags, kind)
        if kind is ExtractionKind.QUARRY and what not in ENERGY_SUBSTANCES:
            return None
        return Extraction(kind, status, what)
    return None


def parse_points(raw: str | None) -> int | None:
    """``capacity``: how many vehicles can charge at once. Anything that is not a plain count is dropped
    rather than guessed (``"2;4"``, ``"many"``)."""
    if not raw or not raw.strip().isdigit():
        return None
    points = int(raw.strip())
    return points if 1 <= points <= 1000 else None


def parse_number(text: str) -> float | None:
    """Parse a decimal number written with either decimal separator. Ambiguous input returns ``None``.

    ``"1,200"`` is read as 1200 (thousands comma); ``"9,9"`` as 9.9; ``"1.200"`` is ambiguous
    (1.2 in English, 1200 in Croatian/Italian/German) and is rejected.
    """
    compact = _DIGIT_GROUP_SPACE.sub("", text.strip())
    if _THOUSANDS_COMMA.match(compact):
        return float(compact.replace(",", ""))
    if _THOUSANDS_DOT.match(compact):
        return None
    if not _NUMBER.match(compact):
        return None
    return float(compact.replace(",", "."))


def parse_voltages(raw: str | None) -> tuple[float, ...]:
    """Parse ``voltage`` into unique kV values, highest first.

    Values are volts by OSM convention; a ``kV`` suffix is also accepted.
    """
    if not raw:
        return ()
    values: set[float] = set()
    for token in raw.split(";"):
        match = _VOLTAGE.match(_DIGIT_GROUP_SPACE.sub("", token.strip()))
        if not match:
            continue
        number = parse_number(match["num"])
        if number is None:
            continue
        unit = (match["unit"] or "v").lower()
        kv = number if unit == "kv" else number / 1000.0
        if 0 < kv <= MAX_VOLTAGE_KV:
            values.add(round(kv, 1))
    return tuple(sorted(values, reverse=True))


def parse_capacity_mw(raw: str | None) -> float | None:
    """Parse ``plant:output:electricity`` into MW.

    Values without a unit (or ``yes``) are ambiguous and return ``None``.
    """
    if not raw:
        return None
    match = _POWER.match(_DIGIT_GROUP_SPACE.sub("", raw.strip()))
    if not match:
        return None
    number = parse_number(match["num"])
    if number is None:
        return None
    return round(number * _POWER_FACTOR_TO_MW[match["unit"].lower()], 3)


#: The most a single plant of each kind can plausibly have, in MW: well above the largest one in Europe
#: (solar about 600 MW, an offshore wind project in planning about 3 GW, Bełchatów 5.1 GW, Zaporizhzhia
#: 5.7 GW). A tagged value above it is a unit mistake, typically kW entered as MW, never a plant: three
#: solar farms near Ravenna were tagged 10 935, 15 519 and 21 636 MW and alone added 48 GW to Italy.
MAX_PLAUSIBLE_MW: dict[Technology, float] = {
    Technology.SOLAR: 2_000,
    Technology.WIND: 5_000,
    Technology.HYDRO: 3_000,
    Technology.PUMPED_STORAGE: 3_000,
    Technology.GAS: 5_000,
    Technology.COAL: 6_000,
    Technology.LIGNITE: 6_000,
    Technology.NUCLEAR: 8_000,
    Technology.OIL: 4_000,
    Technology.BIOMASS: 1_000,
    Technology.GEOTHERMAL: 1_000,
    Technology.BATTERY: 2_000,
    Technology.OTHER: 2_000,
}


def is_plausible_mw(capacity_mw: float, technology: Technology) -> bool:
    """Whether a tagged capacity can be that of one plant of this kind (see ``MAX_PLAUSIBLE_MW``)."""
    return capacity_mw <= MAX_PLAUSIBLE_MW[technology]


def parse_circuits(raw: str | None) -> int | None:
    """Total circuits. Multi-voltage lines list circuits per voltage (``"2;1"``), which are summed."""
    if not raw:
        return None
    parts = [p.strip() for p in raw.split(";")]
    if not parts or not all(p.isdigit() for p in parts):
        return None
    total = sum(int(p) for p in parts)
    return total if total >= 1 else None


def parse_year(raw: str | None) -> int | None:
    if not raw:
        return None
    match = _YEAR.match(raw.strip())
    if not match:
        return None
    year = int(match.group(1))
    return year if 1850 <= year <= 2100 else None


def technology(tags: Tags) -> Technology:
    sources = [s.strip().lower() for s in tags.get("plant:source", "").split(";") if s.strip()]
    if not sources:
        return Technology.OTHER
    if sources[0] == "hydro" and tags.get("plant:method") in _PUMPED_STORAGE_METHODS:
        return Technology.PUMPED_STORAGE
    return _SOURCE_TO_TECHNOLOGY.get(sources[0], Technology.OTHER)


def text(tags: Tags, *keys: str) -> str | None:
    """First non-empty value among ``keys``; multi-values (``a;b``) are joined for display."""
    for key in keys:
        value = tags.get(key, "").strip()
        if value:
            return "; ".join(part.strip() for part in value.split(";") if part.strip())
    return None


_WIKIDATA = re.compile(r"^Q[1-9][0-9]*$")
_WIKIPEDIA = re.compile(r"^([a-z][a-z-]{1,11}):\s*(\S.{0,250})$")


def wikidata(tags: Tags) -> str | None:
    """The object's Wikidata id ("Q1234"); the first of several, nothing when the value is not an id."""
    for part in tags.get("wikidata", "").split(";"):
        value = part.strip()
        if _WIKIDATA.match(value):
            return value
    return None


def wikipedia(tags: Tags) -> str | None:
    """The Wikipedia article as OSM writes it, "hr:HE Zakučac"; a bare title without language is dropped."""
    match = _WIKIPEDIA.match(tags.get("wikipedia", "").split(";")[0].strip())
    return f"{match.group(1)}:{match.group(2).strip()}" if match else None


def line_role(kind: Kind, tags: Tags, voltages_kv: tuple[float, ...]) -> Role | None:
    """Which layer a line or cable belongs to, or ``None`` when it is not a grid asset at all.

    60 kV is the transmission threshold. ``power=minor_line`` is distribution by definition, whatever
    its voltage tag says. Without a voltage tag the OSM convention decides: ``power=line`` is reserved
    for high voltage, while a bare ``power=cable`` can be anything, so it goes to distribution rather
    than being thrown away. Substation internals (busbars, bays) are not lines of their own.
    """
    if tags.get("line") in _EXCLUDED_LINE_TYPES:
        return None
    if kind is Kind.MINOR_LINE:
        return Role.DISTRIBUTION
    if voltages_kv:
        return Role.TRANSMISSION if voltages_kv[0] >= MIN_VOLTAGE_KV else Role.DISTRIBUTION
    return Role.TRANSMISSION if kind is Kind.LINE else Role.DISTRIBUTION


def substation_role(tags: Tags, voltages_kv: tuple[float, ...]) -> Role:
    """``substation=minor_distribution`` and anything below 60 kV is distribution.

    A substation without a voltage tag stays with the transmission grid: those are usually the large,
    named stations whose voltage simply has not been mapped yet.
    """
    if tags.get("substation") in _DISTRIBUTION_SUBSTATION_TYPES:
        return Role.DISTRIBUTION
    if voltages_kv and voltages_kv[0] < MIN_VOLTAGE_KV:
        return Role.DISTRIBUTION
    return Role.TRANSMISSION
