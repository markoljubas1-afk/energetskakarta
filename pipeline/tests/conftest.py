from __future__ import annotations

import hashlib
import logging
import shutil
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path

import httpx
import osmium
import pytest

from energymap import build as pipeline
from energymap import config
from energymap.geo.countries import CountryIndex
from energymap.osm.download import download_region

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def _restore_logging() -> Iterator[None]:
    """CLI tests configure the root logger with a handler bound to pytest's captured stderr,
    which is closed after the test. Restore the previous logging setup every time."""
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    # log.configure() also changes library loggers
    libraries = {name: logging.getLogger(name).level for name in ("httpx", "httpcore")}
    yield
    root.handlers[:] = handlers
    root.setLevel(level)
    for name, previous in libraries.items():
        logging.getLogger(name).setLevel(previous)


@pytest.fixture
def fixtures() -> Path:
    return FIXTURES


@pytest.fixture
def index() -> CountryIndex:
    """Synthetic borders: SI lon 13-15, HR lon 15-17, SK lon 17-19 (all lat 45-46)."""
    return CountryIndex.from_geojson(
        FIXTURES / "countries.geojson",
        bbox=(10.0, 40.0, 25.0, 50.0),
        min_segment_m=500.0,
        coastal_tolerance_deg=0.25,
    )


@pytest.fixture(scope="session")
def sample_pbf(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """PBF copy of the XML fixture, so mocked downloads look like Geofabrik's files."""
    target = tmp_path_factory.mktemp("pbf") / "sample.osm.pbf"
    with osmium.SimpleWriter(str(target)) as writer:
        for obj in osmium.FileProcessor(str(FIXTURES / "sample.osm")):
            writer.add(obj)
    return target


BuildFactory = Callable[[datetime], Path]


@pytest.fixture
def make_build(tmp_path: Path, sample_pbf: Path) -> BuildFactory:
    """Create real local builds (HR scope) from the fixture, one per timestamp."""
    paths = config.Paths(tmp_path / "data")
    paths.ensure()
    shutil.copy(FIXTURES / "countries.geojson", paths.reference / "ne_10m_admin_0_countries.geojson")
    payload = sample_pbf.read_bytes()
    checksum = hashlib.md5(payload, usedforsecurity=False).hexdigest()

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url).endswith(".md5"):
            return httpx.Response(200, text=f"{checksum}  file")
        return httpx.Response(200, content=payload)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        download_region(client, "croatia", "https://geo.test/croatia.osm.pbf", paths.raw)

    def factory(now: datetime = datetime(2026, 9, 16, 12, tzinfo=UTC)) -> Path:
        return pipeline.build(paths, [config.COUNTRY_BY_CODE["HR"]], now=now, allow_drop=True)

    return factory
