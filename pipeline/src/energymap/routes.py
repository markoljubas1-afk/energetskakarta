"""Routes along real transmission lines, for the guided stories on the website (Faza 35-3).

A story shows a point of light travelling from a plant towards a city. It must follow lines that exist, so
the route is not drawn by hand: every build finds it again in the build's own lines, as the shortest way
through the lines of the highest voltage between two places. If the lines no longer connect the two places
the route is simply absent, and the website does not offer the story.

The lines come from OpenStreetMap as separate ways. Two ways that meet in a substation rarely share a
point: each ends at its own gantry. Ends closer than ``JOIN_KM`` are therefore taken to be one node.
Verified on the build of 2026-11-16: with 0.05 km the 400 kV lines of Croatia fall apart at every
substation; from 0.3 km up to 1 km the route Konjsko - Velebit - Melina - Tumbri is found, the same each
time (408 km, three lines).

What a route is NOT: a statement about where electricity flows. It is the path of a picture.
"""

from __future__ import annotations

import heapq
import math
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from energymap.schema import Status, TransmissionLine

ROUTES_VERSION = 1
ROUTES_FILE = "routes.json"
#: ends of two lines closer than this are one node (a substation's gantries)
JOIN_KM = 0.3
#: a route's named end must have a line end this close, or the route is not made
REACH_KM = 10.0
_KM_PER_DEGREE = 111.32

Point = tuple[float, float]


@dataclass(frozen=True, slots=True)
class Place:
    name: str
    lon: float
    lat: float


@dataclass(frozen=True, slots=True)
class RouteSpec:
    key: str
    start: Place
    end: Place
    #: only lines whose highest voltage is at least this are used
    min_kv: float


#: Positions are the ends of the lines at each substation in the build of 2026-11-16.
ROUTES: tuple[RouteSpec, ...] = (
    RouteSpec(
        key="dalmacija-zagreb",
        start=Place("Konjsko", 16.501, 43.602),
        end=Place("Tumbri", 15.868, 45.681),
        min_kv=380.0,
    ),
)


def distance_km(a: Point, b: Point) -> float:
    """Plenty for a few hundred kilometres at these latitudes: a flat map scaled by the cosine."""
    shrink = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * shrink, a[1] - b[1]) * _KM_PER_DEGREE


def _length_km(points: Sequence[Point]) -> float:
    return sum(distance_km(points[i], points[i + 1]) for i in range(len(points) - 1))


class _Graph:
    def __init__(self) -> None:
        self.nodes: list[Point] = []
        self._cells: dict[tuple[int, int], list[int]] = defaultdict(list)
        #: node -> (other node, km, line index, whether the line runs backwards on this edge)
        self.edges: dict[int, list[tuple[int, float, int, bool]]] = defaultdict(list)

    def node(self, point: Point) -> int:
        size = JOIN_KM / _KM_PER_DEGREE
        gx, gy = math.floor(point[0] / size), math.floor(point[1] / size)
        # the cells are at least JOIN_KM wide in both directions, so a neighbour is in the 3 x 3 around
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for index in self._cells[(gx + dx, gy + dy)]:
                    if distance_km(self.nodes[index], point) <= JOIN_KM:
                        return index
        self.nodes.append(point)
        self._cells[(gx, gy)].append(len(self.nodes) - 1)
        return len(self.nodes) - 1

    def nearest(self, place: Place) -> int | None:
        if not self.nodes:
            return None
        target = (place.lon, place.lat)
        index = min(range(len(self.nodes)), key=lambda i: distance_km(self.nodes[i], target))
        return index if distance_km(self.nodes[index], target) <= REACH_KM else None


def find(lines: Iterable[TransmissionLine], spec: RouteSpec) -> dict[str, Any] | None:
    """The shortest way from ``spec.start`` to ``spec.end`` along operating alternating-current lines of
    at least ``spec.min_kv``, or None when the lines do not connect the two."""
    usable = [
        line.geometry
        for line in lines
        if line.status is Status.OPERATING
        and not line.is_hvdc
        and line.max_voltage_kv is not None
        and line.max_voltage_kv >= spec.min_kv
    ]
    graph = _Graph()
    for index, geometry in enumerate(usable):
        a, b = graph.node(geometry[0]), graph.node(geometry[-1])
        if a == b:
            continue
        km = _length_km(geometry)
        graph.edges[a].append((b, km, index, False))
        graph.edges[b].append((a, km, index, True))
    start, end = graph.nearest(spec.start), graph.nearest(spec.end)
    if start is None or end is None or start == end:
        return None

    best: dict[int, float] = {start: 0.0}
    came_by: dict[int, tuple[int, int, bool]] = {}
    queue: list[tuple[float, int]] = [(0.0, start)]
    while queue:
        so_far, node = heapq.heappop(queue)
        if node == end:
            break
        if so_far > best.get(node, math.inf):
            continue
        for other, km, index, backwards in graph.edges[node]:
            if so_far + km < best.get(other, math.inf):
                best[other] = so_far + km
                came_by[other] = (node, index, backwards)
                heapq.heappush(queue, (so_far + km, other))
    if end not in came_by:
        return None

    legs: list[Sequence[Point]] = []
    node = end
    while node != start:
        node, index, backwards = came_by[node]
        legs.append(usable[index][::-1] if backwards else usable[index])
    legs.reverse()
    coordinates: list[list[float]] = []
    stops: list[list[float]] = []
    for leg in legs:
        stops.append([round(leg[0][0], 5), round(leg[0][1], 5)])
        for lon, lat in leg:
            point = [round(lon, 5), round(lat, 5)]
            if not coordinates or coordinates[-1] != point:
                coordinates.append(point)
    stops.append(coordinates[-1])
    return {
        "from": spec.start.name,
        "to": spec.end.name,
        "minKv": spec.min_kv,
        "km": round(_length_km([(lon, lat) for lon, lat in coordinates]), 1),
        "lines": len(legs),
        # where one line ends and the next begins: the substations on the way, ends included
        "stops": stops,
        "coordinates": coordinates,
    }


def routes(lines: Sequence[TransmissionLine]) -> dict[str, Any]:
    """Every route of ``ROUTES`` that this build's lines still make."""
    found = {spec.key: route for spec in ROUTES if (route := find(lines, spec)) is not None}
    return {
        "version": ROUTES_VERSION,
        "source": "openstreetmap",
        "license": "ODbL-1.0",
        "routes": found,
    }
