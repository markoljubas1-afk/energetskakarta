"""The hand-kept data centre list: what it accepts, what it refuses, and how it meets OSM.

Every entry in this file is invented for the test and stays here; the list shipped in the repository is
empty on purpose (overrides/datacenters.yaml).
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
import yaml

from energymap import datacenters
from energymap.geo.countries import CountryIndex
from energymap.schema import DataCenter, Provenance, Status

RETRIEVED = datetime(2026, 9, 18, 12, tzinfo=UTC)
SCOPE = frozenset({"HR", "SI"})

VALID: dict[str, Any] = {
    "id": "primjer-zagreb",
    "name": "DC Primjer",
    "operator": "Primjer d.o.o.",
    "location": [15.98, 45.81],
    "status": "operating",
    "powerMw": 2.5,
    "year": 2019,
    "source": "https://primjer.invalid/o-nama",
}


def write(tmp_path: Path, *entries: Any) -> Path:
    path = tmp_path / "datacenters.yaml"
    path.write_text(yaml.safe_dump({"datacenters": list(entries)}), encoding="utf-8")
    return path


def osm_centre(centre_id: str, lon: float, lat: float, **overrides: Any) -> DataCenter:
    fields: dict[str, Any] = {
        "id": centre_id,
        "status": Status.OPERATING,
        "operator": None,
        "provenance": (
            Provenance(
                source="openstreetmap",
                source_id=centre_id.removeprefix("osm:"),
                license="ODbL-1.0",
                retrieved_at=RETRIEVED,
            ),
        ),
        "name": None,
        "power_mw": None,
        "commissioning_year": None,
        "country": "HR",
        "location": (lon, lat),
    }
    return DataCenter(**(fields | overrides))


def test_the_shipped_list_is_empty_and_valid() -> None:
    """The repository must never carry invented records: the list ships empty, with only its schema."""
    shipped = Path(__file__).resolve().parents[2] / "overrides" / "datacenters.yaml"
    assert datacenters.load_list(shipped) == ()


def test_a_missing_file_simply_means_no_entries(tmp_path: Path) -> None:
    assert datacenters.load_list(tmp_path / "absent.yaml") == ()
    assert datacenters.load_list(None) == ()


def test_a_full_entry_is_read(tmp_path: Path) -> None:
    (entry,) = datacenters.load_list(write(tmp_path, VALID))
    assert entry.slug == "primjer-zagreb" and entry.id == "dc:primjer-zagreb"
    assert (entry.lon, entry.lat) == (15.98, 45.81)
    assert entry.status is Status.OPERATING and entry.power_mw == 2.5 and entry.year == 2019
    assert entry.provenance(RETRIEVED).url == VALID["source"]


def test_power_and_year_are_optional(tmp_path: Path) -> None:
    """Leaving a figure out is always allowed; inventing one is what must be impossible."""
    (entry,) = datacenters.load_list(write(tmp_path, {k: v for k, v in VALID.items() if k not in
                                                      {"powerMw", "year", "operator"}}))  # fmt: skip
    assert entry.power_mw is None and entry.year is None and entry.operator is None


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"source": None}, "missing required keys"),
        ({"source": "http://primjer.invalid"}, "https link"),
        ({"source": "vidio sam negdje"}, "https link"),
        ({"name": None}, "missing required keys"),
        ({"name": "  "}, "non-empty string"),
        ({"location": None}, "missing required keys"),
        ({"location": [15.98]}, r"\[lon, lat\]"),
        ({"location": ["15.98", "45.81"]}, r"\[lon, lat\]"),
        ({"status": "maybe"}, "'status' must be one of"),
        ({"powerMw": 0}, "positive number"),
        ({"powerMw": "oko 3 MW"}, "positive number"),
        ({"year": "2019"}, "whole number"),
        ({"capacity": 5}, "unknown keys"),
    ],
)
def test_a_bad_entry_fails_the_whole_file(tmp_path: Path, change: dict[str, Any], message: str) -> None:
    entry = {k: v for k, v in (VALID | change).items() if v is not None}
    with pytest.raises(datacenters.DataCenterListError, match=message):
        datacenters.load_list(write(tmp_path, entry))


def test_duplicate_ids_are_refused(tmp_path: Path) -> None:
    with pytest.raises(datacenters.DataCenterListError, match="duplicate ids"):
        datacenters.load_list(write(tmp_path, VALID, VALID | {"name": "Drugi"}))


def test_a_broken_file_is_never_partly_used(tmp_path: Path) -> None:
    path = tmp_path / "datacenters.yaml"
    path.write_text("datacenters: [\n", encoding="utf-8")
    with pytest.raises(datacenters.DataCenterListError, match="not valid YAML"):
        datacenters.load_list(path)


def test_an_entry_near_an_osm_centre_completes_it(tmp_path: Path, index: CountryIndex) -> None:
    """The OSM object keeps its id and position, so links people already shared keep working."""
    centres = {"osm:node/70": osm_centre("osm:node/70", 15.9805, 45.8105)}
    entries = datacenters.load_list(write(tmp_path, VALID))

    stats = datacenters.apply_list(centres, entries, index=index, scope=SCOPE, retrieved_at=RETRIEVED)

    assert stats == {"entries": 1, "outside_scope": 0, "completed_osm": 1, "added": 0}
    assert set(centres) == {"osm:node/70"}
    completed = centres["osm:node/70"]
    assert completed.location == (15.9805, 45.8105)  # unchanged
    assert completed.name == "DC Primjer" and completed.power_mw == 2.5 and completed.operator is not None
    assert [p.source for p in completed.provenance] == ["openstreetmap", "manual"]
    assert completed.provenance[1].url == VALID["source"]


def test_an_entry_far_from_any_osm_centre_becomes_its_own_record(tmp_path: Path, index: CountryIndex) -> None:
    centres = {"osm:node/70": osm_centre("osm:node/70", 15.5, 45.5)}
    entries = datacenters.load_list(write(tmp_path, VALID))

    stats = datacenters.apply_list(centres, entries, index=index, scope=SCOPE, retrieved_at=RETRIEVED)

    assert stats == {"entries": 1, "outside_scope": 0, "completed_osm": 0, "added": 1}
    added = centres["dc:primjer-zagreb"]
    assert added.country == "HR" and added.name == "DC Primjer"
    assert [p.source for p in added.provenance] == ["manual"]


def test_an_entry_outside_the_region_is_counted_and_skipped(tmp_path: Path, index: CountryIndex) -> None:
    far_away = VALID | {"id": "izvan-regije", "location": [2.35, 48.85]}
    entries = datacenters.load_list(write(tmp_path, far_away))
    centres: dict[str, DataCenter] = {}

    stats = datacenters.apply_list(centres, entries, index=index, scope=SCOPE, retrieved_at=RETRIEVED)

    assert stats["outside_scope"] == 1 and centres == {}


def test_summary_counts_only_published_power(tmp_path: Path, index: CountryIndex) -> None:
    centres = {"osm:node/70": osm_centre("osm:node/70", 15.5, 45.5)}
    entries = datacenters.load_list(write(tmp_path, VALID))
    stats = datacenters.apply_list(centres, entries, index=index, scope=SCOPE, retrieved_at=RETRIEVED)

    summary = datacenters.summary(stats, centres)

    assert summary == {
        "total": 2,
        "fromManualList": 1,
        "completedFromManualList": 0,
        "withPower": 1,  # the OSM one has no published power and is not invented
        "powerMw": 2.5,
    }
