"""Download (mocked HTTP) and publish behaviour."""

from __future__ import annotations

import hashlib
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from energymap import build as pipeline
from energymap import cli, config
from energymap.osm.download import (
    RETRY_WAITS_S,
    DownloadError,
    download_region,
    fetch_md5,
    load_state,
    patiently,
    resolve_urls,
)
from energymap.validate import BuildValidationError

INDEX_URL = "https://geo.test/index.json"
PBF_URL = "https://geo.test/europe/croatia-latest.osm.pbf"


def _client(pbf: Path, *, md5: str | None = None, calls: list[str] | None = None) -> httpx.Client:
    payload = pbf.read_bytes()
    checksum = md5 or hashlib.md5(payload, usedforsecurity=False).hexdigest()

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if calls is not None:
            calls.append(url)
        if url == INDEX_URL:
            features = [{"properties": {"id": "croatia", "urls": {"pbf": PBF_URL}}}]
            return httpx.Response(200, json={"features": features})
        if url == PBF_URL + ".md5":
            return httpx.Response(200, text=f"{checksum}  croatia-latest.osm.pbf\n")
        if url == PBF_URL:
            return httpx.Response(200, content=payload)
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_resolve_urls(sample_pbf: Path) -> None:
    with _client(sample_pbf) as client:
        assert resolve_urls(client, INDEX_URL, ["croatia"]) == {"croatia": PBF_URL}
        with pytest.raises(DownloadError, match="montenegro"):
            resolve_urls(client, INDEX_URL, ["croatia", "montenegro"])


def test_fetch_md5_rejects_garbage() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>not found</html>")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client, pytest.raises(DownloadError):
        fetch_md5(client, PBF_URL)


def test_download_verifies_and_skips_unchanged(sample_pbf: Path, tmp_path: Path) -> None:
    calls: list[str] = []
    with _client(sample_pbf, calls=calls) as client:
        state = download_region(client, "croatia", PBF_URL, tmp_path)
        assert (tmp_path / "croatia.osm.pbf").exists()
        assert load_state(tmp_path, "croatia") == state
        downloads = calls.count(PBF_URL)
        again = download_region(client, "croatia", PBF_URL, tmp_path)
    assert again == state
    assert calls.count(PBF_URL) == downloads == 1


def test_download_checksum_mismatch_leaves_nothing(sample_pbf: Path, tmp_path: Path) -> None:
    with _client(sample_pbf, md5="0" * 32) as client, pytest.raises(DownloadError, match="Checksum mismatch"):
        download_region(client, "croatia", PBF_URL, tmp_path)
    assert list(tmp_path.iterdir()) == []


def _prepare(paths: config.Paths, fixtures: Path, pbf: Path) -> None:
    paths.ensure()
    shutil.copy(fixtures / "countries.geojson", paths.reference / "ne_10m_admin_0_countries.geojson")
    with _client(pbf) as client:
        download_region(client, "croatia", PBF_URL, paths.raw)


HR_ONLY = [config.COUNTRY_BY_CODE["HR"]]


def test_build_publishes_atomically(fixtures: Path, sample_pbf: Path, tmp_path: Path) -> None:
    paths = config.Paths(tmp_path)
    _prepare(paths, fixtures, sample_pbf)
    build_dir = pipeline.build(paths, HR_ONLY, now=datetime(2026, 9, 16, 12, tzinfo=UTC))

    assert build_dir.name == "20260916T120000Z"
    assert (paths.out / "LATEST").read_text().strip() == build_dir.name
    manifest = json.loads((build_dir / "manifest.json").read_text())
    # HR scope only: the SI wind farm drops out, the HR-SI interconnector stays
    assert manifest["counts"] == {
        "lines": 4,
        "substations": 2,
        "plants": 3,
        "distribution_lines": 3,
        "distribution_substations": 1,
        "datacenters": 2,
        "chargers": 1,
        "extraction": 5,
    }
    assert manifest["interconnectors"] == 1
    assert manifest["sources"][0]["region_id"] == "croatia"
    lines = [json.loads(x) for x in (build_dir / "lines.ndjson").read_text().splitlines()]
    assert [f["id"] for f in lines] == sorted(f["id"] for f in lines)
    assert not list((paths.out / "builds").glob(".staging-*"))


def test_build_rejects_large_drop_and_keeps_previous(
    fixtures: Path, sample_pbf: Path, tmp_path: Path
) -> None:
    paths = config.Paths(tmp_path)
    _prepare(paths, fixtures, sample_pbf)
    first = pipeline.build(paths, HR_ONLY, now=datetime(2026, 9, 16, 12, tzinfo=UTC))
    manifest = first / "manifest.json"
    data = json.loads(manifest.read_text())
    data["counts"]["lines"] = 100  # pretend the previous build was much larger
    manifest.write_text(json.dumps(data))

    with pytest.raises(BuildValidationError, match="dropped from 100 to 4"):
        pipeline.build(paths, HR_ONLY, now=datetime(2026, 9, 17, 12, tzinfo=UTC))
    assert (paths.out / "LATEST").read_text().strip() == first.name

    forced = pipeline.build(paths, HR_ONLY, allow_drop=True, now=datetime(2026, 9, 17, 12, tzinfo=UTC))
    assert (paths.out / "LATEST").read_text().strip() == forced.name


def test_build_without_download_fails_clearly(tmp_path: Path, fixtures: Path) -> None:
    paths = config.Paths(tmp_path)
    paths.ensure()
    shutil.copy(fixtures / "countries.geojson", paths.reference / "ne_10m_admin_0_countries.geojson")
    with pytest.raises(DownloadError, match="No downloaded extract for HR"):
        pipeline.build(paths, HR_ONLY)


def test_borders_missing_scope_country_is_rejected(fixtures: Path) -> None:
    with pytest.raises(BuildValidationError, match="IT"):
        pipeline.load_index(fixtures / "countries.geojson", frozenset({"HR", "IT"}))


def test_cli_exit_codes(
    fixtures: Path, sample_pbf: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    paths = config.Paths(tmp_path)
    _prepare(paths, fixtures, sample_pbf)
    assert cli.main(["osm", "build", "--data-dir", str(tmp_path), "--countries", "hr"]) == cli.EXIT_OK
    assert "builds" in capsys.readouterr().out
    missing = cli.main(["osm", "build", "--data-dir", str(tmp_path / "empty"), "--countries", "HR"])
    assert missing == cli.EXIT_FAILED
    with pytest.raises(SystemExit):
        cli.main(["osm", "build", "--countries", "XX"])


def test_scope_can_be_wider_than_extracts(fixtures: Path, sample_pbf: Path, tmp_path: Path) -> None:
    paths = config.Paths(tmp_path)
    _prepare(paths, fixtures, sample_pbf)
    build_dir = pipeline.build(paths, HR_ONLY, scope={"HR", "SI"}, now=datetime(2026, 9, 16, 12, tzinfo=UTC))
    manifest = json.loads((build_dir / "manifest.json").read_text())
    assert manifest["scope"] == ["HR", "SI"]
    assert manifest["counts"]["plants"] == 4  # the Slovenian wind farm is now in scope


def test_attribution_names_the_hand_kept_list_only_when_it_was_used() -> None:
    """An empty list is not a source; a list that contributed must be credited on the map."""
    assert "manual" not in pipeline.attribution_sources(None, None, None)
    empty = {"total": 2, "fromManualList": 0, "completedFromManualList": 0}
    assert "manual" not in pipeline.attribution_sources(None, None, empty)
    used = {"total": 3, "fromManualList": 1, "completedFromManualList": 0}
    assert pipeline.attribution_sources(None, None, used) == ["openstreetmap", "manual", "naturalearth"]
    completed_only = {"total": 2, "fromManualList": 0, "completedFromManualList": 1}
    assert "manual" in pipeline.attribution_sources(None, None, completed_only)


def test_an_unreachable_server_is_tried_again_after_a_wait_and_an_answer_is_not() -> None:
    waits: list[float] = []
    calls = 0

    def flaky() -> str:
        nonlocal calls
        calls += 1
        if calls < 3:
            raise httpx.ConnectError("[Errno 101] Network is unreachable")
        return "index"

    assert patiently("Geofabrik index", flaky, sleep=waits.append) == "index"
    assert (calls, waits) == (3, [30.0, 60.0])

    # never reachable: every wait is used, then the build fails with a message that says what happened
    waits.clear()

    def dead() -> str:
        raise httpx.ConnectTimeout("timed out")

    with pytest.raises(DownloadError, match="croatia: unreachable after 5 attempts"):
        patiently("croatia", dead, sleep=waits.append)
    assert waits == list(RETRY_WAITS_S)

    # an answer from the server, even a bad one, is not retried
    waits.clear()

    def refused() -> str:
        raise DownloadError("Unexpected checksum file")

    with pytest.raises(DownloadError, match="Unexpected checksum"):
        patiently("croatia", refused, sleep=waits.append)
    assert waits == []
