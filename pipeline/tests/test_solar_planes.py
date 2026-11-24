"""How much a roof loses to the way it faces (Faza 52): PVGIS per plane, one small file per grid cell."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from energymap.publish import MemoryStore
from energymap.solar import home, planes

NOW = datetime(2026, 11, 24, 12, tzinfo=UTC)


def kwh_of(slope: int, azimuth: int) -> float:
    """A made-up place: best at 35° south, losing with the angle away from south and from 35°."""
    return 1200.0 - 2.0 * abs(azimuth) - 1.5 * abs(slope - 35)


def pvcalc(slope: int, azimuth: int) -> dict[str, Any]:
    return {
        "inputs": {"mounting_system": {"fixed": {"slope": {"value": slope}, "azimuth": {"value": azimuth}}}},
        "outputs": {"totals": {"fixed": {"E_y": kwh_of(slope, azimuth)}}},
    }


def drcalc(azimuth: int) -> dict[str, Any]:
    """Sun peaking at 11:00 UTC on a south roof, earlier on an east one, later on a west one."""
    peak = 11 + azimuth // 45
    rows = [
        {"month": month, "time": f"{hour:02d}:00", "G(i)": max(0, 700 - 100 * abs(hour - peak))}
        for month in range(1, 13)
        for hour in range(24)
    ]
    return {"outputs": {"daily_profile": rows}}


def transport(sea: bool = False, seen: list[dict[str, str]] | None = None) -> httpx.MockTransport:
    def answer(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        if seen is not None:
            seen.append(params)
        if sea:
            return httpx.Response(400, json={"message": "Location over the sea"})
        if request.url.path.endswith("PVcalc"):
            if params.get("optimalangles") == "1":
                return httpx.Response(200, json=pvcalc(35, 0))
            return httpx.Response(200, json=pvcalc(int(params["angle"]), int(params["aspect"])))
        return httpx.Response(200, json=drcalc(int(params["aspect"])))

    return httpx.MockTransport(answer)


def test_the_planes_offered_are_five_directions_at_three_tilts_and_a_flat_roof() -> None:
    ids = [plane.id for plane in planes.planes()]
    assert len(ids) == 16 and ids[-1] == "flat"
    assert {"S-30", "E-15", "W-45", "SE-30", "SW-30"} <= set(ids)
    # PVGIS's azimuth: south 0, east negative, west positive
    assert planes.AZIMUTH == {"S": 0, "SE": -45, "SW": 45, "E": -90, "W": 90}
    flat = planes.planes()[-1]
    assert (flat.slope_deg, flat.azimuth_deg) == (10, 0)


def test_a_cell_has_the_best_plane_and_every_plane_with_its_own_day() -> None:
    seen: list[dict[str, str]] = []
    with httpx.Client(transport=transport(seen=seen)) as client:
        cell = planes.fetch_cell(client, 15.5, 45.5, 2026)
    assert cell is not None
    assert cell["best"] == {"slopeDeg": 35, "azimuthDeg": 0, "yearlyKwh": 1200.0}
    by_id = {plane["id"]: plane for plane in cell["planes"]}
    assert by_id["E-30"]["yearlyKwh"] == pytest.approx(1200 - 180 - 7.5)
    # the east roof's day peaks two hours before the south one's (local time, winter: UTC+1)
    east, south = by_id["E-30"]["shape"][0], by_id["S-30"]["shape"][0]
    assert east.index(max(east)) == south.index(max(south)) - 2
    # no terrain horizon, one best-plane call and two calls per plane
    assert all(params["usehorizon"] == "0" for params in seen)
    assert len(seen) == 1 + 2 * 16


def test_the_sea_is_no_cell_and_too_few_cells_publish_nothing() -> None:
    with httpx.Client(transport=transport(sea=True)) as client:
        assert planes.fetch_cell(client, 15.5, 42.5, 2026) is None
        with pytest.raises(planes.PlanesDataError, match="not publishing"):
            planes.collect(client, 2026)


def test_an_answer_that_contradicts_how_roofs_work_stops_the_run() -> None:
    with httpx.Client(transport=transport()) as client:
        cell = planes.fetch_cell(client, 15.5, 45.5, 2026)
    assert cell is not None
    planes.check(cell)
    east = next(plane for plane in cell["planes"] if plane["id"] == "E-30")
    east["yearlyKwh"] = 1199.0
    with pytest.raises(planes.PlanesDataError, match="east or west"):
        planes.check(cell)
    east["yearlyKwh"] = 1300.0
    with pytest.raises(planes.PlanesDataError, match="above the best"):
        planes.check(cell)


def test_a_plane_pvgis_computed_for_another_angle_is_refused() -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("PVcalc"):
            return httpx.Response(200, json=pvcalc(35, 0))
        return httpx.Response(200, json=drcalc(0))

    with (
        httpx.Client(transport=httpx.MockTransport(answer)) as client,
        pytest.raises(planes.PlanesDataError, match="computed 35°/0° for plane S-15"),
    ):
        planes.fetch_cell(client, 15.5, 45.5, 2026)


def test_each_cell_is_a_file_of_its_own_with_its_provenance() -> None:
    with httpx.Client(transport=transport()) as client:
        cell = planes.fetch_cell(client, 15.5, 45.5, 2026)
    assert cell is not None
    docs = planes.documents({(10, 10): {"lon": 15.5, "lat": 45.5, **cell}}, NOW)
    assert list(docs) == ["solar/planes/10-10.json"]
    store = MemoryStore()
    summary = planes.publish(store, docs)
    assert summary == {"prefix": "solar/planes/", "cells": 1, "planes": 16}
    published = json.loads(store.objects["solar/planes/10-10.json"][0])
    assert published["version"] == 1
    assert published["license"] == home.PVGIS_LICENSE == "CC-BY-4.0"
    assert published["source"] == home.PVGIS_SOURCE
    assert published["cell"] == {"col": 10, "row": 10, "lon": 15.5, "lat": 45.5}
    assert len(published["planes"]) == 16


def test_a_dropped_connection_or_an_overload_is_tried_again() -> None:
    calls: list[int] = []

    def answer(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            raise httpx.RemoteProtocolError("Server disconnected without sending a response.")
        if len(calls) == 2:
            return httpx.Response(503)
        return httpx.Response(200, json=pvcalc(35, 0))

    waits: list[float] = []
    with httpx.Client(transport=httpx.MockTransport(answer)) as client:
        document = planes._get(client, planes.PVCALC_URL, {}, wait=waits.append)
    assert document is not None and len(calls) == 3 and waits == [5.0, 10.0]

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    with httpx.Client(transport=httpx.MockTransport(down)) as client, pytest.raises(httpx.ConnectError):
        planes._get(client, planes.PVCALC_URL, {}, wait=waits.append)
