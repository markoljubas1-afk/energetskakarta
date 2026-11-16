"""Fetches the Global Solar Atlas rasters, one archive per country (see potential.py for what is in them).

The atlas's own download page works like this (read from its script on 2026-11-16): a list of a place's
files comes from ``https://api.globalsolaratlas.info/download/<place>``, and a file from
``.../download/<place>/<name>``, which answers with a redirect to a signed address in the World Bank's
storage. A place is named as on the page ("Bosnia and Herzegovina", with spaces).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from energymap.solar.potential import SolarDataError

log = logging.getLogger(__name__)

API = "https://api.globalsolaratlas.info/download/"
#: the map's countries, as the atlas names them
PLACES: tuple[str, ...] = (
    "Austria",
    "Bosnia and Herzegovina",
    "Croatia",
    "Hungary",
    "Italy",
    "Montenegro",
    "Serbia",
    "Slovenia",
)
#: the archive with the yearly and monthly totals as GeoTIFF; the yearly PVOUT is taken from it
WANTED = "_GISdata_LTAym_YearlyMonthlyTotals_GlobalSolarAtlas-v2_GEOTIFF.zip"
_CHUNK = 1 << 20


def _files(client: httpx.Client, place: str) -> list[dict[str, Any]]:
    url = API + quote(place)
    try:
        response = client.get(url, params={"multilang": "true"})
    except httpx.HTTPError as exc:
        raise SolarDataError(f"{url} unreachable: {type(exc).__name__}") from exc
    if response.status_code != 200:
        raise SolarDataError(f"{url} returned HTTP {response.status_code}")
    listing = response.json()
    if not isinstance(listing, list):
        raise SolarDataError(f"{url} did not answer with a list of files")
    return [entry for entry in listing if isinstance(entry, dict)]


def fetch(client: httpx.Client, target: Path) -> list[Path]:
    """Every place's archive in ``target``; one already there with the listed size is not fetched again."""
    target.mkdir(parents=True, exist_ok=True)
    paths = []
    for place in PLACES:
        wanted = [entry for entry in _files(client, place) if str(entry.get("name", "")).endswith(WANTED)]
        if len(wanted) != 1:
            raise SolarDataError(f"{place}: expected one file ending in {WANTED}, found {len(wanted)}")
        name, size = str(wanted[0]["name"]), int(wanted[0].get("size") or 0)
        if "/" in name or "\\" in name:
            raise SolarDataError(f"{place}: unexpected file name {name!r}")
        path = target / name
        if not (path.exists() and path.stat().st_size == size):
            partial = path.with_suffix(".part")
            url = f"{API}{quote(place)}/{quote(name)}"
            try:
                with client.stream("GET", url, follow_redirects=True) as response:
                    if response.status_code != 200:
                        raise SolarDataError(f"{url} returned HTTP {response.status_code}")
                    with partial.open("wb") as handle:
                        for chunk in response.iter_bytes(_CHUNK):
                            handle.write(chunk)
            except httpx.HTTPError as exc:
                raise SolarDataError(f"{url}: download failed ({type(exc).__name__})") from exc
            if size and partial.stat().st_size != size:
                raise SolarDataError(f"{name}: got {partial.stat().st_size} bytes, the list says {size}")
            partial.replace(path)
            log.info("fetched solar raster", extra={"solar": {"place": place, "bytes": path.stat().st_size}})
        paths.append(path)
    return paths
