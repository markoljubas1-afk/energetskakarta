from __future__ import annotations

import json
import math
import os
import shutil
import struct
import subprocess
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from conftest import BuildFactory
from energymap import tiles
from energymap.schema import ExtractionKind

needs_tippecanoe = pytest.mark.skipif(
    not tiles.tippecanoe_available() and os.environ.get("ENERGYMAP_REQUIRE_TIPPECANOE") != "1",
    reason="tippecanoe is not installed (CI installs it and sets ENERGYMAP_REQUIRE_TIPPECANOE=1)",
)


@pytest.mark.parametrize(
    ("kv", "interconnector", "zoom"),
    [(400.0, False, 3), (380.0, False, 3), (220.0, False, 5), (110.0, False, 7), (110.0, True, 5),
     (66.0, False, 8), (None, False, 8), (None, True, 5), (400.0, True, 3)],
)  # fmt: skip
def test_line_minzoom(kv: float | None, interconnector: bool, zoom: int) -> None:
    assert tiles.line_minzoom(kv, interconnector) == zoom


@pytest.mark.parametrize(("kv", "zoom"), [(400.0, 6), (220.0, 7), (110.0, 9), (None, 9)])
def test_substation_minzoom(kv: float | None, zoom: int) -> None:
    assert tiles.substation_minzoom(kv) == zoom


@pytest.mark.parametrize(
    ("mw", "zoom"), [(1200.0, 3), (500.0, 3), (276.0, 5), (10.0, 7), (9.9, 9), (None, 9)]
)
def test_plant_minzoom(mw: float | None, zoom: int) -> None:
    assert tiles.plant_minzoom(mw) == zoom


@pytest.mark.parametrize(("mw", "zoom"), [(3200.0, 7), (276.0, 7), (10.0, 7), (9.9, 9), (None, 9)])
def test_a_planned_plant_waits_for_a_closer_map(mw: float | None, zoom: int) -> None:
    assert tiles.plant_minzoom(mw, planned=True) == zoom
    assert tiles.PLANNED_PLANT_MINZOOM in tiles.ZOOM_STEPS


def test_tile_feature_is_slim_and_has_no_nulls() -> None:
    feature = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[14.5, 45.5], [15.5, 45.5]]},
        "properties": {
            "id": "osm:way/1", "kind": "line", "status": "operating", "maxVoltageKv": 400.0,
            "voltagesKv": [400.0, 220.0], "circuits": None, "isHvdc": False, "isInterconnector": True,
            "countries": ["HR", "SI"], "operator": None, "provenance": [{"sourceId": "way/1"}],
            "layer": "lines",
        },
    }  # fmt: skip
    out = tiles.tile_feature("lines", feature)
    assert "tippecanoe" not in out  # per-feature options make tippecanoe 2.49 drop features (L-009)
    assert out["properties"] == {
        "id": "osm:way/1", "kind": "line", "status": "operating", "maxVoltageKv": 400.0,
        "voltages": "400;220", "isHvdc": False, "isInterconnector": True, "countries": "HR,SI",
        "minzoom": 3,
    }  # fmt: skip


def test_country_features_have_no_zoom_attribute() -> None:
    feature = {"type": "Feature", "geometry": None, "properties": {"code": "HR", "inScope": True}}
    assert tiles.tile_feature("countries", feature)["properties"] == {"code": "HR", "inScope": True}


@pytest.mark.parametrize("kv", [None, 20.0, 66.0, 110.0, 220.0, 380.0, 400.0, 750.0])
@pytest.mark.parametrize("mw", [None, 0.1, 9.9, 10.0, 100.0, 500.0, 5000.0])
def test_every_rule_output_is_a_filtered_zoom_step(kv: float | None, mw: float | None) -> None:
    """The feature filter enumerates ZOOM_STEPS; a rule returning anything else would hide features."""
    outputs = {
        tiles.line_minzoom(kv, False),
        tiles.line_minzoom(kv, True),
        tiles.substation_minzoom(kv),
        tiles.plant_minzoom(mw),
        tiles.distribution_line_minzoom(kv),
        tiles.distribution_substation_minzoom(kv),
    }
    assert outputs <= set(tiles.ZOOM_STEPS)


def test_extraction_rules_stay_inside_their_archive_and_the_filter() -> None:
    assert set(tiles.EXTRACTION_MINZOOMS) == {kind.value for kind in ExtractionKind}
    for kind in ExtractionKind:
        zoom = tiles.extraction_minzoom(kind.value)
        assert zoom in tiles.ZOOM_STEPS and zoom >= tiles.EXTRACTION.min_zoom
    feature = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [16.0, 45.5]},
        "properties": {
            "id": "osm:node/80", "name": None, "status": "operating", "kind": "well", "substance": "gas",
            "country": "HR", "operator": None, "provenance": [], "layer": "extraction",
        },
    }  # fmt: skip
    assert tiles.tile_feature("extraction", feature)["properties"] == {
        "id": "osm:node/80", "status": "operating", "kind": "well", "substance": "gas", "country": "HR",
        "minzoom": 3,
    }  # fmt: skip


@pytest.mark.parametrize("kv", [None, 10.0, 20.0, 29.9, 30.0, 35.0, 110.0])
def test_distribution_starts_inside_its_own_archive(kv: float | None) -> None:
    """Whatever the rules return, nothing may fall below the archive's own minimum zoom: those features
    would be built into no tile at all."""
    assert tiles.distribution_line_minzoom(kv) >= tiles.DISTRIBUTION.min_zoom
    assert tiles.distribution_substation_minzoom(kv) >= tiles.DISTRIBUTION.min_zoom
    # a substation is only worth drawing once the line that feeds it is there
    assert tiles.distribution_substation_minzoom(kv) > tiles.distribution_line_minzoom(kv)


def test_zoom_filter_shape() -> None:
    expr = tiles.zoom_filter(["lines"])["lines"]
    assert expr[0] == "any"
    assert ["all", ["==", "minzoom", 7], [">=", "$zoom", 7]] in expr
    assert len(expr) == 1 + len(tiles.ZOOM_STEPS)


def test_prepare_rejects_corrupt_build(tmp_path: Path) -> None:
    build = tmp_path / "b"
    build.mkdir()
    for layer in tiles.TILE_LAYERS:
        (build / f"{layer}.ndjson").write_text('{"not": "a feature"}\n')
    with pytest.raises(tiles.TilesError, match=r"lines\.ndjson:1"):
        tiles.prepare_layers(build, tmp_path)


def test_prepare_requires_all_layers(tmp_path: Path) -> None:
    with pytest.raises(tiles.TilesError, match=r"no lines\.ndjson"):
        tiles.prepare_layers(tmp_path, tmp_path)


def _archive(*, layers: tuple[str, ...] = tiles.GRID.layers, header: dict[str, int] | None = None) -> bytes:
    """Minimal PMTiles v3 file: header plus uncompressed JSON metadata."""
    metadata = json.dumps({"vector_layers": [{"id": layer} for layer in layers]}).encode()
    raw = bytearray(_header(**(header or {})))
    struct.pack_into("<QQ", raw, 24, 127, len(metadata))
    raw[97] = 1
    return bytes(raw) + metadata


def _header(**overrides: int) -> bytes:
    values = {"version": 3, "addressed": 10, "tile_type": 1, "min_zoom": 3, "max_zoom": 14} | overrides
    raw = bytearray(127)
    raw[:7] = b"PMTiles"
    raw[7] = values["version"]
    struct.pack_into("<QQQ", raw, 72, values["addressed"], 5, 5)
    struct.pack_into("<BBB", raw, 99, values["tile_type"], values["min_zoom"], values["max_zoom"])
    struct.pack_into("<iiii", raw, 102, 145_000_000, 452_000_000, 165_000_000, 458_000_000)
    return bytes(raw)


def test_header_parsing(tmp_path: Path) -> None:
    path = tmp_path / "t.pmtiles"
    path.write_bytes(_archive())
    header = tiles.verify(path)
    assert header["bounds"] == (14.5, 45.2, 16.5, 45.8)
    assert header["addressed_tiles"] == 10


@pytest.mark.parametrize(
    ("overrides", "message"),
    [({"version": 2}, "expected v3"), ({"tile_type": 2}, "not MVT"), ({"addressed": 0}, "no tiles"),
     ({"min_zoom": 0}, "zoom range")],
)  # fmt: skip
def test_header_rejections(tmp_path: Path, overrides: dict[str, int], message: str) -> None:
    path = tmp_path / "t.pmtiles"
    path.write_bytes(_archive(header=overrides))
    with pytest.raises(tiles.TilesError, match=message):
        tiles.verify(path)


def test_missing_layer_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "t.pmtiles"
    path.write_bytes(_archive(layers=("lines",)))
    with pytest.raises(tiles.TilesError, match="missing layers: plants, substations"):
        tiles.verify(path)


def test_gzip_metadata(tmp_path: Path) -> None:
    import gzip

    metadata = gzip.compress(json.dumps({"vector_layers": [{"id": "lines"}]}).encode())
    raw = bytearray(_header())
    struct.pack_into("<QQ", raw, 24, 127, len(metadata))
    raw[97] = 2
    path = tmp_path / "t.pmtiles"
    path.write_bytes(bytes(raw) + metadata)
    assert tiles.read_pmtiles_metadata(path)["vector_layers"] == [{"id": "lines"}]


def test_not_pmtiles(tmp_path: Path) -> None:
    path = tmp_path / "t.pmtiles"
    path.write_bytes(b"<html>")
    with pytest.raises(tiles.TilesError, match="not a PMTiles archive"):
        tiles.verify(path)


def test_missing_binary() -> None:
    with pytest.raises(tiles.TilesError, match="not found"):
        tiles.tippecanoe_version("/nonexistent/tippecanoe")


def test_old_binary_is_rejected(tmp_path: Path) -> None:
    fake = tmp_path / "tippecanoe"
    fake.write_text("#!/bin/sh\necho 'tippecanoe v1.36.0' >&2\n")
    fake.chmod(0o755)
    with pytest.raises(tiles.TilesError, match="too old"):
        tiles.tippecanoe_version(str(fake))


def test_failing_binary_leaves_no_output(tmp_path: Path, make_build: BuildFactory) -> None:
    build = make_build(datetime(2026, 9, 16, 12, tzinfo=UTC))
    fake = tmp_path / "tippecanoe"
    fake.write_text('#!/bin/sh\nif [ "$1" = "--version" ]; then echo "tippecanoe v2.49.0"; exit 0; fi\n'
                    'echo "boom" >&2; exit 3\n')  # fmt: skip
    fake.chmod(0o755)
    with pytest.raises(tiles.TilesError, match="failed \\(3\\): boom"):
        tiles.build_tiles(build, str(fake))
    assert not (build / tiles.GRID.file).exists()
    assert not list(build.glob(".*part*"))


@needs_tippecanoe
def test_real_tippecanoe_build(make_build: BuildFactory) -> None:
    build = make_build(datetime(2026, 9, 16, 12, tzinfo=UTC))
    infos = tiles.build_tiles(build)
    assert set(infos) == {"grid", "boundaries", "distribution", "chargers", "extraction"}

    grid = infos["grid"]
    assert (build / "grid.pmtiles").stat().st_size == grid.bytes > 0
    assert (grid.min_zoom, grid.max_zoom) == (3, 14)
    lon_min, lat_min, lon_max, lat_max = grid.bounds
    assert 14.4 < lon_min < lon_max < 16.6 and 45.1 < lat_min < lat_max < 45.9
    assert {v["id"] for v in tiles.read_pmtiles_metadata(build / "grid.pmtiles")["vector_layers"]} == {
        "lines", "substations", "plants", "datacenters", "pipelines"
    }  # fmt: skip

    boundaries = infos["boundaries"]
    assert (boundaries.min_zoom, boundaries.max_zoom) == (0, 8)
    assert boundaries.bounds == pytest.approx((13.0, 45.0, 19.0, 46.0), abs=1e-3)
    # the outline archive stays tiny: no z9-z14 polygon fills
    assert boundaries.addressed_tiles < 200

    # the distribution network is its own archive and starts where street detail does
    distribution = infos["distribution"]
    assert (distribution.min_zoom, distribution.max_zoom) == (10, 14)
    assert (build / "distribution.pmtiles").stat().st_size == distribution.bytes > 0
    assert {
        v["id"] for v in tiles.read_pmtiles_metadata(build / "distribution.pmtiles")["vector_layers"]
    } == {"distribution_lines", "distribution_substations"}

    saved = json.loads((build / tiles.TILES_INFO_FILE).read_text())
    assert saved["grid"]["addressed_tiles"] == grid.addressed_tiles
    # rerunning replaces the archives cleanly (bytes may differ: tippecanoe records temp paths in metadata)
    assert tiles.build_tiles(build)["grid"].addressed_tiles == grid.addressed_tiles
    assert not list(build.glob(".*part*"))


@needs_tippecanoe
def test_command_uses_named_layers(tmp_path: Path) -> None:
    layers = {layer: tmp_path / f"{layer}.ndjson" for layer in tiles.TILE_LAYERS}
    binary = shutil.which("tippecanoe") or "tippecanoe"
    grid = tiles.tippecanoe_command(binary, tiles.GRID, layers, tmp_path / "o.pmtiles", "x")
    assert f"--named-layer=lines:{tmp_path / 'lines.ndjson'}" in grid
    assert not any("countries" in part for part in grid)
    assert "--drop-rate=1" in grid
    assert not any(part.startswith(("--drop-densest", "--coalesce", "--extend-zooms")) for part in grid)
    assert any(part.startswith("--feature-filter=") for part in grid)
    outlines = tiles.tippecanoe_command(binary, tiles.BOUNDARIES, layers, tmp_path / "b.pmtiles", "x")
    assert "--maximum-zoom=8" in outlines and "--detect-shared-borders" in outlines


# ---------------------------------------------------------------- dense-tile regression (L-009)

needs_decoder = pytest.mark.skipif(
    shutil.which("tippecanoe-decode") is None and os.environ.get("ENERGYMAP_REQUIRE_TIPPECANOE") != "1",
    reason="tippecanoe-decode is not installed (CI installs it with tippecanoe)",
)


def _tile_xy(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    n = 2**zoom
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def _decoded_ids(archive: Path, zoom: int, lon: float, lat: float) -> dict[str, set[str]]:
    x, y = _tile_xy(lon, lat, zoom)
    out = subprocess.run(
        ["tippecanoe-decode", str(archive), str(zoom), str(x), str(y)],
        capture_output=True, text=True, check=True,
    ).stdout  # fmt: skip
    layers: dict[str, set[str]] = {}
    if out.strip():
        for collection in json.loads(out)["features"]:
            layers[collection["properties"]["layer"]] = {
                f["properties"]["id"] for f in collection["features"]
            }
    return layers


ANCHOR = (15.97, 45.805)


def _tile_bounds(x: int, y: int, zoom: int) -> tuple[float, float, float, float]:
    n = 2**zoom

    def lat(row: int) -> float:
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * row / n))))

    return x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180, lat(y)


def _inner_grid(count: int, columns: int, band: tuple[float, float]) -> list[list[float]]:
    """Positions in the middle of the z14 tile holding ANCHOR, so every ancestor tile holds them too."""
    west, south, east, north = _tile_bounds(*_tile_xy(*ANCHOR, 14), 14)
    rows = math.ceil(count / columns)
    width, height = east - west, north - south
    return [
        [
            west + width * (0.2 + 0.6 * (i % columns) / max(columns - 1, 1)),
            south + height * (band[0] + (band[1] - band[0]) * (i // columns) / max(rows - 1, 1)),
        ]
        for i in range(count)
    ]


def _write(path: Path, features: Sequence[Mapping[str, Any]]) -> None:
    path.write_text("".join(json.dumps(f) + "\n" for f in features))


def _dense_build(build: Path) -> dict[str, dict[str, int]]:
    """60 plants, 30 substations and 24 lines inside one z14 tile, covering every zoom rule."""
    capacities = [None, 5.0, 50.0, 250.0, 800.0]
    voltages = [None, 66.0, 110.0, 220.0, 400.0]
    base: dict[str, Any] = {"status": "operating", "operator": None, "country": "HR", "name": None}
    expected: dict[str, dict[str, int]] = {"plants": {}, "substations": {}, "lines": {}}

    plants: list[dict[str, Any]] = []
    for i, point in enumerate(_inner_grid(60, 10, (0.2, 0.45))):
        mw = capacities[i % len(capacities)]
        plant_id = f"osm:node/{1000 + i}"
        props = base | {"id": plant_id, "technology": "solar", "capacityMw": mw,
                        "commissioningYear": None}  # fmt: skip
        plants.append(
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": point}, "properties": props}
        )
        expected["plants"][plant_id] = tiles.plant_minzoom(mw)

    substations: list[dict[str, Any]] = []
    for i, point in enumerate(_inner_grid(30, 10, (0.5, 0.6))):
        kv = voltages[i % len(voltages)]
        station_id = f"osm:node/{2000 + i}"
        props = base | {
            "id": station_id,
            "maxVoltageKv": kv,
            "voltagesKv": [] if kv is None else [kv],
        }
        substations.append(
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": point}, "properties": props}
        )
        expected["substations"][station_id] = tiles.substation_minzoom(kv)

    lines: list[dict[str, Any]] = []
    starts = _inner_grid(24, 1, (0.65, 0.8))
    for i, (west, lat) in enumerate(starts):
        kv = voltages[i % len(voltages)]
        interconnector = i % 7 == 0
        line_id = f"osm:way/{3000 + i}"
        line_props: dict[str, Any] = {"id": line_id, "kind": "line", "status": "operating", "operator": None,
                 "maxVoltageKv": kv, "voltagesKv": [] if kv is None else [kv], "circuits": None,
                 "isHvdc": False, "isInterconnector": interconnector,
                 "countries": ["HR", "SI"] if interconnector else ["HR"]}  # fmt: skip
        geometry = {"type": "LineString", "coordinates": [[west, lat], [west + 0.004, lat + 0.0001]]}
        lines.append({"type": "Feature", "geometry": geometry, "properties": line_props})
        expected["lines"][line_id] = tiles.line_minzoom(kv, interconnector)

    _write(build / "plants.ndjson", plants)
    _write(build / "substations.ndjson", substations)
    _write(build / "lines.ndjson", lines)
    return expected


@needs_tippecanoe
@needs_decoder
@pytest.mark.parametrize("zoom", [3, 4, 5, 6, 7, 8, 9, 12, 14])
def test_dense_tiles_keep_every_feature_from_its_minzoom(make_build: BuildFactory, zoom: int) -> None:
    build = make_build(datetime(2026, 9, 16, 12, tzinfo=UTC))
    expected = _dense_build(build)
    tiles.build_tiles(build)
    decoded = _decoded_ids(build / tiles.GRID.file, zoom, *ANCHOR)
    for layer, rules in expected.items():
        wanted = {fid for fid, minzoom in rules.items() if minzoom <= zoom}
        assert decoded.get(layer, set()) == wanted, f"{layer} at z{zoom}"


@needs_tippecanoe
@needs_decoder
def test_neighbouring_countries_share_a_tile(make_build: BuildFactory) -> None:
    build = make_build(datetime(2026, 9, 16, 12, tzinfo=UTC))
    tiles.build_tiles(build)
    # the fixture borders put SI and HR side by side (lon 13-15 and 15-17)
    for zoom in (3, 5, 8):
        x, y = _tile_xy(15.0, 45.5, zoom)
        out = subprocess.run(
            ["tippecanoe-decode", str(build / tiles.BOUNDARIES.file), str(zoom), str(x), str(y)],
            capture_output=True, text=True, check=True,
        ).stdout  # fmt: skip
        codes = {f["properties"]["code"] for c in json.loads(out)["features"] for f in c["features"]}
        assert {"HR", "SI"} <= codes, f"z{zoom}: {codes}"


def _distribution_build(build: Path) -> dict[str, dict[str, int]]:
    """Distribution features inside the same z14 tile, one per zoom rule."""
    base: dict[str, Any] = {"status": "operating", "operator": None, "country": "HR", "name": None}
    expected: dict[str, dict[str, int]] = {"distribution_lines": {}, "distribution_substations": {}}

    lines: list[dict[str, Any]] = []
    for i, (west, lat) in enumerate(_inner_grid(12, 1, (0.2, 0.5))):
        kv = [None, 10.0, 20.0, 35.0][i % 4]
        line_id = f"osm:way/{4000 + i}"
        props: dict[str, Any] = {"id": line_id, "kind": "line", "status": "operating", "operator": None,
                 "maxVoltageKv": kv, "voltagesKv": [] if kv is None else [kv], "circuits": None,
                 "isHvdc": False, "isInterconnector": False, "countries": ["HR"]}  # fmt: skip
        geometry = {"type": "LineString", "coordinates": [[west, lat], [west + 0.002, lat + 0.0001]]}
        lines.append({"type": "Feature", "geometry": geometry, "properties": props})
        expected["distribution_lines"][line_id] = tiles.distribution_line_minzoom(kv)

    substations: list[dict[str, Any]] = []
    for i, point in enumerate(_inner_grid(8, 4, (0.6, 0.8))):
        kv = [10.0, 35.0][i % 2]
        station_id = f"osm:node/{5000 + i}"
        props = base | {"id": station_id, "maxVoltageKv": kv, "voltagesKv": [kv]}
        substations.append(
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": point}, "properties": props}
        )
        expected["distribution_substations"][station_id] = tiles.distribution_substation_minzoom(kv)

    _write(build / "distribution_lines.ndjson", lines)
    _write(build / "distribution_substations.ndjson", substations)
    return expected


@needs_tippecanoe
@needs_decoder
@pytest.mark.parametrize("zoom", [10, 11, 12, 14])
def test_distribution_features_appear_at_their_own_zoom(make_build: BuildFactory, zoom: int) -> None:
    build = make_build(datetime(2026, 9, 16, 12, tzinfo=UTC))
    expected = _distribution_build(build)
    tiles.build_tiles(build)
    decoded = _decoded_ids(build / tiles.DISTRIBUTION.file, zoom, *ANCHOR)
    for layer, rules in expected.items():
        wanted = {fid for fid, minzoom in rules.items() if minzoom <= zoom}
        assert decoded.get(layer, set()) == wanted, f"{layer} at z{zoom}"


@needs_tippecanoe
def test_the_transmission_archive_never_carries_distribution(make_build: BuildFactory) -> None:
    """The whole point of the separate archive: a visitor who never switches the layer on pays nothing."""
    build = make_build(datetime(2026, 9, 16, 12, tzinfo=UTC))
    _distribution_build(build)
    tiles.build_tiles(build)
    grid_layers = {v["id"] for v in tiles.read_pmtiles_metadata(build / tiles.GRID.file)["vector_layers"]}
    assert not any(layer.startswith("distribution") for layer in grid_layers)


@needs_tippecanoe
def test_a_build_without_optional_layers_skips_their_archives(make_build: BuildFactory) -> None:
    """Older builds have no distribution layer at all; tippecanoe cannot write an empty archive, and
    such a build must stay buildable and publishable (rollback)."""
    build = make_build(datetime(2026, 9, 16, 12, tzinfo=UTC))
    stale = [build / archive.file for archive in tiles.OPTIONAL_ARCHIVES]
    for path in stale:
        path.write_bytes(b"left over from an earlier run")
    for archive in tiles.OPTIONAL_ARCHIVES:
        for layer in archive.layers:
            (build / f"{layer}.ndjson").unlink()

    infos = tiles.build_tiles(build)

    assert set(infos) == {"grid", "boundaries"}
    assert not any(path.exists() for path in stale)
    assert json.loads((build / tiles.TILES_INFO_FILE).read_text()).keys() == {"grid", "boundaries"}


@needs_tippecanoe
def test_a_tile_that_cannot_be_made_small_enough_fails_the_build(tmp_path: Path) -> None:
    """Verified against tippecanoe 2.49 on 2026-09-17: with --drop-rate=1 and no --drop-* option it
    reduces coordinate detail and then gives up, instead of quietly leaving features out. This test is
    what keeps that true; the distribution layer is the first one dense enough to reach the limit."""
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [[16.0 + i / 1e5, 45.0], [16.0001, 45.0001]]},
            "properties": {"id": f"osm:way/{i}", "operator": f"Operator with a long name {i}", "minzoom": 11},
        }
        for i in range(4000)
    ]
    layers = {layer: tmp_path / f"{layer}.ndjson" for layer in tiles.TILE_LAYERS}
    for path in layers.values():
        path.write_text("")
    _write(layers["distribution_lines"], features)
    binary = shutil.which("tippecanoe") or "tippecanoe"
    command = tiles.tippecanoe_command(binary, tiles.DISTRIBUTION, layers, tmp_path / "out.pmtiles", "dense")
    # the real limit is 500 kB per tile; a lower one reaches the same code path with a small fixture
    command.append("--maximum-tile-bytes=20000")

    completed = subprocess.run(command, capture_output=True, text=True, check=False)

    assert completed.returncode != 0
    assert "could not make tile" in completed.stderr
    # tippecanoe leaves its half-written output behind; the pipeline writes to a .part file and removes
    # it on any failure, which test_failing_binary_leaves_no_output covers.
