"""Small derived products published with every build: the search index and summary statistics.

Both are computed from the validated records, so they can never disagree with the map layers.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from shapely.geometry import LineString

from energymap.geo.countries import CountryIndex
from energymap.schema import (
    CityEnergy,
    DataCenter,
    ExtractionSite,
    PowerPlant,
    Sector,
    Substation,
    TransmissionLine,
)

SEARCH_VERSION = 1
STATS_VERSION = 1
SEARCH_FIELDS = ("id", "name", "layer", "country", "lon", "lat", "detail")

VoltageClass = str
# One vocabulary for the whole map. "<60" can only occur in the distribution layer, which is why the
# statistics below (transmission only) never produce it.
VOLTAGE_CLASSES: tuple[VoltageClass, ...] = ("380+", "220-379", "110-219", "60-109", "<60", "unknown")


def voltage_class(max_kv: float | None) -> VoltageClass:
    if max_kv is None:
        return "unknown"
    if max_kv >= 380:
        return "380+"
    if max_kv >= 220:
        return "220-379"
    if max_kv >= 110:
        return "110-219"
    if max_kv >= 60:
        return "60-109"
    return "<60"


def search_index(
    plants: Iterable[PowerPlant],
    substations: Iterable[Substation],
    datacenters: Iterable[DataCenter] = (),
    cities: Iterable[CityEnergy] = (),
    extraction: Iterable[ExtractionSite] = (),
) -> dict[str, Any]:
    """Compact, row-oriented index of named point assets, sorted by name for stable output.

    ``detail`` is a short machine-readable hint the UI can format per language:
    ``"<technology>|<capacity MW or empty>"`` for plants, ``"<max kV or empty>"`` for substations and
    ``"<power MW or empty>"`` for data centres, ``"<inventory year>|<electricity MWh>"`` for cities and
    ``"<kind>|<substance>"`` for extraction sites.

    Distribution assets are deliberately absent: the index is downloaded by everyone who opens the map,
    and distribution coverage is too uneven to be worth that weight.
    """
    rows: list[list[Any]] = []
    for plant in plants:
        if plant.name:
            capacity = "" if plant.capacity_mw is None else f"{plant.capacity_mw:g}"
            rows.append(
                [
                    plant.id,
                    plant.name,
                    "plants",
                    plant.country,
                    *plant.location,
                    f"{plant.technology}|{capacity}",
                ]
            )
    for station in substations:
        if station.name:
            top = f"{station.voltages_kv[0]:g}" if station.voltages_kv else ""
            rows.append([station.id, station.name, "substations", station.country, *station.location, top])
    for centre in datacenters:
        if centre.name:
            power = "" if centre.power_mw is None else f"{centre.power_mw:g}"
            rows.append([centre.id, centre.name, "datacenters", centre.country, *centre.location, power])
    for city in cities:
        detail = f"{city.inventory_year}|{city.electricity_mwh:g}"
        rows.append([city.id, city.name, "cities", city.country, *city.location, detail])
    for site in extraction:
        if site.name:
            detail = f"{site.kind}|{site.substance}"
            rows.append([site.id, site.name, "extraction", site.country, *site.location, detail])
    rows.sort(key=lambda row: (str(row[1]).casefold(), str(row[0])))
    return {"version": SEARCH_VERSION, "fields": list(SEARCH_FIELDS), "rows": rows}


def _nested() -> defaultdict[str, Any]:
    return defaultdict(_nested)


def _plain(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in sorted(value.items())}
    return value


def statistics(
    plants: Iterable[PowerPlant],
    substations: Iterable[Substation],
    lines: Iterable[TransmissionLine],
    index: CountryIndex,
    scope: frozenset[str],
    datacenters: Iterable[DataCenter] = (),
) -> dict[str, Any]:
    """Per-country totals.

    plants[country][technology][status]      = {count, capacityMw, withCapacity}
    substations[country][voltageClass]       = count (operating and planned together)
    lineKm[country][voltageClass][status]    = kilometres, interconnectors split by the share in each country
    datacenters[country][status]             = {count, powerMw, withPower}

    Only the transmission grid is counted: distribution coverage in OSM is too uneven for a per-country
    total to mean anything, and a number on a page reads as a measurement.
    """
    plant_stats = _nested()
    for plant in plants:
        bucket = plant_stats[plant.country][plant.technology.value][plant.status.value]
        bucket["count"] = bucket.get("count", 0) + 1
        if plant.capacity_mw is not None:
            bucket["capacityMw"] = round(bucket.get("capacityMw", 0.0) + plant.capacity_mw, 3)
            bucket["withCapacity"] = bucket.get("withCapacity", 0) + 1
        else:
            bucket.setdefault("capacityMw", 0.0)
            bucket.setdefault("withCapacity", 0)

    station_stats = _nested()
    for station in substations:
        klass = voltage_class(station.voltages_kv[0] if station.voltages_kv else None)
        station_stats[station.country][klass] = station_stats[station.country].get(klass, 0) + 1

    line_stats = _nested()
    for line in lines:
        klass = voltage_class(line.voltages_kv[0] if line.voltages_kv else None)
        for code, metres in index.line_shares(LineString(line.geometry)).items():
            if code not in scope or metres <= 0:
                continue
            bucket = line_stats[code][klass]
            bucket[line.status.value] = round(bucket.get(line.status.value, 0.0) + metres / 1000, 3)

    centre_stats = _nested()
    for centre in datacenters:
        bucket = centre_stats[centre.country][centre.status.value]
        bucket["count"] = bucket.get("count", 0) + 1
        # a data centre without a published power still counts; withPower says how many had one
        if centre.power_mw is not None:
            bucket["powerMw"] = round(bucket.get("powerMw", 0.0) + centre.power_mw, 3)
            bucket["withPower"] = bucket.get("withPower", 0) + 1
        else:
            bucket.setdefault("powerMw", 0.0)
            bucket.setdefault("withPower", 0)

    return {
        "version": STATS_VERSION,
        "voltageClasses": list(VOLTAGE_CLASSES),
        "note": "OpenStreetMap coverage; capacity is summed only where stated (see withCapacity).",
        "plants": _plain(plant_stats),
        "substations": _plain(station_stats),
        "lineKm": _plain(line_stats),
        "datacenters": _plain(centre_stats),
    }


def city_register(cities: Iterable[CityEnergy]) -> dict[str, Any]:
    """The register behind the /gradovi/ pages: one compact row per city, electricity by sector.

    Sectors are listed once in ``sectors`` and each row carries electricity per sector in that order
    (null where the city did not report the sector), so the file stays small for a few thousand cities.
    """
    sectors = [sector.value for sector in Sector]
    rows: list[list[Any]] = []
    for city in sorted(cities, key=lambda c: (-c.electricity_mwh, c.id)):
        per_sector = [round(city.sectors[s].electricity_mwh) if s in city.sectors else None for s in Sector]
        rows.append(
            [
                city.id,
                city.name,
                city.country,
                round(city.location[0], 5),
                round(city.location[1], 5),
                city.population,
                city.inventory_year,
                city.baseline,
                round(city.electricity_mwh),
                round(city.total_mwh),
                city.baseline_year,
                None if city.baseline_electricity_mwh is None else round(city.baseline_electricity_mwh),
                per_sector,
            ]
        )
    return {
        "version": 1,
        "fields": [
            "id",
            "name",
            "country",
            "lon",
            "lat",
            "population",
            "inventoryYear",
            "baseline",
            "electricityMwh",
            "totalMwh",
            "baselineYear",
            "baselineElectricityMwh",
            "electricityBySector",
        ],
        "sectors": sectors,
        "rows": rows,
    }
