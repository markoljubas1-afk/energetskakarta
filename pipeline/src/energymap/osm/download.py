"""Download Geofabrik extracts safely: resolve URLs from the official index, verify MD5, write atomically,
and skip files that have not changed since the last run."""

from __future__ import annotations

import hashlib
import logging
import re
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx
import osmium

from energymap.files import read_json, write_json_atomic

log = logging.getLogger(__name__)

_MD5 = re.compile(r"^[0-9a-f]{32}$")
_CHUNK = 1024 * 1024


class DownloadError(RuntimeError):
    """A source could not be downloaded or verified."""


@dataclass(frozen=True, slots=True)
class SourceState:
    region_id: str
    url: str
    md5: str
    downloaded_at: str
    replication_timestamp: str | None

    @property
    def data_timestamp(self) -> datetime:
        """When the OSM data was current: the replication timestamp if known, else the download time."""
        return datetime.fromisoformat(self.replication_timestamp or self.downloaded_at)


def pbf_path(raw_dir: Path, region_id: str) -> Path:
    return raw_dir / f"{region_id}.osm.pbf"


def state_path(raw_dir: Path, region_id: str) -> Path:
    return raw_dir / f"{region_id}.state.json"


def load_state(raw_dir: Path, region_id: str) -> SourceState | None:
    path = state_path(raw_dir, region_id)
    if not path.exists() or not pbf_path(raw_dir, region_id).exists():
        return None
    return SourceState(**read_json(path))


def resolve_urls(client: httpx.Client, index_url: str, region_ids: Iterable[str]) -> dict[str, str]:
    """Map Geofabrik region ids to PBF URLs using the published index instead of guessing paths."""
    wanted = list(region_ids)
    response = client.get(index_url)
    response.raise_for_status()
    urls: dict[str, str] = {}
    for feature in response.json().get("features", []):
        props = feature.get("properties", {})
        pbf = props.get("urls", {}).get("pbf")
        if props.get("id") in wanted and isinstance(pbf, str):
            urls[props["id"]] = pbf
    missing = [r for r in wanted if r not in urls]
    if missing:
        raise DownloadError(f"Geofabrik index has no PBF for: {', '.join(missing)}")
    return urls


def fetch_md5(client: httpx.Client, pbf_url: str) -> str:
    response = client.get(f"{pbf_url}.md5")
    response.raise_for_status()
    checksum = response.text.strip().split()[0].lower() if response.text.strip() else ""
    if not _MD5.match(checksum):
        raise DownloadError(f"Unexpected checksum file for {pbf_url}: {response.text[:80]!r}")
    return checksum


def replication_timestamp(path: Path) -> str | None:
    """Read the data timestamp from the PBF header without reading any objects."""
    reader = osmium.io.Reader(str(path), osmium.osm.osm_entity_bits.NOTHING)
    try:
        value = reader.header().get("osmosis_replication_timestamp")
    finally:
        reader.close()
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()


def download_region(client: httpx.Client, region_id: str, url: str, raw_dir: Path) -> SourceState:
    raw_dir.mkdir(parents=True, exist_ok=True)
    remote_md5 = fetch_md5(client, url)
    current = load_state(raw_dir, region_id)
    if current is not None and current.md5 == remote_md5:
        log.info("source unchanged, skipping download", extra={"region": region_id, "md5": remote_md5})
        return current

    target = pbf_path(raw_dir, region_id)
    part = target.with_name(f"{target.name}.part")
    digest = hashlib.md5(usedforsecurity=False)
    size = 0
    try:
        with client.stream("GET", url) as response, part.open("wb") as handle:
            response.raise_for_status()
            for chunk in response.iter_bytes(_CHUNK):
                handle.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        if digest.hexdigest() != remote_md5:
            raise DownloadError(
                f"Checksum mismatch for {region_id}: expected {remote_md5}, got {digest.hexdigest()}"
            )
        part.replace(target)
    finally:
        part.unlink(missing_ok=True)

    state = SourceState(
        region_id=region_id,
        url=url,
        md5=remote_md5,
        downloaded_at=datetime.now(UTC).isoformat(),
        replication_timestamp=replication_timestamp(target),
    )
    write_json_atomic(state_path(raw_dir, region_id), asdict(state))
    log.info("downloaded source", extra={"region": region_id, "bytes": size, "md5": remote_md5})
    return state


def make_client() -> httpx.Client:
    return httpx.Client(
        timeout=httpx.Timeout(30.0, read=300.0),
        follow_redirects=True,
        transport=httpx.HTTPTransport(retries=3),
        headers={"User-Agent": "energymap-pipeline/0.1 (+https://gridatlas.eu)"},
    )
