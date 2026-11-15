from __future__ import annotations

import pytest

from energymap.osm import tags as t
from energymap.schema import ExtractionKind, Status, Substance, Technology


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("400000", (400.0,)),
        ("400000;220000", (400.0, 220.0)),
        ("220000;400000;220000", (400.0, 220.0)),
        ("110 kV", (110.0,)),
        ("110kV", (110.0,)),
        ("110 000", (110.0,)),
        ("27500", (27.5,)),
        ("400000;foo", (400.0,)),
        ("", ()),
        (None, ()),
        ("medium", ()),
        ("5000000", ()),
    ],
)
def test_parse_voltages(raw: str | None, expected: tuple[float, ...]) -> None:
    assert t.parse_voltages(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("276 MW", 276.0),
        ("276MW", 276.0),
        ("9,9 MW", 9.9),
        ("1.2 GW", 1200.0),
        ("1,2 GW", 1200.0),
        ("1,200 MW", 1200.0),
        ("1 200 MW", 1200.0),
        ("400 kW", 0.4),
        ("0.5 MWp", 0.5),
        ("1.200 MW", None),
        ("210", None),
        ("yes", None),
        ("", None),
        (None, None),
    ],
)
def test_parse_capacity(raw: str | None, expected: float | None) -> None:
    assert t.parse_capacity_mw(raw) == expected


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"power": "line"}, t.Lifecycle(t.Kind.LINE, Status.OPERATING)),
        ({"power": "plant"}, t.Lifecycle(t.Kind.PLANT, Status.OPERATING)),
        ({"construction:power": "line"}, t.Lifecycle(t.Kind.LINE, Status.CONSTRUCTION)),
        (
            {"power": "construction", "construction": "substation"},
            t.Lifecycle(t.Kind.SUBSTATION, Status.CONSTRUCTION),
        ),
        ({"proposed:power": "plant"}, t.Lifecycle(t.Kind.PLANT, Status.PLANNED)),
        ({"power": "proposed", "proposed": "cable"}, t.Lifecycle(t.Kind.CABLE, Status.PLANNED)),
        ({"planned:power": "line"}, t.Lifecycle(t.Kind.LINE, Status.PLANNED)),
        ({"disused:power": "line"}, None),
        ({"power": "minor_line"}, t.Lifecycle(t.Kind.MINOR_LINE, Status.OPERATING)),
        ({"proposed:power": "minor_line"}, t.Lifecycle(t.Kind.MINOR_LINE, Status.PLANNED)),
        ({"power": "tower"}, None),
        ({"power": "construction", "construction": "tower"}, None),
        ({}, None),
    ],
)
def test_lifecycle(tags: dict[str, str], expected: t.Lifecycle | None) -> None:
    assert t.lifecycle(tags) == expected


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"plant:source": "hydro"}, Technology.HYDRO),
        ({"plant:source": "hydro", "plant:method": "water-pumped-storage"}, Technology.PUMPED_STORAGE),
        ({"plant:source": "Solar"}, Technology.SOLAR),
        ({"plant:source": "gas;oil"}, Technology.GAS),
        ({"plant:source": "biogas"}, Technology.BIOMASS),
        ({"plant:source": "waste"}, Technology.OTHER),
        ({}, Technology.OTHER),
    ],
)
def test_technology(tags: dict[str, str], expected: Technology) -> None:
    assert t.technology(tags) == expected


@pytest.mark.parametrize(
    ("raw", "expected"), [("2", 2), ("2;1", 3), ("0", None), ("two", None), ("", None), (None, None)]
)
def test_parse_circuits(raw: str | None, expected: int | None) -> None:
    assert t.parse_circuits(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"), [("1985-05", 1985), ("2027", 2027), ("~1960", None), ("1700", None), (None, None)]
)
def test_parse_year(raw: str | None, expected: int | None) -> None:
    assert t.parse_year(raw) == expected


TRANSMISSION = t.Role.TRANSMISSION
DISTRIBUTION = t.Role.DISTRIBUTION


@pytest.mark.parametrize(
    ("kind", "tags", "voltages", "expected"),
    [
        (t.Kind.LINE, {}, (400.0,), TRANSMISSION),
        (t.Kind.LINE, {}, (60.0,), TRANSMISSION),  # exactly at the threshold
        (t.Kind.LINE, {}, (), TRANSMISSION),  # unknown voltage overhead line: HV by OSM convention
        (t.Kind.LINE, {}, (35.0,), DISTRIBUTION),
        (t.Kind.CABLE, {}, (110.0,), TRANSMISSION),
        (t.Kind.CABLE, {}, (), DISTRIBUTION),  # a bare cable could be anything, so it goes low
        (t.Kind.MINOR_LINE, {}, (20.0,), DISTRIBUTION),
        (t.Kind.MINOR_LINE, {}, (), DISTRIBUTION),
        # a mistagged minor_line stays distribution: power=minor_line says what it is
        (t.Kind.MINOR_LINE, {}, (110.0,), DISTRIBUTION),
        (t.Kind.LINE, {"line": "busbar"}, (110.0,), None),  # substation internals are not lines
        (t.Kind.MINOR_LINE, {"line": "bay"}, (20.0,), None),
    ],
)
def test_line_role(
    kind: t.Kind, tags: dict[str, str], voltages: tuple[float, ...], expected: t.Role | None
) -> None:
    assert t.line_role(kind, tags, voltages) is expected


@pytest.mark.parametrize(
    ("tags", "voltages", "expected"),
    [
        ({}, (110.0, 35.0), TRANSMISSION),  # the highest voltage decides
        ({}, (60.0,), TRANSMISSION),
        ({}, (), TRANSMISSION),  # unmapped voltage: usually a large named station
        ({}, (35.0,), DISTRIBUTION),
        ({"substation": "minor_distribution"}, (), DISTRIBUTION),
        ({"substation": "minor_distribution"}, (110.0,), DISTRIBUTION),
    ],
)
def test_substation_role(tags: dict[str, str], voltages: tuple[float, ...], expected: t.Role) -> None:
    assert t.substation_role(tags, voltages) is expected


def test_text_joins_multi_values() -> None:
    assert t.text({"operator": "HOPS;ELES"}, "operator") == "HOPS; ELES"
    assert t.text({"name": " ", "name:en": "Plant"}, "name", "name:en") == "Plant"
    assert t.text({}, "name") is None


@pytest.mark.parametrize(
    ("raw", "expected"), [("4", 4), ("1", 1), ("0", None), ("2;4", None), ("many", None), (None, None)]
)
def test_parse_points(raw: str | None, expected: int | None) -> None:
    assert t.parse_points(raw) == expected


def test_charging_station_is_recognised_with_lifecycle_prefixes() -> None:
    assert t.charging_station({"amenity": "charging_station"}) is Status.OPERATING
    assert t.charging_station({"proposed:amenity": "charging_station"}) is Status.PLANNED
    assert t.charging_station({"amenity": "parking"}) is None
    assert t.charging_station({}) is None


P, W, M, S, A, Q = ExtractionKind
OP, CO, PL = Status.OPERATING, Status.CONSTRUCTION, Status.PLANNED


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"man_made": "petroleum_well"}, (W, OP, Substance.OIL_GAS)),
        ({"man_made": "petroleum_well", "substance": "oil"}, (W, OP, Substance.OIL)),
        ({"man_made": "petroleum_well", "resource": "oil;gas"}, (W, OP, Substance.OIL_GAS)),
        ({"man_made": "offshore_platform"}, (P, OP, Substance.OIL_GAS)),
        ({"proposed:man_made": "offshore_platform"}, (P, PL, Substance.OIL_GAS)),
        ({"construction:man_made": "mineshaft"}, (S, CO, Substance.UNKNOWN)),
        ({"landuse": "industrial", "industrial": "mine"}, (M, OP, Substance.UNKNOWN)),
        ({"industrial": "mine", "resource": "brown_coal"}, (M, OP, Substance.LIGNITE)),
        ({"industrial": "mine", "resource": "bauxite"}, (M, OP, Substance.OTHER)),
        ({"industrial": "mine", "landuse": "quarry", "resource": "salt"}, (M, OP, Substance.OTHER)),
        ({"man_made": "mineshaft", "resource": "uranium"}, (S, OP, Substance.URANIUM)),
        ({"man_made": "adit", "resource": "Coal"}, (A, OP, Substance.COAL)),
        ({"landuse": "quarry", "resource": "lignite"}, (Q, OP, Substance.LIGNITE)),
        ({"landuse": "quarry", "resource": "peat"}, (Q, OP, Substance.PEAT)),
        ({"landuse": "quarry", "resource": "limestone"}, None),
        ({"landuse": "quarry"}, None),
        ({"disused:man_made": "mineshaft"}, None),
        ({"abandoned:landuse": "quarry", "resource": "coal"}, None),
        ({"man_made": "water_tower"}, None),
    ],
)
def test_extraction_site(
    tags: dict[str, str], expected: tuple[ExtractionKind, Status, Substance] | None
) -> None:
    found = t.extraction_site(tags)
    assert (found and (found.kind, found.status, found.substance)) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Q1234", "Q1234"),
        (" Q1234 ", "Q1234"),
        ("Q12;Q34", "Q12"),
        ("q1234", None),  # Wikidata ids are upper case; anything else is not an id
        ("Q0", None),
        ("https://www.wikidata.org/wiki/Q1234", None),
        ("", None),
    ],
)
def test_wikidata(raw: str, expected: str | None) -> None:
    assert t.wikidata({"wikidata": raw}) == expected
    assert t.wikidata({}) is None


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("hr:HE Zakučac", "hr:HE Zakučac"),
        ("en: Krško Nuclear Power Plant", "en:Krško Nuclear Power Plant"),
        ("sr-latn:TE Nikola Tesla", "sr-latn:TE Nikola Tesla"),
        ("HE Zakučac", None),  # without the language there is no address to link to
        ("hr:", None),
        ("", None),
    ],
)
def test_wikipedia(raw: str, expected: str | None) -> None:
    assert t.wikipedia({"wikipedia": raw}) == expected
