"""HEP ODS grid capacity (kapaciteti.hep.hr) against a mocked portal that answers with real rows.

The ten substations in ``fixtures/hep/stations.json`` are copied verbatim from the live answer of
2026-11-08 (data version 4) and chosen for their quirks: a ratio that disagrees with the name, no short
name, no position, an MV/MV substation with a parent, a 35/0.4 kV unit, float noise in the kW figures.
The area polygons in ``regions.geojson`` keep HEP's ids, names and geometry types, reduced to boxes.
"""

from __future__ import annotations

import copy
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from energymap import cli, publish
from energymap.hep import capacity

FIXTURES = Path(__file__).parent / "fixtures" / "hep"
NOW = datetime(2026, 11, 8, 9, 0, tzinfo=UTC)


def load(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def _small_release(monkeypatch: pytest.MonkeyPatch) -> None:
    """The fixture is ten substations; the production floors (300) are tested on their own below."""
    monkeypatch.setattr(capacity, "MIN_STATIONS", 5)
    monkeypatch.setattr(capacity, "MIN_LOCATED", 5)
    # one bad row in ten is 10 %; the real limit (2 %) has its own test
    monkeypatch.setattr(capacity, "MAX_INVALID_SHARE", 0.15)


class Portal:
    """A stand-in for kapaciteti.hep.hr with the three resources the map loads."""

    def __init__(self) -> None:
        self.version: dict[str, Any] = load("version.json")
        self.stations: list[dict[str, Any]] = load("stations.json")
        self.regions: dict[str, Any] = load("regions.geojson")
        self.status = 200
        self.requests: list[httpx.Request] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status, text="<html>maintenance</html>")
        path = request.url.path.lstrip("/")
        if path == capacity.VERSION_PATH:
            return httpx.Response(200, json=self.version)
        if path == capacity.STATIONS_PATH:
            return httpx.Response(200, json=self.stations)
        if path == capacity.REGIONS_PATH:
            return httpx.Response(200, json=self.regions)
        return httpx.Response(404, text="not found")


@pytest.fixture
def portal() -> Portal:
    return Portal()


@pytest.fixture
def client(portal: Portal) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(portal.handle))


def by_id(document: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {station["id"]: station for station in document["stations"]}


# ---------------------------------------------------------------- reading the values


@pytest.mark.parametrize(
    ("full_name", "ratio", "level"),
    [
        ("TS 110/35kV 4TS 117 JERTOVEC", "110/35 kV", 110),
        ("TS 110/35 kV BJELOVAR 1", "35/10(20) kV", 110),  # the name wins over a wrong ratio
        ("4TS26 TS 110/20 kV NOVALJA", None, 110),  # a leading code is not a voltage
        ("RP 35 KV GTE CIGLENA", None, 35),
        ("TS 35kV RP HE DUBRAVA - STROJARNICA (RP03)", None, 35),
        ("TS 220/110/35kV PEHLIN", "220/110/35 kV", 220),
        ("TS 35(30)/10 kV X", None, 35),
        ("3RS3 STROJARNICA", None, None),  # nothing says
        ("BRANA STRMEC", "30/10 kV", 30),  # only the ratio says
    ],
)
def test_voltage_level_comes_from_the_name_first(
    full_name: str, ratio: str | None, level: int | None
) -> None:
    assert capacity.voltage_level(full_name, ratio) == level


@pytest.mark.parametrize(
    ("full_name", "published", "name"),
    [
        ("TS 110/35kV 4TS 117 JERTOVEC", None, "JERTOVEC"),
        ("TS 110/35kV POKUPJE", None, "POKUPJE"),
        ("4TS26 TS 110/20 kV NOVALJA", None, "NOVALJA"),
        ("RP 35 KV GTE CIGLENA", None, "GTE CIGLENA"),
        ("TS 110/35/10kV PRELOG (T04)", None, "PRELOG (T04)"),
        ("TS 110/35 kV BJELOVAR 1", "BJELOVAR 1", "BJELOVAR 1"),
        ("3RS3 STROJARNICA", None, "STROJARNICA"),
        ("3TS0104 - KONČAR FALEROVO", None, "KONČAR FALEROVO"),
        ("BRANA STRMEC", "  ", "BRANA STRMEC"),
    ],
)
def test_short_name(full_name: str, published: str | None, name: str) -> None:
    assert capacity.short_name(full_name, published) == name


def test_transformer_lists() -> None:
    assert capacity.transformers("40+31.5+31.5") == [40.0, 31.5, 31.5]
    assert capacity.transformers("6,3+6,3") == [6.3, 6.3]
    assert capacity.transformers("0") == []
    assert capacity.transformers("") == []
    assert capacity.transformers("0.1") == [0.1]
    with pytest.raises(ValueError, match="transformer"):
        capacity.transformers("40 MVA")
    with pytest.raises(ValueError, match="transformer"):
        capacity.transformers("-20")


# ---------------------------------------------------------------- collecting a release


def test_collect_builds_one_document_from_the_three_resources(client: httpx.Client, portal: Portal) -> None:
    document, regions = capacity.collect(client, NOW)
    assert document["dataVersion"] == 4
    assert document["dataDate"] == "2026-10-01"
    assert document["publishedAt"] == "2026-10-23T08:53:38.574000+00:00"
    assert document["retrievedAt"] == NOW.isoformat()
    assert document["license"] == "HEP-ODS-permission"
    assert len(document["stations"]) == 10
    assert [s["id"] for s in document["stations"]] == sorted(s["id"] for s in document["stations"])
    # 21 areas, sorted by id, names as HEP writes them
    assert len(document["areas"]) == 21
    assert document["areas"][0] == {"id": 4001, "name": "Elektra Zagreb"}
    assert len(regions["features"]) == 21
    assert regions["features"][0]["properties"] == {"id": 4001, "name": "Elektra Zagreb"}
    assert "color" not in regions["features"][0]["properties"]
    # the referenced parents DELNICE and LOŠINJ are not in the ten-row fixture: cleared and listed
    assert document["problems"] == {
        "skipped": [],
        "outsideCroatia": [],
        "unresolvedParents": ["TS 35/0.4kV RAZROMIR", "TS 35/10kV SILBA"],
    }
    assert {r.url.path for r in portal.requests} == {
        "/api/substation-data/current",
        "/api/substations/with-data",
        "/regions/regions_low.geojson",
    }
    capacity.validate(document)


def test_station_records_keep_empty_as_empty_and_round_the_noise(client: httpx.Client) -> None:
    stations = by_id(capacity.collect(client, NOW)[0])
    jertovec = stations["TS 110/35kV 4TS 117 JERTOVEC"]
    assert jertovec == {
        "id": "TS 110/35kV 4TS 117 JERTOVEC",
        "name": "JERTOVEC",
        "label": "3TS13",
        "ratio": "110/35 kV",
        "levelKv": 110,
        "area": 4001,
        "parent": None,
        "lon": 16.184448,
        "lat": 46.03882,
        "existing": "none",
        "upgraded": "none",
        "freeKw": None,  # empty where the category says there is nothing: stays empty, never 0
        "additionalFreeKw": None,
        "existingUsersKw": 15355.4,
        "contractedUsersKw": 22015.0,
        "pendingUsersKw": 10999.8,  # 10999.789999999994
        "totalConnectionKw": 48370.2,
        "minConsumptionKw": 5588.3,
        "transformationKva": 20000.0,
        "upgradeKva": 20000.0,
        "transformersMva": [20.0],
        "plannedTransformersMva": [40.0, 40.0],
    }
    ilovac = stations["TS 35/20/10kV ILOVAC"]
    assert ilovac["parent"] == "TS 110/35kV POKUPJE" and ilovac["levelKv"] == 35
    assert ilovac["existing"] == "B" and ilovac["freeKw"] == 7097.0
    assert stations["TS 110/35 kV BJELOVAR 1"]["levelKv"] == 110
    assert stations["TS 110/30kV 4TS 28 TE-TO"]["additionalFreeKw"] == 40000.0
    novalja = stations["4TS26 TS 110/20 kV NOVALJA"]
    assert novalja["lon"] is None and novalja["lat"] is None and novalja["name"] == "NOVALJA"
    assert novalja["transformersMva"] == []
    ciglena = stations["RP 35 KV GTE CIGLENA"]
    assert ciglena["parent"] == "TS 110/35 kV BJELOVAR 1" and ciglena["area"] is None


def test_a_bad_row_is_skipped_and_named_a_bad_format_stops_everything(
    client: httpx.Client, portal: Portal, monkeypatch: pytest.MonkeyPatch
) -> None:
    portal.stations[0]["freeCapacityKw"] = -5  # negative capacity: not a number we can show
    document, _ = capacity.collect(client, NOW)
    assert document["problems"]["skipped"] == ["TS 110/35kV 4TS 117 JERTOVEC"]
    assert len(document["stations"]) == 9
    monkeypatch.setattr(capacity, "MAX_INVALID_SHARE", 0.02)
    with pytest.raises(capacity.HepDataError, match="format has probably changed"):
        capacity.collect(client, NOW)


def test_a_renamed_field_is_caught_not_published_as_empty(client: httpx.Client, portal: Portal) -> None:
    for row in portal.stations:
        row["acceptanceCategory"] = row.pop("acceptanceCategoryExistingNetwork")
    with pytest.raises(capacity.HepDataError, match="10 of 10"):
        capacity.collect(client, NOW)


def test_a_position_outside_croatia_is_dropped_the_station_stays(
    client: httpx.Client, portal: Portal
) -> None:
    portal.stations[1]["coordinateGeoJSONData"]["coordinates"] = [45.535741, 15.551805]  # swapped axes
    document, _ = capacity.collect(client, NOW)
    pokupje = by_id(document)["TS 110/35kV POKUPJE"]
    assert pokupje["lon"] is None and pokupje["existing"] == "D"
    assert document["problems"]["outsideCroatia"] == ["TS 110/35kV POKUPJE"]


def test_duplicate_names_are_refused(client: httpx.Client, portal: Portal) -> None:
    portal.stations.append(copy.deepcopy(portal.stations[0]))
    with pytest.raises(capacity.HepDataError, match="duplicate"):
        capacity.collect(client, NOW)


def test_portal_errors_are_reported_not_swallowed(client: httpx.Client, portal: Portal) -> None:
    portal.status = 503
    with pytest.raises(capacity.HepSourceError, match="HTTP 503"):
        capacity.collect(client, NOW)


def test_an_unexpected_version_answer_is_a_source_error(client: httpx.Client, portal: Portal) -> None:
    portal.version = {"versionId": "four"}
    with pytest.raises(capacity.HepSourceError, match="unexpected answer"):
        capacity.collect(client, NOW)


def test_regions_are_checked() -> None:
    good = load("regions.geojson")
    capacity.regions(good)
    too_few = {**good, "features": good["features"][:3]}
    with pytest.raises(capacity.HepDataError, match="expected 15-30 areas, got 3"):
        capacity.regions(too_few)
    point = copy.deepcopy(good)
    point["features"][0]["geometry"] = {"type": "Point", "coordinates": [16.0, 45.0]}
    with pytest.raises(capacity.HepDataError, match="expected a polygon"):
        capacity.regions(point)
    abroad = copy.deepcopy(good)
    abroad["features"][0]["geometry"]["coordinates"][0][0] = [45.0, 16.0]
    with pytest.raises(capacity.HepDataError, match="outside Croatia"):
        capacity.regions(abroad)


# ---------------------------------------------------------------- validation


def test_validation_floors_and_integrity(client: httpx.Client, monkeypatch: pytest.MonkeyPatch) -> None:
    document, _ = capacity.collect(client, NOW)
    capacity.validate(document)
    monkeypatch.setattr(capacity, "MIN_STATIONS", 300)
    with pytest.raises(capacity.HepDataError, match="at least 300 substations, got 10"):
        capacity.validate(document)
    monkeypatch.setattr(capacity, "MIN_STATIONS", 5)
    monkeypatch.setattr(capacity, "MIN_LOCATED", 9)  # 7 of 10 have a position
    with pytest.raises(capacity.HepDataError, match="with a position, got 7"):
        capacity.validate(document)
    monkeypatch.setattr(capacity, "MIN_LOCATED", 5)
    tampered = copy.deepcopy(document)
    tampered["stations"][0]["freeKw"] = 1.0
    with pytest.raises(capacity.HepDataError, match="contentHash"):
        capacity.validate(tampered)
    unknown = copy.deepcopy(document)
    unknown["stations"][0]["existing"] = "E"
    unknown["contentHash"] = capacity.content_hash(unknown["stations"], unknown["areas"])
    with pytest.raises(capacity.HepDataError, match="category"):
        capacity.validate(unknown)


# ---------------------------------------------------------------- history and publishing


def release(
    client: httpx.Client, portal: Portal, version: int, date: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    portal.version = {**portal.version, "versionId": version, "dataDate": f"{date}T12:00:00.000Z"}
    return capacity.collect(client, NOW)


def test_first_publish_writes_snapshot_history_areas_and_current_last(client: httpx.Client) -> None:
    store = publish.MemoryStore()
    document, regions = capacity.collect(client, NOW)
    result = capacity.publish_capacity(store, document, regions)
    assert result.changed and result.snapshots == 1
    assert result.snapshot == f"hep/snapshots/2026-10-01-v4-{document['contentHash'][:12]}.json"
    assert store.writes == [result.snapshot, capacity.HISTORY_KEY, capacity.REGIONS_KEY, capacity.CURRENT_KEY]
    history = json.loads(store.get_bytes(capacity.HISTORY_KEY) or b"")
    assert history["snapshots"] == [
        {
            "dataVersion": 4,
            "dataDate": "2026-10-01",
            "publishedAt": "2026-10-23T08:53:38.574000+00:00",
            "key": result.snapshot,
        }
    ]
    assert history["stations"]["TS 35/20/10kV ILOVAC"] == {
        "existing": ["B"],
        "upgraded": ["B"],
        "freeKw": [7097.0],
    }
    assert store.objects[result.snapshot][1] == capacity.SNAPSHOT_META


def test_the_same_content_again_writes_nothing(client: httpx.Client) -> None:
    store = publish.MemoryStore()
    document, regions = capacity.collect(client, NOW)
    capacity.publish_capacity(store, document, regions)
    store.writes.clear()
    later, _ = capacity.collect(client, datetime(2026, 11, 9, 9, 0, tzinfo=UTC))  # a day later, same release
    result = capacity.publish_capacity(store, later, regions)
    assert not result.changed and store.writes == []


def test_a_new_release_extends_the_history(client: httpx.Client, portal: Portal) -> None:
    store = publish.MemoryStore()
    first, regions = capacity.collect(client, NOW)
    capacity.publish_capacity(store, first, regions)
    # version 5: ILOVAC fills up, NOVALJA disappears from the list
    portal.stations[2]["acceptanceCategoryExistingNetwork"] = "/"
    portal.stations[2]["freeCapacityKw"] = 0
    del portal.stations[9]
    second, _ = release(client, portal, 5, "2026-11-01")
    result = capacity.publish_capacity(store, second, regions)
    assert result.changed and result.snapshots == 2
    history = json.loads(store.get_bytes(capacity.HISTORY_KEY) or b"")
    assert [s["dataVersion"] for s in history["snapshots"]] == [4, 5]
    assert history["stations"]["TS 35/20/10kV ILOVAC"]["existing"] == ["B", "none"]
    assert history["stations"]["TS 35/20/10kV ILOVAC"]["freeKw"] == [7097.0, 0.0]
    assert history["stations"]["4TS26 TS 110/20 kV NOVALJA"]["existing"] == ["none", None]
    current = json.loads(store.get_bytes(capacity.CURRENT_KEY) or b"")
    assert current["dataVersion"] == 5


def test_an_older_release_is_refused_and_nothing_changes(client: httpx.Client, portal: Portal) -> None:
    store = publish.MemoryStore()
    newer, regions = release(client, portal, 5, "2026-11-01")
    capacity.publish_capacity(store, newer, regions)
    before = dict(store.objects)
    portal.stations[0]["freeCapacityKw"] = 1  # different content, older version
    older, _ = release(client, portal, 4, "2026-10-01")
    with pytest.raises(capacity.HepDataError, match="older than the published 5"):
        capacity.publish_capacity(store, older, regions)
    assert store.objects == before


def test_a_large_drop_needs_allow_drop(client: httpx.Client, portal: Portal) -> None:
    store = publish.MemoryStore()
    full, regions = capacity.collect(client, NOW)
    capacity.publish_capacity(store, full, regions)
    del portal.stations[7:]  # 10 → 7 substations
    smaller, _ = release(client, portal, 5, "2026-11-01")
    with pytest.raises(capacity.HepDataError, match="allow-drop"):
        capacity.publish_capacity(store, smaller, regions)
    assert json.loads(store.get_bytes(capacity.CURRENT_KEY) or b"")["dataVersion"] == 4
    assert capacity.publish_capacity(store, smaller, regions, allow_drop=True).changed


def test_a_bad_document_leaves_the_published_one(client: httpx.Client) -> None:
    store = publish.MemoryStore()
    document, regions = capacity.collect(client, NOW)
    capacity.publish_capacity(store, document, regions)
    before = dict(store.objects)
    broken = {**document, "stations": document["stations"][:2]}
    with pytest.raises(capacity.HepDataError):
        capacity.publish_capacity(store, broken, regions)
    assert store.objects == before


def test_history_counts_the_same_content_once_and_orders_by_date() -> None:
    def snap(version: int, date: str, digest: str, category: str) -> dict[str, Any]:
        return {
            "dataVersion": version,
            "dataDate": date,
            "publishedAt": f"{date}T10:00:00+00:00",
            "contentHash": digest * 64,
            "stations": [{"id": "TS A", "existing": category, "upgraded": category, "freeKw": None}],
        }

    history = capacity.build_history(
        [snap(6, "2026-12-01", "c", "A"), snap(4, "2026-10-01", "a", "D"), snap(4, "2026-10-01", "a", "D")]
    )
    assert [s["dataVersion"] for s in history["snapshots"]] == [4, 6]
    assert history["stations"]["TS A"]["existing"] == ["D", "A"]
    # content that comes back (A → B → A) is a change, and the history ends where the current release is
    back = capacity.build_history(
        [snap(4, "2026-10-01", "a", "D"), snap(5, "2026-11-01", "b", "A"), snap(6, "2026-12-01", "a", "D")]
    )
    assert [s["dataVersion"] for s in back["snapshots"]] == [4, 5, 6]
    assert back["stations"]["TS A"]["existing"] == ["D", "A", "D"]


def test_a_new_release_with_the_same_figures_is_published(client: httpx.Client, portal: Portal) -> None:
    store = publish.MemoryStore()
    first, regions = capacity.collect(client, NOW)
    capacity.publish_capacity(store, first, regions)
    # HEP publishes version 5 for November with exactly the same figures: the site must say "as of 1 November"
    same, _ = release(client, portal, 5, "2026-11-01")
    assert same["contentHash"] == first["contentHash"]
    result = capacity.publish_capacity(store, same, regions)
    assert result.changed
    current = json.loads(store.get_bytes(capacity.CURRENT_KEY) or b"")
    assert (current["dataVersion"], current["dataDate"]) == (5, "2026-11-01")
    # the history shows changes in the figures: one step, from when they first appeared
    history = json.loads(store.get_bytes(capacity.HISTORY_KEY) or b"")
    assert [s["dataVersion"] for s in history["snapshots"]] == [4]


def test_cli_hep_fetch_and_publish(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, portal: Portal) -> None:
    out = tmp_path / "mirror"
    assert (
        cli.main(["hep", "publish-dir", "--data-dir", str(tmp_path), "--out", str(out)]) == cli.EXIT_REJECTED
    )
    monkeypatch.setattr(
        "energymap.cli.make_client", lambda: httpx.Client(transport=httpx.MockTransport(portal.handle))
    )
    assert cli.main(["hep", "fetch", "--data-dir", str(tmp_path)]) == cli.EXIT_OK
    document = json.loads((tmp_path / "hep" / "current.json").read_text(encoding="utf-8"))
    assert document["dataVersion"] == 4 and len(document["stations"]) == 10
    assert cli.main(["hep", "publish-dir", "--data-dir", str(tmp_path), "--out", str(out)]) == cli.EXIT_OK
    assert json.loads((out / "hep" / "current.json").read_text(encoding="utf-8"))["dataVersion"] == 4
    assert (out / "hep" / "regions.geojson").exists() and (out / "hep" / "history.json").exists()
    portal.status = 500
    assert cli.main(["hep", "fetch", "--data-dir", str(tmp_path)]) == cli.EXIT_FAILED
