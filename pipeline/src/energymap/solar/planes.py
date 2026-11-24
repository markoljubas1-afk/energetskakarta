"""How much a roof loses to the way it faces, for the solar calculator (Faza 52).

The calculator's yearly yield is the Global Solar Atlas's, which counts a system facing south at the best
tilt. A real roof faces where the house faces. For each point of the same 1° grid as the daily shapes
(``home.py``), PVGIS 5.3 of the European Commission's Joint Research Centre is asked, for a set of
roof planes:

* ``PVcalc``: the yearly output of 1 kWp on that plane (14 % system losses, free-standing, as the atlas);
* ``DRcalc``: the long-term average irradiance on that plane hour by hour for an average day of each month,
  so that "a house with solar panels" sees an east roof make its electricity in the morning, not at noon;

and once ``PVcalc`` with ``optimalangles=1``, the best plane of the place. The website takes from this only
the RATIO plane / best: the amount stays the atlas's, so the two sources cannot disagree about a place.

The terrain horizon is switched off (``usehorizon=0``): the centre of a 1° cell can lie in a valley whose
mountains would bend the east-west ratio for the whole cell. A roof's own shade is the reader's to judge.

Nothing is estimated: a point PVGIS has nothing for (the sea) is left out; if fewer than a quarter of the
points answer, nothing is published. Each point is a small file of its own
(``solar/planes/{col}-{row}.json``), read by the website only when someone clicks near it.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

from energymap.publish import ObjectMeta, ObjectStore
from energymap.solar import home

log = logging.getLogger(__name__)

VERSION = 1
PREFIX = "solar/planes/"
META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")

PVCALC_URL = "https://re.jrc.ec.europa.eu/api/v5_3/PVcalc"
#: PVGIS's own default for the losses of a whole system (cables, inverter, dirt)
SYSTEM_LOSS_PERCENT = 14

#: PVGIS's azimuth ("aspect"): 0 is south, negative towards the east, positive towards the west
AZIMUTH: dict[str, int] = {"S": 0, "SE": -45, "SW": 45, "E": -90, "W": 90}
SLOPES: tuple[int, ...] = (15, 30, 45)
#: a flat roof: panels are set on racks, as they are on flat roofs, tilted a little towards the south
FLAT_SLOPE = 10


@dataclass(frozen=True)
class Plane:
    id: str
    facing: str
    slope_deg: int
    azimuth_deg: int


def planes() -> list[Plane]:
    """Every plane the calculator offers: five directions at three tilts, and a flat roof."""
    sloped = [
        Plane(f"{facing}-{slope}", facing, slope, azimuth)
        for facing, azimuth in AZIMUTH.items()
        for slope in SLOPES
    ]
    return [*sloped, Plane("flat", "flat", FLAT_SLOPE, AZIMUTH["S"])]


class PlanesDataError(RuntimeError):
    """PVGIS did not say what this module was written against; nothing is published."""


def _common(lon: float, lat: float) -> dict[str, str | int]:
    return {"lat": f"{lat:.3f}", "lon": f"{lon:.3f}", "usehorizon": 0, "outputformat": "json"}


def yearly_output(document: Mapping[str, Any]) -> tuple[float, int, int]:
    """PVcalc's yearly kWh of the fixed system, with the plane it was computed for (slope, azimuth)."""
    try:
        fixed = document["outputs"]["totals"]["fixed"]
        mounting = document["inputs"]["mounting_system"]["fixed"]
        value = float(fixed["E_y"])
        slope = int(mounting["slope"]["value"])
        azimuth = int(mounting["azimuth"]["value"])
    except (KeyError, TypeError, ValueError) as error:
        raise PlanesDataError(f"PVGIS PVcalc: unexpected answer ({error!r})") from error
    if not value > 0:
        raise PlanesDataError(f"PVGIS PVcalc: a yearly output of {value}")
    return value, slope, azimuth


#: a run makes some 6 000 calls: PVGIS dropping one connection, or a moment of overload, is tried again
ATTEMPTS = 4
RETRY_STATUS = frozenset({429, 500, 502, 503, 504})


def _get(
    client: httpx.Client,
    url: str,
    params: Mapping[str, str | int],
    wait: Callable[[float], None] = time.sleep,
) -> dict[str, Any] | None:
    for attempt in range(1, ATTEMPTS + 1):
        try:
            response = client.get(url, params=params)
        except httpx.TransportError as error:
            if attempt == ATTEMPTS:
                raise
            log.warning("PVGIS: trying again", extra={"pvgis": {"attempt": attempt, "error": repr(error)}})
            wait(5.0 * attempt)
            continue
        if response.status_code in RETRY_STATUS and attempt < ATTEMPTS:
            log.warning(
                "PVGIS: trying again", extra={"pvgis": {"attempt": attempt, "status": response.status_code}}
            )
            wait(5.0 * attempt)
            continue
        if response.status_code == 400:
            # PVGIS answers 400 with a message for a place it has nothing for; anything else is a failure
            return None
        response.raise_for_status()
        document: dict[str, Any] = response.json()
        return document
    raise AssertionError("unreachable: the last attempt returns or raises")


def fetch_cell(
    client: httpx.Client,
    lon: float,
    lat: float,
    year: int,
    pause: Callable[[], None] = lambda: None,
) -> dict[str, Any] | None:
    """The best plane and every offered plane of one place; ``None`` where PVGIS has nothing for it."""
    pvcalc: dict[str, str | int] = {"peakpower": 1, "loss": SYSTEM_LOSS_PERCENT, "mountingplace": "free"}
    best = _get(client, PVCALC_URL, {**_common(lon, lat), **pvcalc, "optimalangles": 1})
    pause()
    if best is None:
        log.info("no PVGIS data", extra={"pvgis": {"lon": lon, "lat": lat}})
        return None
    best_kwh, best_slope, best_azimuth = yearly_output(best)
    out: list[dict[str, Any]] = []
    for plane in planes():
        where = {**_common(lon, lat), "angle": plane.slope_deg, "aspect": plane.azimuth_deg}
        energy = _get(client, PVCALC_URL, {**where, **pvcalc})
        pause()
        shape = _get(client, home.PVGIS_URL, {**where, "month": 0, "global": 1})
        pause()
        if energy is None or shape is None:
            # the best plane answered: a plane of the same place that does not is not "no data here"
            raise PlanesDataError(f"PVGIS: no answer for plane {plane.id} at {lon}, {lat}")
        kwh, slope, azimuth = yearly_output(energy)
        if (slope, azimuth) != (plane.slope_deg, plane.azimuth_deg):
            raise PlanesDataError(f"PVGIS PVcalc computed {slope}°/{azimuth}° for plane {plane.id}")
        out.append(
            {
                "id": plane.id,
                "facing": plane.facing,
                "slopeDeg": plane.slope_deg,
                "azimuthDeg": plane.azimuth_deg,
                "yearlyKwh": round(kwh, 1),
                "shape": home.day_shapes(shape, year),
            }
        )
    return {
        "best": {"slopeDeg": best_slope, "azimuthDeg": best_azimuth, "yearlyKwh": round(best_kwh, 1)},
        "planes": out,
    }


def check(cell: Mapping[str, Any]) -> None:
    """What a roof's orientation does, as every PV text says it: a plane can't beat the best one, and the
    east loses to the south. A PVGIS answer that says otherwise was not read the way this module thinks."""
    best = float(cell["best"]["yearlyKwh"])
    by_id = {plane["id"]: float(plane["yearlyKwh"]) for plane in cell["planes"]}
    # PVGIS rounds the optimal angles to whole degrees: a plane may come out a hair above "the best"
    if any(kwh > best * 1.005 for kwh in by_id.values()):
        raise PlanesDataError(f"PVGIS: a plane above the best plane ({best} kWh)")
    if not by_id["E-30"] < by_id["S-30"] or not by_id["W-30"] < by_id["S-30"]:
        raise PlanesDataError("PVGIS: an east or west roof above the south roof")


def collect(
    client: httpx.Client, year: int, pause: Callable[[], None] = lambda: None
) -> dict[tuple[int, int], dict[str, Any]]:
    spec = home.grid()
    cols = int(spec["cols"])
    cells: dict[tuple[int, int], dict[str, Any]] = {}
    points = home.grid_points(spec)
    for index, (lon, lat) in enumerate(points):
        cell = fetch_cell(client, lon, lat, year, pause)
        if cell is None:
            continue
        check(cell)
        cells[(index % cols, index // cols)] = {"lon": lon, "lat": lat, **cell}
    if len(cells) < len(points) // 4:
        raise PlanesDataError(f"PVGIS answered for {len(cells)} of {len(points)} points: not publishing")
    return cells


def key(col: int, row: int) -> str:
    return f"{PREFIX}{col}-{row}.json"


def documents(cells: Mapping[tuple[int, int], Mapping[str, Any]], now: datetime) -> dict[str, dict[str, Any]]:
    return {
        key(col, row): {
            "version": VERSION,
            "generatedAt": now.isoformat(),
            "source": home.PVGIS_SOURCE,
            "sourceUrl": home.PVGIS_SOURCE_URL,
            "license": home.PVGIS_LICENSE,
            "attribution": home.PVGIS_ATTRIBUTION,
            "systemLossPercent": SYSTEM_LOSS_PERCENT,
            "cell": {"col": col, "row": row, "lon": cell["lon"], "lat": cell["lat"]},
            "best": cell["best"],
            "planes": cell["planes"],
        }
        for (col, row), cell in sorted(cells.items())
    }


def publish(store: ObjectStore, docs: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    """Every cell, after all of them were read and checked: a failed run publishes none."""
    for name, document in docs.items():
        store.put_bytes(name, json.dumps(document, separators=(",", ":")).encode(), META)
    summary = {"prefix": PREFIX, "cells": len(docs), "planes": len(planes())}
    log.info("published the roof planes", extra={"planes": summary})
    return summary
