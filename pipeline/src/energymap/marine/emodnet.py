"""Offshore pipelines and wind farms from EMODnet Human Activities.

Verified (2026-09-16): the WFS at ``WFS_URL`` serves GeoJSON; pipeline features carry name, status,
medium, operator, size_in, length_m, year, from_loc, to_loc and country_co; wind farm features carry
name, n_turbines, power_mw, status, start or year, dist_coast and (polygons) area_sqkm. Status wording has
changed between releases, so every known spelling is mapped here and anything else is counted, not guessed.

Not covered: EMODnet's actual power-cable routes come only from German, French, Dutch and Norwegian
sources; Adriatic cables are taken from OpenStreetMap.
"""

from __future__ import annotations

import json
import logging
import math
from collections import Counter
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from shapely.errors import GEOSException
from shapely.geometry import shape

from energymap.files import write_json_atomic
from energymap.geo.countries import CountryIndex, haversine_m
from energymap.schema import Medium, Pipeline, PowerPlant, Provenance, Status, Technology

log = logging.getLogger(__name__)

WFS_URL = "https://ows.emodnet-humanactivities.eu/wfs"
LAYERS: dict[str, str] = {
    "pipelines": "emodnet:pipelines",
    "windfarms": "emodnet:windfarms",
    "windfarmspoly": "emodnet:windfarmspoly",
}
# Longitude/latitude box of the region (with sea); used to drop the rest of Europe after download.
REGION_BOX = (5.5, 35.0, 24.5, 49.5)
LICENSE = "EMODnet-open"
ATTRIBUTION = "EMODnet Human Activities"
DUPLICATE_WIND_KM = 5.0
# EMODnet lists some projects twice, once as a point and once as an area, under slightly different names
# ("MedWind" and "Med Wind wind farm", 8 km apart, both 2793 MW). Two records are one project when their
# names agree once the generic words are gone, the capacity is the same and they lie this close. Phases of
# one project ("Marche wind farm 1" and "2") keep their numbers and stay two.
LISTED_TWICE_KM = 30.0
_GENERIC_NAME_WORDS = ("floating", "offshore", "wind", "farm", "park")


class EmodnetError(RuntimeError):
    """EMODnet data could not be downloaded or does not look as documented."""


# ---------------------------------------------------------------- download


def fetch_layer(client: httpx.Client, layer: str) -> dict[str, Any]:
    """The whole layer as GeoJSON. Europe-wide layers are small (a few thousand features), and filtering
    locally avoids the axis-order pitfalls of WFS bounding boxes."""
    params = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAMES": LAYERS[layer],
        "OUTPUTFORMAT": "application/json",
        "SRSNAME": "EPSG:4326",
    }
    try:
        response = client.get(WFS_URL, params=params, timeout=httpx.Timeout(30.0, read=300.0))
    except httpx.HTTPError as exc:
        raise EmodnetError(f"EMODnet {layer}: {exc}") from exc
    if response.status_code != 200:
        raise EmodnetError(f"EMODnet {layer}: HTTP {response.status_code}")
    try:
        data = response.json()
    except ValueError as exc:
        # GeoServer reports errors as XML with status 200
        raise EmodnetError(f"EMODnet {layer}: not GeoJSON ({response.text[:200]!r})") from exc
    if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
        raise EmodnetError(f"EMODnet {layer}: not a FeatureCollection")
    features = data.get("features")
    if not isinstance(features, list) or not features:
        raise EmodnetError(f"EMODnet {layer}: no features")
    return data


def _positions(coordinates: Any) -> Iterator[tuple[float, float]]:
    """Every (x, y) in a GeoJSON coordinate array of any nesting; malformed entries are skipped."""
    if (
        isinstance(coordinates, list | tuple)
        and len(coordinates) >= 2
        and all(isinstance(v, int | float) and not isinstance(v, bool) for v in coordinates[:2])
    ):
        yield float(coordinates[0]), float(coordinates[1])
    elif isinstance(coordinates, list | tuple):
        for item in coordinates:
            yield from _positions(item)


def bounds(geometry: Mapping[str, Any] | None) -> tuple[float, float, float, float] | None:
    """Bounding box computed from the raw coordinates, so a malformed feature cannot crash a download."""
    points = list(_positions((geometry or {}).get("coordinates")))
    if not points:
        return None
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def in_region_box(geometry: Mapping[str, Any] | None) -> bool:
    box = bounds(geometry)
    if box is None:
        return False
    min_x, min_y, max_x, max_y = box
    region = REGION_BOX
    return not (max_x < region[0] or min_x > region[2] or max_y < region[1] or min_y > region[3])


def check_axis_order(features: Sequence[Mapping[str, Any]], layer: str) -> None:
    """European data in lon/lat has |lat| > |lon| far more often than not; swapped axes invert that."""
    sample = [box for f in features[:500] if (box := bounds(f.get("geometry"))) is not None]
    if not sample:
        raise EmodnetError(f"EMODnet {layer}: features without geometry")
    swapped = 0
    for min_x, min_y, _, _ in sample:
        if not (-35 <= min_x <= 45 and 25 <= min_y <= 75):
            swapped += 1
    if swapped > len(sample) / 2:
        raise EmodnetError(f"EMODnet {layer}: coordinates are not lon/lat in Europe (axis order?)")


def download(client: httpx.Client, target: Path, now: datetime) -> dict[str, int]:
    """Download all layers, keep only the region, write ``<layer>.geojson`` and ``emodnet.json``."""
    target.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    for layer in LAYERS:
        data = fetch_layer(client, layer)
        check_axis_order(data["features"], layer)
        kept = [f for f in data["features"] if f.get("geometry") and in_region_box(f["geometry"])]
        counts[layer] = len(kept)
        write_json_atomic(target / f"{layer}.geojson", {"type": "FeatureCollection", "features": kept})
        log.info("EMODnet layer", extra={"layer": layer, "total": len(data["features"]), "kept": len(kept)})
    if counts["pipelines"] == 0:
        raise EmodnetError("EMODnet returned no pipelines in the region; refusing to store an empty source")
    write_json_atomic(target / "emodnet.json", {"fetchedAt": now.isoformat(), "counts": counts})
    return counts


# ---------------------------------------------------------------- normalisation

_PIPELINE_STATUS = {
    "active": Status.OPERATING,
    "in use": Status.OPERATING,
    "operational": Status.OPERATING,
    "operating": Status.OPERATING,
    "under construction": Status.CONSTRUCTION,
    "construction": Status.CONSTRUCTION,
    "planned": Status.PLANNED,
    "proposed": Status.PLANNED,
    "approved": Status.PLANNED,
}
_WIND_STATUS = {
    "production": Status.OPERATING,
    "operational": Status.OPERATING,
    "test site": Status.OPERATING,
    "construction": Status.CONSTRUCTION,
    "under construction": Status.CONSTRUCTION,
    "approved": Status.PLANNED,
    "authorised": Status.PLANNED,
    "authorized": Status.PLANNED,
    "planned": Status.PLANNED,
}
# statuses deliberately not shown ("not in use" is Nord Stream 2's status in the documented response)
_EXCLUDED = {"not in use", "abandoned", "decommissioned", "dismantled", "removed", "cancelled"}

_MEDIUM = {"gas": Medium.GAS, "natural gas": Medium.GAS, "oil": Medium.OIL, "crude oil": Medium.OIL}


_EMPTY = {"", "n/a", "na", "null", "none", "-"}


def _text(value: Any) -> str | None:
    text = " ".join(str(value).split()) if value is not None else ""
    return None if text.lower() in _EMPTY else text


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(str(value).replace(",", "."))
    except ValueError:
        return None
    return number if math.isfinite(number) and number > 0 else None


def _year(value: Any) -> int | None:
    number = _number(value)
    if number is None:
        text = str(value or "")
        digits = next((text[i : i + 4] for i in range(len(text) - 3) if text[i : i + 4].isdigit()), None)
        number = float(digits) if digits else None
    return int(number) if number is not None and 1900 <= number <= 2100 else None


def _status(value: Any, table: Mapping[str, Status]) -> tuple[Status | None, str | None]:
    """``(status, None)`` when mapped, ``(None, text)`` for text that is not mapped, ``(None, None)`` when
    empty. Kept as a pair on purpose: ``Status`` is a ``StrEnum``, so an isinstance check on ``str`` cannot
    tell a mapped status from raw text."""
    text = (_text(value) or "").lower()
    if not text:
        return None, None
    mapped = table.get(text)
    return (mapped, None) if mapped is not None else (None, text)


def _feature_id(layer: str, feature: Mapping[str, Any], index: int) -> str:
    """A stable id: the dataset's own id, else GeoServer's feature id ("windfarms.12" -> "12")."""
    props = feature.get("properties") or {}
    feature_id = str(feature.get("id") or "")
    raw = props.get("id") or feature_id.split(".", 1)[-1] or props.get("FID") or index
    return f"{layer}/{str(raw).replace(' ', '_')[:80]}"


@dataclass(slots=True)
class MarineResult:
    pipelines: dict[str, Pipeline] = field(default_factory=dict)
    windfarms: list[PowerPlant] = field(default_factory=list)
    stats: Counter[str] = field(default_factory=Counter)


def _provenance(source_id: str, retrieved_at: datetime) -> tuple[Provenance, ...]:
    return (Provenance(source="emodnet", source_id=source_id, license=LICENSE, retrieved_at=retrieved_at),)


def normalize_pipelines(
    features: Iterable[Mapping[str, Any]], scope: frozenset[str], retrieved_at: datetime, result: MarineResult
) -> None:
    for index, feature in enumerate(features):
        props = feature.get("properties") or {}
        countries = tuple(
            sorted(
                {c.strip().upper() for c in str(props.get("country_co") or "").replace(";", ",").split(",")}
                - {""}
            )
        )
        if not set(countries) & scope:
            result.stats["pipelines_out_of_scope"] += 1
            continue
        status, unmapped = _status(props.get("status"), _PIPELINE_STATUS)
        if unmapped is not None:
            key = "pipelines_excluded" if unmapped in _EXCLUDED else "pipelines_unknown_status"
            result.stats[key] += 1
            continue
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates") or []
        parts_raw = [coords] if geometry.get("type") == "LineString" else coords
        parts = tuple(
            points
            for part in parts_raw
            if len(points := tuple((round(x, 6), round(y, 6)) for x, y in _positions(part))) >= 2
        )
        if geometry.get("type") not in {"LineString", "MultiLineString"} or not parts:
            result.stats["pipelines_bad_geometry"] += 1
            continue
        length_m = _number(props.get("length_m"))
        source_id = _feature_id("pipelines", feature, index)
        medium_text = (_text(props.get("medium")) or "").lower()
        medium = _MEDIUM.get(medium_text, Medium.OTHER if medium_text else Medium.UNKNOWN)
        result.pipelines[f"emodnet:{source_id}"] = Pipeline(
            id=f"emodnet:{source_id}",
            # the layer holds actual routes, so a route without a status is taken as existing
            status=status or Status.OPERATING,
            operator=_text(props.get("operator")),
            provenance=_provenance(source_id, retrieved_at),
            name=_text(props.get("name")),
            medium=medium,
            diameter_in=_number(props.get("size_in")),
            length_km=round(length_m / 1000, 2) if length_m else None,
            commissioning_year=_year(props.get("year")),
            countries=countries,
            parts=parts,
        )
        result.stats["pipelines"] += 1


def normalize_windfarms(
    features: Iterable[tuple[str, Mapping[str, Any]]],
    index: CountryIndex,
    scope: frozenset[str],
    retrieved_at: datetime,
    result: MarineResult,
) -> None:
    seen: set[str] = set()
    for layer_index, (layer, feature) in enumerate(features):
        props = feature.get("properties") or {}
        name = _text(props.get("name"))
        status, unmapped = _status(props.get("status"), _WIND_STATUS)
        if status is None:
            # a wind farm without a known status is not shown rather than guessed
            key = "windfarms_excluded" if unmapped in _EXCLUDED else "windfarms_unknown_status"
            result.stats[key] += 1
            continue
        try:
            point = shape(dict(feature.get("geometry") or {})).representative_point()
        except (GEOSException, ValueError, TypeError, AttributeError, IndexError):
            point = None
        if point is None or point.is_empty:
            result.stats["windfarms_bad_geometry"] += 1
            continue
        country = _text(props.get("country"))
        code = index.country_of_point(point.x, point.y) or _COUNTRY_NAMES.get((country or "").lower())
        if code not in scope:
            result.stats["windfarms_out_of_scope"] += 1
            continue
        # the same farm may exist as a point and as a polygon; keep one per name (polygon first)
        dedupe = (name or "").lower() or f"{round(point.x, 3)},{round(point.y, 3)}"
        if dedupe in seen:
            continue
        seen.add(dedupe)
        source_id = _feature_id(layer, feature, layer_index)
        result.windfarms.append(
            PowerPlant(
                id=f"emodnet:{source_id}",
                status=status,
                operator=None,
                provenance=_provenance(source_id, retrieved_at),
                name=name,
                technology=Technology.WIND,
                capacity_mw=_number(props.get("power_mw")),
                commissioning_year=_year(props.get("start") or props.get("year")),
                country=code,
                location=(round(point.x, 6), round(point.y, 6)),
            )
        )


# EMODnet writes country names; the sea is outside every land polygon, so names are the fallback.
_COUNTRY_NAMES = {
    "croatia": "HR",
    "italy": "IT",
    "slovenia": "SI",
    "montenegro": "ME",
    "albania": "AL",
    "greece": "GR",
}


def load(directory: Path, index: CountryIndex, scope: frozenset[str], retrieved_at: datetime) -> MarineResult:
    result = MarineResult()
    files = {layer: directory / f"{layer}.geojson" for layer in LAYERS}
    missing = [path.name for path in files.values() if not path.exists()]
    if missing:
        raise EmodnetError(f"{directory}: missing {', '.join(missing)}; run `energymap marine fetch`")

    def features(layer: str) -> list[dict[str, Any]]:
        data = json.loads(files[layer].read_text(encoding="utf-8"))
        return list(data.get("features") or [])

    normalize_pipelines(features("pipelines"), scope, retrieved_at, result)
    wind = [("windfarmspoly", f) for f in features("windfarmspoly")] + [
        ("windfarms", f) for f in features("windfarms")
    ]
    normalize_windfarms(wind, index, scope, retrieved_at, result)
    return result


def merge_windfarms(
    plants: dict[str, PowerPlant], windfarms: Iterable[PowerPlant], stats: Counter[str]
) -> None:
    """Add offshore wind farms that no existing wind plant (OSM or GEM) already represents."""
    existing = [p for p in plants.values() if p.technology is Technology.WIND]
    added: list[PowerPlant] = []
    for farm in windfarms:
        if any(_km(farm, p) <= DUPLICATE_WIND_KM for p in existing):
            stats["windfarms_already_known"] += 1
            continue
        if any(_same_project(farm, other) for other in added):
            stats["windfarms_listed_twice"] += 1
            continue
        plants[farm.id] = farm
        added.append(farm)
        stats["windfarms_added"] += 1


def _km(a: PowerPlant, b: PowerPlant) -> float:
    return haversine_m(a.location[0], a.location[1], b.location[0], b.location[1]) / 1000


def _project_name(name: str | None) -> str:
    """The name without the words every wind farm shares, case, spaces and punctuation."""
    text = (name or "").casefold()
    for word in _GENERIC_NAME_WORDS:
        text = text.replace(word, "")
    return "".join(character for character in text if character.isalnum())


def _same_project(a: PowerPlant, b: PowerPlant) -> bool:
    name = _project_name(a.name)
    return (
        name != ""
        and name == _project_name(b.name)
        and a.capacity_mw is not None
        and a.capacity_mw == b.capacity_mw
        and _km(a, b) <= LISTED_TWICE_KM
    )
