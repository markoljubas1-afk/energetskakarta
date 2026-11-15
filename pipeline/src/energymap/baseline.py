"""What is published right now, read the way a visitor would: over public HTTPS.

Scheduled builds run on fresh machines with no local history, so the "no large drop" gate and the change
report compare against the published build instead. A missing pointer (HTTP 404) means nothing was ever
published; every other failure is an error, so an unreachable bucket can never switch the gate off.
"""

from __future__ import annotations

import gzip
import json
import tempfile
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

from energymap.tiles import CORE_LAYERS, OPTIONAL_LAYERS

POINTER = "current.json"
_CHUNK = 1024 * 1024


class BaselineError(RuntimeError):
    """The published build could not be read or is malformed."""


@dataclass(frozen=True, slots=True)
class Published:
    base_url: str
    build_id: str
    counts: Mapping[str, int]
    downloads: Mapping[str, str]

    def url(self, key: str) -> str:
        return urljoin(self.base_url, key)


def _base(url: str) -> str:
    if not url.startswith(("https://", "http://")):
        raise BaselineError(f"Baseline URL must be absolute http(s): {url!r}")
    return url if url.endswith("/") else f"{url}/"


def _relative_key(value: Any, what: str) -> str:
    if not isinstance(value, str) or not value or value.startswith("/") or "://" in value or ".." in value:
        raise BaselineError(f"Published pointer has an invalid {what}: {value!r}")
    return value


def parse_pointer(base_url: str, data: Any) -> Published:
    if not isinstance(data, dict):
        raise BaselineError("Published pointer is not a JSON object")
    build_id = data.get("buildId")
    counts = data.get("counts")
    downloads = data.get("downloads")
    if not isinstance(build_id, str) or not build_id:
        raise BaselineError("Published pointer has no buildId")
    if not isinstance(counts, dict) or not all(
        isinstance(k, str) and isinstance(v, int) and not isinstance(v, bool) for k, v in counts.items()
    ):
        raise BaselineError("Published pointer has invalid counts")
    if not isinstance(downloads, dict) or set(CORE_LAYERS) - set(downloads):
        raise BaselineError(f"Published pointer must list downloads for {', '.join(CORE_LAYERS)}")
    return Published(
        base_url=base_url,
        build_id=build_id,
        counts=dict(counts),
        downloads={
            layer: _relative_key(downloads[layer], f"download for {layer}")
            for layer in (*CORE_LAYERS, *OPTIONAL_LAYERS)
            if layer in downloads
        },
    )


def fetch_published(client: httpx.Client, base_url: str) -> Published | None:
    """The published build, or None if nothing has been published yet."""
    base = _base(base_url)
    url = urljoin(base, POINTER)
    try:
        # the pointer is cached for a minute at the edge; ask for a fresh copy
        response = client.get(url, headers={"Cache-Control": "no-cache"})
    except httpx.HTTPError as exc:
        raise BaselineError(f"Cannot reach {url}: {exc}") from exc
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise BaselineError(f"{url} returned HTTP {response.status_code}")
    try:
        data = response.json()
    except ValueError as exc:
        raise BaselineError(f"{url} is not valid JSON") from exc
    return parse_pointer(base, data)


def iter_layer(client: httpx.Client, published: Published, layer: str) -> Iterator[dict[str, Any]]:
    """Features of one published layer (gzip NDJSON), streamed through a temporary file."""
    url = published.url(published.downloads[layer])
    with tempfile.TemporaryFile() as buffer:
        try:
            with client.stream("GET", url) as response:
                if response.status_code != 200:
                    raise BaselineError(f"{url} returned HTTP {response.status_code}")
                for chunk in response.iter_bytes(_CHUNK):
                    buffer.write(chunk)
        except httpx.HTTPError as exc:
            raise BaselineError(f"Cannot download {url}: {exc}") from exc
        buffer.seek(0)
        line_no = 0
        try:
            with gzip.open(buffer, "rt", encoding="utf-8") as lines:
                for line in lines:
                    line_no += 1
                    if line.strip():
                        yield json.loads(line)
        except (OSError, json.JSONDecodeError) as exc:
            raise BaselineError(f"{url} is not valid gzip NDJSON (line {line_no}): {exc}") from exc


def iter_local_layer(build_dir: Path, layer: str) -> Iterator[dict[str, Any]]:
    with (build_dir / f"{layer}.ndjson").open(encoding="utf-8") as lines:
        for line in lines:
            if line.strip():
                yield json.loads(line)
