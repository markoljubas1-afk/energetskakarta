"""The region's gas points on the ENTSOG Transparency Platform: a survey for the gas-flow layer (Faza 30).

Cross-border flows, LNG Krk and the Okoli storage need to be matched to places on the map, and ENTSOG
publishes no coordinates (see ``entsog``). Before any of that is drawn, this lists every point direction of
the transmission operators in scope with the fields the platform returns, and the latest daily flow of the
interconnection, LNG and storage points, so the matching is made against the real answer and not against
names remembered from elsewhere. It publishes nothing: the result goes to the job summary and to a file.

Point keys carry the kind of point as a prefix (``ITP-00078`` interconnection, ``LNG-…``, ``UGS-…`` storage,
``PRD-…`` production, ``VIP-…`` virtual interconnection), as in ENTSOG's own examples.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from datetime import date, datetime
from typing import Any

import httpx

from energymap.gas.entsog import UNIT, EntsogError, _get, _kwh, _text, gas_days, point_direction_of

log = logging.getLogger(__name__)

#: the kinds whose flows the map will need: interconnections (real and virtual), LNG and storage
FLOW_KINDS = frozenset({"ITP", "VIP", "LNG", "UGS"})
#: fields worth showing when the platform has them; every key it returns is listed as well
SHOWN = ("pointType", "idPointType", "adjacentCountry", "adjacentOperatorKey", "isCrossBorder", "hasData")
DEFAULT_DAYS = 4


@dataclass(frozen=True, slots=True)
class PointDirection:
    point_direction: str
    point_key: str
    label: str
    direction: str
    country: str
    operator: str
    kind: str
    fields: dict[str, Any]
    latest_day: str | None = None
    latest_kwh: float | None = None
    #: why the flow could not be read; the survey goes on with the other points
    error: str | None = None


def kind_of(point_key: str) -> str:
    """ "ITP-00078" → "ITP"; a key without a prefix → "?"."""
    prefix, _, rest = point_key.partition("-")
    return prefix.upper() if rest and prefix.isalpha() else "?"


def survey(
    client: httpx.Client, now: datetime, scope: frozenset[str], days: int = DEFAULT_DAYS
) -> dict[str, Any]:
    """Every point direction of the operators in ``scope``, with the latest flow of the ones the map needs."""
    rows = _get(client, "operatorpointdirections", {"limit": -1})
    window = gas_days(now, days)
    seen: dict[str, PointDirection] = {}
    keys: set[str] = set()
    for row in rows:
        country = _text(row, "tSOCountry").upper()
        point_direction = point_direction_of(row)
        if country not in scope or point_direction is None or point_direction in seen:
            continue
        keys.update(row)
        point_key = _text(row, "pointKey")
        seen[point_direction] = PointDirection(
            point_direction=point_direction,
            point_key=point_key,
            label=_text(row, "pointLabel") or point_key,
            direction=_text(row, "directionKey"),
            country=country,
            operator=_text(row, "operatorLabel") or _text(row, "operatorKey"),
            kind=kind_of(point_key),
            fields={name: row[name] for name in SHOWN if name in row},
        )
    if not seen:
        raise EntsogError(
            f"no point directions for {', '.join(sorted(scope))}: the answer is empty or changed"
        )
    points: list[PointDirection] = []
    for point in sorted(seen.values(), key=lambda p: (p.country, p.kind, p.label, p.direction)):
        if point.kind in FLOW_KINDS:
            # one point that fails is noted and the survey goes on (L-058); hundreds of requests are made here
            try:
                day, kwh = latest_flow(client, point.point_direction, window[0], window[-1])
                point = replace(point, latest_day=day, latest_kwh=kwh)
            except EntsogError as exc:
                log.warning(
                    "gas point flow unavailable", extra={"point": point.point_direction, "error": str(exc)}
                )
                point = replace(point, error=str(exc)[:200])
        points.append(point)
    log.info(
        "surveyed gas points",
        extra={"points": len(points), "with_flow": sum(1 for p in points if p.latest_kwh is not None)},
    )
    return {
        "generatedAt": now.isoformat(),
        "source": "ENTSOG Transparency Platform",
        "unit": UNIT,
        "days": [day.isoformat() for day in window],
        "fieldsReturned": sorted(keys),
        "points": [
            {
                "pointDirection": p.point_direction,
                "pointKey": p.point_key,
                "label": p.label,
                "direction": p.direction,
                "country": p.country,
                "operator": p.operator,
                "kind": p.kind,
                "fields": p.fields,
                "latestDay": p.latest_day,
                "latestKwhPerDay": p.latest_kwh,
                "error": p.error,
            }
            for p in points
        ],
    }


def latest_flow(
    client: httpx.Client, point_direction: str, start: date, end: date
) -> tuple[str | None, float | None]:
    """The last gas day in [start, end] with a physical flow at the point, and the flow in kWh/d."""
    rows = _get(
        client,
        "operationalData",
        {
            "indicator": "Physical Flow",
            "periodType": "day",
            "pointDirection": point_direction,
            "from": start.isoformat(),
            "to": end.isoformat(),
            "includeExemptions": 0,
            "limit": -1,
        },
    )
    best: tuple[date, float] | None = None
    for row in rows:
        unit = _text(row, "unit")
        if unit and unit != UNIT:
            raise EntsogError(f"{point_direction}: unexpected unit {unit!r}, expected {UNIT!r}")
        try:
            day = date.fromisoformat(_text(row, "periodFrom")[:10])
        except ValueError:
            continue
        kwh = _kwh(row)
        if kwh is not None and start <= day <= end and (best is None or day > best[0]):
            best = (day, kwh)
    return (best[0].isoformat(), best[1]) if best else (None, None)


def markdown(document: dict[str, Any]) -> str:
    """The survey as a table for the job summary, by country and kind; flows in GWh/d."""
    lines = [
        "## Plinske točke na ENTSOG-u (pregled za sloj tokova plina)",
        "",
        f"Dani: {document['days'][0]} do {document['days'][-1]}. Polja u odgovoru: "
        + ", ".join(f"`{name}`" for name in document["fieldsReturned"]),
        "",
        "| Zemlja | Vrsta | Točka | Smjer | Operator | Polja | Zadnji dan | GWh/d | pointDirection |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for point in document["points"]:
        flow = point["latestKwhPerDay"]
        fields = "; ".join(f"{name}={value}" for name, value in point["fields"].items())
        lines.append(
            "| "
            + " | ".join(
                [
                    point["country"],
                    point["kind"],
                    point["label"].replace("|", "/"),
                    point["direction"],
                    point["operator"].replace("|", "/"),
                    fields.replace("|", "/"),
                    point["latestDay"] or ("greška" if point.get("error") else ""),
                    "" if flow is None else f"{flow / 1e6:.1f}",
                    f"`{point['pointDirection']}`",
                ]
            )
            + " |"
        )
    return "\n".join(lines) + "\n"
