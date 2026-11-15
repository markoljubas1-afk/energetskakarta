from __future__ import annotations

from pathlib import Path

import pytest
from shapely.geometry import LineString

from energymap.geo.countries import CountryDataError, CountryIndex, haversine_m, length_m


def test_haversine_one_degree_of_latitude() -> None:
    assert haversine_m(15.0, 45.0, 15.0, 46.0) == pytest.approx(111_195, rel=1e-3)


def test_length_of_line() -> None:
    assert length_m(LineString([(15.0, 45.0), (15.0, 45.5), (15.0, 46.0)])) == pytest.approx(
        111_195, rel=1e-3
    )


def test_point_inside_and_outside(index: CountryIndex) -> None:
    assert index.country_of_point(16.0, 45.5) == "HR"
    assert index.country_of_point(14.0, 45.5) == "SI"
    assert index.country_of_point(16.0, 44.9) == "HR"  # within coastal tolerance
    assert index.country_of_point(16.0, 44.0) is None  # far outside


def test_border_point_is_deterministic(index: CountryIndex) -> None:
    assert index.country_of_point(15.0, 45.5) == "HR"  # on the SI/HR border: alphabetical


def test_interconnector_detected(index: CountryIndex) -> None:
    assert index.countries_of_line(LineString([(14.5, 45.5), (15.8, 45.5)])) == ("HR", "SI")


def test_border_hugging_line_is_domestic(index: CountryIndex) -> None:
    # ~160 m on the Slovenian side: generalised-border noise, not an interconnector
    assert index.countries_of_line(LineString([(14.998, 45.2), (15.3, 45.2)])) == ("HR",)


def test_submarine_cable_landfall_adds_nearest_country(index: CountryIndex) -> None:
    # starts in HR, ends just outside the polygon (sea) closest to HR's southern edge
    assert index.countries_of_line(LineString([(16.0, 45.5), (16.2, 44.9)])) == ("HR",)


def test_submarine_interconnector_between_landfalls(index: CountryIndex) -> None:
    # entirely at sea (south of both polygons), like an Adriatic HVDC cable: countries come from landfalls
    assert index.countries_of_line(LineString([(14.0, 44.9), (16.0, 44.9)])) == ("HR", "SI")


def test_short_line_uses_longest_share(index: CountryIndex) -> None:
    # 150 m entirely inside HR: below the threshold, but still assigned
    assert index.countries_of_line(LineString([(16.0, 45.5), (16.0019, 45.5)])) == ("HR",)


def test_invalid_iso_codes_are_ignored(index: CountryIndex) -> None:
    assert "-99" not in index.codes


def test_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(CountryDataError):
        CountryIndex.from_geojson(
            tmp_path / "nope.geojson", bbox=None, min_segment_m=1, coastal_tolerance_deg=1
        )


def test_empty_bbox_raises(fixtures: Path) -> None:
    with pytest.raises(CountryDataError):
        CountryIndex.from_geojson(
            fixtures / "countries.geojson", bbox=(100, 0, 101, 1), min_segment_m=1, coastal_tolerance_deg=1
        )
