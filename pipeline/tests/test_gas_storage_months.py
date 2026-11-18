"""Month-end gas storage by country (Faza 40-3) against a mocked AGSI; operators and figures are invented."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from energymap import publish
from energymap.gas import agsi, storage_months

NOW = datetime(2026, 11, 18, 8, 0, tzinfo=UTC)
KEY = "test-key-not-a-real-one"
SCOPE = frozenset({"HR", "AT"})


def facility(name: str, eic: str, country: str) -> dict[str, Any]:
    return {
        "name": name, "type": "DSR", "eic": eic, "country": country, "company": f"{country}-SSO",
        "url": f"https://agsi.gie.eu/api?country={country}&company={country}-SSO&facility={eic}",
    }  # fmt: skip


LISTING = [
    {
        "name": "Skladiste Primjer", "short_name": "Primjer", "type": "SSO", "eic": "HR-SSO", "country": "HR",
        "url": "https://agsi.gie.eu/api?country=HR&company=HR-SSO",
        "facilities": [facility("UGS Primjer", "HR-UGS", "HR")],
    },
    {
        "name": "Speicher Beispiel", "short_name": "Beispiel", "type": "SSO", "eic": "AT-SSO",
        "country": "AT",
        "url": "https://agsi.gie.eu/api?country=AT&company=AT-SSO",
        "facilities": [facility("Speicher Eins", "AT-ONE", "AT"), facility("Speicher Zwei", "AT-TWO", "AT")],
    },
]  # fmt: skip

HR_URL = "https://agsi.gie.eu/api?country=HR&company=HR-SSO&facility=HR-UGS"


def row(day: str, full: str, stored: str, capacity: str) -> dict[str, Any]:
    return {
        "gasDayStart": day,
        "full": full,
        "gasInStorage": stored,
        "workingGasVolume": capacity,
        "status": "C",
    }


# newest first, as the platform answers
ROWS: dict[str, list[dict[str, Any]]] = {
    "HR-UGS": [
        row("2026-11-16", "76.63", "3.66", "4.77"),
        row("2026-10-31", "85.00", "4.05", "4.77"),
        row("2026-10-30", "84.50", "4.03", "4.77"),
        row("2025-10-31", "-", "-", "-"),  # reported nothing that day
        row("2025-10-30", "78.20", "3.73", "4.77"),
    ],
    "AT-ONE": [row("2026-10-31", "50.00", "10", "20"), row("2025-10-31", "40.00", "8", "20")],
    # a day behind the other at the end of October 2026; no volumes a year earlier
    "AT-TWO": [row("2026-10-30", "50.00", "30", "60"), row("2025-10-31", "45.00", "-", "-")],
}


def platform(request: httpx.Request) -> httpx.Response:
    if request.headers.get("x-key") != KEY:
        return httpx.Response(401, json={"error": "access denied"})
    if request.url.path == "/api/about":
        return httpx.Response(200, json=LISTING)
    size = int(request.url.params["size"])
    page = int(request.url.params.get("page", "1"))
    rows = ROWS[request.url.params["facility"]]
    pages = max(1, -(-len(rows) // size))
    return httpx.Response(200, json={"last_page": pages, "data": rows[(page - 1) * size : page * size]})


def client() -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(platform))


@pytest.fixture(autouse=True)
def _key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(agsi.KEY_ENV, KEY)


def test_each_month_ends_on_the_last_day_a_facility_reported() -> None:
    found = storage_months.collect(client(), SCOPE, days=400)
    assert found["HR"] == {
        # the 31st reported nothing: the month ends on the 30th, and says so
        "2025-10": {"day": "2025-10-30", "full": 78.2, "facilities": 1},
        "2026-10": {"day": "2026-10-31", "full": 85.0, "facilities": 1},
        "2026-11": {"day": "2026-11-16", "full": 76.63, "facilities": 1},
    }
    # two facilities are added up by volume, 40 of 80 TWh; a facility without volumes means no total
    assert found["AT"] == {"2026-10": {"day": "2026-10-31", "full": 50.0, "facilities": 2}}


def test_history_is_read_page_by_page() -> None:
    asked: list[str] = []

    def paged(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/api/about":
            asked.append(request.url.params.get("page", "1"))
        return platform(request)

    rows = storage_months.history_rows(httpx.Client(transport=httpx.MockTransport(paged)), KEY, HR_URL, 2)
    assert [r["gasDayStart"] for r in rows] == ["2026-11-16", "2026-10-31"]
    assert asked == ["1"]
    asked.clear()
    original = storage_months.PAGE_SIZE
    storage_months.PAGE_SIZE = 2
    try:
        rows = storage_months.history_rows(httpx.Client(transport=httpx.MockTransport(paged)), KEY, HR_URL, 5)
    finally:
        storage_months.PAGE_SIZE = original
    assert len(rows) == 5 and asked == ["1", "2", "3"]


def test_published_months_are_kept_and_a_later_day_replaces_an_earlier_one(tmp_path: Path) -> None:
    store = publish.DirectoryStore(tmp_path)
    earlier = {
        "version": 1,
        "countries": {
            "HR": {
                "months": {
                    "2024-10": {"day": "2024-10-31", "full": 91.0, "facilities": 1},
                    "2026-10": {"day": "2026-10-20", "full": 80.0, "facilities": 1},
                    # a later day than the platform now answers with: kept
                    "2026-11": {"day": "2026-11-17", "full": 76.0, "facilities": 1},
                }
            }
        },
    }
    store.put_bytes(storage_months.KEY, json.dumps(earlier).encode(), storage_months.META)
    document = storage_months.publish_months(store, client(), SCOPE, 400, NOW)
    months = document["countries"]["HR"]["months"]
    assert months["2024-10"]["full"] == 91.0
    assert months["2026-10"] == {"day": "2026-10-31", "full": 85.0, "facilities": 1}
    assert months["2026-11"]["day"] == "2026-11-17"
    assert document["attribution"] == agsi.ATTRIBUTION
    assert json.loads((tmp_path / "gas" / "storage-months.json").read_text(encoding="utf-8")) == document


def test_nothing_is_published_when_no_country_reported(tmp_path: Path) -> None:
    store = publish.DirectoryStore(tmp_path)

    def silent(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/about":
            return httpx.Response(200, json=LISTING)
        return httpx.Response(200, json={"last_page": 1, "data": []})

    with pytest.raises(storage_months.StorageMonthsError, match="no country has a month"):
        storage_months.publish_months(
            store, httpx.Client(transport=httpx.MockTransport(silent)), SCOPE, 70, NOW
        )
    assert not (tmp_path / "gas" / "storage-months.json").exists()
