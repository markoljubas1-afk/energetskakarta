"""What is usual for a country (the middle half of its daily renewable shares), from invented daily files."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from energymap import publish
from energymap.entsoe import usual
from energymap.entsoe.store import CountryYear, YearFile

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)


def year_file(year: int, country: str, renewable_of_100: list[float], coverage: float = 1.0) -> YearFile:
    """A year whose day ``i`` made ``renewable_of_100[i % n]`` MWh from hydro and the rest of 100 from gas."""
    result = YearFile(year)
    n = len(result.days)
    hydro: list[float | None] = [renewable_of_100[i % len(renewable_of_100)] for i in range(n)]
    gas: list[float | None] = [100.0 - (value or 0.0) for value in hydro]
    result.countries[country] = CountryYear(
        generation={"hydro": hydro, "gas": gas, "pumped_storage": [0.0] * n},
        load=[None] * n,
        generation_coverage=[coverage] * n,
        load_coverage=[0.0] * n,
    )
    return result


def test_the_middle_half_of_the_last_years_daily_shares() -> None:
    # shares cycle through 20, 40, 60, 80 %: a quarter of the days at each
    years = [year_file(2025, "HR", [20, 40, 60, 80]), year_file(2026, "HR", [20, 40, 60, 80])]
    document = usual.usual_document(years, NOW)

    assert (document["from"], document["to"]) == (
        "2025-11-15",
        "2026-11-14",
    )  # 365 days, the last two left out
    croatia = document["countries"]["HR"]
    assert croatia["days"] == 365
    # a quarter of the days at each of four shares: the middle half lies between the second and the third
    assert (croatia["low"], croatia["median"], croatia["high"]) == (0.2, 0.4, 0.6)
    usual.validate(document)

    # only days inside the window count
    shares = usual.daily_shares(years, "HR", date(2026, 1, 1), date(2026, 1, 4))
    assert shares == [0.2, 0.4, 0.6, 0.8]


def test_a_country_with_too_few_complete_days_has_no_yardstick() -> None:
    years = [
        year_file(2025, "HR", [50]),
        year_file(2026, "HR", [50]),
        # half-reported days are not days
        year_file(2026, "SI", [10], coverage=0.5),
    ]
    merged = YearFile(2026)
    merged.countries = {**years[1].countries, **years[2].countries}
    document = usual.usual_document([years[0], merged], NOW)
    assert sorted(document["countries"]) == ["HR"]
    assert document["missing"] == ["SI"]
    assert document["countries"]["HR"] == {"low": 0.5, "median": 0.5, "high": 0.5, "days": 365}


def test_publishes_only_a_document_with_a_country_in_it(tmp_path: Path) -> None:
    store = publish.DirectoryStore(tmp_path)
    years = [year_file(2025, "HR", [30, 70]), year_file(2026, "HR", [30, 70])]
    usual.publish_usual(store, years, NOW)
    published = json.loads((tmp_path / "live" / "usual.json").read_text(encoding="utf-8"))
    assert published["countries"]["HR"]["days"] == 365 and published["windowDays"] == 365

    before = (tmp_path / "live" / "usual.json").read_text(encoding="utf-8")
    with pytest.raises(usual.UsualDataError, match="no country has enough complete days"):
        usual.publish_usual(store, [], NOW)
    assert (tmp_path / "live" / "usual.json").read_text(encoding="utf-8") == before
