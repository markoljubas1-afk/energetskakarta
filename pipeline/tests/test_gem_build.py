"""End to end: OSM fixture + GEM sample → merged plants, manifest, attribution, tiles, CLI."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from conftest import BuildFactory
from energymap import build as pipeline
from energymap import cli, config, tiles
from energymap.validate import BuildValidationError

T = datetime(2026, 9, 16, 3, tzinfo=UTC)
HR = [config.COUNTRY_BY_CODE["HR"]]


def gem_build(make_build: BuildFactory, fixtures: Path, overrides: Path | None = None) -> Path:
    first = make_build(datetime(2026, 9, 1, tzinfo=UTC))  # prepares downloads and borders
    paths = config.Paths(first.parents[2])
    return pipeline.build(
        paths, HR, now=T, allow_drop=True, gem=fixtures / "gem_sample.csv", overrides=overrides
    )


def plants(build: Path) -> dict[str, dict[str, Any]]:
    rows = [json.loads(line) for line in (build / "plants.ndjson").read_text().splitlines()]
    return {row["id"]: row["properties"] for row in rows}


def test_merged_plants(make_build: BuildFactory, fixtures: Path) -> None:
    result = plants(gem_build(make_build, fixtures))

    rhe = result["osm:way/109"]
    assert (rhe["capacityMw"], rhe["commissioningYear"], rhe["operator"]) == (276.0, 1984, "HEP Proizvodnja")
    assert [p["source"] for p in rhe["provenance"]] == ["openstreetmap", "gem"]
    assert rhe["provenance"][1]["url"] == "https://www.gem.wiki/RHE_Primjer"

    solar = result["osm:node/60"]  # OSM said planned, GEM says under construction
    assert solar["status"] == "construction"
    assert solar["provenance"][1]["license"] == "CC-BY-NC-4.0"

    lignite = result["osm:node/63"]  # unnamed in OSM, 150 m from GEM's lignite plant
    assert (lignite["technology"], lignite["capacityMw"], lignite["name"]) == (
        "lignite",
        210.0,
        "TE Lignit Primjer",
    )

    expansion = result["gem:L100000000001:planned"]  # the announced third unit stays visible on its own
    assert (expansion["status"], expansion["capacityMw"]) == ("planned", 150.0)

    wind = result["gem:L100000000004:operating"]
    assert (wind["technology"], wind["capacityMw"], wind["country"]) == ("wind", 1200.0, "HR")

    assert not any("L100000000005" in key or "L100000000006" in key for key in result)  # shelved, Slovakia


def test_manifest_attribution_and_review_report(make_build: BuildFactory, fixtures: Path) -> None:
    build = gem_build(make_build, fixtures)
    manifest = json.loads((build / "manifest.json").read_text())
    assert manifest["gem"]["file"] == "gem_sample.csv"
    assert len(manifest["gem"]["sha256"]) == 64
    assert manifest["gem"]["nonCommercialPlants"] == 1
    assert manifest["attributionParts"] == [
        "© OpenStreetMap contributors (ODbL)",
        "Global Energy Monitor, Global Integrated Power Tracker (CC BY 4.0)",
        "TransitionZero, Solar Asset Mapper (CC BY-NC 4.0)",
        "Borders: Natural Earth",
    ]
    assert manifest["attributionSources"] == ["openstreetmap", "gem", "transitionzero", "naturalearth"]
    assert manifest["licenseNotes"]
    assert manifest["stats"]["conflation_matched"] == 3
    assert manifest["stats"]["conflation_gem_only"] == 2
    assert manifest["stats"]["gem_invalid_coordinates"] == 1
    report = json.loads((build / "conflation.json").read_text())
    assert {row["osm"] for row in report["matched"]} == {"osm:way/109", "osm:node/60", "osm:node/63"}
    assert report["unusedOverrides"] == []


def test_without_gem_the_attribution_is_osm_only(make_build: BuildFactory) -> None:
    manifest = json.loads((make_build(T) / "manifest.json").read_text())
    assert manifest["gem"] is None
    assert manifest["attributionParts"] == ["© OpenStreetMap contributors (ODbL)", "Borders: Natural Earth"]
    assert manifest["attributionSources"] == ["openstreetmap", "naturalearth"]
    assert manifest["licenseNotes"] == []


def test_override_blocks_a_match(make_build: BuildFactory, fixtures: Path, tmp_path: Path) -> None:
    overrides = tmp_path / "conflation.yaml"
    overrides.write_text("never:\n  - osm: osm:way/109\n    gem: L100000000001:operating\n")
    result = plants(gem_build(make_build, fixtures, overrides))
    assert [p["source"] for p in result["osm:way/109"]["provenance"]] == ["openstreetmap"]
    assert "gem:L100000000001:operating" in result


def test_file_without_units_in_scope_is_rejected(
    make_build: BuildFactory, tmp_path: Path, fixtures: Path
) -> None:
    lines = (fixtures / "gem_sample.csv").read_text().splitlines()
    only_slovakia = tmp_path / "gem.csv"
    only_slovakia.write_text("\n".join([lines[0], *[line for line in lines if ",Slovakia," in line]]) + "\n")
    first = make_build(datetime(2026, 9, 1, tzinfo=UTC))
    with pytest.raises(BuildValidationError, match="no usable units"):
        pipeline.build(config.Paths(first.parents[2]), HR, now=T, gem=only_slovakia)


def test_tiles_carry_sources_and_gem_link(make_build: BuildFactory, fixtures: Path) -> None:
    build = gem_build(make_build, fixtures)
    features = {}
    for line in (build / "plants.ndjson").read_text().splitlines():
        feature = json.loads(line)
        features[feature["id"]] = tiles.tile_feature("plants", feature)["properties"]
    assert features["osm:way/109"]["sources"] == "gem,openstreetmap"
    assert features["osm:way/109"]["gemUrl"] == "https://www.gem.wiki/RHE_Primjer"
    assert features["gem:L100000000004:operating"]["sources"] == "gem"
    assert "gemUrl" not in features["gem:L100000000004:operating"]
    assert features["osm:node/63"]["sources"] == "gem,openstreetmap"


def test_cli_reports_bad_gem_and_overrides_files(
    make_build: BuildFactory, tmp_path: Path, fixtures: Path
) -> None:
    data_dir = make_build(T).parents[2]
    bad = tmp_path / "bad.csv"
    bad.write_text("Name,Value\nx,1\n")
    args = ["osm", "build", "--data-dir", str(data_dir), "--countries", "HR", "--allow-drop"]
    assert cli.main([*args, "--gem", str(bad)]) == cli.EXIT_FAILED
    broken = tmp_path / "o.yaml"
    broken.write_text("force: [\n")
    assert (
        cli.main([*args, "--gem", str(fixtures / "gem_sample.csv"), "--overrides", str(broken)])
        == cli.EXIT_FAILED
    )
    assert cli.main([*args, "--gem", str(tmp_path / "missing.xlsx")]) == cli.EXIT_FAILED
