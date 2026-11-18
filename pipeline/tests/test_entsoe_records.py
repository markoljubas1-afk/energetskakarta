"""Record days for the live layer (Faza 39): chosen from invented daily files, fetched from a fake ENTSO-E."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

from energymap import publish
from energymap.entsoe import live, records
from energymap.entsoe.client import AREAS, NoData
from energymap.entsoe.parse import Interval, Series
from energymap.entsoe.store import CountryYear, YearFile

NOW = datetime(2026, 11, 17, 16, 0, tzinfo=UTC)


def year_file(year: int, **days: dict[str, float]) -> YearFile:
    """A year of Croatia in which every day is complete and quiet, except the days given as ``mmdd``."""
    result = YearFile(year)
    n = len(result.days)
    data = CountryYear(
        generation={
            "hydro": [10_000.0] * n,
            "wind": [1_000.0] * n,
            "solar": [500.0] * n,
            "gas": [8_000.0] * n,
        },
        load=[50_000.0] * n,
        generation_coverage=[1.0] * n,
        load_coverage=[1.0] * n,
    )
    for mmdd, values in days.items():
        index = result.days.index(date(year, int(mmdd[1:3]), int(mmdd[3:5])))
        for name, value in values.items():
            if name == "load":
                data.load[index] = value
            elif name == "coverage":
                data.generation_coverage[index] = value
            else:
                data.generation[name][index] = value
    result.countries["HR"] = data
    return result


YEARS = [
    year_file(
        2024,
        d0719={"load": 68_000.0},
        # a huge wind figure on a day that was only half reported is a gap, not a record
        d0302={"wind": 90_000.0, "coverage": 0.5},
        d0530={"gas": 0.0},
    ),
    year_file(2025, d0331={"wind": 25_000.0}, d0801={"solar": 4_200.0}, d0412={"load": 32_000.0}),
]


def test_the_record_days_are_read_off_complete_days_only() -> None:
    found = {record.kind: record for record in records.records(YEARS)}

    assert (found["wind"].day, found["wind"].value) == (date(2025, 3, 31), 25_000.0)
    assert (found["solar"].day, found["solar"].value) == (date(2025, 8, 1), 4_200.0)
    assert found["load_high"].day == date(2024, 7, 19)
    assert found["load_low"].day == date(2025, 4, 12)
    # without gas that day: hydro, wind and solar are all there is
    assert (found["renewable_share"].day, found["renewable_share"].value) == (date(2024, 5, 30), 1.0)
    assert [record.kind for record in records.records(YEARS)] == [kind for kind, _ in records.KINDS]

    # days still being reported are not looked at, and a country without data has no records
    early = records.records(YEARS, until=date(2025, 3, 31))
    assert {record.kind: record.day for record in early}["wind"] == date(2024, 1, 1)
    assert records.records(YEARS, "SI") == []


class FakeSource:
    """Croatia exports 300 MW to Slovenia every hour; only Croatia has a market; nobody reports generation.
    A day in ``silent`` has nothing at all."""

    def __init__(self, silent: frozenset[date] = frozenset()) -> None:
        self.silent = silent

    def _quiet(self, start: datetime) -> bool:
        return (start + timedelta(days=1)).date() in self.silent

    def flows(self, sender: str, receiver: str, start: datetime, end: datetime) -> list[Series]:
        if self._quiet(start) or {sender, receiver} != {AREAS["HR"], AREAS["SI"]} or sender != AREAS["HR"]:
            raise NoData("no flows")
        hours = int((end - start).total_seconds() // 3600)
        return [
            Series(
                None,
                False,
                tuple(
                    Interval(start + timedelta(hours=i), start + timedelta(hours=i + 1), 300.0)
                    for i in range(hours)
                ),
            )
        ]

    def prices(self, zone: str, start: datetime, end: datetime) -> list[Series]:
        if self._quiet(start) or zone != AREAS["HR"]:
            raise NoData("no market")
        hours = int((end - start).total_seconds() // 3600)
        return [
            Series(
                None,
                False,
                tuple(
                    Interval(start + timedelta(hours=i), start + timedelta(hours=i + 1), 80.0)
                    for i in range(hours)
                ),
                sequence=1,
            )
        ]

    def generation(self, area: str, start: datetime, end: datetime) -> list[Series]:
        raise NoData("no generation")


def test_a_record_day_is_fetched_in_the_live_layers_own_shape() -> None:
    day = date(2024, 7, 19)
    document = records.collect_day(FakeSource(), day)

    assert document["day"] == "2024-07-19"
    assert document["hours"][0].startswith("2024-07-18T00:00") and document["hours"][-1].startswith(
        "2024-07-20T23"
    )
    live.validate(document)
    assert records.has_day(document, day)
    # a document that says nothing about the country on that day is not a day worth showing
    assert not records.has_day(document, day, "ME")


def test_a_day_already_there_is_kept_and_anything_else_is_fetched_afresh(tmp_path: Path) -> None:
    day = date(2024, 7, 19)
    document = records.collect_day(FakeSource(), day)
    good = tmp_path / "2024-07-19.json"
    good.write_text(json.dumps(document), encoding="utf-8")
    assert records.kept_day(good, day) == document

    # a file for another day, a broken file, another shape and no file at all are not kept
    assert records.kept_day(good, date(2020, 4, 12)) is None
    broken = tmp_path / "broken.json"
    broken.write_text("{not json", encoding="utf-8")
    assert records.kept_day(broken, day) is None
    other = tmp_path / "other.json"
    other.write_text(json.dumps({"hours": ["2024-07-19T00:00:00+02:00"]}), encoding="utf-8")
    assert records.kept_day(other, day) is None
    assert records.kept_day(tmp_path / "missing.json", day) is None


def test_only_days_with_data_are_listed_and_published(tmp_path: Path) -> None:
    found = records.records(YEARS)
    silent = date(2025, 4, 12)
    source = FakeSource(frozenset({silent}))
    documents: dict[str, dict[str, object]] = {}
    for day in sorted({record.day for record in found}):
        try:
            document = records.collect_day(source, day)
        except live.LiveDataError:
            continue
        documents[day.isoformat()] = document
    index = records.index_document(found, [date.fromisoformat(d) for d in documents], NOW)

    assert [entry["date"] for entry in index["days"]] == [
        "2024-05-30",
        "2024-07-19",
        "2025-03-31",
        "2025-08-01",
    ]
    assert index["missing"] == ["2025-04-12"]
    assert index["days"][1]["records"] == [{"kind": "load_high", "value": 68_000.0, "unit": "MWh"}]
    assert index["days"][1]["key"] == "live/days/2024-07-19.json"

    store = publish.DirectoryStore(tmp_path)
    records.publish_days(store, index, documents)
    published = json.loads((tmp_path / "live" / "days" / "index.json").read_text(encoding="utf-8"))
    assert len(published["days"]) == 4
    assert json.loads((tmp_path / "live" / "days" / "2025-03-31.json").read_text(encoding="utf-8"))[
        "day"
    ] == ("2025-03-31")
    assert not (tmp_path / "live" / "days" / "2025-04-12.json").exists()

    # nothing to show, or an index that names a day without its document: nothing is published
    with pytest.raises(records.RecordDaysError, match="no record day has data"):
        records.publish_days(store, records.index_document(found, [], NOW), {})
    with pytest.raises(records.RecordDaysError, match="document is missing"):
        records.publish_days(store, index, {})
