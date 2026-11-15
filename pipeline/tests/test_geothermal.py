"""Geothermal layer (Faza 21): curated sites, heat-flow grid and the published document."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Any

import openpyxl
import pytest

from energymap import cli
from energymap.geothermal import heatflow
from energymap.geothermal import publish as geo_publish
from energymap.geothermal.sites import GeothermalDataError, load_sites, site_records

NOW = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)
SITES = Path(__file__).resolve().parents[2] / "overrides" / "geothermal.yaml"
HEADER = [("Field ID",), ("Class",), ("Scheme",), ("Relevance",), ("Unit",)]


def sheet_rows(data: list[tuple[Any, ...]]) -> list[tuple[Any, ...]]:
    return [*HEADER, ("name", "q", "qc", "lat_NS", "long_EW"), *data]


def lattice(q: float = 80.0) -> list[heatflow.Point]:
    return [heatflow.Point(15 + i * 0.3, 44 + j * 0.3, q + i) for i in range(6) for j in range(6)]


def test_the_curated_file_is_valid_and_every_site_names_a_source() -> None:
    parsed = load_sites(SITES)
    records = site_records(parsed)
    assert {r["id"] for r in records} >= {"velika-1", "legrad-1", "topusko"}
    assert all(r["sources"] for r in records)
    velika = next(r for r in records if r["id"] == "velika-1")
    assert velika["electricMw"] == 16.5 and velika["status"] == "operating"


@pytest.mark.parametrize(
    "change",
    [
        {"sources": []},
        {"lon": 25.0},
        {"status": "rumoured"},
        {"note_hr": "samo hrvatski"},
        {"uses": []},
    ],
)
def test_one_bad_entry_rejects_the_file(tmp_path: Path, change: dict[str, Any]) -> None:
    site = {
        "id": "x", "name": "Test", "place": "Mjesto", "lon": 16.0, "lat": 45.5, "kind": "heat",
        "status": "operating", "uses": ["heating"], "sources": ["https://example.org/a"],
    }  # fmt: skip
    path = tmp_path / "g.yaml"
    path.write_text(json.dumps({"version": 1, "reviewed": "2026-11-15", "sites": [{**site, **change}]}))
    with pytest.raises(GeothermalDataError):
        load_sites(path)


def test_duplicate_ids_are_rejected(tmp_path: Path) -> None:
    site = {
        "id": "x", "name": "Test", "place": "Mjesto", "lon": 16.0, "lat": 45.5, "kind": "heat",
        "status": "operating", "uses": ["heating"], "sources": ["https://example.org/a"],
    }  # fmt: skip
    path = tmp_path / "g.yaml"
    path.write_text(json.dumps({"version": 1, "reviewed": "2026-11-15", "sites": [site, site]}))
    with pytest.raises(GeothermalDataError, match="duplicate"):
        load_sites(path)


def test_points_come_from_parent_rows_inside_the_region() -> None:
    rows = sheet_rows(
        [
            ("Zagreb", 85.0, None, 45.8, 16.0),
            ("child", None, 90.0, 45.8, 16.0),  # an individual measurement: not counted twice
            ("Far", 70.0, None, 52.0, 13.0),  # outside the region
            ("Hot spring", 900.0, None, 45.0, 17.0),  # beyond MAX_Q
            ("Text", "n/a", None, 45.0, 17.0),
        ]
    )
    assert heatflow.read_points(rows) == [heatflow.Point(16.0, 45.8, 85.0)]


def test_a_sheet_without_the_columns_is_refused() -> None:
    with pytest.raises(GeothermalDataError, match="lat_NS"):
        heatflow.read_points([*HEADER, ("name", "q", "lat"), ("a", 1, 2)])


def test_the_workbook_is_read_from_bytes() -> None:
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    assert sheet is not None
    for row in sheet_rows([("A", 80.0, None, 45.5, 16.5)]):
        sheet.append(list(row))
    buffer = BytesIO()
    workbook.save(buffer)
    assert heatflow.read_workbook(buffer.getvalue()) == [heatflow.Point(16.5, 45.5, 80.0)]
    with pytest.raises(GeothermalDataError):
        heatflow.read_workbook(b"not a workbook")


def test_the_grid_interpolates_only_near_measurements() -> None:
    cells = heatflow.grid(lattice())
    assert cells, "cells near the lattice"
    for lon, lat, q, n in cells:
        assert n >= heatflow.MIN_POINTS and 80 <= q <= 85
        assert 14.2 < lon < 17.4 and 43.2 < lat < 46.2  # nothing far from the measurements
    with pytest.raises(GeothermalDataError, match="only"):
        heatflow.grid(lattice()[:5])


def test_the_document_validates_and_publishes(tmp_path: Path) -> None:
    doc = geo_publish.document(load_sites(SITES), lattice(), NOW)
    geo_publish.validate(doc)
    assert doc["heatFlow"]["license"] == "CC-BY-4.0" and doc["sitesReviewed"] == "2026-11-15"
    store = tmp_path / "bucket"
    from energymap.publish import DirectoryStore

    geo_publish.publish_geothermal(DirectoryStore(store), doc)
    assert json.loads((store / "geothermal" / "current.json").read_text())["version"] == 1
    with pytest.raises(GeothermalDataError):
        geo_publish.validate({**doc, "sites": []})


def test_cli_fetch_and_publish(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        geo_publish,
        "collect",
        lambda client, sites, now: geo_publish.document(load_sites(sites), lattice(), now),
    )
    assert (
        cli.main(["geothermal", "publish-dir", "--data-dir", str(tmp_path), "--out", str(tmp_path / "b")])
        == 1
    )
    assert cli.main(["geothermal", "fetch", "--data-dir", str(tmp_path), "--sites", str(SITES)]) == 0
    assert (
        cli.main(["geothermal", "publish-dir", "--data-dir", str(tmp_path), "--out", str(tmp_path / "b")])
        == 0
    )
    assert (tmp_path / "b" / "geothermal" / "current.json").exists()
