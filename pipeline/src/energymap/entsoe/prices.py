"""Day-ahead prices by month: how many hours and days the price was zero or below (Faza 40-3).

The live layer holds three days of prices and forgets them. The monthly reports want to say "in October
the exchange price was zero or below on 6 days", so this keeps, per month, a handful of totals of the
day-ahead auction in the home price zone: the hours and days at or below zero, the lowest hour and the
average. Hourly values are the mean of what the auction reported for the hour (15-minute products since
2025), the same way the live layer makes its hours, so "an hour at or below zero" means the same in both.

Totals only, never hours: the document stays a few kilobytes however many years it covers. A month is
used by the report only when every one of its hours has a price (``reported == hours``); the current
month is stored as far as it has gone and refreshed daily. Nothing is estimated or filled in.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any, Protocol

from energymap.entsoe.client import NoData
from energymap.entsoe.energy import TIMEZONE
from energymap.entsoe.live import PRICE_ZONES, _first_sequence, hourly, local_hours
from energymap.entsoe.parse import Series
from energymap.publish import ObjectMeta, ObjectStore

log = logging.getLogger("energymap")

VERSION = 1
KEY = "energy/prices.json"
META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")
HOME = "HR"


class PriceSource(Protocol):
    def prices(self, zone: str, start: datetime, end: datetime) -> list[Series]: ...


class PriceDataError(ValueError):
    """The document is not publishable."""


def month_bounds(month: str) -> tuple[datetime, datetime]:
    """Local midnight at the start of ``month`` ("2026-10") and of the month after it."""
    year, number = (int(part) for part in month.split("-"))
    start = datetime(year, number, 1, tzinfo=TIMEZONE)
    end = datetime(year + (number == 12), number % 12 + 1, 1, tzinfo=TIMEZONE)
    return start, end


def months_back(today: date, count: int) -> list[str]:
    """The ``count`` months ending with the one ``today`` is in, oldest first."""
    result = []
    year, number = today.year, today.month
    for _ in range(count):
        result.append(f"{year:04d}-{number:02d}")
        year, number = (year - 1, 12) if number == 1 else (year, number - 1)
    return result[::-1]


def month_stats(series: list[Series], month: str) -> dict[str, Any] | None:
    """A month's totals from the auction's series; None when no hour of the month has a price."""
    start, end = month_bounds(month)
    hours = local_hours(start, end)
    values = hourly(_first_sequence(series), hours, complete=False)
    priced = [(hour, value) for hour, value in zip(hours, values, strict=True) if value is not None]
    if not priced:
        return None
    free = [(hour, value) for hour, value in priced if value <= 0]
    # the earliest hour wins a tie, so the answer does not depend on the order of the series
    lowest_hour, lowest = min(priced, key=lambda item: (item[1], item[0]))
    return {
        "hours": len(hours),
        "reported": len(priced),
        "freeHours": len(free),
        "freeDays": len({hour.date() for hour, _ in free}),
        "min": lowest,
        "minAt": lowest_hour.isoformat(),
        "average": round(sum(value for _, value in priced) / len(priced), 2),
    }


def collect(source: PriceSource, months: Sequence[str], country: str = HOME) -> dict[str, dict[str, Any]]:
    """The totals of each of ``months`` that the platform has prices for."""
    zone = PRICE_ZONES[country]
    found: dict[str, dict[str, Any]] = {}
    for month in months:
        start, end = month_bounds(month)
        try:
            stats = month_stats(source.prices(zone, start, end), month)
        except NoData:
            stats = None
        if stats is None:
            log.warning("no day-ahead prices for the month", extra={"country": country, "month": month})
            continue
        found[month] = stats
    return found


def merge(
    published: dict[str, Any] | None, fresh: dict[str, dict[str, Any]], now: datetime, country: str = HOME
) -> dict[str, Any]:
    """The published months with the freshly fetched ones laid over them. A month that was complete stays
    as it is when the new answer for it has fewer hours: the platform dropping history must not undo it."""
    months: dict[str, dict[str, Any]] = {}
    if published and published.get("version") == VERSION:
        months.update(published.get("zones", {}).get(country, {}).get("months", {}))
    for month, stats in fresh.items():
        before = months.get(month)
        if before is not None and before.get("reported", 0) > stats["reported"]:
            log.warning(
                "fewer priced hours than published; keeping the published month", extra={"month": month}
            )
            continue
        months[month] = stats
    return {
        "version": VERSION,
        "generatedAt": now.isoformat(),
        "source": "ENTSO-E Transparency Platform",
        "timezone": str(TIMEZONE),
        "zones": {country: {"zone": PRICE_ZONES[country], "months": dict(sorted(months.items()))}},
    }


def validate(document: dict[str, Any]) -> None:
    zones = document.get("zones")
    if document.get("version") != VERSION or not isinstance(zones, dict) or not zones:
        raise PriceDataError("no price zone in the document; keeping what is published")
    for name, zone in zones.items():
        months = zone.get("months")
        if not isinstance(months, dict) or not months:
            raise PriceDataError(f"{name}: no month has prices; keeping what is published")
        for month, stats in months.items():
            ordered = 0 < stats["reported"] <= stats["hours"] and 0 <= stats["freeDays"] <= stats["freeHours"]
            if (
                not ordered
                or stats["freeHours"] > stats["reported"]
                or (stats["min"] <= 0) != (stats["freeHours"] > 0)
            ):
                raise PriceDataError(f"{name} {month}: the totals contradict one another")


def publish_prices(
    store: ObjectStore, source: PriceSource, months: Sequence[str], now: datetime
) -> dict[str, Any]:
    """Fetch ``months``, lay them over what is published, validate and publish. A failed validation leaves
    the published document as it was."""
    stored = store.get_bytes(KEY)
    try:
        published = json.loads(stored) if stored is not None else None
    except ValueError:
        published = None
    document = merge(published if isinstance(published, dict) else None, collect(source, months), now)
    validate(document)
    store.put_bytes(KEY, json.dumps(document, separators=(",", ":")).encode(), META)
    log.info(
        "published monthly day-ahead price totals", extra={"months": len(document["zones"][HOME]["months"])}
    )
    return document
