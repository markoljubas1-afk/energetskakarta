from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from conftest import BuildFactory
from energymap import cli, tiles
from test_tiles import needs_tippecanoe


def test_unknown_build_is_rejected(tmp_path: Path) -> None:
    assert cli.main(["tiles", "build", "--data-dir", str(tmp_path)]) == cli.EXIT_REJECTED


def test_path_traversal_build_id_is_rejected(make_build: BuildFactory) -> None:
    build = make_build(datetime(2026, 9, 16, 12, tzinfo=UTC))
    data_dir = build.parents[2]
    assert (
        cli.main(["tiles", "build", "--data-dir", str(data_dir), "--build", "../builds"]) == cli.EXIT_REJECTED
    )


def test_publish_without_credentials_fails_cleanly(
    make_build: BuildFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        monkeypatch.delenv(name, raising=False)
    build = make_build(datetime(2026, 9, 16, 12, tzinfo=UTC))
    data_dir = build.parents[2]
    assert cli.main(["publish", "r2", "--data-dir", str(data_dir)]) == cli.EXIT_FAILED


@needs_tippecanoe
def test_tiles_build_latest(make_build: BuildFactory, capsys: pytest.CaptureFixture[str]) -> None:
    build = make_build(datetime(2026, 9, 16, 12, tzinfo=UTC))
    data_dir = build.parents[2]
    assert cli.main(["tiles", "build", "--data-dir", str(data_dir)]) == cli.EXIT_OK
    printed = capsys.readouterr().out.split()
    # the fixture has distribution features, so its optional archive is built and printed too
    assert printed == [str(build / archive.file) for archive in tiles.ALL_ARCHIVES]
