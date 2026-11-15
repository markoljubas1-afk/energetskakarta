"""Turn a published build into PMTiles archives with tippecanoe, then verify the archives.

The canonical ``*.ndjson`` files carry full provenance; tiles only carry what the map draws and
filters on.

Zoom visibility is decided here, never by tippecanoe's density heuristics: every grid feature carries
a ``minzoom`` attribute and one global feature filter (``$zoom >= minzoom``) keeps it out of lower
zooms. ``--drop-rate=1`` and the absence of any ``--drop-*`` option guarantee that nothing else is
removed; a tile that is too large makes the build fail loudly instead of silently losing assets.

Per-feature ``tippecanoe.minzoom`` is deliberately NOT used: tippecanoe 2.49 then keeps only one
feature per tile (tasks/lessons.md, L-009).
"""

from __future__ import annotations

import gzip
import json
import logging
import re
import shutil
import struct
import subprocess
import tempfile
from collections.abc import Callable, Iterable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from energymap.files import write_json_atomic

log = logging.getLogger(__name__)

TILES_INFO_FILE = "tiles.json"
# Downloadable data layers. Core layers exist in every build; optional ones (offshore pipelines from
# EMODnet) may be missing from builds made before they were introduced, which must stay publishable.
CORE_LAYERS: tuple[str, ...] = ("lines", "substations", "plants")
OPTIONAL_LAYERS: tuple[str, ...] = (
    "pipelines",
    "distribution_lines",
    "distribution_substations",
    "datacenters",
    "chargers",
    "cities",
    "extraction",
)
LAYERS: tuple[str, ...] = CORE_LAYERS + OPTIONAL_LAYERS
PIPELINE_MINZOOM = 5
# There are few data centres and they are spread out, so one zoom step is enough; if the layer ever
# grows into the thousands this becomes a rule by power, like the others.
DATACENTER_MINZOOM = 6
# Charging stations are consumer infrastructure in the tens of thousands: street-level detail, and their
# own archive, so a visitor who never switches the layer on never downloads any of it.
CHARGER_MINZOOM = 11
# Cities by population: the few large ones from the regional view, everyone else from the country view.
CITY_LARGE_POPULATION = 100_000
CITY_MEDIUM_POPULATION = 20_000
CITY_MINZOOMS = (5, 7, 9)
# Extraction sites by kind: the few offshore platforms from the regional view, mines from the country
# view, wells (hundreds per basin) and shafts, adits and open pits at street level. Own archive: opt-in.
EXTRACTION_MINZOOMS: dict[str, int] = {
    "platform": 6,
    "mine": 8,
    "well": 9,
    "shaft": 10,
    "adit": 10,
    "quarry": 10,
}
EXTRACTION_ARCHIVE_MINZOOM = min(EXTRACTION_MINZOOMS.values())


@dataclass(frozen=True, slots=True)
class Archive:
    """One PMTiles file. Country polygons live in their own low-zoom archive: filling every z14 tile of
    eight countries would multiply the archive size, while the map can simply overzoom z8 outlines."""

    key: str
    file: str
    layers: tuple[str, ...]
    min_zoom: int
    max_zoom: int


GRID = Archive(
    "grid", "grid.pmtiles", (*CORE_LAYERS, "pipelines", "datacenters", "cities"), min_zoom=3, max_zoom=14
)
BOUNDARIES = Archive("boundaries", "boundaries.pmtiles", ("countries",), min_zoom=0, max_zoom=8)
# The distribution network is an opt-in layer, so it lives in its own archive: a browser that never
# switches it on never downloads a byte of it, and its sheer number of features cannot push a tile of
# the transmission grid over the size limit. It only starts where street-level detail begins.
DISTRIBUTION = Archive(
    "distribution",
    "distribution.pmtiles",
    ("distribution_lines", "distribution_substations"),
    min_zoom=10,
    max_zoom=14,
)
CHARGERS = Archive("chargers", "chargers.pmtiles", ("chargers",), min_zoom=CHARGER_MINZOOM, max_zoom=14)
EXTRACTION = Archive(
    "extraction", "extraction.pmtiles", ("extraction",), min_zoom=EXTRACTION_ARCHIVE_MINZOOM, max_zoom=14
)
ARCHIVES: tuple[Archive, ...] = (GRID, BOUNDARIES)
# Built and published only when the build has features for them; older builds simply do not have them.
OPTIONAL_ARCHIVES: tuple[Archive, ...] = (DISTRIBUTION, CHARGERS, EXTRACTION)
ALL_ARCHIVES: tuple[Archive, ...] = ARCHIVES + OPTIONAL_ARCHIVES
TILE_LAYERS: tuple[str, ...] = tuple(layer for archive in ALL_ARCHIVES for layer in archive.layers)
MIN_TIPPECANOE = (2, 17)  # first release able to write PMTiles directly
TIPPECANOE_TIMEOUT_S = 3 * 60 * 60
ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"

_PMTILES_MAGIC = b"PMTiles"
_PMTILES_HEADER_LEN = 127
_PMTILES_TILE_TYPE_MVT = 1
_PMTILES_COMPRESSION_NONE = 1
_PMTILES_COMPRESSION_GZIP = 2
_VERSION = re.compile(r"v?(\d+)\.(\d+)\.(\d+)")


class TilesError(RuntimeError):
    """Tiles could not be produced or failed verification."""


MINZOOM_ATTRIBUTE = "minzoom"
# Every value the zoom rules below can return; the tippecanoe filter enumerates them. A value missing
# here would drop those features silently, so test_tiles.py checks the rules against this tuple.
ZOOM_STEPS: tuple[int, ...] = (3, 5, 6, 7, 8, 9, 10, 11, 12)  # includes PIPELINE_ and DATACENTER_MINZOOM
# Sub-transmission (35/30 kV) is the only distribution level that means anything at country zoom; the
# 10 and 20 kV network is a street-level detail and waits one more zoom step.
DISTRIBUTION_UPPER_KV = 30.0


# ---------------------------------------------------------------- zoom rules


def line_minzoom(max_kv: float | None, is_interconnector: bool) -> int:
    if max_kv is not None and max_kv >= 380:
        zoom = 3
    elif max_kv is not None and max_kv >= 220:
        zoom = 5
    elif max_kv is not None and max_kv >= 110:
        zoom = 7
    else:
        zoom = 8
    return min(zoom, 5) if is_interconnector else zoom


def distribution_line_minzoom(max_kv: float | None) -> int:
    return 10 if max_kv is not None and max_kv >= DISTRIBUTION_UPPER_KV else 11


def distribution_substation_minzoom(max_kv: float | None) -> int:
    return 11 if max_kv is not None and max_kv >= DISTRIBUTION_UPPER_KV else 12


def substation_minzoom(max_kv: float | None) -> int:
    if max_kv is not None and max_kv >= 380:
        return 6
    if max_kv is not None and max_kv >= 220:
        return 7
    return 9


def plant_minzoom(capacity_mw: float | None) -> int:
    if capacity_mw is not None and capacity_mw >= 500:
        return 3
    if capacity_mw is not None and capacity_mw >= 100:
        return 5
    if capacity_mw is not None and capacity_mw >= 10:
        return 7
    return 9


# ---------------------------------------------------------------- tile features


def _compact(props: Mapping[str, Any]) -> dict[str, Any]:
    """Tippecanoe has no null type; absent is the honest encoding."""
    return {k: v for k, v in props.items() if v is not None}


def _joined(values: Iterable[Any]) -> str | None:
    text = ";".join(f"{v:g}" if isinstance(v, float) else str(v) for v in values)
    return text or None


def _line_props(props: Mapping[str, Any]) -> dict[str, Any]:
    """Everything a line shows on the map. Transmission and distribution carry the same properties and
    are read by the same code in the browser; only their archive and their zoom rule differ."""
    return {
        "id": props["id"],
        "kind": props["kind"],
        "status": props["status"],
        "maxVoltageKv": props["maxVoltageKv"],
        "voltages": _joined(props["voltagesKv"]),
        "circuits": props["circuits"],
        "isHvdc": props["isHvdc"],
        "isInterconnector": props["isInterconnector"],
        "countries": ",".join(props["countries"]),
        "operator": props["operator"],
    }


def _line(props: Mapping[str, Any]) -> dict[str, Any]:
    minzoom = line_minzoom(props["maxVoltageKv"], props["isInterconnector"])
    return {**_line_props(props), MINZOOM_ATTRIBUTE: minzoom}


def _distribution_line(props: Mapping[str, Any]) -> dict[str, Any]:
    minzoom = distribution_line_minzoom(props["maxVoltageKv"])
    return {**_line_props(props), MINZOOM_ATTRIBUTE: minzoom}


def _substation_props(props: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": props["id"],
        "name": props["name"],
        "status": props["status"],
        "maxVoltageKv": props["maxVoltageKv"],
        "voltages": _joined(props["voltagesKv"]),
        "country": props["country"],
        "operator": props["operator"],
    }


def _substation(props: Mapping[str, Any]) -> dict[str, Any]:
    return {**_substation_props(props), MINZOOM_ATTRIBUTE: substation_minzoom(props["maxVoltageKv"])}


def _distribution_substation(props: Mapping[str, Any]) -> dict[str, Any]:
    minzoom = distribution_substation_minzoom(props["maxVoltageKv"])
    return {**_substation_props(props), MINZOOM_ATTRIBUTE: minzoom}


def _sources(props: Mapping[str, Any]) -> tuple[str | None, str | None]:
    """Distinct sources ("openstreetmap,gem") and the GEM wiki page, if any, for the details panel."""
    provenance = props.get("provenance") or []
    names = sorted(
        {p["source"] for p in provenance if isinstance(p, dict) and isinstance(p.get("source"), str)}
    )
    gem_url = next(
        (
            p.get("url")
            for p in provenance
            if isinstance(p, dict) and p.get("source") == "gem" and p.get("url")
        ),
        None,
    )
    return (",".join(names) or None), gem_url


def _plant(props: Mapping[str, Any]) -> dict[str, Any]:
    sources, gem_url = _sources(props)
    return {
        "id": props["id"],
        "sources": sources,
        "gemUrl": gem_url,
        "name": props["name"],
        "status": props["status"],
        "technology": props["technology"],
        "capacityMw": props["capacityMw"],
        "commissioningYear": props["commissioningYear"],
        "country": props["country"],
        "operator": props["operator"],
        MINZOOM_ATTRIBUTE: plant_minzoom(props["capacityMw"]),
    }


def _datacenter(props: Mapping[str, Any]) -> dict[str, Any]:
    sources, _ = _sources(props)
    return {
        "id": props["id"],
        "sources": sources,
        "sourceUrl": _manual_url(props),
        "name": props["name"],
        "status": props["status"],
        "powerMw": props["powerMw"],
        "commissioningYear": props["commissioningYear"],
        "country": props["country"],
        "operator": props["operator"],
        MINZOOM_ATTRIBUTE: DATACENTER_MINZOOM,
    }


def _manual_url(props: Mapping[str, Any]) -> str | None:
    """The page a hand-kept record was taken from, so the map can show where the claim comes from."""
    provenance = props.get("provenance") or []
    return next(
        (
            p.get("url")
            for p in provenance
            if isinstance(p, dict) and p.get("source") == "manual" and p.get("url")
        ),
        None,
    )


def _charger(props: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": props["id"],
        "name": props["name"],
        "status": props["status"],
        "points": props["points"],
        "country": props["country"],
        "operator": props["operator"],
        MINZOOM_ATTRIBUTE: CHARGER_MINZOOM,
    }


def extraction_minzoom(kind: str) -> int:
    return EXTRACTION_MINZOOMS[kind]


def _extraction(props: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": props["id"],
        "name": props["name"],
        "status": props["status"],
        "kind": props["kind"],
        "substance": props["substance"],
        "country": props["country"],
        "operator": props["operator"],
        MINZOOM_ATTRIBUTE: extraction_minzoom(props["kind"]),
    }


def _country(props: Mapping[str, Any]) -> dict[str, Any]:
    return {"code": props["code"], "inScope": props["inScope"]}


def _pipeline(props: Mapping[str, Any]) -> dict[str, Any]:
    sources, _ = _sources(props)
    return {
        "id": props["id"],
        "sources": sources,
        "name": props["name"],
        "status": props["status"],
        "medium": props["medium"],
        "diameterIn": props["diameterIn"],
        "lengthKm": props["lengthKm"],
        "commissioningYear": props["commissioningYear"],
        "countries": ",".join(props["countries"]),
        "operator": props["operator"],
        MINZOOM_ATTRIBUTE: PIPELINE_MINZOOM,
    }


def city_minzoom(population: int | None) -> int:
    if population is not None and population >= CITY_LARGE_POPULATION:
        return CITY_MINZOOMS[0]
    if population is not None and population >= CITY_MEDIUM_POPULATION:
        return CITY_MINZOOMS[1]
    return CITY_MINZOOMS[2]


def _city(props: Mapping[str, Any]) -> dict[str, Any]:
    """Sector figures travel as one JSON string: tile properties are scalars, and the map shows them
    only in the details panel."""
    sectors = {
        sector: {"e": round(float(v["electricityMwh"])), "t": round(float(v["totalMwh"]))}
        for sector, v in props["sectors"].items()
    }
    return {
        "id": props["id"],
        "name": props["name"],
        "country": props["country"],
        "population": props["population"],
        "inventoryYear": props["inventoryYear"],
        "baseline": props["baseline"],
        "electricityMwh": round(float(props["electricityMwh"])),
        "totalMwh": round(float(props["totalMwh"])),
        "baselineYear": props["baselineYear"],
        "baselineElectricityMwh": (
            None if props["baselineElectricityMwh"] is None else round(float(props["baselineElectricityMwh"]))
        ),
        "sectors": json.dumps(sectors, separators=(",", ":"), sort_keys=True),
        MINZOOM_ATTRIBUTE: city_minzoom(props["population"]),
    }


_SHAPERS: dict[str, Callable[[Mapping[str, Any]], dict[str, Any]]] = {
    "countries": _country,
    "lines": _line,
    "substations": _substation,
    "plants": _plant,
    "pipelines": _pipeline,
    "distribution_lines": _distribution_line,
    "distribution_substations": _distribution_substation,
    "datacenters": _datacenter,
    "chargers": _charger,
    "cities": _city,
    "extraction": _extraction,
}


def tile_feature(layer: str, feature: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "type": "Feature",
        "geometry": feature["geometry"],
        "properties": _compact(_SHAPERS[layer](feature["properties"])),
    }


def zoom_filter(layers: Iterable[str]) -> dict[str, Any]:
    """tippecanoe ``--feature-filter``: keep a feature only from its ``minzoom`` upwards.

    The filter language cannot compare two values directly, so each possible zoom step gets a clause.
    """
    clause = ["any"] + [
        ["all", ["==", MINZOOM_ATTRIBUTE, zoom], [">=", "$zoom", zoom]] for zoom in ZOOM_STEPS
    ]
    return {layer: clause for layer in layers}


def prepare_layers(build_dir: Path, work_dir: Path) -> dict[str, Path]:
    prepared: dict[str, Path] = {}
    for layer in TILE_LAYERS:
        source = build_dir / f"{layer}.ndjson"
        target = work_dir / f"{layer}.ndjson"
        if not source.exists() and layer in OPTIONAL_LAYERS:
            target.write_text("", encoding="utf-8")  # older build: the layer did not exist yet
            prepared[layer] = target
            continue
        if not source.exists():
            raise TilesError(f"Build {build_dir.name} has no {source.name}")
        with source.open(encoding="utf-8") as src, target.open("w", encoding="utf-8") as dst:
            for line_no, line in enumerate(src, start=1):
                if not line.strip():
                    continue
                try:
                    feature = tile_feature(layer, json.loads(line))
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    raise TilesError(f"{source.name}:{line_no} is not a valid build feature: {exc}") from exc
                dst.write(json.dumps(feature, ensure_ascii=False, separators=(",", ":")))
                dst.write("\n")
        prepared[layer] = target
    return prepared


# ---------------------------------------------------------------- tippecanoe


def tippecanoe_version(binary: str) -> tuple[int, int, int]:
    try:
        completed = subprocess.run(
            [binary, "--version"], capture_output=True, text=True, timeout=30, check=False
        )
    except FileNotFoundError as exc:
        raise TilesError(
            f"tippecanoe not found ({binary}); install it, e.g. `apt install tippecanoe`"
        ) from exc
    match = _VERSION.search(completed.stdout + completed.stderr)
    if not match:
        raise TilesError(f"Cannot read tippecanoe version from: {completed.stderr.strip()!r}")
    version = (int(match[1]), int(match[2]), int(match[3]))
    if version[:2] < MIN_TIPPECANOE:
        raise TilesError(f"tippecanoe {version} is too old; PMTiles output needs {MIN_TIPPECANOE} or newer")
    return version


def tippecanoe_command(
    binary: str, archive: Archive, layers: Mapping[str, Path], output: Path, name: str
) -> list[str]:
    command = [
        binary,
        "--output",
        str(output),
        "--force",
        f"--minimum-zoom={archive.min_zoom}",
        f"--maximum-zoom={archive.max_zoom}",
        # Never thin features by density; visibility per zoom is our own rule (see module docstring).
        "--drop-rate=1",
        "--read-parallel",
        "--no-progress-indicator",
        f"--name={name}",
        f"--attribution={ATTRIBUTION}",
    ]
    if archive is BOUNDARIES:
        # outlines must stay closed and shared edges must not drift apart between neighbours
        command += ["--detect-shared-borders", "--no-tiny-polygon-reduction"]
    else:
        command.append(f"--feature-filter={json.dumps(zoom_filter(archive.layers), separators=(',', ':'))}")
    command += [f"--named-layer={layer}:{layers[layer]}" for layer in archive.layers]
    return command


# ---------------------------------------------------------------- PMTiles verification


@dataclass(frozen=True, slots=True)
class TilesInfo:
    file: str
    bytes: int
    min_zoom: int
    max_zoom: int
    bounds: tuple[float, float, float, float]
    addressed_tiles: int
    tippecanoe: str


def read_pmtiles_header(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        raw = handle.read(_PMTILES_HEADER_LEN)
    if len(raw) < _PMTILES_HEADER_LEN or raw[:7] != _PMTILES_MAGIC:
        raise TilesError(f"{path.name} is not a PMTiles archive")
    if raw[7] != 3:
        raise TilesError(f"{path.name} is PMTiles v{raw[7]}, expected v3")
    addressed, entries, contents = struct.unpack_from("<QQQ", raw, 72)
    tile_type, min_zoom, max_zoom = struct.unpack_from("<BBB", raw, 99)
    min_lon, min_lat, max_lon, max_lat = struct.unpack_from("<iiii", raw, 102)
    return {
        "addressed_tiles": addressed,
        "tile_entries": entries,
        "tile_contents": contents,
        "tile_type": tile_type,
        "min_zoom": min_zoom,
        "max_zoom": max_zoom,
        "bounds": tuple(round(v / 1e7, 6) for v in (min_lon, min_lat, max_lon, max_lat)),
    }


def read_pmtiles_metadata(path: Path) -> dict[str, Any]:
    """Decode the archive's JSON metadata (vector layer list, attribution, ...)."""
    with path.open("rb") as handle:
        raw = handle.read(_PMTILES_HEADER_LEN)
        offset, length = struct.unpack_from("<QQ", raw, 24)
        compression = raw[97]
        handle.seek(offset)
        blob = handle.read(length)
    if compression == _PMTILES_COMPRESSION_GZIP:
        blob = gzip.decompress(blob)
    elif compression != _PMTILES_COMPRESSION_NONE:
        raise TilesError(f"{path.name} uses unsupported metadata compression {compression}")
    try:
        metadata: dict[str, Any] = json.loads(blob)
    except json.JSONDecodeError as exc:
        raise TilesError(f"{path.name} has unreadable metadata: {exc}") from exc
    return metadata


def verify(path: Path, archive: Archive = GRID) -> dict[str, Any]:
    header = read_pmtiles_header(path)
    problems = []
    if header["tile_type"] != _PMTILES_TILE_TYPE_MVT:
        problems.append(f"tile type {header['tile_type']} is not MVT")
    if header["addressed_tiles"] == 0:
        problems.append("archive contains no tiles")
    if header["min_zoom"] != archive.min_zoom or header["max_zoom"] < archive.max_zoom:
        found = f"z{header['min_zoom']}-z{header['max_zoom']}"
        problems.append(f"zoom range {found} != z{archive.min_zoom}-z{archive.max_zoom}")
    if not problems:
        present = {layer.get("id") for layer in read_pmtiles_metadata(path).get("vector_layers", [])}
        # an optional layer without features is legitimately absent from the metadata
        missing = sorted(set(archive.layers) - set(OPTIONAL_LAYERS) - present)
        if missing:
            problems.append(f"missing layers: {', '.join(missing)}")
    if problems:
        raise TilesError(f"{path.name} failed verification: " + "; ".join(problems))
    return header


# ---------------------------------------------------------------- orchestration


def _run_archive(
    build_dir: Path, tippecanoe: str, version: str, archive: Archive, layers: Mapping[str, Path]
) -> TilesInfo:
    output = build_dir / archive.file
    part = build_dir / f".{archive.file}.part.pmtiles"
    command = tippecanoe_command(
        tippecanoe, archive, layers, part, name=f"energymap {archive.key} {build_dir.name}"
    )
    try:
        completed = subprocess.run(
            command, capture_output=True, text=True, timeout=TIPPECANOE_TIMEOUT_S, check=False
        )
        if completed.returncode != 0:
            raise TilesError(
                f"tippecanoe failed ({completed.returncode}): {completed.stderr.strip()[-2000:]}"
            )
        header = verify(part, archive)
        part.replace(output)
    except subprocess.TimeoutExpired as exc:
        raise TilesError(f"tippecanoe timed out after {TIPPECANOE_TIMEOUT_S} s") from exc
    finally:
        part.unlink(missing_ok=True)
    return TilesInfo(
        file=archive.file,
        bytes=output.stat().st_size,
        min_zoom=header["min_zoom"],
        max_zoom=header["max_zoom"],
        bounds=header["bounds"],
        addressed_tiles=header["addressed_tiles"],
        tippecanoe=version,
    )


def _has_features(layers: Mapping[str, Path], archive: Archive) -> bool:
    return any(layers[layer].stat().st_size > 0 for layer in archive.layers)


def build_tiles(build_dir: Path, tippecanoe: str = "tippecanoe") -> dict[str, TilesInfo]:
    """Create every archive and ``tiles.json`` inside ``build_dir``. Safe to rerun.

    An optional archive with no features at all is skipped rather than written empty: tippecanoe cannot
    produce an archive without a single feature, and a build from before that layer existed is still
    perfectly publishable.
    """
    version = ".".join(map(str, tippecanoe_version(tippecanoe)))
    infos: dict[str, TilesInfo] = {}
    with tempfile.TemporaryDirectory(prefix="energymap-tiles-") as tmp:
        layers = prepare_layers(build_dir, Path(tmp))
        for archive in ALL_ARCHIVES:
            if archive in OPTIONAL_ARCHIVES:
                stale = build_dir / archive.file
                if not _has_features(layers, archive):
                    stale.unlink(missing_ok=True)  # a rerun must not leave a previous archive behind
                    log.info("skipping empty archive", extra={"archive": archive.key})
                    continue
            infos[archive.key] = _run_archive(build_dir, tippecanoe, version, archive, layers)
    write_json_atomic(build_dir / TILES_INFO_FILE, {key: asdict(info) for key, info in infos.items()})
    log.info(
        "built tiles", extra={"build": build_dir.name, "archives": {k: asdict(v) for k, v in infos.items()}}
    )
    return infos


def tippecanoe_available(binary: str = "tippecanoe") -> bool:
    return shutil.which(binary) is not None
