"""Command line entry point.

energymap osm download|build|run   OpenStreetMap grid data
energymap tiles build              PMTiles for a build
energymap publish r2               upload a build to Cloudflare R2
energymap eurostat fetch|publish-* official renewable shares (Eurostat)
energymap images update            photographs of plants from Wikimedia Commons
energymap solar fetch|publish-*    solar potential (Global Solar Atlas)
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections.abc import Callable, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from botocore.exceptions import BotoCoreError, ClientError
from pydantic import ValidationError

from energymap import build as pipeline
from energymap import config, diff, log, publish, sources, tiles
from energymap.baseline import BaselineError, fetch_published, iter_layer
from energymap.cities import read as cities_read
from energymap.conflate import OverridesError
from energymap.entsoe import fetch as energy_fetch
from energymap.entsoe import live as energy_live
from energymap.entsoe import release as energy_release
from energymap.entsoe.client import EntsoeClient, EntsoeError
from energymap.entsoe.energy import TIMEZONE as ENERGY_TZ
from energymap.entsoe.parse import EntsoeParseError
from energymap.entsoe.store import EnergyDataError
from energymap.eurostat import renewables as eurostat_renewables
from energymap.files import read_json, write_json_atomic
from energymap.gas import agsi, entsog
from energymap.gas import points as gas_points
from energymap.gem.read import GemFormatError
from energymap.geo.countries import CountryDataError
from energymap.geothermal import publish as geothermal_publish
from energymap.geothermal.sites import GeothermalDataError
from energymap.hep import capacity as hep_capacity
from energymap.images import wikimedia
from energymap.marine import emodnet
from energymap.osm.download import DownloadError, make_client
from energymap.solar import download as solar_download
from energymap.solar import potential as solar_potential
from energymap.validate import BuildValidationError

logger = logging.getLogger("energymap")

EXIT_OK = 0
EXIT_REJECTED = 1
EXIT_FAILED = 2


def _countries(value: str) -> list[config.Country]:
    codes = [c.strip().upper() for c in value.split(",") if c.strip()]
    unknown = [c for c in codes if c not in config.COUNTRY_BY_CODE]
    if unknown or not codes:
        allowed = ", ".join(config.COUNTRY_BY_CODE)
        raise argparse.ArgumentTypeError(f"unknown country code(s): {', '.join(unknown)}; allowed: {allowed}")
    return [config.COUNTRY_BY_CODE[c] for c in dict.fromkeys(codes)]


def _bounded_int(low: int, high: int) -> Callable[[str], int]:
    def parse(value: str) -> int:
        try:
            number = int(value)
        except ValueError:
            raise argparse.ArgumentTypeError(f"{value!r} is not a whole number") from None
        if not low <= number <= high:
            raise argparse.ArgumentTypeError(f"must be between {low} and {high}")
        return number

    return parse


# ENTSO-E's Transparency Platform starts in 2015
FIRST_ENERGY_YEAR = 2015


def _data_dir(p: argparse.ArgumentParser) -> None:
    p.add_argument("--data-dir", type=Path, default=Path("data"))


def _build_arg(p: argparse.ArgumentParser) -> None:
    p.add_argument("--build", default="latest", help="build id, default: latest")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="energymap", description="Regional energy map data pipeline")
    root.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    groups = root.add_subparsers(dest="group", required=True)

    osm = groups.add_parser("osm", help="OpenStreetMap grid data").add_subparsers(dest="step", required=True)
    for name, text in (
        ("download", "download or refresh extracts"),
        ("build", "build and publish locally from downloaded extracts"),
        ("run", "download, then build"),
    ):
        step = osm.add_parser(name, help=text)
        _data_dir(step)
        step.add_argument(
            "--countries",
            type=_countries,
            default=list(config.COUNTRIES),
            help="comma separated codes, default: all (" + ",".join(config.COUNTRY_BY_CODE) + ")",
        )
        if name != "download":
            step.add_argument(
                "--allow-drop", action="store_true", help="accept a large drop in record counts"
            )
            step.add_argument(
                "--baseline-url",
                help="public data URL; compare counts with the published build instead of the last local one",
            )
            step.add_argument(
                "--gem", type=Path, help="Global Energy Monitor power tracker export (.xlsx or .csv) to merge"
            )
            step.add_argument(
                "--overrides",
                type=Path,
                help="manual conflation decisions (YAML), e.g. ../overrides/conflation.yaml",
            )
            step.add_argument(
                "--marine",
                type=Path,
                help="EMODnet extract directory (energymap marine fetch / sources emodnet-fetch)",
            )
            step.add_argument(
                "--datacenters",
                type=Path,
                help="hand-kept data centre list (YAML), e.g. ../overrides/datacenters.yaml",
            )
            step.add_argument(
                "--cities",
                type=Path,
                help="Covenant of Mayors release directory (energymap cities download)",
            )

    tile_cmd = groups.add_parser("tiles", help="vector tiles").add_subparsers(dest="step", required=True)
    tile_build = tile_cmd.add_parser("build", help="create the PMTiles archives for a build")
    _data_dir(tile_build)
    _build_arg(tile_build)
    tile_build.add_argument("--tippecanoe", default="tippecanoe", help="path to the tippecanoe binary")

    report = groups.add_parser("diff", help="compare a build with the published one (writes diff.json)")
    _data_dir(report)
    _build_arg(report)
    report.add_argument("--baseline-url", required=True, help="public data URL of the published build")
    report.add_argument(
        "--summary", type=Path, help="append the Markdown report to this file (e.g. $GITHUB_STEP_SUMMARY)"
    )

    energy = groups.add_parser("energy", help="generation and load over time (ENTSO-E)").add_subparsers(
        dest="step", required=True
    )
    for name, text in (
        ("fetch", "fetch whole calendar years (backfill)"),
        ("refresh", "fetch the most recent days (the platform revises recent data)"),
    ):
        step = energy.add_parser(name, help=text)
        _data_dir(step)
        step.add_argument(
            "--countries",
            type=_countries,
            default=list(config.COUNTRIES),
            help="comma separated codes, default: all",
        )
        if name == "fetch":
            years = _bounded_int(FIRST_ENERGY_YEAR, 2100)
            step.add_argument("--from-year", type=years, required=True)
            step.add_argument("--to-year", type=years, help="default: the current year")
        else:
            step.add_argument(
                "--days", type=_bounded_int(1, 366), default=7, help="how many days back, default 7"
            )

    pull = energy.add_parser("pull", help="download the published yearly files (fresh machine)")
    _data_dir(pull)
    pull.add_argument("--baseline-url", required=True, help="public data URL")
    for name, text in (
        ("publish-r2", "publish to Cloudflare R2"),
        ("publish-dir", "publish to a local mirror"),
    ):
        step = energy.add_parser(name, help=text)
        _data_dir(step)
        step.add_argument(
            "--allow-drop", action="store_true", help="accept fewer covered days than published"
        )
        if name == "publish-dir":
            step.add_argument("--out", type=Path, required=True)

    live = groups.add_parser("live", help="cross-border flows and day-ahead prices (ENTSO-E)").add_subparsers(
        dest="step", required=True
    )
    for name, text in (
        ("fetch", "fetch the three-day window into data/live/current.json"),
        ("publish-r2", "publish data/live/current.json to Cloudflare R2"),
        ("publish-dir", "publish data/live/current.json to a local mirror"),
    ):
        step = live.add_parser(name, help=text)
        _data_dir(step)
        if name == "publish-dir":
            step.add_argument("--out", type=Path, required=True)

    gas = groups.add_parser("gas", help="daily gas production entering the grid (ENTSOG)").add_subparsers(
        dest="step", required=True
    )
    for name, text in (
        ("fetch", f"fetch the last {entsog.DEFAULT_DAYS} gas days into data/live/gas.json"),
        ("publish-r2", "publish data/live/gas.json to Cloudflare R2"),
        ("publish-dir", "publish data/live/gas.json to a local mirror"),
    ):
        step = gas.add_parser(name, help=text)
        _data_dir(step)
        if name == "fetch":
            step.add_argument(
                "--days",
                type=_bounded_int(1, entsog.MAX_DAYS),
                default=entsog.DEFAULT_DAYS,
                help="gas days to fetch",
            )
        if name == "publish-dir":
            step.add_argument("--out", type=Path, required=True)
    gas_survey = gas.add_parser(
        "points",
        help="list the region's gas points on ENTSOG with their latest flows (data/gas/points.json)",
    )
    _data_dir(gas_survey)
    gas_survey.add_argument("--days", type=_bounded_int(1, 14), default=gas_points.DEFAULT_DAYS)
    _data_dir(
        gas.add_parser(
            "storage-survey",
            help="list the region's gas storage on GIE AGSI with one day's figures",
        )
    )

    hep = groups.add_parser(
        "hep", help="capacity for new connections in the distribution grid (HEP ODS)"
    ).add_subparsers(dest="step", required=True)
    for name, text in (
        ("fetch", "fetch the current release from kapaciteti.hep.hr into data/hep"),
        ("publish-r2", "publish data/hep to Cloudflare R2 (snapshot, history, areas, current)"),
        ("publish-dir", "publish data/hep to a local mirror"),
    ):
        step = hep.add_parser(name, help=text)
        _data_dir(step)
        if name.startswith("publish"):
            step.add_argument(
                "--allow-drop",
                action="store_true",
                help=f"publish even with more than {hep_capacity.MAX_DROP * 100:.0f} %% fewer substations",
            )
        if name == "publish-dir":
            step.add_argument("--out", type=Path, required=True, help="target directory, e.g. ../web/.data")

    geo = groups.add_parser(
        "geothermal", help="geothermal sites (overrides/geothermal.yaml) and heat-flow potential"
    ).add_subparsers(dest="step", required=True)
    for name, text in (
        ("fetch", "check the sites, download the heat-flow database and write data/geothermal"),
        ("publish-r2", "publish data/geothermal to Cloudflare R2"),
        ("publish-dir", "publish data/geothermal to a local mirror"),
    ):
        step = geo.add_parser(name, help=text)
        _data_dir(step)
        if name == "fetch":
            step.add_argument(
                "--sites",
                type=Path,
                default=Path("../overrides/geothermal.yaml"),
                help="curated sites (YAML)",
            )
        if name == "publish-dir":
            step.add_argument("--out", type=Path, required=True, help="target directory, e.g. ../web/.data")

    images = groups.add_parser(
        "images", help="photographs of plants from Wikimedia Commons, copied into the bucket"
    ).add_subparsers(dest="step", required=True)
    images_update = images.add_parser("update", help="copy new photographs and publish their index")
    _data_dir(images_update)
    images_update.add_argument(
        "--baseline-url", required=True, help="public address of the published data (plants are read from it)"
    )
    images_update.add_argument(
        "--contact", default=None, help="where Wikimedia can reach the operator: the site's public address"
    )
    images_update.add_argument(
        "--out", type=Path, default=None, help="publish to this directory instead of R2"
    )
    images_update.add_argument("--allow-drop", action="store_true", help="accept a large drop in photographs")

    eurostat = groups.add_parser(
        "eurostat", help="official share of energy from renewable sources (Eurostat nrg_ind_ren)"
    ).add_subparsers(dest="step", required=True)
    for name, text in (
        ("fetch", "fetch the shares into data/eurostat/renewables.json"),
        ("publish-r2", "publish data/eurostat/renewables.json to Cloudflare R2"),
        ("publish-dir", "publish data/eurostat/renewables.json to a local mirror"),
    ):
        step = eurostat.add_parser(name, help=text)
        _data_dir(step)
        if name == "publish-dir":
            step.add_argument("--out", type=Path, required=True, help="target directory, e.g. ../web/.data")
        if name != "fetch":
            step.add_argument(
                "--allow-drop",
                action="store_true",
                help="publish even if a published area or indicator lost its latest year",
            )

    solar = groups.add_parser(
        "solar", help="solar potential: expected yearly output of photovoltaics (Global Solar Atlas)"
    ).add_subparsers(dest="step", required=True)
    for name, text in (
        ("fetch", "download each country's raster archive into data/solar"),
        ("publish-r2", "build the picture and the values from data/solar and publish them to Cloudflare R2"),
        ("publish-dir", "the same, to a local mirror"),
    ):
        step = solar.add_parser(name, help=text)
        _data_dir(step)
        if name == "publish-dir":
            step.add_argument("--out", type=Path, required=True, help="target directory, e.g. ../web/.data")

    src = groups.add_parser("sources", help="source files kept in the data bucket").add_subparsers(
        dest="step", required=True
    )
    gem_up = src.add_parser("gem-upload", help="check a GEM tracker export and make it the build input")
    gem_up.add_argument("file", type=Path)
    gem_up.add_argument("--dir", type=Path, help="local bucket mirror instead of R2 (development)")
    gem_fetch = src.add_parser("gem-fetch", help="download the GEM export in use; prints its path")
    _data_dir(gem_fetch)
    gem_fetch.add_argument("--baseline-url", required=True, help="public data URL")
    em_up = src.add_parser(
        "emodnet-upload", help="store data/marine (from `marine fetch`) as the build input"
    )
    _data_dir(em_up)
    em_up.add_argument("--dir", type=Path, help="local bucket mirror instead of R2 (development)")
    em_fetch = src.add_parser("emodnet-fetch", help="unpack the stored EMODnet extract; prints its directory")
    _data_dir(em_fetch)
    em_fetch.add_argument("--baseline-url", required=True, help="public data URL")

    marine = groups.add_parser("marine", help="offshore data (EMODnet)").add_subparsers(
        dest="step", required=True
    )
    marine_fetch = marine.add_parser(
        "fetch", help="download EMODnet pipelines and wind farms into data/marine"
    )
    _data_dir(marine_fetch)

    cities = groups.add_parser(
        "cities", help="city energy inventories (Covenant of Mayors / JRC)"
    ).add_subparsers(dest="step", required=True)
    cities_download = cities.add_parser("download", help="download a release into data/cities")
    _data_dir(cities_download)
    cities_download.add_argument("--release", help="folder name, e.g. 2025_Sixth_release; default: newest")
    cities_inspect = cities.add_parser(
        "inspect", help="print sheet names and headers of a downloaded release"
    )
    _data_dir(cities_inspect)

    pub = groups.add_parser("publish", help="publish a build").add_subparsers(dest="step", required=True)
    r2 = pub.add_parser("r2", help="upload to Cloudflare R2 (credentials from R2_* environment variables)")
    _data_dir(r2)
    _build_arg(r2)
    r2.add_argument("--keep", type=int, default=publish.DEFAULT_KEEP, help="builds to keep in the bucket")
    local = pub.add_parser("dir", help="mirror the bucket layout into a local directory (development)")
    _data_dir(local)
    _build_arg(local)
    local.add_argument("--out", type=Path, required=True, help="target directory, e.g. ../web/.data")
    local.add_argument("--keep", type=int, default=publish.DEFAULT_KEEP)
    return root


def run(args: argparse.Namespace) -> None:
    if args.group == "sources" and args.step == "gem-upload":
        # the only command that works on a single file and needs no data directory
        target: publish.ObjectStore = (
            publish.DirectoryStore(args.dir) if args.dir else publish.R2Store.from_env()
        )
        print(sources.upload_gem(target, args.file, datetime.now(UTC)).key)
        return
    paths = config.Paths(args.data_dir)
    if args.group == "osm":
        if args.step in {"download", "run"}:
            pipeline.download(paths, args.countries)
        if args.step in {"build", "run"}:
            baseline = (
                pipeline.published_counts(args.baseline_url) if args.baseline_url else pipeline.LOCAL_BASELINE
            )
            print(
                pipeline.build(
                    paths,
                    args.countries,
                    allow_drop=args.allow_drop,
                    baseline=baseline,
                    gem=args.gem,
                    overrides=args.overrides,
                    marine=args.marine,
                    datacenter_list=args.datacenters,
                    cities=args.cities,
                )
            )
    elif args.group == "live":
        target_file = paths.root / "live" / "current.json"
        if args.step == "fetch":
            with EntsoeClient.from_env() as client:
                document = energy_live.collect(client, datetime.now(UTC))
            energy_live.validate(document)
            write_json_atomic(target_file, document)
            print(json.dumps(document["missing"], sort_keys=True))
        else:
            if not target_file.exists():
                raise BuildValidationError([f"{target_file} not found; run `energymap live fetch` first"])
            live_store: publish.ObjectStore = (
                publish.R2Store.from_env() if args.step == "publish-r2" else publish.DirectoryStore(args.out)
            )
            energy_live.publish_live(live_store, read_json(target_file))
    elif args.group == "gas" and args.step == "storage-survey":
        with make_client() as client:
            storage = agsi.survey(client, datetime.now(UTC), config.SCOPE_CODES)
        write_json_atomic(paths.root / "gas" / "storage-survey.json", storage)
        print(agsi.markdown(storage), end="")
    elif args.group == "gas" and args.step == "points":
        with make_client() as client:
            survey = gas_points.survey(client, datetime.now(UTC), config.SCOPE_CODES, days=args.days)
        write_json_atomic(paths.root / "gas" / "points.json", survey)
        print(gas_points.markdown(survey), end="")
    elif args.group == "gas":
        gas_file = paths.root / "live" / "gas.json"
        if args.step == "fetch":
            with make_client() as client:
                document = entsog.collect(client, datetime.now(UTC), config.SCOPE_CODES, days=args.days)
            entsog.validate(document)
            write_json_atomic(gas_file, document)
            print(json.dumps(document["missing"], sort_keys=True))
        else:
            if not gas_file.exists():
                raise BuildValidationError([f"{gas_file} not found; run `energymap gas fetch` first"])
            gas_store: publish.ObjectStore = (
                publish.R2Store.from_env() if args.step == "publish-r2" else publish.DirectoryStore(args.out)
            )
            entsog.publish_gas(gas_store, read_json(gas_file))
    elif args.group == "hep":
        hep_dir = paths.root / "hep"
        current_file, regions_file = hep_dir / "current.json", hep_dir / "regions.geojson"
        if args.step == "fetch":
            with make_client() as client:
                document, regions = hep_capacity.collect(client, datetime.now(UTC))
            hep_capacity.validate(document)
            write_json_atomic(regions_file, regions, compact=True)
            write_json_atomic(current_file, document)
            print(
                json.dumps({"dataVersion": document["dataVersion"], **document["problems"]}, sort_keys=True)
            )
        else:
            missing = [str(f) for f in (current_file, regions_file) if not f.exists()]
            if missing:
                problem = f"{', '.join(missing)} not found; run `energymap hep fetch` first"
                raise BuildValidationError([problem])
            hep_store: publish.ObjectStore = (
                publish.R2Store.from_env() if args.step == "publish-r2" else publish.DirectoryStore(args.out)
            )
            result = hep_capacity.publish_capacity(
                hep_store, read_json(current_file), read_json(regions_file), allow_drop=args.allow_drop
            )
            print(
                json.dumps(
                    {"changed": result.changed, "snapshot": result.snapshot, "snapshots": result.snapshots}
                )
            )
    elif args.group == "geothermal":
        geo_file = paths.root / "geothermal" / "current.json"
        if args.step == "fetch":
            with make_client() as client:
                geo_doc = geothermal_publish.collect(client, args.sites, datetime.now(UTC))
            geothermal_publish.validate(geo_doc)
            write_json_atomic(geo_file, geo_doc, compact=True)
            flow = geo_doc["heatFlow"]
            print(
                json.dumps(
                    {"sites": len(geo_doc["sites"]), "points": flow["points"], "cells": len(flow["cells"])}
                )
            )
        else:
            if not geo_file.exists():
                raise BuildValidationError([f"{geo_file} not found; run `energymap geothermal fetch` first"])
            geo_store: publish.ObjectStore = (
                publish.R2Store.from_env() if args.step == "publish-r2" else publish.DirectoryStore(args.out)
            )
            geothermal_publish.publish_geothermal(geo_store, read_json(geo_file))
    elif args.group == "images":
        images_store: publish.ObjectStore = (
            publish.DirectoryStore(args.out) if args.out is not None else publish.R2Store.from_env()
        )
        headers = {"User-Agent": wikimedia.user_agent(args.contact)}
        with httpx.Client(timeout=60.0, headers=headers, follow_redirects=True) as client:
            published = fetch_published(client, args.baseline_url)
            if published is None:
                raise BuildValidationError([f"nothing is published at {args.baseline_url}"])
            assets = {
                str(feature["properties"]["id"]): str(feature["properties"]["wikidata"])
                for feature in iter_layer(client, published, "plants")
                if feature.get("properties", {}).get("wikidata")
            }
            index = wikimedia.update(
                images_store, assets, client, datetime.now(UTC), allow_drop=args.allow_drop
            )
        print(json.dumps({"plantsWithWikidata": len(assets), "photographs": len(index["images"])}))
    elif args.group == "solar":
        solar_dir = paths.root / "solar"
        if args.step == "fetch":
            with make_client() as client:
                fetched = solar_download.fetch(client, solar_dir)
            print(
                json.dumps({"archives": len(fetched), "bytes": sum(path.stat().st_size for path in fetched)})
            )
        else:
            archives = sorted(solar_dir.glob("*.zip"))
            if not archives:
                raise BuildValidationError([f"no archives in {solar_dir}; run `energymap solar fetch` first"])
            solar_store: publish.ObjectStore = (
                publish.R2Store.from_env() if args.step == "publish-r2" else publish.DirectoryStore(args.out)
            )
            solar_document, solar_image = solar_potential.build(
                [solar_potential.read_archive(path) for path in archives], datetime.now(UTC)
            )
            solar_published = solar_potential.publish_solar(solar_store, solar_document, solar_image)
            print(
                json.dumps(
                    {
                        "image": solar_published["image"],
                        "bytes": len(solar_image),
                        "countries": solar_published["countries"],
                        "min": solar_published["min"],
                        "max": solar_published["max"],
                    }
                )
            )
    elif args.group == "eurostat":
        shares_file = paths.root / "eurostat" / "renewables.json"
        if args.step == "fetch":
            with make_client() as client:
                shares = eurostat_renewables.collect(client, datetime.now(UTC))
            eurostat_renewables.validate(shares)
            write_json_atomic(shares_file, shares, compact=True)
            print(
                json.dumps({"lastYear": eurostat_renewables.last_year(shares), "missing": shares["missing"]})
            )
        else:
            if not shares_file.exists():
                raise BuildValidationError([f"{shares_file} not found; run `energymap eurostat fetch` first"])
            shares_store: publish.ObjectStore = (
                publish.R2Store.from_env() if args.step == "publish-r2" else publish.DirectoryStore(args.out)
            )
            shares_changed = eurostat_renewables.publish_renewables(
                shares_store, read_json(shares_file), allow_drop=args.allow_drop
            )
            print(json.dumps({"changed": shares_changed}))
    elif args.group == "energy" and args.step == "pull":
        with make_client() as client:
            print(json.dumps(energy_release.pull(client, args.baseline_url, paths.root / "energy")))
    elif args.group == "energy" and args.step.startswith("publish"):
        target_store: publish.ObjectStore = (
            publish.R2Store.from_env() if args.step == "publish-r2" else publish.DirectoryStore(args.out)
        )
        pointer = energy_release.release(
            target_store, paths.root / "energy", datetime.now(UTC), allow_drop=args.allow_drop
        )
        print(pointer["updatedAt"])
    elif args.group == "energy":
        now = datetime.now(UTC)
        if args.step == "fetch":
            last = args.to_year or now.astimezone(ENERGY_TZ).year
            if args.from_year > last:
                raise BuildValidationError([f"--from-year {args.from_year} is after {last}"])
            start = datetime(args.from_year, 1, 1, tzinfo=ENERGY_TZ)
            end = min(datetime(last + 1, 1, 1, tzinfo=ENERGY_TZ), now)
        else:
            end = now
            start = (now - timedelta(days=args.days)).astimezone(ENERGY_TZ)
            start = start.replace(hour=0, minute=0, second=0, microsecond=0)
        with EntsoeClient.from_env() as client:
            changed = energy_fetch.update(
                client, paths.root / "energy", [c.code for c in args.countries], start, end
            )
        print(json.dumps(changed, sort_keys=True))
    elif args.group == "cities" and args.step == "download":
        with make_client() as client:
            release = cities_read.download(
                client, paths.root / "cities", args.release, datetime.now(UTC).isoformat()
            )
        print(json.dumps({"release": release.release, "files": sorted(release.files)}, sort_keys=True))
    elif args.group == "cities":
        for kind in cities_read.FILE_PREFIXES:
            file = paths.root / "cities" / f"{kind}.xlsx"
            if file.exists():
                print(json.dumps({kind: cities_read.inspect(file)}, ensure_ascii=False, indent=2))
    elif args.group == "marine":
        with make_client() as client:
            counts = emodnet.download(client, paths.root / "marine", datetime.now(UTC))
        print(json.dumps(counts, sort_keys=True))
    elif args.group == "sources" and args.step == "emodnet-upload":
        emodnet_store: publish.ObjectStore = (
            publish.DirectoryStore(args.dir) if args.dir else publish.R2Store.from_env()
        )
        print(sources.upload_emodnet(emodnet_store, paths.root / "marine", datetime.now(UTC)))
    elif args.group == "sources" and args.step == "emodnet-fetch":
        with make_client() as client:
            found_dir = sources.fetch_emodnet(client, args.baseline_url, paths.root / "marine")
        print(found_dir or "")
    elif args.group == "sources":
        with make_client() as client:
            found = sources.fetch_gem(client, args.baseline_url, paths.root / "sources")
        print(found or "")
    elif args.group == "diff":
        build_dir = pipeline.resolve_build(paths.out, args.build)
        text = diff.to_markdown(pipeline.write_diff(build_dir, args.baseline_url))
        if args.summary:
            with args.summary.open("a", encoding="utf-8") as handle:
                handle.write(text)
        else:
            print(text, end="")
    elif args.group == "tiles":
        build_dir = pipeline.resolve_build(paths.out, args.build)
        for info in tiles.build_tiles(build_dir, args.tippecanoe).values():
            print(build_dir / info.file)
    elif args.group == "publish":
        build_dir = pipeline.resolve_build(paths.out, args.build)
        store: publish.ObjectStore
        if args.step == "r2":
            store = publish.R2Store.from_env()
        else:
            args.out.mkdir(parents=True, exist_ok=True)
            store = publish.DirectoryStore(args.out)
        print(publish.publish_build(store, build_dir, keep=args.keep).build_id)


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    log.configure(args.log_level)
    try:
        run(args)
    except BuildValidationError as exc:
        logger.error("build rejected", extra={"problems": exc.problems})
        return EXIT_REJECTED
    except (
        DownloadError,
        BaselineError,
        GemFormatError,
        OverridesError,
        cities_read.CitiesFormatError,
        cities_read.CitiesDownloadError,
        sources.SourceError,
        emodnet.EmodnetError,
        EntsoeError,
        EntsoeParseError,
        EnergyDataError,
        energy_release.EnergyReleaseError,
        energy_live.LiveDataError,
        entsog.EntsogError,
        agsi.AgsiError,
        entsog.GasDataError,
        GeothermalDataError,
        hep_capacity.HepSourceError,
        hep_capacity.HepDataError,
        eurostat_renewables.EurostatSourceError,
        eurostat_renewables.EurostatDataError,
        wikimedia.ImagesError,
        solar_potential.SolarDataError,
        CountryDataError,
        tiles.TilesError,
        publish.PublishError,
        httpx.HTTPError,
        BotoCoreError,
        ClientError,
        ValidationError,
        OSError,
    ) as exc:
        logger.exception("pipeline failed", extra={"error_type": type(exc).__name__})
        return EXIT_FAILED
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
