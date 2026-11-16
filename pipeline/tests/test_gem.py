from __future__ import annotations

import csv
from pathlib import Path

import openpyxl
import pytest

from energymap.gem import normalize as gn
from energymap.gem.read import COLUMNS, GemFormatError, detect_layout, read_units
from energymap.schema import Status, Technology


def rows_of(path: Path) -> list[dict[str, object]]:
    return list(read_units(path))


def test_reads_csv_with_older_country_header(fixtures: Path) -> None:
    rows = rows_of(fixtures / "gem_sample.csv")
    assert len(rows) == 9
    assert rows[0]["country"] == "Croatia"  # header was "Country", not "Country/Area"
    assert rows[0]["location_id"] == "L100000000001"
    assert rows[3]["plant_name"] == "Sunčana elektrana Primjer"


def test_reads_xlsx_with_title_rows_and_an_info_sheet(fixtures: Path, tmp_path: Path) -> None:
    with (fixtures / "gem_sample.csv").open(encoding="utf-8") as handle:
        table = list(csv.reader(handle))
    workbook = openpyxl.Workbook()
    about = workbook.active
    assert about is not None
    about.title = "About"
    about.append(["Global Integrated Power Tracker", "September 2026 release"])
    data = workbook.create_sheet("Power facilities")
    data.append(["Global Energy Monitor"])
    data.append([])
    for i, row in enumerate(table):
        # numbers as numbers, like a real workbook
        data.append([float(v) if i and v.replace(".", "", 1).isdigit() else v for v in row])
    path = tmp_path / "gipt.xlsx"
    workbook.save(path)

    rows = rows_of(path)
    assert len(rows) == 9
    assert rows[0]["capacity_mw"] == 138.0
    assert rows[5]["plant_name"] == "Vjetroelektrana Daleko"


def test_unknown_layout_lists_what_is_missing_and_found(tmp_path: Path) -> None:
    path = tmp_path / "other.csv"
    path.write_text(
        "Country/Area,Plant name,Capacity (MW),Latitude,Longitude,Something\nCroatia,X,1,45,16,y\n"
    )
    with pytest.raises(GemFormatError) as error:
        rows_of(path)
    message = str(error.value)
    assert "Missing fields: location_id, status, type, unit_id" in message
    assert "Headers found: Country/Area, Plant name, Capacity (MW), Latitude, Longitude, Something" in message


def test_unsupported_and_broken_files(tmp_path: Path) -> None:
    with pytest.raises(GemFormatError, match=r"expected \.xlsx or \.csv"):
        rows_of(tmp_path / "x.json")
    broken = tmp_path / "broken.xlsx"
    broken.write_bytes(b"not a zip")
    with pytest.raises(GemFormatError, match="cannot be opened"):
        rows_of(broken)


def test_header_matching_ignores_case_and_spacing() -> None:
    headers = [aliases[0].upper().replace(" ", "  ") for aliases in COLUMNS.values()]
    layout = detect_layout(headers)
    assert layout is not None
    assert set(layout.positions) == set(COLUMNS)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("operating", Status.OPERATING), ("Construction", Status.CONSTRUCTION),
     ("pre-construction", Status.PLANNED), ("announced", Status.PLANNED),
     ("shelved - inferred 2 y", None), ("cancelled", None), ("retired", None),
     ("mothballed", None)],
)  # fmt: skip
def test_status(raw: str, expected: Status | None) -> None:
    assert gn.status_of(raw) is expected


def test_unknown_status_raises() -> None:
    with pytest.raises(ValueError, match="unknown GEM status"):
        gn.status_of("paused")


@pytest.mark.parametrize(
    ("type_", "tech", "fuel", "expected"),
    [("hydropower", "pumped storage", "water", Technology.PUMPED_STORAGE),
     ("hydropower", "run-of-river", "water", Technology.HYDRO),
     ("coal", "subcritical", "coal: lignite", Technology.LIGNITE),
     ("coal", "subcritical", "coal: bituminous", Technology.COAL),
     ("oil/gas", "combined cycle", "fossil gas: natural gas", Technology.GAS),
     ("oil/gas", "gas turbine", "fossil liquids: fuel oil", Technology.OIL),
     ("oil/gas", "", "fossil liquids: fuel oil, fossil gas: natural gas", Technology.GAS),
     ("bioenergy", "", "", Technology.BIOMASS), ("Solar", "PV", "", Technology.SOLAR),
     ("utility-scale solar", "PV", None, Technology.SOLAR),  # the type's name since September 2026
     ("distributed solar", "PV", None, Technology.SOLAR),
     ("tidal", "", "", Technology.OTHER)],
)  # fmt: skip
def test_technology(type_: str, tech: str, fuel: str, expected: Technology) -> None:
    assert gn.technology_of(type_, tech, fuel) is expected


def test_load_sample(fixtures: Path) -> None:
    loaded = gn.load(read_units(fixtures / "gem_sample.csv"))
    assert loaded.stats["rows"] == 9
    assert loaded.stats["out_of_scope"] == 1
    assert loaded.stats["excluded_status"] == 1
    assert loaded.stats["invalid_coordinates"] == 1
    assert loaded.stats["units_in_scope"] == 6
    by_key = {p.key: p for p in loaded.plants}
    assert set(by_key) == {
        "L100000000001:operating", "L100000000001:planned", "L100000000002:construction",
        "L100000000003:operating", "L100000000004:operating",
    }  # fmt: skip
    rhe = by_key["L100000000001:operating"]
    assert (rhe.capacity_mw, rhe.units, rhe.commissioning_year) == (276.0, 2, 1984)
    assert rhe.operator == "HEP Proizvodnja"
    assert rhe.wiki_url == "https://www.gem.wiki/RHE_Primjer"
    assert by_key["L100000000002:construction"].capacity_mw == 9.9
    assert by_key["L100000000002:construction"].non_commercial is True
    assert by_key["L100000000004:operating"].capacity_mw == 1200.0
    assert by_key["L100000000004:operating"].approximate is True


def test_aggregation_picks_dominant_technology_and_keeps_unknown_capacity() -> None:
    def unit(uid: str, tech: Technology, mw: float | None, year: int | None, op: str | None) -> gn.GemUnit:
        return gn.GemUnit(uid, "L100000000009", "IT", "Centrale", Status.OPERATING, tech, mw, year, op,
                          45.0, 12.0, False, None, False)  # fmt: skip

    [plant] = gn.aggregate([
        unit("G1", Technology.OIL, 50.0, 1990, "A"),
        unit("G2", Technology.GAS, 400.0, 2005, "B"),
        unit("G3", Technology.GAS, None, None, "B"),
    ])  # fmt: skip
    assert plant.technology is Technology.GAS
    assert plant.capacity_mw == 450.0
    assert plant.commissioning_year == 1990
    assert plant.operator == "B"

    [unknown] = gn.aggregate([unit("G4", Technology.WIND, None, None, None)])
    assert unknown.capacity_mw is None and unknown.operator is None


def test_insecure_wiki_links_are_dropped() -> None:
    row = {
        "country": "Austria", "status": "operating", "location_id": "L100000000010", "latitude": 47.0,
        "longitude": 13.0, "type": "wind", "plant_name": "Windpark", "wiki_url": "http://example.org",
    }  # fmt: skip
    unit = gn.parse_unit(row)
    assert isinstance(unit, gn.GemUnit)
    assert unit.wiki_url is None


@pytest.mark.parametrize(
    ("patch", "reason"),
    [({"location_id": "123"}, "invalid_location_id"), ({"latitude": 95}, "invalid_coordinates"),
     ({"capacity_mw": -1}, "invalid_capacity"), ({"status": "paused"}, "invalid_status")],
)  # fmt: skip
def test_broken_rows_have_reasons(patch: dict[str, object], reason: str) -> None:
    row: dict[str, object] = {
        "country": "Croatia", "status": "operating", "location_id": "L100000000011", "latitude": 45.0,
        "longitude": 16.0, "type": "solar", "plant_name": "X", "capacity_mw": 1,
    }  # fmt: skip
    assert gn.parse_unit({**row, **patch}) == gn.Skip(reason)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("45.812", 45.812), ("1,200", 1200.0), ("1,200.5", 1200.5), ("9,9", 9.9), ("138", 138.0), (138, 138.0),
     ("-12.5", -12.5), ("", None), (None, None), ("n/a", None), ("nan", None), (True, None)],
)  # fmt: skip
def test_gem_numbers_use_english_format(raw: object, expected: float | None) -> None:
    assert gn._number(raw) == expected


def test_the_fuel_column_is_found_under_its_new_name() -> None:
    """September 2026: "Fuel" became "Fuel (combustion only)"; unread, every oil/gas plant came out as oil."""
    assert "Fuel (combustion only)" in gem_read_columns()["fuel"]


def gem_read_columns() -> dict[str, tuple[str, ...]]:
    from energymap.gem import read

    return read.COLUMNS
