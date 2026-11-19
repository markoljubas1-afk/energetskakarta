"""Read a prefiltered extract and turn OSM objects into validated records.

One streaming pass with node locations and area assembly:
  * ways            → transmission lines and cables
  * nodes and areas → substations and power plants (areas become a point on their surface)
Closed ways tagged as plants or substations are handled through their assembled area, never as ways.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Literal

import osmium
import shapely
import shapely.errors
from pydantic import ValidationError
from shapely.geometry import LineString

from energymap import config
from energymap.geo.countries import CountryIndex, length_m
from energymap.osm import tags as t
from energymap.schema import (
    ChargingStation,
    CityEnergy,
    DataCenter,
    ExtractionKind,
    ExtractionSite,
    Pipeline,
    PowerPlant,
    Provenance,
    Status,
    Substation,
    TransmissionLine,
)

log = logging.getLogger(__name__)

OsmType = Literal["node", "way", "relation"]
_POINT_KINDS = frozenset({t.Kind.SUBSTATION, t.Kind.PLANT})
_LINE_KINDS = frozenset({t.Kind.LINE, t.Kind.MINOR_LINE, t.Kind.CABLE})


@dataclass(slots=True)
class ExtractResult:
    lines: dict[str, TransmissionLine] = field(default_factory=dict)
    substations: dict[str, Substation] = field(default_factory=dict)
    plants: dict[str, PowerPlant] = field(default_factory=dict)
    # on land from OSM (man_made=pipeline, gas and oil only); offshore ones are added from EMODnet
    # after the countries are merged (see marine/emodnet.py)
    pipelines: dict[str, Pipeline] = field(default_factory=dict)
    # Distribution holds the same record types as the transmission layers above; only the layer differs
    # (energymap.osm.tags.Role). It is published separately so the main map never carries its weight.
    distribution_lines: dict[str, TransmissionLine] = field(default_factory=dict)
    distribution_substations: dict[str, Substation] = field(default_factory=dict)
    # data centres: from OSM here, completed by hand from overrides/datacenters.yaml (see datacenters.py)
    datacenters: dict[str, DataCenter] = field(default_factory=dict)
    # charging stations come from their own prefilter pass (config.CHARGER_FILTER)
    chargers: dict[str, ChargingStation] = field(default_factory=dict)
    # oil and gas wells, platforms, mines: their own prefilter pass (config.EXTRACTION_FILTER)
    extraction: dict[str, ExtractionSite] = field(default_factory=dict)
    # cities' energy consumption comes from the Covenant of Mayors release, not from OSM (cities/)
    cities: dict[str, CityEnergy] = field(default_factory=dict)
    stats: Counter[str] = field(default_factory=Counter)

    def lines_for(self, role: t.Role) -> dict[str, TransmissionLine]:
        return self.lines if role is t.Role.TRANSMISSION else self.distribution_lines

    def substations_for(self, role: t.Role) -> dict[str, Substation]:
        return self.substations if role is t.Role.TRANSMISSION else self.distribution_substations

    def merge(self, other: ExtractResult) -> None:
        """Merge another country's result. Objects already present (border overlap) are kept once."""
        self.stats["duplicate_across_extracts"] += (
            _merge_into(self.lines, other.lines)
            + _merge_into(self.substations, other.substations)
            + _merge_into(self.plants, other.plants)
            + _merge_into(self.distribution_lines, other.distribution_lines)
            + _merge_into(self.distribution_substations, other.distribution_substations)
            + _merge_into(self.datacenters, other.datacenters)
            + _merge_into(self.chargers, other.chargers)
            + _merge_into(self.extraction, other.extraction)
            + _merge_into(self.pipelines, other.pipelines)
            + _merge_into(self.cities, other.cities)
        )
        self.stats.update(other.stats)

    def counts(self) -> dict[str, int]:
        counts = {"lines": len(self.lines), "substations": len(self.substations), "plants": len(self.plants)}
        # Optional layers are counted (and so guarded against drops) only once a build has them, so that
        # a build made before they existed stays comparable.
        optional = {
            "pipelines": len(self.pipelines),
            "distribution_lines": len(self.distribution_lines),
            "distribution_substations": len(self.distribution_substations),
            "datacenters": len(self.datacenters),
            "chargers": len(self.chargers),
            "extraction": len(self.extraction),
            "cities": len(self.cities),
        }
        counts.update({layer: count for layer, count in optional.items() if count})
        return counts


def _merge_into[R](target: dict[str, R], source: dict[str, R]) -> int:
    duplicates = 0
    for key, record in source.items():
        if key in target:
            duplicates += 1
        else:
            target[key] = record
    return duplicates


@dataclass(frozen=True, slots=True)
class _Context:
    index: CountryIndex
    scope: frozenset[str]
    retrieved_at: datetime


def asset_id(osm_type: OsmType, osm_id: int) -> str:
    return f"osm:{osm_type}/{osm_id}"


def _provenance(ctx: _Context, osm_type: OsmType, osm_id: int) -> tuple[Provenance, ...]:
    return (
        Provenance(
            source="openstreetmap",
            source_id=f"{osm_type}/{osm_id}",
            license="ODbL-1.0",
            retrieved_at=ctx.retrieved_at,
        ),
    )


def extract(path: Path, index: CountryIndex, scope: frozenset[str], retrieved_at: datetime) -> ExtractResult:
    ctx = _Context(index=index, scope=scope, retrieved_at=retrieved_at)
    result = ExtractResult()
    wkb = osmium.geom.WKBFactory()

    for obj in osmium.FileProcessor(str(path)).with_locations().with_areas():
        if not obj.tags:
            continue
        tag_map = dict(obj.tags)
        cycle = t.lifecycle(tag_map)
        # neither a data centre nor a charging station carries a power=* tag, so they are only looked
        # for once the power tags have said nothing
        centre = t.data_center(tag_map) if cycle is None else None
        charger = t.charging_station(tag_map) if cycle is None and centre is None else None
        site = t.extraction_site(tag_map) if cycle is None and centre is None and charger is None else None
        nothing_else = cycle is None and centre is None and charger is None and site is None
        pipe = t.pipeline(tag_map) if nothing_else else None
        try:
            if centre is not None:
                _add_data_center(result, ctx, centre, tag_map, obj, wkb)
            elif charger is not None:
                _add_charger(result, ctx, charger, tag_map, obj, wkb)
            elif site is not None:
                _add_extraction_site(result, ctx, site, tag_map, obj, wkb)
            elif pipe is not None:
                # a pipeline is a way; a closed one also arrives as an area, which is not a route
                if isinstance(obj, osmium.osm.Way):
                    coords = [(n.lon, n.lat) for n in obj.nodes]
                    _add_pipeline(result, ctx, pipe, tag_map, obj.id, coords)
            elif cycle is None:
                if nothing_else and tag_map.get("man_made") == "pipeline" and isinstance(obj, osmium.osm.Way):
                    # water, sewage, heat, or no substance at all: counted, so the build log says how many
                    result.stats["pipeline_not_gas_or_oil"] += 1
                continue
            elif isinstance(obj, osmium.osm.Area):
                if cycle.kind in _POINT_KINDS:
                    osm_type: OsmType = "way" if obj.from_way() else "relation"
                    point = shapely.from_wkb(wkb.create_multipolygon(obj)).point_on_surface()
                    _add_point(result, ctx, cycle, tag_map, osm_type, obj.orig_id(), point.x, point.y)
            elif isinstance(obj, osmium.osm.Node):
                if cycle.kind in _POINT_KINDS:
                    _add_point(
                        result, ctx, cycle, tag_map, "node", obj.id, obj.location.lon, obj.location.lat
                    )
            elif isinstance(obj, osmium.osm.Way):
                if cycle.kind in _LINE_KINDS:
                    coords = [(n.lon, n.lat) for n in obj.nodes]
                    _add_line(result, ctx, cycle, tag_map, obj.id, coords)
            elif (
                isinstance(obj, osmium.osm.Relation)
                and cycle.kind in _POINT_KINDS
                and tag_map.get("type") == "site"
            ):
                # Site relations need member geometry assembly (not in the MVP): counted, not guessed.
                result.stats[f"skipped_site_relation_{cycle.kind}"] += 1
        except osmium.InvalidLocationError:
            result.stats["invalid_location"] += 1
        except (RuntimeError, shapely.errors.GEOSException) as exc:
            result.stats["invalid_geometry"] += 1
            log.debug("skipping invalid geometry", extra={"osm_id": obj.id, "error": str(exc)})
        except ValidationError as exc:
            result.stats["failed_validation"] += 1
            log.warning("record failed validation", extra={"osm_id": obj.id, "errors": exc.errors()})

    log.info("extracted", extra={"file": path.name, "counts": result.counts(), "stats": dict(result.stats)})
    return result


def _point_of(obj: object, wkb: osmium.geom.WKBFactory) -> tuple[OsmType, int, float, float] | None:
    """Where an object sits, as a point: nodes directly, areas on their surface. Ways and relations that
    were not assembled into an area have no geometry here and are skipped by the caller."""
    if isinstance(obj, osmium.osm.Node):
        return "node", obj.id, obj.location.lon, obj.location.lat
    if isinstance(obj, osmium.osm.Area):
        point = shapely.from_wkb(wkb.create_multipolygon(obj)).point_on_surface()
        return ("way" if obj.from_way() else "relation"), obj.orig_id(), point.x, point.y
    return None


def _add_data_center(
    result: ExtractResult,
    ctx: _Context,
    status: Status,
    tags: t.Tags,
    obj: object,
    wkb: osmium.geom.WKBFactory,
) -> None:
    placed = _point_of(obj, wkb)
    if placed is None:
        result.stats["datacenter_without_geometry"] += 1
        return
    osm_type, osm_id, lon, lat = placed
    country = ctx.index.country_of_point(lon, lat)
    if country is None or country not in ctx.scope:
        result.stats["outside_scope"] += 1
        return
    key = asset_id(osm_type, osm_id)
    result.datacenters[key] = DataCenter(
        id=key,
        status=status,
        operator=t.text(tags, "operator"),
        provenance=_provenance(ctx, osm_type, osm_id),
        name=t.text(tags, "name", "name:en"),
        # OSM has no agreed key for a data centre's electrical load, so it stays unknown here
        power_mw=None,
        commissioning_year=t.parse_year(tags.get("start_date")),
        country=country,
        location=(round(lon, 6), round(lat, 6)),
    )


def _add_charger(
    result: ExtractResult,
    ctx: _Context,
    status: Status,
    tags: t.Tags,
    obj: object,
    wkb: osmium.geom.WKBFactory,
) -> None:
    placed = _point_of(obj, wkb)
    if placed is None:
        result.stats["charger_without_geometry"] += 1
        return
    osm_type, osm_id, lon, lat = placed
    country = ctx.index.country_of_point(lon, lat)
    if country is None or country not in ctx.scope:
        result.stats["outside_scope"] += 1
        return
    key = asset_id(osm_type, osm_id)
    result.chargers[key] = ChargingStation(
        id=key,
        status=status,
        # who runs it: the operator, else the charging network, else the brand on the pillar (the same
        # company more often than not); a station that names none stays without one
        operator=t.text(tags, "operator", "network", "brand"),
        provenance=_provenance(ctx, osm_type, osm_id),
        name=t.text(tags, "name", "name:en"),
        points=t.parse_points(tags.get("capacity")),
        max_kw=t.parse_output_kw(tags),
        country=country,
        location=(round(lon, 6), round(lat, 6)),
    )


def _add_extraction_site(
    result: ExtractResult,
    ctx: _Context,
    site: t.Extraction,
    tags: t.Tags,
    obj: object,
    wkb: osmium.geom.WKBFactory,
) -> None:
    placed = _point_of(obj, wkb)
    if placed is None:
        result.stats["extraction_without_geometry"] += 1
        return
    osm_type, osm_id, lon, lat = placed
    # an offshore platform stands outside every coastline: the nearest coast, within a wider tolerance
    tolerance = config.OFFSHORE_TOLERANCE_DEG if site.kind is ExtractionKind.PLATFORM else None
    country = ctx.index.country_of_point(lon, lat, tolerance_deg=tolerance)
    if country is None or country not in ctx.scope:
        result.stats["outside_scope"] += 1
        return
    key = asset_id(osm_type, osm_id)
    result.extraction[key] = ExtractionSite(
        id=key,
        status=site.status,
        operator=t.text(tags, "operator"),
        provenance=_provenance(ctx, osm_type, osm_id),
        name=t.text(tags, "name", "name:en"),
        kind=site.kind,
        substance=site.substance,
        country=country,
        location=(round(lon, 6), round(lat, 6)),
    )


def _add_pipeline(
    result: ExtractResult,
    ctx: _Context,
    pipe: t.PipelineTags,
    tags: t.Tags,
    osm_id: int,
    coords: list[tuple[float, float]],
) -> None:
    deduped = [c for i, c in enumerate(coords) if i == 0 or c != coords[i - 1]]
    if len(deduped) < 2:
        result.stats["degenerate_pipeline"] += 1
        return
    route = LineString(deduped)
    # a pipe that lies wholly at sea touches no country: those are EMODnet's, which has them as routes
    countries = ctx.index.countries_of_line(route)
    if not ctx.scope.intersection(countries):
        result.stats["outside_scope"] += 1
        return
    metres = length_m(route)
    if metres < config.PIPELINE_MIN_LENGTH_M:
        result.stats["pipeline_too_short"] += 1
        return
    kilometres = round(metres / 1000, 2)
    key = asset_id("way", osm_id)
    result.pipelines[key] = Pipeline(
        id=key,
        status=pipe.status,
        operator=t.text(tags, "operator"),
        provenance=_provenance(ctx, "way", osm_id),
        name=t.text(tags, "name", "name:en"),
        medium=pipe.medium,
        diameter_in=t.parse_diameter_in(tags.get("diameter")),
        length_km=kilometres if kilometres > 0 else None,
        commissioning_year=t.parse_year(tags.get("start_date")),
        countries=countries,
        parts=(tuple((round(lon, 6), round(lat, 6)) for lon, lat in deduped),),
    )


def _add_line(
    result: ExtractResult,
    ctx: _Context,
    cycle: t.Lifecycle,
    tags: t.Tags,
    osm_id: int,
    coords: list[tuple[float, float]],
) -> None:
    voltages = t.parse_voltages(tags.get("voltage"))
    role = t.line_role(cycle.kind, tags, voltages)
    if role is None:
        result.stats[f"excluded_{cycle.kind}"] += 1
        return
    deduped = [c for i, c in enumerate(coords) if i == 0 or c != coords[i - 1]]
    if len(deduped) < 2:
        result.stats["degenerate_line"] += 1
        return
    countries = ctx.index.countries_of_line(LineString(deduped))
    if not ctx.scope.intersection(countries):
        result.stats["outside_scope"] += 1
        return
    if tags.get("voltage") and not voltages:
        result.stats["unparsed_voltage"] += 1
    key = asset_id("way", osm_id)
    result.lines_for(role)[key] = TransmissionLine(
        id=key,
        status=cycle.status,
        operator=t.text(tags, "operator"),
        provenance=_provenance(ctx, "way", osm_id),
        kind="cable" if cycle.kind is t.Kind.CABLE else "line",
        voltages_kv=voltages,
        circuits=t.parse_circuits(tags.get("circuits")),
        is_hvdc=tags.get("frequency", "").strip() == "0",
        countries=countries,
        is_interconnector=len(countries) >= 2,
        geometry=tuple((round(lon, 6), round(lat, 6)) for lon, lat in deduped),
    )


def _add_point(
    result: ExtractResult,
    ctx: _Context,
    cycle: t.Lifecycle,
    tags: t.Tags,
    osm_type: OsmType,
    osm_id: int,
    lon: float,
    lat: float,
) -> None:
    country = ctx.index.country_of_point(lon, lat)
    if country is None or country not in ctx.scope:
        result.stats["outside_scope"] += 1
        return
    key = asset_id(osm_type, osm_id)
    location = (round(lon, 6), round(lat, 6))
    provenance = _provenance(ctx, osm_type, osm_id)
    name = t.text(tags, "name", "name:en")
    operator = t.text(tags, "operator")

    if cycle.kind is t.Kind.SUBSTATION:
        voltages = t.parse_voltages(tags.get("voltage"))
        result.substations_for(t.substation_role(tags, voltages))[key] = Substation(
            id=key,
            status=cycle.status,
            operator=operator,
            provenance=provenance,
            name=name,
            voltages_kv=voltages,
            country=country,
            location=location,
            wikidata=t.wikidata(tags),
            wikipedia=t.wikipedia(tags),
        )
        return

    raw_capacity = tags.get("plant:output:electricity")
    capacity = t.parse_capacity_mw(raw_capacity)
    if raw_capacity and capacity is None and raw_capacity.strip().lower() != "yes":
        result.stats["ambiguous_capacity"] += 1
    technology = t.technology(tags)
    if capacity is not None and not t.is_plausible_mw(capacity, technology):
        # the plant stays on the map without a figure: a wrong one would distort every total it enters
        log.warning("implausible capacity left out", extra={"id": key, "tagged": raw_capacity})
        result.stats["implausible_capacity"] += 1
        capacity = None
    result.plants[key] = PowerPlant(
        id=key,
        status=cycle.status,
        operator=operator,
        provenance=provenance,
        name=name,
        technology=technology,
        capacity_mw=capacity,
        commissioning_year=t.parse_year(tags.get("start_date")),
        country=country,
        location=location,
        wikidata=t.wikidata(tags),
        wikipedia=t.wikipedia(tags),
    )
