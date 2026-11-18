"""Gas in storage at the end of each month, by country (Faza 40-3), from GIE AGSI.

The map's storage document holds the last 30 days and forgets the rest. The monthly reports want to say
"at the end of October the storage was 85 % full, a year earlier 78 %", so this keeps one figure per
country per month: how full its storage was on the last gas day of the month that its facilities
reported, with that day's date. Several facilities are added up by volume (gas in storage over working
volume), each on its own last reported day of the month; a facility without volumes that day keeps the
country from having a total, rather than being left out silently.

Month-end figures only: the document stays small however many years it covers. Published months are kept;
freshly fetched ones are laid over them. Whether a month's last day is late enough to stand for "the end
of the month" is the reader's question (the report asks for the last three days). Nothing is estimated.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any
from urllib.parse import urljoin

import httpx

from energymap.gas.agsi import (
    ATTRIBUTION,
    BASE_URL,
    LICENSE,
    LISTING_URL,
    SOURCE,
    SOURCE_URL,
    AgsiError,
    _day,
    _get,
    _number,
    api_key,
    datasets,
)
from energymap.publish import ObjectMeta, ObjectStore

log = logging.getLogger("energymap")

VERSION = 1
KEY = "gas/storage-months.json"
META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")
#: the platform answers with at most this many rows a page
PAGE_SIZE = 300
#: the current month and the one before it
DEFAULT_DAYS = 70
MAX_DAYS = 1200


class StorageMonthsError(ValueError):
    """The document is not publishable."""


def history_rows(client: httpx.Client, key: str, url: str, days: int) -> list[dict[str, Any]]:
    """The latest ``days`` daily rows of one dataset, newest first, read page by page."""
    rows: list[dict[str, Any]] = []
    page = 1
    while len(rows) < days:
        answer = _get(client, urljoin(BASE_URL, url), key, {"size": min(PAGE_SIZE, days), "page": page})
        data = answer.get("data") if isinstance(answer, dict) else None
        if not isinstance(data, list):
            raise AgsiError(f"{url}: no 'data' list in the answer")
        rows.extend(row for row in data if isinstance(row, dict))
        last = answer.get("last_page")
        if not data or not isinstance(last, int) or page >= last:
            break
        page += 1
    return rows[:days]


def month_ends(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """One facility's last reported day of each month: its date, fill and volumes (TWh, when stated)."""
    ends: dict[str, dict[str, Any]] = {}
    for row in rows:
        day = _day(row.get("gasDayStart"))
        full = _number(row.get("full"))
        if day is None or full is None:
            continue
        month = day.isoformat()[:7]
        known = ends.get(month)
        if known is None or day.isoformat() > known["day"]:
            ends[month] = {
                "day": day.isoformat(),
                "full": full,
                "stored": _number(row.get("gasInStorage")),
                "capacity": _number(row.get("workingGasVolume")),
            }
    return ends


def country_months(facilities: list[dict[str, dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    """A country's month-ends from those of its facilities: one facility speaks for itself, several are
    added up by volume. A month in which a facility that reported has no volumes gets no total."""
    months: dict[str, dict[str, Any]] = {}
    for month in sorted({month for ends in facilities for month in ends}):
        reported = [ends[month] for ends in facilities if month in ends]
        day = max(end["day"] for end in reported)
        if len(reported) == 1:
            months[month] = {"day": day, "full": round(reported[0]["full"], 2), "facilities": 1}
            continue
        if any(end["stored"] is None or not end["capacity"] for end in reported):
            log.warning("a facility without volumes: no country total", extra={"month": month})
            continue
        stored = sum(end["stored"] for end in reported)
        capacity = sum(end["capacity"] for end in reported)
        months[month] = {"day": day, "full": round(stored / capacity * 100, 2), "facilities": len(reported)}
    return months


def collect(
    client: httpx.Client, scope: frozenset[str], days: int = DEFAULT_DAYS
) -> dict[str, dict[str, Any]]:
    """Country → month → its month-end, for the countries of ``scope`` whose storage reported anything."""
    key = api_key()
    listing = _get(client, LISTING_URL, key, {"show": "listing"})
    wanted = [dataset for dataset in datasets(listing, scope) if dataset.facility_eic]
    if not wanted:
        raise AgsiError(f"the listing has no storage facility for {', '.join(sorted(scope))}")
    by_country: dict[str, list[dict[str, dict[str, Any]]]] = {}
    for dataset in wanted:
        # one facility that fails is noted and the rest are still read (L-058)
        try:
            if not dataset.url:
                raise AgsiError("the listing gives no address for this facility")
            ends = month_ends(history_rows(client, key, dataset.url, days))
        except AgsiError as exc:
            log.warning(
                "AGSI facility unavailable", extra={"facility": dataset.facility_eic, "error": str(exc)}
            )
            continue
        if ends:
            by_country.setdefault(dataset.country, []).append(ends)
    return {country: country_months(facilities) for country, facilities in sorted(by_country.items())}


def merge(
    published: dict[str, Any] | None, fresh: dict[str, dict[str, Any]], now: datetime
) -> dict[str, Any]:
    """The published months with the fresh ones laid over them. A fresh month-end that is earlier in the
    month than the published one (the platform answering with less) does not replace it."""
    countries: dict[str, dict[str, dict[str, Any]]] = {}
    if published and published.get("version") == VERSION:
        for country, entry in published.get("countries", {}).items():
            countries[country] = dict(entry.get("months", {}))
    for country, months in fresh.items():
        kept = countries.setdefault(country, {})
        for month, end in months.items():
            before = kept.get(month)
            if before is not None and before["day"] > end["day"]:
                continue
            kept[month] = end
    return {
        "version": VERSION,
        "generatedAt": now.isoformat(),
        "source": SOURCE,
        "sourceUrl": SOURCE_URL,
        "attribution": ATTRIBUTION,
        "license": LICENSE,
        "countries": {
            country: {"months": dict(sorted(months.items()))}
            for country, months in sorted(countries.items())
            if months
        },
    }


def validate(document: dict[str, Any], today: date) -> None:
    countries = document.get("countries")
    if document.get("version") != VERSION or not isinstance(countries, dict) or not countries:
        raise StorageMonthsError("no country has a month of storage; keeping what is published")
    for country, entry in countries.items():
        for month, end in entry["months"].items():
            in_month = end["day"].startswith(month) and end["day"] <= today.isoformat()
            if not in_month or not 0 <= end["full"] <= 120 or end["facilities"] < 1:
                raise StorageMonthsError(f"{country} {month}: an implausible month-end")


def publish_months(
    store: ObjectStore, client: httpx.Client, scope: frozenset[str], days: int, now: datetime
) -> dict[str, Any]:
    """Fetch, lay over what is published, validate and publish. A failed validation leaves the published
    document as it was."""
    stored = store.get_bytes(KEY)
    try:
        published = json.loads(stored) if stored is not None else None
    except ValueError:
        published = None
    document = merge(published if isinstance(published, dict) else None, collect(client, scope, days), now)
    validate(document, now.date())
    store.put_bytes(KEY, json.dumps(document, separators=(",", ":")).encode(), META)
    log.info("published month-end gas storage", extra={"countries": sorted(document["countries"])})
    return document
