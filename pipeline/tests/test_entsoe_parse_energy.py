from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from energymap.entsoe import energy as en
from energymap.entsoe.parse import EntsoeParseError, Interval, is_no_data, parse_document, parse_resolution
from energymap.schema import Technology
from entsoe_xml import document, hourly, no_data, period, series

# 1 July 2026 00:00 in Zagreb (CEST, UTC+2)
JULY_1 = datetime(2026, 6, 30, 22, tzinfo=UTC)


def test_generation_and_pumping_are_told_apart() -> None:
    xml = document(
        series([hourly(JULY_1, [100, 100])], psr="B16"),
        series([hourly(JULY_1, [50, 0])], psr="B10", consumption=True),
    )
    solar, pumping = parse_document(xml)
    assert (solar.psr_type, solar.consumption, len(solar.intervals)) == ("B16", False, 2)
    assert (pumping.psr_type, pumping.consumption) == ("B10", True)
    assert solar.intervals[1].start == JULY_1 + timedelta(hours=1)
    assert solar.intervals[0].mwh == 100.0


def test_curve_a03_holds_values_until_the_next_point() -> None:
    xml = document(series([hourly(JULY_1, [10, None, None, 40])], psr="B19", curve="A03"))
    [wind] = parse_document(xml)
    assert [iv.value for iv in wind.intervals] == [10, 10, 10, 40]
    assert wind.intervals[-1].end == JULY_1 + timedelta(hours=4)


def test_curve_a01_leaves_missing_positions_missing() -> None:
    [wind] = parse_document(document(series([hourly(JULY_1, [10, None, 30])], psr="B19")))
    assert [iv.value for iv in wind.intervals] == [10, 30]


def test_quarter_hours_and_several_periods() -> None:
    quarters = period(JULY_1, "PT15M", [100, 100, 100, 100], timedelta(minutes=15))
    later = hourly(JULY_1 + timedelta(hours=1), [60])
    [s] = parse_document(document(series([quarters, later], psr="B04")))
    assert len(s.intervals) == 5
    assert sum(iv.mwh for iv in s.intervals) == pytest.approx(160.0)


@pytest.mark.parametrize(
    ("xml", "message"),
    [(b"<html>", "not XML"), (no_data(), "acknowledgement"),
     (b'<Other xmlns="x"/>', "unexpected document"),
     (document(series([period(JULY_1, "PT7S", [1], timedelta(hours=1))])), "unsupported resolution"),
     (document(series([hourly(JULY_1, [1])], curve="A09")), "unsupported curveType"),
     (document(series([hourly(JULY_1, [1]).replace("<position>1</position>", "<position>5</position>")])),
      "outside period")],
)  # fmt: skip
def test_bad_documents(xml: bytes, message: str) -> None:
    with pytest.raises(EntsoeParseError, match=message):
        parse_document(xml)


def test_no_data_detection() -> None:
    assert is_no_data(no_data())
    assert not is_no_data(document())
    assert not is_no_data(b"garbage")


def test_resolutions() -> None:
    assert parse_resolution("PT15M") == timedelta(minutes=15)
    assert parse_resolution("PT1H") == timedelta(hours=1)
    assert parse_resolution("P1D") == timedelta(days=1)


# ---------------------------------------------------------------- energy


def test_daily_energy_by_local_day_with_coverage() -> None:
    xml = document(
        series([hourly(JULY_1, [100] * 24)], psr="B16"),
        series([hourly(JULY_1, [10] * 12)], psr="B11"),
        series([hourly(JULY_1, [5] * 24)], psr="B12"),
        series([hourly(JULY_1, [20] * 24)], psr="B10", consumption=True),
        series([hourly(JULY_1, [1] * 24)], psr="B99"),
    )
    daily = en.daily_generation(parse_document(xml))
    day = date(2026, 7, 1)
    assert daily.generation[day] == {
        Technology.HYDRO: 240.0, Technology.OTHER: 24.0, Technology.SOLAR: 2400.0,
    }  # fmt: skip
    assert daily.consumption[day] == {Technology.PUMPED_STORAGE: 480.0}
    assert daily.generation_coverage[day] == 1.0
    assert daily.unknown_psr == {"B99": 1}


def test_half_reported_day_and_consumption_does_not_count_as_coverage() -> None:
    xml = document(
        series([hourly(JULY_1, [100] * 12)], psr="B16"),
        series([hourly(JULY_1 + timedelta(hours=12), [5] * 12)], psr="B10", consumption=True),
    )
    daily = en.daily_generation(parse_document(xml))
    assert daily.generation_coverage[date(2026, 7, 1)] == 0.5


def test_dst_days_have_23_and_25_hours() -> None:
    spring = datetime(2026, 3, 28, 23, tzinfo=UTC)  # 29 March 00:00 CET
    autumn = datetime(2026, 10, 24, 22, tzinfo=UTC)  # 25 October 00:00 CEST
    load = en.daily_load(parse_document(document(
        series([hourly(spring, [1000] * 23)], consumption=True),
        series([hourly(autumn, [1000] * 25)], consumption=True),
        kind="A65",
    )))  # fmt: skip
    assert load.load[date(2026, 3, 29)] == 23000.0
    assert load.load[date(2026, 10, 25)] == 25000.0
    assert load.load_coverage[date(2026, 3, 29)] == 1.0
    assert load.load_coverage[date(2026, 10, 25)] == 1.0


def test_intervals_are_split_at_local_midnight() -> None:
    two_days = Interval(JULY_1 - timedelta(hours=6), JULY_1 + timedelta(hours=6), 10.0)
    parts = list(en.split_by_local_day(two_days))
    assert [(day, part.mwh) for day, part in parts] == [(date(2026, 6, 30), 60.0), (date(2026, 7, 1), 60.0)]


def test_combining_zones_takes_the_weakest_coverage() -> None:
    day = date(2026, 7, 1)
    north = en.DailyEnergy(generation={day: {Technology.GAS: 100.0}}, generation_coverage={day: 1.0},
                           load={day: 500.0}, load_coverage={day: 1.0})  # fmt: skip
    south = en.DailyEnergy(generation={day: {Technology.GAS: 50.0, Technology.SOLAR: 10.0}},
                           generation_coverage={day: 0.5})  # fmt: skip
    total = en.combine_areas([north, south])
    assert total.generation[day] == {Technology.GAS: 150.0, Technology.SOLAR: 10.0}
    assert total.generation_coverage[day] == 0.5
    assert total.load_coverage[day] == 0.0  # the south reported no load that day


def test_local_years_align_to_calendar_and_stop_now() -> None:
    now = datetime(2026, 9, 16, 12, tzinfo=UTC)
    windows = en.local_years(2025, 2026, now)
    assert windows[0][0] == datetime(2025, 1, 1, tzinfo=en.TIMEZONE)
    assert windows[0][1] == datetime(2026, 1, 1, tzinfo=en.TIMEZONE)
    assert windows[1][1] == now


def test_months_and_years_are_derived_with_honest_gaps() -> None:
    days = [date(2026, 1, 30), date(2026, 1, 31), date(2026, 2, 1)]
    result = en.totals(
        days,
        generation={"solar": [10.0, None, 5.0]},
        consumption={},
        load=[None, None, None],
        generation_coverage=[1.0, 0.0, 1.0],
        load_coverage=[0.0, 0.0, 0.0],
        unit="month",
    )
    assert result.periods == ["2026-01", "2026-02"]
    assert result.generation["solar"] == [10.0, 5.0]
    assert result.load == [None, None]  # nothing reported is not zero
    assert result.generation_coverage == [round(1 / 31, 4), round(1 / 28, 4)]
    with pytest.raises(ValueError, match="unit"):
        en.totals(days, {}, {}, [None] * 3, [0.0] * 3, [0.0] * 3, unit="week")


def test_day_bounds_are_real_durations() -> None:
    for day, hours in ((date(2026, 3, 29), 23), (date(2026, 10, 25), 25), (date(2026, 7, 1), 24)):
        start, end = en.local_day_bounds(day)
        assert (end - start) == timedelta(hours=hours)


def test_split_intervals_keep_real_durations_across_clock_changes() -> None:
    # 28 March 22:00 UTC to 29 March 23:00 UTC: the rest of 28 March, then all 23 hours of 29 March
    interval = Interval(datetime(2026, 3, 28, 22, tzinfo=UTC), datetime(2026, 3, 29, 22, tzinfo=UTC), 1.0)
    parts = dict(en.split_by_local_day(interval))
    assert parts[date(2026, 3, 28)].mwh == 1.0
    assert parts[date(2026, 3, 29)].mwh == 23.0
