"""Monthly totals of the day-ahead price (Faza 40-3), from an invented auction."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

from energymap import publish
from energymap.entsoe import prices
from energymap.entsoe.client import NoData
from energymap.entsoe.energy import TIMEZONE
from energymap.entsoe.parse import Interval, Series

NOW = datetime(2026, 11, 18, 9, 0, tzinfo=UTC)
HOUR = timedelta(hours=1)


def auction(start: datetime, values: list[float], step: timedelta = HOUR) -> Series:
    intervals = tuple(Interval(start + i * step, start + (i + 1) * step, v) for i, v in enumerate(values))
    return Series(None, False, intervals)


class FakeAuction:
    """October 2026: 90 €/MWh, except 12:00 to 14:00 on the 4th and the 5th (0, -20, -5 each day).
    September 2026 has no prices. November 2026 is priced for its first ten days only."""

    def __init__(self) -> None:
        self.asked: list[str] = []

    def prices(self, zone: str, start: datetime, end: datetime) -> list[Series]:
        month = f"{start.year:04d}-{start.month:02d}"
        self.asked.append(month)
        if month == "2026-09":
            raise NoData("no prices")
        hours = int((end - start).total_seconds() // 3600)
        if month == "2026-11":
            return [auction(start, [100.0] * 240)]
        values = [90.0] * hours
        for day in (3, 4):  # the 4th and the 5th
            values[day * 24 + 12 : day * 24 + 15] = [0.0, -20.0, -5.0]
        return [auction(start, values)]


def test_months_are_whole_local_months_whatever_the_clock_change() -> None:
    start, end = prices.month_bounds("2026-10")
    assert (start.isoformat(), end.isoformat()) == ("2026-10-01T00:00:00+02:00", "2026-11-01T00:00:00+01:00")
    assert prices.month_bounds("2026-12")[1] == datetime(2027, 1, 1, tzinfo=TIMEZONE)
    assert prices.months_back(date(2026, 1, 15), 3) == ["2025-11", "2025-12", "2026-01"]


def test_a_month_is_counted_in_hours_and_days_at_or_below_zero() -> None:
    found = prices.collect(FakeAuction(), ["2026-09", "2026-10", "2026-11"])
    assert sorted(found) == ["2026-10", "2026-11"]  # a month without prices is left out, not zeroed
    october = found["2026-10"]
    # 31 days and the hour gained when the clocks go back
    assert (october["hours"], october["reported"]) == (745, 745)
    assert (october["freeHours"], october["freeDays"]) == (6, 2)
    # the earlier of the two equal lowest hours
    assert (october["min"], october["minAt"]) == (-20.0, "2026-10-04T13:00:00+02:00")
    assert october["average"] == round((739 * 90 - 50) / 745, 2)
    # a month under way: its hours so far, and that it is not complete
    november = found["2026-11"]
    assert (november["hours"], november["reported"], november["freeHours"]) == (720, 240, 0)


def test_quarter_hour_prices_make_an_hour_by_their_mean() -> None:
    start, _ = prices.month_bounds("2026-10")
    # the first hour: -30, 10, 10, 10 → 0 on average, an hour at zero; the second: 40
    quarters = auction(start, [-30.0, 10.0, 10.0, 10.0, 40.0, 40.0, 40.0, 40.0], timedelta(minutes=15))
    stats = prices.month_stats([quarters], "2026-10")
    assert stats is not None
    assert (stats["reported"], stats["freeHours"], stats["freeDays"], stats["min"]) == (2, 1, 1, 0.0)
    assert prices.month_stats([], "2026-10") is None


def test_published_months_are_kept_and_fresh_ones_laid_over(tmp_path: Path) -> None:
    store = publish.DirectoryStore(tmp_path)
    first = prices.publish_prices(store, FakeAuction(), ["2026-10"], NOW)
    assert list(first["zones"]["HR"]["months"]) == ["2026-10"]

    second = prices.publish_prices(store, FakeAuction(), ["2026-11"], NOW)
    months = second["zones"]["HR"]["months"]
    assert list(months) == ["2026-10", "2026-11"]
    assert months["2026-10"]["freeDays"] == 2
    published = json.loads((tmp_path / "energy" / "prices.json").read_text(encoding="utf-8"))
    assert published == second

    # the platform answering with less than before does not undo a month that was complete
    class Forgetful(FakeAuction):
        def prices(self, zone: str, start: datetime, end: datetime) -> list[Series]:
            return [auction(start, [90.0] * 24)]

    third = prices.publish_prices(store, Forgetful(), ["2026-10"], NOW)
    assert third["zones"]["HR"]["months"]["2026-10"]["reported"] == 745


def test_nothing_is_published_without_a_single_month(tmp_path: Path) -> None:
    store = publish.DirectoryStore(tmp_path)
    with pytest.raises(prices.PriceDataError, match="no month has prices"):
        prices.publish_prices(store, FakeAuction(), ["2026-09"], NOW)
    assert not (tmp_path / "energy" / "prices.json").exists()

    contradictory = prices.merge(
        None, {"2026-10": {**prices.collect(FakeAuction(), ["2026-10"])["2026-10"], "freeHours": 0}}, NOW
    )
    with pytest.raises(prices.PriceDataError, match="contradict"):
        prices.validate(contradictory)
