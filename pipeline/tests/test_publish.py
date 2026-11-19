from __future__ import annotations

import gzip
import json
from datetime import UTC, datetime
from pathlib import Path

import boto3
import pytest
from boto3.s3.transfer import TransferConfig
from botocore.exceptions import ClientError
from botocore.stub import ANY, Stubber

from conftest import BuildFactory
from energymap import publish, tiles
from test_tiles import needs_tippecanoe

T1 = datetime(2026, 9, 10, 12, tzinfo=UTC)


def _fake_tiles(build: Path) -> None:
    """Stand-in tiles for tests that are about publishing, not tippecanoe."""
    info = {}
    # the fixture build has distribution features, so its optional archive is there too
    for archive in tiles.ALL_ARCHIVES:
        (build / archive.file).write_bytes(b"PMTiles\x03" + b"\x00" * 200)
        info[archive.key] = {
            "min_zoom": archive.min_zoom,
            "max_zoom": archive.max_zoom,
            "bounds": [14.5, 45.2, 16.5, 45.8],
            "addressed_tiles": 1,
        }
    (build / tiles.TILES_INFO_FILE).write_text(json.dumps(info))


def _ready_build(make_build: BuildFactory, when: datetime) -> Path:
    build = make_build(when)
    _fake_tiles(build)
    return build


def test_publish_uploads_everything_and_pointer_last(make_build: BuildFactory) -> None:
    build = _ready_build(make_build, T1)
    store = publish.MemoryStore()
    result = publish.publish_build(store, build)

    base = f"builds/{build.name}/"
    assert store.writes[-1] == "current.json"
    assert set(result.uploaded) == {
        base + "grid.pmtiles", base + "boundaries.pmtiles", base + "distribution.pmtiles",
        base + "manifest.json", base + "tiles.json",
        base + "lines.ndjson.gz", base + "substations.ndjson.gz", base + "plants.ndjson.gz",
        base + "pipelines.ndjson.gz",
        base + "distribution_lines.ndjson.gz", base + "distribution_substations.ndjson.gz",
        base + "datacenters.ndjson.gz", base + "chargers.ndjson.gz", base + "chargers.pmtiles",
        base + "extraction.ndjson.gz", base + "extraction.pmtiles",
        base + "search.json", base + "stats.json", "current.json",
        base + "timeline.json",  # the fixture has plants with a start year, so the time machine has a file
        base + "plantgrid.json", base + "chargergrid.json", base + "nearby.json",
    }  # fmt: skip

    pointer = json.loads(store.get_bytes("current.json") or b"")
    assert pointer["buildId"] == build.name
    assert pointer["tiles"]["grid"] == {
        "url": base + "grid.pmtiles", "minZoom": 3, "maxZoom": 14, "bounds": [14.5, 45.2, 16.5, 45.8]
    }  # fmt: skip
    assert pointer["tiles"]["boundaries"]["url"] == base + "boundaries.pmtiles"
    assert pointer["tiles"]["boundaries"]["maxZoom"] == 8
    assert pointer["tiles"]["distribution"]["url"] == base + "distribution.pmtiles"
    assert pointer["tiles"]["distribution"]["minZoom"] == 10
    assert pointer["counts"] == {
        "lines": 4,
        "substations": 2,
        "plants": 3,
        "distribution_lines": 3,
        "distribution_substations": 1,
        "datacenters": 2,
        "chargers": 1,
        "extraction": 5,
        "pipelines": 2,
    }
    assert pointer["downloads"]["lines"] == base + "lines.ndjson.gz"
    assert pointer["downloads"]["extraction"] == base + "extraction.ndjson.gz"
    assert pointer["tiles"]["extraction"]["minZoom"] == 3
    assert pointer["search"] == base + "search.json"
    assert pointer["stats"] == base + "stats.json"

    lines = gzip.decompress(store.get_bytes(base + "lines.ndjson.gz") or b"")
    assert lines == (build / "lines.ndjson").read_bytes()

    _, meta = store.objects["current.json"]
    assert meta.cache_control == publish.POINTER_CACHE
    _, tiles_meta = store.objects[base + "grid.pmtiles"]
    assert tiles_meta.cache_control == publish.IMMUTABLE
    assert tiles_meta.content_type == "application/vnd.pmtiles"


def test_incomplete_build_is_refused(make_build: BuildFactory) -> None:
    build = make_build(T1)  # no tiles yet
    store = publish.MemoryStore()
    with pytest.raises(
        publish.PublishError, match=r"missing: tiles\.json, grid\.pmtiles, boundaries\.pmtiles"
    ):
        publish.publish_build(store, build)
    assert store.writes == []


class _TruncatingStore(publish.MemoryStore):
    def put_file(self, key: str, path: Path, meta: publish.ObjectMeta) -> None:
        self.put_bytes(key, path.read_bytes()[:-1], meta)


def test_truncated_upload_never_moves_pointer(make_build: BuildFactory) -> None:
    store = _TruncatingStore()
    with pytest.raises(publish.PublishError, match="incomplete"):
        publish.publish_build(store, _ready_build(make_build, T1))
    assert store.get_bytes("current.json") is None


def test_pruning_keeps_newest_and_current(make_build: BuildFactory) -> None:
    store = publish.MemoryStore()
    ids = []
    for day in range(1, 8):
        build = _ready_build(make_build, datetime(2026, 9, day, 12, tzinfo=UTC))
        ids.append(build.name)
        publish.publish_build(store, build, keep=3)
    remaining = [p.removeprefix("builds/").rstrip("/") for p in store.list_prefixes("builds/")]
    assert remaining == ids[-3:]
    assert publish.current_build_id(store) == ids[-1]


def test_republishing_an_older_build_keeps_it(make_build: BuildFactory) -> None:
    store = publish.MemoryStore()
    builds = [_ready_build(make_build, datetime(2026, 9, day, 12, tzinfo=UTC)) for day in range(1, 5)]
    for build in builds:
        publish.publish_build(store, build, keep=2)
    # rollback: republish the oldest build; it becomes current and must survive pruning
    publish.publish_build(store, builds[0], keep=2)
    assert publish.current_build_id(store) == builds[0].name
    assert f"builds/{builds[0].name}/" in store.list_prefixes("builds/")


def test_keep_must_allow_rollback(make_build: BuildFactory) -> None:
    with pytest.raises(publish.PublishError, match="at least 2"):
        publish.publish_build(publish.MemoryStore(), _ready_build(make_build, T1), keep=1)


def test_env_is_validated() -> None:
    with pytest.raises(publish.PublishError, match="R2_ACCOUNT_ID, R2_BUCKET"):
        publish.R2Store.from_env({"R2_ACCESS_KEY_ID": "a", "R2_SECRET_ACCESS_KEY": "b"})


def test_r2_config_is_compatible() -> None:
    # botocore's Config exposes options dynamically, so read them through vars() for the type checker
    options = vars(publish.r2_config())
    assert options["request_checksum_calculation"] == "when_required"
    assert options["response_checksum_validation"] == "when_required"
    assert options["signature_version"] == "s3v4"


def _stubbed() -> tuple[publish.R2Store, Stubber]:
    client = boto3.client(
        "s3",
        endpoint_url="https://account.r2.cloudflarestorage.com",
        aws_access_key_id="k",
        aws_secret_access_key="s",
        region_name="auto",
        config=publish.r2_config(),
    )
    return publish.R2Store(client, "bucket", TransferConfig(use_threads=False)), Stubber(client)


def test_r2_requests(tmp_path: Path) -> None:
    store, stub = _stubbed()
    path = tmp_path / "f.json"
    path.write_text("{}")
    stub.add_response(
        "put_object", {},
        {"Bucket": "bucket", "Key": "builds/x/f.json", "Body": ANY,
         "ContentType": "application/json; charset=utf-8", "CacheControl": publish.IMMUTABLE},
    )  # fmt: skip
    stub.add_response("head_object", {"ContentLength": 2}, {"Bucket": "bucket", "Key": "builds/x/f.json"})
    stub.add_client_error("head_object", "404", http_status_code=404)
    stub.add_response(
        "list_objects_v2",
        {"CommonPrefixes": [{"Prefix": "builds/b/"}, {"Prefix": "builds/a/"}], "IsTruncated": False},
        {"Bucket": "bucket", "Prefix": "builds/", "Delimiter": "/"},
    )
    stub.add_response(
        "list_objects_v2",
        {"Contents": [{"Key": "builds/a/1"}, {"Key": "builds/a/2"}], "IsTruncated": False},
        {"Bucket": "bucket", "Prefix": "builds/a/"},
    )
    stub.add_response(
        "delete_objects", {},
        {"Bucket": "bucket",
         "Delete": {"Objects": [{"Key": "builds/a/1"}, {"Key": "builds/a/2"}], "Quiet": True}},
    )  # fmt: skip
    with stub:
        store.put_file("builds/x/f.json", path, publish.JSON)
        assert store.size("builds/x/f.json") == 2
        assert store.size("missing") is None
        assert store.list_prefixes("builds/") == ["builds/a/", "builds/b/"]
        assert store.delete_prefix("builds/a/") == 2
    stub.assert_no_pending_responses()


def test_r2_other_errors_propagate() -> None:
    store, stub = _stubbed()
    stub.add_client_error("head_object", "403", http_status_code=403)
    with stub, pytest.raises(ClientError):
        store.size("secret")


@needs_tippecanoe
def test_end_to_end_with_real_tiles(make_build: BuildFactory) -> None:
    build = make_build(T1)
    tiles.build_tiles(build)
    store = publish.MemoryStore()
    publish.publish_build(store, build)
    data = store.get_bytes(f"builds/{build.name}/grid.pmtiles") or b""
    assert data.startswith(b"PMTiles\x03")


def test_directory_store_mirrors_bucket(make_build: BuildFactory, tmp_path: Path) -> None:
    root = tmp_path / "site-data"
    root.mkdir()
    store = publish.DirectoryStore(root)
    first = _ready_build(make_build, datetime(2026, 9, 1, 12, tzinfo=UTC))
    second = _ready_build(make_build, datetime(2026, 9, 2, 12, tzinfo=UTC))
    third = _ready_build(make_build, datetime(2026, 9, 3, 12, tzinfo=UTC))
    for build in (first, second, third):
        publish.publish_build(store, build, keep=2)
    assert json.loads((root / "current.json").read_text())["buildId"] == third.name
    assert (root / "builds" / third.name / "grid.pmtiles").is_file()
    assert sorted(p.name for p in (root / "builds").iterdir()) == [second.name, third.name]
    assert not list(root.rglob(".*.part"))


def test_directory_store_refuses_escape(tmp_path: Path) -> None:
    store = publish.DirectoryStore(tmp_path)
    with pytest.raises(publish.PublishError, match="outside"):
        store.put_bytes("../evil.json", b"{}", publish.JSON)


def test_pointer_lists_attribution_sources(make_build: BuildFactory) -> None:
    build = _ready_build(make_build, T1)
    store = publish.MemoryStore()
    publish.publish_build(store, build)
    pointer = json.loads(store.get_bytes("current.json") or b"")
    assert pointer["attributionSources"] == ["openstreetmap", "naturalearth"]


def test_pointer_falls_back_for_older_manifests() -> None:
    tiles_info = {
        archive.key: {"min_zoom": 0, "max_zoom": 8, "bounds": [0, 0, 1, 1]} for archive in tiles.ARCHIVES
    }
    manifest = {"createdAt": "x", "counts": {}, "attribution": "a", "license": "ODbL-1.0"}
    pointer = publish.pointer_document("20260101T000000Z", manifest, tiles_info)
    assert pointer["attributionSources"] == ["openstreetmap", "naturalearth"]


def test_builds_from_before_optional_layers_can_still_be_published(make_build: BuildFactory) -> None:
    """Rollback to an older build must work although it has neither pipelines nor distribution."""
    build = _ready_build(make_build, T1)
    for layer in (*tiles.OPTIONAL_LAYERS,):
        (build / f"{layer}.ndjson").unlink(missing_ok=True)  # cities exist only with --cities
    for archive in tiles.OPTIONAL_ARCHIVES:
        (build / archive.file).unlink()
    json_path = build / "tiles.json"
    tiles_info = json.loads(json_path.read_text())
    for archive in tiles.OPTIONAL_ARCHIVES:
        del tiles_info[archive.key]
    json_path.write_text(json.dumps(tiles_info))

    store = publish.MemoryStore()
    publish.publish_build(store, build)
    pointer = json.loads(store.get_bytes("current.json") or b"")
    assert set(pointer["downloads"]) == {"lines", "substations", "plants"}
    assert set(pointer["tiles"]) == {"grid", "boundaries"}
