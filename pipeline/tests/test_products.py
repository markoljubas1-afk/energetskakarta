from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from shapely.geometry import LineString

from conftest import BuildFactory
from energymap.geo.countries import CountryIndex
from energymap.products import VOLTAGE_CLASSES, voltage_class


@pytest.mark.parametrize(
    ("kv", "klass"),
    [
        (400.0, "380+"),
        (380.0, "380+"),
        (220.0, "220-379"),
        (110.0, "110-219"),
        (66.0, "60-109"),
        (None, "unknown"),
    ],
)
def test_voltage_class(kv: float | None, klass: str) -> None:
    assert voltage_class(kv) == klass
    assert klass in VOLTAGE_CLASSES


def test_line_shares(index: CountryIndex) -> None:
    shares = index.line_shares(LineString([(14.5, 45.5), (15.5, 45.5)]))
    assert set(shares) == {"SI", "HR"}
    assert shares["SI"] == pytest.approx(shares["HR"], rel=1e-6)
    assert shares["HR"] == pytest.approx(39_000, rel=0.01)


def test_boundary_features_are_clipped_and_flagged(index: CountryIndex) -> None:
    features = index.boundary_features((14.0, 44.0, 18.0, 47.0), frozenset({"HR"}))
    by_code = {f["properties"]["code"]: f for f in features}
    assert set(by_code) == {"HR", "SI", "SK"}
    assert by_code["HR"]["properties"]["inScope"] is True
    assert by_code["SI"]["properties"]["inScope"] is False
    xs = [x for ring in by_code["SI"]["geometry"]["coordinates"] for x, _ in ring]
    assert min(xs) == pytest.approx(14.0)  # clipped to the bbox


def test_build_writes_search_and_stats(make_build: BuildFactory) -> None:
    build = make_build(datetime(2026, 9, 16, 12, tzinfo=UTC))

    search = json.loads((build / "search.json").read_text())
    assert search["fields"] == ["id", "name", "layer", "country", "lon", "lat", "detail"]
    rows = {row[0]: row for row in search["rows"]}
    # named objects only; data centres are searchable, distribution assets deliberately are not
    assert set(rows) == {
        "osm:way/109",
        "osm:node/60",
        "osm:node/50",
        "osm:way/108",
        "osm:node/70",
        "osm:node/71",
        # extraction sites with a name
        "osm:node/80",
        "osm:node/81",
        "osm:node/82",
        "osm:node/85",
        "osm:way/112",
    }
    assert rows["osm:node/70"][2:4] == ["datacenters", "HR"]
    assert rows["osm:node/80"][2:4] == ["extraction", "HR"] and rows["osm:node/80"][6] == "well|gas"
    assert rows["osm:node/70"][6] == ""  # OSM knows of no published power
    assert rows["osm:way/109"][2:4] == ["plants", "HR"]
    assert rows["osm:way/109"][6] == "pumped_storage|276"
    assert rows["osm:node/50"][6] == "400"
    names = [row[1] for row in search["rows"]]
    assert names == sorted(names, key=str.casefold)

    stats = json.loads((build / "stats.json").read_text())
    hr = stats["plants"]["HR"]
    assert hr["pumped_storage"]["operating"] == {"count": 1, "capacityMw": 276.0, "withCapacity": 1}
    assert hr["solar"]["planned"] == {"count": 1, "capacityMw": 9.9, "withCapacity": 1}
    assert hr["coal"]["operating"] == {"count": 1, "capacityMw": 0.0, "withCapacity": 0}
    assert stats["substations"]["HR"] == {"380+": 1, "110-219": 1}
    # the HR-SI interconnector contributes only its Croatian half (~39 km) to HR; SI is out of scope
    assert stats["lineKm"]["HR"]["380+"]["operating"] == pytest.approx(39.0, rel=0.01)
    assert "SI" not in stats["lineKm"]
    # data centres are counted even without a published power; withPower says how many had one
    assert stats["datacenters"]["HR"] == {
        "operating": {"count": 1, "powerMw": 0.0, "withPower": 0},
        "planned": {"count": 1, "powerMw": 0.0, "withPower": 0},
    }

    countries = [json.loads(x) for x in (build / "countries.ndjson").read_text().splitlines()]
    assert {f["properties"]["code"] for f in countries} == {"HR", "SI", "SK"}

    manifest = json.loads((build / "manifest.json").read_text())
    assert manifest["scope"] == ["HR"]


def test_the_plant_grid_adds_up_to_the_statistics(make_build: BuildFactory) -> None:
    """The grid answers "what is in this part of the map"; over the whole map it must say what the
    per-country statistics say, technology by technology and status by status."""
    build = make_build(datetime(2026, 9, 16, 12, tzinfo=UTC))
    grid = json.loads((build / "plantgrid.json").read_text())
    assert grid["version"] == 1 and grid["cellDeg"] == 0.25
    assert grid["fields"] == ["lon", "lat", "technology", "status", "count", "withCapacity", "capacityMw"]
    assert grid["rows"], "the fixture has plants"

    from_grid: dict[tuple[str, str], list[float]] = {}
    for lon, lat, technology, status, count, with_capacity, capacity in grid["rows"]:
        # a cell's corner is a multiple of the cell size
        assert lon / 0.25 == pytest.approx(round(lon / 0.25)) and lat / 0.25 == pytest.approx(
            round(lat / 0.25)
        )
        total = from_grid.setdefault((technology, status), [0, 0, 0.0])
        total[0] += count
        total[1] += with_capacity
        total[2] += capacity

    from_stats: dict[tuple[str, str], list[float]] = {}
    stats = json.loads((build / "stats.json").read_text())
    for by_technology in stats["plants"].values():
        for technology, by_status in by_technology.items():
            for status, bucket in by_status.items():
                total = from_stats.setdefault((technology, status), [0, 0, 0.0])
                total[0] += bucket["count"]
                total[1] += bucket["withCapacity"]
                total[2] += bucket["capacityMw"]

    assert from_grid.keys() == from_stats.keys()
    for key, (count, with_capacity, capacity) in from_grid.items():
        assert [count, with_capacity] == from_stats[key][:2]
        assert capacity == pytest.approx(from_stats[key][2])
    # the plant at 16.51°E 45.81°N (osm:way/109) lies in the cell whose corner is 16.5, 45.75
    assert [16.5, 45.75, "pumped_storage", "operating", 1, 1, 276.0] in grid["rows"]
