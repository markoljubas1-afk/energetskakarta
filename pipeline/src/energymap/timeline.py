"""Capacity in operation by year, for the map's time machine (Faza 18-3).

Operating plants count from their commissioning year (the first unit's year: a plant extended later is
counted at its current capacity from the start). Units GEM lists as retired count from their start year up
to, not including, their retirement year, and are listed so the map can draw them as outlines. Plants
without a commissioning year or a capacity are not placed in time; they are counted per country instead, so
the map can say how much the timeline leaves out. Plants under construction or planned are not included.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import Any

from energymap.gem.normalize import RetiredUnit
from energymap.schema import PowerPlant, Status, Technology

TIMELINE_FILE = "timeline.json"
# Earlier years in this region are data errors (the first public power stations date from the 1880s).
EARLIEST_YEAR = 1880


def retired_plants(units: Iterable[RetiredUnit]) -> list[dict[str, Any]]:
    """Retired units grouped by GEM location: one outline per site, with its first start and last
    retirement year. The technology carrying the most capacity describes the site, as for live plants."""
    groups: defaultdict[str, list[RetiredUnit]] = defaultdict(list)
    for unit in units:
        groups[unit.location_id].append(unit)
    out = []
    for location_id, members in sorted(groups.items()):
        by_tech: defaultdict[Technology, float] = defaultdict(float)
        for unit in members:
            by_tech[unit.technology] += unit.capacity_mw
        technology = max(by_tech.items(), key=lambda item: (item[1], item[0].value))[0]
        first = members[0]
        out.append(
            {
                "id": f"retired:{location_id}",
                "name": first.plant_name,
                "technology": technology.value,
                "country": first.country,
                "capacityMw": round(sum(unit.capacity_mw for unit in members), 1),
                "commissioningYear": min(unit.start_year for unit in members),
                "retiredYear": max(unit.retired_year for unit in members),
                "lon": round(first.longitude, 5),
                "lat": round(first.latitude, 5),
            }
        )
    return out


def build_timeline(
    plants: Iterable[PowerPlant],
    retired: Sequence[RetiredUnit],
    scope: Iterable[str],
    now: datetime,
) -> dict[str, Any]:
    countries = sorted(set(scope))
    last = now.year
    # (country, technology, MW, first year counted, first year no longer counted or None)
    spans: list[tuple[str, str, float, int, int | None]] = []
    undated: dict[str, list[float]] = {country: [0, 0.0] for country in countries}
    for plant in plants:
        if plant.status is not Status.OPERATING or plant.country not in undated:
            continue
        year = plant.commissioning_year
        if year is None or plant.capacity_mw is None or not EARLIEST_YEAR <= year <= last:
            undated[plant.country][0] += 1
            undated[plant.country][1] += plant.capacity_mw or 0.0
            continue
        spans.append((plant.country, plant.technology.value, plant.capacity_mw, year, None))
    in_time = [
        unit
        for unit in retired
        if unit.country in undated and unit.start_year >= EARLIEST_YEAR and unit.retired_year <= last
    ]
    for unit in in_time:
        spans.append(
            (unit.country, unit.technology.value, unit.capacity_mw, unit.start_year, unit.retired_year)
        )

    first = min((span[3] for span in spans), default=last)
    size = last - first + 1
    series: dict[str, dict[str, list[float]]] = {}
    for country, technology, mw, start, end in spans:
        row = series.setdefault(country, {}).setdefault(technology, [0.0] * size)
        stop = size if end is None else min(size, end - first)
        for i in range(start - first, stop):
            row[i] += mw
    return {
        "version": 1,
        "generatedAt": now.isoformat(),
        "firstYear": first,
        "lastYear": last,
        "series": {
            country: {tech: [round(v, 1) for v in values] for tech, values in sorted(techs.items())}
            for country, techs in sorted(series.items())
        },
        "undated": {
            country: {"plants": int(counts[0]), "mw": round(counts[1], 1)}
            for country, counts in undated.items()
        },
        "retired": retired_plants(in_time),
    }
