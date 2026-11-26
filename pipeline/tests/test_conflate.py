from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from energymap.conflate import (
    Overrides,
    OverridesError,
    conflate,
    evaluate,
    name_similarity,
    normalize_name,
)
from energymap.gem.normalize import GemPlant
from energymap.geo.countries import CountryIndex
from energymap.schema import PowerPlant, Provenance, Status, Technology

NOW = datetime(2026, 9, 16, tzinfo=UTC)
SCOPE = frozenset({"HR", "SI"})
# ~0.0127° of longitude ≈ 1 km at 45.5° N
KM = 1 / 78.0


def osm(id_: str, lon: float, lat: float, *, name: str | None = None, tech: Technology = Technology.HYDRO,
        status: Status = Status.OPERATING, mw: float | None = None) -> PowerPlant:  # fmt: skip
    prov = Provenance(source="openstreetmap", source_id=id_.removeprefix("osm:"), license="ODbL-1.0",
                      retrieved_at=NOW)  # fmt: skip
    return PowerPlant(id=id_, status=status, operator=None, provenance=(prov,), name=name, technology=tech,
                      capacity_mw=mw, commissioning_year=None, country="HR", location=(lon, lat))  # fmt: skip


def gem(n: int, lon: float, lat: float, *, name: str = "X", tech: Technology = Technology.HYDRO,
        status: Status = Status.OPERATING, mw: float | None = 100.0, approximate: bool = False,
        nc: bool = False) -> GemPlant:  # fmt: skip
    return GemPlant(f"L1{n:011d}", status, name, tech, mw, 1990, "Operator", "HR", lat, lon, approximate,
                    None, nc, 1)  # fmt: skip


def test_names_ignore_plant_type_words_and_diacritics() -> None:
    assert normalize_name("HE Đale d.o.o.") == ["dale"]
    assert normalize_name("Hidroelektrana Zakučac") == ["zakucac"]
    assert name_similarity("HE Zakučac", "Zakucac hydroelectric power plant") == 1.0
    assert name_similarity("TE Plomin 2", "Plomin") == 1.0
    assert name_similarity("HE Varaždin", "HE Čakovec") < 0.6
    assert name_similarity(None, "Plomin") == 0.0
    assert name_similarity("HE", "Plomin") == 0.0  # nothing distinctive left


def test_family_and_status_rules() -> None:
    plant = osm("osm:way/1", 16.0, 45.5, name="Primjer")
    assert evaluate(plant, gem(1, 16.0, 45.5, name="Primjer", tech=Technology.WIND)) is None
    assert evaluate(plant, gem(1, 16.0, 45.5, name="Primjer", tech=Technology.PUMPED_STORAGE)) is not None
    # an operating OSM plant never takes planned GEM data
    assert evaluate(plant, gem(1, 16.0, 45.5, name="Primjer", status=Status.PLANNED)) is None
    # a planned OSM plant may learn from GEM that it is now operating
    planned = osm("osm:way/2", 16.0, 45.5, name="Primjer", status=Status.PLANNED)
    candidate = evaluate(planned, gem(1, 16.0, 45.5, name="Primjer"))
    assert candidate is not None and candidate.accepted


@pytest.mark.parametrize(
    ("tech", "km", "approximate", "accepted"),
    [(Technology.HYDRO, 1.5, False, True), (Technology.HYDRO, 2.5, False, False),
     (Technology.HYDRO, 2.5, True, True), (Technology.WIND, 4.5, False, True),
     (Technology.SOLAR, 3.5, False, False)],
)  # fmt: skip
def test_radius_by_technology(tech: Technology, km: float, approximate: bool, accepted: bool) -> None:
    plant = osm("osm:way/1", 16.0, 45.5, name="Primjer", tech=tech)
    candidate = evaluate(
        plant, gem(1, 16.0 + km * KM, 45.5, name="Primjer", tech=tech, approximate=approximate)
    )
    assert candidate is not None
    assert candidate.accepted is accepted


def test_unnamed_osm_plant_on_the_same_spot_matches_within_family() -> None:
    plant = osm("osm:node/3", 16.0, 45.5, tech=Technology.COAL)
    candidate = evaluate(plant, gem(3, 16.0 + 0.2 * KM, 45.5, name="TE Lignit", tech=Technology.LIGNITE))
    assert candidate is not None and candidate.accepted
    far = evaluate(plant, gem(3, 16.0 + 0.8 * KM, 45.5, name="TE Lignit", tech=Technology.LIGNITE))
    assert far is None  # unnamed, not on the same spot: not even worth reviewing


def test_unknown_technology_needs_a_stronger_name() -> None:
    plant = osm("osm:node/4", 16.0, 45.5, name="Kogeneracija Sjever", tech=Technology.OTHER)
    weak = evaluate(plant, gem(4, 16.0, 45.5, name="Kogeneracija Jug", tech=Technology.GAS))
    assert weak is not None and not weak.accepted
    strong = evaluate(plant, gem(4, 16.0, 45.5, name="Kogeneracija Sjever", tech=Technology.GAS))
    assert strong is not None and strong.accepted


@pytest.fixture
def index(fixtures: Path) -> CountryIndex:
    return CountryIndex.from_geojson(fixtures / "countries.geojson", bbox=None, min_segment_m=500,
                                     coastal_tolerance_deg=0.25)  # fmt: skip


def test_one_to_one_best_first_and_leftovers(index: CountryIndex) -> None:
    plants = {"osm:way/1": osm("osm:way/1", 16.0, 45.5, name="HE Primjer", mw=10)}
    near = gem(1, 16.0 + 0.1 * KM, 45.5, name="Primjer", mw=20)
    also_near = gem(2, 16.0 + 1.0 * KM, 45.5, name="Primjer Donji", mw=30)
    result = conflate(plants, [also_near, near], index=index, scope=SCOPE, retrieved_at=NOW)

    merged = result.plants["osm:way/1"]
    assert merged.capacity_mw == 20  # GEM capacity wins
    assert merged.location == (16.0, 45.5)  # OSM position wins
    assert merged.name == "HE Primjer"
    assert [p.source for p in merged.provenance] == ["openstreetmap", "gem"]
    assert merged.provenance[1].source_id == "L100000000001:operating"
    assert "gem:L100000000002:operating" in result.plants  # the runner-up stays a separate plant
    assert result.stats["matched"] == 1 and result.stats["gem_only"] == 1


def test_near_misses_are_reported_not_merged(index: CountryIndex) -> None:
    plants = {"osm:way/1": osm("osm:way/1", 16.0, 45.5, name="HE Primjer")}
    miss = gem(1, 16.0 + 3.0 * KM, 45.5, name="Primjer")  # right name, beyond 2 km
    result = conflate(plants, [miss], index=index, scope=SCOPE, retrieved_at=NOW)
    assert result.plants["osm:way/1"].provenance[-1].source == "openstreetmap"
    assert [(c.osm_id, c.gem_key) for c in result.review] == [("osm:way/1", "L100000000001:operating")]
    report = result.report({"osm:way/1": "HE Primjer", "L100000000001:operating": "Primjer"})
    assert report["review"][0]["osmName"] == "HE Primjer"
    assert report["review"][0]["distanceKm"] == pytest.approx(3.0, abs=0.1)


def test_overrides_force_never_and_unused(index: CountryIndex) -> None:
    plants = {
        "osm:way/1": osm("osm:way/1", 16.0, 45.5, name="Nesto"),
        "osm:way/2": osm("osm:way/2", 16.2, 45.5, name="Primjer"),
    }
    far_but_forced = gem(1, 16.5, 45.8, name="Sasvim drugo ime")
    blocked = gem(2, 16.2, 45.5, name="Primjer")
    overrides = Overrides(
        force=frozenset({("osm:way/1", "L100000000001:operating"), ("osm:way/9", "L100000000009:operating")}),
        never=frozenset({("osm:way/2", "L100000000002:operating")}),
    )
    result = conflate(plants, [far_but_forced, blocked], index=index, scope=SCOPE, retrieved_at=NOW,
                      overrides=overrides)  # fmt: skip
    assert result.plants["osm:way/1"].provenance[-1].source == "gem"
    assert result.plants["osm:way/2"].provenance[-1].source == "openstreetmap"
    assert "gem:L100000000002:operating" in result.plants
    assert result.stats["forced"] == 1
    assert result.unused_overrides == [
        {"kind": "force", "osm": "osm:way/9", "gem": "L100000000009:operating"}
    ]


def test_gem_plants_outside_scope_are_dropped(index: CountryIndex) -> None:
    outside = gem(5, 18.0, 45.5, name="Slovak")  # SK in the fixture borders
    result = conflate({}, [outside], index=index, scope=SCOPE, retrieved_at=NOW)
    assert result.plants == {}
    assert result.stats["gem_outside_scope"] == 1


def test_non_commercial_licence_is_recorded(index: CountryIndex) -> None:
    result = conflate({}, [gem(6, 16.0, 45.5, name="Solar", tech=Technology.SOLAR, nc=True)],
                      index=index, scope=SCOPE, retrieved_at=NOW)  # fmt: skip
    [plant] = result.plants.values()
    assert plant.provenance[0].license == "CC-BY-NC-4.0"


def test_overrides_file(tmp_path: Path) -> None:
    path = tmp_path / "o.yaml"
    path.write_text("force:\n  - osm: osm:way/1\n    gem: L100000000001:operating\nnever: []\n")
    assert Overrides.load(path).force == frozenset({("osm:way/1", "L100000000001:operating")})
    assert Overrides.load(tmp_path / "missing.yaml") == Overrides()
    assert Overrides.load(None) == Overrides()
    cases = [
        ("- a\n", "mapping"),
        ("force: 3\n", "must be a list"),
        ("force:\n  - osm: 1\n", "string"),
        ("maybe: []\n", "unknown keys"),
        ("force: [\n", "not valid YAML"),
    ]
    for bad, message in cases:
        path.write_text(bad)
        with pytest.raises(OverridesError, match=message):
            Overrides.load(path)


def test_a_planned_part_of_a_running_plant_is_marked_as_its_expansion(index: CountryIndex) -> None:
    plants = {"osm:way/1": osm("osm:way/1", 16.0, 45.5, name="NE Primjer", tech=Technology.NUCLEAR, mw=700)}
    running = gem(7, 16.0, 45.5, name="Primjer", tech=Technology.NUCLEAR, mw=700)
    new_unit = gem(7, 16.0, 45.5, name="Primjer", tech=Technology.NUCLEAR, status=Status.PLANNED, mw=1100)
    # a location with nothing running yet: its parts are a new plant, not an expansion
    building = gem(8, 16.3, 45.5, name="Novi", status=Status.CONSTRUCTION)
    later = gem(8, 16.3, 45.5, name="Novi", status=Status.PLANNED)
    result = conflate(plants, [new_unit, running, building, later], index=index, scope=SCOPE,
                      retrieved_at=NOW)  # fmt: skip

    assert result.plants["osm:way/1"].expansion_of is None
    assert result.plants["gem:L100000000007:planned"].expansion_of == "osm:way/1"
    assert result.plants["gem:L100000000008:construction"].expansion_of is None
    assert result.plants["gem:L100000000008:planned"].expansion_of is None
    assert result.stats["expansions"] == 1
    feature = result.plants["gem:L100000000007:planned"].to_feature()
    assert feature["properties"]["expansionOf"] == "osm:way/1"


def test_the_search_index_tells_an_expansion_from_the_plant_it_extends(index: CountryIndex) -> None:
    from energymap.products import search_index

    plants = {"osm:way/1": osm("osm:way/1", 16.0, 45.5, name="NE Primjer", tech=Technology.NUCLEAR, mw=700)}
    running = gem(7, 16.0, 45.5, name="Primjer", tech=Technology.NUCLEAR, mw=700)
    new_unit = gem(7, 16.0, 45.5, name="Primjer", tech=Technology.NUCLEAR, status=Status.PLANNED, mw=1100)
    result = conflate(plants, [new_unit, running], index=index, scope=SCOPE, retrieved_at=NOW)

    details = {row[0]: row[6] for row in search_index(result.plants.values(), [])["rows"]}
    assert details == {"osm:way/1": "nuclear|700", "gem:L100000000007:planned": "nuclear|1100|planned"}


def test_a_plant_on_the_same_spot_with_the_same_capacity_matches_whatever_its_name() -> None:
    # Paks: GEM "Paks nuclear power plant" 2027 MW, OSM "Paksi Atomerőmű" 2000 MW, 0.35 km apart
    plant = osm("osm:way/5", 16.0, 45.5, name="Paksi Atomerőmű", tech=Technology.NUCLEAR, mw=2000)
    paks = gem(5, 16.0 + 0.35 * KM, 45.5, name="Paks", tech=Technology.NUCLEAR, mw=2027)
    candidate = evaluate(plant, paks)
    assert candidate is not None and candidate.accepted and candidate.by_capacity
    # a name match always ranks above a match by capacity alone
    named = evaluate(osm("osm:way/6", 16.0, 45.5, name="Paks", tech=Technology.NUCLEAR, mw=500), paks)
    assert named is not None and named.accepted and not named.by_capacity
    assert named.score > candidate.score


@pytest.mark.parametrize(
    ("km", "osm_mw", "gem_mw", "status", "tech"),
    [(0.7, 2000, 2027, Status.OPERATING, Technology.NUCLEAR),  # beyond the same spot
     (0.1, 1500, 2027, Status.OPERATING, Technology.NUCLEAR),  # capacities differ by more than 10 %
     (0.1, None, 2027, Status.OPERATING, Technology.NUCLEAR),  # one capacity unknown
     (0.1, 2000, 2027, Status.PLANNED, Technology.NUCLEAR),  # statuses differ
     (0.1, 2000, 2027, Status.OPERATING, Technology.OTHER)],  # technology unknown
)  # fmt: skip
def test_capacity_alone_needs_the_same_spot_capacity_status_and_family(
    km: float, osm_mw: float | None, gem_mw: float, status: Status, tech: Technology
) -> None:
    plant = osm("osm:way/5", 16.0, 45.5, name="Paksi Atomerőmű", tech=tech, mw=osm_mw, status=status)
    candidate = evaluate(plant, gem(5, 16.0 + km * KM, 45.5, name="Paks", tech=Technology.NUCLEAR, mw=gem_mw))
    assert candidate is None or not candidate.accepted


def test_a_match_by_capacity_merges_and_is_counted(index: CountryIndex) -> None:
    plants = {"osm:way/7": osm("osm:way/7", 16.0, 45.5, name="Hidroelektrana Piva", mw=342)}
    mratinje = gem(7, 16.0 + 0.07 * KM, 45.5, name="Mratinje hydroelectric plant", mw=342)
    result = conflate(plants, [mratinje], index=index, scope=SCOPE, retrieved_at=NOW)
    assert [p.source for p in result.plants["osm:way/7"].provenance] == ["openstreetmap", "gem"]
    assert "gem:L100000000007:operating" not in result.plants
    assert result.stats["matched_by_capacity"] == 1


def test_two_neighbouring_parks_of_the_same_size_are_left_for_review(index: CountryIndex) -> None:
    # two solar parks of ~5 MW side by side: capacity and position cannot tell which GEM record is which
    plants = {
        "osm:way/8": osm("osm:way/8", 16.0, 45.5, name="SE Brdo", tech=Technology.SOLAR, mw=5.0),
        "osm:way/9": osm("osm:way/9", 16.0 + 0.3 * KM, 45.5, name="SE Polje", tech=Technology.SOLAR, mw=5.2),
    }
    county = gem(8, 16.0 + 0.15 * KM, 45.5, name="Zadar County solar I", tech=Technology.SOLAR, mw=5.1)
    result = conflate(plants, [county], index=index, scope=SCOPE, retrieved_at=NOW)
    assert "gem:L100000000008:operating" in result.plants
    assert {c.osm_id for c in result.review} == {"osm:way/8", "osm:way/9"}
    assert result.stats["matched_by_capacity"] == 0

    # the same from the other side: one OSM park, two GEM records that both fit
    one = {"osm:way/8": plants["osm:way/8"]}
    other = gem(9, 16.0 - 0.15 * KM, 45.5, name="Zadar County solar II", tech=Technology.SOLAR, mw=4.9)
    result = conflate(one, [county, other], index=index, scope=SCOPE, retrieved_at=NOW)
    assert result.plants["osm:way/8"].provenance[-1].source == "openstreetmap"
    assert result.stats["matched_by_capacity"] == 0


def test_a_name_match_takes_its_plant_before_a_match_by_capacity_can(index: CountryIndex) -> None:
    # the OSM plant goes to the GEM record that names it; the other, matching only by capacity, stays apart
    plants = {"osm:way/10": osm("osm:way/10", 16.0, 45.5, name="HE Primjer", mw=100)}
    named = gem(10, 16.0 + 0.4 * KM, 45.5, name="Primjer", mw=100)
    sized = gem(11, 16.0 + 0.05 * KM, 45.5, name="Nesto drugo", mw=100)
    result = conflate(plants, [sized, named], index=index, scope=SCOPE, retrieved_at=NOW)
    assert result.plants["osm:way/10"].provenance[1].source_id == "L100000000010:operating"
    assert "gem:L100000000011:operating" in result.plants
