"""From ENTSO-E power series to daily energy per country, with honest coverage.

* energy = average MW of an interval * its duration; intervals are split at local midnight if needed
* a local day (Europe/Zagreb; all countries in scope share CET/CEST) may have 23, 24 or 25 hours
* coverage = share of the day for which the platform reported *any* value of that kind; a day without any
  value is ``None``, never 0 (tasks/todo.md: gaps are shown as gaps)
* monthly and yearly totals are derived from the daily ones, so the views cannot disagree
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from energymap.entsoe.parse import Interval, Series
from energymap.schema import Technology

TIMEZONE = ZoneInfo("Europe/Zagreb")

# ENTSO-E production types (psrType) → the map's technology vocabulary
PSR_TECHNOLOGY: dict[str, Technology] = {
    "B01": Technology.BIOMASS,
    "B02": Technology.LIGNITE,
    "B03": Technology.COAL,  # coal-derived gas
    "B04": Technology.GAS,
    "B05": Technology.COAL,
    "B06": Technology.OIL,
    "B07": Technology.OIL,  # oil shale
    "B08": Technology.OTHER,  # peat
    "B09": Technology.GEOTHERMAL,
    "B10": Technology.PUMPED_STORAGE,
    "B11": Technology.HYDRO,  # run-of-river and pondage
    "B12": Technology.HYDRO,  # water reservoir
    "B13": Technology.OTHER,  # marine
    "B14": Technology.NUCLEAR,
    "B15": Technology.OTHER,  # other renewable
    "B16": Technology.SOLAR,
    "B17": Technology.OTHER,  # waste
    "B18": Technology.WIND,  # offshore
    "B19": Technology.WIND,  # onshore
    "B20": Technology.OTHER,
    "B25": Technology.BATTERY,
}


def local_years(first: int, last: int, now: datetime) -> list[tuple[datetime, datetime]]:
    """Request windows aligned to local calendar years, so no day is ever split between requests."""
    windows = []
    for year in range(first, last + 1):
        start = datetime(year, 1, 1, tzinfo=TIMEZONE)
        end = min(datetime(year + 1, 1, 1, tzinfo=TIMEZONE), now)
        if start < end:
            windows.append((start, end))
    return windows


def local_day_bounds(day: date) -> tuple[datetime, datetime]:
    """Start and end of a local day, in UTC.

    UTC on purpose: Python subtracts two datetimes that share a tzinfo by wall-clock time, which makes
    every day 24 hours long, including the 23- and 25-hour days when clocks change.
    """
    start = datetime.combine(day, time(), TIMEZONE).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), time(), TIMEZONE).astimezone(UTC)
    return start, end


def split_by_local_day(interval: Interval) -> Iterable[tuple[date, Interval]]:
    cursor = interval.start
    while cursor < interval.end:
        day = cursor.astimezone(TIMEZONE).date()
        _, day_end = local_day_bounds(day)
        stop = min(interval.end, day_end)
        yield day, Interval(cursor, stop, interval.value)
        cursor = stop


def _covered_seconds(spans: list[tuple[datetime, datetime]]) -> float:
    total = 0.0
    current: tuple[datetime, datetime] | None = None
    for start, end in sorted(spans):
        if current is None or start > current[1]:
            if current is not None:
                total += (current[1] - current[0]).total_seconds()
            current = (start, end)
        else:
            current = (current[0], max(current[1], end))
    if current is not None:
        total += (current[1] - current[0]).total_seconds()
    return total


@dataclass(slots=True)
class DailyEnergy:
    """One country: MWh per local day. Missing days are simply absent."""

    generation: dict[date, dict[Technology, float]] = field(default_factory=dict)
    consumption: dict[date, dict[Technology, float]] = field(default_factory=dict)
    load: dict[date, float] = field(default_factory=dict)
    generation_coverage: dict[date, float] = field(default_factory=dict)
    load_coverage: dict[date, float] = field(default_factory=dict)
    unknown_psr: Counter[str] = field(default_factory=Counter)

    def update(self, other: DailyEnergy) -> None:
        """Take ``other``'s days (a later or refetched period); its values replace ours day by day."""
        self.generation.update(other.generation)
        self.consumption.update(other.consumption)
        self.load.update(other.load)
        self.generation_coverage.update(other.generation_coverage)
        self.load_coverage.update(other.load_coverage)
        self.unknown_psr.update(other.unknown_psr)


def combine_areas(parts: Sequence[DailyEnergy]) -> DailyEnergy:
    """Sum areas that together form a country (Italy's bidding zones).

    A day is only as complete as its least complete area: an area without a value that day counts as 0 %.
    """
    if len(parts) == 1:
        return parts[0]
    result = DailyEnergy()
    for kind in ("generation", "consumption"):
        target: dict[date, dict[Technology, float]] = getattr(result, kind)
        for part in parts:
            for day, techs in getattr(part, kind).items():
                bucket = target.setdefault(day, {})
                for tech, value in techs.items():
                    bucket[tech] = round(bucket.get(tech, 0.0) + value, 3)
    for part in parts:
        for day, value in part.load.items():
            result.load[day] = round(result.load.get(day, 0.0) + value, 3)
        result.unknown_psr.update(part.unknown_psr)
    for kind in ("generation_coverage", "load_coverage"):
        days = set().union(*(getattr(part, kind).keys() for part in parts))
        getattr(result, kind).update(
            {day: min(getattr(part, kind).get(day, 0.0) for part in parts) for day in days}
        )
    return result


def _coverage(spans: Mapping[date, list[tuple[datetime, datetime]]]) -> dict[date, float]:
    result = {}
    for day, day_spans in spans.items():
        start, end = local_day_bounds(day)
        result[day] = round(min(1.0, _covered_seconds(day_spans) / (end - start).total_seconds()), 4)
    return result


def daily_generation(series: Iterable[Series]) -> DailyEnergy:
    """A75 series (one area, one request window) → daily generation and consumption per technology."""
    energy = DailyEnergy()
    sums: dict[bool, defaultdict[date, defaultdict[Technology, float]]] = {
        False: defaultdict(lambda: defaultdict(float)),
        True: defaultdict(lambda: defaultdict(float)),
    }
    spans: defaultdict[date, list[tuple[datetime, datetime]]] = defaultdict(list)
    for item in series:
        tech = PSR_TECHNOLOGY.get(item.psr_type or "")
        if tech is None:
            energy.unknown_psr[item.psr_type or "?"] += 1
            tech = Technology.OTHER
        for interval in item.intervals:
            for day, part in split_by_local_day(interval):
                sums[item.consumption][day][tech] += part.mwh
                if not item.consumption:
                    spans[day].append((part.start, part.end))
    for day, techs in sums[False].items():
        energy.generation[day] = {t: round(v, 3) for t, v in sorted(techs.items())}
    for day, techs in sums[True].items():
        energy.consumption[day] = {t: round(v, 3) for t, v in sorted(techs.items())}
    energy.generation_coverage.update(_coverage(spans))
    return energy


def daily_load(series: Iterable[Series]) -> DailyEnergy:
    """A65 series (one area, one request window) → daily total load."""
    energy = DailyEnergy()
    totals: defaultdict[date, float] = defaultdict(float)
    spans: defaultdict[date, list[tuple[datetime, datetime]]] = defaultdict(list)
    for item in series:
        for interval in item.intervals:
            for day, part in split_by_local_day(interval):
                totals[day] += part.mwh
                spans[day].append((part.start, part.end))
    energy.load.update({day: round(value, 3) for day, value in totals.items()})
    energy.load_coverage.update(_coverage(spans))
    return energy


# ---------------------------------------------------------------- derived periods


@dataclass(frozen=True, slots=True)
class PeriodTotals:
    """Totals for consecutive periods (months or years) of one country."""

    periods: list[str]
    generation: dict[str, list[float | None]]
    consumption: dict[str, list[float | None]]
    load: list[float | None]
    generation_coverage: list[float]
    load_coverage: list[float]


def _period_key(day: date, unit: str) -> str:
    return f"{day.year:04d}-{day.month:02d}" if unit == "month" else f"{day.year:04d}"


def _days_in(period: str) -> list[date]:
    if len(period) == 4:
        first, last = date(int(period), 1, 1), date(int(period), 12, 31)
    else:
        year, month = int(period[:4]), int(period[5:])
        first = date(year, month, 1)
        last = (date(year + (month == 12), month % 12 + 1, 1)) - timedelta(days=1)
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def totals(
    days: Sequence[date],
    generation: Mapping[str, Sequence[float | None]],
    consumption: Mapping[str, Sequence[float | None]],
    load: Sequence[float | None],
    generation_coverage: Sequence[float],
    load_coverage: Sequence[float],
    unit: str,
) -> PeriodTotals:
    """Sum columnar daily values into months or years.

    A period's value is the sum of its reported days (None if none were reported); its coverage is the
    average daily coverage over *all* days of the period, so a half-reported month shows 0.5.
    """
    if unit not in {"month", "year"}:
        raise ValueError("unit must be 'month' or 'year'")
    index: dict[str, list[int]] = defaultdict(list)
    for position, day in enumerate(days):
        index[_period_key(day, unit)].append(position)
    periods = sorted(index)

    def column(values: Sequence[float | None]) -> list[float | None]:
        out: list[float | None] = []
        for period in periods:
            present = [values[i] for i in index[period] if values[i] is not None]
            out.append(round(sum(v for v in present if v is not None), 3) if present else None)
        return out

    def cover(values: Sequence[float]) -> list[float]:
        by_day = {days[i]: values[i] for positions in index.values() for i in positions}
        return [
            round(sum(by_day.get(d, 0.0) for d in _days_in(period)) / len(_days_in(period)), 4)
            for period in periods
        ]

    return PeriodTotals(
        periods=periods,
        generation={tech: column(values) for tech, values in generation.items()},
        consumption={tech: column(values) for tech, values in consumption.items()},
        load=column(load),
        generation_coverage=cover(generation_coverage),
        load_coverage=cover(load_coverage),
    )
