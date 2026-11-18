"""Build the small test dataset and publish it into a directory for the website's dev server and e2e tests.

    python scripts/web_fixture.py ../web/.data                      # synthetic fixture borders
    python scripts/web_fixture.py ../web/.data --borders ne.geojson # real Natural Earth borders

Everything here is test data from tests/fixtures; it must never be published to R2.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sys
import tempfile
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import osmium
from cities_fixture import write_fixture as write_cities_fixture

from energymap import build, config, diff, publish, tiles
from energymap.baseline import iter_local_layer
from energymap.entsoe import live as energy_live
from energymap.entsoe import records as live_records
from energymap.entsoe import release as energy_release
from energymap.entsoe.client import AREAS, NoData
from energymap.entsoe.energy import DailyEnergy
from energymap.entsoe.parse import Interval, Series
from energymap.entsoe.store import YearFile
from energymap.files import write_json_atomic
from energymap.gas import entsog
from energymap.geothermal import heatflow
from energymap.geothermal import publish as geothermal_publish
from energymap.geothermal.sites import load_sites
from energymap.osm.download import download_region
from energymap.schema import Technology

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
# repository root: the curated files in overrides/ are real inputs, used as they are
ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("out", type=Path)
    parser.add_argument("--borders", type=Path, default=FIXTURES / "countries.geojson")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="energymap-fixture-") as tmp:
        paths = config.Paths(Path(tmp))
        paths.ensure()
        shutil.copy(args.borders, paths.reference / "ne_10m_admin_0_countries.geojson")
        pbf = Path(tmp) / "sample.osm.pbf"
        with osmium.SimpleWriter(str(pbf)) as writer:
            for obj in osmium.FileProcessor(str(FIXTURES / "sample.osm")):
                writer.add(obj)
        payload = pbf.read_bytes()
        checksum = hashlib.md5(payload, usedforsecurity=False).hexdigest()

        def handler(request: httpx.Request) -> httpx.Response:
            if str(request.url).endswith(".md5"):
                return httpx.Response(200, text=f"{checksum}  sample.osm.pbf")
            return httpx.Response(200, content=payload)

        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            download_region(client, "croatia", "https://fixture.invalid/sample.osm.pbf", paths.raw)

        # one extract, two countries in scope: the fixture contains objects on both sides of the border
        build_dir = build.build(
            paths,
            [config.COUNTRY_BY_CODE["HR"]],
            scope={"HR", "SI"},
            now=datetime.now(UTC),
            # the GEM sample exercises merged plants, GEM-only plants and non-commercial attribution
            gem=FIXTURES / "gem_sample.csv",
            # EMODnet sample: an Adriatic gas pipeline and a planned offshore wind farm
            marine=FIXTURES / "emodnet",
            # invented data centres: one completing an OSM record, one standing on its own
            datacenter_list=FIXTURES / "datacenters_sample.yaml",
            # invented Covenant of Mayors release: three cities with inventories (scripts/cities_fixture.py)
            cities=write_cities_fixture(Path(tmp) / "cities"),
        )
        tiles.build_tiles(build_dir)
        write_fixture_diff(build_dir)
        args.out.mkdir(parents=True, exist_ok=True)
        result = publish.publish_build(publish.DirectoryStore(args.out), build_dir)
        energy_root = Path(tmp) / "energy"
        write_synthetic_energy(energy_root)
        energy_release.release(publish.DirectoryStore(args.out), energy_root, datetime.now(UTC))
        geothermal_publish.publish_geothermal(
            publish.DirectoryStore(args.out),
            geothermal_publish.document(
                load_sites(ROOT / "overrides" / "geothermal.yaml"), synthetic_heat_flow(), datetime.now(UTC)
            ),
        )
        live_doc = energy_live.collect(SyntheticLive(), datetime.now(UTC))
        live_doc["fixture"] = "synthetic values for development and tests"
        energy_live.publish_live(publish.DirectoryStore(args.out), live_doc)
        # the list of record days, empty: the map asks for it on every visit (the notice above the map),
        # and a missing file would be a 404 in the console of every test
        publish.DirectoryStore(args.out).put_bytes(
            live_records.INDEX_KEY,
            json.dumps(live_records.index_document([], [], datetime.now(UTC))).encode(),
            live_records.INDEX_META,
        )
        gas_doc = synthetic_gas(datetime.now(UTC))
        entsog.publish_gas(publish.DirectoryStore(args.out), gas_doc)
        (args.out / "energy" / "FIXTURE_DATA_NOT_REAL.txt").write_text(
            "Synthetic energy values for development and end-to-end tests. Never publish them.\n"
        )
    print(f"fixture build {result.build_id} and synthetic energy data written to {args.out}")
    return 0


def write_fixture_diff(build_dir: Path) -> None:
    """A change report against an imagined previous build, so the website's "what is new" view has
    something to show. The previous build is this one with three edits: one plant missing (so it is
    new now), one plant with a different capacity (changed), and one extra line (removed since).
    The real pipeline compares against the published build (build.write_diff)."""
    layers: dict[str, diff.LayerDiff] = {}
    for layer in tiles.LAYERS:
        if not (build_dir / f"{layer}.ndjson").exists():
            continue
        current = diff.index(iter_local_layer(build_dir, layer))
        previous = dict(current)
        if layer == "plants":
            keys = sorted(previous)
            del previous[keys[0]]
            changed = previous[keys[1]]
            previous[keys[1]] = diff.Entry("previous-capacity", changed.name, changed.country, changed.point)
        if layer == "lines":
            previous["osm:way/999001"] = diff.Entry("gone", "Ukinuti vod (testni)", "HR", (15.6, 45.4))
        layers[layer] = diff.compare(previous, current)
    result = diff.BuildDiff(build_dir.name, "20260901T000000Z", layers)
    write_json_atomic(build_dir / diff.DIFF_FILE, diff.to_json(result))


# Known values the end-to-end tests check. Everything else follows smooth seasonal curves.
SYNTHETIC_YEARS = (2024, 2025)
HR_MISSING = (date(2025, 3, 10), date(2025, 3, 21))  # 12 days without data: March 2025 is incomplete


def _daily(tech: Technology, day: date) -> float:
    season = math.cos(2 * math.pi * (day.timetuple().tm_yday - 172) / 365)  # 1 at midsummer
    base = {
        Technology.HYDRO: 12_000 - 3_000 * season,
        Technology.SOLAR: 1_500 + 1_200 * season,
        Technology.WIND: 3_000 - 800 * season,
        Technology.GAS: 4_000 - 1_000 * season,
        Technology.PUMPED_STORAGE: 600.0,
    }[tech]
    return round(base, 1)


class SyntheticLive:
    """Smooth made-up flows and prices. Known gaps for the end-to-end tests:
    ME-BA never reports, BA and ME have no market, and SI-HR is missing for the first hour of today."""

    def flows(self, sender: str, receiver: str, start: datetime, end: datetime) -> list[Series]:
        pair = (CODES[sender], CODES[receiver])
        if set(pair) == {"ME", "BA"}:
            raise NoData("synthetic: no flows")
        seed = 3 * sum(map(ord, pair[0])) + sum(map(ord, pair[1]))  # differs per direction
        today = start + timedelta(days=1)
        intervals = []
        cursor = start
        while cursor < end:
            hour = int((cursor - start).total_seconds() // 3600)
            if not (set(pair) == {"SI", "HR"} and cursor == today):
                value = max(0.0, 250 + 200 * math.sin((hour + seed) / 4) + (seed % 7) * 20)
                intervals.append(Interval(cursor, cursor + timedelta(hours=1), round(value, 1)))
            cursor += timedelta(hours=1)
        return [Series(None, False, tuple(intervals))]

    def prices(self, zone: str, start: datetime, end: datetime) -> list[Series]:
        if zone in (AREAS["BA"], AREAS["ME"]):
            raise NoData("synthetic: no market")
        seed = sum(map(ord, zone)) % 30
        intervals = []
        cursor = start
        while cursor < end:
            hour = cursor.astimezone(energy_live.TIMEZONE).hour
            value = 90 + seed + 40 * math.sin((hour - 7) / 24 * 2 * math.pi)
            intervals.append(Interval(cursor, cursor + timedelta(minutes=15), round(value, 2)))
            cursor += timedelta(minutes=15)
        return [Series(None, False, tuple(intervals), sequence=1)]

    def generation(self, area: str, start: datetime, end: datetime) -> list[Series]:
        """Hydro, wind, solar and gas with a daily shape, reported up to "now" (actuals arrive late)."""
        if CODES[area] == "ME":
            raise NoData("synthetic: no generation")
        now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0) - timedelta(hours=1)
        scale = {"HR": 1.0, "SI": 0.8, "HU": 1.6, "RS": 1.4, "BA": 0.7, "AT": 2.5}[CODES[area]]
        shapes: dict[str, Callable[[int], float]] = {  # psrType → MW at local hour h
            "B12": lambda h: 900 + 150 * math.sin(h / 24 * 2 * math.pi),
            "B19": lambda h: 300 + 120 * math.cos(h / 5),
            "B16": lambda h: max(0.0, 500 * math.sin((h - 6) / 13 * math.pi)) if 6 <= h <= 19 else 0.0,
            "B04": lambda h: 250 + 80 * math.sin((h - 8) / 24 * 2 * math.pi),
        }
        out = []
        for psr, shape in shapes.items():
            intervals = []
            cursor = start
            while cursor < min(end, now):
                hour = cursor.astimezone(energy_live.TIMEZONE).hour
                intervals.append(Interval(cursor, cursor + timedelta(hours=1), round(scale * shape(hour), 1)))
                cursor += timedelta(hours=1)
            out.append(Series(psr, False, tuple(intervals)))
        return out


CODES = {code: name for name, code in AREAS.items()}


def synthetic_heat_flow() -> list[heatflow.Point]:
    """Made-up measurements on a lattice, warmer towards the Pannonian north-east (development only)."""
    points = []
    for i in range(14):
        for j in range(10):
            lon, lat = 13.2 + i * 0.45, 42.4 + j * 0.42
            q = 45 + 9 * (lon - 13.2) + 7 * (lat - 42.4)
            points.append(heatflow.Point(round(lon, 2), round(lat, 2), round(q, 1)))
    return points


def write_synthetic_energy(root: Path) -> None:
    for year in SYNTHETIC_YEARS:
        days = YearFile(year).days
        yearly = YearFile(year)
        for code, share in (("HR", 1.0), ("SI", 0.7)):
            present = [d for d in days if code != "HR" or not (HR_MISSING[0] <= d <= HR_MISSING[1])]
            if code == "SI" and year == 2024:
                continue  # a country that only starts reporting in 2025
            techs = (Technology.HYDRO, Technology.SOLAR, Technology.WIND, Technology.GAS)
            energy = DailyEnergy(
                generation={d: {t: round(_daily(t, d) * share, 1) for t in techs} for d in present},
                consumption={
                    d: {Technology.PUMPED_STORAGE: _daily(Technology.PUMPED_STORAGE, d)} for d in present
                },
                load={
                    d: round(24_000 * share + 2_000 * math.cos(2 * math.pi * d.month / 12), 1)
                    for d in present
                },
                generation_coverage=dict.fromkeys(present, 1.0),
                load_coverage=dict.fromkeys(present, 1.0),
            )
            yearly.merge(code, energy, ["synthetic"])
        target = root / "daily" / f"{year}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(yearly.to_json()), encoding="utf-8")


def synthetic_gas(now: datetime) -> dict[str, Any]:
    """A gas document shaped like entsog.collect's, with made-up figures: Croatia reports every day but
    the last, Italy every day; nobody else has a production point. Never published anywhere real."""
    days = entsog.gas_days(now, entsog.DEFAULT_DAYS)
    hr: list[int | None] = [round(12_000_000 + 900_000 * math.sin(i / 2)) for i in range(len(days))]
    hr[-1] = None  # the operator has not reported the latest day yet
    it = [round(70_000_000 - 1_500_000 * (i % 3)) for i in range(len(days))]
    return {
        "version": entsog.VERSION,
        "generatedAt": now.isoformat(),
        "source": "synthetic (web_fixture.py)",
        "unit": entsog.UNIT,
        "days": [day.isoformat() for day in days],
        "points": [
            {
                "key": "PRD-FIX-HR",
                "pointDirection": "5HR-FIX-0001PRD-FIX-HRentry",
                "label": "Domaća proizvodnja (fixture)",
                "country": "HR",
                "operator": "Fixture TSO HR",
                "kwhPerDay": hr,
            },
            {
                "key": "PRD-FIX-IT",
                "pointDirection": "5IT-FIX-0001PRD-FIX-ITentry",
                "label": "Produzione nazionale (fixture)",
                "country": "IT",
                "operator": "Fixture TSO IT",
                "kwhPerDay": it,
            },
        ],
        "missing": {"points": [], "countries": sorted(config.SCOPE_CODES - {"HR", "IT"})},
        "fixture": "synthetic values for development and tests",
    }


if __name__ == "__main__":
    sys.exit(main())
