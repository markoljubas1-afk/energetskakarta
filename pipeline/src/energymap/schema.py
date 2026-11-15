"""Unified, validated data model shared by every source. Serialised with camelCase keys for the web."""

from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from pydantic.alias_generators import to_camel

CountryCode = Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")]
#: links to the same object elsewhere, from OSM's wikidata/wikipedia tags (static pages: schema.org sameAs)
WikidataId = Annotated[str, StringConstraints(pattern=r"^Q[1-9][0-9]*$")]
WikipediaTitle = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z-]{1,11}:\S.{0,250}$")]
Longitude = Annotated[float, Field(ge=-180, le=180)]
Latitude = Annotated[float, Field(ge=-90, le=90)]
Coordinate = tuple[Longitude, Latitude]
VoltageKv = Annotated[float, Field(gt=0, le=1200)]


class Status(StrEnum):
    OPERATING = "operating"
    CONSTRUCTION = "construction"
    PLANNED = "planned"


class Technology(StrEnum):
    HYDRO = "hydro"
    PUMPED_STORAGE = "pumped_storage"
    SOLAR = "solar"
    WIND = "wind"
    GAS = "gas"
    COAL = "coal"
    LIGNITE = "lignite"
    NUCLEAR = "nuclear"
    BIOMASS = "biomass"
    GEOTHERMAL = "geothermal"
    BATTERY = "battery"
    OIL = "oil"
    OTHER = "other"


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", alias_generator=to_camel, populate_by_name=True)


Source = Literal["openstreetmap", "gem", "emodnet", "manual", "com"]
# EMODnet: free re-use, commercial or not, provided EMODnet and the primary sources are acknowledged.
# manual-sourced: a fact we entered by hand from a named public source, which the record must link to.
License = Literal["ODbL-1.0", "CC-BY-4.0", "CC-BY-NC-4.0", "EMODnet-open", "manual-sourced"]

# What a source id looks like, and which licences a source can carry.
_SOURCE_IDS: dict[str, re.Pattern[str]] = {
    "openstreetmap": re.compile(r"^(node|way|relation)/\d+$"),
    # GEM location id ("L1" + 11 digits), optionally narrowed to one status group of that location
    "gem": re.compile(r"^L1\d{11}(:(operating|construction|planned))?$"),
    # EMODnet layer and feature id
    "emodnet": re.compile(r"^(pipelines|windfarms|windfarmspoly)/[A-Za-z0-9_.:-]{1,80}$"),
    # the slug of an entry in overrides/datacenters.yaml
    "manual": re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$"),
    # Covenant of Mayors organisation id (JRC GCoM release)
    "com": re.compile(r"^[A-Za-z0-9_-]{1,40}$"),
}
_SOURCE_LICENSES: dict[str, frozenset[str]] = {
    "openstreetmap": frozenset({"ODbL-1.0"}),
    "gem": frozenset({"CC-BY-4.0", "CC-BY-NC-4.0"}),
    "emodnet": frozenset({"EMODnet-open"}),
    "manual": frozenset({"manual-sourced"}),
    # JRC GCoM datasets: European Commission reuse notice, CC BY 4.0 (copyright.txt in the release)
    "com": frozenset({"CC-BY-4.0"}),
}


class Provenance(_Model):
    source: Source
    source_id: str
    license: License
    retrieved_at: datetime
    url: str | None = None

    @model_validator(mode="after")
    def _check_source(self) -> Provenance:
        if not _SOURCE_IDS[self.source].match(self.source_id):
            raise ValueError(f"invalid {self.source} source id: {self.source_id!r}")
        if self.license not in _SOURCE_LICENSES[self.source]:
            raise ValueError(f"licence {self.license} is not possible for {self.source}")
        if self.url is not None and not self.url.startswith("https://"):
            raise ValueError("provenance url must be https")
        # A hand-entered fact is only as good as the source it names, so the link is not optional.
        if self.source == "manual" and self.url is None:
            raise ValueError("a manual record must name the public source it was taken from")
        return self


class _Asset(_Model):
    LAYER: ClassVar[str]

    id: Annotated[str, StringConstraints(min_length=3)]
    status: Status
    operator: str | None
    provenance: Annotated[tuple[Provenance, ...], Field(min_length=1)]

    def _properties(self) -> dict[str, Any]:
        props = self.model_dump(mode="json", by_alias=True, exclude={"geometry", "location", "parts"})
        props["layer"] = self.LAYER
        return props


class TransmissionLine(_Asset):
    LAYER: ClassVar[str] = "lines"

    kind: Literal["line", "cable"]
    voltages_kv: tuple[VoltageKv, ...]
    circuits: Annotated[int, Field(ge=1)] | None
    is_hvdc: bool
    countries: Annotated[tuple[CountryCode, ...], Field(min_length=1)]
    is_interconnector: bool
    geometry: Annotated[tuple[Coordinate, ...], Field(min_length=2)]

    @model_validator(mode="after")
    def _check_consistency(self) -> TransmissionLine:
        if self.voltages_kv != tuple(sorted(set(self.voltages_kv), reverse=True)):
            raise ValueError("voltages_kv must be unique and sorted in descending order")
        if self.is_interconnector != (len(self.countries) >= 2):
            raise ValueError("is_interconnector must be true exactly when the line touches 2+ countries")
        return self

    @property
    def max_voltage_kv(self) -> float | None:
        return self.voltages_kv[0] if self.voltages_kv else None

    def to_feature(self) -> dict[str, Any]:
        props = self._properties()
        props["maxVoltageKv"] = self.max_voltage_kv
        return {
            "type": "Feature",
            "id": self.id,
            "geometry": {"type": "LineString", "coordinates": [list(c) for c in self.geometry]},
            "properties": props,
        }


class Medium(StrEnum):
    GAS = "gas"
    OIL = "oil"
    OTHER = "other"
    UNKNOWN = "unknown"


class Pipeline(_Asset):
    """An offshore pipeline (EMODnet). Routes are often split into several parts."""

    LAYER: ClassVar[str] = "pipelines"

    name: str | None
    medium: Medium
    diameter_in: Annotated[float, Field(gt=0, le=200)] | None
    length_km: Annotated[float, Field(gt=0)] | None
    commissioning_year: Annotated[int, Field(ge=1900, le=2100)] | None
    countries: Annotated[tuple[CountryCode, ...], Field(min_length=1)]
    parts: Annotated[tuple[Annotated[tuple[Coordinate, ...], Field(min_length=2)], ...], Field(min_length=1)]

    def to_feature(self) -> dict[str, Any]:
        return {
            "type": "Feature",
            "id": self.id,
            "geometry": {
                "type": "MultiLineString",
                "coordinates": [[list(c) for c in part] for part in self.parts],
            },
            "properties": self._properties(),
        }


class Substation(_Asset):
    LAYER: ClassVar[str] = "substations"

    name: str | None
    voltages_kv: tuple[VoltageKv, ...]
    country: CountryCode
    location: Coordinate
    wikidata: WikidataId | None = None
    wikipedia: WikipediaTitle | None = None

    def to_feature(self) -> dict[str, Any]:
        props = self._properties()
        props["maxVoltageKv"] = self.voltages_kv[0] if self.voltages_kv else None
        return {
            "type": "Feature",
            "id": self.id,
            "geometry": {"type": "Point", "coordinates": list(self.location)},
            "properties": props,
        }


class PowerPlant(_Asset):
    LAYER: ClassVar[str] = "plants"

    name: str | None
    technology: Technology
    capacity_mw: Annotated[float, Field(ge=0)] | None
    commissioning_year: Annotated[int, Field(ge=1850, le=2100)] | None
    country: CountryCode
    location: Coordinate
    wikidata: WikidataId | None = None
    wikipedia: WikipediaTitle | None = None

    def to_feature(self) -> dict[str, Any]:
        return {
            "type": "Feature",
            "id": self.id,
            "geometry": {"type": "Point", "coordinates": list(self.location)},
            "properties": self._properties(),
        }


class DataCenter(_Asset):
    """A data centre. ``power_mw`` is the connected or IT load **as published**; it is never estimated,
    because an estimate on a map reads like a measurement."""

    LAYER: ClassVar[str] = "datacenters"

    name: str | None
    power_mw: Annotated[float, Field(gt=0)] | None
    commissioning_year: Annotated[int, Field(ge=1850, le=2100)] | None
    country: CountryCode
    location: Coordinate

    def to_feature(self) -> dict[str, Any]:
        return {
            "type": "Feature",
            "id": self.id,
            "geometry": {"type": "Point", "coordinates": list(self.location)},
            "properties": self._properties(),
        }


class ChargingStation(_Asset):
    """A place where electric vehicles charge.

    Only what OSM states consistently: ``points`` is the ``capacity`` tag (how many vehicles can charge
    at once). Charging power is deliberately absent: in OSM it is spread over ``socket:*`` keys in too
    many shapes to turn into one honest number.
    """

    LAYER: ClassVar[str] = "chargers"

    name: str | None
    points: Annotated[int, Field(ge=1)] | None
    country: CountryCode
    location: Coordinate

    def to_feature(self) -> dict[str, Any]:
        return {
            "type": "Feature",
            "id": self.id,
            "geometry": {"type": "Point", "coordinates": list(self.location)},
            "properties": self._properties(),
        }


class ExtractionKind(StrEnum):
    """What kind of place takes a resource out of the ground, by its OSM tag."""

    PLATFORM = "platform"  # man_made=offshore_platform
    WELL = "well"  # man_made=petroleum_well
    MINE = "mine"  # industrial=mine
    SHAFT = "shaft"  # man_made=mineshaft
    ADIT = "adit"  # man_made=adit
    QUARRY = "quarry"  # landuse=quarry, kept only when it digs an energy resource


class Substance(StrEnum):
    OIL = "oil"
    GAS = "gas"
    OIL_GAS = "oil_gas"
    COAL = "coal"
    LIGNITE = "lignite"
    PEAT = "peat"
    URANIUM = "uranium"
    OTHER = "other"
    UNKNOWN = "unknown"


ENERGY_SUBSTANCES: frozenset[Substance] = frozenset(
    {
        Substance.OIL,
        Substance.GAS,
        Substance.OIL_GAS,
        Substance.COAL,
        Substance.LIGNITE,
        Substance.PEAT,
        Substance.URANIUM,
    }
)


class ExtractionSite(_Asset):
    """A place where oil, gas or coal is taken out of the ground, as OpenStreetMap maps it.

    Only where, never how much: no open source measures the output of a single well or mine, so the
    record carries no production figure at all rather than an estimate. ``status`` says only that the
    object is not tagged as disused or abandoned.
    """

    LAYER: ClassVar[str] = "extraction"

    name: str | None
    kind: ExtractionKind
    substance: Substance
    country: CountryCode
    location: Coordinate

    def to_feature(self) -> dict[str, Any]:
        return {
            "type": "Feature",
            "id": self.id,
            "geometry": {"type": "Point", "coordinates": list(self.location)},
            "properties": self._properties(),
        }


Asset = TransmissionLine | Substation | PowerPlant | Pipeline | DataCenter | ChargingStation | ExtractionSite


class Sector(StrEnum):
    """Energy consumption sectors of the Covenant of Mayors inventory template."""

    MUNICIPAL_BUILDINGS = "municipal_buildings"
    TERTIARY = "tertiary"
    RESIDENTIAL = "residential"
    PUBLIC_LIGHTING = "public_lighting"
    INDUSTRY = "industry"
    MUNICIPAL_FLEET = "municipal_fleet"
    PUBLIC_TRANSPORT = "public_transport"
    PRIVATE_TRANSPORT = "private_transport"
    #: all transport together, for releases that do not split it into the three above
    TRANSPORT = "transport"
    OTHER = "other"


class SectorEnergy(_Model):
    """Final energy consumption of one sector in one inventory year, in MWh."""

    electricity_mwh: Annotated[float, Field(ge=0)]
    total_mwh: Annotated[float, Field(ge=0)]


class CityEnergy(_Model):
    """What a city reported to the Covenant of Mayors: final energy consumption by sector, for its most
    recent inventory year. A register, not a meter: the year is part of the record, and a city without
    an inventory is absent rather than zero."""

    LAYER: ClassVar[str] = "cities"

    id: Annotated[str, StringConstraints(min_length=5)]
    name: str
    country: CountryCode
    location: Coordinate
    population: Annotated[int, Field(gt=0)] | None
    inventory_year: Annotated[int, Field(ge=1990, le=2100)]
    #: True when the reported inventory is the baseline (BEI), not a monitoring one (MEI)
    baseline: bool
    sectors: dict[Sector, SectorEnergy]
    electricity_mwh: Annotated[float, Field(ge=0)]
    total_mwh: Annotated[float, Field(ge=0)]
    #: the baseline year and its electricity, when a later monitoring inventory is the one shown
    baseline_year: Annotated[int, Field(ge=1990, le=2100)] | None
    baseline_electricity_mwh: Annotated[float, Field(ge=0)] | None
    provenance: Annotated[tuple[Provenance, ...], Field(min_length=1)]

    @model_validator(mode="after")
    def _check_totals(self) -> CityEnergy:
        if not self.sectors:
            raise ValueError("a city record needs at least one sector")
        for sector, energy in self.sectors.items():
            if energy.electricity_mwh > energy.total_mwh + 1e-6:
                raise ValueError(f"{sector}: electricity exceeds the total")
        if self.baseline and (self.baseline_year is not None or self.baseline_electricity_mwh is not None):
            raise ValueError("a baseline inventory carries no separate baseline figures")
        return self

    def to_feature(self) -> dict[str, Any]:
        props = self.model_dump(mode="json", by_alias=True, exclude={"location"})
        props["layer"] = self.LAYER
        return {
            "type": "Feature",
            "id": self.id,
            "geometry": {"type": "Point", "coordinates": list(self.location)},
            "properties": props,
        }
