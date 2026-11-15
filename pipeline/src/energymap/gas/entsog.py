"""Daily gas production per country from the ENTSOG Transparency Platform.

The platform publishes physical flows at every point of the European transmission grid, including the
*aggregated production points* through which domestic fields feed the network — one per transmission
operator, not one per field. That is the closest thing to a live production figure for gas that any
open source offers: how much gas from the country's own fields entered the grid each gas day. Nothing
similar exists for oil or coal.

Verified against the live API on 2026-09-19 (no key needed):

* ``operatorpointdirections?idPointType=3&limit=-1`` lists the production points; each row carries
  ``id`` (operator key + point key + direction, the value ``operationalData`` filters on), ``pointLabel``,
  ``operatorKey``/``operatorLabel``, ``directionKey`` and ``tSOCountry``. There are no coordinates.
* ``operationalData?indicator=Physical Flow&periodType=day&pointDirection=<id>&from=…&to=…`` returns one
  row per gas day (06:00-06:00 CET) in ``kWh/d``; ``value`` is a number, or ``""`` when ``isNA``.
* HTTP 404 means "no rows", not an error.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from energymap.publish import ObjectMeta, ObjectStore

log = logging.getLogger(__name__)

BASE_URL = "https://transparency.entsog.eu/api/v1/"
#: ENTSOG's id for "Aggregated production point - TP"
PRODUCTION_POINT_TYPE = 3
UNIT = "kWh/d"
VERSION = 1
DEFAULT_DAYS = 14
#: gas days are counted in Central European time and start at 06:00
TIMEZONE = ZoneInfo("Europe/Brussels")
GAS_DAY_START_HOUR = 6
#: a document is worth publishing only if something was measured this recently
FRESH_DAYS = 7
MAX_DAYS = 60

GAS_KEY = "live/gas.json"
# Daily updates: an hour in caches is nothing against a day of freshness.
GAS_META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")


class EntsogError(RuntimeError):
    """The platform answered with something other than data or an empty result."""


class GasDataError(ValueError):
    """The gas document is not publishable."""


@dataclass(frozen=True, slots=True, order=True)
class ProductionPoint:
    country: str
    key: str
    point_direction: str
    label: str
    operator_key: str
    operator_label: str


def _get(client: httpx.Client, resource: str, params: dict[str, str | int]) -> list[dict[str, Any]]:
    """The rows of one resource, or ``[]`` for the platform's 404-means-empty answer."""
    response = client.get(BASE_URL + resource, params=params)
    if response.status_code == 404:
        return []
    if response.status_code != 200:
        raise EntsogError(f"{resource}: HTTP {response.status_code}")
    try:
        document = response.json()
    except json.JSONDecodeError as exc:
        raise EntsogError(f"{resource}: not JSON ({exc})") from exc
    rows = document.get(resource) if isinstance(document, dict) else None
    if not isinstance(rows, list):
        raise EntsogError(f"{resource}: no '{resource}' list in the answer")
    return [row for row in rows if isinstance(row, dict)]


def _text(row: dict[str, Any], key: str) -> str:
    value = row.get(key)
    return value.strip() if isinstance(value, str) else ""


def production_points(client: httpx.Client, scope: frozenset[str]) -> list[ProductionPoint]:
    """Every production entry point of a transmission operator in ``scope``, sorted by country and key."""
    rows = _get(client, "operatorpointdirections", {"idPointType": PRODUCTION_POINT_TYPE, "limit": -1})
    points: dict[str, ProductionPoint] = {}
    for row in rows:
        country = _text(row, "tSOCountry").upper()
        point_direction = _text(row, "id")
        if country not in scope or _text(row, "directionKey") != "entry" or not point_direction:
            continue
        points[point_direction] = ProductionPoint(
            country=country,
            key=_text(row, "pointKey") or point_direction,
            point_direction=point_direction,
            label=_text(row, "pointLabel") or _text(row, "pointKey") or point_direction,
            operator_key=_text(row, "operatorKey"),
            operator_label=_text(row, "operatorLabel") or _text(row, "operatorKey"),
        )
    return sorted(points.values())


def _kwh(row: dict[str, Any]) -> float | None:
    if row.get("isNA") is True:
        return None
    value = row.get("value")
    if isinstance(value, bool) or value is None:
        return None
    number: float | None = None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str) and value.strip():
        try:
            number = float(value.strip())
        except ValueError:
            return None
    # NaN or infinity is no flow (Faza 31: it reached round() and crashed the run)
    return number if number is not None and math.isfinite(number) else None


def daily_flows(client: httpx.Client, point: ProductionPoint, start: date, end: date) -> dict[date, float]:
    """Physical flow per gas day in [start, end], in kWh/d. Days the platform has no figure for are absent."""
    rows = _get(
        client,
        "operationalData",
        {
            "indicator": "Physical Flow",
            "periodType": "day",
            "pointDirection": point.point_direction,
            "from": start.isoformat(),
            "to": end.isoformat(),
            "includeExemptions": 0,
            "limit": -1,
        },
    )
    flows: dict[date, float] = {}
    for row in rows:
        unit = _text(row, "unit")
        if unit and unit != UNIT:
            raise EntsogError(f"{point.point_direction}: unexpected unit {unit!r}, expected {UNIT!r}")
        try:
            day = date.fromisoformat(_text(row, "periodFrom")[:10])
        except ValueError:
            continue
        kwh = _kwh(row)
        if kwh is not None and start <= day <= end:
            flows[day] = kwh
    return flows


def gas_days(now: datetime, days: int = DEFAULT_DAYS) -> list[date]:
    """The last ``days`` complete gas days. Gas day D runs from D 06:00 to D+1 06:00 CET, so before
    06:00 the most recent complete day is the day before yesterday."""
    local = now.astimezone(TIMEZONE)
    last = local.date() - timedelta(days=1 if local.hour >= GAS_DAY_START_HOUR else 2)
    return [last - timedelta(days=offset) for offset in range(days - 1, -1, -1)]


def collect(
    client: httpx.Client, now: datetime, scope: frozenset[str], days: int = DEFAULT_DAYS
) -> dict[str, Any]:
    """One document for the map: per production point, the flow of each of the last gas days."""
    window = gas_days(now, days)
    points = production_points(client, scope)
    published: list[dict[str, Any]] = []
    missing_points: list[str] = []
    for point in points:
        flows = daily_flows(client, point, window[0], window[-1])
        values = [flows.get(day) for day in window]
        if all(value is None for value in values):
            missing_points.append(point.point_direction)
            continue
        published.append(
            {
                "key": point.key,
                "pointDirection": point.point_direction,
                "label": point.label,
                "country": point.country,
                "operator": point.operator_label,
                "kwhPerDay": [None if value is None else round(value) for value in values],
            }
        )
    covered = {point["country"] for point in published}
    return {
        "version": VERSION,
        "generatedAt": now.isoformat(),
        "source": "ENTSOG Transparency Platform",
        "unit": UNIT,
        "days": [day.isoformat() for day in window],
        "points": published,
        "missing": {"points": missing_points, "countries": sorted(scope - covered)},
    }


def validate(document: dict[str, Any]) -> None:
    days = document.get("days", [])
    if not 1 <= len(days) <= MAX_DAYS:
        raise GasDataError(f"expected 1-{MAX_DAYS} days, got {len(days)}")
    if document.get("unit") != UNIT:
        raise GasDataError(f"unit must be {UNIT!r}")
    fresh = False
    for point in document.get("points", []):
        values = point.get("kwhPerDay")
        if not isinstance(values, list) or len(values) != len(days) or not point.get("country"):
            raise GasDataError(f"malformed point {point.get('pointDirection')}")
        if any(value is not None for value in values[-FRESH_DAYS:]):
            fresh = True
    if not fresh:
        raise GasDataError(
            f"no production point reported anything in the last {FRESH_DAYS} days; keeping the published data"
        )


def publish_gas(store: ObjectStore, document: dict[str, Any]) -> None:
    """Validate, then replace the published gas document. A failed validation leaves the old one."""
    validate(document)
    store.put_bytes(GAS_KEY, json.dumps(document, separators=(",", ":")).encode(), GAS_META)
    log.info(
        "published gas production",
        extra={
            "points": len(document["points"]),
            "days": len(document["days"]),
            "missing": document["missing"],
        },
    )
