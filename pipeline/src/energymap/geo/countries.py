"""Assign countries to points and lines using Natural Earth borders.

Why geometry and not the source extract: Geofabrik extracts overlap along borders, so the same line
appears in two files. Its country (or countries, for interconnectors) must come from where it is,
not from which file it was read.
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterable
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import Any

import shapely
import shapely.geometry
from shapely.geometry import LineString, Point, box, shape
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree

EARTH_RADIUS_M = 6_371_008.8
_INVALID_ISO = frozenset({"-99", ""})


class CountryDataError(ValueError):
    """The borders file is missing, malformed or empty for the requested area."""


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def length_m(geometry: BaseGeometry) -> float:
    """Great-circle length of every linear part of ``geometry``; non-linear parts count as zero."""
    total = 0.0
    for part in shapely.get_parts(geometry):
        if isinstance(part, LineString):
            total += sum(haversine_m(a[0], a[1], b[0], b[1]) for a, b in pairwise(part.coords))
        elif part.geom_type in {"MultiLineString", "GeometryCollection"}:
            total += length_m(part)
    return total


@dataclass(frozen=True, slots=True)
class CountryIndex:
    codes: tuple[str, ...]
    geometries: tuple[BaseGeometry, ...]
    tree: STRtree
    min_segment_m: float
    coastal_tolerance_deg: float

    @classmethod
    def from_geojson(
        cls,
        path: Path,
        *,
        bbox: tuple[float, float, float, float] | None,
        min_segment_m: float,
        coastal_tolerance_deg: float,
    ) -> CountryIndex:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise CountryDataError(f"Cannot read country borders from {path}: {exc}") from exc

        area = box(*bbox) if bbox else None
        codes: list[str] = []
        geometries: list[BaseGeometry] = []
        for feature in data.get("features", []):
            code = str(feature.get("properties", {}).get("ISO_A2_EH", "")).strip()
            if code in _INVALID_ISO:
                continue
            geometry = shape(feature["geometry"])
            if area is not None and not geometry.intersects(area):
                continue
            shapely.prepare(geometry)
            codes.append(code)
            geometries.append(geometry)

        if not geometries:
            raise CountryDataError(f"No usable country polygons in {path} for bbox {bbox}")
        return cls(tuple(codes), tuple(geometries), STRtree(geometries), min_segment_m, coastal_tolerance_deg)

    def country_of_point(self, lon: float, lat: float, *, tolerance_deg: float | None = None) -> str | None:
        """The country containing the point, or the nearest one within ``tolerance_deg`` (default: the
        coastal tolerance). A wider tolerance is for things that stand at sea, such as offshore platforms,
        where the nearest coast is the best proxy for jurisdiction the borders file can give."""
        point = Point(lon, lat)
        hits = sorted(self.codes[int(i)] for i in self.tree.query(point, predicate="intersects"))
        if hits:
            return hits[0]
        return self._nearest(point, self.coastal_tolerance_deg if tolerance_deg is None else tolerance_deg)

    def is_in_or_near(self, code: str, lon: float, lat: float) -> bool:
        """Whether the point lies in country ``code`` or within the coastal tolerance of it. For a source
        that names the country itself: the borders are generalised, so a town on a border or a coast may
        fall just outside its own polygon, but never far from it."""
        point = Point(lon, lat)
        return any(
            own == code and geometry.distance(point) <= self.coastal_tolerance_deg
            for own, geometry in zip(self.codes, self.geometries, strict=True)
        )

    def line_shares(self, line: LineString) -> dict[str, float]:
        """Metres of ``line`` inside each country it intersects (before any threshold)."""
        shares: dict[str, float] = {}
        for i in self.tree.query(line, predicate="intersects"):
            code = self.codes[int(i)]
            inside = length_m(line.intersection(self.geometries[int(i)]))
            shares[code] = max(shares.get(code, 0.0), inside)
        return shares

    def countries_of_line(self, line: LineString) -> tuple[str, ...]:
        """Countries the line meaningfully runs through, longest share first.

        A country counts if at least ``min_segment_m`` of the line lies inside it. If none reaches the
        threshold, the country holding the longest share is used. Endpoints that fall outside every
        polygon (typically submarine cable landfalls) add the nearest country within tolerance.
        """
        lengths = self.line_shares(line)
        kept = {code: m for code, m in lengths.items() if m >= self.min_segment_m}
        if not kept and lengths:
            best = max(lengths.items(), key=lambda item: (item[1], item[0]))
            kept = {best[0]: best[1]}

        for lon, lat in (line.coords[0], line.coords[-1]):
            point = Point(lon, lat)
            if len(self.tree.query(point, predicate="intersects")) == 0:
                nearest = self._nearest(point, self.coastal_tolerance_deg)
                if nearest is not None:
                    kept.setdefault(nearest, 0.0)

        return tuple(code for code, _ in sorted(kept.items(), key=lambda item: (-item[1], item[0])))

    def boundary_features(
        self, bbox: tuple[float, float, float, float], scope: frozenset[str]
    ) -> list[dict[str, Any]]:
        """Country polygons clipped to ``bbox`` as GeoJSON features (fallback basemap and region outline)."""
        area = box(*bbox)
        features: list[dict[str, Any]] = []
        for code, geometry in sorted(zip(self.codes, self.geometries, strict=True), key=lambda item: item[0]):
            clipped = shapely.set_precision(geometry.intersection(area), 1e-5)
            if clipped.is_empty or clipped.geom_type not in {"Polygon", "MultiPolygon"}:
                continue
            features.append(
                {
                    "type": "Feature",
                    "id": f"country:{code}",
                    "geometry": shapely.geometry.mapping(clipped),
                    "properties": {"code": code, "inScope": code in scope},
                }
            )
        return features

    def _nearest(self, point: Point, max_distance_deg: float) -> str | None:
        index = self.tree.query_nearest(point, max_distance=max_distance_deg, all_matches=False)
        return self.codes[int(index[0])] if len(index) else None


def codes_in(index: CountryIndex, wanted: Iterable[str]) -> frozenset[str]:
    """Which of ``wanted`` exist in the index — used to fail early on a wrong borders file."""
    return frozenset(index.codes) & frozenset(wanted)
