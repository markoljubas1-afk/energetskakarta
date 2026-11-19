"""What entered a country's gas transmission system each gas day and where it went (Faza 44-3).

One transmission operator reports every point of its system to the ENTSOG Transparency Platform: the LNG
terminal, the aggregated production point, the storage, each interconnection in both directions, and the
aggregated exit to final consumers and distribution. Together they are the system's daily balance.

Verified against the live API on 2026-11-19 (no key needed):

* ``operationalData?indicator=Physical Flow&periodType=day&operatorKey=HR-TSO-0001&from=…&to=…&limit=-1``
  answers with one row per point, direction and gas day, in ``kWh/d``. ``flowStatus`` is ``Provisional`` or
  ``Confirmed``. A gas day is published in the evening of the day after it.
* The ``tSOCountry`` filter does nothing on ``operationalData`` (the whole of Europe comes back); it does
  work on ``operatorpointdirections``, which names the neighbouring country of an interconnection.

Only countries whose whole system is one operator's are read (``OPERATORS``): where several operators share
a country, their common points would be counted twice, and each such country needs its own check first.
An entry is not consumption: gas that enters also leaves across the border and into storage.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from energymap.gas.entsog import UNIT, EntsogError, _get, _kwh, _text, gas_days
from energymap.publish import ObjectMeta, ObjectStore

log = logging.getLogger(__name__)

VERSION = 1
DEFAULT_DAYS = 30
MAX_DAYS = 60
#: a document is worth publishing only if something entered the system this recently
FRESH_DAYS = 7
SOURCE = "ENTSOG Transparency Platform"
SOURCE_URL = "https://transparency.entsog.eu/"

FLOWS_KEY = "live/gasflows.json"
# Daily updates: an hour in caches is nothing against a day of freshness.
FLOWS_META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")

#: country → the one transmission operator whose points are that country's whole system
OPERATORS: dict[str, str] = {"HR": "HR-TSO-0001"}

#: the kinds of point a balance is made of, by the prefix of ENTSOG's point key
Kind = Literal["LNG", "PRD", "UGS", "ITP", "VIP", "FNC", "DIS", "OTHER"]
KINDS: tuple[Kind, ...] = ("LNG", "PRD", "UGS", "ITP", "VIP", "FNC", "DIS")
Direction = Literal["entry", "exit"]
#: the platform's mark for a day's figure: provisional or confirmed; None when it gave neither
Status = Literal["P", "C"]


class FlowDataError(ValueError):
    """The gas flow document is not publishable."""


#: published with camelCase keys, like every other document the map reads
_CONFIG = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)


class Point(BaseModel):
    model_config = _CONFIG

    key: str = Field(min_length=1)
    label: str
    kind: Kind
    direction: Direction
    #: the country on the other side of an interconnection; None for every other kind
    neighbour: str | None
    kwh_per_day: list[float | None]
    status: list[Status | None]


class CountryFlows(BaseModel):
    model_config = _CONFIG

    operator_key: str
    operator: str
    points: list[Point]


class FlowDocument(BaseModel):
    model_config = _CONFIG

    version: Literal[1]
    generated_at: str
    source: str
    source_url: str
    unit: Literal["kWh/d"]
    days: list[date] = Field(min_length=1, max_length=MAX_DAYS)
    countries: dict[str, CountryFlows]
    missing: list[str]

    @model_validator(mode="after")
    def _columns_match_days(self) -> FlowDocument:
        for country, flows in self.countries.items():
            for point in flows.points:
                if len(point.kwh_per_day) != len(self.days) or len(point.status) != len(self.days):
                    raise ValueError(f"{country} {point.key} {point.direction}: not one value per day")
                if any(value is not None and value < 0 for value in point.kwh_per_day):
                    raise ValueError(f"{country} {point.key} {point.direction}: a negative flow")
        return self


def kind_of(point_key: str) -> Kind:
    """ "ITP-00042" → "ITP"; a prefix the balance does not know → "OTHER" (shown under its own label)."""
    prefix = point_key.partition("-")[0].upper()
    return next((kind for kind in KINDS if kind == prefix), "OTHER")


def _status(row: dict[str, Any]) -> Status | None:
    mark = _text(row, "flowStatus").lower()
    return "P" if mark == "provisional" else "C" if mark == "confirmed" else None


def neighbours(client: httpx.Client, country: str, operator_key: str) -> dict[str, str]:
    """Point key → the country on the other side, for the operator's cross-border points."""
    rows = _get(client, "operatorpointdirections", {"tSOCountry": country, "limit": -1})
    found: dict[str, str] = {}
    for row in rows:
        other = _text(row, "adjacentCountry").upper()
        if _text(row, "operatorKey") == operator_key and len(other) == 2 and other != country:
            found.setdefault(_text(row, "pointKey"), other)
    return found


def country_flows(
    client: httpx.Client, country: str, operator_key: str, window: list[date]
) -> CountryFlows | None:
    """Every point direction of the operator with its flow on each day of ``window``; None when the
    platform has nothing for it."""
    rows = _get(
        client,
        "operationalData",
        {
            "indicator": "Physical Flow",
            "periodType": "day",
            "operatorKey": operator_key,
            "from": window[0].isoformat(),
            "to": window[-1].isoformat(),
            "includeExemptions": 0,
            "limit": -1,
        },
    )
    index = {day: at for at, day in enumerate(window)}
    series: dict[tuple[str, str], dict[str, Any]] = {}
    operator = operator_key
    for row in rows:
        # the filter is trusted no further than it can be checked: a row of another operator is not ours
        if _text(row, "operatorKey") != operator_key:
            raise EntsogError(f"{operator_key}: the answer holds rows of {_text(row, 'operatorKey')!r}")
        unit = _text(row, "unit")
        if unit and unit != UNIT:
            raise EntsogError(f"{operator_key}: unexpected unit {unit!r}, expected {UNIT!r}")
        point_key, direction = _text(row, "pointKey"), _text(row, "directionKey")
        try:
            at = index.get(date.fromisoformat(_text(row, "periodFrom")[:10]))
        except ValueError:
            continue
        if not point_key or direction not in ("entry", "exit") or at is None:
            continue
        operator = _text(row, "operatorLabel") or operator
        kwh = _kwh(row)
        if kwh is None:
            continue
        if kwh < 0:
            raise EntsogError(f"{operator_key}{point_key}{direction}: a negative flow ({kwh})")
        point = series.setdefault(
            (point_key, direction),
            {
                "label": _text(row, "pointLabel") or point_key,
                "kwhPerDay": [None] * len(window),
                "status": [None] * len(window),
            },
        )
        point["kwhPerDay"][at] = round(kwh)
        point["status"][at] = _status(row)
    if not series:
        return None
    across = neighbours(client, country, operator_key)
    points = [
        Point(
            key=point_key,
            label=point["label"],
            kind=kind_of(point_key),
            direction="entry" if direction == "entry" else "exit",
            neighbour=across.get(point_key) if kind_of(point_key) in ("ITP", "VIP") else None,
            kwh_per_day=point["kwhPerDay"],
            status=point["status"],
        )
        for (point_key, direction), point in sorted(series.items())
    ]
    return CountryFlows(operator_key=operator_key, operator=operator, points=points)


def collect(
    client: httpx.Client, now: datetime, days: int = DEFAULT_DAYS, operators: dict[str, str] | None = None
) -> FlowDocument:
    """One document for the map: per country, each point's flow on each of the last gas days."""
    window = gas_days(now, days)
    countries: dict[str, CountryFlows] = {}
    missing: list[str] = []
    for country, operator_key in sorted((operators or OPERATORS).items()):
        flows = country_flows(client, country, operator_key, window)
        if flows is None:
            missing.append(country)
        else:
            countries[country] = flows
    return FlowDocument(
        version=VERSION,
        generated_at=now.isoformat(),
        source=SOURCE,
        source_url=SOURCE_URL,
        unit=UNIT,
        days=window,
        countries=countries,
        missing=missing,
    )


def validate(document: FlowDocument) -> None:
    """Refuse a document in which nothing entered any system lately: the published one stays."""
    for flows in document.countries.values():
        for point in flows.points:
            if point.direction == "entry" and any(value for value in point.kwh_per_day[-FRESH_DAYS:]):
                return
    raise FlowDataError(
        f"no entry point reported a flow in the last {FRESH_DAYS} days; keeping the published data"
    )


def parse(raw: Any) -> FlowDocument:
    """A document read back from disk, checked as strictly as one just collected."""
    return FlowDocument.model_validate(raw)


def publish_flows(store: ObjectStore, document: FlowDocument) -> None:
    """Validate, then replace the published document. A failed validation leaves the old one."""
    validate(document)
    body = json.dumps(document.model_dump(mode="json", by_alias=True), separators=(",", ":")).encode()
    store.put_bytes(FLOWS_KEY, body, FLOWS_META)
    log.info(
        "published gas flows",
        extra={
            "countries": sorted(document.countries),
            "days": len(document.days),
            "missing": document.missing,
        },
    )
