from __future__ import annotations

import json
import shutil
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from conftest import BuildFactory
from energymap import build as pipeline
from energymap import cli, config, publish, sources, tiles
from energymap.geo.countries import CountryIndex
from energymap.marine import emodnet
from energymap.schema import Medium, PowerPlant, Provenance, Status, Technology
from test_scheduled import BASE, serve

NOW = datetime(2026, 9, 16, 3, tzinfo=UTC)


@pytest.fixture
def marine_dir(fixtures: Path, tmp_path: Path) -> Path:
    target = tmp_path / "marine"
    shutil.copytree(fixtures / "emodnet", target)
    return target


@pytest.fixture
def index(fixtures: Path) -> CountryIndex:
    return CountryIndex.from_geojson(
        fixtures / "countries.geojson", bbox=None, min_segment_m=500, coastal_tolerance_deg=0.25
    )


def test_pipelines_are_normalised(marine_dir: Path, index: CountryIndex) -> None:
    result = emodnet.load(marine_dir, index, frozenset({"HR", "IT", "SI"}), NOW)
    assert set(result.pipelines) == {"emodnet:pipelines/101", "emodnet:pipelines/104"}
    main = result.pipelines["emodnet:pipelines/101"]
    assert (main.name, main.medium, main.status, main.operator) == (
        "Plinovod Primjer",
        Medium.GAS,
        Status.OPERATING,
        "INA",
    )
    assert (main.diameter_in, main.length_km, main.commissioning_year) == (12.0, 76.0, 2006)
    assert len(main.parts) == 2 and main.countries == ("HR",)
    assert main.provenance[0].license == "EMODnet-open"
    unnamed = result.pipelines["emodnet:pipelines/104"]
    # empty status on an "actual routes" layer means existing; "N/A", "0" and "n/a" are not values
    assert (unnamed.status, unnamed.operator, unnamed.diameter_in, unnamed.commissioning_year) == (
        Status.OPERATING, None, None, None,
    )  # fmt: skip
    assert unnamed.medium is Medium.UNKNOWN and unnamed.countries == ("HR", "IT")
    assert result.stats["pipelines_out_of_scope"] == 1  # Nord Stream 2 (DE)
    assert result.stats["pipelines_unknown_status"] == 1  # "Mothballed?" is counted, not guessed
    assert result.stats["pipelines_bad_geometry"] == 1


def test_wind_farms_are_normalised_once(marine_dir: Path, index: CountryIndex) -> None:
    result = emodnet.load(marine_dir, index, frozenset({"HR", "IT"}), NOW)
    farms = {farm.name: farm for farm in result.windfarms}
    assert set(farms) == {"Beleolico", "VE More"}  # the polygon and point of Beleolico count once
    assert farms["Beleolico"].id.startswith("emodnet:windfarmspoly/")
    assert (farms["Beleolico"].status, farms["Beleolico"].capacity_mw, farms["Beleolico"].country) == (
        Status.OPERATING, 30.0, "IT",
    )  # fmt: skip
    assert (farms["VE More"].status, farms["VE More"].capacity_mw, farms["VE More"].country) == (
        Status.PLANNED, 300.0, "HR",
    )  # fmt: skip
    assert result.stats["windfarms_excluded"] == 1  # dismantled
    assert result.stats["windfarms_unknown_status"] == 1  # no status: not shown rather than guessed
    assert result.stats["windfarms_out_of_scope"] == 1  # Denmark


def test_known_wind_plants_are_not_duplicated() -> None:
    def plant(pid: str, lon: float, tech: Technology) -> PowerPlant:
        prov = Provenance(source="openstreetmap", source_id=pid.removeprefix("osm:"), license="ODbL-1.0",
                          retrieved_at=NOW)  # fmt: skip
        return PowerPlant(id=pid, status=Status.OPERATING, operator=None, provenance=(prov,), name=None,
                          technology=tech, capacity_mw=None, commissioning_year=None, country="IT",
                          location=(lon, 40.49))  # fmt: skip

    plants = {
        "osm:way/1": plant("osm:way/1", 17.23, Technology.WIND),
        "osm:way/2": plant("osm:way/2", 14.0, Technology.GAS),
    }
    near = plant("osm:way/9", 17.20, Technology.WIND).model_copy(update={"id": "emodnet:windfarms/1"})
    far = plant("osm:way/9", 14.0, Technology.WIND).model_copy(update={"id": "emodnet:windfarms/2"})
    stats: Counter[str] = Counter()
    emodnet.merge_windfarms(plants, [near, far], stats)
    assert "emodnet:windfarms/1" not in plants  # 2.5 km from an OSM wind plant
    assert "emodnet:windfarms/2" in plants  # only a gas plant nearby
    assert stats == {"windfarms_already_known": 1, "windfarms_added": 1}


def test_missing_extract_is_reported(tmp_path: Path, index: CountryIndex) -> None:
    with pytest.raises(emodnet.EmodnetError, match="marine fetch"):
        emodnet.load(tmp_path, index, frozenset({"HR"}), NOW)


# ---------------------------------------------------------------- download


def wfs(responses: dict[str, httpx.Response]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["OUTPUTFORMAT"] == "application/json"
        assert request.url.params["REQUEST"] == "GetFeature"
        return responses[request.url.params["TYPENAMES"]]

    return httpx.Client(transport=httpx.MockTransport(handler))


def fixture_layer(fixtures: Path, layer: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((fixtures / "emodnet" / f"{layer}.geojson").read_text())
    return data


def good_responses(fixtures: Path) -> dict[str, httpx.Response]:
    return {
        name: httpx.Response(200, json=fixture_layer(fixtures, layer))
        for layer, name in emodnet.LAYERS.items()
    }


def test_download_keeps_only_the_region(fixtures: Path, tmp_path: Path) -> None:
    with wfs(good_responses(fixtures)) as client:
        counts = emodnet.download(client, tmp_path, NOW)
    assert counts == {"pipelines": 4, "windfarms": 4, "windfarmspoly": 1}  # Nord Stream and Horns Rev dropped
    assert json.loads((tmp_path / "emodnet.json").read_text())["fetchedAt"] == NOW.isoformat()


def test_download_detects_swapped_axes(fixtures: Path, tmp_path: Path) -> None:
    swapped = fixture_layer(fixtures, "pipelines")
    for feature in swapped["features"]:
        feature["geometry"]["coordinates"] = json.loads(
            json.dumps(feature["geometry"]["coordinates"])
            .replace("[13.", "[TMP")
            .replace(", 44.", ", 13.")
            .replace("[TMP", "[44.")
        )
    responses = good_responses(fixtures) | {"emodnet:pipelines": httpx.Response(200, json=swapped)}
    with wfs(responses) as client, pytest.raises(emodnet.EmodnetError, match="axis order"):
        emodnet.download(client, tmp_path, NOW)


@pytest.mark.parametrize(
    ("response", "message"),
    [(httpx.Response(503), "HTTP 503"),
     (httpx.Response(200, text="<ows:ExceptionReport>bad</ows:ExceptionReport>"), "not GeoJSON"),
     (httpx.Response(200, json={"type": "Feature"}), "not a FeatureCollection"),
     (httpx.Response(200, json={"type": "FeatureCollection", "features": []}), "no features")],
)  # fmt: skip
def test_download_failures(fixtures: Path, tmp_path: Path, response: httpx.Response, message: str) -> None:
    responses = good_responses(fixtures) | {"emodnet:windfarms": response}
    with wfs(responses) as client, pytest.raises(emodnet.EmodnetError, match=message):
        emodnet.download(client, tmp_path, NOW)


def test_download_refuses_a_region_without_pipelines(fixtures: Path, tmp_path: Path) -> None:
    only_north_sea = {
        "type": "FeatureCollection",
        "features": [fixture_layer(fixtures, "pipelines")["features"][1]],
    }
    responses = good_responses(fixtures) | {"emodnet:pipelines": httpx.Response(200, json=only_north_sea)}
    with wfs(responses) as client, pytest.raises(emodnet.EmodnetError, match="no pipelines in the region"):
        emodnet.download(client, tmp_path, NOW)
    assert not (tmp_path / "emodnet.json").exists()


# ---------------------------------------------------------------- build, tiles, sources


def marine_build(make_build: BuildFactory, marine_dir: Path) -> Path:
    first = make_build(datetime(2026, 9, 1, tzinfo=UTC))
    paths = config.Paths(first.parents[2])
    return pipeline.build(paths, [config.COUNTRY_BY_CODE["HR"]], now=NOW, allow_drop=True, marine=marine_dir)


def test_build_with_marine_data(make_build: BuildFactory, marine_dir: Path) -> None:
    build = marine_build(make_build, marine_dir)
    rows = [json.loads(line) for line in (build / "pipelines.ndjson").read_text().splitlines()]
    # the two at sea from EMODnet, next to the two on land from OpenStreetMap
    assert [row["id"] for row in rows] == [
        "emodnet:pipelines/101",
        "emodnet:pipelines/104",
        "osm:way/120",
        "osm:way/121",
    ]
    assert rows[0]["geometry"]["type"] == "MultiLineString"
    plants = {json.loads(line)["id"] for line in (build / "plants.ndjson").read_text().splitlines()}
    assert "emodnet:windfarms/2" in plants  # VE More (HR); Beleolico is Italian and out of this build's scope
    manifest = json.loads((build / "manifest.json").read_text())
    assert manifest["counts"]["pipelines"] == 4
    assert manifest["marine"] == {"fetchedAt": "2026-09-15T03:00:00+00:00", "pipelines": 2, "windfarms": 1}
    assert "emodnet" in manifest["attributionSources"]
    # HR-only build: Nord Stream 2 (DE) and the Italian oil pipeline are both outside it
    assert manifest["stats"]["emodnet_pipelines_out_of_scope"] == 2

    shaped = tiles.tile_feature("pipelines", rows[0])["properties"]
    assert shaped == {
        "id": "emodnet:pipelines/101",
        "sources": "emodnet",
        "name": "Plinovod Primjer",
        "status": "operating",
        "medium": "gas",
        "diameterIn": 12.0,
        "lengthKm": 76.0,
        "commissioningYear": 2006,
        "countries": "HR",
        "operator": "INA",
        "minzoom": tiles.PIPELINE_MINZOOM,
    }


def test_build_without_marine_has_the_pipelines_on_land_only(make_build: BuildFactory) -> None:
    build = make_build(NOW)
    rows = [json.loads(line) for line in (build / "pipelines.ndjson").read_text().splitlines()]
    assert [row["id"] for row in rows] == ["osm:way/120", "osm:way/121"]
    assert json.loads((build / "manifest.json").read_text())["counts"]["pipelines"] == 2


def test_losing_the_marine_data_is_a_drop(make_build: BuildFactory, marine_dir: Path) -> None:
    marine_build(make_build, marine_dir)
    paths = config.Paths(marine_dir.parent / "data")
    # the pipelines on land are still there, so the layer shrinks instead of disappearing
    with pytest.raises(Exception, match="layer 'pipelines' dropped from 4 to 2"):
        pipeline.build(paths, [config.COUNTRY_BY_CODE["HR"]], now=datetime(2026, 9, 17, tzinfo=UTC))


def test_emodnet_source_roundtrip(marine_dir: Path, tmp_path: Path) -> None:
    bucket = tmp_path / "bucket"
    key = sources.upload_emodnet(publish.DirectoryStore(bucket), marine_dir, NOW)
    assert key.startswith("sources/emodnet/")
    pointer = json.loads((bucket / sources.EMODNET_POINTER).read_text())
    assert pointer["counts"] == {"pipelines": 5, "windfarms": 5, "windfarmspoly": 1}
    with httpx.Client(transport=httpx.MockTransport(serve(bucket))) as client:
        target = sources.fetch_emodnet(client, BASE, tmp_path / "restored")
    assert target is not None
    for layer in emodnet.LAYERS:
        assert json.loads((target / f"{layer}.geojson").read_text()) == json.loads(
            (marine_dir / f"{layer}.geojson").read_text()
        )
    assert not (target / "bundle.json").exists()

    (bucket / key).write_text("{}")
    with (
        httpx.Client(transport=httpx.MockTransport(serve(bucket))) as client,
        pytest.raises(sources.SourceError, match="Checksum mismatch"),
    ):
        sources.fetch_emodnet(client, BASE, tmp_path / "again")


def test_emodnet_source_missing_or_invalid(tmp_path: Path, marine_dir: Path) -> None:
    with httpx.Client(transport=httpx.MockTransport(serve(None))) as client:
        assert sources.fetch_emodnet(client, BASE, tmp_path / "x") is None
    (marine_dir / "pipelines.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": []}))
    with pytest.raises(sources.SourceError, match="no pipelines"):
        sources.upload_emodnet(publish.MemoryStore(), marine_dir, NOW)
    bucket = tmp_path / "b"
    (bucket / "sources" / "emodnet").mkdir(parents=True)
    (bucket / sources.EMODNET_POINTER).write_text(json.dumps({"key": "../x", "sha256": "0" * 64, "bytes": 1}))
    with (
        httpx.Client(transport=httpx.MockTransport(serve(bucket))) as client,
        pytest.raises(sources.SourceError, match="invalid key"),
    ):
        sources.fetch_emodnet(client, BASE, tmp_path / "y")


def test_cli_marine_commands(fixtures: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "make_client", lambda: wfs(good_responses(fixtures)))
    assert cli.main(["marine", "fetch", "--data-dir", str(tmp_path)]) == 0
    bucket = tmp_path / "bucket"
    assert cli.main(["sources", "emodnet-upload", "--data-dir", str(tmp_path), "--dir", str(bucket)]) == 0
    monkeypatch.setattr(cli, "make_client", lambda: httpx.Client(transport=httpx.MockTransport(serve(None))))
    assert (
        cli.main(["sources", "emodnet-fetch", "--data-dir", str(tmp_path / "fresh"), "--baseline-url", BASE])
        == 0
    )
    monkeypatch.setattr(
        cli, "make_client", lambda: wfs({name: httpx.Response(503) for name in emodnet.LAYERS.values()})
    )
    assert cli.main(["marine", "fetch", "--data-dir", str(tmp_path / "z")]) == cli.EXIT_FAILED


def test_a_project_listed_twice_is_added_once() -> None:
    """EMODnet has "MedWind" as a point and "Med Wind wind farm" as an area, 8 km apart, both 2793 MW."""

    def farm(key: int, name: str, lon: float, mw: float | None) -> PowerPlant:
        prov = Provenance(source="emodnet", source_id=f"windfarms/{key}", license="EMODnet-open",
                          retrieved_at=NOW)  # fmt: skip
        return PowerPlant(id=f"emodnet:windfarms/{key}", status=Status.PLANNED, operator=None,
                          provenance=(prov,), name=name, technology=Technology.WIND, capacity_mw=mw,
                          commissioning_year=None, country="IT", location=(lon, 37.6))  # fmt: skip

    farms = [
        farm(213, "MedWind", 11.90, 2793.0),
        farm(529, "Med Wind wind farm", 11.99, 2793.0),  # the same project again
        farm(531, "Marche wind farm 1", 13.80, 480.0),
        farm(532, "Marche wind farm 2", 13.80, 480.0),  # a second phase: its own record
        farm(600, "MedWind", 16.50, 2793.0),  # same name and size, 400 km away: not the same
        farm(601, "Med Wind", 11.95, 1000.0),  # same name, another size: not the same
    ]
    plants: dict[str, PowerPlant] = {}
    stats: Counter[str] = Counter()
    emodnet.merge_windfarms(plants, farms, stats)
    assert sorted(plants) == [f"emodnet:windfarms/{key}" for key in (213, 531, 532, 600, 601)]
    assert stats == {"windfarms_added": 5, "windfarms_listed_twice": 1}
