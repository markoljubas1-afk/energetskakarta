"""The time machine's data: retired GEM units and capacity in operation by year (Faza 18-3)."""

from __future__ import annotations

from datetime import UTC, datetime
from itertools import count

from energymap.gem.normalize import RetiredUnit, load, parse_retired
from energymap.schema import PowerPlant, Provenance, Status, Technology
from energymap.timeline import build_timeline, retired_plants

NOW = datetime(2026, 11, 15, 12, 0, tzinfo=UTC)

ROW = {
    "unit_id": "G100000100001",
    "location_id": "L100000100001",
    "country": "Croatia",
    "plant_name": "Rijeka power station",
    "type": "oil/gas",
    "technology": "steam turbine",
    "fuel": "fossil liquids: fuel oil",
    "capacity_mw": "320",
    "status": "retired",
    "start_year": "1978",
    "retired_year": "2013",
    "latitude": "45.29",
    "longitude": "14.56",
}


_IDS = count(1)


def plant(name: str, tech: Technology, mw: float | None, year: int | None, **extra: object) -> PowerPlant:
    way = f"way/{next(_IDS)}"
    prov = Provenance(source="openstreetmap", source_id=way, license="ODbL-1.0", retrieved_at=NOW)
    fields: dict[str, object] = dict(id=f"osm:{way}", status=Status.OPERATING, operator=None,
                                     provenance=(prov,), name=name, technology=tech, capacity_mw=mw,
                                     commissioning_year=year, country="HR",
                                     location=(16.7, 43.44))  # fmt: skip
    fields.update(extra)
    return PowerPlant.model_validate(fields)


def unit(location: str, mw: float, start: int, end: int, tech: Technology = Technology.COAL) -> RetiredUnit:
    return RetiredUnit(location_id=location, country="HR", plant_name="TE Plomin", technology=tech,
                       capacity_mw=mw, start_year=start, retired_year=end, latitude=45.14,
                       longitude=14.17)  # fmt: skip


def test_parse_retired_keeps_a_complete_retired_unit() -> None:
    parsed = parse_retired(ROW)
    assert parsed is not None
    assert (parsed.technology, parsed.capacity_mw, parsed.start_year, parsed.retired_year) == (
        Technology.OIL,
        320.0,
        1978,
        2013,
    )


def test_parse_retired_leaves_out_what_cannot_be_placed_in_time() -> None:
    assert parse_retired({**ROW, "retired_year": ""}) is None
    assert parse_retired({**ROW, "start_year": None}) is None
    assert parse_retired({**ROW, "retired_year": "1970"}) is None  # retired before it started
    assert parse_retired({**ROW, "capacity_mw": "0"}) is None
    assert parse_retired({**ROW, "status": "operating"}) is None
    assert parse_retired({**ROW, "country": "Germany"}) is None
    assert parse_retired({**ROW, "status": "retired - inferred 4 y"}) is not None


def test_load_counts_retired_units_but_never_maps_them() -> None:
    loaded = load([ROW, {**ROW, "unit_id": "G2", "status": "mothballed"}])
    assert loaded.plants == []
    assert len(loaded.retired) == 1
    assert loaded.stats["retired_units"] == 1
    assert loaded.stats["excluded_status"] == 2


def test_timeline_counts_capacity_in_the_years_it_ran() -> None:
    plants = [
        plant("zakucac", Technology.HYDRO, 576, 1961),
        plant("bez-godine", Technology.WIND, 30, None),
        plant("bez-snage", Technology.SOLAR, None, 2020),
        plant("gradi-se", Technology.SOLAR, 50, 2025, status=Status.CONSTRUCTION),
        plant("izvan", Technology.HYDRO, 100, 1990, country="AT"),
    ]
    data = build_timeline(plants, [unit("L100000000001", 125, 1970, 2017)], ["HR", "SI"], NOW)
    assert (data["firstYear"], data["lastYear"]) == (1961, 2026)
    hydro = data["series"]["HR"]["hydro"]
    coal = data["series"]["HR"]["coal"]
    assert len(hydro) == 2026 - 1961 + 1
    assert hydro[0] == 576 and hydro[-1] == 576
    assert coal[1969 - 1961] == 0 and coal[1970 - 1961] == 125 and coal[2016 - 1961] == 125
    assert coal[2017 - 1961] == 0  # gone in its retirement year
    assert "solar" not in data["series"]["HR"]  # under construction, or no capacity
    assert "AT" not in data["series"]  # outside the scope asked for
    assert data["undated"]["HR"] == {"plants": 2, "mw": 30.0}
    assert data["undated"]["SI"] == {"plants": 0, "mw": 0.0}
    assert [r["name"] for r in data["retired"]] == ["TE Plomin"]


def test_retired_sites_are_one_outline_each() -> None:
    sites = retired_plants(
        [unit("L1", 125, 1970, 2017), unit("L1", 30, 1972, 2010, Technology.GAS), unit("L2", 210, 1976, 2019)]
    )
    assert [s["id"] for s in sites] == ["retired:L1", "retired:L2"]
    first = sites[0]
    assert (first["capacityMw"], first["commissioningYear"], first["retiredYear"], first["technology"]) == (
        155.0,
        1970,
        2017,
        "coal",
    )


def test_timeline_without_dated_plants_is_one_year_long() -> None:
    data = build_timeline([plant("x", Technology.WIND, 10, None)], [], ["HR"], NOW)
    assert (data["firstYear"], data["lastYear"]) == (2026, 2026)
    assert data["series"] == {}
    assert data["retired"] == []
