"""Record days, and the hours of those days for the live layer (Faza 39, "povijesni ekstremi").

A reader who opens the map on an ordinary day can look at a day when something happened. Which days those
are is read off our own published daily data (``energy/daily/*``, ENTSO-E since 2015), never chosen from
memory: for one country, the day with the most wind and the most solar generation, the highest and the
lowest demand, and the highest renewable share of generation. Each record carries its date and its figure.

For each such day the same code that builds the live document (``live.collect``) is asked for the three-day
window around it, so the map and the bar show a past day exactly as they show today. A day ENTSO-E no
longer has enough of is left out, and the index lists only days that were published.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Any

from energymap.entsoe import live
from energymap.entsoe.energy import TIMEZONE
from energymap.entsoe.store import YearFile
from energymap.publish import IMMUTABLE, ObjectMeta, ObjectStore

log = logging.getLogger("energymap")

VERSION = 1
HOME = "HR"
#: a day counts only when (nearly) all of it was reported: a record must not be an artefact of a gap
COMPLETE = 0.99
#: the same sources the map calls renewable (web/src/data/greenShare.ts): pumped storage is left out
RENEWABLE = frozenset({"hydro", "wind", "solar", "biomass", "geothermal"})
#: record kinds in the order they are listed, with the unit of their figure
KINDS: tuple[tuple[str, str], ...] = (
    ("wind", "MWh"),
    ("solar", "MWh"),
    ("load_high", "MWh"),
    ("load_low", "MWh"),
    ("renewable_share", "share"),
)
INDEX_KEY = "live/days/index.json"
INDEX_META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")
DAY_META = ObjectMeta("application/json; charset=utf-8", IMMUTABLE)


def day_key(day: date) -> str:
    return f"live/days/{day.isoformat()}.json"


@dataclass(frozen=True, slots=True)
class Record:
    kind: str
    day: date
    #: MWh for the day, or a share between 0 and 1
    value: float
    unit: str


def _best(candidates: Iterable[tuple[date, float]], *, lowest: bool = False) -> tuple[date, float] | None:
    # the earliest day wins a tie, so the answer does not depend on the order the years are read in
    ranked = sorted(candidates, key=lambda item: (item[1] if lowest else -item[1], item[0]))
    return ranked[0] if ranked else None


def records(years: Sequence[YearFile], country: str = HOME, *, until: date | None = None) -> list[Record]:
    """The record days of ``country`` in the daily files, one per kind that has any complete day.

    ``until`` leaves out that day and everything after it (the last days are still being reported).
    """
    wind: list[tuple[date, float]] = []
    solar: list[tuple[date, float]] = []
    load: list[tuple[date, float]] = []
    share: list[tuple[date, float]] = []
    for year in years:
        data = year.countries.get(country)
        if data is None:
            continue
        for index, day in enumerate(year.days):
            if until is not None and day >= until:
                continue
            if data.generation_coverage[index] >= COMPLETE:
                by_tech = {tech: values[index] or 0.0 for tech, values in data.generation.items()}
                total = sum(by_tech.values())
                if by_tech.get("wind", 0.0) > 0:
                    wind.append((day, by_tech["wind"]))
                if by_tech.get("solar", 0.0) > 0:
                    solar.append((day, by_tech["solar"]))
                if total > 0:
                    renewable = sum(value for tech, value in by_tech.items() if tech in RENEWABLE)
                    share.append((day, renewable / total))
            demand = data.load[index]
            if data.load_coverage[index] >= COMPLETE and demand is not None and demand > 0:
                load.append((day, demand))
    found = {
        "wind": _best(wind),
        "solar": _best(solar),
        "load_high": _best(load),
        "load_low": _best(load, lowest=True),
        "renewable_share": _best(share),
    }
    result = []
    for kind, unit in KINDS:
        best = found[kind]
        if best is not None:
            result.append(Record(kind, best[0], round(best[1], 4 if unit == "share" else 1), unit))
    return result


def collect_day(source: live.LiveSource, day: date) -> dict[str, Any]:
    """The live document for the three days around ``day``, as the live layer would have had it at noon."""
    document = live.collect(source, datetime.combine(day, time(12), TIMEZONE))
    live.validate(document)
    if not any(hour.startswith(day.isoformat()) for hour in document["hours"]):
        raise live.LiveDataError(f"the document for {day} does not contain that day")
    document["day"] = day.isoformat()
    return document


def has_day(document: dict[str, Any], day: date, country: str = HOME) -> bool:
    """Whether the document says anything about ``country`` on ``day``: a flow, a price or generation."""
    at = [i for i, hour in enumerate(document["hours"]) if hour.startswith(day.isoformat())]

    def any_value(values: Sequence[float | None]) -> bool:
        return any(values[i] is not None for i in at)

    flows = any(any_value(flow["mw"]) for flow in document["flows"] if country in (flow["from"], flow["to"]))
    prices = any(
        any_value(price["eurPerMwh"]) for name, price in document["prices"].items() if name == country
    )
    generation = any(any_value(values) for values in document.get("generation", {}).get(country, {}).values())
    return flows or prices or generation


def index_document(
    found: Sequence[Record], published: Iterable[date], now: datetime, country: str = HOME
) -> dict[str, Any]:
    """The list the map offers: each published day with the records it holds."""
    available = set(published)
    days: dict[date, list[dict[str, Any]]] = {}
    for record in found:
        if record.day in available:
            days.setdefault(record.day, []).append(
                {"kind": record.kind, "value": record.value, "unit": record.unit}
            )
    return {
        "version": VERSION,
        "generatedAt": now.isoformat(),
        "source": "ENTSO-E Transparency Platform",
        "country": country,
        "days": [
            {"date": day.isoformat(), "key": day_key(day), "records": entries}
            for day, entries in sorted(days.items())
        ],
        "missing": sorted({record.day.isoformat() for record in found if record.day not in available}),
    }


class RecordDaysError(ValueError):
    """The record days are not publishable."""


def publish_days(store: ObjectStore, index: dict[str, Any], documents: dict[str, dict[str, Any]]) -> None:
    """Publish each day's document, then the index that names them. An index without a day publishes
    nothing: the published one stays."""
    if index.get("version") != VERSION or not index.get("days"):
        raise RecordDaysError("no record day has data; keeping what is published")
    for entry in index["days"]:
        document = documents.get(entry["date"])
        if document is None:
            raise RecordDaysError(f"the index names {entry['date']} but its document is missing")
        live.validate(document)
    for entry in index["days"]:
        body = json.dumps(documents[entry["date"]], separators=(",", ":")).encode()
        store.put_bytes(entry["key"], body, DAY_META)
    store.put_bytes(INDEX_KEY, json.dumps(index, separators=(",", ":")).encode(), INDEX_META)
    log.info(
        "published record days",
        extra={"days": [entry["date"] for entry in index["days"]], "missing": index["missing"]},
    )
