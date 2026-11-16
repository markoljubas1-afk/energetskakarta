"""Photographs from Wikimedia Commons. The stand-in answers in the shape the live APIs answered with on
2026-11-16 (see the module's docstring); every value is invented."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from energymap import publish
from energymap.images import wikimedia

NOW = datetime(2026, 11, 16, 12, tzinfo=UTC)
ASSETS = {
    "osm:way/1": "Q100",  # has a photograph
    "osm:way/2": "Q200",  # Wikidata knows no image
    "osm:way/3": "Q300",  # the image is an SVG diagram, not a photograph
    "osm:way/4": "Q400",  # the image states no licence
    "osm:way/5": "Q100",  # a second unit of the same plant: the same photograph
    "osm:way/6": "not-a-qid",
}


def statement(file: str, rank: str = "normal") -> dict[str, Any]:
    return {"rank": rank, "mainsnak": {"datavalue": {"value": file}}}


ENTITIES = {
    "Q100": {"claims": {"P18": [statement("Old view.jpg"), statement("HE Primjer.jpg", "preferred")]}},
    "Q200": {"claims": {}},
    "Q300": {"claims": {"P18": [statement("Shema.svg")]}},
    "Q400": {"claims": {"P18": [statement("Bez licence.jpg"), statement("Skinuto.jpg", "deprecated")]}},
}


def page(
    title: str, mime: str, licence: str | None, timestamp: str = "2020-05-01T10:00:00Z"
) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "Artist": {
            "value": '<a href="//commons.wikimedia.org/wiki/User:Ana" title="User:Ana">Ana &amp; Co</a>'
        },
        "Credit": {"value": '<span class="int-own-work" lang="en">Own work</span>'},
    }
    if licence:
        meta["LicenseShortName"] = {"value": licence}
        meta["LicenseUrl"] = {"value": "https://creativecommons.org/licenses/by-sa/4.0"}
    name = title.removeprefix("File:").replace(" ", "_")
    return {
        "title": title,
        "imageinfo": [
            {
                "mime": mime,
                "timestamp": timestamp,
                "thumburl": f"https://thumb.test/{name}/640px-{name}",
                "thumbwidth": 640,
                "thumbheight": 480,
                "descriptionurl": f"https://commons.wikimedia.org/wiki/File:{name}",
                "extmetadata": meta,
            }
        ],
    }


class Wikimedia:
    def __init__(self) -> None:
        self.asked: list[str] = []
        self.timestamp = "2020-05-01T10:00:00Z"

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.asked.append(str(request.url))
        assert request.headers["User-Agent"].startswith("energymap-images/1.0")
        if request.url.host == "thumb.test":
            return httpx.Response(200, content=b"\xff\xd8 jpeg bytes")
        params = request.url.params
        assert params["format"] == "json"
        if request.url.host == "www.wikidata.org":
            assert params["action"] == "wbgetentities" and params["props"] == "claims"
            ids = params["ids"].split("|")
            assert "not-a-qid" not in ids
            return httpx.Response(200, json={"entities": {qid: ENTITIES[qid] for qid in ids}})
        assert request.url.host == "commons.wikimedia.org" and params["iiurlwidth"] == "640"
        titles = params["titles"].split("|")
        pages = []
        for title in titles:
            if title == "File:HE Primjer.jpg":
                # Commons answers under its own spelling; `normalized` says which question it was
                pages.append(
                    page(
                        "File:HE Primjer.jpg".replace(" ", "_"), "image/jpeg", "CC BY-SA 4.0", self.timestamp
                    )
                )
            elif title == "File:Shema.svg":
                pages.append(page(title, "image/svg+xml", "CC0"))
            elif title == "File:Bez licence.jpg":
                pages.append(page(title, "image/jpeg", None))
            else:
                pages.append({"title": title, "missing": True})
        normalized = [{"from": "File:HE Primjer.jpg", "to": "File:HE_Primjer.jpg"}]
        return httpx.Response(200, json={"query": {"normalized": normalized, "pages": pages}})


@pytest.fixture
def site() -> Wikimedia:
    return Wikimedia()


def client_for(site: Wikimedia) -> httpx.Client:
    return httpx.Client(
        transport=httpx.MockTransport(site.handle),
        headers={"User-Agent": wikimedia.user_agent("https://karta.test")},
    )


def test_author_markup_becomes_plain_text() -> None:
    assert wikimedia.plain('<a href="//x">Ana &amp; Co</a>') == "Ana & Co"
    assert wikimedia.plain("<p>A</p>\n<p>B</p>") == "A B"
    assert wikimedia.plain("x" * 300).endswith("…") and len(wikimedia.plain("x" * 300)) == 120
    assert wikimedia.plain(None) == ""


def test_the_client_says_who_it_is() -> None:
    assert wikimedia.user_agent("https://karta.test") == "energymap-images/1.0 (https://karta.test)"
    assert wikimedia.user_agent(None) == "energymap-images/1.0"


def test_only_photographs_with_a_licence_are_copied_and_credited(site: Wikimedia) -> None:
    store = publish.MemoryStore()
    with client_for(site) as client:
        document = wikimedia.update(store, ASSETS, client, NOW)
    images = document["images"]
    # the preferred statement wins; the two units of one plant share its photograph
    assert set(images) == {"osm:way/1", "osm:way/5"}
    assert images["osm:way/1"] == images["osm:way/5"]
    record = images["osm:way/1"]
    assert record["key"].startswith("images/") and record["key"].endswith(".jpg")
    assert (record["author"], record["license"]) == ("Ana & Co", "CC BY-SA 4.0")
    assert record["licenseUrl"] == "https://creativecommons.org/licenses/by-sa/4.0"
    assert record["page"] == "https://commons.wikimedia.org/wiki/File:HE_Primjer.jpg"
    assert (record["width"], record["height"]) == (640, 480)
    # one copy, uploaded before the index that names it
    assert store.writes == [record["key"], wikimedia.INDEX_KEY]
    assert store.get_bytes(record["key"]) == b"\xff\xd8 jpeg bytes"
    published = json.loads(store.get_bytes(wikimedia.INDEX_KEY) or b"")
    assert published == document and published["version"] == 1 and published["source"] == "Wikimedia Commons"


def test_an_unchanged_photograph_is_not_fetched_again_and_a_new_version_gets_a_new_copy(
    site: Wikimedia,
) -> None:
    store = publish.MemoryStore()
    with client_for(site) as client:
        first = wikimedia.update(store, ASSETS, client, NOW)
        site.asked.clear()
        second = wikimedia.update(store, ASSETS, client, NOW)
        assert not any("thumb.test" in url for url in site.asked)
        assert second["images"] == first["images"]
        site.timestamp = "2026-01-01T00:00:00Z"
        third = wikimedia.update(store, ASSETS, client, NOW)
    assert third["images"]["osm:way/1"]["key"] != first["images"]["osm:way/1"]["key"]
    # the old copy stays where it was: a page that still points at it keeps working
    assert store.get_bytes(first["images"]["osm:way/1"]["key"]) is not None


def test_a_large_drop_keeps_the_published_index(site: Wikimedia) -> None:
    store = publish.MemoryStore()
    with client_for(site) as client:
        wikimedia.update(store, ASSETS, client, NOW)
        before = store.get_bytes(wikimedia.INDEX_KEY)
        with pytest.raises(wikimedia.ImagesError, match="keeping the published one"):
            wikimedia.update(store, {"osm:way/2": "Q200"}, client, NOW)
        assert store.get_bytes(wikimedia.INDEX_KEY) == before
        assert wikimedia.update(store, {"osm:way/2": "Q200"}, client, NOW, allow_drop=True)["images"] == {}


@pytest.mark.parametrize(
    "answer",
    [
        httpx.Response(503),
        httpx.Response(200, text="<html>"),
        httpx.Response(200, json={"error": {"code": "x"}}),
    ],
)
def test_an_unexpected_answer_is_an_error_not_an_empty_index(answer: httpx.Response) -> None:
    store = publish.MemoryStore()
    with (
        httpx.Client(transport=httpx.MockTransport(lambda _: answer)) as client,
        pytest.raises(wikimedia.ImagesError),
    ):
        wikimedia.update(store, {"osm:way/1": "Q100"}, client, NOW)
    assert store.get_bytes(wikimedia.INDEX_KEY) is None
