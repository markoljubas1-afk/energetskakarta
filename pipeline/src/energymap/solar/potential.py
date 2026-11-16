"""Solar potential (Faza 34-2): the expected yearly output of a photovoltaic system, as a layer of the map.

The source is the Global Solar Atlas 2.0 (World Bank / ESMAP, data by Solargis): the layer PVOUT, the
long-term average of yearly electricity from one kilowatt-peak of a free-standing system at the optimum
tilt, in kWh per kWp, on a grid of 30 arc-seconds (about one kilometre). Each country is one GeoTIFF in a
ZIP archive, clipped to the country's border.

Verified on the files downloaded on 2026-11-16:

* the archive has ``<...>/PVOUT.tif`` (the yearly total) next to twelve monthly ``PVOUT_MM.tif``;
* the raster is float32, compressed with deflate, NaN outside the country;
* ``ModelTiepointTag`` gives the top-left corner (Croatia: 13.0, 47.0) and ``ModelPixelScaleTag`` the cell
  size (1/120 degree both ways); every country's corner is a whole number of cells from any other's;
* its metadata states the licence: "PV power potential data (c) 2019 Solargis. The data is published in
  Global Solar Atlas under a Creative Commons 4.0 Attribution International license, CC BY 4.0", with
  disputes going to WIPO mediation.

What is published is two things made from one mosaic of the countries: a picture of the whole region for
the map, and a coarser grid of values for reading a number off a place. The picture's rows are spaced as
the map's projection (Web Mercator) spaces latitude, so the map can stretch it between its four corners
without bending it; the values stay in plain degrees.

These are a model's long-term averages, not measurements, and not a statement about any site: they know
nothing of shading, land use, protected areas or the grid. The website says so next to the layer.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import zipfile
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import tifffile
from numpy.typing import NDArray
from PIL import Image

from energymap.publish import IMMUTABLE, ObjectMeta, ObjectStore

log = logging.getLogger(__name__)

VERSION = 1
PREFIX = "solar/"
INDEX_KEY = PREFIX + "index.json"
INDEX_META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")
#: cells per degree in the atlas's rasters (30 arc-seconds)
CELLS_PER_DEGREE = 120
#: the value grid has one number per this many source cells each way: 0.05 degree, about 4 by 5.5 km
VALUE_STEP = 6
SOURCE = "Global Solar Atlas 2.0"
LICENSE = "CC-BY-4.0"
ATTRIBUTION = "Global Solar Atlas 2.0 (World Bank / ESMAP), solar resource data © 2019 Solargis, CC BY 4.0"
#: kWh/kWp a year → colour: dark and cool where the yield is low, warm and bright where it is high.
#: The range covers the region (about 940 in the Alps to 1700 in Sicily) with room either side.
RAMP: tuple[tuple[int, tuple[int, int, int]], ...] = (
    (900, (44, 26, 92)),
    (1100, (108, 43, 138)),
    (1250, (176, 58, 126)),
    (1400, (232, 106, 72)),
    (1550, (246, 176, 52)),
    (1750, (252, 240, 164)),
)

Raster = NDArray[np.float32]


class SolarDataError(RuntimeError):
    """A source file is not what the module was written against; nothing is published."""


@dataclass(frozen=True, slots=True)
class Tile:
    """One country's raster and where its top-left corner is, in cells from the origin of degrees."""

    name: str
    values: Raster
    #: column of the left edge and row of the top edge, counted in cells from longitude 0 and latitude 0
    col: int
    row: int


def read_tile(name: str, tiff: bytes) -> Tile:
    try:
        with tifffile.TiffFile(io.BytesIO(tiff)) as document:
            page = document.pages[0]
            scale = page.tags["ModelPixelScaleTag"].value  # type: ignore[union-attr]
            tie = page.tags["ModelTiepointTag"].value  # type: ignore[union-attr]
            values = page.asarray()
    except (KeyError, IndexError, ValueError, tifffile.TiffFileError) as exc:
        raise SolarDataError(f"{name}: not a georeferenced TIFF ({exc})") from exc
    if values.ndim != 2 or values.dtype != np.float32:
        raise SolarDataError(f"{name}: expected one band of float32, got {values.dtype} {values.shape}")
    if not (math.isclose(scale[0], 1 / CELLS_PER_DEGREE) and math.isclose(scale[1], 1 / CELLS_PER_DEGREE)):
        raise SolarDataError(f"{name}: cell size {scale[0]} x {scale[1]} is not 30 arc-seconds")
    col, row = tie[3] * CELLS_PER_DEGREE, tie[4] * CELLS_PER_DEGREE
    if not (math.isclose(col, round(col), abs_tol=1e-6) and math.isclose(row, round(row), abs_tol=1e-6)):
        raise SolarDataError(f"{name}: corner {tie[3]}, {tie[4]} is not on the 30 arc-second grid")
    return Tile(name, values, round(col), round(row))


def read_archive(path: Path) -> Tile:
    """The yearly PVOUT raster of one country's archive."""
    with zipfile.ZipFile(path) as archive:
        members = [name for name in archive.namelist() if name.rsplit("/", 1)[-1] == "PVOUT.tif"]
        if len(members) != 1:
            raise SolarDataError(f"{path.name}: expected one PVOUT.tif, found {len(members)}")
        return read_tile(path.stem.split("_GISdata", 1)[0], archive.read(members[0]))


@dataclass(frozen=True, slots=True)
class Mosaic:
    values: Raster
    #: west and north edge in degrees; cells are 1/CELLS_PER_DEGREE each way
    west: float
    north: float

    @property
    def east(self) -> float:
        return float(self.west + self.values.shape[1] / CELLS_PER_DEGREE)

    @property
    def south(self) -> float:
        return float(self.north - self.values.shape[0] / CELLS_PER_DEGREE)


def mosaic(tiles: list[Tile]) -> Mosaic:
    """The countries side by side on one grid. Each is clipped to its border, so they do not overlap except
    along it; where two have a value for the same cell the first one's stands (they are the same model)."""
    if not tiles:
        raise SolarDataError("no rasters to put together")
    left = min(tile.col for tile in tiles)
    right = max(tile.col + tile.values.shape[1] for tile in tiles)
    top = max(tile.row for tile in tiles)
    bottom = min(tile.row - tile.values.shape[0] for tile in tiles)
    values = np.full((top - bottom, right - left), np.nan, dtype=np.float32)
    for tile in tiles:
        rows, cols = tile.values.shape
        window = values[top - tile.row : top - tile.row + rows, tile.col - left : tile.col - left + cols]
        np.copyto(window, tile.values, where=np.isnan(window) & np.isfinite(tile.values))
    if not np.isfinite(values).any():
        raise SolarDataError("the rasters hold no values")
    return Mosaic(values, left / CELLS_PER_DEGREE, top / CELLS_PER_DEGREE)


def _mercator(latitude: NDArray[np.float64] | float) -> Any:
    return np.log(np.tan(np.pi / 4 + np.radians(latitude) / 2))


def colours(values: Raster) -> NDArray[np.uint8]:
    """Each value as RGBA by ``RAMP``, linear between its stops; no value is fully transparent."""
    stops = np.array([stop for stop, _ in RAMP], dtype=np.float32)
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    known = np.isfinite(values)
    for channel in range(3):
        levels = np.array([colour[channel] for _, colour in RAMP], dtype=np.float32)
        rgba[..., channel] = np.where(known, np.interp(values, stops, levels), 0).astype(np.uint8)
    rgba[..., 3] = np.where(known, 255, 0)
    return rgba


def picture(source: Mosaic) -> bytes:
    """The mosaic as a PNG whose rows are evenly spaced in Web Mercator, so an image stretched between
    the four corners on the map lies where the data is. Each row of the picture takes the source row its
    latitude falls in (nearest neighbour: a cell keeps its own value and colour)."""
    rows, cols = source.values.shape
    top, bottom = _mercator(source.north), _mercator(source.south)
    # as many rows as keep a cell about as tall as it is wide at the middle of the picture
    height = max(1, round(cols * (top - bottom) / math.radians(source.east - source.west)))
    y = top - (np.arange(height) + 0.5) * (top - bottom) / height
    latitude = np.degrees(2 * np.arctan(np.exp(y)) - np.pi / 2)
    index = np.clip(((source.north - latitude) * CELLS_PER_DEGREE).astype(np.int64), 0, rows - 1)
    buffer = io.BytesIO()
    Image.fromarray(colours(source.values[index]), "RGBA").save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def value_grid(source: Mosaic) -> dict[str, Any]:
    """The mean of each block of ``VALUE_STEP`` by ``VALUE_STEP`` cells that has any value, rounded to
    whole kWh/kWp; 0 stands for "no data here". Rows run north to south, values west to east."""
    rows, cols = source.values.shape
    grid_rows, grid_cols = math.ceil(rows / VALUE_STEP), math.ceil(cols / VALUE_STEP)
    padded = np.full((grid_rows * VALUE_STEP, grid_cols * VALUE_STEP), np.nan, dtype=np.float32)
    padded[:rows, :cols] = source.values
    blocks = padded.reshape(grid_rows, VALUE_STEP, grid_cols, VALUE_STEP)
    known = np.isfinite(blocks)
    counts = known.sum(axis=(1, 3))
    sums = np.where(known, blocks, 0).sum(axis=(1, 3), dtype=np.float64)
    means = np.divide(sums, counts, out=np.zeros_like(sums), where=counts > 0)
    return {
        "west": source.west,
        "north": source.north,
        "cellDeg": VALUE_STEP / CELLS_PER_DEGREE,
        "cols": grid_cols,
        "rows": grid_rows,
        "values": np.rint(means).astype(np.int64).ravel().tolist(),
    }


def build(tiles: list[Tile], now: datetime) -> tuple[dict[str, Any], bytes]:
    """The index document (without the picture's address) and the picture."""
    source = mosaic(tiles)
    known = source.values[np.isfinite(source.values)]
    image = picture(source)
    document = {
        "version": VERSION,
        "generatedAt": now.isoformat(),
        "source": SOURCE,
        "license": LICENSE,
        "attribution": ATTRIBUTION,
        "unit": "kWh/kWp per year",
        "countries": sorted(tile.name for tile in tiles),
        # west, south, east, north of the picture, in degrees
        "bounds": [source.west, source.south, source.east, source.north],
        "min": round(float(known.min())),
        "max": round(float(known.max())),
        "ramp": [[stop, "#{:02x}{:02x}{:02x}".format(*colour)] for stop, colour in RAMP],
        "grid": value_grid(source),
    }
    return document, image


def publish_solar(store: ObjectStore, document: Mapping[str, Any], image: bytes) -> dict[str, Any]:
    """The picture under a name that follows its content, then the index that names it."""
    key = f"{PREFIX}pvout-{hashlib.sha256(image).hexdigest()[:16]}.png"
    if store.size(key) is None:
        store.put_bytes(key, image, ObjectMeta("image/png", IMMUTABLE))
    published = {**document, "image": key}
    store.put_bytes(INDEX_KEY, json.dumps(published, separators=(",", ":")).encode(), INDEX_META)
    log.info(
        "published solar potential",
        extra={"solar": {"image": key, "bytes": len(image), "countries": published["countries"]}},
    )
    return published
