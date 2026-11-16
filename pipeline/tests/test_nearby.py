"""The grid next to a plant: its nearest substation and the lines ending there, when the answer is plain."""

from __future__ import annotations

from typing import Any

from energymap.nearby import nearby
from energymap.schema import PowerPlant, Substation, TransmissionLine

PROVENANCE = [
    {
        "source": "openstreetmap",
        "source_id": "way/1",
        "license": "ODbL-1.0",
        "retrieved_at": "2026-11-16T12:00:00Z",
    }
]
# one hundredth of a degree of latitude is about 1.1 km
PLANT = (16.0, 45.0)


def plant(number: int, location: tuple[float, float] = PLANT) -> PowerPlant:
    return PowerPlant.model_validate(
        {
            "id": f"osm:way/{number}", "name": None, "technology": "hydro", "capacity_mw": 50.0,
            "commissioning_year": None, "country": "HR", "location": location, "status": "operating",
            "operator": None, "provenance": PROVENANCE,
        }
    )  # fmt: skip


def substation(number: int, location: tuple[float, float], **changes: Any) -> Substation:
    record: dict[str, Any] = {
        "id": f"osm:way/{number}", "name": None, "voltages_kv": (110.0,), "country": "HR",
        "location": location, "status": "operating", "operator": None, "provenance": PROVENANCE,
    }  # fmt: skip
    return Substation.model_validate({**record, **changes})


def line(number: int, points: list[tuple[float, float]], **changes: Any) -> TransmissionLine:
    record: dict[str, Any] = {
        "id": f"osm:way/{number}", "kind": "line", "voltages_kv": (110.0,), "circuits": None,
        "is_hvdc": False, "countries": ("HR",), "is_interconnector": False, "geometry": tuple(points),
        "status": "operating", "operator": None, "provenance": PROVENANCE,
    }  # fmt: skip
    return TransmissionLine.model_validate({**record, **changes})


AT_THE_FENCE = (16.0, 45.003)  # about 330 m north of the plant
FAR_END = (16.3, 45.2)


def test_names_the_nearest_substation_its_distance_and_the_lines_that_end_there() -> None:
    result = nearby(
        [plant(1)],
        [substation(10, AT_THE_FENCE), substation(11, FAR_END)],
        [
            # ends at the gantry, a little off the point the substation is recorded at; drawn either way round
            line(20, [(16.0, 45.0035), (16.1, 45.1), FAR_END]),
            line(21, [(16.2, 45.3), (16.002, 45.003)]),
            # passes by without ending there
            line(22, [(15.9, 45.0), (16.1, 45.006)]),
        ],
    )
    assert result["version"] == 1 and result["fields"] == ["substation", "metres", "lines"]
    assert result["plants"] == {"osm:way/1": ["osm:way/10", 334, ["osm:way/20", "osm:way/21"]]}


def test_says_nothing_when_two_substations_are_about_equally_near() -> None:
    lines = [line(20, [AT_THE_FENCE, FAR_END]), line(21, [(16.0, 44.996), FAR_END])]
    # 330 m to the north and 440 m to the south: which one is the plant's is anyone's guess
    close = [substation(10, AT_THE_FENCE), substation(11, (16.0, 44.996))]
    assert nearby([plant(1)], close, lines)["plants"] == {}
    # the second one more than twice as far: no doubt left
    clear = [substation(10, AT_THE_FENCE), substation(11, (16.0, 44.992))]
    assert list(nearby([plant(1)], clear, lines)["plants"]) == ["osm:way/1"]


def test_says_nothing_without_a_substation_in_reach_or_without_lines_ending_at_it() -> None:
    lines = [line(20, [AT_THE_FENCE, FAR_END])]
    # three kilometres away
    assert (
        nearby([plant(1)], [substation(10, (16.0, 45.027))], [line(20, [(16.0, 45.027), FAR_END])])["plants"]
        == {}
    )
    # a substation next door that no recorded line reaches
    assert nearby([plant(1)], [substation(10, AT_THE_FENCE)], [])["plants"] == {}
    # only what is in operation counts, on both sides
    planned = substation(10, AT_THE_FENCE, status="planned")
    assert nearby([plant(1)], [planned], lines)["plants"] == {}
    building = [line(20, [AT_THE_FENCE, FAR_END], status="construction")]
    assert nearby([plant(1)], [substation(10, AT_THE_FENCE)], building)["plants"] == {}


def test_each_plant_is_judged_on_its_own() -> None:
    other = (16.5, 45.5)
    result = nearby(
        [plant(1), plant(2, other), plant(3, (17.0, 46.0))],
        [substation(10, AT_THE_FENCE), substation(11, (16.5, 45.501))],
        [line(20, [AT_THE_FENCE, (16.5, 45.501)])],
    )
    assert {key: value[0] for key, value in result["plants"].items()} == {
        "osm:way/1": "osm:way/10",
        "osm:way/2": "osm:way/11",
    }
