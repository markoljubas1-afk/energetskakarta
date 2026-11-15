from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from energymap.entsoe import client as ec
from entsoe_xml import document, hourly, no_data, series

TOKEN = "secret-token-1234"
START = datetime(2026, 6, 30, 22, tzinfo=UTC)
END = START + timedelta(days=1)


def make(
    handler: Callable[[httpx.Request], httpx.Response], sleeps: list[float] | None = None
) -> ec.EntsoeClient:
    return ec.EntsoeClient(
        TOKEN,
        http=httpx.Client(transport=httpx.MockTransport(handler)),
        limiter=ec.RateLimiter(per_minute=10_000, sleep=lambda _: None),
        sleep=(sleeps.append if sleeps is not None else lambda _: None),
    )


def test_generation_request_parameters() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=document(series([hourly(START, [1])], psr="B16")))

    [s] = make(handler).generation(ec.AREAS["HR"], START, END)
    assert s.psr_type == "B16"
    params = dict(seen[0].url.params)
    assert str(seen[0].url).startswith(ec.API_URL)
    assert params == {
        "documentType": "A75", "processType": "A16", "in_Domain": "10YHR-HEP------M",
        "periodStart": "202606302200", "periodEnd": "202607012200", "securityToken": TOKEN,
    }  # fmt: skip


def test_load_request_uses_out_domain() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=document(kind="A65"))

    make(handler).load(ec.AREAS["IT"], START, END)
    params = dict(seen[0].url.params)
    assert (params["documentType"], params["outBiddingZone_Domain"]) == ("A65", "10YIT-GRTN-----B")


@pytest.mark.parametrize("status", [200, 400])
def test_empty_range_is_no_data(status: int) -> None:
    with pytest.raises(ec.NoData):
        make(lambda _: httpx.Response(status, content=no_data())).generation("x", START, END)


def test_rejected_token() -> None:
    with pytest.raises(ec.EntsoeError, match="rejected the token"):
        make(lambda _: httpx.Response(401)).generation("x", START, END)


def test_rate_limit_ban_is_waited_out() -> None:
    answers = iter([httpx.Response(429), httpx.Response(503), httpx.Response(200, content=document())])
    sleeps: list[float] = []
    assert make(lambda _: next(answers), sleeps).generation("x", START, END) == []
    assert sleeps == [60.0, 180.0]


def test_gives_up_after_retries() -> None:
    sleeps: list[float] = []
    with pytest.raises(ec.EntsoeError, match="HTTP 503"):
        make(lambda _: httpx.Response(503), sleeps).generation("x", START, END)
    assert len(sleeps) == ec.MAX_ATTEMPTS - 1


def test_token_never_reaches_logs_or_errors(caplog: pytest.LogCaptureFixture) -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"cannot connect to {request.url}", request=request)

    caplog.set_level(logging.DEBUG)
    caplog.set_level(logging.DEBUG, logger="httpx")  # other tests may have quietened httpx
    with pytest.raises(ec.EntsoeError) as error:
        make(down).generation("x", START, END)
    assert TOKEN not in str(error.value)
    assert error.value.__cause__ is None and error.value.__suppress_context__
    # a successful request is logged by httpx with its full URL
    make(lambda _: httpx.Response(200, content=document())).generation("x", START, END)
    assert "HTTP Request" in caplog.text
    assert TOKEN not in caplog.text
    assert "securityToken=***" in caplog.text


def test_more_than_a_year_per_request_is_refused() -> None:
    with pytest.raises(ValueError, match="one year"):
        make(lambda _: httpx.Response(200)).generation("x", START, START + timedelta(days=400))


def test_naive_times_are_refused() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        ec.format_time(datetime(2026, 1, 1))


def test_year_windows() -> None:
    windows = list(ec.year_windows(START, START + timedelta(days=800)))
    assert [(b - a).days for a, b in windows] == [365, 365, 70]


def test_token_from_environment() -> None:
    with pytest.raises(ec.EntsoeError, match="ENTSOE_TOKEN"):
        ec.EntsoeClient.from_env({})
    with pytest.raises(ec.EntsoeError, match="empty"):
        ec.EntsoeClient("  ")
    ec.EntsoeClient.from_env({"ENTSOE_TOKEN": TOKEN}).close()


def test_rate_limiter_spaces_requests() -> None:
    now = [0.0]
    slept: list[float] = []

    def sleep(seconds: float) -> None:
        slept.append(seconds)
        now[0] += seconds

    limiter = ec.RateLimiter(per_minute=120, clock=lambda: now[0], sleep=sleep)
    limiter.wait()
    limiter.wait()
    now[0] += 2.0
    limiter.wait()
    assert slept == [0.5]
