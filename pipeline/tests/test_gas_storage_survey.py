"""The survey of gas storage on GIE AGSI (Faza 37, step 1) against a mocked platform.

The listing and the rows follow the fields of the user manual (v007, sections 2.1 and 2.3); the operators,
codes and figures are invented, to test the survey, not to describe real storage.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from energymap.gas import agsi

NOW = datetime(2026, 11, 17, 21, 0, tzinfo=UTC)
SCOPE = frozenset({"HR", "AT"})
KEY = "test-key-not-a-real-one"

LISTING: dict[str, Any] = {
    "SSO": {
        "Europe": {
            "Croatia": [
                {
                    "name": "Skladiste Primjer d.o.o.", "short_name": "Primjer", "type": "SSO",
                    "eic": "31X-PRIMJER----A", "country": "hr",
                    "url": "/api?country=hr&company=31X-PRIMJER----A",
                    "facilities": [
                        {"name": "UGS Primjer", "type": "Storage Facility", "eic": "31W-PRIMJER-UGSB",
                         "country": "hr", "company": "31X-PRIMJER----A",
                         "url": "/api?country=hr&company=31X-PRIMJER----A&facility=31W-PRIMJER-UGSB"},
                    ],
                },
            ],
            "Germany": [
                {
                    "name": "Speicher Beispiel", "short_name": "Beispiel", "type": "SSO",
                    "eic": "21X-BEISPIEL---C",
                    "country": "de", "url": "/api?country=de&company=21X-BEISPIEL---C",
                    "facilities": [
                        # a German operator's facility on Austrian soil belongs to the survey
                        {"name": "UGS Grenze", "type": "Storage Facility", "eic": "21W-GRENZE-----D",
                         "country": "at", "company": "21X-BEISPIEL---C", "url": ""},
                    ],
                },
            ],
        }
    },
    "LSO": {"Europe": {"Croatia": [
        {"name": "LNG Primjer", "short_name": "LNG", "type": "LSO", "eic": "31X-LNG--------E",
         "country": "hr",
         "url": "/api?country=hr&company=31X-LNG--------E", "facilities": []},
    ]}},
}  # fmt: skip

ROW = {
    "name": "UGS Primjer", "code": "31W-PRIMJER-UGSB", "gasDayStart": "2026-11-16", "gasInStorage": "4.1234",
    "full": "86.5", "trend": "-0.2", "injection": "0", "withdrawal": "12.5", "workingGasVolume": "4.767",
    "status": "C",
}  # fmt: skip


def platform(request: httpx.Request) -> httpx.Response:
    if request.headers.get("x-key") != KEY:
        return httpx.Response(401, json={"error": "access denied"})
    if request.url.path == "/api/about":
        assert request.url.params["show"] == "listing"
        return httpx.Response(200, json=LISTING)
    assert request.url.params["size"] == "1"
    return httpx.Response(200, json={"last_page": 300, "total": 1, "gas_day": "2026-11-16", "data": [ROW]})


def client() -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(platform))


def test_lists_storage_in_scope_and_reads_one_day_of_each(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(agsi.KEY_ENV, KEY)
    document = agsi.survey(client(), NOW, SCOPE)

    found = [(d["country"], d["company"], d["facility"], d["kind"]) for d in document["datasets"]]
    assert found == [
        ("AT", "Beispiel", "UGS Grenze", "Storage Facility"),
        ("HR", "Primjer", "", "company"),
        ("HR", "Primjer", "UGS Primjer", "Storage Facility"),
    ]  # the LNG terminal is not storage, and Germany itself is out of scope
    croatia = document["datasets"][2]
    assert croatia["latest"]["full"] == "86.5" and croatia["latest"]["gasDayStart"] == "2026-11-16"
    # a dataset the listing gives no address for is reported, and the survey goes on
    assert document["datasets"][0]["latest"] is None
    assert "no address" in document["datasets"][0]["error"]
    assert document["answerFields"] == ["data", "gas_day", "last_page", "total"]
    assert "workingGasVolume" in document["rowFields"]

    table = agsi.markdown(document)
    assert (
        "| HR | Primjer | UGS Primjer | Storage Facility | 2026-11-16 | 4.1234 | 86.5 | 0 | 12.5 | 4.767 |"
        in table
    )
    assert KEY not in table and KEY not in str(document)
    assert agsi.ATTRIBUTION in table


def test_without_a_key_or_with_a_refused_one_it_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(agsi.KEY_ENV, raising=False)
    with pytest.raises(agsi.AgsiError, match="AGSI_API_KEY is not set"):
        agsi.survey(client(), NOW, SCOPE)
    monkeypatch.setenv(agsi.KEY_ENV, "wrong")
    with pytest.raises(agsi.AgsiError, match="HTTP 401"):
        agsi.survey(client(), NOW, SCOPE)


def test_an_empty_listing_is_an_error_not_an_empty_table(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(agsi.KEY_ENV, KEY)
    with pytest.raises(agsi.AgsiError, match="no storage for"):
        agsi.survey(client(), NOW, frozenset({"ME"}))
