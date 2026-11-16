"""Orchestrate one OSM build: download, prefilter, extract, validate, publish."""

from __future__ import annotations

import json
import logging
import shutil
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final, Literal

import httpx

from energymap import config, datacenters, diff
from energymap.baseline import fetch_published, iter_layer, iter_local_layer
from energymap.cities import load as cities_load
from energymap.conflate import Overrides, conflate
from energymap.files import read_json, sha256_file, write_json_atomic, write_text_atomic
from energymap.gem import normalize as gem_normalize
from energymap.gem import read as gem_read
from energymap.geo.countries import CountryIndex, codes_in
from energymap.marine import emodnet
from energymap.osm.download import (
    DownloadError,
    SourceState,
    download_region,
    load_state,
    make_client,
    pbf_path,
    resolve_urls,
)
from energymap.osm.extract import ExtractResult, extract
from energymap.osm.prefilter import filtered_path, prefilter
from energymap.products import city_register, search_index, statistics
from energymap.tiles import LAYERS
from energymap.timeline import TIMELINE_FILE, build_timeline
from energymap.validate import BuildValidationError, check_counts

log = logging.getLogger(__name__)

LATEST_POINTER = "LATEST"


def ensure_borders(paths: config.Paths, client: httpx.Client) -> Path:
    target = paths.reference / "ne_10m_admin_0_countries.geojson"
    if target.exists():
        return target
    response = client.get(config.NATURAL_EARTH_URL)
    response.raise_for_status()
    write_text_atomic(target, response.text)
    log.info("downloaded country borders", extra={"bytes": len(response.content)})
    return target


def load_index(borders: Path, scope: frozenset[str]) -> CountryIndex:
    index = CountryIndex.from_geojson(
        borders,
        bbox=config.REGION_BBOX,
        min_segment_m=config.INTERCONNECTOR_MIN_SEGMENT_M,
        coastal_tolerance_deg=config.COASTAL_TOLERANCE_DEG,
    )
    missing = scope - codes_in(index, scope)
    if missing:
        raise BuildValidationError([f"borders file has no polygon for {', '.join(sorted(missing))}"])
    return index


def download(paths: config.Paths, countries: Sequence[config.Country]) -> list[SourceState]:
    paths.ensure()
    with make_client() as client:
        urls = resolve_urls(client, config.GEOFABRIK_INDEX_URL, [c.geofabrik_id for c in countries])
        ensure_borders(paths, client)
        return [download_region(client, c.geofabrik_id, urls[c.geofabrik_id], paths.raw) for c in countries]


LOCAL_BASELINE: Final[Literal["local"]] = "local"


def build(
    paths: config.Paths,
    countries: Sequence[config.Country],
    *,
    allow_drop: bool = False,
    now: datetime | None = None,
    scope: Iterable[str] | None = None,
    baseline: Mapping[str, int] | Literal["local"] | None = LOCAL_BASELINE,
    gem: Path | None = None,
    overrides: Path | None = None,
    marine: Path | None = None,
    datacenter_list: Path | None = None,
    cities: Path | None = None,
) -> Path:
    """Build from already downloaded sources and publish atomically. Returns the build directory.

    ``scope`` defaults to the countries whose extracts are read; it can be wider when a smaller set of
    extracts is used (for example in development).

    ``baseline`` is what the record counts are compared with: the last local build (default), explicit
    counts (the published build, see ``published_counts``), or None when nothing was published yet."""
    paths.ensure()
    borders = paths.reference / "ne_10m_admin_0_countries.geojson"
    if not borders.exists():
        raise DownloadError(f"Country borders missing at {borders}; run the download step first")
    region = frozenset(scope) if scope is not None else frozenset(c.code for c in countries)
    index = load_index(borders, region)

    states: list[SourceState] = []
    merged = ExtractResult()
    for country in countries:
        state = load_state(paths.raw, country.geofabrik_id)
        if state is None:
            raise DownloadError(f"No downloaded extract for {country.code}; run the download step first")
        for spec in config.SOURCE_FILTERS:
            filtered = prefilter(
                pbf_path(paths.raw, country.geofabrik_id),
                filtered_path(paths.filtered, country.geofabrik_id, state.md5, spec),
                spec,
            )
            merged.merge(extract(filtered, index, region, state.data_timestamp))
        states.append(state)

    built_at = now or datetime.now(UTC)
    gem_info: dict[str, Any] | None = None
    extra: dict[str, Any] = {}
    retired: list[gem_normalize.RetiredUnit] = []
    if gem is not None:
        gem_info, extra["conflation.json"], retired = apply_gem(
            merged, gem, overrides, index, region, built_at
        )
    marine_info = apply_marine(merged, marine, index, region, built_at) if marine is not None else None
    # The hand-kept list is read even when the file is absent, so an empty list is a normal build.
    centre_stats = datacenters.apply_list(
        merged.datacenters,
        datacenters.load_list(datacenter_list),
        index=index,
        scope=region,
        retrieved_at=built_at,
    )
    merged.stats.update({f"datacenter_{key}": value for key, value in centre_stats.items()})
    centre_info = datacenters.summary(centre_stats, merged.datacenters)
    cities_info = apply_cities(merged, cities, index, region, built_at) if cities is not None else None

    counts = merged.counts()
    previous = previous_counts(paths.out) if baseline == LOCAL_BASELINE else baseline
    problems = check_counts(counts, previous, max_drop=config.MAX_COUNT_DROP, allow_drop=allow_drop)
    if problems:
        raise BuildValidationError(problems)
    return publish(
        paths.out,
        merged,
        states,
        index,
        region,
        built_at,
        gem=gem_info,
        marine=marine_info,
        datacenters=centre_info,
        cities=cities_info,
        extra=extra,
        timeline=build_timeline(merged.plants.values(), retired, region, built_at),
    )


def apply_cities(
    merged: ExtractResult,
    directory: Path,
    index: CountryIndex,
    region: frozenset[str],
    retrieved_at: datetime,
) -> dict[str, Any]:
    """Add the Covenant of Mayors city inventories to ``merged``. Returns manifest info."""
    if not directory.is_dir():
        raise DownloadError(f"Cities directory not found: {directory}; run `energymap cities download` first")
    loaded = cities_load.load(directory, region, retrieved_at, index.is_in_or_near)
    if not loaded.cities:
        countries = ", ".join(sorted(region))
        raise BuildValidationError([f"{directory} yields no city with an inventory in {countries}"])
    merged.cities.update({city.id: city for city in loaded.cities})
    merged.stats.update({f"cities_{key}": value for key, value in loaded.stats.items()})
    info = {
        "release": loaded.release,
        "fetchedAt": loaded.fetched_at,
        "cities": len(loaded.cities),
        "byCountry": dict(sorted(Counter(city.country for city in loaded.cities).items())),
    }
    log.info("merged Covenant of Mayors cities", extra={"cities": info})
    return info


def apply_marine(
    merged: ExtractResult,
    directory: Path,
    index: CountryIndex,
    region: frozenset[str],
    retrieved_at: datetime,
) -> dict[str, Any]:
    """Add EMODnet offshore pipelines and wind farms to ``merged``. Returns manifest info."""
    loaded = emodnet.load(directory, index, region, retrieved_at)
    merged.pipelines.update(loaded.pipelines)
    stats: Counter[str] = Counter(loaded.stats)
    emodnet.merge_windfarms(merged.plants, loaded.windfarms, stats)
    merged.stats.update({f"emodnet_{key}": value for key, value in stats.items()})
    meta_file = directory / "emodnet.json"
    meta = read_json(meta_file) if meta_file.exists() else {}
    info = {
        "fetchedAt": meta.get("fetchedAt"),
        "pipelines": len(loaded.pipelines),
        "windfarms": stats["windfarms_added"],
    }
    log.info("merged EMODnet data", extra={"marine": info})
    return info


def apply_gem(
    merged: ExtractResult,
    path: Path,
    overrides: Path | None,
    index: CountryIndex,
    region: frozenset[str],
    retrieved_at: datetime,
) -> tuple[dict[str, Any], dict[str, Any], list[gem_normalize.RetiredUnit]]:
    """Merge GEM plants into ``merged`` in place. Returns manifest info, the conflation report and the
    retired units (not merged: they only feed the time machine, see ``timeline.py``)."""
    if not path.is_file():
        raise DownloadError(f"GEM file not found: {path}")
    loaded = gem_normalize.load(gem_read.read_units(path))
    if loaded.stats["units_in_scope"] == 0:
        raise BuildValidationError([f"{path.name} has no usable units for {', '.join(sorted(region))}"])
    result = conflate(
        merged.plants,
        loaded.plants,
        index=index,
        scope=region,
        retrieved_at=retrieved_at,
        overrides=Overrides.load(overrides),
    )
    names: dict[str, str | None] = {plant.id: plant.name for plant in merged.plants.values()}
    names.update({plant.key: plant.name for plant in loaded.plants})
    merged.plants = result.plants
    merged.stats.update({f"gem_{key}": value for key, value in loaded.stats.items()})
    merged.stats.update({f"conflation_{key}": value for key, value in result.stats.items()})
    info = {
        "file": path.name,
        "sha256": sha256_file(path),
        "bytes": path.stat().st_size,
        "plants": len(loaded.plants),
        "nonCommercialPlants": sum(1 for plant in loaded.plants if plant.non_commercial),
    }
    log.info("merged GEM plants", extra={"gem": info, "conflation": dict(result.stats)})
    return info, result.report(names), loaded.retired


ATTRIBUTIONS: dict[str, str] = {
    "openstreetmap": "© OpenStreetMap contributors (ODbL)",
    "gem": "Global Energy Monitor, Global Integrated Power Tracker (CC BY 4.0)",
    "transitionzero": "TransitionZero, Solar Asset Mapper (CC BY-NC 4.0)",
    "emodnet": "EMODnet Human Activities",
    "manual": "Data centres: hand-kept list (each record names its source)",
    "com": "Cities: Covenant of Mayors / JRC (CC BY 4.0)",
    "naturalearth": "Borders: Natural Earth",
}


def attribution_sources(
    gem: Mapping[str, Any] | None,
    marine: Mapping[str, Any] | None = None,
    datacenters: Mapping[str, Any] | None = None,
    cities: Mapping[str, Any] | None = None,
) -> list[str]:
    """Keys of ``ATTRIBUTIONS`` that apply to a build; the website shows them in its own language."""
    sources = ["openstreetmap"]
    if gem is not None:
        sources.append("gem")
        if gem.get("nonCommercialPlants"):
            sources.append("transitionzero")
    if marine is not None:
        sources.append("emodnet")
    # only when the build actually used the hand-kept list: an empty list is not a source
    if datacenters and (datacenters.get("fromManualList") or datacenters.get("completedFromManualList")):
        sources.append("manual")
    if cities is not None:
        sources.append("com")
    sources.append("naturalearth")
    return sources


def published_counts(base_url: str) -> Mapping[str, int] | None:
    """Record counts of the published build; None (logged) when nothing has been published yet."""
    with make_client() as client:
        published = fetch_published(client, base_url)
    if published is None:
        log.warning(
            "no published build found; this is treated as the first publication", extra={"url": base_url}
        )
        return None
    log.info(
        "baseline from published build", extra={"build": published.build_id, "counts": dict(published.counts)}
    )
    return published.counts


def write_diff(build_dir: Path, base_url: str) -> diff.BuildDiff:
    """Compare ``build_dir`` with the published build and store ``diff.json`` next to its layers."""
    with make_client() as client:
        published = fetch_published(client, base_url)
        layers: dict[str, diff.LayerDiff] = {}
        for layer in LAYERS:
            if not (build_dir / f"{layer}.ndjson").exists():
                continue  # an optional layer this build does not have
            current = diff.index(iter_local_layer(build_dir, layer))
            known = published is not None and layer in published.downloads
            previous = diff.index(iter_layer(client, published, layer)) if known and published else {}
            layers[layer] = diff.compare(previous, current)
    result = diff.BuildDiff(build_dir.name, published.build_id if published else None, layers)
    write_json_atomic(build_dir / diff.DIFF_FILE, diff.to_json(result))
    return result


def resolve_build(out_dir: Path, build_id: str) -> Path:
    """``latest`` follows the LATEST pointer; anything else must be an existing build id."""
    if build_id == "latest":
        pointer = out_dir / LATEST_POINTER
        if not pointer.exists():
            raise BuildValidationError([f"no published build in {out_dir}; run `energymap osm build` first"])
        build_id = pointer.read_text(encoding="utf-8").strip()
    candidate = out_dir / "builds" / build_id
    if build_id.startswith(".") or "/" in build_id or not candidate.is_dir():
        raise BuildValidationError([f"build '{build_id}' not found in {out_dir / 'builds'}"])
    return candidate


def previous_counts(out_dir: Path) -> dict[str, int] | None:
    pointer = out_dir / LATEST_POINTER
    if not pointer.exists():
        return None
    manifest = out_dir / "builds" / pointer.read_text(encoding="utf-8").strip() / "manifest.json"
    counts: dict[str, int] = read_json(manifest)["counts"]
    return counts


def _write_layer(path: Path, features: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for feature in features:
            handle.write(json.dumps(feature, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            handle.write("\n")


def publish(
    out_dir: Path,
    result: ExtractResult,
    states: list[SourceState],
    index: CountryIndex,
    scope: frozenset[str],
    now: datetime,
    *,
    gem: Mapping[str, Any] | None = None,
    marine: Mapping[str, Any] | None = None,
    datacenters: Mapping[str, Any] | None = None,
    cities: Mapping[str, Any] | None = None,
    extra: Mapping[str, Any] | None = None,
    timeline: Mapping[str, Any] | None = None,
) -> Path:
    build_id = now.strftime("%Y%m%dT%H%M%SZ")
    builds = out_dir / "builds"
    final = builds / build_id
    if final.exists():
        raise BuildValidationError([f"build {build_id} already exists"])
    staging = builds / f".staging-{build_id}"
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    try:
        # Records are sorted by id so consecutive builds produce readable diffs.
        _write_layer(staging / "lines.ndjson", [r.to_feature() for _, r in sorted(result.lines.items())])
        _write_layer(
            staging / "substations.ndjson", [r.to_feature() for _, r in sorted(result.substations.items())]
        )
        _write_layer(staging / "plants.ndjson", [r.to_feature() for _, r in sorted(result.plants.items())])
        _write_layer(
            staging / "pipelines.ndjson", [r.to_feature() for _, r in sorted(result.pipelines.items())]
        )
        _write_layer(
            staging / "distribution_lines.ndjson",
            [r.to_feature() for _, r in sorted(result.distribution_lines.items())],
        )
        _write_layer(
            staging / "distribution_substations.ndjson",
            [r.to_feature() for _, r in sorted(result.distribution_substations.items())],
        )
        _write_layer(
            staging / "datacenters.ndjson",
            [r.to_feature() for _, r in sorted(result.datacenters.items())],
        )
        _write_layer(
            staging / "chargers.ndjson", [r.to_feature() for _, r in sorted(result.chargers.items())]
        )
        _write_layer(
            staging / "extraction.ndjson", [r.to_feature() for _, r in sorted(result.extraction.items())]
        )
        if result.cities:
            city_records = [r for _, r in sorted(result.cities.items())]
            _write_layer(staging / "cities.ndjson", [r.to_feature() for r in city_records])
            write_json_atomic(staging / "cities.json", city_register(city_records), compact=True)
        _write_layer(staging / "countries.ndjson", index.boundary_features(config.REGION_BBOX, scope))
        plants = [r for _, r in sorted(result.plants.items())]
        substations = [r for _, r in sorted(result.substations.items())]
        lines = [r for _, r in sorted(result.lines.items())]
        centres = [r for _, r in sorted(result.datacenters.items())]
        cities_sorted = [r for _, r in sorted(result.cities.items())]
        sites = [r for _, r in sorted(result.extraction.items())]
        write_json_atomic(
            staging / "search.json",
            search_index(plants, substations, centres, cities_sorted, sites),
            compact=True,
        )
        write_json_atomic(
            staging / "stats.json", statistics(plants, substations, lines, index, scope, centres)
        )
        for name, content in (extra or {}).items():
            write_json_atomic(staging / name, content)
        if timeline is not None:
            write_json_atomic(staging / TIMELINE_FILE, timeline, compact=True)
        sources = attribution_sources(gem, marine, datacenters, cities)
        parts = [ATTRIBUTIONS[key] for key in sources]
        write_json_atomic(
            staging / "manifest.json",
            {
                "buildId": build_id,
                "createdAt": now.isoformat(),
                "counts": result.counts(),
                "interconnectors": sum(1 for r in result.lines.values() if r.is_interconnector),
                "stats": dict(sorted(result.stats.items())),
                "sources": [asdict(s) for s in states],
                "gem": gem,
                "marine": marine,
                "datacenters": datacenters,
                "cities": cities,
                "scope": sorted(scope),
                "license": "ODbL-1.0",
                # per-record licences are in each record's provenance
                "licenseNotes": (
                    ["Some plant records carry CC BY-NC 4.0 data (non-commercial use only)."]
                    if gem and gem.get("nonCommercialPlants")
                    else []
                ),
                "attribution": "; ".join(parts),
                "attributionParts": parts,
                "attributionSources": sources,
            },
        )
        staging.replace(final)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    write_text_atomic(out_dir / LATEST_POINTER, build_id + "\n")
    log.info("published build", extra={"build": build_id, "counts": result.counts()})
    return final
