"""Gas in storage, from GIE's AGSI platform (Aggregated Gas Storage Inventory).

AGSI publishes, per storage facility, operator and country, how much gas is in storage at the end of a gas
day, how full that is, and what was injected and withdrawn (user manual "API access to AGSI / ALSI", v007).
Its data may be used and repackaged freely, on one condition: GIE is named as the source wherever the data
is shown (same manual, "API data usage").

The manual documents the answer's fields and the listing of datasets, but not the query that selects one
country or facility: the listing itself carries, for every dataset, the address to ask. ``survey`` asks the
listing what exists for the countries of the map and reads one day of each dataset (it publishes nothing);
``collect`` reads the last days of every storage facility into the document the map shows, in the shape
the first live survey returned on 2026-11-17 (figures as strings, ``-`` for none, the facility's own
coordinates). The key comes from the environment (``AGSI_API_KEY``) and is never written anywhere.
"""

from __future__ import annotations

import json
import logging
import math
import os
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from urllib.parse import urljoin

import httpx

from energymap.config import REGION_BBOX
from energymap.publish import ObjectMeta, ObjectStore

log = logging.getLogger("energymap")

BASE_URL = "https://agsi.gie.eu/api"
LISTING_URL = f"{BASE_URL}/about"
KEY_ENV = "AGSI_API_KEY"
SOURCE = "GIE AGSI"
ATTRIBUTION = "GIE (Gas Infrastructure Europe), AGSI platform"
SOURCE_URL = "https://agsi.gie.eu/"
#: not an open licence: free use and repackaging on condition that GIE is named as the source (manual v007)
LICENSE = "GIE-AGSI-attribution"
VERSION = 1
DEFAULT_DAYS = 30
MAX_DAYS = 120
#: a facility whose latest figure is older than this many days is not shown as current
FRESH_DAYS = 7
#: how full a store can be reported: a little over its declared working volume happens
MAX_FULL = 120.0
STORAGE_KEY = "live/gasstorage.json"
STORAGE_META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")
#: a day's figures in the document, with the platform's names and units (TWh, %, GWh/d)
SERIES: tuple[tuple[str, str], ...] = (
    ("fullPercent", "full"),
    ("inStorageTwh", "gasInStorage"),
    ("injectionGwhPerDay", "injection"),
    ("withdrawalGwhPerDay", "withdrawal"),
)
#: the fields of a day's row that the survey shows (manual, 2.3); the units are the platform's
SHOWN = (
    "gasDayStart",
    "gasInStorage",
    "full",
    "trend",
    "injection",
    "withdrawal",
    "workingGasVolume",
    "status",
)


class AgsiError(RuntimeError):
    """AGSI could not be read: no key, a refusal, or an answer that is not what the manual describes."""


class StorageDataError(ValueError):
    """The storage document is not publishable."""


def api_key() -> str:
    key = os.environ.get(KEY_ENV, "").strip()
    if not key:
        raise AgsiError(f"{KEY_ENV} is not set: AGSI answers only with a personal key (agsi.gie.eu/account)")
    return key


def _get(client: httpx.Client, url: str, key: str, params: dict[str, str | int] | None = None) -> Any:
    # the listing's addresses carry their own query, which httpx would replace with `params`: merge the two
    response = client.get(httpx.URL(url).copy_merge_params(params or {}), headers={"x-key": key})
    if response.status_code != 200:
        raise AgsiError(f"{url}: HTTP {response.status_code}")
    try:
        return response.json()
    except json.JSONDecodeError as exc:
        raise AgsiError(f"{url}: not JSON ({exc})") from exc


def _text(row: dict[str, Any], name: str) -> str:
    value = row.get(name)
    return value.strip() if isinstance(value, str) else ""


@dataclass(frozen=True, slots=True, order=True)
class Dataset:
    """One thing AGSI reports on: an operator's whole storage, or one of its facilities."""

    country: str
    company: str
    company_eic: str
    #: empty for the operator's own (aggregated) dataset
    facility: str
    facility_eic: str
    kind: str
    #: the address the listing gives for this dataset's data; empty when the listing has none
    url: str


def _companies(node: Any) -> list[dict[str, Any]]:
    """Every company in the listing, wherever it sits: the manual names its fields, not its nesting."""
    if isinstance(node, list):
        return [company for item in node for company in _companies(item)]
    if not isinstance(node, dict):
        return []
    if isinstance(node.get("facilities"), list) and "eic" in node:
        return [node]
    return [company for value in node.values() for company in _companies(value)]


def datasets(listing: Any, scope: frozenset[str]) -> list[Dataset]:
    """The storage datasets of the countries in ``scope``: each operator and each of its facilities."""
    found: set[Dataset] = set()
    for company in _companies(listing):
        if _text(company, "type").upper() not in ("SSO", ""):
            continue  # LNG terminals and transmission operators are not storage
        name = _text(company, "short_name") or _text(company, "name")
        country = _text(company, "country").upper()
        if country in scope:
            found.add(Dataset(country, name, _text(company, "eic"), "", "", "company", _text(company, "url")))
        for facility in company["facilities"]:
            if not isinstance(facility, dict):
                continue
            where = _text(facility, "country").upper() or country
            if where not in scope:
                continue
            found.add(
                Dataset(
                    where,
                    name,
                    _text(company, "eic"),
                    _text(facility, "name"),
                    _text(facility, "eic"),
                    _text(facility, "type") or "facility",
                    _text(facility, "url"),
                )
            )
    return sorted(found)


def latest_row(client: httpx.Client, key: str, url: str) -> tuple[dict[str, Any], list[str]]:
    """The first day's row of a dataset and the names of the answer's top-level fields."""
    answer = _get(client, urljoin(BASE_URL, url), key, {"size": 1})
    rows = answer.get("data") if isinstance(answer, dict) else None
    if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
        shape = sorted(answer) if isinstance(answer, dict) else type(answer).__name__
        raise AgsiError(f"{url}: no 'data' rows in the answer ({shape})")
    return rows[0], sorted(answer)


def survey(client: httpx.Client, now: datetime, scope: frozenset[str]) -> dict[str, Any]:
    """What AGSI has for the countries in ``scope``, with one day's figures of each dataset."""
    key = api_key()
    listing = _get(client, LISTING_URL, key, {"show": "listing"})
    found = datasets(listing, scope)
    if not found:
        raise AgsiError(
            f"the listing has no storage for {', '.join(sorted(scope))}: empty, or its shape changed"
        )
    row_fields: set[str] = set()
    answer_fields: set[str] = set()
    entries: list[dict[str, Any]] = []
    for dataset in found:
        entry: dict[str, Any] = {
            "country": dataset.country,
            "company": dataset.company,
            "companyEic": dataset.company_eic,
            "facility": dataset.facility,
            "facilityEic": dataset.facility_eic,
            "kind": dataset.kind,
            "url": dataset.url,
            "latest": None,
            "error": None,
        }
        # one dataset that fails is noted and the survey goes on (L-058)
        try:
            if not dataset.url:
                raise AgsiError("the listing gives no address for this dataset")
            row, top = latest_row(client, key, dataset.url)
            row_fields.update(row)
            answer_fields.update(top)
            entry["latest"] = {name: row.get(name) for name in SHOWN}
        except AgsiError as exc:
            log.warning("AGSI dataset unavailable", extra={"dataset": dataset.url, "error": str(exc)})
            entry["error"] = str(exc)[:200]
        entries.append(entry)
    log.info(
        "surveyed gas storage",
        extra={"datasets": len(entries), "with_data": sum(1 for e in entries if e["latest"] is not None)},
    )
    return {
        "generatedAt": now.isoformat(),
        "source": SOURCE,
        "attribution": ATTRIBUTION,
        "listingShape": type(listing).__name__
        + (": " + ", ".join(sorted(map(str, listing))[:12]) if isinstance(listing, dict) else ""),
        "answerFields": sorted(answer_fields),
        "rowFields": sorted(row_fields),
        "datasets": entries,
    }


def markdown(document: dict[str, Any]) -> str:
    """The survey as a table for the job summary."""
    lines = [
        "## Skladišta plina na AGSI-ju (pregled prije izrade sloja)",
        "",
        f"Izvor: {document['attribution']}. Oblik popisa: `{document['listingShape']}`.",
        "",
        "Polja odgovora: " + ", ".join(f"`{name}`" for name in document["answerFields"]),
        "",
        "Polja retka: " + ", ".join(f"`{name}`" for name in document["rowFields"]),
        "",
        "| Zemlja | Operator | Postrojenje | Vrsta | Dan | U skladištu (TWh) | Puno (%) | Utiskivanje | "
        "Povlačenje | Kapacitet (TWh) | Status | Adresa |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for entry in document["datasets"]:
        latest = entry["latest"] or {}
        cells = [
            entry["country"],
            entry["company"],
            entry["facility"] or "(sve)",
            entry["kind"],
            *(
                str(latest.get(name) if latest.get(name) is not None else "")
                for name in SHOWN
                if name != "trend"
            ),
            f"`{entry['url']}`" if entry["error"] is None else f"greška: {entry['error']}",
        ]
        lines.append("| " + " | ".join(cell.replace("|", "/") for cell in cells) + " |")
    return "\n".join(lines) + "\n"


def _number(value: Any) -> float | None:
    """A figure as AGSI writes it: a string, with ``-`` (or nothing) where the operator reported none."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _day(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _position(row: dict[str, Any]) -> tuple[float, float] | None:
    """The facility's own coordinates, when AGSI gives a pair inside the map's region."""
    lon, lat = _number(row.get("longitude")), _number(row.get("latitude"))
    if lon is None or lat is None:
        return None
    west, south, east, north = REGION_BBOX
    return (round(lon, 5), round(lat, 5)) if west <= lon <= east and south <= lat <= north else None


def facility_rows(client: httpx.Client, key: str, url: str, days: int) -> list[dict[str, Any]]:
    """The latest ``days`` daily rows of one dataset, as the platform returns them."""
    answer = _get(client, urljoin(BASE_URL, url), key, {"size": days})
    rows = answer.get("data") if isinstance(answer, dict) else None
    if not isinstance(rows, list):
        raise AgsiError(f"{url}: no 'data' list in the answer")
    return [row for row in rows if isinstance(row, dict)]


def collect(
    client: httpx.Client, now: datetime, scope: frozenset[str], days: int = DEFAULT_DAYS
) -> dict[str, Any]:
    """One document for the map: per storage facility in ``scope``, its figures for each of the last days.

    The days are the gas days the facilities themselves reported, the union over all of them, ascending; a
    facility that did not report a day has ``None`` there. A facility with no figure at all is listed under
    ``missing`` and left out, as is one the listing gives no address for.
    """
    key = api_key()
    listing = _get(client, LISTING_URL, key, {"show": "listing"})
    wanted = [dataset for dataset in datasets(listing, scope) if dataset.facility_eic]
    if not wanted:
        raise AgsiError(f"the listing has no storage facility for {', '.join(sorted(scope))}")
    read: list[tuple[Dataset, dict[date, dict[str, Any]]]] = []
    missing: list[str] = []
    for dataset in wanted:
        by_day: dict[date, dict[str, Any]] = {}
        # one facility that fails is noted and the rest are still read (L-058)
        try:
            if not dataset.url:
                raise AgsiError("the listing gives no address for this facility")
            for row in facility_rows(client, key, dataset.url, days):
                day = _day(row.get("gasDayStart"))
                if day is not None and _number(row.get("full")) is not None:
                    by_day[day] = row
        except AgsiError as exc:
            log.warning(
                "AGSI facility unavailable", extra={"facility": dataset.facility_eic, "error": str(exc)}
            )
        if by_day:
            read.append((dataset, by_day))
        else:
            missing.append(dataset.facility_eic)
    window = sorted({day for _, by_day in read for day in by_day})[-days:]
    facilities: list[dict[str, Any]] = []
    for dataset, by_day in read:
        latest = by_day[max(by_day)]
        position = _position(latest)
        entry: dict[str, Any] = {
            "id": dataset.facility_eic,
            "name": dataset.facility,
            "operator": dataset.company,
            "operatorId": dataset.company_eic,
            "country": dataset.country,
            "lon": position[0] if position else None,
            "lat": position[1] if position else None,
            "workingGasTwh": _number(latest.get("workingGasVolume")),
            # E estimated, C confirmed, N no data: the platform's own mark for each day
            "status": [str(by_day[day].get("status") or "") if day in by_day else None for day in window],
        }
        for name, field in SERIES:
            entry[name] = [_number(by_day[day].get(field)) if day in by_day else None for day in window]
        facilities.append(entry)
    covered = {facility["country"] for facility in facilities}
    return {
        "version": VERSION,
        "generatedAt": now.isoformat(),
        "source": SOURCE,
        "sourceUrl": SOURCE_URL,
        "attribution": ATTRIBUTION,
        "license": LICENSE,
        "days": [day.isoformat() for day in window],
        "facilities": sorted(facilities, key=lambda f: (f["country"], f["name"], f["id"])),
        "missing": {"facilities": sorted(missing), "countries": sorted(scope - covered)},
    }


def validate(document: dict[str, Any], today: date) -> None:
    """Raise unless the document can stand on the map: aligned series, plausible figures, something fresh."""
    days = document.get("days", [])
    if not 1 <= len(days) <= MAX_DAYS or days != sorted(set(days)):
        raise StorageDataError(f"expected 1-{MAX_DAYS} ascending days, got {len(days)}")
    if document.get("attribution") != ATTRIBUTION:
        raise StorageDataError("the document must name GIE as its source")
    facilities = document.get("facilities", [])
    if not facilities:
        raise StorageDataError("no storage facility reported anything; keeping the published data")
    for facility in facilities:
        name = facility.get("id")
        if not name or not facility.get("country"):
            raise StorageDataError(f"malformed facility {name!r}")
        for series, _ in (*SERIES, ("status", "")):
            values = facility.get(series)
            if not isinstance(values, list) or len(values) != len(days):
                raise StorageDataError(f"{name}: {series} does not have one value per day")
        for value in facility["fullPercent"]:
            if value is not None and not 0 <= value <= MAX_FULL:
                raise StorageDataError(f"{name}: {value} % full is not plausible")
        for series in ("inStorageTwh", "injectionGwhPerDay", "withdrawalGwhPerDay"):
            if any(value is not None and value < 0 for value in facility[series]):
                raise StorageDataError(f"{name}: negative {series}")
    last = date.fromisoformat(days[-1])
    if (today - last).days > FRESH_DAYS:
        raise StorageDataError(
            f"the latest gas day is {days[-1]}, more than {FRESH_DAYS} days ago; keeping the published data"
        )


def publish_storage(store: ObjectStore, document: dict[str, Any], today: date) -> None:
    """Validate, then replace the published storage document. A failed validation leaves the old one."""
    validate(document, today)
    store.put_bytes(STORAGE_KEY, json.dumps(document, separators=(",", ":")).encode(), STORAGE_META)
    log.info(
        "published gas storage",
        extra={
            "facilities": len(document["facilities"]),
            "days": len(document["days"]),
            "missing": document["missing"],
        },
    )
