"""Geothermal potential as heat flow (mW/m²) on a regular grid, from the Global Heat Flow Database.

Source: IHFC Global Heat Flow Database, release 2024 (CC BY 4.0), one Excel sheet whose first six rows are
header information (row 6 holds the column names) and whose data starts in row 7. Parent rows carry the
site's heat flow in ``q``; child rows (``qc`` only) are individual measurements and are not used twice.

The grid is inverse-distance weighted (power 2) over measurements within ``RADIUS_KM`` of a cell's centre,
and a cell needs at least ``MIN_POINTS`` measurements: away from measurements there is no value rather than
an extrapolated one. This is an orientation map, not a substitute for exploration; the map says so.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from io import BytesIO
from typing import Any

import openpyxl

from energymap.geothermal.sites import GeothermalDataError

SOURCE_URL = "https://www.ihfc-iugg.org/user/downloads/data/R2024/IHFC_2024_GHFDB.xlsx"
SOURCE_NAME = "Global Heat Flow Database (IHFC), release 2024"
SOURCE_DOI = "https://doi.org/10.5880/fidgeo.2024.014"
LICENSE = "CC-BY-4.0"
# west, south, east, north: the map's region with a margin, so cells at its edge see measurements beyond it
REGION = (12.0, 41.5, 21.5, 47.5)
CELL_DEG = 0.1
RADIUS_KM = 75.0
MIN_POINTS = 3
# beyond this, a value is a typo or a hot-spring borehole that says nothing about the area
MAX_Q = 250.0
# fewer measurements in the region than this means the download is not what we expect
MIN_REGION_POINTS = 20
HEADER_ROW = 6


@dataclass(frozen=True, slots=True)
class Point:
    lon: float
    lat: float
    q: float


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def read_points(rows: Iterable[tuple[Any, ...]]) -> list[Point]:
    """Rows of the sheet (header row 6, data from row 7) → parent measurements inside the region."""
    iterator: Iterator[tuple[Any, ...]] = iter(rows)
    header: tuple[Any, ...] | None = None
    for number, row in enumerate(iterator, start=1):
        if number == HEADER_ROW:
            header = row
            break
    if header is None:
        raise GeothermalDataError("heat-flow sheet is shorter than its header")
    names = [str(cell).strip() if cell is not None else "" for cell in header]
    try:
        q_col, lat_col, lon_col = names.index("q"), names.index("lat_NS"), names.index("long_EW")
    except ValueError as exc:
        raise GeothermalDataError(f"heat-flow sheet lacks q, lat_NS or long_EW in row {HEADER_ROW}") from exc
    west, south, east, north = REGION
    points = []
    for row in iterator:
        q = _number(row[q_col]) if q_col < len(row) else None
        lat = _number(row[lat_col]) if lat_col < len(row) else None
        lon = _number(row[lon_col]) if lon_col < len(row) else None
        if q is None or lat is None or lon is None or not 0 < q <= MAX_Q:
            continue
        if west <= lon <= east and south <= lat <= north:
            points.append(Point(lon, lat, q))
    return points


def read_workbook(data: bytes) -> list[Point]:
    try:
        workbook = openpyxl.load_workbook(BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:  # openpyxl raises many unrelated types for broken files
        raise GeothermalDataError(f"heat-flow download is not a readable workbook: {exc}") from exc
    try:
        sheet = workbook.worksheets[0]
        return read_points(sheet.iter_rows(values_only=True))
    finally:
        workbook.close()


def _km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    dx = (lon2 - lon1) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * 110.57
    return math.hypot(dx, dy)


def grid(points: list[Point]) -> list[list[float]]:
    """Cells as [lon, lat, q, n] (cell centre, mW/m² rounded, measurements used)."""
    if len(points) < MIN_REGION_POINTS:
        raise GeothermalDataError(f"only {len(points)} heat-flow measurements in the region")
    west, south, east, north = REGION
    cells = []
    columns = round((east - west) / CELL_DEG)
    rows = round((north - south) / CELL_DEG)
    for j in range(rows):
        lat = round(south + (j + 0.5) * CELL_DEG, 4)
        for i in range(columns):
            lon = round(west + (i + 0.5) * CELL_DEG, 4)
            weights = 0.0
            total = 0.0
            used = 0
            for point in points:
                distance = _km(lon, lat, point.lon, point.lat)
                if distance > RADIUS_KM:
                    continue
                weight = 1.0 / max(distance, 1.0) ** 2
                weights += weight
                total += weight * point.q
                used += 1
            if used >= MIN_POINTS:
                cells.append([lon, lat, round(total / weights), used])
    return cells


def heat_flow_document(points: list[Point]) -> dict[str, Any]:
    return {
        "source": SOURCE_NAME,
        "url": SOURCE_DOI,
        "license": LICENSE,
        "cellDeg": CELL_DEG,
        "radiusKm": RADIUS_KM,
        "minPoints": MIN_POINTS,
        "points": len(points),
        "cells": grid(points),
    }
