"""HTTP access to the ENTSO-E Transparency Platform.

* one endpoint, parameters select the data item; the token is a query parameter and is never logged
* at most 400 requests per minute per token/IP (a 10-minute ban follows), so requests are spaced out
* at most one year per request, so callers split longer ranges (see ``year_windows``)
* an empty range is not an error: it is answered with an acknowledgement (reason 999) → ``NoData``
"""

from __future__ import annotations

import logging
import os
import re
import time
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import httpx

from energymap.entsoe.parse import Series, is_no_data, parse_document

log = logging.getLogger(__name__)

API_URL = "https://web-api.tp.entsoe.eu/api"
TOKEN_ENV = "ENTSOE_TOKEN"
MAX_REQUESTS_PER_MINUTE = 400
# Stay well under the limit: other tools of the same user may share the token.
REQUESTS_PER_MINUTE = 120
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
MAX_ATTEMPTS = 4

# Energy Identification Codes (EIC) of the control areas / bidding zones (verified against entsoe-py).
AREAS: dict[str, str] = {
    "HR": "10YHR-HEP------M",
    "SI": "10YSI-ELES-----O",
    "HU": "10YHU-MAVIR----U",
    "RS": "10YCS-SERBIATSOV",
    "BA": "10YBA-JPCC-----D",
    "ME": "10YCS-CG-TSO---S",
    "AT": "10YAT-APG------L",
    "IT": "10YIT-GRTN-----B",
}
# Italy publishes much of its data per bidding zone; used when the country-level query has no data.
ITALY_ZONES: tuple[str, ...] = (
    "10Y1001A1001A73I",  # North
    "10Y1001A1001A70O",  # Centre-North
    "10Y1001A1001A71M",  # Centre-South
    "10Y1001A1001A788",  # South
    "10Y1001C--00096J",  # Calabria
    "10Y1001A1001A75E",  # Sicily
    "10Y1001A1001A74G",  # Sardinia
)


_TOKEN_IN_TEXT = re.compile(r"(securityToken=)[^&\s\"']+")


def redact(text: str) -> str:
    return _TOKEN_IN_TEXT.sub(r"\1***", text)


class _RedactToken(logging.Filter):
    """httpx logs every request URL at INFO; the URL carries the token."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact(record.msg)
        if record.args:
            args = record.args if isinstance(record.args, tuple) else (record.args,)
            record.args = tuple(redact(str(a)) if "securityToken=" in str(a) else a for a in args)
        return True


_REDACTOR = _RedactToken()


def _install_redactor() -> None:
    for name in ("httpx", "httpcore"):
        logger = logging.getLogger(name)
        if _REDACTOR not in logger.filters:
            logger.addFilter(_REDACTOR)


class EntsoeError(RuntimeError):
    """The platform could not be queried (after retries), or the token is missing or rejected."""


class NoData(Exception):  # noqa: N818 - an expected outcome, not an error
    """The platform has no data for the requested range."""


def format_time(moment: datetime) -> str:
    if moment.tzinfo is None:
        raise ValueError("ENTSO-E times must be timezone-aware")
    return moment.astimezone(UTC).strftime("%Y%m%d%H%M")


def year_windows(start: datetime, end: datetime) -> Iterator[tuple[datetime, datetime]]:
    """Split [start, end) into windows of at most 365 days (the platform's per-request limit)."""
    cursor = start
    while cursor < end:
        stop = min(cursor + timedelta(days=365), end)
        yield cursor, stop
        cursor = stop


@dataclass(slots=True)
class RateLimiter:
    per_minute: int = REQUESTS_PER_MINUTE
    clock: Callable[[], float] = time.monotonic
    sleep: Callable[[float], None] = time.sleep
    _last: float | None = field(default=None, init=False)

    def wait(self) -> None:
        gap = 60.0 / self.per_minute
        now = self.clock()
        if self._last is not None and now - self._last < gap:
            self.sleep(gap - (now - self._last))
            now = self.clock()
        self._last = now


class EntsoeClient:
    def __init__(
        self,
        token: str,
        http: httpx.Client | None = None,
        limiter: RateLimiter | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if not token.strip():
            raise EntsoeError(f"ENTSO-E token is empty; set {TOKEN_ENV}")
        self._token = token.strip()
        _install_redactor()
        self._http = http or httpx.Client(timeout=httpx.Timeout(30.0, read=120.0))
        self._limiter = limiter or RateLimiter()
        self._sleep = sleep

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> EntsoeClient:
        token = env.get(TOKEN_ENV, "")
        if not token.strip():
            raise EntsoeError(f"Missing environment variable {TOKEN_ENV}; see infra/README.md")
        return cls(token)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> EntsoeClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def query(
        self, params: Mapping[str, str], start: datetime, end: datetime, value_element: str = "quantity"
    ) -> list[Series]:
        """Series for one window (≤ 1 year). Raises NoData for an empty range."""
        if end - start > timedelta(days=366):
            raise ValueError("ENTSO-E accepts at most one year per request; use year_windows()")
        request = {**params, "periodStart": format_time(start), "periodEnd": format_time(end)}
        body = self._get(request)
        if is_no_data(body):
            raise NoData(f"{params.get('documentType')} {format_time(start)}-{format_time(end)}")
        return parse_document(body, value_element)

    def _get(self, params: Mapping[str, str]) -> bytes:
        safe = dict(params)  # the token is only added to the outgoing request below
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self._limiter.wait()
            try:
                response = self._http.get(API_URL, params={**params, "securityToken": self._token})
            except httpx.TransportError as exc:
                if attempt == MAX_ATTEMPTS:
                    # not chained: the original exception may carry the request URL (with the token)
                    raise EntsoeError(f"ENTSO-E unreachable: {type(exc).__name__}") from None
                self._backoff(attempt, "transport error", safe)
                continue
            if response.status_code == 200:
                return response.content
            if response.status_code in {401, 403}:
                raise EntsoeError(f"ENTSO-E rejected the token (HTTP {response.status_code})")
            if response.status_code == 400 and is_no_data(response.content):
                return response.content  # "no matching data" is sometimes sent with HTTP 400
            if response.status_code in RETRY_STATUSES and attempt < MAX_ATTEMPTS:
                self._backoff(attempt, f"HTTP {response.status_code}", safe)
                continue
            raise EntsoeError(f"ENTSO-E returned HTTP {response.status_code} for {safe}")
        raise EntsoeError("unreachable")  # pragma: no cover - the loop always returns or raises

    def _backoff(self, attempt: int, reason: str, params: Mapping[str, str]) -> None:
        # 429 means a ban of up to 10 minutes; the delays add up to a little more than that
        delay = min(60.0 * 3 ** (attempt - 1), 540.0)
        log.warning(
            "ENTSO-E retry",
            extra={"reason": reason, "attempt": attempt, "delay_s": delay, "query": dict(params)},
        )
        self._sleep(delay)

    # ------------------------------------------------------------------ data items

    def generation(self, area: str, start: datetime, end: datetime) -> list[Series]:
        """A75 actual generation per production type (realised)."""
        return self.query({"documentType": "A75", "processType": "A16", "in_Domain": area}, start, end)

    def load(self, area: str, start: datetime, end: datetime) -> list[Series]:
        """A65 actual total load (realised)."""
        return self.query(
            {"documentType": "A65", "processType": "A16", "outBiddingZone_Domain": area}, start, end
        )

    def flows(self, sender: str, receiver: str, start: datetime, end: datetime) -> list[Series]:
        """A11 physical flows from ``sender`` to ``receiver`` (MW)."""
        return self.query({"documentType": "A11", "in_Domain": receiver, "out_Domain": sender}, start, end)

    def prices(self, zone: str, start: datetime, end: datetime) -> list[Series]:
        """A44 day-ahead prices of a bidding zone (EUR/MWh)."""
        return self.query(
            {
                "documentType": "A44",
                "in_Domain": zone,
                "out_Domain": zone,
                "contract_MarketAgreement.type": "A01",
            },
            start,
            end,
            value_element="price.amount",
        )
