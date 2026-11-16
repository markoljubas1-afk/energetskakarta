from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path

import httpx
import openpyxl
import pytest
from cities_fixture import write_fixture  # scripts/ is on the test path (pyproject.toml)

from energymap import build as pipeline
from energymap import config, tiles
from energymap.cities import normalize, read
from energymap.cities.load import load
from energymap.osm.download import DownloadError
from energymap.osm.extract import ExtractResult
from energymap.products import city_register, search_index
from energymap.schema import Sector
from energymap.validate import BuildValidationError

SCOPE = frozenset({"HR", "SI", "HU", "RS", "BA", "ME", "IT", "AT"})
NOW = datetime(2026, 9, 19, tzinfo=UTC)


@pytest.fixture
def release(tmp_path: Path) -> Path:
    return write_fixture(tmp_path / "cities")


# ---------------------------------------------------------------- normalize


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Municipal buildings, equipment/facilities", Sector.MUNICIPAL_BUILDINGS),
        ("Tertiary (non municipal) buildings, equipment/facilities", Sector.TERTIARY),
        ("Residential buildings", Sector.RESIDENTIAL),
        ("Public lighting", Sector.PUBLIC_LIGHTING),
        ("Industry", Sector.INDUSTRY),
        ("Municipal fleet", Sector.MUNICIPAL_FLEET),
        ("Public transport", Sector.PUBLIC_TRANSPORT),
        ("Private and commercial transport", Sector.PRIVATE_TRANSPORT),
        # the aggregated sectors of the 7th release (2026)
        ("Transportation", Sector.TRANSPORT),
        ("Non-ETS", Sector.INDUSTRY),
        ("ETS (not recommended)", Sector.INDUSTRY),
        ("Industry Non-ETS", Sector.INDUSTRY),
        ("Buildings, equipment/facilities non allocated", Sector.OTHER),
        ("Waste/wastewater", Sector.OTHER),
        ("Agriculture", Sector.OTHER),
        (None, Sector.OTHER),
    ],
)
def test_sector_mapping(text: str | None, expected: Sector) -> None:
    assert normalize.sector_of(text) is expected


def test_units_and_flags() -> None:
    assert normalize.to_mwh("12.5", "MWh/year") == 12.5
    assert normalize.to_mwh(1.2, "GWh") == 1200.0
    assert normalize.to_mwh(3, None) == 3.0  # the template reports MWh; a missing unit means MWh
    assert normalize.to_mwh(-1, "MWh") is None
    assert normalize.to_mwh("n/a", "MWh") is None
    assert normalize.to_mwh(5, "furlongs") is None
    assert normalize.is_electricity("Electricity") and not normalize.is_electricity("Natural gas")
    assert normalize.is_true("Yes") and normalize.is_true(True) and not normalize.is_true("No")
    assert normalize.country_code("hr") == "HR" and normalize.country_code("SVN") == "SI"
    assert normalize.country_code("Croatia") is None


def test_latest_inventory_wins_and_the_baseline_rides_along() -> None:
    stats: Counter[str] = Counter()
    sig = {"1": normalize.Signatory("1", "Grad", "HR", 16.0, 45.5, 1000)}
    rows = [
        {
            "plan_id": "p",
            "inventory_id": "a",
            "baseline": "Yes",
            "year": 2010,
            "sector": "Public lighting",
            "carrier": "Electricity",
            "unit": "MWh",
            "energy": 100,
        },
        {
            "plan_id": "p",
            "inventory_id": "b",
            "baseline": "No",
            "year": 2018,
            "sector": "Public lighting",
            "carrier": "Electricity",
            "unit": "MWh",
            "energy": 60,
        },
        {
            "plan_id": "p",
            "inventory_id": "b",
            "baseline": "No",
            "year": 2018,
            "sector": "Public lighting",
            "carrier": "Diesel",
            "unit": "MWh",
            "energy": 5,
        },
    ]
    inventories = normalize.inventories(rows, {"p": "1"}, monitoring=False, stats=stats)
    assert len(inventories) == 2
    [city] = normalize.build_cities(sig, inventories, release="r", retrieved_at=NOW, stats=stats)
    assert (city.inventory_year, city.baseline) == (2018, False)
    assert city.sectors[Sector.PUBLIC_LIGHTING].electricity_mwh == 60
    assert city.sectors[Sector.PUBLIC_LIGHTING].total_mwh == 65
    assert (city.baseline_year, city.baseline_electricity_mwh) == (2010, 100)
    assert city.provenance[0].license == "CC-BY-4.0"
    assert city.provenance[0].url is not None and city.provenance[0].url.startswith("https://")


def test_rows_that_cannot_be_linked_or_read_are_counted_not_guessed() -> None:
    stats: Counter[str] = Counter()
    rows = [
        {
            "plan_id": "orphan",
            "year": 2010,
            "sector": "Industry",
            "carrier": "Electricity",
            "unit": "MWh",
            "energy": 1,
        },
        {
            "plan_id": "p",
            "organisation_id": "1",
            "year": "soon",
            "sector": "Industry",
            "carrier": "Electricity",
            "unit": "MWh",
            "energy": 1,
        },
        {
            "plan_id": "p",
            "organisation_id": "1",
            "year": 2010,
            "sector": "Industry",
            "carrier": "Electricity",
            "unit": "MWh",
            "energy": "many",
        },
    ]
    assert normalize.inventories(rows, {}, monitoring=False, stats=stats) == []
    assert stats["plan_rows_unlinked"] == 2
    assert stats["plan_rows_unusable"] == 1


# ---------------------------------------------------------------- read


def test_fixture_release_loads_the_expected_cities(release: Path) -> None:
    loaded = load(release, SCOPE, NOW)
    assert loaded.release == "2025_Sixth_release"
    by_id = {city.id: city for city in loaded.cities}
    # the German city, the city without an inventory and the bad row are all accounted for
    assert set(by_id) == {"com:1001", "com:1002", "com:1005"}
    assert loaded.stats["signatories_outside_scope"] == 1
    assert loaded.stats["inventories_without_signatory"] == 1
    assert loaded.stats["plan_rows_unusable"] == 1
    assert loaded.stats["rows_in_other_sector"] == 1
    primjer = by_id["com:1001"]
    # the 2019 monitoring inventory is shown, the 2011 baseline rides along
    assert (primjer.inventory_year, primjer.baseline, primjer.baseline_year) == (2019, False, 2011)
    assert primjer.sectors[Sector.PUBLIC_LIGHTING].electricity_mwh == 6500
    assert primjer.baseline_electricity_mwh == 12000 + 9000 + 150000 + 4000
    assert primjer.population == 121000  # the inventory's population beats the adhesion one
    vzorec = by_id["com:1002"]
    assert vzorec.country == "SI"  # alpha-3 in the file
    assert vzorec.sectors[Sector.PUBLIC_LIGHTING].electricity_mwh == 1200  # GWh converted
    assert Sector.OTHER in vzorec.sectors


def _save(path: Path, sheets: Mapping[str, Sequence[Sequence[object]]]) -> None:
    workbook = openpyxl.Workbook()
    first = workbook.active
    assert first is not None
    workbook.remove(first)
    for title, rows in sheets.items():
        sheet = workbook.create_sheet(title)
        for row in rows:
            sheet.append(row)
    workbook.save(path)


def test_seventh_release_layout_is_read(tmp_path: Path) -> None:
    """Sheet and column names copied from the 2026_Seventh_release files (values invented): README and
    metadata sheets come first, data sheets are "1", "2", "2D_1", sectors and carriers are aggregated,
    country codes are lower case and a city can have a baseline inventory in each of its plans."""
    readme = [["Collection Acronym", "GCoM-MyCovenant"], ["Dataset", "7th Release"]]
    metadata = [["Dataframe", "Content", "Name", "Type", "Description"], ["organisation_id", "string"]]
    inventory_header = [
        "emission_inventory_id",
        "baseline_year_flag",
        "inventory_year",
        "population_in_the_inventory_year",
        "aggregated_sector",
        "aggregated_carrier",
        "activity_reporting_unit",
        "energy_measure",
    ]
    _save(
        tmp_path / "signatories.xlsx",
        {
            "README": readme,
            "df1_METADATA": metadata,
            "1": [
                [
                    "organisation_id",
                    "organisation_name",
                    "country_code",
                    "population_adhesion",
                    "organisation_latitude",
                    "organisation_longitude",
                    "signatory_status",
                ],
                ["77", "Grad Primjer", "hr", 50000, 45.5, 16.0, "published"],
            ],
        },
    )
    _save(
        tmp_path / "plans.xlsx",
        {
            "README": readme,
            "df2_METADATA": metadata,
            "2": [
                ["organisation_id", "organisation_name", "action_plan_id"],
                ["77", "Grad Primjer", "900"],
                ["77", "Grad Primjer", "901"],
            ],
            "2A_1": [["action_plan_id", "base_year", "target_year"], ["900", 2008, 2020]],
            "2D_1": [
                ["action_plan_id", *inventory_header],
                ["900", "1", "TRUE", 2008, 49000, "Transportation", "Fossil fuels", "MWh/year", 700],
                ["901", "2", "TRUE", 2015, 51000, "Transportation", "Electricity", "MWh/year", 50],
                ["901", "2", "TRUE", 2015, 51000, "Non-ETS", "Electricity", "MWh/year", 300],
                [
                    "901",
                    "2",
                    "TRUE",
                    2015,
                    51000,
                    "Waste/wastewater",
                    "Non-energy related emissions",
                    "MWh/year",
                    None,
                ],
            ],
        },
    )
    _save(
        tmp_path / "monitoring.xlsx",
        {
            "README": readme,
            "3": [["organisation_id", "action_plan_id", "monitoring_report_id"], ["77", "901", "5000"]],
            "3D_1": [
                ["monitoring_report_id", *inventory_header],
                ["5000", "3", "FALSE", 2012, 50000, "Residential buildings", "Electricity", "MWh/year", 10],
            ],
        },
    )
    loaded = load(tmp_path, SCOPE, NOW)
    (city,) = loaded.cities
    # the 2015 inventory of the second plan is shown; it is a baseline itself, so nothing rides along
    assert (city.id, city.country, city.inventory_year, city.baseline) == ("com:77", "HR", 2015, True)
    assert (city.baseline_year, city.baseline_electricity_mwh) == (None, None)
    assert city.population == 51000
    assert city.sectors[Sector.TRANSPORT].electricity_mwh == 50
    assert city.sectors[Sector.INDUSTRY].total_mwh == 300
    assert loaded.stats["plan_rows_unusable"] == 1  # the waste row has no energy


def test_unknown_layout_fails_with_what_was_found(tmp_path: Path) -> None:
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.title = "2D_1 something"
    sheet.append(["completely", "different", "headers"])
    sheet.append([1, 2, 3])
    path = tmp_path / "plans.xlsx"
    workbook.save(path)
    with pytest.raises(read.CitiesFormatError, match="headers found: completely, different, headers"):
        list(read.read_sheet(path, read.PLAN_INVENTORIES))
    with pytest.raises(read.CitiesFormatError, match=r"has no sheet with \['organisation_id', 'plan_id'\]"):
        list(read.read_sheet(path, read.PLAN_LINK))
    with pytest.raises(read.CitiesFormatError, match="no sheet starting with '3D_1'"):
        list(read.read_sheet(path, read.MONITORING_INVENTORIES))
    assert read.inspect(path) == {"2D_1 something": ["completely", "different", "headers"]}


def test_release_files_are_found_by_listing_the_folder() -> None:
    listing = """
    <a href="copyright.txt">copyright.txt</a>
    <a href="df1_Signatories_6th%20Release%20-%20July%202025.xlsx">df1</a>
    <a href="df2_Action_Plans_6th%c2%a0Release_September%202022.xlsx">df2</a>
    <a href="df3_Monitoring_Reports_6th%20Release%20-%20July%202025.xlsx">df3</a>
    """
    root = """
    <a href="2022_Third_release/">2022_Third_release/</a>
    <a href="2025_Sixth_release/">2025_Sixth_release/</a>
    <a href="OLD2025_Sixth_release/">OLD2025_Sixth_release/</a>
    <a href="copyright.txt">copyright.txt</a>
    """

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/GCOM-MyCovenant/"):
            return httpx.Response(200, text=root)
        if path.endswith("/2025_Sixth_release/"):
            return httpx.Response(200, text=listing)
        if "/none/" in path:
            return httpx.Response(200, text="<a href='copyright.txt'>c</a>")
        if path.endswith(".xlsx"):
            return httpx.Response(200, content=b"PK\x03\x04 pretend")
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert read.latest_release(client) == "2025_Sixth_release"
        urls = read.list_release(client, "2025_Sixth_release")
        assert urls["plans"].endswith("df2_Action_Plans_6th%c2%a0Release_September%202022.xlsx")

    with (
        httpx.Client(transport=httpx.MockTransport(handler)) as client,
        pytest.raises(read.CitiesDownloadError, match="lists no file for: monitoring, plans, signatories"),
    ):
        read.list_release(client, "2022_Third_release", base_url="https://x.test/GCOM-MyCovenant/none/")


def test_download_writes_files_and_metadata(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith(".xlsx"):
            return httpx.Response(200, content=b"PK\x03\x04 pretend")
        return httpx.Response(
            200,
            text='<a href="df1_a.xlsx">1</a><a href="df2_b.xlsx">2</a><a href="df3_c.xlsx">3</a>',
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = read.download(client, tmp_path / "cities", "2025_Sixth_release", "2026-09-19T00:00:00Z")
    assert sorted(result.files) == ["monitoring", "plans", "signatories"]
    assert (tmp_path / "cities" / "plans.xlsx").read_bytes().startswith(b"PK")
    meta = json.loads((tmp_path / "cities" / "cities.json").read_text())
    assert meta["release"] == "2025_Sixth_release"
    assert meta["licence"] == "CC-BY-4.0"


# ---------------------------------------------------------------- products, tiles, build


def test_register_and_search_rows(release: Path) -> None:
    cities = load(release, SCOPE, NOW).cities
    register = city_register(cities)
    assert register["sectors"][0] == "municipal_buildings"
    first = register["rows"][0]
    assert first[0] == "com:1005"  # the largest consumer first
    assert (
        first[register["fields"].index("electricityBySector")][register["sectors"].index("industry")]
        == 900000
    )
    assert (
        first[register["fields"].index("electricityBySector")][register["sectors"].index("residential")]
        is None
    )
    rows = search_index([], [], [], cities)["rows"]
    assert ["com:1005", "Città Esempio", "cities", "IT", 12.3, 45.4, "2012|1.56e+06"] in rows


def test_tile_feature_carries_sectors_as_json_and_a_zoom_by_population(release: Path) -> None:
    [city] = [c for c in load(release, SCOPE, NOW).cities if c.id == "com:1001"]
    props = tiles.tile_feature("cities", city.to_feature())["properties"]
    assert props["minzoom"] == 5  # 121 000 people
    assert json.loads(props["sectors"])["public_lighting"] == {"e": 6500, "t": 6500}
    assert props["baselineElectricityMwh"] == 175000
    assert "provenance" not in props
    assert tiles.city_minzoom(None) == 9 and tiles.city_minzoom(25_000) == 7


def test_build_with_cities_publishes_layer_register_and_attribution(
    fixtures: Path, sample_pbf: Path, tmp_path: Path, release: Path
) -> None:
    from test_build import HR_ONLY, _prepare

    paths = config.Paths(tmp_path / "data")
    _prepare(paths, fixtures, sample_pbf)
    # the fixture borders know HR and SI only, so the Italian city stays out of this build
    build_dir = pipeline.build(paths, HR_ONLY, now=NOW, cities=release, scope={"HR", "SI"})
    manifest = json.loads((build_dir / "manifest.json").read_text())
    assert manifest["counts"]["cities"] == 2
    assert manifest["cities"]["byCountry"] == {"HR": 1, "SI": 1}
    assert "com" in manifest["attributionSources"]
    assert (build_dir / "cities.ndjson").exists() and (build_dir / "cities.json").exists()
    search = json.loads((build_dir / "search.json").read_text())
    assert any(row[2] == "cities" for row in search["rows"])

    with pytest.raises(BuildValidationError, match="yields no city"):
        pipeline.apply_cities(ExtractResult(), release, frozenset({"ME"}), NOW)
    with pytest.raises(DownloadError, match="cities download"):
        pipeline.apply_cities(ExtractResult(), tmp_path / "nowhere", SCOPE, NOW)
