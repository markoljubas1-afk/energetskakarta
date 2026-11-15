"""Publish daily energy files to the data bucket, and pull them back on a fresh machine.

    energy/daily/<year>-<sha12>.json    immutable, content-addressed
    energy/periods-<sha12>.json         immutable, months and years derived from the daily files
    energy/current.json                 pointer, written last
    energy/previous.json                the pointer before the last publication (kept for rollback)

A publication is rejected when a country covers fewer days in a year than the published data did, which
is how a broken fetch or a lost file would show up.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

from energymap.entsoe.energy import TIMEZONE
from energymap.entsoe.store import UNIT, YearFile, periods
from energymap.files import read_json, write_json_atomic
from energymap.publish import IMMUTABLE, POINTER_CACHE, ObjectMeta, ObjectStore, PublishError
from energymap.validate import BuildValidationError

log = logging.getLogger(__name__)

PREFIX = "energy/"
POINTER = PREFIX + "current.json"
PREVIOUS = PREFIX + "previous.json"
VERSION = 1
JSON_META = ObjectMeta("application/json; charset=utf-8", IMMUTABLE)
POINTER_META = ObjectMeta("application/json; charset=utf-8", POINTER_CACHE)
_KEY = re.compile(r"^energy/(daily/\d{4}|periods)-[0-9a-f]{12}\.json$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class EnergyReleaseError(RuntimeError):
    """The published energy data could not be read or verified."""


def canonical(data: Any) -> bytes:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


@dataclass(frozen=True, slots=True)
class Blob:
    key: str
    sha256: str
    bytes: int

    def to_json(self) -> dict[str, Any]:
        return {"key": self.key, "sha256": self.sha256, "bytes": self.bytes}


def blob(name: str, content: bytes) -> Blob:
    digest = hashlib.sha256(content).hexdigest()
    return Blob(f"{PREFIX}{name}-{digest[:12]}.json", digest, len(content))


def covered_days(year: YearFile) -> dict[str, dict[str, int]]:
    return {
        code: {
            "generation": sum(1 for v in c.generation_coverage if v > 0),
            "load": sum(1 for v in c.load_coverage if v > 0),
        }
        for code, c in sorted(year.countries.items())
    }


def local_years(root: Path) -> list[YearFile]:
    directory = root / "daily"
    files = sorted(directory.glob("*.json")) if directory.exists() else []
    return [YearFile.from_json(read_json(path)) for path in files]


def check_coverage(new: Mapping[str, Any], old: Mapping[str, Any] | None) -> list[str]:
    if old is None:
        return []
    problems = []
    for year, entry in old.get("years", {}).items():
        current = new["years"].get(year)
        if current is None:
            problems.append(f"year {year} disappeared")
            continue
        for code, kinds in entry.get("coveredDays", {}).items():
            for kind, before in kinds.items():
                now = current["coveredDays"].get(code, {}).get(kind, 0)
                if now < before:
                    problems.append(f"{code} {year} {kind}: covered days dropped from {before} to {now}")
    return problems


def release(store: ObjectStore, root: Path, now: datetime, *, allow_drop: bool = False) -> dict[str, Any]:
    years = local_years(root)
    if not years:
        raise BuildValidationError(
            [f"no daily energy files in {root / 'daily'}; run `energymap energy fetch`"]
        )
    derived = periods(years)
    write_json_atomic(root / "periods.json", derived)

    uploads: list[tuple[Blob, bytes]] = []
    entries: dict[str, Any] = {}
    for year in years:
        content = canonical(year.to_json())
        item = blob(f"daily/{year.year}", content)
        uploads.append((item, content))
        entries[str(year.year)] = {**item.to_json(), "coveredDays": covered_days(year)}
    periods_content = canonical(derived)
    periods_blob = blob("periods", periods_content)
    uploads.append((periods_blob, periods_content))

    pointer = {
        "version": VERSION,
        "updatedAt": now.isoformat(),
        "unit": UNIT,
        "timezone": str(TIMEZONE),
        "countries": sorted({code for y in years for code in y.countries}),
        "years": entries,
        "periods": periods_blob.to_json(),
    }
    old_raw = store.get_bytes(POINTER)
    old = json.loads(old_raw) if old_raw else None
    problems = check_coverage(pointer, old)
    if problems and not allow_drop:
        raise BuildValidationError(problems)

    for item, content in uploads:
        if store.size(item.key) == item.bytes:
            continue  # content-addressed: same key means same content
        store.put_bytes(item.key, content, JSON_META)
        if store.size(item.key) != item.bytes:
            raise PublishError(f"Upload of {item.key} is incomplete")
        log.info("uploaded energy file", extra={"key": item.key, "bytes": item.bytes})

    if old_raw:
        store.put_bytes(PREVIOUS, old_raw, POINTER_META)
    store.put_bytes(POINTER, json.dumps(pointer, indent=2).encode(), POINTER_META)

    keep = _referenced(pointer) | (_referenced(old) if old else set())
    for key in store.list_keys(PREFIX):
        if _KEY.match(key) and key not in keep:
            store.delete_key(key)
            log.info("pruned energy file", extra={"key": key})
    return pointer


def _referenced(pointer: Mapping[str, Any]) -> set[str]:
    keys = {entry["key"] for entry in pointer.get("years", {}).values()}
    if "periods" in pointer:
        keys.add(pointer["periods"]["key"])
    return keys


# ---------------------------------------------------------------- pull


def _entry(raw: Any, what: str) -> Blob:
    if not isinstance(raw, dict):
        raise EnergyReleaseError(f"{what}: not an object")
    key, digest, size = raw.get("key"), raw.get("sha256"), raw.get("bytes")
    if not (isinstance(key, str) and _KEY.match(key)):
        raise EnergyReleaseError(f"{what}: invalid key {key!r}")
    if not (isinstance(digest, str) and _SHA256.match(digest)):
        raise EnergyReleaseError(f"{what}: invalid sha256")
    if not (isinstance(size, int) and not isinstance(size, bool) and size > 0):
        raise EnergyReleaseError(f"{what}: invalid size")
    return Blob(key, digest, size)


def pull(client: httpx.Client, base_url: str, root: Path) -> list[int]:
    """Download the published yearly files into ``root/daily``. Existing local files are left alone."""
    if not base_url.startswith(("https://", "http://")):
        raise EnergyReleaseError(f"Base URL must be absolute http(s): {base_url!r}")
    base = base_url if base_url.endswith("/") else f"{base_url}/"
    try:
        response = client.get(urljoin(base, POINTER), headers={"Cache-Control": "no-cache"})
    except httpx.HTTPError as exc:
        raise EnergyReleaseError(f"Cannot reach {base}{POINTER}: {exc}") from exc
    if response.status_code == 404:
        log.warning("no published energy data; starting empty", extra={"url": base})
        return []
    if response.status_code != 200:
        raise EnergyReleaseError(f"{base}{POINTER} returned HTTP {response.status_code}")
    try:
        pointer = response.json()
    except ValueError as exc:
        raise EnergyReleaseError("energy pointer is not valid JSON") from exc
    if not isinstance(pointer, dict) or pointer.get("version") != VERSION:
        raise EnergyReleaseError("unsupported energy pointer")

    pulled = []
    for year_text, raw in sorted((pointer.get("years") or {}).items()):
        if not re.fullmatch(r"\d{4}", str(year_text)):
            raise EnergyReleaseError(f"invalid year {year_text!r}")
        item = _entry(raw, f"year {year_text}")
        target = root / "daily" / f"{year_text}.json"
        if target.exists():
            continue
        try:
            content = client.get(urljoin(base, item.key)).raise_for_status().content
        except httpx.HTTPError as exc:
            raise EnergyReleaseError(f"Cannot download {item.key}: {exc}") from exc
        if hashlib.sha256(content).hexdigest() != item.sha256:
            raise EnergyReleaseError(f"Checksum mismatch for {item.key}")
        year = YearFile.from_json(json.loads(content))
        if year.year != int(year_text):
            raise EnergyReleaseError(f"{item.key} contains year {year.year}, not {year_text}")
        write_json_atomic(target, year.to_json())
        pulled.append(year.year)
    log.info("pulled energy years", extra={"years": pulled})
    return pulled
