"""Installed generation capacity on the ENTSO-E Transparency Platform: a survey before anything is built.

Two data items are read, both published once a year for the year ahead (process type A33):

* ``documentType=A68`` "Installed Capacity per Production Type" (article 14.1.a): MW per production type
  (``psrType``) and control area;
* ``documentType=A71`` "Installed Capacity per Production Unit" (article 14.1.b): MW per unit of 100 MW or
  more, with the unit's EIC and name.

Which countries publish what, from which year, and how the units are named is not known from here; this
survey asks the platform for every country in scope and every year, and writes what came back. It publishes
nothing: the result goes to the job summary and to a file, and the layer or page is planned against it.
"""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from energymap.entsoe.client import AREAS, ITALY_ZONES, EntsoeClient, EntsoeError, NoData
from energymap.entsoe.parse import EntsoeParseError

log = logging.getLogger(__name__)

#: the first year the platform has data for
FIRST_YEAR = 2015
PER_TYPE = "A68"
PER_UNIT = "A71"
YEAR_AHEAD = "A33"

#: the platform's names of the production types, for the survey's table
PSR_NAMES: dict[str, str] = {
    "B01": "Biomass",
    "B02": "Lignite",
    "B03": "Coal-derived gas",
    "B04": "Gas",
    "B05": "Hard coal",
    "B06": "Oil",
    "B07": "Oil shale",
    "B08": "Peat",
    "B09": "Geothermal",
    "B10": "Hydro pumped storage",
    "B11": "Hydro run-of-river",
    "B12": "Hydro reservoir",
    "B13": "Marine",
    "B14": "Nuclear",
    "B15": "Other renewable",
    "B16": "Solar",
    "B17": "Waste",
    "B18": "Wind offshore",
    "B19": "Wind onshore",
    "B20": "Other",
    "B25": "Energy storage",
}


@dataclass(frozen=True, slots=True)
class Capacity:
    """One figure: MW of a production type (and of a unit, for A71) for the year its period starts in."""

    psr_type: str | None
    year: int
    mw: float
    unit_id: str | None = None
    unit_name: str | None = None


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(element: ET.Element, name: str) -> ET.Element | None:
    return next((c for c in element if _local(c.tag) == name), None)


def _text(element: ET.Element | None, *path: str) -> str | None:
    node = element
    for name in path:
        node = _child(node, name) if node is not None else None
    return node.text.strip() if node is not None and node.text else None


def parse_capacity(xml: bytes) -> list[Capacity]:
    """Every point of every time series; a period's year is the year of its start in UTC+1 (the platform
    writes a calendar year as 23:00Z of 31 December to 23:00Z of the next)."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise EntsoeParseError(f"not XML: {exc}") from exc
    kind = _local(root.tag)
    if kind == "Acknowledgement_MarketDocument":
        raise EntsoeParseError(f"acknowledgement instead of data: {_text(root, 'Reason', 'text')}")
    if kind not in {"GL_MarketDocument", "Publication_MarketDocument"}:
        raise EntsoeParseError(f"unexpected document {kind}")
    found: list[Capacity] = []
    for element in (c for c in root if _local(c.tag) == "TimeSeries"):
        psr = _child(element, "MktPSRType")
        resource = _child(psr, "PowerSystemResources") if psr is not None else None
        for period in (c for c in element if _local(c.tag) == "Period"):
            start = _text(period, "timeInterval", "start")
            if start is None:
                raise EntsoeParseError("missing timeInterval/start")
            try:
                begins = datetime.fromisoformat(start.replace("Z", "+00:00"))
            except ValueError as exc:
                raise EntsoeParseError(f"invalid timestamp {start!r}") from exc
            # 2024-12-31T23:00Z is the first hour of 2025 in central Europe
            year = (begins.astimezone(UTC) + timedelta(hours=1)).year
            for point in (c for c in period if _local(c.tag) == "Point"):
                quantity = _text(point, "quantity")
                if quantity is None:
                    continue
                try:
                    mw = float(quantity)
                except ValueError as exc:
                    raise EntsoeParseError(f"invalid quantity {quantity!r}") from exc
                found.append(
                    Capacity(
                        psr_type=_text(psr, "psrType") if psr is not None else None,
                        year=year,
                        mw=mw,
                        # the platform names the unit on the series itself (survey of 2026-11-27);
                        # MktPSRType/PowerSystemResources is the place the standard also allows
                        unit_id=_text(element, "registeredResource.mRID") or _text(resource, "mRID"),
                        unit_name=_text(element, "registeredResource.name") or _text(resource, "name"),
                    )
                )
    return found


def fields_of(xml: bytes) -> list[str]:
    """The element names of the document's first time series, nested ones with their path: what the platform
    actually sends, for the survey."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    first = next((c for c in root if _local(c.tag) == "TimeSeries"), None)
    if first is None:
        return []

    def walk(element: ET.Element, prefix: str) -> Iterator[str]:
        for child in element:
            name = f"{prefix}{_local(child.tag)}"
            if _local(child.tag) in {"Period", "Point"}:
                continue
            yield name
            yield from walk(child, f"{name}/")

    return sorted(set(walk(first, "")))


def _year_window(year: int) -> tuple[datetime, datetime]:
    return datetime(year - 1, 12, 31, 23, tzinfo=UTC), datetime(year, 12, 31, 23, tzinfo=UTC)


def _ask(client: EntsoeClient, document: str, eic: str, year: int) -> bytes | None:
    """The platform's answer for one area and year; None when it has nothing."""
    start, end = _year_window(year)
    try:
        return client.raw({"documentType": document, "processType": YEAR_AHEAD, "in_Domain": eic}, start, end)
    except NoData:
        return None


def _area_eics(country: str) -> list[str]:
    """The country's control area, and for Italy its bidding zones as well (Italy publishes per zone)."""
    return [AREAS[country], *ITALY_ZONES] if country == "IT" else [AREAS[country]]


def survey(client: EntsoeClient, now: datetime, countries: Iterable[str]) -> dict[str, Any]:
    """Per country and area: MW per production type for every year since FIRST_YEAR, and the units of the
    latest year that has any. A failure of one request is written down and the survey goes on."""
    years = list(range(FIRST_YEAR, now.year + 2))
    result: dict[str, Any] = {"generatedAt": now.isoformat(), "years": years, "countries": {}}
    for country in countries:
        areas: dict[str, Any] = {}
        for eic in _area_eics(country):
            area: dict[str, Any] = {"perType": {}, "noData": [], "errors": {}, "fields": [], "units": None}
            for year in years:
                try:
                    body = _ask(client, PER_TYPE, eic, year)
                    if body is None:
                        area["noData"].append(year)
                        continue
                    if not area["fields"]:
                        area["fields"] = fields_of(body)
                    by_type: dict[str, float] = {}
                    for row in parse_capacity(body):
                        if row.year == year:
                            key = row.psr_type or "?"
                            by_type[key] = by_type.get(key, 0.0) + row.mw
                    area["perType"][str(year)] = by_type
                except (EntsoeError, EntsoeParseError) as exc:
                    area["errors"][str(year)] = str(exc)
            area["units"] = _units(client, eic, years)
            areas[eic] = area
        result["countries"][country] = areas
        log.info("capacity survey", extra={"country": country, "areas": len(areas)})
    return result


def _units(client: EntsoeClient, eic: str, years: list[int]) -> dict[str, Any] | None:
    """The units of the latest year the platform has for the area, newest first; None when no year has any."""
    for year in reversed(years):
        try:
            body = _ask(client, PER_UNIT, eic, year)
        except EntsoeError as exc:
            return {"year": year, "error": str(exc), "units": [], "fields": []}
        if body is None:
            continue
        try:
            rows = [row for row in parse_capacity(body) if row.year == year]
        except EntsoeParseError as exc:
            return {"year": year, "error": str(exc), "units": [], "fields": fields_of(body)}
        units = sorted(
            (
                {"id": row.unit_id, "name": row.unit_name, "psrType": row.psr_type, "mw": row.mw}
                for row in rows
            ),
            key=lambda unit: -float(unit["mw"] or 0),
        )
        return {"year": year, "error": None, "units": units, "fields": fields_of(body)}
    return None


def markdown(document: dict[str, Any]) -> str:
    """The survey as tables for the job summary: per area the years with their total and largest types, then
    the largest units."""
    lines = ["## ENTSO-E: instalirana snaga (pregled)", ""]
    for country, areas in document["countries"].items():
        for eic, area in areas.items():
            lines += [f"### {country} · `{eic}`", ""]
            if area["noData"]:
                lines.append(f"Bez podataka za godine: {', '.join(str(y) for y in area['noData'])}.")
            for year, error in area["errors"].items():
                lines.append(f"Greška {year}: {error}")
            if area["fields"]:
                lines.append("Polja: " + ", ".join(f"`{name}`" for name in area["fields"]))
            if area["perType"]:
                lines += ["", "| Godina | Ukupno MW | Po vrsti (MW) |", "|---|---|---|"]
                for year, by_type in area["perType"].items():
                    parts = ", ".join(
                        f"{PSR_NAMES.get(psr, psr)} {mw:,.0f}"
                        for psr, mw in sorted(by_type.items(), key=lambda item: -item[1])
                    )
                    lines.append(f"| {year} | {sum(by_type.values()):,.0f} | {parts} |")
            units = area["units"]
            if units is None:
                lines += ["", "Jedinice (A71): nema ni za jednu godinu."]
            else:
                lines += [
                    "",
                    f"Jedinice (A71), {units['year']}: {len(units['units'])}"
                    + (f", greška: {units['error']}" if units["error"] else ""),
                ]
                if units["fields"]:
                    lines.append("Polja: " + ", ".join(f"`{name}`" for name in units["fields"]))
                if units["units"]:
                    lines += ["", "| Jedinica | EIC | Vrsta | MW |", "|---|---|---|---|"]
                    for unit in units["units"][:15]:
                        lines.append(
                            f"| {(unit['name'] or '').replace('|', '/')} | `{unit['id']}` | "
                            f"{PSR_NAMES.get(unit['psrType'] or '', unit['psrType'])} | {unit['mw']:,.0f} |"
                        )
            lines.append("")
    return "\n".join(lines) + "\n"
