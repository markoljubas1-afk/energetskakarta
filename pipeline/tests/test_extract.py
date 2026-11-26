"""End-to-end: fixture that mimics real regional tagging → prefilter → extract."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import osmium
import pytest

from energymap import config
from energymap.geo.countries import CountryIndex
from energymap.osm.extract import ExtractResult, extract
from energymap.osm.prefilter import prefilter
from energymap.schema import ExtractionKind, Medium, Status, Substance, Technology

RETRIEVED = datetime(2026, 9, 16, 12, 0, tzinfo=UTC)
SCOPE = frozenset({"HR", "SI"})


@pytest.fixture
def result(fixtures: Path, index: CountryIndex, tmp_path: Path) -> ExtractResult:
    result = ExtractResult()
    for spec in config.SOURCE_FILTERS:
        filtered = prefilter(fixtures / "sample.osm", tmp_path / f"{spec.name}.osm.pbf", spec)
        result.merge(extract(filtered, index, SCOPE, RETRIEVED))
    return result


def test_prefilter_drops_unrelated_objects(fixtures: Path, tmp_path: Path) -> None:
    out = prefilter(fixtures / "sample.osm", tmp_path / "f.osm.pbf", config.POWER_FILTER)
    ids = {(o.type_str(), o.id) for o in osmium.FileProcessor(str(out))}
    assert ("w", 300) not in ids  # highway
    assert ("w", 111) not in ids  # disused line
    assert ("n", 30) not in ids  # node only used by the highway
    assert ("n", 1) in ids  # node referenced by a power line is kept for geometry
    assert ("w", 110) in ids  # untagged outer way of a power plant multipolygon is kept


def test_prefilter_is_idempotent(fixtures: Path, tmp_path: Path) -> None:
    dst = tmp_path / "f.osm.pbf"
    prefilter(fixtures / "sample.osm", dst, config.POWER_FILTER)
    mtime = dst.stat().st_mtime_ns
    prefilter(fixtures / "sample.osm", dst, config.POWER_FILTER)
    assert dst.stat().st_mtime_ns == mtime
    assert not list(tmp_path.glob("*.part*"))


def test_expected_lines(result: ExtractResult) -> None:
    assert set(result.lines) == {"osm:way/100", "osm:way/102", "osm:way/103", "osm:way/106"}


def test_interconnector(result: ExtractResult) -> None:
    line = result.lines["osm:way/100"]
    assert line.voltages_kv == (400.0, 220.0)
    assert line.max_voltage_kv == 400.0
    assert line.circuits == 2
    assert line.countries == ("HR", "SI") or line.countries == ("SI", "HR")
    assert line.is_interconnector
    assert line.operator == "HOPS; ELES"
    assert line.status is Status.OPERATING
    assert line.geometry == ((14.5, 45.5), (15.5, 45.5))


def test_lifecycle_and_hvdc(result: ExtractResult) -> None:
    assert result.lines["osm:way/102"].status is Status.CONSTRUCTION
    assert result.lines["osm:way/102"].voltages_kv == (110.0,)
    cable = result.lines["osm:way/103"]
    assert cable.kind == "cable" and cable.is_hvdc and not cable.is_interconnector


def test_border_hugging_line_without_voltage(result: ExtractResult) -> None:
    line = result.lines["osm:way/106"]
    assert line.voltages_kv == ()
    assert line.countries == ("HR",)
    assert not line.is_interconnector


def test_substations(result: ExtractResult) -> None:
    assert set(result.substations) == {"osm:node/50", "osm:way/108"}
    node = result.substations["osm:node/50"]
    assert node.name == "TS Žerjavinec" and node.voltages_kv == (400.0, 110.0) and node.country == "HR"
    area = result.substations["osm:way/108"]
    lon, lat = area.location
    assert 15.90 <= lon <= 15.91 and 45.40 <= lat <= 45.41  # point on the area's surface


def test_plants(result: ExtractResult) -> None:
    assert set(result.plants) == {"osm:way/109", "osm:node/60", "osm:relation/200", "osm:node/63"}
    rhe = result.plants["osm:way/109"]
    assert rhe.technology is Technology.PUMPED_STORAGE
    assert rhe.capacity_mw == 276.0 and rhe.commissioning_year == 1985
    planned = result.plants["osm:node/60"]
    assert planned.status is Status.PLANNED and planned.capacity_mw == 9.9
    wind = result.plants["osm:relation/200"]
    assert wind.technology is Technology.WIND and wind.capacity_mw == 1200.0 and wind.country == "SI"
    coal = result.plants["osm:node/63"]
    assert coal.capacity_mw is None  # "210" without unit is ambiguous


def test_distribution_layers(result: ExtractResult) -> None:
    """Everything below 60 kV is kept, in its own layer: way 104 is a 20 kV minor_line, 105 a 35 kV
    line, 107 a cable without a voltage tag, node 62 a minor_distribution substation."""
    assert set(result.distribution_lines) == {"osm:way/104", "osm:way/105", "osm:way/107"}
    assert set(result.distribution_substations) == {"osm:node/62"}
    assert result.distribution_lines["osm:way/104"].voltages_kv == (20.0,)
    assert result.distribution_lines["osm:way/104"].kind == "line"  # minor_line is an overhead line
    assert result.distribution_lines["osm:way/107"].kind == "cable"
    # the transmission layers are untouched by any of it
    assert not set(result.lines) & set(result.distribution_lines)
    assert "osm:node/62" not in result.substations


def test_distribution_counts_only_once_it_exists(result: ExtractResult) -> None:
    counts = result.counts()
    assert counts["distribution_lines"] == 3 and counts["distribution_substations"] == 1
    assert ExtractResult().counts() == {"lines": 0, "substations": 0, "plants": 0}


def test_counted_exclusions(result: ExtractResult) -> None:
    s = result.stats
    assert s["excluded_line"] == 1  # busbar only: substation internals are not lines of their own
    assert s["excluded_cable"] == 0
    assert s["excluded_substation"] == 0
    assert s["outside_scope"] == 1  # gas plant in SK
    assert s["ambiguous_capacity"] == 1
    assert s["skipped_site_relation_plant"] == 1
    # a multipolygon whose "outer" member is an open tunnel never becomes an area: counted, not lost silently
    assert s["multipolygon_not_assembled"] == 1


def test_provenance(result: ExtractResult) -> None:
    prov = result.plants["osm:relation/200"].provenance[0]
    assert prov.source_id == "relation/200"
    assert prov.license == "ODbL-1.0"
    assert prov.retrieved_at == RETRIEVED


def test_feature_serialisation_uses_web_contract(result: ExtractResult) -> None:
    feature = result.lines["osm:way/100"].to_feature()
    assert feature["geometry"]["type"] == "LineString"
    props = feature["properties"]
    assert props["layer"] == "lines"
    assert props["maxVoltageKv"] == 400.0
    assert props["isInterconnector"] is True
    assert props["voltagesKv"] == [400.0, 220.0]
    assert props["provenance"][0]["sourceId"] == "way/100"
    assert "geometry" not in props


def test_merge_deduplicates(result: ExtractResult) -> None:
    other = ExtractResult(lines=dict(result.lines))
    before = result.counts()
    result.merge(other)
    assert result.counts() == before
    assert result.stats["duplicate_across_extracts"] == len(other.lines)


def test_data_centers(result: ExtractResult) -> None:
    """The telecom schema, including a lifecycle prefix for the planned one (nodes 70 and 71)."""
    assert set(result.datacenters) == {"osm:node/70", "osm:node/71"}
    running = result.datacenters["osm:node/70"]
    assert running.name == "DC Primjer" and running.operator == "Primjer d.o.o."
    assert running.status is Status.OPERATING and running.commissioning_year == 2019
    assert running.power_mw is None  # OSM has no agreed key for it, and it is never guessed
    assert running.country == "HR"
    assert result.datacenters["osm:node/71"].status is Status.PLANNED


def test_prefilter_keeps_data_centres_out_of_the_power_layers(result: ExtractResult) -> None:
    for layer in (result.plants, result.substations, result.lines, result.distribution_lines):
        assert not {"osm:node/70", "osm:node/71"} & set(layer)


def test_filtered_file_is_renamed_when_the_pass_changes(tmp_path: Path) -> None:
    """A wider pass must not reuse a file built with the old one: the new objects would be missing and
    nothing would say so."""
    from energymap.osm.prefilter import filtered_path

    narrow = config.SourceFilter("power", keys=("power",))
    wide = config.SourceFilter("power", keys=("power", "telecom"))
    assert filtered_path(tmp_path, "croatia", "abc123", narrow) != filtered_path(
        tmp_path, "croatia", "abc123", wide
    )
    assert filtered_path(tmp_path, "croatia", "abc123", wide) == filtered_path(
        tmp_path, "croatia", "abc123", config.SourceFilter("power", keys=("power", "telecom"))
    )
    # each pass writes its own file, so two passes never overwrite one another
    assert filtered_path(tmp_path, "croatia", "abc", config.POWER_FILTER) != filtered_path(
        tmp_path, "croatia", "abc", config.CHARGER_FILTER
    )


def test_a_pass_selects_by_key_or_by_value_but_not_both() -> None:
    with pytest.raises(ValueError, match="not both"):
        config.SourceFilter("broken", keys=("power",), pairs=(("amenity", "charging_station"),))
    with pytest.raises(ValueError, match="not both"):
        config.SourceFilter("empty")


def test_charging_stations(result: ExtractResult) -> None:
    """From their own prefilter pass: node 72 in the fixture."""
    assert set(result.chargers) == {"osm:node/72"}
    charger = result.chargers["osm:node/72"]
    assert charger.name == "Punionica Primjer" and charger.operator == "Punjenje d.o.o."
    assert charger.points == 4 and charger.country == "HR"


def test_extraction_sites(result: ExtractResult) -> None:
    """From their own prefilter pass: nodes 80-85 and way 112 in the fixture."""
    assert set(result.extraction) == {
        "osm:node/80",
        "osm:node/81",
        "osm:node/82",
        "osm:node/85",
        "osm:way/112",
    }
    well = result.extraction["osm:node/80"]
    assert well.kind is ExtractionKind.WELL and well.substance is Substance.GAS
    assert well.name == "Bušotina Primjer" and well.operator == "Nafta d.d." and well.country == "HR"
    platform = result.extraction["osm:node/81"]
    assert platform.kind is ExtractionKind.PLATFORM and platform.substance is Substance.OIL_GAS
    assert platform.country == "HR"  # at sea, matched to the nearest coast within the offshore tolerance
    mine = result.extraction["osm:node/82"]
    assert mine.kind is ExtractionKind.MINE and mine.substance is Substance.COAL
    shaft = result.extraction["osm:node/85"]
    assert shaft.kind is ExtractionKind.SHAFT and shaft.status is Status.CONSTRUCTION
    assert shaft.substance is Substance.UNKNOWN
    pit = result.extraction["osm:way/112"]
    assert pit.kind is ExtractionKind.QUARRY and pit.substance is Substance.LIGNITE
    assert 15.20 <= pit.location[0] <= 15.24 and pit.country == "HR"
    assert result.counts()["extraction"] == 5


def test_a_charging_station_is_not_found_by_the_power_pass(fixtures: Path, tmp_path: Path) -> None:
    """The two passes exist precisely because one selection cannot find both."""
    power_only = prefilter(fixtures / "sample.osm", tmp_path / "p.osm.pbf", config.POWER_FILTER)
    ids = {(o.type_str(), o.id) for o in osmium.FileProcessor(str(power_only))}
    assert ("n", 72) not in ids
    chargers_only = prefilter(fixtures / "sample.osm", tmp_path / "c.osm.pbf", config.CHARGER_FILTER)
    kept = {(o.type_str(), o.id) for o in osmium.FileProcessor(str(chargers_only))}
    assert kept == {("n", 72)}  # and nothing else: the pass is exact, so the file stays tiny


def test_pipelines_on_land_are_gas_and_oil_only(result: ExtractResult) -> None:
    # water, a pipe that names no substance and a disused one are not on the map
    assert set(result.pipelines) == {"osm:way/120", "osm:way/121"}
    gas = result.pipelines["osm:way/120"]
    assert gas.medium is Medium.GAS and gas.status is Status.OPERATING
    assert gas.name == "Magistralni plinovod" and gas.operator == "Plinacro"
    assert set(gas.countries) == {"HR", "SI"}
    assert gas.parts == (((14.5, 45.5), (15.5, 45.5)),)
    # 800 mm is 31.5 inches; one degree of longitude at 45.5° N is about 78 km
    assert gas.diameter_in == 31.5
    assert gas.length_km is not None and 77 < gas.length_km < 79
    assert gas.commissioning_year == 2011
    assert gas.provenance[0].source == "openstreetmap" and gas.provenance[0].source_id == "way/120"
    oil = result.pipelines["osm:way/121"]
    # the older type=* key names the substance; a diameter in inches is not read as millimetres
    assert oil.medium is Medium.OIL and oil.status is Status.CONSTRUCTION
    assert oil.diameter_in is None and oil.name is None
    assert result.counts()["pipelines"] == 2
    # the two that are pipelines of something else are counted, the disused one never reaches the extract
    assert result.stats["pipeline_not_gas_or_oil"] == 2
    # piping inside a station (way 125, 31 m) is not a pipeline between places
    assert result.stats["pipeline_too_short"] == 1


def test_pipelines_survive_the_merge_of_two_countries(result: ExtractResult) -> None:
    merged = ExtractResult()
    merged.merge(result)
    merged.merge(result)
    assert set(merged.pipelines) == set(result.pipelines)
