"""Daily gas storage from GIE AGSI (Faza 37, step 3) against a mocked platform.

The rows have the shape the first live survey returned on 2026-11-17 (figures as strings, ``-`` where an
operator reported none, the facility's own coordinates); operators, codes and figures are invented.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from energymap import publish
from energymap.gas import agsi

NOW = datetime(2026, 11, 17, 8, 0, tzinfo=UTC)
TODAY = NOW.date()
SCOPE = frozenset({"HR", "HU", "SI"})
KEY = "test-key-not-a-real-one"


def facility(name: str, eic: str, country: str, company: str) -> dict[str, Any]:
    return {
        "name": name, "type": "DSR", "eic": eic, "country": country, "company": company,
        "url": f"https://agsi.gie.eu/api?country={country}&company={company}&facility={eic}",
    }  # fmt: skip


LISTING = [
    {
        "name": "Skladiste Primjer d.o.o.", "short_name": "Primjer", "type": "SSO", "eic": "31X-PRIMJER----A",
        "country": "HR", "url": "https://agsi.gie.eu/api?country=HR&company=31X-PRIMJER----A",
        "facilities": [facility("UGS Primjer", "31W-PRIMJER-UGSB", "HR", "31X-PRIMJER----A")],
    },
    {
        "name": "Tarolo Pelda", "short_name": "Pelda", "type": "SSO", "eic": "21X-PELDA------C",
        "country": "HU", "url": "https://agsi.gie.eu/api?country=HU&company=21X-PELDA------C",
        "facilities": [
            facility("UGS Pelda", "21W-PELDA-UGS--D", "HU", "21X-PELDA------C"),
            # listed, but the operator has reported nothing for it
            facility("UGS Csendes // historical", "21W-CSENDES----E", "HU", "21X-PELDA------C"),
        ],
    },
]  # fmt: skip


def row(day: str, full: str, stored: str, injection: str, withdrawal: str, **extra: str) -> dict[str, Any]:
    return {
        "gasDayStart": day, "full": full, "gasInStorage": stored, "injection": injection,
        "withdrawal": withdrawal, "workingGasVolume": "4.7725", "status": "C",
        "latitude": "45.6", "longitude": "16.6", **extra,
    }  # fmt: skip


ROWS: dict[str, list[dict[str, Any]]] = {
    # newest first, as the platform answers
    "31W-PRIMJER-UGSB": [
        row("2026-11-15", "76.63", "3.6572", "0.84", "21.1"),
        row("2026-11-14", "77.07", "3.6781", "0", "18.4", status="E"),
    ],
    "21W-PELDA-UGS--D": [
        # a day behind the other, and its coordinates are far outside the region
        row("2026-11-14", "97.62", "19.994", "0.6", "0.6", latitude="12.0", longitude="100.0"),
        row("2026-11-13", "-", "-", "-", "-", status="N"),
    ],
    "21W-CSENDES----E": [row("2026-11-15", "-", "-", "-", "-", status="N")],
}


def platform(request: httpx.Request) -> httpx.Response:
    if request.headers.get("x-key") != KEY:
        return httpx.Response(401, json={"error": "access denied"})
    if request.url.path == "/api/about":
        return httpx.Response(200, json=LISTING)
    rows = ROWS[request.url.params["facility"]][: int(request.url.params["size"])]
    return httpx.Response(200, json={"last_page": 1, "total": len(rows), "data": rows})


def collect(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    monkeypatch.setenv(agsi.KEY_ENV, KEY)
    return agsi.collect(httpx.Client(transport=httpx.MockTransport(platform)), NOW, SCOPE, days=30)


def test_collects_each_facility_aligned_on_the_days_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    document = collect(monkeypatch)

    assert document["days"] == ["2026-11-14", "2026-11-15"]  # the row without any figure adds no day
    assert [f["name"] for f in document["facilities"]] == ["UGS Primjer", "UGS Pelda"]
    croatia, hungary = document["facilities"]
    assert croatia["fullPercent"] == [77.07, 76.63]
    assert croatia["inStorageTwh"] == [3.6781, 3.6572]
    assert croatia["withdrawalGwhPerDay"] == [18.4, 21.1]
    assert croatia["status"] == ["E", "C"]
    assert (croatia["lon"], croatia["lat"], croatia["workingGasTwh"]) == (16.6, 45.6, 4.7725)
    # Hungary has not reported the last day yet, and a position outside the region is not a position
    assert hungary["fullPercent"] == [97.62, None]
    assert hungary["status"] == ["C", None]
    assert (hungary["lon"], hungary["lat"]) == (None, None)
    assert document["missing"] == {"facilities": ["21W-CSENDES----E"], "countries": ["SI"]}
    assert document["attribution"] == agsi.ATTRIBUTION and document["license"] == "GIE-AGSI-attribution"
    assert KEY not in json.dumps(document)
    agsi.validate(document, TODAY)


def test_publishes_only_what_validates(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    document = collect(monkeypatch)
    store = publish.DirectoryStore(tmp_path)
    agsi.publish_storage(store, document, TODAY)
    published = json.loads((tmp_path / "live" / "gasstorage.json").read_text(encoding="utf-8"))
    assert published["facilities"][0]["fullPercent"] == [77.07, 76.63]

    # figures that have gone stale, lost their credit or are not plausible never replace the published ones
    stale = date(2026, 12, 1)
    with pytest.raises(agsi.StorageDataError, match="more than 7 days ago"):
        agsi.publish_storage(store, document, stale)
    with pytest.raises(agsi.StorageDataError, match="must name GIE"):
        agsi.publish_storage(store, {**document, "attribution": ""}, TODAY)
    broken = json.loads(json.dumps(document))
    broken["facilities"][0]["fullPercent"][1] = 760.0
    with pytest.raises(agsi.StorageDataError, match="not plausible"):
        agsi.publish_storage(store, broken, TODAY)
    short = json.loads(json.dumps(document))
    short["facilities"][1]["status"] = ["C"]
    with pytest.raises(agsi.StorageDataError, match="one value per day"):
        agsi.publish_storage(store, short, TODAY)
    with pytest.raises(agsi.StorageDataError, match="no storage facility"):
        agsi.publish_storage(store, {**document, "facilities": []}, TODAY)
    assert json.loads((tmp_path / "live" / "gasstorage.json").read_text(encoding="utf-8")) == published


def test_a_scope_without_any_facility_is_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(agsi.KEY_ENV, KEY)
    with pytest.raises(agsi.AgsiError, match="no storage facility"):
        agsi.collect(httpx.Client(transport=httpx.MockTransport(platform)), NOW, frozenset({"SI"}))
