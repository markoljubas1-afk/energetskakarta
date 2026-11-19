"""Static project configuration: countries in scope, source URLs and thresholds."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Country:
    code: str
    name_hr: str
    geofabrik_id: str


COUNTRIES: tuple[Country, ...] = (
    Country("HR", "Hrvatska", "croatia"),
    Country("SI", "Slovenija", "slovenia"),
    Country("HU", "Mađarska", "hungary"),
    Country("RS", "Srbija", "serbia"),
    Country("BA", "Bosna i Hercegovina", "bosnia-herzegovina"),
    Country("ME", "Crna Gora", "montenegro"),
    Country("IT", "Italija", "italy"),
    Country("AT", "Austrija", "austria"),
)
COUNTRY_BY_CODE: dict[str, Country] = {c.code: c for c in COUNTRIES}
SCOPE_CODES: frozenset[str] = frozenset(COUNTRY_BY_CODE)

# lon_min, lat_min, lon_max, lat_max — covers all countries in scope plus a margin for neighbours.
REGION_BBOX: tuple[float, float, float, float] = (5.5, 35.0, 24.5, 49.5)
# How far the website lets the map be dragged: the data's bounds plus 12° of longitude and 8° of latitude
# (web/src/map/MapView.tsx, regionMaxBounds). Country borders are published for all of it. They were cut
# at REGION_BBOX, so the veil over the countries outside the scope ended in a straight line across
# Germany, Romania and North Africa, and whatever lay beyond looked like another map.
MAP_MARGIN_DEG: tuple[float, float] = (12.0, 8.0)
MAP_BBOX: tuple[float, float, float, float] = (
    REGION_BBOX[0] - MAP_MARGIN_DEG[0],
    REGION_BBOX[1] - MAP_MARGIN_DEG[1],
    REGION_BBOX[2] + MAP_MARGIN_DEG[0],
    REGION_BBOX[3] + MAP_MARGIN_DEG[1],
)

GEOFABRIK_INDEX_URL = "https://download.geofabrik.de/index-v1-nogeom.json"
# Pinned release so country borders never change underneath a build. Natural Earth is public domain.
NATURAL_EARTH_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/"
    "ne_10m_admin_0_countries.geojson"
)


@dataclass(frozen=True, slots=True)
class SourceFilter:
    """One prefilter pass over a country extract.

    A pass selects either by key (cheap and broad) or by exact key=value pair. pyosmium chains filters
    with AND, never OR, so anything that cannot share one selection needs a pass of its own. That is the
    whole reason there are two: "amenity" is one of the commonest keys in OSM, and selecting by it would
    leave the extract barely smaller than the 2 GB it started as.
    """

    name: str
    keys: tuple[str, ...] = ()
    pairs: tuple[tuple[str, str], ...] = ()

    def __post_init__(self) -> None:
        if bool(self.keys) == bool(self.pairs):
            raise ValueError(f"{self.name}: a pass selects either by key or by key=value, not both")

    def fingerprint(self) -> str:
        """Short digest of what this pass selects; part of the filtered file's name so that widening a
        pass can never reuse a file built before the change."""
        parts = [*self.keys, *(f"{k}={v}" for k, v in self.pairs)]
        return hashlib.sha256("\n".join(parts).encode()).hexdigest()[:8]


def _lifecycle_keys(key: str) -> tuple[str, ...]:
    return (key, f"construction:{key}", f"proposed:{key}", f"planned:{key}")


def _lifecycle_pairs(key: str, value: str) -> tuple[tuple[str, str], ...]:
    return tuple((prefixed, value) for prefixed in _lifecycle_keys(key))


# The grid itself plus data centres (telecom=data_center). "building" cannot be added here for the same
# reason as "amenity" below, so a data centre tagged only as building=data_center is not seen (7B).
POWER_FILTER = SourceFilter("power", keys=(*_lifecycle_keys("power"), *_lifecycle_keys("telecom")))
# Charging stations, by exact value: see SourceFilter's docstring for why this is a pass of its own (7D).
CHARGER_FILTER = SourceFilter("chargers", pairs=_lifecycle_pairs("amenity", "charging_station"))
# Where oil, gas and coal are taken out of the ground (13A). "man_made" and "landuse" are as common as
# "amenity", so this is exact pairs too. A pair selects objects with ANY of the pairs (pyosmium TagFilter).
EXTRACTION_TAGS: tuple[tuple[str, str], ...] = (
    ("man_made", "offshore_platform"),
    ("man_made", "petroleum_well"),
    ("industrial", "mine"),
    ("man_made", "mineshaft"),
    ("man_made", "adit"),
    ("landuse", "quarry"),
)
# Pipelines on land (Faza 44-4) ride on the same pass: one more exact pair costs nothing, while a pass of
# their own would read every country's 2 GB extract once more. Which pipelines are kept (gas and oil, not
# water or sewage) is decided when the tags are read (osm/tags.py).
PIPELINE_TAGS: tuple[tuple[str, str], ...] = (("man_made", "pipeline"),)
EXTRACTION_FILTER = SourceFilter(
    "extraction",
    pairs=tuple(
        pair for key, value in (*EXTRACTION_TAGS, *PIPELINE_TAGS) for pair in _lifecycle_pairs(key, value)
    ),
)
SOURCE_FILTERS: tuple[SourceFilter, ...] = (POWER_FILTER, CHARGER_FILTER, EXTRACTION_FILTER)

# A line counts as crossing into a country only if at least this much of it lies there.
# Natural Earth 10m borders are generalised, so shorter overlaps are treated as border noise.
INTERCONNECTOR_MIN_SEGMENT_M = 500.0
# Points and cable landfalls that fall just outside a (generalised) coastline are matched to the nearest
# country within this distance. Degrees, roughly 20-28 km at the region's latitudes.
COASTAL_TOLERANCE_DEG = 0.25
# Offshore platforms stand up to ~60 km from the coast (the northern Adriatic gas fields). The nearest
# coast within this distance is the proxy for whose waters they are in. Degrees, roughly 80-110 km.
OFFSHORE_TOLERANCE_DEG = 1.0

# A build is rejected if any layer shrinks by more than this share compared with the previous build.
MAX_COUNT_DROP = 0.10


@dataclass(frozen=True, slots=True)
class Paths:
    """Filesystem layout under one data directory."""

    root: Path

    @property
    def raw(self) -> Path:
        return self.root / "raw"

    @property
    def filtered(self) -> Path:
        return self.root / "filtered"

    @property
    def reference(self) -> Path:
        return self.root / "reference"

    @property
    def out(self) -> Path:
        return self.root / "out"

    def ensure(self) -> None:
        for directory in (self.raw, self.filtered, self.reference, self.out):
            directory.mkdir(parents=True, exist_ok=True)
