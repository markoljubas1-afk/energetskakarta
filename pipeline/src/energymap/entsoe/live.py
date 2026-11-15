"""Cross-border flows and day-ahead prices for the map's live layer.

Window: yesterday 00:00 to the day after tomorrow 00:00 (local time), because day-ahead prices for
tomorrow are published around midday. Everything is reduced to local hours:

* net flow X→Y per hour = flow X→Y - flow Y→X, only for hours both directions report completely
* price per hour = mean of the reported values (15-minute products since 2025)
* no market (BA, ME) or no data is recorded in ``missing``; it is not an error
* actual generation per technology (MW, hourly mean) for the countries around Croatia, so the map can say
  what the electricity in the grid is made of in an hour (Faza 19). An hour counts only when every series
  of that country reports it in full; otherwise the hour is ``null`` for all technologies of the country,
  so a late series can never skew the shares. Pumping (consumption) is not generation and is left out.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta
from typing import Any, Protocol

from energymap.entsoe.client import AREAS, EntsoeError, NoData
from energymap.entsoe.energy import PSR_TECHNOLOGY
from energymap.entsoe.energy import TIMEZONE as TIMEZONE
from energymap.entsoe.parse import EntsoeParseError, Interval, Series
from energymap.publish import ObjectMeta, ObjectStore

log = logging.getLogger(__name__)

VERSION = 1

# Borders inside the scope (verified against entsoe-py NEIGHBOURS; Croatia and Montenegro are not
# directly connected). Italy is addressed as a country for flows.
BORDERS: tuple[tuple[str, str], ...] = (
    ("AT", "HU"),
    ("AT", "IT"),
    ("AT", "SI"),
    ("HU", "HR"),
    ("HU", "RS"),
    ("HU", "SI"),
    ("SI", "HR"),
    ("SI", "IT"),
    ("RS", "BA"),
    ("RS", "HR"),
    ("RS", "ME"),
    ("ME", "BA"),
    ("ME", "IT"),
    ("BA", "HR"),
)

# Day-ahead price zones. Italy has several; the northern zone borders Slovenia and Austria.
PRICE_ZONES: dict[str, str] = {
    "HR": AREAS["HR"],
    "SI": AREAS["SI"],
    "HU": AREAS["HU"],
    "RS": AREAS["RS"],
    "BA": AREAS["BA"],
    "ME": AREAS["ME"],
    "AT": AREAS["AT"],
    "IT_NORD": "10Y1001A1001A73I",
    "IT_CNOR": "10Y1001A1001A70O",
    "IT_CSUD": "10Y1001A1001A71M",
    "IT_SUD": "10Y1001A1001A788",
    "IT_CALA": "10Y1001C--00096J",
    "IT_SICI": "10Y1001A1001A75E",
    "IT_SARD": "10Y1001A1001A74G",
}


# Countries whose generation mix the map shows: Croatia and every country it trades with directly, plus
# Austria for the region. Italy is left out: it reports per bidding zone, and it does not border Croatia.
GENERATION_COUNTRIES: tuple[str, ...] = ("HR", "SI", "HU", "RS", "BA", "ME", "AT")


class LiveSource(Protocol):
    def flows(self, sender: str, receiver: str, start: datetime, end: datetime) -> list[Series]: ...
    def prices(self, zone: str, start: datetime, end: datetime) -> list[Series]: ...
    def generation(self, area: str, start: datetime, end: datetime) -> list[Series]: ...


def hourly_generation(series: Iterable[Series], hours: Sequence[datetime]) -> dict[str, list[float | None]]:
    """A75 series of one country → MW per technology per hour, with an hour kept only if every series has it.

    Several production types map to one technology (run-of-river and reservoir hydro, say); their hourly
    means add up. Series that report nothing in the window are ignored rather than blanking every hour.
    """
    per_series: list[tuple[str, list[float | None]]] = []
    for item in series:
        if item.consumption:
            continue
        values = hourly(item.intervals, hours, complete=True)
        if all(v is None for v in values):
            continue
        mapped = PSR_TECHNOLOGY.get(item.psr_type or "")
        per_series.append(((mapped.value if mapped else "other"), values))
    if not per_series:
        return {}
    complete = [all(values[i] is not None for _, values in per_series) for i in range(len(hours))]
    totals: dict[str, list[float | None]] = {}
    for tech, values in per_series:
        row = totals.setdefault(tech, [0.0] * len(hours))
        for i, value in enumerate(values):
            current = row[i]
            row[i] = None if not complete[i] or value is None or current is None else current + value
    return {tech: [None if v is None else round(v, 1) for v in row] for tech, row in sorted(totals.items())}


def window(now: datetime) -> tuple[datetime, datetime]:
    today = now.astimezone(TIMEZONE).date()
    start = datetime.combine(today - timedelta(days=1), datetime.min.time(), TIMEZONE)
    end = datetime.combine(today + timedelta(days=2), datetime.min.time(), TIMEZONE)
    return start, end


def local_hours(start: datetime, end: datetime) -> list[datetime]:
    """Every hour in [start, end), stepping in real time so 23- and 25-hour days come out right."""
    hours = []
    current = start.timestamp()
    while current < end.timestamp():
        hours.append(datetime.fromtimestamp(current, TIMEZONE))
        current += 3600
    return hours


def hourly(intervals: Iterable[Interval], hours: Sequence[datetime], *, complete: bool) -> list[float | None]:
    """Time-weighted mean per hour. With ``complete`` an hour needs values for all of its 60 minutes.

    Hours are bucketed on epoch-hour boundaries, which are local hour boundaries for CET/CEST.
    """
    index = {hour.timestamp(): i for i, hour in enumerate(hours)}
    sums: defaultdict[int, float] = defaultdict(float)
    seconds: defaultdict[int, float] = defaultdict(float)
    for interval in intervals:
        cursor = interval.start.timestamp()
        end = interval.end.timestamp()
        while cursor < end:
            hour_start = cursor - (cursor % 3600)
            stop = min(end, hour_start + 3600)
            i = index.get(hour_start)
            if i is not None:
                sums[i] += interval.value * (stop - cursor)
                seconds[i] += stop - cursor
            cursor = stop
    result: list[float | None] = []
    for i in range(len(hours)):
        covered = seconds.get(i, 0.0)
        if covered == 0 or (complete and covered < 3600 - 1e-6):
            result.append(None)
        else:
            result.append(round(sums[i] / covered, 2))
    return result


def _first_sequence(series: list[Series]) -> list[Interval]:
    """Price documents may repeat the day in several sequences; position 1 (or unnumbered) is the auction."""
    chosen = [s for s in series if s.sequence in (None, 1)] or series[:1]
    return [iv for s in chosen for iv in s.intervals]


def collect(source: LiveSource, now: datetime) -> dict[str, Any]:
    start, end = window(now)
    hours = local_hours(start, end)
    flows = []
    missing_flows = []
    for a, b in BORDERS:
        try:
            forward = hourly(
                [iv for s in source.flows(AREAS[a], AREAS[b], start, end) for iv in s.intervals],
                hours,
                complete=True,
            )
            backward = hourly(
                [iv for s in source.flows(AREAS[b], AREAS[a], start, end) for iv in s.intervals],
                hours,
                complete=True,
            )
        except NoData:
            missing_flows.append(f"{a}-{b}")
            continue
        net = [
            None if f is None or r is None else round(f - r, 1)
            for f, r in zip(forward, backward, strict=True)
        ]
        if all(v is None for v in net):
            missing_flows.append(f"{a}-{b}")
            continue
        flows.append({"from": a, "to": b, "mw": net})

    prices: dict[str, Any] = {}
    missing_prices = []
    for name, zone in PRICE_ZONES.items():
        try:
            values = hourly(_first_sequence(source.prices(zone, start, end)), hours, complete=False)
        except NoData:
            missing_prices.append(name)
            continue
        if all(v is None for v in values):
            missing_prices.append(name)
            continue
        prices[name] = {"zone": zone, "eurPerMwh": values}

    generation: dict[str, dict[str, list[float | None]]] = {}
    missing_generation = []
    for country in GENERATION_COUNTRIES:
        # Generation is extra: if one country's query fails after the client's retries, flows and prices
        # are still published this hour and the country is listed as missing (logged, never silent).
        try:
            by_tech = hourly_generation(source.generation(AREAS[country], start, end), hours)
        except NoData:
            by_tech = {}
        except (EntsoeError, EntsoeParseError) as exc:
            log.warning("generation unavailable", extra={"country": country, "error": str(exc)})
            by_tech = {}
        if by_tech:
            generation[country] = by_tech
        else:
            missing_generation.append(country)

    return {
        "version": VERSION,
        "generatedAt": now.isoformat(),
        "timezone": str(TIMEZONE),
        "hours": [hour.isoformat() for hour in hours],
        "flows": flows,
        "prices": prices,
        "generation": generation,
        "missing": {"flows": missing_flows, "prices": missing_prices, "generation": missing_generation},
    }


class LiveDataError(ValueError):
    """The live document is not publishable."""


def validate(document: dict[str, Any]) -> None:
    n = len(document.get("hours", []))
    if not 46 <= n <= 74:
        raise LiveDataError(f"expected about 72 hours, got {n}")
    for flow in document["flows"]:
        if len(flow["mw"]) != n or flow["from"] not in AREAS or flow["to"] not in AREAS:
            raise LiveDataError(f"malformed flow {flow.get('from')}-{flow.get('to')}")
    for name, price in document["prices"].items():
        if len(price["eurPerMwh"]) != n:
            raise LiveDataError(f"malformed prices for {name}")
    for country, techs in document.get("generation", {}).items():
        if country not in AREAS or any(len(values) != n for values in techs.values()):
            raise LiveDataError(f"malformed generation for {country}")
    if not document["flows"] and not document["prices"]:
        raise LiveDataError("no flows and no prices at all; keeping the published live data")


LIVE_KEY = "live/current.json"
# Hourly updates: browsers and the edge may keep it for a few minutes.
LIVE_META = ObjectMeta("application/json; charset=utf-8", "public, max-age=300, must-revalidate")


def publish_live(store: ObjectStore, document: dict[str, Any]) -> None:
    """Validate, then replace the published live document. A failed validation leaves the old one."""
    validate(document)
    store.put_bytes(LIVE_KEY, json.dumps(document, separators=(",", ":")).encode(), LIVE_META)
    log.info(
        "published live data",
        extra={
            "flows": len(document["flows"]),
            "prices": len(document["prices"]),
            "missing": document["missing"],
        },
    )
