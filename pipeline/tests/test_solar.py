"""Solar potential: rasters as the Global Solar Atlas publishes them (see potential.py), in miniature."""

from __future__ import annotations

import io
import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import httpx
import numpy as np
import pytest
import tifffile
from PIL import Image

from energymap import publish
from energymap.solar import download, potential

NOW = datetime(2026, 11, 16, 12, tzinfo=UTC)
CELL = 1 / 120
NAN = np.nan


def geotiff(values: list[list[float]], west: float, north: float, scale: float = CELL) -> bytes:
    """A float32 raster with the two tags a GeoTIFF places itself by."""
    buffer = io.BytesIO()
    tifffile.imwrite(
        buffer,
        np.array(values, dtype=np.float32),
        compression="zlib",
        extratags=[
            (33550, "d", 3, (scale, scale, 0.0), False),  # ModelPixelScaleTag
            (33922, "d", 6, (0.0, 0.0, 0.0, west, north, 0.0), False),  # ModelTiepointTag
        ],
    )
    return buffer.getvalue()


def archive(path: Path, tiff: bytes, extra: tuple[str, ...] = ("PVOUT_01.tif",)) -> Path:
    with zipfile.ZipFile(path, "w") as target:
        folder = path.stem
        target.writestr(f"{folder}/PVOUT.tif", tiff)
        for name in extra:
            target.writestr(f"{folder}/monthly/{name}", b"not read")
    return path


# two countries next to each other at 45 N: A covers two columns from 16 E, B the two after them,
# one row lower
A = potential.read_tile("A", geotiff([[1000, 1100], [1200, NAN]], 16.0, 45.0))
B = potential.read_tile("B", geotiff([[NAN, 1400], [1500, 1600]], 16.0 + 2 * CELL, 45.0 - CELL))


def test_reads_where_a_raster_lies_from_its_own_tags() -> None:
    assert (A.col, A.row) == (16 * 120, 45 * 120)
    assert (B.col, B.row) == (16 * 120 + 2, 45 * 120 - 1)
    assert A.values.dtype == np.float32 and A.values.shape == (2, 2)


def test_refuses_a_raster_it_was_not_written_for() -> None:
    with pytest.raises(potential.SolarDataError, match="not 30 arc-seconds"):
        potential.read_tile("coarse", geotiff([[1.0]], 16.0, 45.0, scale=0.1))
    with pytest.raises(potential.SolarDataError, match="not on the 30 arc-second grid"):
        potential.read_tile("shifted", geotiff([[1.0]], 16.001, 45.0))
    with pytest.raises(potential.SolarDataError, match="not a georeferenced TIFF"):
        potential.read_tile("plain", b"II*\x00 not really")


def test_puts_countries_side_by_side_and_keeps_gaps_as_gaps() -> None:
    whole = potential.mosaic([A, B])
    assert (whole.west, whole.north) == (16.0, 45.0)
    assert whole.east == pytest.approx(16.0 + 4 * CELL) and whole.south == pytest.approx(45.0 - 3 * CELL)
    expected = np.array(
        [[1000, 1100, NAN, NAN], [1200, NAN, NAN, 1400], [NAN, NAN, 1500, 1600]], dtype=np.float32
    )
    np.testing.assert_array_equal(whole.values, expected)
    # where two rasters have a value for one cell, the first one's stands
    overlap = potential.read_tile("C", geotiff([[9999.0]], 16.0, 45.0))
    assert potential.mosaic([A, overlap]).values[0, 0] == 1000
    with pytest.raises(potential.SolarDataError, match="no rasters"):
        potential.mosaic([])
    with pytest.raises(potential.SolarDataError, match="no values"):
        potential.mosaic([potential.read_tile("empty", geotiff([[NAN]], 16.0, 45.0))])


def test_colours_follow_the_ramp_and_nothing_is_transparent_nothing() -> None:
    low, high = potential.RAMP[0], potential.RAMP[-1]
    rgba = potential.colours(np.array([[low[0], high[0], 100, 5000, NAN]], dtype=np.float32))
    assert tuple(rgba[0, 0]) == (*low[1], 255)
    assert tuple(rgba[0, 1]) == (*high[1], 255)
    # below and above the ramp: its first and last colour, never something made up
    assert tuple(rgba[0, 2]) == (*low[1], 255) and tuple(rgba[0, 3]) == (*high[1], 255)
    assert tuple(rgba[0, 4]) == (0, 0, 0, 0)
    stops = [stop for stop, _ in potential.RAMP]
    assert stops == sorted(stops)


def test_the_picture_is_spaced_as_the_map_spaces_latitude() -> None:
    # ten degrees of latitude, one value (and so one colour, all inside the ramp) per degree band
    rows = 10 * 120
    values = np.repeat(np.linspace(950, 1700, 10, dtype=np.float32), 120).reshape(rows, 1)
    tall = potential.Mosaic(np.tile(values, (1, 240)), west=10.0, north=50.0)
    image = Image.open(io.BytesIO(potential.picture(tall)))
    width, height = image.size
    # taller than the source's own rows: the projection stretches latitude this far north
    assert width == 240 and height > rows
    pixels = image.convert("RGBA").load()
    assert pixels is not None
    # the northernmost degree (50 to 49 N) is taller on the map than the southernmost (41 to 40 N)
    column = [pixels[0, y] for y in range(height)]
    first, last = column[0], column[-1]
    assert sum(1 for colour in column if colour == first) > sum(1 for colour in column if colour == last)
    # and the middle of the picture is north of the middle of the latitudes (45 N): in the band from
    # 46 to 45 N or above
    middle = column[height // 2]
    assert middle in {column[i] for i in range(height // 2)}


def test_the_value_grid_averages_blocks_and_marks_empty_ones() -> None:
    values = np.full((12, 12), NAN, dtype=np.float32)
    values[0:6, 0:6] = 1200
    values[0, 6] = 1500  # one cell in an otherwise empty block
    values[6:12, 6:12] = np.where(np.arange(36).reshape(6, 6) % 2 == 0, 1000, 1100)
    grid = potential.value_grid(potential.Mosaic(values, west=16.0, north=45.0))
    assert (grid["cols"], grid["rows"], grid["cellDeg"]) == (2, 2, pytest.approx(0.05))
    assert grid["values"] == [1200, 1500, 0, 1050]
    # a raster that does not divide evenly keeps its last partial block
    odd = potential.value_grid(potential.Mosaic(np.full((7, 13), 1300, dtype=np.float32), 16.0, 45.0))
    assert (odd["cols"], odd["rows"]) == (3, 2) and set(odd["values"]) == {1300}


def test_builds_and_publishes_the_picture_before_the_index_that_names_it(tmp_path: Path) -> None:
    files = [
        archive(tmp_path / ("A" + download.WANTED), geotiff([[1000, 1100], [1200, NAN]], 16.0, 45.0)),
        archive(
            tmp_path / ("B" + download.WANTED),
            geotiff([[NAN, 1400], [1500, 1600]], 16.0 + 2 * CELL, 45.0 - CELL),
        ),
    ]
    tiles = [potential.read_archive(path) for path in files]
    assert [tile.name for tile in tiles] == ["A", "B"]
    document, image = potential.build(tiles, NOW)
    assert document["countries"] == ["A", "B"]
    assert (document["min"], document["max"]) == (1000, 1600)
    assert document["bounds"] == pytest.approx([16.0, 45.0 - 3 * CELL, 16.0 + 4 * CELL, 45.0])
    assert document["license"] == "CC-BY-4.0" and "Solargis" in document["attribution"]
    assert document["ramp"][0] == [900, "#2c1a5c"]

    store = publish.MemoryStore()
    published = potential.publish_solar(store, document, image)
    assert published["image"].startswith("solar/pvout-") and published["image"].endswith(".png")
    assert store.writes == [published["image"], potential.INDEX_KEY]
    assert json.loads(store.get_bytes(potential.INDEX_KEY) or b"") == published
    # the same picture again is not uploaded again
    potential.publish_solar(store, document, image)
    assert store.writes == [published["image"], potential.INDEX_KEY, potential.INDEX_KEY]


def test_an_archive_without_exactly_one_yearly_raster_is_refused(tmp_path: Path) -> None:
    with zipfile.ZipFile(tmp_path / "X_GISdata.zip", "w") as target:
        target.writestr("X/monthly/PVOUT_01.tif", b"x")
    with pytest.raises(potential.SolarDataError, match=r"expected one PVOUT\.tif, found 0"):
        potential.read_archive(tmp_path / "X_GISdata.zip")


def test_fetches_each_place_through_the_atlas_listing_and_its_redirect(tmp_path: Path) -> None:
    body = b"zip bytes"
    asked: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        asked.append(str(request.url))
        if request.url.host == "storage.test":
            return httpx.Response(200, content=body)
        place = request.url.path.removeprefix("/download/").split("/")[0].replace("%20", " ")
        name = place.replace(" ", "-") + download.WANTED
        if request.url.path.endswith(".zip"):
            return httpx.Response(302, headers={"location": f"https://storage.test/{name}?signed=1"})
        assert request.url.params["multilang"] == "true"
        return httpx.Response(
            200, json=[{"name": name, "size": str(len(body))}, {"name": place + "_map.png", "size": "5"}]
        )

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        paths = download.fetch(client, tmp_path / "solar")
        assert [path.name.split("_GISdata")[0] for path in paths] == [
            place.replace(" ", "-") for place in download.PLACES
        ]
        assert all(path.read_bytes() == body for path in paths)
        # a second run finds every archive there, with the listed size, and downloads nothing
        asked.clear()
        download.fetch(client, tmp_path / "solar")
        assert not any("storage.test" in url for url in asked)


def test_a_listing_without_the_archive_or_a_short_download_stops_everything(tmp_path: Path) -> None:
    def empty(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    with (
        httpx.Client(transport=httpx.MockTransport(empty)) as client,
        pytest.raises(potential.SolarDataError, match="found 0"),
    ):
        download.fetch(client, tmp_path)

    def short(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith(".zip"):
            return httpx.Response(200, content=b"cut")
        return httpx.Response(200, json=[{"name": "Austria" + download.WANTED, "size": "100"}])

    with (
        httpx.Client(transport=httpx.MockTransport(short)) as client,
        pytest.raises(potential.SolarDataError, match="the list says 100"),
    ):
        download.fetch(client, tmp_path)
    assert not list(tmp_path.glob("*.zip"))
