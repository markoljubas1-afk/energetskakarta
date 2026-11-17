"""Merge Global Energy Monitor plants into OpenStreetMap plants.

Rules (tasks/todo.md, Faza 2):
* a pair is a candidate when the technology families agree, the plants are close enough and their
  statuses are compatible;
* a candidate is accepted when the names agree, or when the points are practically identical and one
  side has no name to compare;
* accepted pairs are matched one-to-one, best score first;
* OSM keeps the id and position, GEM provides capacity, status, year and operator;
* near misses are reported for review and never merged automatically;
* manual overrides (force / never) are applied first and survive every update.
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from energymap.gem.normalize import GemPlant
from energymap.geo.countries import CountryIndex, haversine_m
from energymap.schema import PowerPlant, Provenance, Status, Technology

GEM_ID_PREFIX = "gem:"

FAMILIES: dict[Technology, str] = {
    Technology.HYDRO: "hydro",
    Technology.PUMPED_STORAGE: "hydro",
    Technology.COAL: "coal",
    Technology.LIGNITE: "coal",
    Technology.GAS: "fossil",
    Technology.OIL: "fossil",
}

# Search radius in km. Wind and solar farms are large areas: the OSM point on their surface can be far
# from GEM's reference point. Approximate GEM locations get twice the radius.
RADIUS_KM: dict[Technology, float] = {Technology.WIND: 5.0, Technology.SOLAR: 3.0}
DEFAULT_RADIUS_KM = 2.0
SAME_SPOT_KM = 0.5
NAME_MATCH = 0.6
NAME_MATCH_UNKNOWN_TECH = 0.75
REVIEW_NAME_MIN = 0.3

# Words that describe the kind of plant rather than name it, grouped by language.
_STOPWORD_GROUPS = (
    "he rhe hidroelektrana te termoelektrana to toplana te-to elektrana ve vjetroelektrana se suncana fne",
    "hidroelektrarna termoelektrarna elektrarna nek ne nuklearna vetrna solarna fotonaponska",
    "power plant station stations wind farm park solar pv photovoltaic hydro hydroelectric thermal",
    "nuclear gas coal pumped storage project phase unit hpp tpp npp chp ccgt",
    "centrale elettrica idroelettrica termoelettrica impianto parco eolico fotovoltaico",
    "kraftwerk windpark solarpark wasserkraftwerk pumpspeicherkraftwerk",
    "eromu naperomu szelpark vizeromu hoeromu",
    "i ii iii iv v doo d.o.o. spa s.p.a. srl ag gmbh kft zrt nyrt jsc ad",
)
STOPWORDS = frozenset(word for group in _STOPWORD_GROUPS for word in group.split(" "))


def normalize_name(name: str | None) -> list[str]:
    if not name:
        return []
    text = unicodedata.normalize("NFD", name.replace("đ", "d").replace("Đ", "D"))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).casefold()
    tokens = re.findall(r"[a-z0-9]+(?:[.-][a-z0-9]+)*\.?", text)
    return [t for t in tokens if t not in STOPWORDS and t.rstrip(".") not in STOPWORDS]


def name_similarity(a: str | None, b: str | None) -> float:
    """0..1; the better of token overlap and character similarity of the distinctive words."""
    left, right = normalize_name(a), normalize_name(b)
    if not left or not right:
        return 0.0
    overlap = len(set(left) & set(right)) / min(len(set(left)), len(set(right)))
    ratio = difflib.SequenceMatcher(None, " ".join(sorted(left)), " ".join(sorted(right))).ratio()
    return round(max(overlap, ratio), 3)


def _family(tech: Technology) -> str:
    return FAMILIES.get(tech, tech.value)


def compatible_status(osm: Status, gem: Status) -> bool:
    """An operating OSM plant only takes operating GEM data; OSM planned data is weak and yields to GEM."""
    return gem is Status.OPERATING if osm is Status.OPERATING else True


def radius_km(gem: GemPlant) -> float:
    base = RADIUS_KM.get(gem.technology, DEFAULT_RADIUS_KM)
    return base * 2 if gem.approximate else base


@dataclass(frozen=True, slots=True)
class Candidate:
    osm_id: str
    gem_key: str
    distance_km: float
    name_similarity: float
    accepted: bool
    score: float


def evaluate(osm: PowerPlant, gem: GemPlant) -> Candidate | None:
    """None when the pair is not even worth reporting."""
    unknown_tech = Technology.OTHER in (osm.technology, gem.technology)
    if not unknown_tech and _family(osm.technology) != _family(gem.technology):
        return None
    if not compatible_status(osm.status, gem.status):
        return None
    distance = haversine_m(osm.location[0], osm.location[1], gem.longitude, gem.latitude) / 1000
    limit = radius_km(gem)
    if distance > 2 * limit:
        return None
    similarity = name_similarity(osm.name, gem.name)
    threshold = NAME_MATCH_UNKNOWN_TECH if unknown_tech else NAME_MATCH
    same_spot_unnamed = distance <= SAME_SPOT_KM and not unknown_tech and not normalize_name(osm.name)
    accepted = distance <= limit and (similarity >= threshold or same_spot_unnamed)
    if not accepted and similarity < REVIEW_NAME_MIN and distance > SAME_SPOT_KM:
        return None
    score = similarity - 0.3 * min(distance / limit, 2.0) + (0.2 if osm.status == gem.status else 0.0)
    return Candidate(osm.id, gem.key, round(distance, 3), similarity, accepted, round(score, 3))


class OverridesError(ValueError):
    """The overrides file is not valid."""


@dataclass(frozen=True, slots=True)
class Overrides:
    force: frozenset[tuple[str, str]] = frozenset()
    never: frozenset[tuple[str, str]] = frozenset()

    @classmethod
    def load(cls, path: Path | None) -> Overrides:
        """YAML with ``force`` and ``never`` lists of ``{osm: <osm id>, gem: <GEM location>:<status>}``."""
        if path is None or not path.exists():
            return cls()
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as exc:
            raise OverridesError(f"{path}: not valid YAML: {exc}") from exc
        if not isinstance(data, dict):
            raise OverridesError(f"{path}: expected a mapping with 'force' and/or 'never'")

        def pairs(name: str) -> frozenset[tuple[str, str]]:
            items = data.get(name) or []
            if not isinstance(items, list):
                raise OverridesError(f"{path}: '{name}' must be a list")
            result = set()
            for item in items:
                if not (
                    isinstance(item, dict)
                    and isinstance(item.get("osm"), str)
                    and isinstance(item.get("gem"), str)
                ):
                    raise OverridesError(
                        f"{path}: every '{name}' entry needs string 'osm' and 'gem' keys: {item!r}"
                    )
                result.add((item["osm"], item["gem"]))
            return frozenset(result)

        unknown = set(data) - {"force", "never"}
        if unknown:
            raise OverridesError(f"{path}: unknown keys {sorted(unknown)}")
        return cls(force=pairs("force"), never=pairs("never"))


@dataclass(slots=True)
class ConflationResult:
    plants: dict[str, PowerPlant]
    matched: list[Candidate] = field(default_factory=list)
    review: list[Candidate] = field(default_factory=list)
    stats: Counter[str] = field(default_factory=Counter)
    unused_overrides: list[dict[str, str]] = field(default_factory=list)

    def report(self, names: Mapping[str, str | None]) -> dict[str, Any]:
        def row(c: Candidate) -> dict[str, Any]:
            return {
                "osm": c.osm_id,
                "osmName": names.get(c.osm_id),
                "gem": c.gem_key,
                "gemName": names.get(c.gem_key),
                "distanceKm": c.distance_km,
                "nameSimilarity": c.name_similarity,
            }

        return {
            "stats": dict(sorted(self.stats.items())),
            "review": [row(c) for c in self.review],
            "matched": [row(c) for c in self.matched],
            "unusedOverrides": self.unused_overrides,
        }


def _gem_provenance(gem: GemPlant, retrieved_at: datetime) -> Provenance:
    return Provenance(
        source="gem",
        source_id=gem.key,
        license="CC-BY-NC-4.0" if gem.non_commercial else "CC-BY-4.0",
        retrieved_at=retrieved_at,
        url=gem.wiki_url,
    )


def merged_plant(osm: PowerPlant, gem: GemPlant, retrieved_at: datetime) -> PowerPlant:
    # rebuilt through the constructor so the merged record is validated like any other
    return PowerPlant.model_validate(
        {
            **dict(osm),
            "status": gem.status,
            "name": osm.name or gem.name,
            "technology": osm.technology if gem.technology is Technology.OTHER else gem.technology,
            "capacity_mw": gem.capacity_mw if gem.capacity_mw is not None else osm.capacity_mw,
            "commissioning_year": gem.commissioning_year or osm.commissioning_year,
            "operator": gem.operator or osm.operator,
            "provenance": (*osm.provenance, _gem_provenance(gem, retrieved_at)),
        }
    )


def gem_only_plant(gem: GemPlant, country: str, retrieved_at: datetime) -> PowerPlant:
    return PowerPlant(
        id=f"{GEM_ID_PREFIX}{gem.key}",
        status=gem.status,
        operator=gem.operator,
        provenance=(_gem_provenance(gem, retrieved_at),),
        name=gem.name,
        technology=gem.technology,
        capacity_mw=gem.capacity_mw,
        commissioning_year=gem.commissioning_year,
        country=country,
        location=(round(gem.longitude, 6), round(gem.latitude, 6)),
    )


def conflate(
    osm_plants: Mapping[str, PowerPlant],
    gem_plants: Iterable[GemPlant],
    *,
    index: CountryIndex,
    scope: frozenset[str],
    retrieved_at: datetime,
    overrides: Overrides | None = None,
) -> ConflationResult:
    overrides = overrides or Overrides()
    gems = {gem.key: gem for gem in gem_plants}
    result = ConflationResult(plants=dict(osm_plants))
    used_osm: set[str] = set()
    used_gem: set[str] = set()
    #: GEM plant key -> id of the record it ended up in
    record_of: dict[str, str] = {}

    def accept(candidate: Candidate) -> None:
        osm, gem = osm_plants[candidate.osm_id], gems[candidate.gem_key]
        result.plants[osm.id] = merged_plant(osm, gem, retrieved_at)
        used_osm.add(osm.id)
        used_gem.add(gem.key)
        record_of[gem.key] = osm.id
        result.matched.append(candidate)

    # 1. manual decisions
    for osm_id, gem_key in sorted(overrides.force):
        if osm_id not in osm_plants or gem_key not in gems or osm_id in used_osm or gem_key in used_gem:
            result.unused_overrides.append({"kind": "force", "osm": osm_id, "gem": gem_key})
            continue
        osm, gem = osm_plants[osm_id], gems[gem_key]
        distance = haversine_m(osm.location[0], osm.location[1], gem.longitude, gem.latitude) / 1000
        accept(
            Candidate(osm_id, gem_key, round(distance, 3), name_similarity(osm.name, gem.name), True, 99.0)
        )
        result.stats["forced"] += 1
    for pair in sorted(overrides.never):
        if pair[0] not in osm_plants or pair[1] not in gems:
            result.unused_overrides.append({"kind": "never", "osm": pair[0], "gem": pair[1]})

    # 2. candidates from a coarse grid, so the comparison stays linear in practice. A cell must be at least
    # as wide as the farthest pair `evaluate` still reports; 1° of longitude is ~74 km at 48° N.
    reach_km = 2 * 2 * max((*RADIUS_KM.values(), DEFAULT_RADIUS_KM))
    cell = reach_km / 74.0
    grid: dict[tuple[int, int], list[PowerPlant]] = {}
    for plant in osm_plants.values():
        if plant.id not in used_osm:
            grid.setdefault((int(plant.location[0] // cell), int(plant.location[1] // cell)), []).append(
                plant
            )

    candidates: list[Candidate] = []
    for gem in gems.values():
        if gem.key in used_gem:
            continue
        gx, gy = int(gem.longitude // cell), int(gem.latitude // cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for osm in grid.get((gx + dx, gy + dy), []):
                    if (osm.id, gem.key) in overrides.never:
                        continue
                    candidate = evaluate(osm, gem)
                    if candidate is not None:
                        candidates.append(candidate)

    # 3. best first, one-to-one
    # accepted pairs first, so near misses are only reported for plants that stayed unmatched
    for candidate in sorted(candidates, key=lambda c: (not c.accepted, -c.score, c.osm_id, c.gem_key)):
        if candidate.osm_id in used_osm or candidate.gem_key in used_gem:
            continue
        if candidate.accepted:
            accept(candidate)
        else:
            result.review.append(candidate)

    # 4. GEM plants without an OSM counterpart become their own records
    for gem in gems.values():
        if gem.key in used_gem:
            continue
        country = index.country_of_point(gem.longitude, gem.latitude)
        if country is None or country not in scope:
            result.stats["gem_outside_scope"] += 1
            continue
        if country != gem.country:
            result.stats["gem_country_differs_from_position"] += 1
        result.plants[f"{GEM_ID_PREFIX}{gem.key}"] = gem_only_plant(gem, country, retrieved_at)
        record_of[gem.key] = f"{GEM_ID_PREFIX}{gem.key}"
        result.stats["gem_only"] += 1

    # 5. GEM splits a location by status, under one name: the planned or under-construction part of a
    # plant that already runs is marked as its expansion, so the two do not read as duplicates
    operating = {
        gem.location_id: record_of[gem.key]
        for gem in gems.values()
        if gem.status is Status.OPERATING and gem.key in record_of
    }
    for gem in gems.values():
        existing = operating.get(gem.location_id)
        record = record_of.get(gem.key)
        if gem.status is Status.OPERATING or existing is None or record is None or record == existing:
            continue
        result.plants[record] = result.plants[record].model_copy(update={"expansion_of": existing})
        result.stats["expansions"] += 1

    result.stats["matched"] = len(result.matched)
    result.stats["osm_only"] = len(osm_plants) - len(used_osm)
    result.stats["review"] = len(result.review)
    return result
