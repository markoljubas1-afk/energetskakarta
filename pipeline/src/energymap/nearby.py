"""The grid next to a plant (Faza 33-2b): its nearest substation and the lines that end there.

When a plant is selected the map lights the substation next to it and the lines that leave that
substation, so the reader sees how the plant sits in the grid. This is geometry, and is said as such:
"the nearest substation, 290 m away", never "the plant is connected to". No open source records which
plant feeds which substation, and the map does not guess it.

A plant gets an entry only when the answer is plain:

* a substation in operation lies within ``PLANT_REACH_KM`` of the plant, and
* no second one is nearly as close (it must be at least ``CLEAR_FACTOR`` times as far), and
* at least one line in operation ends within ``LINE_REACH_KM`` of that substation.

Measured on the build of 2026-11-16 (13 446 plants, 20 967 substations, 23 954 lines): 552 of the 1 496
plants of 10 MW or more and 1 764 smaller ones qualify. Checked by hand: Krško (RTP Krško, 0.29 km),
Plomin (TS Plomin, 0.20 km), HE Dubrovnik (TS HE Dubrovnik, 0.23 km; TS Plat at 0.8 km is far enough to
leave no doubt), Zakučac (its own switchyard, 0.06 km).
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Iterable, Sequence
from typing import Any

from energymap.routes import distance_km
from energymap.schema import PowerPlant, Status, Substation, TransmissionLine

NEARBY_VERSION = 1
NEARBY_FILE = "nearby.json"
#: a plant's own switchyard or the substation at its fence
PLANT_REACH_KM = 2.0
#: the second nearest substation must be this many times as far as the nearest, or the answer is not plain
CLEAR_FACTOR = 2.0
#: below this the nearest is "at the plant"; the factor is applied to at least this distance
CLEAR_FLOOR_KM = 0.15
#: a line ends at a substation's gantry, not at the point the substation is recorded at
LINE_REACH_KM = 0.6
#: side of an index cell in degrees: wider than either reach at these latitudes (about 4 km east-west)
_CELL_DEG = 0.05

Point = tuple[float, float]


class _SubstationIndex:
    def __init__(self, substations: Sequence[Substation]) -> None:
        self.substations = substations
        self._cells: dict[tuple[int, int], list[int]] = defaultdict(list)
        for index, substation in enumerate(substations):
            self._cells[self._cell(substation.location)].append(index)

    @staticmethod
    def _cell(point: Point) -> tuple[int, int]:
        return math.floor(point[0] / _CELL_DEG), math.floor(point[1] / _CELL_DEG)

    def within(self, point: Point, limit_km: float) -> list[tuple[float, int]]:
        """Substations within ``limit_km`` of ``point`` as (km, index), nearest first."""
        gx, gy = self._cell(point)
        found = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for index in self._cells.get((gx + dx, gy + dy), ()):
                    km = distance_km(self.substations[index].location, point)
                    if km <= limit_km:
                        found.append((km, index))
        return sorted(found)


def nearby(
    plants: Iterable[PowerPlant],
    substations: Iterable[Substation],
    lines: Iterable[TransmissionLine],
) -> dict[str, Any]:
    """For each plant with a plain answer: ``[substation id, metres to it, [ids of lines ending there]]``."""
    index = _SubstationIndex([s for s in substations if s.status is Status.OPERATING])
    ends: dict[int, list[str]] = defaultdict(list)
    for line in lines:
        if line.status is not Status.OPERATING:
            continue
        touched = set()
        for end in (line.geometry[0], line.geometry[-1]):
            hit = index.within(end, LINE_REACH_KM)
            if hit:
                touched.add(hit[0][1])
        for substation in touched:
            ends[substation].append(line.id)

    found: dict[str, list[Any]] = {}
    for plant in plants:
        hit = index.within(plant.location, PLANT_REACH_KM)
        if not hit:
            continue
        km, nearest = hit[0]
        if len(hit) > 1 and hit[1][0] < CLEAR_FACTOR * max(km, CLEAR_FLOOR_KM):
            continue
        if not ends[nearest]:
            continue
        found[plant.id] = [index.substations[nearest].id, round(km * 1000), sorted(ends[nearest])]
    return {
        "version": NEARBY_VERSION,
        "plantReachKm": PLANT_REACH_KM,
        "lineReachKm": LINE_REACH_KM,
        "fields": ["substation", "metres", "lines"],
        "plants": dict(sorted(found.items())),
    }
