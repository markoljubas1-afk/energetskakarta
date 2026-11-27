"""Installed capacity per production type (ENTSO-E A68) for the site: fetched per country and year, mapped
onto the map's technologies, validated, and published only when it lost nothing that is published."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from energymap import cli
from energymap.entsoe import client as ec
from energymap.entsoe import installed
from energymap.entsoe.client import EntsoeError
from energymap.publish import MemoryStore
from entsoe_xml import GL_NS, no_data

NOW = datetime(2026, 11, 27, 12, tzinfo=UTC)
#: per country and year, MW per production type, as the platform would answer
Answers = dict[str, dict[int, dict[str, float]]]

ANSWERS: Answers = {
    "HR": {
        2024: {"B12": 1_446, "B11": 428, "B16": 300, "B19": 1_100, "B02": 0},
        2025: {"B12": 1_446, "B11": 428, "B16": 450, "B19": 1_240, "B25": 0},
        2026: {"B12": 1_446, "B11": 428, "B16": 620, "B19": 1_309, "B25": 66, "B10": 281},
    },
    # Slovenia already published the next year: the shared year stays 2026
    "SI": {
        2025: {"B14": 700, "B16": 1_411},
        2026: {"B14": 700, "B16": 1_577},
        2027: {"B14": 700, "B16": 1_700},
    },
}


def _series(year: int, psr: str, mw: float) -> str:
    return (
        "<TimeSeries><mRID>1</mRID><businessType>A37</businessType>"
        "<quantity_Measure_Unit.name>MAW</quantity_Measure_Unit.name><curveType>A01</curveType>"
        f"<MktPSRType><psrType>{psr}</psrType></MktPSRType>"
        f"<Period><timeInterval><start>{year - 1}-12-31T23:00Z</start><end>{year}-12-31T23:00Z</end>"
        f"</timeInterval><resolution>P1Y</resolution><Point><position>1</position><quantity>{mw:g}</quantity>"
        "</Point></Period></TimeSeries>"
    )


class Platform:
    def __init__(self, answers: Answers, fail: tuple[str, int] | None = None) -> None:
        self.answers = answers
        self.fail = fail
        self.asked: list[dict[str, str]] = []
        self.country_of = {eic: code for code, eic in ec.AREAS.items()}

    def handle(self, request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        self.asked.append(params)
        assert (params["documentType"], params["processType"]) == ("A68", "A33")
        country = self.country_of[params["in_Domain"]]
        year = int(params["periodEnd"][:4])
        if self.fail == (country, year):
            return httpx.Response(400, text="something else went wrong")
        by_type = self.answers.get(country, {}).get(year)
        if by_type is None:
            return httpx.Response(200, content=no_data())
        body = "".join(_series(year, psr, mw) for psr, mw in by_type.items())
        return httpx.Response(
            200,
            content=f'<?xml version="1.0"?><GL_MarketDocument xmlns="{GL_NS}">{body}'
            "</GL_MarketDocument>".encode(),
        )


def _client(platform: Platform) -> ec.EntsoeClient:
    return ec.EntsoeClient(
        "token",
        http=httpx.Client(transport=httpx.MockTransport(platform.handle)),
        limiter=ec.RateLimiter(per_minute=100_000, sleep=lambda _: None),
        sleep=lambda _: None,
    )


def _collect(answers: Answers = ANSWERS, countries: tuple[str, ...] = ("HR", "SI")) -> installed.Installed:
    return installed.collect(_client(Platform(answers)), NOW, list(countries))


def test_capacity_per_technology_and_year() -> None:
    document = _collect()
    hr = {each.year: each for each in document.countries["HR"]}
    assert sorted(hr) == [2024, 2025, 2026]
    # run-of-river and reservoir are both hydro; a type with 0 MW is not a source the country has
    assert hr[2026].mw == {"hydro": 1_874, "solar": 620, "wind": 1_309, "battery": 66, "pumped_storage": 281}
    assert "lignite" not in hr[2024].mw and "battery" not in hr[2025].mw
    assert hr[2026].total == 4_150
    assert [each.year for each in document.countries["SI"]] == [2025, 2026, 2027]
    # the latest year every country has: the one the countries are compared in
    assert document.year == 2026
    assert document.source == "ENTSO-E Transparency Platform" and document.document_type == "A68"
    dumped = installed.dump(document)
    assert dumped["countries"]["HR"][-1] == {
        "year": 2026,
        "total": 4_150,
        "mw": {"battery": 66, "hydro": 1_874, "pumped_storage": 281, "solar": 620, "wind": 1_309},
    }
    assert installed.parse(json.loads(json.dumps(dumped))) == document


def test_only_the_country_area_is_asked_every_year_up_to_the_next() -> None:
    platform = Platform({"IT": {2026: {"B04": 48_467}}})
    installed.collect(_client(platform), NOW, ["IT"])
    assert {params["in_Domain"] for params in platform.asked} == {ec.AREAS["IT"]}
    assert [int(params["periodEnd"][:4]) for params in platform.asked] == list(range(2015, 2028))


def test_a_failed_request_fails_the_fetch() -> None:
    with pytest.raises(EntsoeError):
        installed.collect(_client(Platform(ANSWERS, fail=("SI", 2025))), NOW, ["HR", "SI"])


@pytest.mark.parametrize(
    ("answers", "message"),
    [
        ({"HR": ANSWERS["HR"], "SI": {}}, "SI has no year"),
        ({"HR": {2025: {"B16": 450}, 2026: {"B21": 3}}}, "unknown production type B21"),
        # half of the country's capacity gone from one year to the next is a broken answer
        ({"HR": {2025: {"B12": 1_446, "B19": 1_240}, 2026: {"B19": 1_309}}}, "fell from"),
    ],
)
def test_documents_that_are_not_publishable(answers: Answers, message: str) -> None:
    with pytest.raises(installed.InstalledDataError, match=message):
        _collect(answers, tuple(answers))


def _published(store: MemoryStore) -> dict[str, object]:
    raw = store.get_bytes(installed.KEY)
    assert raw is not None
    loaded: dict[str, object] = json.loads(raw)
    return loaded


def test_publish_writes_once_and_keeps_an_unchanged_document() -> None:
    store = MemoryStore()
    assert installed.publish_installed(store, _collect()) is True
    assert _published(store)["year"] == 2026
    later = _collect()
    assert later.content_hash == _collect().content_hash
    assert installed.publish_installed(store, later) is False
    assert store.writes == [installed.KEY]


Shrink = Callable[[Answers], Answers]


@pytest.mark.parametrize(
    "shrink",
    [
        # a published year that is no longer there
        lambda answers: {"HR": {y: v for y, v in answers["HR"].items() if y != 2024}, "SI": answers["SI"]},
        # the latest year went back
        lambda answers: {"HR": answers["HR"], "SI": {y: v for y, v in answers["SI"].items() if y != 2027}},
    ],
)
def test_publish_refuses_what_lost_a_published_year(shrink: Shrink) -> None:
    store = MemoryStore()
    installed.publish_installed(store, _collect())
    smaller = _collect(shrink(ANSWERS))
    with pytest.raises(installed.InstalledDataError, match="--allow-drop"):
        installed.publish_installed(store, smaller)
    assert _published(store)["contentHash"] == _collect().content_hash
    assert installed.publish_installed(store, smaller, allow_drop=True) is True


def test_cli_fetch_then_publish(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    platform = Platform(ANSWERS)
    monkeypatch.setattr(ec.EntsoeClient, "from_env", classmethod(lambda cls: _client(platform)))
    data = tmp_path / "data"
    assert cli.main(["energy", "capacity-fetch", "--data-dir", str(data), "--countries", "HR,SI"]) == 0
    assert json.loads((data / "entsoe" / "installed.json").read_text(encoding="utf-8"))["year"] == 2026
    out = tmp_path / "out"
    assert cli.main(["energy", "capacity-publish-dir", "--data-dir", str(data), "--out", str(out)]) == 0
    published = json.loads((out / installed.KEY).read_text(encoding="utf-8"))
    assert published["countries"]["SI"][-1]["year"] == 2027
    # the same again: nothing to write, still a success
    assert cli.main(["energy", "capacity-publish-dir", "--data-dir", str(data), "--out", str(out)]) == 0
