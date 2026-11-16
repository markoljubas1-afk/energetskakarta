"""Photographs of plants, from Wikimedia Commons, kept in our own bucket.

OpenStreetMap carries a Wikidata id for some plants. Wikidata names a Commons image for some of those
(property P18). For each such image a reduced copy is stored in the bucket together with who made it and
under which licence, so the map can show a plant's photograph without sending the visitor's browser to
Wikimedia (decision 2026-11-16).

Verified against the live APIs on 2026-11-16:

* ``wikidata.org/w/api.php?action=wbgetentities&props=claims&ids=Q1|Q2`` (50 ids a request): each entity
  has ``claims.P18``, a list of statements with ``rank`` and ``mainsnak.datavalue.value`` (the file name,
  with spaces).
* ``commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&titles=File:A|File:B&iiurlwidth=640``
  with ``formatversion=2``: ``query.pages`` is a list; a page has ``missing`` or ``imageinfo[0]`` with
  ``mime``, ``timestamp``, ``thumburl``, ``thumbwidth``, ``thumbheight``, ``descriptionurl`` and
  ``extmetadata`` (``Artist`` and ``Credit`` are HTML, ``LicenseShortName``, ``LicenseUrl``).
  ``query.normalized`` maps a title as asked to the title as answered.

Nothing here is needed for a build: the index is its own small document, updated on its own schedule, and
a failure leaves the published one as it was.
"""

from __future__ import annotations

import hashlib
import html
import json
import logging
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

from energymap.publish import IMMUTABLE, ObjectMeta, ObjectStore

log = logging.getLogger(__name__)

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
IMAGE_PROPERTY = "P18"
#: both APIs take at most 50 ids or titles a request without a bot account
BATCH = 50
#: wide enough for the details panel on a dense screen, small enough to be a few dozen kilobytes
THUMB_WIDTH = 640
VERSION = 1
PREFIX = "images/"
INDEX_KEY = PREFIX + "index.json"
# A photograph changes rarely; the index is re-read once an hour at most.
INDEX_META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")
#: what a browser shows as a photograph; anything else on Commons (SVG, PDF, video) is not one
_EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
_QID = re.compile(r"^Q[1-9]\d*$")
_TAG = re.compile(r"<[^>]+>")
#: the published index never loses more than this share of its photographs in one update
MAX_DROP = 0.2


class ImagesError(RuntimeError):
    """Wikimedia answered with something other than what is documented above, or the update would drop
    too much; the published index stays as it was."""


@dataclass(frozen=True, slots=True)
class Photo:
    file: str
    thumb_url: str
    width: int
    height: int
    mime: str
    #: when this version of the file was uploaded; a new version gets a new copy
    timestamp: str
    page_url: str
    author: str
    license: str
    license_url: str | None


def user_agent(contact: str | None) -> str:
    """Wikimedia asks every client to say who it is and where to reach its operator."""
    return f"energymap-images/1.0 ({contact})" if contact else "energymap-images/1.0"


def plain(markup: Any, limit: int = 120) -> str:
    """Commons' ``Artist`` is HTML (a link to a user page, sometimes a table); the map shows plain text."""
    text = re.sub(r"\s+", " ", html.unescape(_TAG.sub(" ", str(markup or "")))).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _get(client: httpx.Client, url: str, params: Mapping[str, str]) -> dict[str, Any]:
    try:
        response = client.get(url, params={**params, "format": "json"})
    except httpx.HTTPError as exc:
        raise ImagesError(f"{url} unreachable: {type(exc).__name__}") from exc
    if response.status_code != 200:
        raise ImagesError(f"{url} returned HTTP {response.status_code}")
    try:
        document = response.json()
    except json.JSONDecodeError as exc:
        raise ImagesError(f"{url} did not answer with JSON") from exc
    if not isinstance(document, dict) or "error" in document:
        raise ImagesError(f"{url} answered with an error: {str(document)[:200]}")
    return document


def _batches(values: Sequence[str]) -> Iterable[Sequence[str]]:
    for start in range(0, len(values), BATCH):
        yield values[start : start + BATCH]


def image_files(client: httpx.Client, qids: Iterable[str]) -> dict[str, str]:
    """Wikidata id → Commons file name, for the ids that have an image. A preferred statement wins over
    a normal one; deprecated statements are not used."""
    wanted = sorted({qid for qid in qids if _QID.match(qid)})
    found: dict[str, str] = {}
    for batch in _batches(wanted):
        document = _get(
            client, WIKIDATA_API, {"action": "wbgetentities", "props": "claims", "ids": "|".join(batch)}
        )
        entities = document.get("entities")
        if not isinstance(entities, dict):
            raise ImagesError("Wikidata answered without 'entities'")
        for qid, entity in entities.items():
            statements = (
                (entity.get("claims") or {}).get(IMAGE_PROPERTY) if isinstance(entity, dict) else None
            )
            ranked: dict[str, str] = {}
            for statement in statements or []:
                value = ((statement.get("mainsnak") or {}).get("datavalue") or {}).get("value")
                if isinstance(value, str) and value.strip():
                    ranked.setdefault(str(statement.get("rank")), value.strip())
            file = ranked.get("preferred") or ranked.get("normal")
            if file:
                found[qid] = file
    return found


def photos(client: httpx.Client, files: Iterable[str]) -> dict[str, Photo]:
    """Commons file name → what is needed to copy and credit it. Files that are missing, are not a
    photograph a browser shows, or state no licence are left out: an image without a licence is not ours
    to copy."""
    wanted = sorted(set(files))
    found: dict[str, Photo] = {}
    for batch in _batches(wanted):
        document = _get(
            client,
            COMMONS_API,
            {
                "action": "query",
                "formatversion": "2",
                "prop": "imageinfo",
                "titles": "|".join(f"File:{file}" for file in batch),
                "iiprop": "url|size|mime|timestamp|extmetadata",
                "iiurlwidth": str(THUMB_WIDTH),
                "iiextmetadatafilter": "Artist|Credit|LicenseShortName|LicenseUrl",
            },
        )
        query = document.get("query")
        if not isinstance(query, dict) or not isinstance(query.get("pages"), list):
            raise ImagesError("Commons answered without 'query.pages'")
        asked = {f"File:{file}": file for file in batch}
        # Commons answers under its own spelling of a title (underscores, first letter); follow it back
        for step in query.get("normalized") or []:
            if isinstance(step, dict) and step.get("from") in asked:
                asked[str(step.get("to"))] = asked[str(step.get("from"))]
        for page in query["pages"]:
            file = asked.get(str(page.get("title")))
            info = (page.get("imageinfo") or [None])[0] if isinstance(page, dict) else None
            if file is None or not isinstance(info, dict) or page.get("missing"):
                continue
            meta = info.get("extmetadata") or {}

            def value(key: str, meta: Mapping[str, Any] = meta) -> Any:
                return (meta.get(key) or {}).get("value")

            licence = plain(value("LicenseShortName"))
            mime = str(info.get("mime") or "")
            thumb = info.get("thumburl")
            if not licence or mime not in _EXTENSIONS or not isinstance(thumb, str):
                continue
            found[file] = Photo(
                file=file,
                thumb_url=thumb,
                width=int(info.get("thumbwidth") or 0),
                height=int(info.get("thumbheight") or 0),
                mime=mime,
                timestamp=str(info.get("timestamp") or ""),
                page_url=str(info.get("descriptionurl") or ""),
                author=plain(value("Artist")) or plain(value("Credit")),
                license=licence,
                license_url=str(value("LicenseUrl")) if value("LicenseUrl") else None,
            )
    return found


def copy_key(photo: Photo) -> str:
    """Where the copy lives. The name follows the file, its version and the width, so an unchanged
    photograph is never fetched twice and a new version never overwrites an old address."""
    digest = hashlib.sha256(f"{photo.file}|{photo.timestamp}|{THUMB_WIDTH}".encode()).hexdigest()[:20]
    return f"{PREFIX}{digest}.{_EXTENSIONS[photo.mime]}"


def _previous(store: ObjectStore) -> dict[str, Any]:
    raw = store.get_bytes(INDEX_KEY)
    if raw is None:
        return {}
    try:
        document = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ImagesError(f"{INDEX_KEY} in the bucket is not JSON") from exc
    images = document.get("images") if isinstance(document, dict) else None
    return images if isinstance(images, dict) else {}


def update(
    store: ObjectStore,
    assets: Mapping[str, str],
    client: httpx.Client,
    now: datetime,
    *,
    allow_drop: bool = False,
) -> dict[str, Any]:
    """Copy the photographs of ``assets`` (asset id → Wikidata id) into ``store`` and publish their index.

    Copies are uploaded first and the index last, so the index never names a copy that is not there.
    """
    files = image_files(client, assets.values())
    found = photos(client, files.values())
    images: dict[str, dict[str, Any]] = {}
    copied = 0
    for asset_id, qid in sorted(assets.items()):
        photo = found.get(files.get(qid, ""))
        if photo is None:
            continue
        key = copy_key(photo)
        if store.size(key) is None:
            try:
                response = client.get(photo.thumb_url)
            except httpx.HTTPError as exc:
                raise ImagesError(f"{photo.file}: copy failed ({type(exc).__name__})") from exc
            if response.status_code != 200 or not response.content:
                raise ImagesError(f"{photo.file}: copy returned HTTP {response.status_code}")
            store.put_bytes(key, response.content, ObjectMeta(photo.mime, IMMUTABLE))
            copied += 1
        images[asset_id] = {
            "key": key,
            "width": photo.width,
            "height": photo.height,
            "author": photo.author,
            "license": photo.license,
            "licenseUrl": photo.license_url,
            "page": photo.page_url,
        }
    before = len(_previous(store))
    if not allow_drop and before > 0 and len(images) < before * (1 - MAX_DROP):
        raise ImagesError(
            f"the update has {len(images)} photographs, the published index {before}; "
            "keeping the published one"
        )
    document = {
        "version": VERSION,
        "generatedAt": now.isoformat(),
        "source": "Wikimedia Commons",
        "width": THUMB_WIDTH,
        "images": images,
    }
    store.put_bytes(INDEX_KEY, json.dumps(document, separators=(",", ":")).encode(), INDEX_META)
    log.info(
        "published photographs",
        extra={
            "images": {
                "assets": len(assets),
                "withImage": len(files),
                "published": len(images),
                "copied": copied,
            }
        },
    )
    return document
