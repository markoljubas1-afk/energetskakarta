"""Source files the scheduled build needs but cannot download itself (Global Energy Monitor's tracker).

GEM hands out its export through a form and an e-mailed link, so the file is stored once in the data
bucket and fetched from there by every build:

    sources/gem/<sha256>-<name>      immutable copy of the export
    sources/gem/current.json         pointer to the copy in use, written last

Uploads are checked with the real reader first, so a wrong file can never become the build input.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

from energymap.files import sha256_file, write_json_atomic
from energymap.gem import normalize as gem_normalize
from energymap.gem import read as gem_read
from energymap.marine import emodnet
from energymap.publish import IMMUTABLE, POINTER_CACHE, ObjectMeta, ObjectStore, PublishError

log = logging.getLogger(__name__)

GEM_PREFIX = "sources/gem/"
GEM_POINTER = GEM_PREFIX + "current.json"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_CONTENT_TYPES = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
    ".csv": "text/csv; charset=utf-8",
}
_CHUNK = 1024 * 1024


class SourceError(RuntimeError):
    """A source file could not be stored, found or verified."""


@dataclass(frozen=True, slots=True)
class GemSource:
    key: str
    name: str
    sha256: str
    bytes: int
    uploaded_at: str
    plants: int


def safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    if not cleaned or Path(cleaned).suffix.lower() not in _CONTENT_TYPES:
        raise SourceError(f"{name!r}: expected an .xlsx or .csv file")
    return cleaned


def upload_gem(store: ObjectStore, path: Path, now: datetime) -> GemSource:
    name = safe_name(path.name)
    loaded = gem_normalize.load(gem_read.read_units(path))  # GemFormatError propagates with details
    if loaded.stats["units_in_scope"] == 0:
        raise SourceError(f"{path.name} has no usable units for the countries in scope; not uploaded")
    digest = sha256_file(path)
    source = GemSource(
        key=f"{GEM_PREFIX}{digest[:16]}-{name}",
        name=name,
        sha256=digest,
        bytes=path.stat().st_size,
        uploaded_at=now.isoformat(),
        plants=len(loaded.plants),
    )
    store.put_file(source.key, path, ObjectMeta(_CONTENT_TYPES[Path(name).suffix.lower()], IMMUTABLE))
    if store.size(source.key) != source.bytes:
        raise PublishError(f"Upload of {source.key} is incomplete")
    pointer = json.dumps(_to_json(source), indent=2).encode()
    store.put_bytes(GEM_POINTER, pointer, ObjectMeta("application/json; charset=utf-8", POINTER_CACHE))
    # "name" is a reserved LogRecord attribute, so the payload is nested
    log.info("uploaded GEM source", extra={"source": asdict(source)})
    return source


def _to_json(source: GemSource) -> dict[str, Any]:
    return {
        "key": source.key,
        "name": source.name,
        "sha256": source.sha256,
        "bytes": source.bytes,
        "uploadedAt": source.uploaded_at,
        "plants": source.plants,
    }


def _from_json(data: Any) -> GemSource:
    if not isinstance(data, dict):
        raise SourceError("GEM pointer is not a JSON object")
    key, name, digest, size = data.get("key"), data.get("name"), data.get("sha256"), data.get("bytes")
    if not (isinstance(key, str) and key.startswith(GEM_PREFIX) and ".." not in key and "://" not in key):
        raise SourceError(f"GEM pointer has an invalid key: {key!r}")
    if not (isinstance(digest, str) and _SHA256.match(digest)):
        raise SourceError("GEM pointer has an invalid sha256")
    if not (isinstance(size, int) and not isinstance(size, bool) and size > 0):
        raise SourceError("GEM pointer has an invalid size")
    return GemSource(
        key=key,
        name=safe_name(str(name or "")),
        sha256=digest,
        bytes=size,
        uploaded_at=str(data.get("uploadedAt") or ""),
        plants=int(data.get("plants") or 0),
    )


def _base(base_url: str) -> str:
    if not base_url.startswith(("https://", "http://")):
        raise SourceError(f"Base URL must be absolute http(s): {base_url!r}")
    return base_url if base_url.endswith("/") else f"{base_url}/"


def _get_pointer(client: httpx.Client, base: str, key: str) -> Any | None:
    """The parsed pointer, or None when nothing was uploaded (HTTP 404). Other failures raise."""
    url = urljoin(base, key)
    try:
        response = client.get(url, headers={"Cache-Control": "no-cache"})
    except httpx.HTTPError as exc:
        raise SourceError(f"Cannot reach {url}: {exc}") from exc
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise SourceError(f"{url} returned HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise SourceError(f"{url} is not valid JSON") from exc


def _download_verified(client: httpx.Client, url: str, sha256: str, target: Path) -> None:
    part = target.with_name(f".{target.name}.part")
    try:
        with client.stream("GET", url) as stream, part.open("wb") as handle:
            if stream.status_code != 200:
                raise SourceError(f"{url} returned HTTP {stream.status_code}")
            for chunk in stream.iter_bytes(_CHUNK):
                handle.write(chunk)
        if sha256_file(part) != sha256:
            raise SourceError(f"Checksum mismatch for {url}")
        part.replace(target)
    except httpx.HTTPError as exc:
        raise SourceError(f"Cannot download {url}: {exc}") from exc
    finally:
        part.unlink(missing_ok=True)


def fetch_gem(client: httpx.Client, base_url: str, target_dir: Path) -> Path | None:
    """Download the GEM file in use; None when none was uploaded yet. The checksum is always verified."""
    base = _base(base_url)
    raw = _get_pointer(client, base, GEM_POINTER)
    if raw is None:
        log.warning("no GEM source uploaded; building without GEM", extra={"url": base + GEM_POINTER})
        return None
    source = _from_json(raw)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / source.name
    if target.exists() and target.stat().st_size == source.bytes and sha256_file(target) == source.sha256:
        log.info("GEM source up to date", extra={"file": target.name})
        return target
    _download_verified(client, urljoin(base, source.key), source.sha256, target)
    log.info("downloaded GEM source", extra={"file": target.name, "bytes": source.bytes})
    return target


# ---------------------------------------------------------------- EMODnet

EMODNET_PREFIX = "sources/emodnet/"
EMODNET_POINTER = EMODNET_PREFIX + "current.json"
_EMODNET_KEY = re.compile(r"^sources/emodnet/[0-9a-f]{16}\.json$")


def upload_emodnet(store: ObjectStore, directory: Path, now: datetime) -> str:
    """Store the region extract made by ``energymap marine fetch`` as one checked bundle."""
    layers = {}
    for layer in emodnet.LAYERS:
        path = directory / f"{layer}.geojson"
        if not path.exists():
            raise SourceError(f"{path} missing; run `energymap marine fetch` first")
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
            raise SourceError(f"{path.name} is not a GeoJSON FeatureCollection")
        layers[layer] = data
    if not layers["pipelines"]["features"]:
        raise SourceError("no pipelines in the EMODnet extract; not uploaded")
    meta_path = directory / "emodnet.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    bundle = json.dumps({"meta": meta, "layers": layers}, sort_keys=True, separators=(",", ":")).encode()
    digest = hashlib.sha256(bundle).hexdigest()
    key = f"{EMODNET_PREFIX}{digest[:16]}.json"
    if store.size(key) != len(bundle):
        store.put_bytes(key, bundle, ObjectMeta("application/json; charset=utf-8", IMMUTABLE))
        if store.size(key) != len(bundle):
            raise PublishError(f"Upload of {key} is incomplete")
    pointer = {
        "key": key,
        "sha256": digest,
        "bytes": len(bundle),
        "uploadedAt": now.isoformat(),
        "counts": {layer: len(data["features"]) for layer, data in layers.items()},
        "fetchedAt": meta.get("fetchedAt"),
    }
    store.put_bytes(
        EMODNET_POINTER,
        json.dumps(pointer, indent=2).encode(),
        ObjectMeta("application/json; charset=utf-8", POINTER_CACHE),
    )
    log.info("uploaded EMODnet source", extra={"source": pointer})
    return key


def fetch_emodnet(client: httpx.Client, base_url: str, target_dir: Path) -> Path | None:
    """Unpack the stored EMODnet bundle into ``target_dir``; None when none was uploaded yet."""
    base = _base(base_url)
    raw = _get_pointer(client, base, EMODNET_POINTER)
    if raw is None:
        log.warning("no EMODnet source uploaded; building without offshore data")
        return None
    if not isinstance(raw, dict):
        raise SourceError("EMODnet pointer is not a JSON object")
    key, digest, size = raw.get("key"), raw.get("sha256"), raw.get("bytes")
    if not (isinstance(key, str) and _EMODNET_KEY.match(key)):
        raise SourceError(f"EMODnet pointer has an invalid key: {key!r}")
    if not (
        isinstance(digest, str) and _SHA256.match(digest) and key[len(EMODNET_PREFIX) : -5] == digest[:16]
    ):
        raise SourceError("EMODnet pointer has an invalid sha256")
    if not (isinstance(size, int) and not isinstance(size, bool) and size > 0):
        raise SourceError("EMODnet pointer has an invalid size")
    target_dir.mkdir(parents=True, exist_ok=True)
    bundle_path = target_dir / "bundle.json"
    _download_verified(client, urljoin(base, key), digest, bundle_path)
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    for layer in emodnet.LAYERS:
        data = (bundle.get("layers") or {}).get(layer)
        if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
            raise SourceError(f"EMODnet bundle has no valid {layer} layer")
        write_json_atomic(target_dir / f"{layer}.geojson", data)
    write_json_atomic(target_dir / "emodnet.json", bundle.get("meta") or {})
    bundle_path.unlink()
    return target_dir
