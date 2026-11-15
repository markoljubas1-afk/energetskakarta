"""The hand-kept list of data centres, and how it meets the ones found in OpenStreetMap.

No open database covers data centres in this region, and the commercial directories that do are not
licensed for re-use. So the layer has two sources: whatever OSM knows, plus a small list we maintain by
hand in ``overrides/datacenters.yaml``.

Two rules keep that list honest, and both are enforced here rather than by good intentions:

* every entry names the public source it was taken from, as an https link, and that link travels with
  the record all the way to the details panel;
* nothing is estimated. ``powerMw`` is only ever a published figure; an entry without one simply has no
  power, and the map says so.

A hand-kept entry near an OSM one completes it instead of competing with it: the OSM object keeps its
id and position (so shared links stay valid) and gains the name, operator and power we know.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from energymap.geo.countries import CountryIndex
from energymap.schema import DataCenter, Provenance, Status

log = logging.getLogger(__name__)

# Distance within which a hand-kept entry is taken to describe the same site as an OSM object. Data
# centres are single buildings or small campuses, so this is deliberately tight.
MATCH_DISTANCE_M = 1000.0
_EARTH_RADIUS_M = 6_371_000.0

_ID_PREFIX = "dc:"
_REQUIRED = frozenset({"id", "name", "location", "status", "source"})
_ALLOWED = _REQUIRED | {"operator", "powerMw", "year"}


class DataCenterListError(ValueError):
    """The hand-kept list is not valid. A broken list fails the build; it is never partly used."""


@dataclass(frozen=True, slots=True)
class ManualEntry:
    slug: str
    name: str
    operator: str | None
    lon: float
    lat: float
    status: Status
    power_mw: float | None
    year: int | None
    source: str

    @property
    def id(self) -> str:
        return f"{_ID_PREFIX}{self.slug}"

    def provenance(self, retrieved_at: datetime) -> Provenance:
        return Provenance(
            source="manual",
            source_id=self.slug,
            license="manual-sourced",
            retrieved_at=retrieved_at,
            url=self.source,
        )


def _entry(raw: Any, where: str) -> ManualEntry:
    if not isinstance(raw, dict):
        raise DataCenterListError(f"{where}: every entry must be a mapping, got {type(raw).__name__}")
    unknown = set(raw) - _ALLOWED
    if unknown:
        raise DataCenterListError(f"{where}: unknown keys {sorted(unknown)}; allowed: {sorted(_ALLOWED)}")
    missing = _REQUIRED - set(raw)
    if missing:
        raise DataCenterListError(f"{where}: missing required keys {sorted(missing)}")

    location = raw["location"]
    if not (
        isinstance(location, list)
        and len(location) == 2
        and all(isinstance(value, int | float) and not isinstance(value, bool) for value in location)
    ):
        raise DataCenterListError(f"{where}: 'location' must be [lon, lat]")
    status = raw["status"]
    if status not in {s.value for s in Status}:
        raise DataCenterListError(f"{where}: 'status' must be one of {sorted(s.value for s in Status)}")
    source = raw["source"]
    if not (isinstance(source, str) and source.startswith("https://")):
        raise DataCenterListError(f"{where}: 'source' must be an https link to where this was published")
    power = raw.get("powerMw")
    if power is not None and not (
        isinstance(power, int | float) and not isinstance(power, bool) and power > 0
    ):
        raise DataCenterListError(f"{where}: 'powerMw' must be a positive number when given")
    year = raw.get("year")
    if year is not None and not (isinstance(year, int) and not isinstance(year, bool)):
        raise DataCenterListError(f"{where}: 'year' must be a whole number when given")
    for key in ("id", "name"):
        if not (isinstance(raw[key], str) and raw[key].strip()):
            raise DataCenterListError(f"{where}: '{key}' must be a non-empty string")
    operator = raw.get("operator")
    if operator is not None and not isinstance(operator, str):
        raise DataCenterListError(f"{where}: 'operator' must be a string when given")

    return ManualEntry(
        slug=raw["id"].strip(),
        name=raw["name"].strip(),
        operator=operator,
        lon=float(location[0]),
        lat=float(location[1]),
        status=Status(status),
        power_mw=float(power) if power is not None else None,
        year=year,
        source=source,
    )


def load_list(path: Path | None) -> tuple[ManualEntry, ...]:
    """Read ``overrides/datacenters.yaml``. A missing file means "no hand-kept entries", which is the
    state the repository ships in; a malformed one is an error."""
    if path is None or not path.exists():
        return ()
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise DataCenterListError(f"{path}: not valid YAML: {exc}") from exc
    if not isinstance(data, dict):
        raise DataCenterListError(f"{path}: expected a mapping with a 'datacenters' list")
    unknown = set(data) - {"datacenters"}
    if unknown:
        raise DataCenterListError(f"{path}: unknown keys {sorted(unknown)}")
    items = data.get("datacenters") or []
    if not isinstance(items, list):
        raise DataCenterListError(f"{path}: 'datacenters' must be a list")

    entries = tuple(_entry(item, f"{path.name}[{i}]") for i, item in enumerate(items))
    slugs = [entry.slug for entry in entries]
    duplicates = sorted({slug for slug in slugs if slugs.count(slug) > 1})
    if duplicates:
        raise DataCenterListError(f"{path}: duplicate ids {duplicates}")
    return entries


def _metres_between(lon_a: float, lat_a: float, lon_b: float, lat_b: float) -> float:
    """Great-circle distance. Exact enough far below the distances this module compares."""
    phi_a, phi_b = math.radians(lat_a), math.radians(lat_b)
    d_phi = phi_b - phi_a
    d_lambda = math.radians(lon_b - lon_a)
    h = math.sin(d_phi / 2) ** 2 + math.cos(phi_a) * math.cos(phi_b) * math.sin(d_lambda / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(h))


def _nearest(entry: ManualEntry, centres: Iterable[DataCenter]) -> tuple[DataCenter | None, float]:
    best: DataCenter | None = None
    best_distance = math.inf
    for centre in centres:
        distance = _metres_between(entry.lon, entry.lat, *centre.location)
        if distance < best_distance:
            best, best_distance = centre, distance
    return best, best_distance


def apply_list(
    centres: dict[str, DataCenter],
    entries: Iterable[ManualEntry],
    *,
    index: CountryIndex,
    scope: frozenset[str],
    retrieved_at: datetime,
) -> dict[str, int]:
    """Merge the hand-kept entries into the OSM ones, in place. Returns counters for the manifest."""
    stats = {"entries": 0, "outside_scope": 0, "completed_osm": 0, "added": 0}
    for entry in sorted(entries, key=lambda e: e.slug):
        stats["entries"] += 1
        country = index.country_of_point(entry.lon, entry.lat)
        if country is None or country not in scope:
            stats["outside_scope"] += 1
            log.warning("data centre outside the region", extra={"slug": entry.slug, "country": country})
            continue
        provenance = entry.provenance(retrieved_at)
        match, distance = _nearest(entry, centres.values())
        if match is not None and distance <= MATCH_DISTANCE_M:
            # the OSM object keeps its id and position; the hand-kept entry fills in what it knows
            centres[match.id] = match.model_copy(
                update={
                    "name": entry.name,
                    "operator": entry.operator or match.operator,
                    "power_mw": entry.power_mw if entry.power_mw is not None else match.power_mw,
                    "commissioning_year": entry.year if entry.year is not None else match.commissioning_year,
                    "status": entry.status,
                    "provenance": (*match.provenance, provenance),
                }
            )
            stats["completed_osm"] += 1
            continue
        centres[entry.id] = DataCenter(
            id=entry.id,
            status=entry.status,
            operator=entry.operator,
            provenance=(provenance,),
            name=entry.name,
            power_mw=entry.power_mw,
            commissioning_year=entry.year,
            country=country,
            location=(round(entry.lon, 6), round(entry.lat, 6)),
        )
        stats["added"] += 1
    return stats


def summary(stats: Mapping[str, int], centres: Mapping[str, DataCenter]) -> dict[str, Any]:
    """What the manifest records about this layer."""
    with_power = [c.power_mw for c in centres.values() if c.power_mw is not None]
    return {
        "total": len(centres),
        "fromManualList": stats.get("added", 0),
        "completedFromManualList": stats.get("completed_osm", 0),
        "withPower": len(with_power),
        "powerMw": round(sum(with_power), 3) if with_power else None,
    }
