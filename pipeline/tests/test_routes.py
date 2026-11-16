"""Routes for the guided stories: the shortest way through the build's own lines."""

from __future__ import annotations

from typing import Any

from energymap.routes import JOIN_KM, Place, RouteSpec, distance_km, find, routes
from energymap.schema import TransmissionLine

A, B, C, D = (16.0, 44.0), (16.0, 45.0), (15.0, 45.0), (16.5, 44.5)
SPEC = RouteSpec("test", Place("A", *A), Place("C", *C), 380.0)
# one millimetre on the map short of the join distance: the gap between two gantries of one substation
NEAR = JOIN_KM * 0.8 / 111.32


def line(number: int, points: list[tuple[float, float]], **changes: Any) -> TransmissionLine:
    record: dict[str, Any] = {
        "id": f"osm:way/{number}", "kind": "line", "voltages_kv": (400.0,), "circuits": None,
        "is_hvdc": False, "countries": ("HR",), "is_interconnector": False, "geometry": tuple(points),
        "status": "operating", "operator": None,
        "provenance": [{"source": "openstreetmap", "source_id": f"way/{number}", "license": "ODbL-1.0",
                        "retrieved_at": "2026-11-16T12:00:00Z"}],
    }  # fmt: skip
    return TransmissionLine.model_validate({**record, **changes})


def test_distance_is_close_enough_for_a_map() -> None:
    # one degree of latitude; one degree of longitude at 45 degrees north
    assert round(distance_km((16.0, 44.0), (16.0, 45.0)), 1) == 111.3
    assert round(distance_km((15.0, 45.0), (16.0, 45.0)), 1) == 78.7


def test_follows_the_lines_in_order_whichever_way_each_was_drawn() -> None:
    # the second line was drawn from its far end, and does not quite touch the first
    first = line(1, [A, (16.0, 44.5), B])
    second = line(2, [C, (15.5, 45.0), (B[0], B[1] + NEAR)])
    route = find([second, first], SPEC)
    assert route is not None
    assert route["coordinates"][0] == [16.0, 44.0]
    assert route["coordinates"][-1] == [15.0, 45.0]
    assert [16.0, 44.5] in route["coordinates"] and [15.5, 45.0] in route["coordinates"]
    assert route["lines"] == 2
    assert (
        route["stops"][0] == [16.0, 44.0] and route["stops"][-1] == [15.0, 45.0] and len(route["stops"]) == 3
    )
    assert (route["from"], route["to"], route["minKv"]) == ("A", "C", 380.0)
    assert 189 < route["km"] < 191


def test_takes_the_shorter_of_two_ways() -> None:
    direct = [line(1, [A, B]), line(2, [B, C])]
    detour = [line(3, [A, D]), line(4, [D, (17.0, 45.5)]), line(5, [(17.0, 45.5), C])]
    route = find(detour + direct, SPEC)
    assert route is not None and route["lines"] == 2


def test_only_operating_alternating_current_lines_of_the_voltage_count() -> None:
    second = line(2, [B, C])
    for unusable in (
        line(1, [A, B], voltages_kv=(220.0,)),
        line(1, [A, B], voltages_kv=()),
        line(1, [A, B], status="construction"),
        line(1, [A, B], is_hvdc=True),
    ):
        assert find([unusable, second], SPEC) is None
    assert find([line(1, [A, B], voltages_kv=(400.0, 110.0)), second], SPEC) is not None


def test_no_route_when_the_lines_do_not_meet_or_do_not_reach_a_named_end() -> None:
    assert find([], SPEC) is None
    # a gap wider than a substation
    assert find([line(1, [A, B]), line(2, [(B[0], B[1] + 0.02), C])], SPEC) is None
    # the lines connect, but end twenty kilometres from the named place
    far = RouteSpec("far", Place("A", *A), Place("elsewhere", 15.0, 45.2), 380.0)
    assert find([line(1, [A, B]), line(2, [B, C])], far) is None


def test_the_product_lists_only_routes_the_lines_still_make() -> None:
    assert routes([]) == {"version": 1, "source": "openstreetmap", "license": "ODbL-1.0", "routes": {}}
