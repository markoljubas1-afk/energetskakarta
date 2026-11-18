"""The daily shapes of sun and of a household behind the house in the solar calculator (Faza 42)."""

from __future__ import annotations

import io
import json
from datetime import UTC, datetime, time, timedelta
from typing import Any

import httpx
import openpyxl
import pytest

from energymap.publish import MemoryStore
from energymap.solar import home

YEAR = 2026
HEADER = [
    "rbr. dana u godini",
    "datum",
    "vrijeme",
    "faktor dinamiziranja",
    "NKO za kućanstva - K0",
    "NKO za poduzetništvo - P0",
    "NKO za poduzetništvo, javna rasvjeta - JR0 ",
    "NK0 za kućanstva - K0 pomnožen s faktorom dinamiziranja",
]
#: 1000 kWh a year at a constant power, in watts
FLAT_W = 1000 * 1000 / (365 * 24)


def workbook(power: Any = lambda day, minutes: FLAT_W, *, skip_month: int | None = None) -> bytes:
    """A year of quarter-hours in HEP ODS's layout: a sheet per month, a title row, the header, the rows."""
    book = openpyxl.Workbook(write_only=True)
    sheets = [book.create_sheet(f"mjesec {month}") for month in range(1, 13)]
    for sheet in sheets:
        sheet.append([None] * 8)
        sheet.append(HEADER)
    day = datetime(YEAR, 1, 1)
    while day.year == YEAR:
        if day.month != skip_month:
            for quarter in range(96):
                minutes = quarter * 15
                # the real file writes some times as datetimes of the year 1900
                stamp: Any = time(minutes // 60, minutes % 60)
                if quarter % 2:
                    stamp = datetime(1900, 1, 1, minutes // 60, minutes % 60)
                value = power(day, minutes)
                sheets[day.month - 1].append([None, day, stamp, 1.0, value, 80.0, 170.0, value])
        day += timedelta(days=1)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def pvgis(scale: float = 1.0) -> dict[str, Any]:
    """PVGIS's answer: sun from 05:00 to 18:00 UTC with a peak at 11:00 UTC, the same in every month."""
    rows = [
        {"month": month, "time": f"{hour:02d}:00", "G(i)": scale * max(0, 700 - 100 * abs(hour - 11))}
        for month in range(1, 13)
        for hour in range(24)
    ]
    return {"inputs": {}, "outputs": {"daily_profile": rows}}


def test_the_household_curve_is_averaged_by_month_and_hour() -> None:
    def power(day: datetime, minutes: int) -> float:
        # evenings twice the rest, so that the hours differ; scaled to 1000 kWh a year
        return FLAT_W * (2.0 if minutes >= 18 * 60 else 1.0) / 1.25

    curve = home.household_curve(workbook(power), YEAR)
    assert curve["group"] == "K0"
    assert curve["quarterHours"] == 365 * 96
    assert len(curve["months"]) == 12 and all(len(month) == 24 for month in curve["months"])
    assert curve["months"][0][3] == pytest.approx(FLAT_W / 1.25, abs=0.06)
    assert curve["months"][6][20] == pytest.approx(2 * FLAT_W / 1.25, abs=0.06)
    assert curve["license"] == "HEP-ODS-permission"
    assert curve["sourceUrl"].endswith("podaci-za-izracun-2026/")


def test_a_curve_that_is_not_the_normalised_one_is_refused() -> None:
    with pytest.raises(home.HomeDataError, match="adds up to"):
        home.household_curve(workbook(lambda day, minutes: FLAT_W * 1.2), YEAR)


def test_a_month_without_values_is_refused() -> None:
    # eleven months at a power that still adds up to 1000 kWh: only the gap is wrong
    with pytest.raises(home.HomeDataError, match="has no value"):
        home.household_curve(workbook(lambda day, minutes: FLAT_W * 365 / 335, skip_month=4), YEAR)


def test_a_file_without_the_column_is_refused() -> None:
    book = openpyxl.Workbook(write_only=True)
    book.create_sheet("siječanj").append(["datum", "vrijeme", "nešto drugo"])
    out = io.BytesIO()
    book.save(out)
    with pytest.raises(home.HomeDataError, match="no K0 column"):
        home.household_curve(out.getvalue(), YEAR)


def test_the_sun_is_moved_from_utc_to_the_regions_clock() -> None:
    shapes = home.day_shapes(pvgis(), YEAR)
    assert len(shapes) == 12 and all(len(month) == 24 for month in shapes)
    # 11:00 UTC is noon in January (UTC+1) and 13:00 in July (UTC+2)
    assert shapes[0].index(max(shapes[0])) == 12
    assert shapes[6].index(max(shapes[6])) == 13
    assert shapes[0][2] == 0 and shapes[6][23] == 0
    assert all(isinstance(value, int) for month in shapes for value in month)


@pytest.mark.parametrize(
    "broken",
    [
        {"outputs": {"daily_profile": pvgis()["outputs"]["daily_profile"][:-1]}},
        {"outputs": {}},
        pvgis(scale=0.0),
        {
            "outputs": {
                "daily_profile": [
                    {**row, "G(i)": -1.0} if index == 100 else row
                    for index, row in enumerate(pvgis()["outputs"]["daily_profile"])
                ]
            }
        },
    ],
)
def test_an_answer_that_is_not_a_full_year_of_days_is_refused(broken: dict[str, Any]) -> None:
    with pytest.raises(home.HomeDataError):
        home.day_shapes(broken, YEAR)


def test_the_grid_covers_the_region_with_one_point_per_degree() -> None:
    spec = home.grid()
    points = home.grid_points(spec)
    assert len(points) == spec["cols"] * spec["rows"]
    assert points[0] == (spec["west"] + 0.5, spec["south"] + 0.5)
    assert points[1][0] - points[0][0] == 1.0


def client(handler: Any) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_the_sea_has_no_shape_and_a_failing_service_stops_the_run() -> None:
    def sea_in_the_west(request: httpx.Request) -> httpx.Response:
        if float(request.url.params["lon"]) < 10:
            return httpx.Response(400, json={"message": "Location over the sea.", "status": 400})
        assert request.url.params["angle"] == "35" and request.url.params["global"] == "1"
        return httpx.Response(200, json=pvgis())

    with client(sea_in_the_west) as http:
        sun = home.collect_sun(http, YEAR)
    spec = sun["grid"]
    assert len(sun["points"]) == spec["cols"] * spec["rows"]
    assert sun["points"][0] is None
    assert sun["points"][spec["cols"] - 1] is not None
    assert sun["license"] == "CC-BY-4.0" and "PVGIS" in sun["attribution"]

    with client(lambda request: httpx.Response(500)) as http, pytest.raises(httpx.HTTPStatusError):
        home.collect_sun(http, YEAR)
    # a service that calls everything the sea is not believed
    everywhere_sea = lambda request: httpx.Response(400, json={"message": "sea"})  # noqa: E731
    with client(everywhere_sea) as http, pytest.raises(home.HomeDataError, match="not publishing"):
        home.collect_sun(http, YEAR)


def test_the_document_is_published_under_its_key() -> None:
    with client(lambda request: httpx.Response(200, json=pvgis())) as http:
        sun = home.collect_sun(http, YEAR)
    household = home.household_curve(workbook(), YEAR)
    store = MemoryStore()
    now = datetime(2026, 11, 18, 20, 0, tzinfo=UTC)
    summary = home.publish_home(store, home.build(sun, household, now))
    assert summary == {"key": "solar/home.json", "points": 266, "withSun": 266, "householdYear": 2026}
    stored = store.get_bytes("solar/home.json")
    assert stored is not None
    document = json.loads(stored)
    assert document["version"] == 1 and document["timezone"] == "Europe/Zagreb"
    assert document["generatedAt"] == "2026-11-18T20:00:00+00:00"
    assert document["household"]["months"][0][0] == pytest.approx(FLAT_W, abs=0.06)
