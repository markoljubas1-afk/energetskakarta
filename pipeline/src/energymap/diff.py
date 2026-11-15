"""What changed between the published build and a new one, per layer and country.

Features are matched by ``id`` (the OSM object). A feature counts as changed when its geometry or any
property except provenance differs; provenance carries ``retrievedAt``, which changes on every build and
would otherwise mark everything as changed.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

VOLATILE_PROPERTIES = frozenset({"provenance"})
MAX_EXAMPLES = 10
DIFF_FILE = "diff.json"
DIFF_VERSION = 1

LAYER_NAMES_HR = {
    "lines": "Dalekovodi i kabeli",
    "substations": "Trafostanice",
    "plants": "Elektrane",
    "pipelines": "Cjevovodi (more)",
    "datacenters": "Podatkovni centri",
    "chargers": "Punionice",
    "extraction": "Crpilišta i rudnici",
    "distribution_lines": "Distribucijski vodovi",
    "distribution_substations": "Distribucijske trafostanice",
}

Point = tuple[float, float]


@dataclass(frozen=True, slots=True)
class Entry:
    fingerprint: str
    name: str | None
    country: str | None
    #: where the website can fly to when a reader picks the example; None for a geometry it cannot read
    point: Point | None = None


def _positions(coordinates: Any) -> Iterable[Point]:
    """Every (lon, lat) pair in a GeoJSON coordinate array of any nesting depth."""
    if (
        isinstance(coordinates, list)
        and len(coordinates) >= 2
        and all(isinstance(v, int | float) for v in coordinates[:2])
    ):
        yield float(coordinates[0]), float(coordinates[1])
    elif isinstance(coordinates, list):
        for part in coordinates:
            yield from _positions(part)


def representative_point(geometry: Mapping[str, Any] | None) -> Point | None:
    """Centre of the geometry's bounding box: good enough to fly to, and cheap for every feature."""
    if not geometry:
        return None
    points = list(_positions(geometry.get("coordinates")))
    if not points:
        return None
    lons = [p[0] for p in points]
    lats = [p[1] for p in points]
    return round((min(lons) + max(lons)) / 2, 5), round((min(lats) + max(lats)) / 2, 5)


def entry(feature: Mapping[str, Any]) -> Entry:
    props = feature.get("properties") or {}
    stable = {k: v for k, v in props.items() if k not in VOLATILE_PROPERTIES}
    geometry = feature.get("geometry")
    payload = json.dumps([stable, geometry], sort_keys=True, separators=(",", ":"))
    countries = props.get("countries")
    country = props.get("country") or (countries[0] if isinstance(countries, list) and countries else None)
    name = props.get("name")
    return Entry(
        fingerprint=hashlib.sha1(payload.encode(), usedforsecurity=False).hexdigest(),
        name=name if isinstance(name, str) else None,
        country=country if isinstance(country, str) else None,
        point=representative_point(geometry if isinstance(geometry, Mapping) else None),
    )


def index(features: Iterable[Mapping[str, Any]]) -> dict[str, Entry]:
    result: dict[str, Entry] = {}
    for feature in features:
        key = feature.get("id")
        if not isinstance(key, str):
            raise ValueError("feature without a string id")
        result[key] = entry(feature)
    return result


@dataclass(slots=True)
class LayerDiff:
    added: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    changed: list[str] = field(default_factory=list)
    unchanged: int = 0
    by_country: dict[str, Counter[str]] = field(default_factory=dict)
    names: dict[str, str | None] = field(default_factory=dict)
    #: where each listed feature is (for a removed one: where it was)
    points: dict[str, Point | None] = field(default_factory=dict)

    def _note(self, key: str, item: Entry, kind: str) -> None:
        self.names[key] = item.name
        self.points[key] = item.point
        self.by_country.setdefault(item.country or "?", Counter())[kind] += 1


def compare(previous: Mapping[str, Entry], current: Mapping[str, Entry]) -> LayerDiff:
    diff = LayerDiff()
    for key in sorted(current.keys() - previous.keys()):
        diff.added.append(key)
        diff._note(key, current[key], "added")
    for key in sorted(previous.keys() - current.keys()):
        diff.removed.append(key)
        diff._note(key, previous[key], "removed")
    for key in sorted(previous.keys() & current.keys()):
        if previous[key].fingerprint == current[key].fingerprint:
            diff.unchanged += 1
        else:
            diff.changed.append(key)
            diff._note(key, current[key], "changed")
    return diff


@dataclass(frozen=True, slots=True)
class BuildDiff:
    build_id: str
    baseline_build_id: str | None
    layers: Mapping[str, LayerDiff]


def to_json(diff: BuildDiff) -> dict[str, Any]:
    def examples(layer: LayerDiff, keys: list[str]) -> list[dict[str, Any]]:
        result = []
        for key in keys[:MAX_EXAMPLES]:
            point = layer.points.get(key)
            example: dict[str, Any] = {"id": key, "name": layer.names.get(key)}
            if point is not None:
                example["lon"], example["lat"] = point
            result.append(example)
        return result

    return {
        "version": DIFF_VERSION,
        "buildId": diff.build_id,
        "baselineBuildId": diff.baseline_build_id,
        "layers": {
            name: {
                "added": len(layer.added),
                "removed": len(layer.removed),
                "changed": len(layer.changed),
                "unchanged": layer.unchanged,
                "byCountry": {code: dict(sorted(c.items())) for code, c in sorted(layer.by_country.items())},
                "examples": {
                    "added": examples(layer, layer.added),
                    "removed": examples(layer, layer.removed),
                    "changed": examples(layer, layer.changed),
                },
            }
            for name, layer in diff.layers.items()
        },
    }


def _label(key: str, name: str | None) -> str:
    osm = key.removeprefix("osm:")
    link = f"[{osm}](https://www.openstreetmap.org/{osm})"
    return f"{name} ({link})" if name else link


def to_markdown(diff: BuildDiff) -> str:
    lines = [f"## Promjene podataka: build {diff.build_id}", ""]
    if diff.baseline_build_id is None:
        lines += ["Nema objavljene verzije za usporedbu: ovo je prva objava, sve je novo.", ""]
    else:
        lines += [f"Usporedba s objavljenim buildom {diff.baseline_build_id}.", ""]
    lines += ["| Sloj | Novo | Uklonjeno | Promijenjeno | Bez promjene |", "|---|---:|---:|---:|---:|"]
    for name, layer in diff.layers.items():
        lines.append(
            f"| {LAYER_NAMES_HR.get(name, name)} | {len(layer.added)} | {len(layer.removed)} "
            f"| {len(layer.changed)} | {layer.unchanged} |"
        )
    for name, layer in diff.layers.items():
        if not (layer.added or layer.removed or layer.changed):
            continue
        lines += ["", f"### {LAYER_NAMES_HR.get(name, name)}", ""]
        countries = ", ".join(
            f"{code}: +{c['added']} / -{c['removed']} / ~{c['changed']}"
            for code, c in sorted(layer.by_country.items())
        )
        lines.append(f"Po zemljama (novo / uklonjeno / promijenjeno): {countries}")
        for title, keys in (
            ("Novo", layer.added),
            ("Uklonjeno", layer.removed),
            ("Promijenjeno", layer.changed),
        ):
            if not keys:
                continue
            shown = ", ".join(_label(key, layer.names.get(key)) for key in keys[:MAX_EXAMPLES])
            more = f" i još {len(keys) - MAX_EXAMPLES}" if len(keys) > MAX_EXAMPLES else ""
            lines.append(f"- **{title}:** {shown}{more}")
    return "\n".join(lines) + "\n"
