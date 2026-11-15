"""The scheduled-update path: baseline from the published build, change report, publication of the report."""

from __future__ import annotations

import gzip
import json
import shutil
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from conftest import BuildFactory
from energymap import build as pipeline
from energymap import cli, config, publish
from energymap.validate import BuildValidationError
from test_publish import _ready_build

BASE = "https://data.test/"
T1 = datetime(2026, 9, 9, 3, tzinfo=UTC)
T2 = datetime(2026, 9, 16, 3, tzinfo=UTC)


def serve(root: Path | None) -> Callable[[httpx.Request], httpx.Response]:
    """A public bucket backed by a DirectoryStore folder (None = nothing published)."""

    def handler(request: httpx.Request) -> httpx.Response:
        if root is None:
            return httpx.Response(404)
        target = root / request.url.path.lstrip("/")
        return httpx.Response(200, content=target.read_bytes()) if target.is_file() else httpx.Response(404)

    return handler


@pytest.fixture
def bucket(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    root = tmp_path / "bucket"
    root.mkdir()
    monkeypatch.setattr(
        pipeline, "make_client", lambda: httpx.Client(transport=httpx.MockTransport(serve(root)))
    )
    yield root


def published_first_build(make_build: BuildFactory, bucket: Path) -> Path:
    first = _ready_build(make_build, T1)
    publish.publish_build(publish.DirectoryStore(bucket), first)
    return first


def test_published_counts_come_from_the_pointer(make_build: BuildFactory, bucket: Path) -> None:
    first = published_first_build(make_build, bucket)
    expected = json.loads((first / "manifest.json").read_text())["counts"]
    assert pipeline.published_counts(BASE) == expected


def test_no_publication_yet_means_no_baseline(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        pipeline, "make_client", lambda: httpx.Client(transport=httpx.MockTransport(serve(None)))
    )
    assert pipeline.published_counts(BASE) is None


def test_explicit_baseline_guards_a_fresh_machine(make_build: BuildFactory, tmp_path: Path) -> None:
    """No local history (like a CI runner), but the published build had far more lines: reject."""
    build = make_build(T1)
    paths = config.Paths(build.parents[2])
    shutil.rmtree(paths.out)  # forget local history
    with pytest.raises(BuildValidationError, match="dropped from 400 to 4"):
        pipeline.build(
            paths,
            [config.COUNTRY_BY_CODE["HR"]],
            now=T2,
            baseline={"lines": 400, "substations": 2, "plants": 3},
        )
    assert not (paths.out / "LATEST").exists()


def test_diff_against_published_build(make_build: BuildFactory, bucket: Path) -> None:
    published_first_build(make_build, bucket)
    second = _ready_build(make_build, T2)
    # simulate an edit in OpenStreetMap: one plant changes capacity, one substation disappears
    plants = [json.loads(line) for line in (second / "plants.ndjson").read_text().splitlines()]
    plants[0]["properties"]["capacityMw"] = 999.0
    (second / "plants.ndjson").write_text("".join(json.dumps(p) + "\n" for p in plants))
    stations = (second / "substations.ndjson").read_text().splitlines()
    (second / "substations.ndjson").write_text("\n".join(stations[1:]) + "\n")

    result = pipeline.write_diff(second, BASE)

    assert result.baseline_build_id == "20260909T030000Z"
    assert result.layers["plants"].changed == [plants[0]["id"]]
    assert len(result.layers["substations"].removed) == 1
    assert result.layers["lines"].unchanged == 4  # retrievedAt differs between builds, nothing else
    stored = json.loads((second / "diff.json").read_text())
    assert stored["layers"]["plants"]["changed"] == 1


def test_diff_is_published_and_referenced(make_build: BuildFactory, bucket: Path) -> None:
    published_first_build(make_build, bucket)
    second = _ready_build(make_build, T2)
    pipeline.write_diff(second, BASE)
    publish.publish_build(publish.DirectoryStore(bucket), second)
    pointer = json.loads((bucket / "current.json").read_text())
    assert pointer["diff"] == f"builds/{second.name}/diff.json"
    assert (bucket / pointer["diff"]).is_file()
    # the first build had no report, so its pointer had no "diff" key; downloads stay valid gzip
    assert gzip.decompress((bucket / pointer["downloads"]["plants"]).read_bytes())


def test_first_publication_has_no_diff_key(make_build: BuildFactory, bucket: Path) -> None:
    published_first_build(make_build, bucket)
    assert "diff" not in json.loads((bucket / "current.json").read_text())


def test_cli_diff_appends_summary(make_build: BuildFactory, bucket: Path, tmp_path: Path) -> None:
    published_first_build(make_build, bucket)
    second = _ready_build(make_build, T2)
    summary = tmp_path / "summary.md"
    summary.write_text("# earlier step\n")
    data_dir = second.parents[2]
    code = cli.main(
        ["diff", "--data-dir", str(data_dir), "--build", second.name, "--baseline-url", BASE,
         "--summary", str(summary)]
    )  # fmt: skip
    assert code == cli.EXIT_OK
    text = summary.read_text()
    assert text.startswith("# earlier step\n## Promjene podataka")
    assert "Usporedba s objavljenim buildom 20260909T030000Z" in text


def test_cli_build_with_unreachable_baseline_fails(
    make_build: BuildFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    build = make_build(T1)

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    monkeypatch.setattr(pipeline, "make_client", lambda: httpx.Client(transport=httpx.MockTransport(down)))
    code = cli.main(
        ["osm", "build", "--data-dir", str(build.parents[2]), "--countries", "HR", "--baseline-url", BASE]
    )
    assert code == cli.EXIT_FAILED


def test_cli_build_first_publication(make_build: BuildFactory, monkeypatch: pytest.MonkeyPatch) -> None:
    build = make_build(T1)
    monkeypatch.setattr(
        pipeline, "make_client", lambda: httpx.Client(transport=httpx.MockTransport(serve(None)))
    )
    code = cli.main(
        ["osm", "build", "--data-dir", str(build.parents[2]), "--countries", "HR", "--baseline-url", BASE]
    )
    assert code == cli.EXIT_OK
