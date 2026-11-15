from __future__ import annotations

import gzip
import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from energymap import baseline

BASE = "https://data.test/"
DOWNLOADS: dict[str, str] = {
    "lines": "builds/20260909T030000Z/lines.ndjson.gz",
    "substations": "builds/20260909T030000Z/substations.ndjson.gz",
    "plants": "builds/20260909T030000Z/plants.ndjson.gz",
}
POINTER: dict[str, Any] = {
    "buildId": "20260909T030000Z",
    "counts": {"lines": 10, "substations": 4, "plants": 7},
    "downloads": DOWNLOADS,
}


def client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_reads_the_published_pointer() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=POINTER)

    with client(handler) as c:
        published = baseline.fetch_published(c, "https://data.test")  # missing slash is fine
    assert published is not None
    assert published.build_id == "20260909T030000Z"
    assert published.counts == {"lines": 10, "substations": 4, "plants": 7}
    assert published.url(published.downloads["plants"]) == BASE + DOWNLOADS["plants"]
    assert str(seen[0].url) == BASE + "current.json"
    assert seen[0].headers["cache-control"] == "no-cache"


def test_nothing_published_yet() -> None:
    with client(lambda _: httpx.Response(404)) as c:
        assert baseline.fetch_published(c, BASE) is None


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (httpx.Response(500), "HTTP 500"),
        (httpx.Response(403), "HTTP 403"),
        (httpx.Response(200, text="<html>"), "not valid JSON"),
        (httpx.Response(200, json=[1, 2]), "not a JSON object"),
        (httpx.Response(200, json={**POINTER, "counts": {"lines": "10"}}), "invalid counts"),
        (httpx.Response(200, json={**POINTER, "downloads": {"lines": "x"}}), "must list downloads"),
        (
            httpx.Response(200, json={**POINTER, "downloads": {**DOWNLOADS, "lines": "https://evil/x"}}),
            "invalid download",
        ),
        (
            httpx.Response(200, json={**POINTER, "downloads": {**DOWNLOADS, "plants": "../x"}}),
            "invalid download",
        ),
    ],
)
def test_unusable_pointer_is_an_error(response: httpx.Response, message: str) -> None:
    with client(lambda _: response) as c, pytest.raises(baseline.BaselineError, match=message):
        baseline.fetch_published(c, BASE)


def test_network_failure_is_an_error_not_a_first_publication() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    with client(handler) as c, pytest.raises(baseline.BaselineError, match="Cannot reach"):
        baseline.fetch_published(c, BASE)


def test_relative_base_url_is_rejected() -> None:
    with client(lambda _: httpx.Response(200, json=POINTER)) as c, pytest.raises(baseline.BaselineError):
        baseline.fetch_published(c, "/local-data/")


def _gz(features: list[dict[str, Any]]) -> bytes:
    return gzip.compress("".join(json.dumps(f) + "\n" for f in features).encode())


def test_iter_layer_streams_gzip_ndjson() -> None:
    rows = [{"id": "osm:node/1"}, {"id": "osm:node/2"}]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("current.json"):
            return httpx.Response(200, json=POINTER)
        return httpx.Response(200, content=_gz(rows))

    with client(handler) as c:
        published = baseline.fetch_published(c, BASE)
        assert published is not None
        assert list(baseline.iter_layer(c, published, "plants")) == rows


@pytest.mark.parametrize(
    ("response", "message"),
    [(httpx.Response(404), "HTTP 404"), (httpx.Response(200, content=b"not gzip"), "not valid gzip")],
)
def test_iter_layer_failures(response: httpx.Response, message: str) -> None:
    published = baseline.parse_pointer(BASE, POINTER)
    with client(lambda _: response) as c, pytest.raises(baseline.BaselineError, match=message):
        list(baseline.iter_layer(c, published, "lines"))
