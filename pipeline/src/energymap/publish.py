"""Publish a local build to object storage (Cloudflare R2) so the website can read it.

Key layout in the bucket:
    builds/<build_id>/grid.pmtiles           immutable, cached for a year
    builds/<build_id>/boundaries.pmtiles     immutable; country outlines (z0-z8)
    builds/<build_id>/manifest.json          immutable
    builds/<build_id>/tiles.json             immutable
    builds/<build_id>/search.json            immutable; name search index for the website
    builds/<build_id>/stats.json             immutable; per-country totals
    builds/<build_id>/timeline.json          immutable; capacity by year for the time machine (optional)
    builds/<build_id>/plantgrid.json         immutable; plants added up by cell, for "what is on screen"
    builds/<build_id>/chargergrid.json       immutable; charging stations added up by cell, for wide zooms
    builds/<build_id>/<layer>.ndjson.gz      immutable; the ODbL database download
    current.json                             tiny pointer, short cache, written LAST

Because ``current.json`` is written only after every build object has been uploaded and verified,
a visitor never sees a half-published build.
"""

from __future__ import annotations

import gzip
import json
import logging
import os
import shutil
import tempfile
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from energymap.files import read_json
from energymap.tiles import ALL_ARCHIVES, ARCHIVES, CORE_LAYERS, LAYERS, TILES_INFO_FILE

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client
    from mypy_boto3_s3.type_defs import ObjectIdentifierTypeDef

log = logging.getLogger(__name__)

BUILDS_PREFIX = "builds/"
POINTER_KEY = "current.json"
IMMUTABLE = "public, max-age=31536000, immutable"
POINTER_CACHE = "public, max-age=60, must-revalidate"
DEFAULT_KEEP = 5
PRODUCTS: tuple[str, ...] = ("search.json", "stats.json")
# Published when the build has them (the change report exists only when a baseline was compared).
# plantgrid.json is written by every build since 2026-11-16; older local builds do not have it.
OPTIONAL_PRODUCTS: tuple[str, ...] = (
    "diff.json",
    "cities.json",
    "timeline.json",
    "plantgrid.json",
    "chargergrid.json",
)


class PublishError(RuntimeError):
    """The build could not be published; the previously published build is still live."""


@dataclass(frozen=True, slots=True)
class ObjectMeta:
    content_type: str
    cache_control: str


class ObjectStore(Protocol):
    def put_file(self, key: str, path: Path, meta: ObjectMeta) -> None: ...
    def put_bytes(self, key: str, data: bytes, meta: ObjectMeta) -> None: ...
    def size(self, key: str) -> int | None: ...
    def get_bytes(self, key: str) -> bytes | None: ...
    def list_prefixes(self, prefix: str) -> list[str]: ...
    def delete_prefix(self, prefix: str) -> int: ...
    def list_keys(self, prefix: str) -> list[str]: ...
    def delete_key(self, key: str) -> bool: ...


# ---------------------------------------------------------------- stores


@dataclass(slots=True)
class MemoryStore:
    """In-memory store with the same semantics as R2; used by tests and dry runs."""

    objects: dict[str, tuple[bytes, ObjectMeta]] = field(default_factory=dict)
    writes: list[str] = field(default_factory=list)

    def put_file(self, key: str, path: Path, meta: ObjectMeta) -> None:
        self.put_bytes(key, path.read_bytes(), meta)

    def put_bytes(self, key: str, data: bytes, meta: ObjectMeta) -> None:
        self.objects[key] = (data, meta)
        self.writes.append(key)

    def size(self, key: str) -> int | None:
        entry = self.objects.get(key)
        return len(entry[0]) if entry else None

    def get_bytes(self, key: str) -> bytes | None:
        entry = self.objects.get(key)
        return entry[0] if entry else None

    def list_prefixes(self, prefix: str) -> list[str]:
        found: set[str] = set()
        for key in self.objects:
            if key.startswith(prefix):
                head, sep, _ = key[len(prefix) :].partition("/")
                if sep:
                    found.add(f"{prefix}{head}/")
        return sorted(found)

    def list_keys(self, prefix: str) -> list[str]:
        return sorted(key for key in self.objects if key.startswith(prefix))

    def delete_key(self, key: str) -> bool:
        return self.objects.pop(key, None) is not None

    def delete_prefix(self, prefix: str) -> int:
        doomed = [key for key in self.objects if key.startswith(prefix)]
        for key in doomed:
            del self.objects[key]
        return len(doomed)


@dataclass(frozen=True, slots=True)
class DirectoryStore:
    """Mirror of the bucket layout on disk, for local development and end-to-end tests."""

    root: Path

    def _path(self, key: str) -> Path:
        target = (self.root / key).resolve()
        if not target.is_relative_to(self.root.resolve()):
            raise PublishError(f"Refusing to write outside {self.root}: {key}")
        return target

    def put_file(self, key: str, path: Path, meta: ObjectMeta) -> None:
        self.put_bytes(key, path.read_bytes(), meta)

    def put_bytes(self, key: str, data: bytes, meta: ObjectMeta) -> None:
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_name(f".{target.name}.part")
        part.write_bytes(data)
        part.replace(target)

    def size(self, key: str) -> int | None:
        target = self._path(key)
        return target.stat().st_size if target.is_file() else None

    def get_bytes(self, key: str) -> bytes | None:
        target = self._path(key)
        return target.read_bytes() if target.is_file() else None

    def list_prefixes(self, prefix: str) -> list[str]:
        base = self._path(prefix)
        if not base.is_dir():
            return []
        return sorted(f"{prefix}{child.name}/" for child in base.iterdir() if child.is_dir())

    def list_keys(self, prefix: str) -> list[str]:
        root = self.root.resolve()
        return sorted(
            key
            for path in root.rglob("*")
            if path.is_file() and not path.name.startswith(".")
            for key in [path.relative_to(root).as_posix()]
            if key.startswith(prefix)
        )

    def delete_key(self, key: str) -> bool:
        target = self._path(key)
        if not target.is_file():
            return False
        target.unlink()
        return True

    def delete_prefix(self, prefix: str) -> int:
        base = self._path(prefix)
        if not base.exists():
            return 0
        count = sum(1 for p in base.rglob("*") if p.is_file())
        shutil.rmtree(base)
        return count


class R2Store:
    """Cloudflare R2 through its S3-compatible API."""

    def __init__(self, client: S3Client, bucket: str, transfer: TransferConfig | None = None) -> None:
        self._client = client
        self._bucket = bucket
        self._transfer = transfer or TransferConfig(multipart_threshold=64 * 1024 * 1024)

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> R2Store:
        required = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
        missing = [name for name in required if not env.get(name)]
        if missing:
            raise PublishError(f"Missing environment variables: {', '.join(missing)}")
        client = boto3.client(
            "s3",
            endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=env["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
            config=r2_config(),
        )
        return cls(client, env["R2_BUCKET"])

    def put_file(self, key: str, path: Path, meta: ObjectMeta) -> None:
        self._client.upload_file(
            str(path),
            self._bucket,
            key,
            ExtraArgs={"ContentType": meta.content_type, "CacheControl": meta.cache_control},
            Config=self._transfer,
        )

    def put_bytes(self, key: str, data: bytes, meta: ObjectMeta) -> None:
        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=meta.content_type,
            CacheControl=meta.cache_control,
        )

    def size(self, key: str) -> int | None:
        try:
            return self._client.head_object(Bucket=self._bucket, Key=key)["ContentLength"]
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise

    def get_bytes(self, key: str) -> bytes | None:
        try:
            return self._client.get_object(Bucket=self._bucket, Key=key)["Body"].read()
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise

    def list_prefixes(self, prefix: str) -> list[str]:
        prefixes: list[str] = []
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix, Delimiter="/"):
            prefixes += [p["Prefix"] for p in page.get("CommonPrefixes", []) if "Prefix" in p]
        return sorted(prefixes)

    def list_keys(self, prefix: str) -> list[str]:
        keys: list[str] = []
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            keys += [obj["Key"] for obj in page.get("Contents", []) if "Key" in obj]
        return sorted(keys)

    def delete_key(self, key: str) -> bool:
        if self.size(key) is None:
            return False
        self._client.delete_object(Bucket=self._bucket, Key=key)
        return True

    def delete_prefix(self, prefix: str) -> int:
        deleted = 0
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            keys: list[ObjectIdentifierTypeDef] = [
                {"Key": obj["Key"]} for obj in page.get("Contents", []) if "Key" in obj
            ]
            if not keys:
                continue
            response = self._client.delete_objects(
                Bucket=self._bucket, Delete={"Objects": keys, "Quiet": True}
            )
            if response.get("Errors"):
                raise PublishError(f"Could not delete {len(response['Errors'])} objects under {prefix}")
            deleted += len(keys)
        return deleted


def r2_config() -> Config:
    # boto3 >= 1.36 sends extra checksum headers by default; Cloudflare recommends only sending them
    # when an operation requires it, which keeps uploads compatible with R2.
    return Config(
        signature_version="s3v4",
        retries={"max_attempts": 5, "mode": "standard"},
        request_checksum_calculation="when_required",
        response_checksum_validation="when_required",
    )


# ---------------------------------------------------------------- publishing


JSON = ObjectMeta("application/json; charset=utf-8", IMMUTABLE)
PMTILES = ObjectMeta("application/vnd.pmtiles", IMMUTABLE)
GZIP = ObjectMeta("application/gzip", IMMUTABLE)
POINTER = ObjectMeta("application/json; charset=utf-8", POINTER_CACHE)


@dataclass(frozen=True, slots=True)
class PublishResult:
    build_id: str
    uploaded: tuple[str, ...]
    pruned: tuple[str, ...]


def _gzip(source: Path, target: Path) -> Path:
    # mtime=0 keeps the archive byte-identical for identical input
    with source.open("rb") as src, gzip.GzipFile(target, "wb", mtime=0) as dst:
        shutil.copyfileobj(src, dst)
    return target


def pointer_document(
    build_id: str,
    manifest: Mapping[str, Any],
    tiles: Mapping[str, Any],
    optional: Iterable[str] = (),
    layers: Iterable[str] = CORE_LAYERS,
) -> dict[str, Any]:
    base = f"{BUILDS_PREFIX}{build_id}/"
    present = set(optional)
    present_layers = set(layers)
    return {
        "buildId": build_id,
        "createdAt": manifest["createdAt"],
        "counts": manifest["counts"],
        "attribution": manifest["attribution"],
        # builds from before multi-source support only had OpenStreetMap and Natural Earth
        "attributionSources": manifest.get("attributionSources", ["openstreetmap", "naturalearth"]),
        "license": manifest["license"],
        # optional archives (the distribution network) appear only in builds that have them
        "tiles": {
            archive.key: {
                "url": base + archive.file,
                "minZoom": tiles[archive.key]["min_zoom"],
                "maxZoom": tiles[archive.key]["max_zoom"],
                "bounds": tiles[archive.key]["bounds"],
            }
            for archive in ALL_ARCHIVES
            if archive.key in tiles
        },
        "manifest": base + "manifest.json",
        "search": base + "search.json",
        "stats": base + "stats.json",
        "downloads": {layer: f"{base}{layer}.ndjson.gz" for layer in LAYERS if layer in present_layers},
        **({"diff": base + "diff.json"} if "diff.json" in present else {}),
        **({"cities": base + "cities.json"} if "cities.json" in present else {}),
        **({"timeline": base + "timeline.json"} if "timeline.json" in present else {}),
        **({"plantGrid": base + "plantgrid.json"} if "plantgrid.json" in present else {}),
        **({"chargerGrid": base + "chargergrid.json"} if "chargergrid.json" in present else {}),
    }


def current_build_id(store: ObjectStore) -> str | None:
    raw = store.get_bytes(POINTER_KEY)
    if raw is None:
        return None
    build_id = json.loads(raw)["buildId"]
    return str(build_id)


def publish_build(store: ObjectStore, build_dir: Path, *, keep: int = DEFAULT_KEEP) -> PublishResult:
    if keep < 2:
        raise PublishError("keep must be at least 2 so the previous build stays available for rollback")
    build_id = build_dir.name
    tiles_path = build_dir / TILES_INFO_FILE
    tiles_info = read_json(tiles_path) if tiles_path.exists() else {}
    # An optional archive (the distribution network) is required only once the build says it has one,
    # so a build made before that archive existed stays publishable — that is what rollback needs.
    archives = [a for a in ALL_ARCHIVES if a in ARCHIVES or a.key in tiles_info]
    required = [build_dir / "manifest.json", tiles_path]
    required += [build_dir / archive.file for archive in archives]
    required += [build_dir / f"{layer}.ndjson" for layer in CORE_LAYERS]
    required += [build_dir / name for name in PRODUCTS]
    missing = [p.name for p in required if not p.exists()]
    if missing:
        raise PublishError(f"Build {build_id} is incomplete, missing: {', '.join(missing)}")

    manifest = read_json(build_dir / "manifest.json")
    base = f"{BUILDS_PREFIX}{build_id}/"

    uploads: list[tuple[str, Path, ObjectMeta]] = [
        *[(base + archive.file, build_dir / archive.file, PMTILES) for archive in archives],
        (base + "manifest.json", build_dir / "manifest.json", JSON),
        (base + TILES_INFO_FILE, build_dir / TILES_INFO_FILE, JSON),
        *[(base + name, build_dir / name, JSON) for name in PRODUCTS],
    ]
    optional = [name for name in OPTIONAL_PRODUCTS if (build_dir / name).exists()]
    uploads += [(base + name, build_dir / name, JSON) for name in optional]
    layers = [layer for layer in LAYERS if (build_dir / f"{layer}.ndjson").exists()]
    try:
        with tempfile.TemporaryDirectory(prefix="energymap-publish-") as tmp:
            for layer in layers:
                packed = _gzip(build_dir / f"{layer}.ndjson", Path(tmp) / f"{layer}.ndjson.gz")
                uploads.append((f"{base}{layer}.ndjson.gz", packed, GZIP))
            for key, path, meta in uploads:
                store.put_file(key, path, meta)
                remote, local = store.size(key), path.stat().st_size
                if remote != local:
                    raise PublishError(f"Upload of {key} is incomplete: {remote} of {local} bytes")
                log.info("uploaded", extra={"key": key, "bytes": local})

        pointer = json.dumps(
            pointer_document(build_id, manifest, tiles_info, optional, layers), indent=2
        ).encode()
        store.put_bytes(POINTER_KEY, pointer, POINTER)
    except (BotoCoreError, ClientError, OSError) as exc:
        raise PublishError(f"Publishing {build_id} failed: {exc}") from exc

    pruned = prune(store, keep=keep, protect={build_id})
    log.info("published", extra={"build": build_id, "pruned": list(pruned)})
    return PublishResult(build_id, (*(k for k, _, _ in uploads), POINTER_KEY), pruned)


def prune(store: ObjectStore, *, keep: int, protect: Iterable[str]) -> tuple[str, ...]:
    """Delete all but the newest ``keep`` builds. Build ids are UTC timestamps, so they sort in time order."""
    protected = {f"{BUILDS_PREFIX}{b}/" for b in protect}
    current = current_build_id(store)
    if current:
        protected.add(f"{BUILDS_PREFIX}{current}/")
    prefixes = store.list_prefixes(BUILDS_PREFIX)
    doomed = [p for p in prefixes[:-keep] if p not in protected] if len(prefixes) > keep else []
    for prefix in doomed:
        count = store.delete_prefix(prefix)
        log.info("pruned build", extra={"prefix": prefix, "objects": count})
    return tuple(doomed)
