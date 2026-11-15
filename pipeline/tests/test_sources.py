from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from conftest import BuildFactory
from energymap import cli, publish, sources
from energymap.gem.read import GemFormatError
from test_scheduled import BASE, serve

NOW = datetime(2026, 9, 16, 12, tzinfo=UTC)


def client_for(root: Path | None) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(serve(root)))


def test_upload_then_fetch_roundtrip(fixtures: Path, tmp_path: Path) -> None:
    bucket = tmp_path / "bucket"
    source = sources.upload_gem(publish.DirectoryStore(bucket), fixtures / "gem_sample.csv", NOW)
    assert source.key.startswith("sources/gem/") and source.key.endswith("-gem_sample.csv")
    assert source.plants == 5
    pointer = json.loads((bucket / sources.GEM_POINTER).read_text())
    assert pointer["sha256"] == source.sha256

    with client_for(bucket) as client:
        fetched = sources.fetch_gem(client, BASE, tmp_path / "data" / "sources")
    assert fetched is not None
    assert fetched.read_bytes() == (fixtures / "gem_sample.csv").read_bytes()


def test_pointer_is_written_last(fixtures: Path) -> None:
    store = publish.MemoryStore()
    sources.upload_gem(store, fixtures / "gem_sample.csv", NOW)
    assert store.writes[-1] == sources.GEM_POINTER
    _, meta = store.objects[sources.GEM_POINTER]
    assert meta.cache_control == publish.POINTER_CACHE


def test_wrong_files_are_never_uploaded(tmp_path: Path, fixtures: Path) -> None:
    store = publish.MemoryStore()
    not_gem = tmp_path / "prices.csv"
    not_gem.write_text("Date,Price\n2026-01-01,100\n")
    with pytest.raises(GemFormatError):
        sources.upload_gem(store, not_gem, NOW)
    lines = (fixtures / "gem_sample.csv").read_text().splitlines()
    elsewhere = tmp_path / "gem.csv"
    elsewhere.write_text("\n".join([lines[0], *[line for line in lines if ",Slovakia," in line]]) + "\n")
    with pytest.raises(sources.SourceError, match="no usable units"):
        sources.upload_gem(store, elsewhere, NOW)
    wrong_type = tmp_path / "gem.json"
    wrong_type.write_text("{}")
    with pytest.raises(sources.SourceError, match=r"\.xlsx or \.csv"):
        sources.upload_gem(store, wrong_type, NOW)
    assert store.writes == []


def test_nothing_uploaded_means_no_gem() -> None:
    with client_for(None) as client:
        assert sources.fetch_gem(client, BASE, Path("/nonexistent")) is None


def test_tampered_file_is_rejected(fixtures: Path, tmp_path: Path) -> None:
    bucket = tmp_path / "bucket"
    source = sources.upload_gem(publish.DirectoryStore(bucket), fixtures / "gem_sample.csv", NOW)
    (bucket / source.key).write_text("tampered")
    target = tmp_path / "out"
    with client_for(bucket) as client, pytest.raises(sources.SourceError, match="Checksum mismatch"):
        sources.fetch_gem(client, BASE, target)
    assert list(target.iterdir()) == []


def test_up_to_date_file_is_not_downloaded_again(fixtures: Path, tmp_path: Path) -> None:
    bucket = tmp_path / "bucket"
    sources.upload_gem(publish.DirectoryStore(bucket), fixtures / "gem_sample.csv", NOW)
    target = tmp_path / "out"
    requests: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request.url.path)
        return serve(bucket)(request)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        sources.fetch_gem(client, BASE, target)
        sources.fetch_gem(client, BASE, target)
    assert sum(1 for path in requests if path.endswith("gem_sample.csv")) == 1


@pytest.mark.parametrize(
    ("pointer", "message"),
    [({"key": "builds/x.csv", "name": "x.csv", "sha256": "0" * 64, "bytes": 1}, "invalid key"),
     ({"key": "sources/gem/../x", "name": "x.csv", "sha256": "0" * 64, "bytes": 1}, "invalid key"),
     ({"key": "sources/gem/x.csv", "name": "x.csv", "sha256": "abc", "bytes": 1}, "invalid sha256"),
     ({"key": "sources/gem/x.csv", "name": "x.csv", "sha256": "0" * 64, "bytes": 0}, "invalid size"),
     ({"key": "sources/gem/x.csv", "name": "../../etc/x.exe", "sha256": "0" * 64, "bytes": 1}, "xlsx or"),
     ([1], "not a JSON object")],
)  # fmt: skip
def test_malformed_pointer(pointer: object, message: str, tmp_path: Path) -> None:
    (tmp_path / "sources" / "gem").mkdir(parents=True)
    (tmp_path / sources.GEM_POINTER).write_text(json.dumps(pointer))
    with client_for(tmp_path) as client, pytest.raises(sources.SourceError, match=message):
        sources.fetch_gem(client, BASE, tmp_path / "out")


def test_unreachable_bucket_is_an_error() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    with httpx.Client(transport=httpx.MockTransport(down)) as client, pytest.raises(sources.SourceError):
        sources.fetch_gem(client, BASE, Path("/nonexistent"))


def test_safe_name_keeps_names_readable() -> None:
    assert (
        sources.safe_name("Global-Integrated-Power-August-2026 (1).xlsx")
        == "Global-Integrated-Power-August-2026_1_.xlsx"
    )


def test_cli_upload_and_fetch(
    fixtures: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    bucket = tmp_path / "bucket"
    assert cli.main(["sources", "gem-upload", str(fixtures / "gem_sample.csv"), "--dir", str(bucket)]) == 0
    assert capsys.readouterr().out.strip().startswith("sources/gem/")

    monkeypatch.setattr(cli, "make_client", lambda: client_for(bucket))
    data = tmp_path / "data"
    assert cli.main(["sources", "gem-fetch", "--data-dir", str(data), "--baseline-url", BASE]) == 0
    printed = capsys.readouterr().out.strip()
    assert printed == str(data / "sources" / "gem_sample.csv")

    monkeypatch.setattr(cli, "make_client", lambda: client_for(None))
    assert cli.main(["sources", "gem-fetch", "--data-dir", str(data), "--baseline-url", BASE]) == 0
    assert capsys.readouterr().out.strip() == ""  # no GEM: the workflow builds without it


def test_pruning_builds_never_touches_sources(
    make_build: BuildFactory, fixtures: Path, tmp_path: Path
) -> None:
    from test_publish import _ready_build

    store = publish.MemoryStore()
    sources.upload_gem(store, fixtures / "gem_sample.csv", NOW)
    for day in range(1, 5):
        publish.publish_build(store, _ready_build(make_build, datetime(2026, 9, day, tzinfo=UTC)), keep=2)
    assert store.get_bytes(sources.GEM_POINTER) is not None
    shutil.rmtree(tmp_path, ignore_errors=True)
