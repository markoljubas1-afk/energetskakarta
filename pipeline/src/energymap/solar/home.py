"""The two daily shapes behind "a house with solar panels" in the solar calculator (Faza 42).

* **The sun.** PVGIS 5.3 of the European Commission's Joint Research Centre gives, for a place and a fixed
  plane, the long-term average irradiance on that plane for each hour of an average day of each month
  (``DRcalc``, database PVGIS-SARAH3). It is read for a grid of points over the map's region and kept as a
  *shape* only: the website scales it to the yearly yield the calculator already shows (Global Solar Atlas),
  so the two figures cannot disagree. PVGIS may not be called from a browser, which is why this is done here.
* **The household.** HEP ODS publishes for each year the standard load curve of the household group (K0)
  for every quarter of an hour, with its seasonal factor, normalised to 1000 kWh a year. It is averaged to
  one day per month, hour by hour. It is the curve of a group, not of one home, and the website says so.

Nothing is estimated here: a point over the sea has no shape (PVGIS says so) and is published as ``null``;
a month without a full set of hours, or a curve that does not add up to its 1000 kWh, stops the run and
leaves what is published as it was.
"""

from __future__ import annotations

import io
import json
import logging
from collections.abc import Callable, Mapping
from datetime import datetime, time
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import openpyxl

from energymap import config
from energymap.publish import ObjectMeta, ObjectStore

log = logging.getLogger(__name__)

VERSION = 1
KEY = "solar/home.json"
META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")
TIMEZONE = "Europe/Zagreb"

PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_3/DRcalc"
PVGIS_SOURCE = "PVGIS 5.3 (European Commission, Joint Research Centre), database PVGIS-SARAH3"
PVGIS_SOURCE_URL = "https://re.jrc.ec.europa.eu/pvg_tools/en/"
PVGIS_LICENSE = "CC-BY-4.0"
PVGIS_ATTRIBUTION = "PVGIS © European Communities, 2001-2026"
#: the plane the shape is for: PVGIS's own example of a fixed roof system, facing south
SLOPE_DEG = 35
AZIMUTH_DEG = 0
#: one point per degree: the shape of a day changes slowly with the place (the amount comes from the atlas)
GRID_STEP = 1.0

HEP_PAGE = (
    "https://www.hep.hr/ods/opskrbljivaci/pravila-primjene-nadomjesnih-krivulja-opterecenja/"
    "podaci-za-izracun-{year}/"
)
HEP_FILE = "https://www.hep.hr/ods/UserDocsImages/dokumenti/NKO_dokumenti/{year}/NKO_KSK{year}.xlsx"
HEP_SOURCE = "HEP ODS, nadomjesne krivulje opterećenja (NKO KSK), skupina kućanstvo K0"
#: reuse allowed by HEP ODS (owner's confirmation 2026-11-18; no public licence, as for the capacity data)
HEP_LICENSE = "HEP-ODS-permission"
#: the column the curve is read from, as HEP ODS heads it (the file misspells "NKO" as "NK0")
HEP_COLUMN_WORDS = ("K0", "dinamiziranja", "pomno")
NORMALISED_KWH = 1000.0
#: this many rows without a value in a row end a sheet
BLANK_ROWS_END = 200
#: how far the year's sum may be from the 1000 kWh it is normalised to before the file is refused
NORMALISED_TOLERANCE = 0.02

MONTHS = 12
HOURS = 24


class HomeDataError(RuntimeError):
    """A source did not say what this module was written against; nothing is published."""


# ---------------------------------------------------------------- the sun


def grid() -> dict[str, float | int]:
    """The points the sun's shape is read for: cell centres over the region, west to east, south to north."""
    west, south, east, north = config.REGION_BBOX
    cols = int((east - west) / GRID_STEP)
    rows = int((north - south) / GRID_STEP)
    return {"west": west, "south": south, "step": GRID_STEP, "cols": cols, "rows": rows}


def grid_points(spec: Mapping[str, float | int]) -> list[tuple[float, float]]:
    """(lon, lat) of every cell centre, row by row from the south-west."""
    step = float(spec["step"])
    return [
        (float(spec["west"]) + (col + 0.5) * step, float(spec["south"]) + (row + 0.5) * step)
        for row in range(int(spec["rows"]))
        for col in range(int(spec["cols"]))
    ]


def _utc_offset_hours(month: int, year: int) -> int:
    """Hours the region's clocks are ahead of UTC in the middle of a month (1 in winter, 2 in summer)."""
    offset = datetime(year, month, 15, 12, tzinfo=ZoneInfo(TIMEZONE)).utcoffset()
    if offset is None:
        raise HomeDataError(f"no UTC offset for {TIMEZONE}")
    return round(offset.total_seconds() / 3600)


def day_shapes(document: Mapping[str, Any], year: int) -> list[list[int]]:
    """PVGIS's answer for one place as 12 months by 24 local hours of W/m² on the plane (whole numbers)."""
    rows = document.get("outputs", {}).get("daily_profile")
    if not isinstance(rows, list) or len(rows) != MONTHS * HOURS:
        raise HomeDataError("PVGIS: expected 288 rows of daily_profile")
    shapes = [[0.0] * HOURS for _ in range(MONTHS)]
    seen: set[tuple[int, int]] = set()
    for row in rows:
        month = int(row["month"])
        hour_utc = int(str(row["time"])[:2])
        value = float(row["G(i)"])
        if not (1 <= month <= MONTHS and 0 <= hour_utc < HOURS) or value < 0 or value != value:
            raise HomeDataError(f"PVGIS: unusable row {row!r}")
        seen.add((month, hour_utc))
        local = (hour_utc + _utc_offset_hours(month, year)) % HOURS
        shapes[month - 1][local] = value
    if len(seen) != MONTHS * HOURS:
        raise HomeDataError("PVGIS: a month does not have its 24 hours")
    if any(sum(month) <= 0 for month in shapes):
        raise HomeDataError("PVGIS: a month without any sun")
    return [[round(value) for value in month] for month in shapes]


def fetch_point(client: httpx.Client, lon: float, lat: float, year: int) -> list[list[int]] | None:
    """The shapes of one place; ``None`` where PVGIS has no data (the sea, outside its coverage)."""
    response = client.get(
        PVGIS_URL,
        params={
            "lat": f"{lat:.3f}",
            "lon": f"{lon:.3f}",
            "month": 0,
            "global": 1,
            "angle": SLOPE_DEG,
            "aspect": AZIMUTH_DEG,
            "outputformat": "json",
        },
    )
    if response.status_code == 400:
        # PVGIS answers 400 with a message for a place it has nothing for; anything else is a failure
        log.info("no PVGIS data", extra={"pvgis": {"lon": lon, "lat": lat, "message": response.text[:200]}})
        return None
    response.raise_for_status()
    return day_shapes(response.json(), year)


def collect_sun(client: httpx.Client, year: int, pause: Callable[[], None] = lambda: None) -> dict[str, Any]:
    spec = grid()
    points: list[list[list[int]] | None] = []
    for lon, lat in grid_points(spec):
        points.append(fetch_point(client, lon, lat, year))
        pause()
    found = sum(1 for point in points if point is not None)
    if found < len(points) // 4:
        raise HomeDataError(f"PVGIS answered for {found} of {len(points)} points: not publishing")
    return {
        "source": PVGIS_SOURCE,
        "sourceUrl": PVGIS_SOURCE_URL,
        "license": PVGIS_LICENSE,
        "attribution": PVGIS_ATTRIBUTION,
        "plane": {"slopeDeg": SLOPE_DEG, "azimuthDeg": AZIMUTH_DEG},
        "unit": "W/m2",
        "grid": spec,
        "points": points,
    }


# ---------------------------------------------------------------- the household


def _minutes(value: object) -> int | None:
    """Minutes into the day of a cell of the time column (the file mixes times and 1900-dated datetimes)."""
    if isinstance(value, datetime):
        return value.hour * 60 + value.minute
    if isinstance(value, time):
        return value.hour * 60 + value.minute
    return None


def household_curve(workbook: bytes, year: int) -> dict[str, Any]:
    """HEP ODS's K0 curve as 12 months by 24 hours of average watts per 1000 kWh a year."""
    book = openpyxl.load_workbook(io.BytesIO(workbook), read_only=True, data_only=True)
    sums = [[0.0] * HOURS for _ in range(MONTHS)]
    counts = [[0] * HOURS for _ in range(MONTHS)]
    quarter_hours = 0
    energy_wh = 0.0
    for sheet in book.worksheets:
        column: int | None = None
        blank = 0
        for row in sheet.iter_rows(values_only=True):
            if column is None:
                for index, cell in enumerate(row):
                    if isinstance(cell, str) and all(word in cell for word in HEP_COLUMN_WORDS):
                        column = index
                continue
            if len(row) <= column:
                continue
            day, minutes, value = row[1], _minutes(row[2]), row[column]
            if not isinstance(day, datetime) or minutes is None or not isinstance(value, int | float):
                # one sheet of the 2026 file declares a million empty rows after its data: stop at the gap
                blank += 1
                if blank > BLANK_ROWS_END:
                    break
                continue
            blank = 0
            if day.year != year or value < 0:
                raise HomeDataError(f"HEP ODS: unusable row in sheet {sheet.title!r}: {row[:4]!r}")
            sums[day.month - 1][minutes // 60] += float(value)
            counts[day.month - 1][minutes // 60] += 1
            quarter_hours += 1
            energy_wh += float(value) / 4
        if column is None:
            raise HomeDataError(f"HEP ODS: sheet {sheet.title!r} has no K0 column with the seasonal factor")
    if any(count == 0 for month in counts for count in month):
        raise HomeDataError("HEP ODS: an hour of a month has no value")
    yearly_kwh = energy_wh / 1000
    if abs(yearly_kwh - NORMALISED_KWH) > NORMALISED_KWH * NORMALISED_TOLERANCE:
        raise HomeDataError(
            f"HEP ODS: the curve adds up to {yearly_kwh:.1f} kWh a year, not the {NORMALISED_KWH:.0f} it is "
            "normalised to"
        )
    return {
        "source": HEP_SOURCE,
        "sourceUrl": HEP_PAGE.format(year=year),
        "license": HEP_LICENSE,
        "year": year,
        "group": "K0",
        "unit": "W per 1000 kWh/year",
        "quarterHours": quarter_hours,
        "months": [
            [round(total / count, 1) for total, count in zip(month, month_counts, strict=True)]
            for month, month_counts in zip(sums, counts, strict=True)
        ],
    }


def fetch_household(client: httpx.Client, year: int) -> dict[str, Any]:
    response = client.get(HEP_FILE.format(year=year))
    response.raise_for_status()
    return household_curve(response.content, year)


# ---------------------------------------------------------------- the document


def build(sun: Mapping[str, Any], household: Mapping[str, Any], now: datetime) -> dict[str, Any]:
    return {
        "version": VERSION,
        "generatedAt": now.isoformat(),
        "timezone": TIMEZONE,
        "sun": dict(sun),
        "household": dict(household),
    }


def publish_home(store: ObjectStore, document: Mapping[str, Any]) -> dict[str, Any]:
    points = document["sun"]["points"]
    store.put_bytes(KEY, json.dumps(document, separators=(",", ":")).encode(), META)
    summary = {
        "key": KEY,
        "points": len(points),
        "withSun": sum(1 for point in points if point is not None),
        "householdYear": document["household"]["year"],
    }
    log.info("published the home shapes", extra={"home": summary})
    return summary
