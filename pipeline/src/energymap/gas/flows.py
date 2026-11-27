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

The platform places its points on a drawing, not on the earth (``connectionpoints`` has ``tpMapX`` and
``tpMapY``, the drawing's own coordinates). Where a point is on the map comes from OpenStreetMap, point
by point (``PLACES``), each with the object it was read from.

Only countries whose whole system is one operator's are read (``OPERATORS``): where several operators share
a country, their common points would be counted twice, and each such country needs its own check first.
An entry is not consumption: gas that enters also leaves across the border and into storage.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
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
#: Slovenia and Hungary checked on 2026-11-19: Plinovodi and FGSZ report every point of their country
#: (the second Hungarian operator on the platform, MGT, reports no flows at all).
OPERATORS: dict[str, str] = {"HR": "HR-TSO-0001", "SI": "SI-TSO-0001", "HU": "HU-TSO-0001"}

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


class Place(BaseModel):
    """Where a point is on the earth, and the object that says so."""

    model_config = _CONFIG

    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    source: Literal["openstreetmap"]
    #: the OpenStreetMap object the position is read from
    source_id: str = Field(pattern=r"^(node|way|relation)/\d+$")
    license: Literal["ODbL-1.0"]
    #: the date of the extract it was read from
    retrieved_at: date
    #: which part of the object the position is
    what: str = Field(min_length=1)


def _osm(lon: float, lat: float, way: int, what: str, retrieved: date = date(2026, 11, 18)) -> Place:
    return Place(
        lon=lon,
        lat=lat,
        source="openstreetmap",
        source_id=f"way/{way}",
        license="ODbL-1.0",
        retrieved_at=retrieved,
        what=what,
    )


#: Point key → where it is. Read by hand from the pipelines of the build of 2026-11-19 (Geofabrik extracts
#: of 2026-11-18): the node at which the operator's pipeline ends at the border or at the terminal. A point
#: that is a sum over the country (production, consumers) has no place, and the storage has its own on the
#: map already (GIE AGSI). A point not listed here is simply not drawn.
PLACES: dict[str, Place] = {
    "LNG-00032": _osm(
        14.534393, 45.199449, 1042656312, "the terminal's end of Plinacro's connecting pipeline at Omišalj"
    ),
    "ITP-00042": _osm(
        15.7516, 46.209509, 854206570, "the border end of the Rogatec - Zabok pipeline (Plinacro)"
    ),
    "ITP-00011": _osm(
        18.112835, 45.775902, 848938794, "the border end of the Városföld - Slobodnica pipeline (Plinacro)"
    ),
}


@dataclass(frozen=True)
class Crossing:
    """A border crossing drawn on the map: the points that cross it at one place, each with the operator
    whose report is read. One side only, so that nothing is counted twice; ``country`` is that side."""

    id: str
    label: str
    country: str
    neighbour: str
    #: (operator key, point key), every point of the crossing
    parts: tuple[tuple[str, str], ...]
    #: where the pipeline crosses the border
    place: Place
    #: a point on the same pipeline a few kilometres inside ``country``: the way an arrow into it points
    inside: tuple[float, float]


#: the day the crossings below were read from OpenStreetMap (Overpass and the OSM API)
_CROSSINGS_READ = date(2026, 11, 27)


def _across(lon: float, lat: float, way: int, what: str) -> Place:
    return _osm(lon, lat, way, what, _CROSSINGS_READ)


#: The border crossings drawn on the map (2026-11-27). Points and operators from the survey of the region's
#: points (`energymap gas points`, run 45983693061); the place is where the OSM pipeline crosses the national
#: border (or, where OSM has the pipeline only up to the border station or the shore, its end there), and
#: ``inside`` the pipeline's own vertex up to 8 km into the reporting side, which was checked against OSM's
#: country areas. One side only: where both operators report a point, the one of HR, SI or HU, else the
#: operator downstream of the usual flow.
CROSSINGS: tuple[Crossing, ...] = (
    Crossing(
        "rogatec",
        "Rogatec",
        "HR",
        "SI",
        (("HR-TSO-0001", "ITP-00042"),),
        PLACES["ITP-00042"],
        (15.8497, 46.18654),
    ),
    Crossing(
        "dravaszerdahely",
        "Dravaszerdahely",
        "HR",
        "HU",
        (("HR-TSO-0001", "ITP-00011"),),
        PLACES["ITP-00011"],
        (18.173423, 45.740285),
    ),
    Crossing(
        "murfeld",
        "Murfeld / Ceršak",
        "SI",
        "AT",
        (("SI-TSO-0001", "ITP-00079"),),
        _across(15.67136, 46.707003, 1054766949, "where the pipeline crosses the border at Ceršak"),
        (15.67168, 46.705244),
    ),
    Crossing(
        "gorizia",
        "Gorizia / Šempeter",
        "SI",
        "IT",
        (("SI-TSO-0001", "ITP-00049"),),
        _across(13.610568, 45.901927, 1137951359, "where the pipeline crosses the border at Šempeter"),
        (13.619598, 45.915515),
    ),
    Crossing(
        "mosonmagyarovar",
        "Mosonmagyaróvár",
        "HU",
        "AT",
        (("HU-TSO-0001", "ITP-00043"),),
        _across(
            17.128109,
            47.989094,
            504007390,
            "where the Hungary - Austria gas pipeline (FGSZ) crosses the border",
        ),
        (17.204201, 47.943214),
    ),
    Crossing(
        "kiskundorozsma",
        "Kiskundorozsma / Horgoš",
        "HU",
        "RS",
        (("HU-TSO-0001", "ITP-00055"), ("HU-TSO-0001", "ITP-10013")),
        _across(20.011734, 46.176519, 654525019, "where the pipeline from Kiskundorozsma crosses the border"),
        (20.045146, 46.24071),
    ),
    Crossing(
        "csanadpalota",
        "Csanádpalota",
        "HU",
        "RO",
        (("HU-TSO-0001", "ITP-00032"),),
        _across(20.728179, 46.203747, 220422601, "where the BRUA pipeline crosses the border"),
        (20.629974, 46.215801),
    ),
    Crossing(
        "balassagyarmat",
        "Balassagyarmat / Veľké Zlievce",
        "HU",
        "SK",
        (("HU-TSO-0001", "ITP-00027"),),
        _across(
            19.314123, 48.087263, 994109656, "where the Vecsés - Balassagyarmat pipeline crosses the border"
        ),
        (19.257586, 48.025908),
    ),
    Crossing(
        "bereg",
        "Bereg",
        "HU",
        "UA",
        (("HU-TSO-0001", "ITP-10006"),),
        _across(22.548345, 48.204212, 1091485343, "the border end of FGSZ's pipeline at Beregdaróc"),
        (22.491903, 48.200316),
    ),
    Crossing(
        "arnoldstein",
        "Arnoldstein / Tarvisio",
        "AT",
        "IT",
        (("AT-TSO-0003", "ITP-00040"),),
        _across(13.648564, 46.532177, 595928607, "where the Trans Austria Gasleitung crosses the border"),
        (13.750473, 46.544356),
    ),
    Crossing(
        "baumgarten",
        "Baumgarten",
        "AT",
        "SK",
        (("AT-TSO-0001", "ITP-00062"), ("AT-TSO-0001", "ITP-00162"), ("AT-TSO-0003", "ITP-00037")),
        _across(16.897977, 48.329147, 1463906981, "where the pipelines from Baumgarten cross the March"),
        (16.876814, 48.317386),
    ),
    Crossing(
        "oberkappel",
        "Oberkappel",
        "AT",
        "DE",
        (("AT-TSO-0001", "ITP-00140"),),
        _across(13.74785, 48.556234, 795802402, "where the MEGAL pipeline crosses the border"),
        (13.751799, 48.554525),
    ),
    Crossing(
        "uberackern",
        "Überackern",
        "AT",
        "DE",
        (("AT-TSO-0001", "ITP-00019"), ("AT-TSO-0001", "ITP-00007")),
        _across(12.863838, 48.194725, 749003675, "where the Penta-West pipeline crosses the Salzach"),
        (12.956434, 48.171165),
    ),
    Crossing(
        "passo-gries",
        "Passo Gries",
        "IT",
        "CH",
        (("IT-TSO-0001", "ITP-00136"),),
        _across(8.381903, 46.450866, 1188120266, "where the pipeline crosses the border at Passo Gries"),
        (8.405443, 46.426944),
    ),
    Crossing(
        "melendugno",
        "Melendugno (TAP)",
        "IT",
        "AL",
        (("IT-TSO-0001", "ITP-00008"),),
        _across(18.392607, 40.310868, 849720568, "where the Trans Adriatic Pipeline comes ashore"),
        (18.313807, 40.275355),
    ),
    Crossing(
        "mazara",
        "Mazara del Vallo (TransMed)",
        "IT",
        "TN",
        (("IT-TSO-0001", "ITP-00093"),),
        _across(12.537001, 37.657168, 297343094, "where the Trans Mediterranean Pipeline comes ashore"),
        (12.621765, 37.680926),
    ),
    Crossing(
        "gela",
        "Gela (GreenStream)",
        "IT",
        "LY",
        (("IT-TSO-0001", "ITP-00074"),),
        _across(14.293201, 37.037351, 310845241, "where the GreenStream pipeline comes ashore"),
        (14.313194, 37.056874),
    ),
)


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
    #: where the point is on the map; None when it has no one place or none is known
    place: Place | None = None


class CountryFlows(BaseModel):
    model_config = _CONFIG

    operator_key: str
    operator: str
    points: list[Point]


class Border(BaseModel):
    """The net flow across one border crossing, from the side whose operator reports it."""

    model_config = _CONFIG

    #: stable, for the map and the page: "rogatec"
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    label: str = Field(min_length=1)
    #: the side the figures are from; a positive flow goes into it
    country: str = Field(pattern=r"^[A-Z]{2}$")
    neighbour: str = Field(pattern=r"^[A-Z]{2}$")
    #: the reporting operators' names, as the platform gives them
    operator: str = Field(min_length=1)
    points: list[str] = Field(min_length=1)
    place: Place
    #: lon, lat of a point on the pipeline inside ``country``
    inside: tuple[float, float]
    #: entry less exit, kWh/d, into ``country``; None: some point gave no figure that day
    net_kwh_per_day: list[float | None]
    status: list[Status | None]


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
    #: empty in a document written before the borders were (2026-11-27)
    borders: list[Border] = Field(default_factory=list)

    @model_validator(mode="after")
    def _columns_match_days(self) -> FlowDocument:
        for country, flows in self.countries.items():
            for point in flows.points:
                if len(point.kwh_per_day) != len(self.days) or len(point.status) != len(self.days):
                    raise ValueError(f"{country} {point.key} {point.direction}: not one value per day")
                if any(value is not None and value < 0 for value in point.kwh_per_day):
                    raise ValueError(f"{country} {point.key} {point.direction}: a negative flow")
        for border in self.borders:
            if len(border.net_kwh_per_day) != len(self.days) or len(border.status) != len(self.days):
                raise ValueError(f"border {border.id}: not one value per day")
        if len({border.id for border in self.borders}) != len(self.borders):
            raise ValueError("two borders with one id")
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


class _Series(BaseModel):
    """One point direction of one operator, a value and a mark per day of the window."""

    label: str
    kwh_per_day: list[float | None]
    status: list[Status | None]


class _Operator(BaseModel):
    label: str
    series: dict[tuple[str, Direction], _Series]


def operator_series(client: httpx.Client, operator_key: str, window: list[date]) -> _Operator | None:
    """Every point direction the operator reported a flow for in ``window``; None when it reported none."""
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
    series: dict[tuple[str, Direction], _Series] = {}
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
            (point_key, "entry" if direction == "entry" else "exit"),
            _Series(
                label=_text(row, "pointLabel") or point_key,
                kwh_per_day=[None] * len(window),
                status=[None] * len(window),
            ),
        )
        point.kwh_per_day[at] = round(kwh)
        point.status[at] = _status(row)
    if not series:
        return None
    return _Operator(label=operator, series=series)


def country_flows(
    client: httpx.Client, country: str, operator_key: str, reported: _Operator | None
) -> CountryFlows | None:
    """Every point direction of the country's operator with its flow on each day; None when the platform
    has nothing for it."""
    if reported is None:
        return None
    across = neighbours(client, country, operator_key)
    points = [
        Point(
            key=point_key,
            label=point.label,
            kind=kind_of(point_key),
            direction=direction,
            neighbour=across.get(point_key) if kind_of(point_key) in ("ITP", "VIP") else None,
            kwh_per_day=point.kwh_per_day,
            status=point.status,
            place=PLACES.get(point_key),
        )
        for (point_key, direction), point in sorted(reported.series.items())
    ]
    return CountryFlows(operator_key=operator_key, operator=reported.label, points=points)


def border_flow(crossing: Crossing, reported: dict[str, _Operator]) -> Border | None:
    """The net flow into ``crossing.country`` on each day: what its points took in less what they let out,
    as their operators report them. A day on which any of them gave no figure has none. None when none of
    them reported anything in the window."""
    signed: list[tuple[int, str, str, _Series]] = [
        (1 if direction == "entry" else -1, operator.label, point_key, series)
        for operator_key, point_key in crossing.parts
        if (operator := reported.get(operator_key)) is not None
        for direction in ("entry", "exit")
        if (series := operator.series.get((point_key, direction))) is not None
    ]
    if not signed:
        return None
    net: list[float | None] = []
    status: list[Status | None] = []
    for at in range(len(signed[0][3].kwh_per_day)):
        values = [series.kwh_per_day[at] for *_, series in signed]
        marks = [series.status[at] for *_, series in signed]
        if any(value is None for value in values):
            net.append(None)
            status.append(None)
            continue
        net.append(sum(sign * (value or 0.0) for (sign, *_), value in zip(signed, values, strict=True)))
        status.append("C" if all(mark == "C" for mark in marks) else "P" if "P" in marks else None)
    return Border(
        id=crossing.id,
        label=crossing.label,
        country=crossing.country,
        neighbour=crossing.neighbour,
        operator=" · ".join(sorted({label for _, label, _, _ in signed})),
        points=sorted({point_key for _, _, point_key, _ in signed}),
        place=crossing.place,
        inside=crossing.inside,
        net_kwh_per_day=net,
        status=status,
    )


def collect(client: httpx.Client, now: datetime, days: int = DEFAULT_DAYS) -> FlowDocument:
    """One document for the map: per country, each point's flow on each of the last gas days, and the net
    flow at each border crossing in ``CROSSINGS``. Each operator is asked once."""
    window = gas_days(now, days)
    wanted = sorted(set(OPERATORS.values()) | {key for crossing in CROSSINGS for key, _ in crossing.parts})
    reported = {
        operator_key: found
        for operator_key in wanted
        if (found := operator_series(client, operator_key, window)) is not None
    }
    countries: dict[str, CountryFlows] = {}
    missing: list[str] = []
    for country, operator_key in sorted(OPERATORS.items()):
        flows = country_flows(client, country, operator_key, reported.get(operator_key))
        if flows is None:
            missing.append(country)
        else:
            countries[country] = flows
    borders: list[Border] = []
    for crossing in CROSSINGS:
        border = border_flow(crossing, reported)
        if border is None:
            log.warning("gas border without flows", extra={"crossing": crossing.id})
        else:
            borders.append(border)
    return FlowDocument(
        version=VERSION,
        generated_at=now.isoformat(),
        source=SOURCE,
        source_url=SOURCE_URL,
        unit=UNIT,
        days=window,
        countries=countries,
        missing=missing,
        borders=borders,
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
