from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

from energymap import cli
from energymap.entsoe import fetch as ef
from energymap.entsoe.client import AREAS, ITALY_ZONES, EntsoeClient, NoData
from energymap.entsoe.energy import DailyEnergy
from energymap.entsoe.parse import Interval, Series
from energymap.entsoe.store import EnergyDataError, YearFile, periods
from energymap.schema import Technology

DAY = date(2026, 7, 1)
JULY_1 = datetime(2026, 6, 30, 22, tzinfo=UTC)


def energy(mwh: float, coverage: float, day: date = DAY) -> DailyEnergy:
    return DailyEnergy(
        generation={day: {Technology.SOLAR: mwh}},
        generation_coverage={day: coverage},
        load={day: mwh * 2},
        load_coverage={day: coverage},
    )


def test_merge_keeps_the_better_data() -> None:
    year = YearFile(2026)
    index = year.days.index(DAY)
    assert year.merge("HR", energy(100, 1.0), ["A"]) == 2
    assert year.merge("HR", energy(40, 0.4), ["A"]) == 0  # a thinner retry never replaces good data
    assert year.countries["HR"].generation["solar"][index] == 100
    assert year.merge("HR", energy(110, 1.0), ["B"]) == 2  # a revision with full coverage does
    country = year.countries["HR"]
    assert (country.generation["solar"][index], country.load[index]) == (110, 220)
    assert country.areas == ["A", "B"]
    assert country.load[index - 1] is None and country.generation_coverage[index - 1] == 0.0


def test_a_revised_day_drops_technologies_that_disappeared() -> None:
    year = YearFile(2026)
    first = energy(100, 1.0)
    first.generation[DAY][Technology.WIND] = 5.0
    year.merge("HR", first, [])
    year.merge("HR", energy(100, 1.0), [])
    assert year.countries["HR"].generation["wind"][year.days.index(DAY)] is None


def test_roundtrip_and_validation() -> None:
    year = YearFile(2026)
    year.merge("HR", energy(100, 1.0), ["10YHR-HEP------M"])
    data = json.loads(json.dumps(year.to_json()))
    again = YearFile.from_json(data)
    assert again.to_json() == year.to_json()
    assert len(data["days"]) == 365

    broken = json.loads(json.dumps(data))
    broken["countries"]["HR"]["load"] = [1.0]
    with pytest.raises(EnergyDataError, match="expected 365"):
        YearFile.from_json(broken)
    broken = json.loads(json.dumps(data))
    broken["countries"]["HR"]["coverage"]["load"][0] = 1.5
    with pytest.raises(EnergyDataError, match="between 0 and 1"):
        YearFile.from_json(broken)
    broken = json.loads(json.dumps(data))
    broken["countries"]["HR"]["generation"]["fusion"] = [None] * 365
    with pytest.raises(EnergyDataError, match="unknown technologies"):
        YearFile.from_json(broken)
    with pytest.raises(EnergyDataError):
        YearFile.from_json({"version": 99})


def test_periods_span_years_with_aligned_columns() -> None:
    y2025, y2026 = YearFile(2025), YearFile(2026)
    y2025.merge("HR", energy(10, 1.0, date(2025, 12, 31)), [])
    wind = DailyEnergy(generation={DAY: {Technology.WIND: 7.0}}, generation_coverage={DAY: 1.0})
    y2026.merge("HR", wind, [])
    result = periods([y2026, y2025])["countries"]["HR"]
    months = result["months"]
    assert len(months["periods"]) == 24
    assert len(months["generation"]["wind"]) == len(months["generation"]["solar"]) == 24
    assert months["generation"]["solar"][11] == 10.0 and months["generation"]["solar"][18] is None
    assert months["generation"]["wind"][18] == 7.0
    assert result["years"]["periods"] == ["2025", "2026"]
    assert result["years"]["load"] == [20.0, None]


class FakeSource:
    """Answers like the platform: HR has data; Italy only per zone, and one zone may be missing."""

    def __init__(self, missing_zone: str | None = None) -> None:
        self.missing_zone = missing_zone
        self.calls: list[tuple[str, str]] = []

    def _answer(self, kind: str, area: str, start: datetime, end: datetime) -> list[Series]:
        self.calls.append((kind, area))
        if area == AREAS["IT"] or area == self.missing_zone:
            raise NoData(area)
        hours = int((end - start).total_seconds() // 3600)
        intervals = tuple(
            Interval(start + timedelta(hours=h), start + timedelta(hours=h + 1), 10.0) for h in range(hours)
        )
        return [Series("B16" if kind == "gen" else None, False, intervals)]

    def generation(self, area: str, start: datetime, end: datetime) -> list[Series]:
        return self._answer("gen", area, start, end)

    def load(self, area: str, start: datetime, end: datetime) -> list[Series]:
        return self._answer("load", area, start, end)


def test_update_writes_years_and_periods(tmp_path: Path) -> None:
    source = FakeSource()
    changed = ef.update(source, tmp_path, ["HR", "IT"], JULY_1, JULY_1 + timedelta(days=2))
    assert changed == {2026: 8}  # 2 days * 2 countries * (generation + load)
    year = YearFile.from_json(json.loads((tmp_path / "daily" / "2026.json").read_text()))
    index = year.days.index(DAY)
    assert year.countries["HR"].generation["solar"][index] == 240.0
    assert year.countries["IT"].generation["solar"][index] == 240.0 * len(ITALY_ZONES)
    assert year.countries["IT"].areas == sorted(ITALY_ZONES)
    assert ("gen", AREAS["IT"]) in source.calls  # the country level is always tried first
    months = json.loads((tmp_path / "periods.json").read_text())["countries"]["HR"]["months"]
    assert len(months["periods"]) == 12  # the whole year is listed; months without data are empty
    july = months["periods"].index("2026-07")
    assert months["generation"]["solar"][july] == 480.0
    assert months["generation"]["solar"][july - 1] is None


def test_italy_total_is_a_gap_when_a_zone_is_missing(tmp_path: Path) -> None:
    ef.update(FakeSource(missing_zone=ITALY_ZONES[3]), tmp_path, ["IT"], JULY_1, JULY_1 + timedelta(days=1))
    year = YearFile.from_json(json.loads((tmp_path / "daily" / "2026.json").read_text()))
    index = year.days.index(DAY)
    assert year.countries["IT"].generation.get("solar", [None] * 365)[index] is None
    assert year.countries["IT"].generation_coverage[index] == 0.0


def test_update_spanning_new_year_writes_both_files(tmp_path: Path) -> None:
    start = datetime(2025, 12, 30, 23, tzinfo=UTC)  # 31 December 2025 00:00 CET
    changed = ef.update(FakeSource(), tmp_path, ["HR"], start, start + timedelta(days=2))
    assert changed == {2025: 2, 2026: 2}
    assert (tmp_path / "daily" / "2025.json").exists() and (tmp_path / "daily" / "2026.json").exists()


def test_update_rejects_bad_input(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="no ENTSO-E area"):
        ef.update(FakeSource(), tmp_path, ["XX"], JULY_1, JULY_1 + timedelta(days=1))
    with pytest.raises(ValueError, match="timezone-aware"):
        ef.update(FakeSource(), tmp_path, ["HR"], datetime(2026, 7, 1), datetime(2026, 7, 2))


def test_cli_energy_needs_a_token_and_valid_arguments(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ENTSOE_TOKEN", raising=False)
    assert cli.main(["energy", "refresh", "--data-dir", str(tmp_path)]) == cli.EXIT_FAILED
    for bad in (
        ["fetch", "--from-year", "2014"],
        ["fetch", "--from-year", "abc"],
        ["refresh", "--days", "0"],
    ):
        with pytest.raises(SystemExit):
            cli.main(["energy", *bad, "--data-dir", str(tmp_path)])
    assert cli.main(["energy", "fetch", "--from-year", "2026", "--to-year", "2025",
                     "--data-dir", str(tmp_path)]) == cli.EXIT_REJECTED  # fmt: skip


def test_cli_energy_refresh_with_a_stand_in_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    class StandIn(FakeSource):
        def __enter__(self) -> StandIn:
            return self

        def __exit__(self, *exc: object) -> None:
            return None

    monkeypatch.setattr(EntsoeClient, "from_env", classmethod(lambda cls, env=None: StandIn()))
    assert (
        cli.main(["energy", "refresh", "--days", "2", "--countries", "HR", "--data-dir", str(tmp_path)]) == 0
    )
    assert (tmp_path / "energy" / "periods.json").exists()
