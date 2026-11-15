"""Available capacity for new connections in HEP ODS's distribution network, from kapaciteti.hep.hr.

HEP ODS publishes no API and no file; it allowed this project (2026-11-08) to reuse what its own map loads.
Verified in a browser on 2026-11-08 (data version 4, state of 2026-10-01, published 2026-10-23):

* ``api/substation-data/current`` → the data version: ``versionId`` (an integer that grows with every
  release), ``dataDate`` (the state the figures describe) and ``updatedAt`` (when it was published).
* ``api/substations/with-data`` → one row per substation, 488 at version 4: about 160 HV/MV (110 and 220 kV),
  about 320 MV/MV (35 and 30 kV) and some 50 switching stations and plant connections without a position.
  440 rows carry a GeoJSON point. Capacities are in kW; the acceptance category (``/``, ``A`` to ``D``) is
  given for the existing network and for the network with an upgraded HV/MV transformer.
  ``parentFullyQualifiedName`` links an MV/MV substation to the HV/MV one that feeds it.
* ``regions/regions_low.geojson`` → the 21 distribution areas (``identification_number``, ``dp_name``).

Quirks the code relies on, all seen in the real data: the voltage ratio field can disagree with the name
(``TS 110/35 kV BJELOVAR 1`` has ratio ``35/10(20) kV``), so the voltage level comes from the name first;
``coordinateName`` is often empty, so the short name is cut out of the full one; free capacity can be empty
where the category says there is none, and empty stays empty (never 0).

Releases come in versions, not daily. ``hep-daily`` asks every day and publishes a snapshot only when the
version or the content changed. Every snapshot is kept and the history is rebuilt from all of them, so a
lost or bad run never rewrites the past, and the published current document is replaced last.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from energymap.publish import ObjectMeta, ObjectStore

log = logging.getLogger(__name__)

BASE_URL = "https://kapaciteti.hep.hr/"
VERSION_PATH = "api/substation-data/current"
STATIONS_PATH = "api/substations/with-data"
REGIONS_PATH = "regions/regions_low.geojson"

VERSION = 1
SOURCE = "HEP ODS"
SOURCE_URL = BASE_URL
#: reuse allowed by HEP ODS on 2026-11-08 (no public licence; see README, Faza 15)
LICENSE = "HEP-ODS-permission"

CURRENT_KEY = "hep/current.json"
HISTORY_KEY = "hep/history.json"
REGIONS_KEY = "hep/regions.geojson"
SNAPSHOT_PREFIX = "hep/snapshots/"

# The map asks once per visit; an hour in caches is nothing against releases that come weeks apart.
CURRENT_META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")
REGIONS_META = ObjectMeta("application/geo+json; charset=utf-8", "public, max-age=3600, must-revalidate")
# a snapshot never changes once written: its key carries the version and a hash of the content
SNAPSHOT_META = ObjectMeta("application/json; charset=utf-8", "public, max-age=31536000, immutable")

#: version 4 had 488 rows and 440 positions; far fewer means a broken answer, not a smaller grid
MIN_STATIONS = 300
MIN_LOCATED = 300
#: rows that fail validation are skipped and listed, unless there are so many that the format has changed
MAX_INVALID_SHARE = 0.02
#: a release with this much fewer substations than the published one needs --allow-drop
MAX_DROP = 0.10
MIN_AREAS, MAX_AREAS = 15, 30
#: Croatia with a margin; a point outside is a data error, not a substation abroad
CROATIA_BBOX = (13.0, 42.0, 19.8, 46.8)

Category = Literal["none", "A", "B", "C", "D"]
CATEGORIES: tuple[Category, ...] = ("none", "A", "B", "C", "D")
_CATEGORY_CODES: dict[str, Category] = {"/": "none", "A": "A", "B": "B", "C": "C", "D": "D"}


class HepSourceError(RuntimeError):
    """kapaciteti.hep.hr answered with something other than the data."""


class HepDataError(ValueError):
    """The capacity document is not publishable."""


# ---------------------------------------------------------------- the source, as it answers

Kw = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class _Raw(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)


class RawVersion(_Raw):
    version_id: Annotated[int, Field(ge=1, alias="versionId")]
    data_date: Annotated[datetime, Field(alias="dataDate")]
    updated_at: Annotated[datetime, Field(alias="updatedAt")]


class RawPoint(_Raw):
    type: Literal["Point"]
    coordinates: tuple[float, float]


class RawStation(_Raw):
    full_name: Annotated[str, Field(min_length=1, alias="fullyQualifiedName")]
    area: Annotated[int | None, Field(alias="distributionAreaId")] = None
    label: Annotated[str | None, Field(alias="shorthandLabel")] = None
    short_name: Annotated[str | None, Field(alias="coordinateName")] = None
    ratio: Annotated[str | None, Field(alias="transferCoordinator")] = None
    point: Annotated[RawPoint | None, Field(alias="coordinateGeoJSONData")] = None
    parent: Annotated[str | None, Field(alias="parentFullyQualifiedName")] = None
    free_kw: Annotated[Kw | None, Field(alias="freeCapacityKw")] = None
    additional_free_kw: Annotated[Kw | None, Field(alias="additionalFreeCapacityKw")] = None
    existing_users_kw: Annotated[Kw | None, Field(alias="existingUsersPowerKw")] = None
    contracted_users_kw: Annotated[Kw | None, Field(alias="contractedUsersPowerKw")] = None
    pending_users_kw: Annotated[Kw | None, Field(alias="pendingUsersPowerKw")] = None
    total_connection_kw: Annotated[Kw | None, Field(alias="totalConnectionPowerKw")] = None
    min_consumption_kw: Annotated[Kw | None, Field(alias="dailyMinimumConsumptionKw")] = None
    transformation_kva: Annotated[Kw | None, Field(alias="existingTransformationKva")] = None
    upgrade_kva: Annotated[Kw | None, Field(alias="transformationUpgradeKva")] = None
    installed_mva: Annotated[str, Field(alias="installedTransformationPowerMva")] = ""
    planned_mva: Annotated[str, Field(alias="plannedTransformationPowerMva")] = ""
    category_existing: Annotated[
        Literal["/", "A", "B", "C", "D"], Field(alias="acceptanceCategoryExistingNetwork")
    ]
    category_upgraded: Annotated[
        Literal["/", "A", "B", "C", "D"], Field(alias="acceptanceCategoryFutureNetwork")
    ]


# ---------------------------------------------------------------- reading the published values

_LEVEL_PATTERNS = (
    re.compile(r"(?<![\d.])(\d{2,3})(?:\(\d+\))?\s*/"),  # "110/35kV", "35(30)/10 kV"
    re.compile(r"(?<![\d.])(\d{2,3})\s*[kK][vV]\b"),  # "RP 35 KV", "TS 35kV RP …"
)
_NAME_PREFIXES = (
    re.compile(r"^\d[A-Z]{2}\d+\s+(?:-\s*)?"),  # a leading code: "4TS26 ", "3TS0104 - "
    re.compile(r"^(?:TS|RP)\s+"),
    re.compile(r"^[\d()/.,]+\s*[kK][vV]\s+"),  # the voltage ratio: "110/35kV ", "35 KV "
    re.compile(r"^\d?TS\s?\d+\s+"),  # the station code after the ratio: "4TS 117 "
)


def voltage_level(full_name: str, ratio: str | None) -> int | None:
    """The highest voltage of a substation in kV: from its name first (the ratio field is not always right),
    then from the ratio. ``None`` when neither says, e.g. "3RS3 STROJARNICA"."""
    for text in (full_name, ratio or ""):
        for pattern in _LEVEL_PATTERNS:
            match = pattern.search(text)
            if match:
                level = int(match.group(1))
                if 6 <= level <= 400:
                    return level
    return None


def short_name(full_name: str, published: str | None) -> str:
    """The name without codes and ratio: "TS 110/35kV 4TS 117 JERTOVEC" → "JERTOVEC".

    HEP's own short name wins when it gives one."""
    if published and published.strip():
        return published.strip()
    name = full_name.strip()
    for pattern in _NAME_PREFIXES:
        name = pattern.sub("", name, count=1)
    return name.strip() or full_name.strip()


def transformers(text: str) -> list[float]:
    """Transformer sizes in MVA: "40+31.5+31.5" → [40.0, 31.5, 31.5]; "0" or "" → [] (none).

    Anything else is an error."""
    units: list[float] = []
    for part in text.replace(",", ".").split("+"):
        token = part.strip()
        if not token:
            continue
        try:
            value = float(token)
        except ValueError:
            raise ValueError(f"not a transformer list: {text!r}") from None
        if value < 0 or not math.isfinite(value):
            raise ValueError(f"not a transformer list: {text!r}")
        if value > 0:
            units.append(value)
    return units


def _kw(value: float | None) -> float | None:
    """One decimal: the source carries float noise such as 10999.789999999994."""
    return None if value is None else round(value, 1)


def _inside_croatia(lon: float, lat: float) -> bool:
    west, south, east, north = CROATIA_BBOX
    return west <= lon <= east and south <= lat <= north


@dataclass(frozen=True, slots=True)
class Normalized:
    stations: list[dict[str, Any]]
    skipped: list[str]
    outside: list[str]
    unresolved_parents: list[str]


def normalize(rows: Iterable[object]) -> Normalized:
    """Validate every row and turn it into the published station record (camelCase, kW with one decimal).

    A row that fails validation is skipped and named; if more than ``MAX_INVALID_SHARE`` of the rows fail,
    the format has changed and the whole answer is refused. A position outside Croatia is dropped (the station
    stays, without a place on the map) and a parent that is not in the answer is cleared; both are listed.
    """
    rows = list(rows)
    if not rows:
        raise HepDataError("the source returned no substations")
    parsed: list[tuple[RawStation, list[float], list[float]]] = []
    skipped: list[str] = []
    for position, row in enumerate(rows, start=1):
        try:
            station = RawStation.model_validate(row)
            parsed.append((station, transformers(station.installed_mva), transformers(station.planned_mva)))
        except (ValidationError, ValueError) as exc:
            name = row.get("fullyQualifiedName") if isinstance(row, dict) else None
            skipped.append(str(name) if name else f"row {position}")
            log.warning("skipped substation", extra={"substation": skipped[-1], "error": str(exc)[:300]})
    if len(skipped) > MAX_INVALID_SHARE * len(rows):
        raise HepDataError(
            f"{len(skipped)} of {len(rows)} substations failed validation (more than "
            f"{MAX_INVALID_SHARE:.0%}); the source format has probably changed: {skipped[:5]}"
        )
    ids = [station.full_name for station, _, _ in parsed]
    duplicates = sorted({name for name in ids if ids.count(name) > 1})
    if duplicates:
        raise HepDataError(f"duplicate substation names: {duplicates[:5]}")
    known = set(ids)
    outside: list[str] = []
    unresolved: list[str] = []
    stations: list[dict[str, Any]] = []
    for station, installed, planned in sorted(parsed, key=lambda item: item[0].full_name):
        lon: float | None = None
        lat: float | None = None
        if station.point is not None:
            x, y = station.point.coordinates
            if _inside_croatia(x, y):
                lon, lat = round(x, 6), round(y, 6)
            else:
                outside.append(station.full_name)
        parent = station.parent.strip() if station.parent and station.parent.strip() else None
        if parent is not None and parent not in known:
            unresolved.append(station.full_name)
            parent = None
        stations.append(
            {
                "id": station.full_name,
                "name": short_name(station.full_name, station.short_name),
                "label": station.label.strip() if station.label and station.label.strip() else None,
                "ratio": station.ratio.strip() if station.ratio and station.ratio.strip() else None,
                "levelKv": voltage_level(station.full_name, station.ratio),
                "area": station.area,
                "parent": parent,
                "lon": lon,
                "lat": lat,
                "existing": _CATEGORY_CODES[station.category_existing],
                "upgraded": _CATEGORY_CODES[station.category_upgraded],
                "freeKw": _kw(station.free_kw),
                "additionalFreeKw": _kw(station.additional_free_kw),
                "existingUsersKw": _kw(station.existing_users_kw),
                "contractedUsersKw": _kw(station.contracted_users_kw),
                "pendingUsersKw": _kw(station.pending_users_kw),
                "totalConnectionKw": _kw(station.total_connection_kw),
                "minConsumptionKw": _kw(station.min_consumption_kw),
                "transformationKva": _kw(station.transformation_kva),
                "upgradeKva": _kw(station.upgrade_kva),
                "transformersMva": installed,
                "plannedTransformersMva": planned,
            }
        )
    return Normalized(stations, sorted(skipped), outside, unresolved)


def regions(document: object) -> dict[str, Any]:
    """The distribution areas as a lean FeatureCollection: ``id`` and ``name`` per polygon, coordinates
    rounded to 5 decimals (about a metre). Refuses anything that does not look like HEP's 21 areas."""
    if not isinstance(document, dict) or document.get("type") != "FeatureCollection":
        raise HepDataError("regions: not a GeoJSON FeatureCollection")
    features = document.get("features")
    if not isinstance(features, list) or not MIN_AREAS <= len(features) <= MAX_AREAS:
        count = len(features) if isinstance(features, list) else 0
        raise HepDataError(f"regions: expected {MIN_AREAS}-{MAX_AREAS} areas, got {count}")
    lean: list[dict[str, Any]] = []
    for feature in features:
        props = feature.get("properties") if isinstance(feature, dict) else None
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        if not isinstance(props, dict) or not isinstance(geometry, dict):
            raise HepDataError("regions: a feature without properties or geometry")
        ident, name = props.get("identification_number"), props.get("dp_name")
        if (
            not isinstance(ident, int)
            or isinstance(ident, bool)
            or not isinstance(name, str)
            or not name.strip()
        ):
            raise HepDataError(f"regions: a feature without an id or a name: {props}")
        if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            raise HepDataError(f"regions: {name} is a {geometry.get('type')}, expected a polygon")
        lean.append(
            {
                "type": "Feature",
                "id": ident,
                "properties": {"id": ident, "name": name.strip()},
                "geometry": {
                    "type": geometry["type"],
                    "coordinates": _rounded(geometry.get("coordinates"), name),
                },
            }
        )
    collection = {"type": "FeatureCollection", "features": sorted(lean, key=lambda f: int(f["id"]))}
    validate_regions(collection)
    return collection


def validate_regions(collection: object) -> None:
    """The lean collection ``regions()`` makes: what ``publish`` accepts from the data directory."""
    features = collection.get("features") if isinstance(collection, dict) else None
    if (
        not isinstance(collection, dict)
        or collection.get("type") != "FeatureCollection"
        or not isinstance(features, list)
    ):
        raise HepDataError("regions: not a GeoJSON FeatureCollection")
    if not MIN_AREAS <= len(features) <= MAX_AREAS:
        raise HepDataError(f"regions: expected {MIN_AREAS}-{MAX_AREAS} areas, got {len(features)}")
    ids: list[int] = []
    for feature in features:
        ident = feature.get("id") if isinstance(feature, dict) else None
        props = feature.get("properties") if isinstance(feature, dict) else None
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        if (
            not isinstance(ident, int)
            or isinstance(ident, bool)
            or not isinstance(props, dict)
            or props.get("id") != ident
            or not isinstance(props.get("name"), str)
            or not isinstance(geometry, dict)
            or geometry.get("type") not in {"Polygon", "MultiPolygon"}
        ):
            raise HepDataError(f"regions: malformed area {ident!r}")
        ids.append(ident)
    if len(set(ids)) != len(ids):
        raise HepDataError("regions: duplicate area ids")


def _rounded(coordinates: object, name: str) -> object:
    if (
        isinstance(coordinates, list)
        and len(coordinates) == 2
        and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in coordinates)
    ):
        lon, lat = float(coordinates[0]), float(coordinates[1])
        if not _inside_croatia(lon, lat):
            raise HepDataError(f"regions: {name} reaches outside Croatia ({lon}, {lat})")
        return [round(lon, 5), round(lat, 5)]
    if isinstance(coordinates, list) and coordinates:
        return [_rounded(part, name) for part in coordinates]
    raise HepDataError(f"regions: {name} has malformed coordinates")


def areas(region_collection: dict[str, Any]) -> list[dict[str, Any]]:
    return [{"id": f["id"], "name": f["properties"]["name"]} for f in region_collection["features"]]


def content_hash(stations: Sequence[dict[str, Any]], area_list: Sequence[dict[str, Any]]) -> str:
    """What decides whether a release is new: the figures and the areas, not when we fetched them."""
    canonical = json.dumps({"stations": stations, "areas": area_list}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


# ---------------------------------------------------------------- fetching


def _get_json(client: httpx.Client, path: str) -> object:
    url = BASE_URL + path
    response = client.get(url, headers={"Accept": "application/json"})
    if response.status_code != 200:
        raise HepSourceError(f"{path}: HTTP {response.status_code}")
    try:
        return response.json()
    except json.JSONDecodeError as exc:
        raise HepSourceError(f"{path}: not JSON ({exc})") from exc


def collect(client: httpx.Client, now: datetime) -> tuple[dict[str, Any], dict[str, Any]]:
    """The current release as one document for the map, plus the distribution areas."""
    try:
        version = RawVersion.model_validate(_get_json(client, VERSION_PATH))
    except ValidationError as exc:
        raise HepSourceError(f"{VERSION_PATH}: unexpected answer ({exc.error_count()} problems)") from exc
    rows = _get_json(client, STATIONS_PATH)
    if not isinstance(rows, list):
        raise HepSourceError(f"{STATIONS_PATH}: expected a list of substations")
    region_collection = regions(_get_json(client, REGIONS_PATH))
    result = normalize(rows)
    area_list = areas(region_collection)
    document = {
        "version": VERSION,
        "source": SOURCE,
        "sourceUrl": SOURCE_URL,
        "license": LICENSE,
        "dataVersion": version.version_id,
        "dataDate": version.data_date.date().isoformat(),
        "publishedAt": version.updated_at.isoformat(),
        "retrievedAt": now.isoformat(),
        "contentHash": content_hash(result.stations, area_list),
        "areas": area_list,
        "stations": result.stations,
        "problems": {
            "skipped": result.skipped,
            "outsideCroatia": result.outside,
            "unresolvedParents": result.unresolved_parents,
        },
    }
    return document, region_collection


# ---------------------------------------------------------------- validation and publishing


def validate(document: dict[str, Any]) -> None:
    if document.get("version") != VERSION:
        raise HepDataError(f"document version must be {VERSION}")
    if not isinstance(document.get("dataVersion"), int) or document["dataVersion"] < 1:
        raise HepDataError("dataVersion must be a positive integer")
    try:
        datetime.fromisoformat(str(document.get("dataDate")))
    except ValueError:
        raise HepDataError(f"dataDate is not a date: {document.get('dataDate')!r}") from None
    stations = document.get("stations")
    if not isinstance(stations, list) or len(stations) < MIN_STATIONS:
        count = len(stations) if isinstance(stations, list) else 0
        raise HepDataError(f"expected at least {MIN_STATIONS} substations, got {count}")
    located = sum(1 for s in stations if s.get("lon") is not None and s.get("lat") is not None)
    if located < MIN_LOCATED:
        raise HepDataError(f"expected at least {MIN_LOCATED} substations with a position, got {located}")
    ids = [s.get("id") for s in stations]
    if len(set(ids)) != len(ids) or not all(isinstance(i, str) and i for i in ids):
        raise HepDataError("substation ids must be unique, non-empty names")
    for station in stations:
        if station.get("existing") not in CATEGORIES or station.get("upgraded") not in CATEGORIES:
            raise HepDataError(f"{station.get('id')}: unknown acceptance category")
    area_list = document.get("areas")
    if not isinstance(area_list, list) or not MIN_AREAS <= len(area_list) <= MAX_AREAS:
        raise HepDataError(f"expected {MIN_AREAS}-{MAX_AREAS} distribution areas")
    if document.get("contentHash") != content_hash(stations, area_list):
        raise HepDataError("contentHash does not match the content")


def snapshot_key(document: dict[str, Any]) -> str:
    digest = document["contentHash"][:12]
    return f"{SNAPSHOT_PREFIX}{document['dataDate']}-v{document['dataVersion']}-{digest}.json"


def _ordering(snapshot: dict[str, Any]) -> tuple[str, int, str]:
    return (str(snapshot["dataDate"]), int(snapshot["dataVersion"]), str(snapshot.get("publishedAt", "")))


def build_history(snapshots: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Per substation, its categories and free capacity in every snapshot, as arrays aligned with
    ``snapshots`` (``None`` where the substation is absent). A run of snapshots with the same content counts
    once (the first, when that content appeared); the same content coming back later is a change and stays
    (Faza 31: A → B → A lost its last step when duplicates were dropped across the whole history)."""
    ordered: list[dict[str, Any]] = []
    for snapshot in sorted(snapshots, key=_ordering):
        if not ordered or ordered[-1]["contentHash"] != snapshot["contentHash"]:
            ordered.append(snapshot)
    series: dict[str, dict[str, list[Any]]] = {}
    for index, snapshot in enumerate(ordered):
        for station in snapshot["stations"]:
            entry = series.setdefault(
                station["id"],
                {
                    "existing": [None] * len(ordered),
                    "upgraded": [None] * len(ordered),
                    "freeKw": [None] * len(ordered),
                },
            )
            entry["existing"][index] = station["existing"]
            entry["upgraded"][index] = station["upgraded"]
            entry["freeKw"][index] = station.get("freeKw")
    return {
        "version": VERSION,
        "source": SOURCE,
        "license": LICENSE,
        "snapshots": [
            {
                "dataVersion": s["dataVersion"],
                "dataDate": s["dataDate"],
                "publishedAt": s.get("publishedAt"),
                "key": snapshot_key(s),
            }
            for s in ordered
        ],
        "stations": {key: series[key] for key in sorted(series)},
    }


def _compact(document: dict[str, Any]) -> bytes:
    return json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode()


def _published(store: ObjectStore, key: str) -> dict[str, Any] | None:
    raw = store.get_bytes(key)
    if raw is None:
        return None
    try:
        document = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HepDataError(f"the published {key} is not JSON ({exc})") from exc
    if not isinstance(document, dict):
        raise HepDataError(f"the published {key} is not an object")
    return document


@dataclass(frozen=True, slots=True)
class PublishResult:
    changed: bool
    snapshot: str | None
    snapshots: int


def publish_capacity(
    store: ObjectStore,
    document: dict[str, Any],
    region_collection: dict[str, Any],
    *,
    allow_drop: bool = False,
) -> PublishResult:
    """Publish a release: snapshot, then history, then areas, and the current document last.

    Nothing is written when the content equals the published release. A release older than the published one,
    or one with ``MAX_DROP`` fewer substations (without ``allow_drop``), is refused and the published data
    stays as it was. The source of truth for both checks is the bucket, not the local disk (L-015).
    """
    validate(document)
    validate_regions(region_collection)
    published = _published(store, CURRENT_KEY)
    if published is not None:
        if int(published.get("dataVersion", 0)) > document["dataVersion"]:
            raise HepDataError(
                f"data version {document['dataVersion']} is older than "
                f"the published {published['dataVersion']}"
            )
        # unchanged only when the figures, the release and the areas all match: a new HEP release with the
        # same figures still moves the "as of" date on the site (Faza 31)
        same_release = (
            published.get("contentHash") == document["contentHash"]
            and int(published.get("dataVersion", 0)) == document["dataVersion"]
            and str(published.get("dataDate")) == str(document["dataDate"])
        )
        if same_release and store.get_bytes(REGIONS_KEY) == _compact(region_collection):
            log.info("capacity unchanged", extra={"data_version": document["dataVersion"]})
            count = len(store.list_keys(SNAPSHOT_PREFIX))
            return PublishResult(changed=False, snapshot=None, snapshots=count)
        before = len(published.get("stations", []))
        after = len(document["stations"])
        if not allow_drop and before and after < (1 - MAX_DROP) * before:
            raise HepDataError(
                f"{after} substations against {before} published (more than {MAX_DROP:.0%} fewer); "
                "use --allow-drop if that is right"
            )
    key = snapshot_key(document)
    store.put_bytes(key, _compact(document), SNAPSHOT_META)
    snapshots = []
    for snapshot_name in store.list_keys(SNAPSHOT_PREFIX):
        snapshot = _published(store, snapshot_name)
        if snapshot is None:
            raise HepDataError(f"snapshot {snapshot_name} disappeared while building the history")
        snapshots.append(snapshot)
    history = build_history(snapshots)
    store.put_bytes(HISTORY_KEY, _compact(history), CURRENT_META)
    store.put_bytes(REGIONS_KEY, _compact(region_collection), REGIONS_META)
    store.put_bytes(CURRENT_KEY, _compact(document), CURRENT_META)
    log.info(
        "published grid capacity",
        extra={
            "data_version": document["dataVersion"],
            "data_date": document["dataDate"],
            "stations": len(document["stations"]),
            "snapshots": len(history["snapshots"]),
            "problems": {name: len(items) for name, items in document["problems"].items()},
        },
    )
    return PublishResult(changed=True, snapshot=key, snapshots=len(history["snapshots"]))
