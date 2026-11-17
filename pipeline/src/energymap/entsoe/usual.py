"""What is usual for a country: the middle half of its daily renewable shares over the last year.

The map's green card says how green a country's electricity is in an hour, on one fixed scale for every
country (35 % and 65 %): the colour means the same in Slovenia as in Austria. This adds the country's own
yardstick next to it: between which two shares half of its days fell over the last 365 complete days, and
the day in the middle. The colour is not moved by it (decision 2026-11-17: thresholds from a country's own
history would paint a country green for being a little better than its own poor average).

Daily shares, from the daily files (``energy/daily/*``): renewable generation over all generation of a day
that was (nearly) fully reported. The card's figure is for one hour, so the sentence that uses this says
"daily share". Nothing here is a forecast or a target.
"""

from __future__ import annotations

import json
import logging
import statistics
from collections.abc import Sequence
from datetime import date, datetime, timedelta
from typing import Any

from energymap.entsoe.records import COMPLETE, RENEWABLE
from energymap.entsoe.store import YearFile
from energymap.publish import ObjectMeta, ObjectStore

log = logging.getLogger("energymap")

VERSION = 1
KEY = "live/usual.json"
META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")
#: how far back "usual" looks: a whole year, so that no season is left out
WINDOW_DAYS = 365
#: fewer complete days than this in the window and the country gets no yardstick
MIN_DAYS = 180
#: the last days are still being reported
SKIP_RECENT_DAYS = 2


def daily_shares(years: Sequence[YearFile], country: str, first: date, last: date) -> list[float]:
    """The renewable share of generation on each complete day of ``country`` in [first, last]."""
    shares = []
    for year in years:
        data = year.countries.get(country)
        if data is None:
            continue
        for index, day in enumerate(year.days):
            if not first <= day <= last or data.generation_coverage[index] < COMPLETE:
                continue
            by_tech = {tech: values[index] or 0.0 for tech, values in data.generation.items()}
            total = sum(by_tech.values())
            if total > 0:
                shares.append(sum(value for tech, value in by_tech.items() if tech in RENEWABLE) / total)
    return shares


def usual_document(years: Sequence[YearFile], now: datetime) -> dict[str, Any]:
    """Per country: the quartiles of its daily renewable share over the window, and how many days they
    rest on. A country with too few complete days is listed under ``missing``."""
    last = now.date() - timedelta(days=SKIP_RECENT_DAYS + 1)
    first = last - timedelta(days=WINDOW_DAYS - 1)
    countries: dict[str, dict[str, Any]] = {}
    missing: list[str] = []
    for country in sorted({code for year in years for code in year.countries}):
        shares = daily_shares(years, country, first, last)
        if len(shares) < MIN_DAYS:
            missing.append(country)
            continue
        low, median, high = statistics.quantiles(shares, n=4, method="inclusive")
        countries[country] = {
            "low": round(low, 4),
            "median": round(median, 4),
            "high": round(high, 4),
            "days": len(shares),
        }
    return {
        "version": VERSION,
        "generatedAt": now.isoformat(),
        "source": "ENTSO-E Transparency Platform",
        "from": first.isoformat(),
        "to": last.isoformat(),
        "windowDays": WINDOW_DAYS,
        "countries": countries,
        "missing": missing,
    }


class UsualDataError(ValueError):
    """The document is not publishable."""


def validate(document: dict[str, Any]) -> None:
    if document.get("version") != VERSION or not document.get("countries"):
        raise UsualDataError("no country has enough complete days; keeping what is published")
    for country, entry in document["countries"].items():
        low, median, high = entry.get("low"), entry.get("median"), entry.get("high")
        if (
            not all(isinstance(value, float) for value in (low, median, high))
            or not 0 <= low <= median <= high <= 1
        ):
            raise UsualDataError(f"{country}: the quartiles are not ordered shares")


def publish_usual(store: ObjectStore, years: Sequence[YearFile], now: datetime) -> dict[str, Any]:
    """Compute, validate and publish. A failed validation leaves the published document as it was."""
    document = usual_document(years, now)
    validate(document)
    store.put_bytes(KEY, json.dumps(document, separators=(",", ":")).encode(), META)
    log.info(
        "published the usual renewable share",
        extra={"countries": sorted(document["countries"]), "missing": document["missing"]},
    )
    return document
