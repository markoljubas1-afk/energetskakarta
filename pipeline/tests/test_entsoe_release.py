from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path

import httpx
import pytest

from energymap import cli, publish
from energymap.entsoe import release as er
from energymap.entsoe.energy import DailyEnergy
from energymap.entsoe.store import YearFile
from energymap.files import write_json_atomic
from energymap.schema import Technology
from energymap.validate import BuildValidationError
from test_scheduled import BASE, serve

NOW = datetime(2026, 9, 16, 5, tzinfo=UTC)


def write_year(root: Path, year: int, days: list[date], country: str = "HR") -> None:
    energy = DailyEnergy(
        generation={d: {Technology.HYDRO: 100.0} for d in days},
        generation_coverage=dict.fromkeys(days, 1.0),
        load={d: 150.0 for d in days},
        load_coverage=dict.fromkeys(days, 1.0),
    )
    path = root / "daily" / f"{year}.json"
    existing = YearFile.from_json(json.loads(path.read_text())) if path.exists() else YearFile(year)
    existing.merge(country, energy, ["area"])
    write_json_atomic(path, existing.to_json())


def test_release_uploads_content_addressed_files_and_pointer_last(tmp_path: Path) -> None:
    root = tmp_path / "energy"
    write_year(root, 2025, [date(2025, 12, 31)])
    write_year(root, 2026, [date(2026, 1, 1), date(2026, 1, 2)])
    store = publish.MemoryStore()
    pointer = er.release(store, root, NOW)

    assert store.writes[-1] == er.POINTER
    assert set(pointer["years"]) == {"2025", "2026"}
    assert pointer["years"]["2026"]["coveredDays"] == {"HR": {"generation": 2, "load": 2}}
    for entry in (*pointer["years"].values(), pointer["periods"]):
        content = store.get_bytes(entry["key"])
        assert content is not None and len(content) == entry["bytes"]
    periods = json.loads(store.get_bytes(pointer["periods"]["key"]) or b"")
    assert periods["countries"]["HR"]["years"]["periods"] == ["2025", "2026"]
    assert (root / "periods.json").exists()
    _, meta = store.objects[pointer["years"]["2025"]["key"]]
    assert meta.cache_control == publish.IMMUTABLE


def test_unchanged_years_are_not_uploaded_again(tmp_path: Path) -> None:
    root = tmp_path / "energy"
    write_year(root, 2025, [date(2025, 6, 1)])
    write_year(root, 2026, [date(2026, 6, 1)])
    store = publish.MemoryStore()
    first = er.release(store, root, NOW)
    store.writes.clear()
    write_year(root, 2026, [date(2026, 6, 2)])
    second = er.release(store, root, NOW)
    assert first["years"]["2025"]["key"] not in store.writes
    assert second["years"]["2026"]["key"] in store.writes


def test_losing_covered_days_is_rejected(tmp_path: Path) -> None:
    root = tmp_path / "energy"
    write_year(root, 2026, [date(2026, 6, 1), date(2026, 6, 2)])
    store = publish.MemoryStore()
    published = er.release(store, root, NOW)
    (root / "daily" / "2026.json").unlink()
    write_year(root, 2026, [date(2026, 6, 1)])
    with pytest.raises(BuildValidationError, match="HR 2026 generation: covered days dropped from 2 to 1"):
        er.release(store, root, NOW)
    assert json.loads(store.get_bytes(er.POINTER) or b"") == published
    er.release(store, root, NOW, allow_drop=True)


def test_a_missing_year_is_rejected(tmp_path: Path) -> None:
    root = tmp_path / "energy"
    write_year(root, 2025, [date(2025, 6, 1)])
    write_year(root, 2026, [date(2026, 6, 1)])
    store = publish.MemoryStore()
    er.release(store, root, NOW)
    (root / "daily" / "2025.json").unlink()
    with pytest.raises(BuildValidationError, match="year 2025 disappeared"):
        er.release(store, root, NOW)


def test_pruning_keeps_current_and_previous_only(tmp_path: Path) -> None:
    root = tmp_path / "energy"
    store = publish.MemoryStore()
    keys = []
    for day in range(1, 5):
        write_year(root, 2026, [date(2026, 6, day)])
        keys.append(er.release(store, root, NOW)["years"]["2026"]["key"])
    remaining = [k for k in store.list_keys("energy/daily/")]
    assert remaining == sorted(keys[-2:])
    previous = json.loads(store.get_bytes(er.PREVIOUS) or b"")
    assert previous["years"]["2026"]["key"] == keys[-2]


def test_nothing_to_release(tmp_path: Path) -> None:
    with pytest.raises(BuildValidationError, match="no daily energy files"):
        er.release(publish.MemoryStore(), tmp_path, NOW)


def test_pull_restores_published_years_on_a_fresh_machine(tmp_path: Path) -> None:
    source = tmp_path / "source"
    write_year(source, 2025, [date(2025, 3, 1)])
    write_year(source, 2026, [date(2026, 3, 1)])
    bucket = tmp_path / "bucket"
    er.release(publish.DirectoryStore(bucket), source, NOW)

    fresh = tmp_path / "fresh"
    with httpx.Client(transport=httpx.MockTransport(serve(bucket))) as client:
        assert er.pull(client, BASE, fresh) == [2025, 2026]
        assert er.pull(client, BASE, fresh) == []  # existing local files are kept
    restored = YearFile.from_json(json.loads((fresh / "daily" / "2026.json").read_text()))
    assert (
        restored.to_json()
        == YearFile.from_json(json.loads((source / "daily" / "2026.json").read_text())).to_json()
    )


def test_pull_with_nothing_published(tmp_path: Path) -> None:
    with httpx.Client(transport=httpx.MockTransport(serve(None))) as client:
        assert er.pull(client, BASE, tmp_path) == []


def test_pull_rejects_tampered_or_mislabelled_files(tmp_path: Path) -> None:
    source = tmp_path / "source"
    write_year(source, 2026, [date(2026, 3, 1)])
    bucket = tmp_path / "bucket"
    pointer = er.release(publish.DirectoryStore(bucket), source, NOW)
    key = pointer["years"]["2026"]["key"]
    (bucket / key).write_text("{}")
    with (
        httpx.Client(transport=httpx.MockTransport(serve(bucket))) as client,
        pytest.raises(er.EnergyReleaseError, match="Checksum mismatch"),
    ):
        er.pull(client, BASE, tmp_path / "a")

    for bad, message in (
        ({"version": 9}, "unsupported"),
        ({"version": 1, "years": {"20x6": pointer["years"]["2026"]}}, "invalid year"),
        ({"version": 1, "years": {"2026": {**pointer["years"]["2026"], "key": "../secret"}}}, "invalid key"),
    ):
        (bucket / er.POINTER).write_text(json.dumps(bad))
        with (
            httpx.Client(transport=httpx.MockTransport(serve(bucket))) as client,
            pytest.raises(er.EnergyReleaseError, match=message),
        ):
            er.pull(client, BASE, tmp_path / "b")


def test_cli_publish_dir_and_pull(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data = tmp_path / "data"
    write_year(data / "energy", 2026, [date(2026, 5, 1)])
    bucket = tmp_path / "bucket"
    assert cli.main(["energy", "publish-dir", "--data-dir", str(data), "--out", str(bucket)]) == 0
    assert (bucket / er.POINTER).exists()

    monkeypatch.setattr(
        cli, "make_client", lambda: httpx.Client(transport=httpx.MockTransport(serve(bucket)))
    )
    fresh = tmp_path / "fresh"
    assert cli.main(["energy", "pull", "--data-dir", str(fresh), "--baseline-url", BASE]) == 0
    assert (fresh / "energy" / "daily" / "2026.json").exists()

    monkeypatch.delenv("R2_ACCOUNT_ID", raising=False)
    assert cli.main(["energy", "publish-r2", "--data-dir", str(data)]) == cli.EXIT_FAILED
