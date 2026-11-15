"""Hand-kept geothermal sites (``overrides/geothermal.yaml``): every entry names its sources, and the whole
file is rejected if one entry breaks a rule, so a half-remembered record cannot slip in."""

from __future__ import annotations

from enum import StrEnum
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, ValidationError, model_validator


class GeothermalDataError(ValueError):
    """The curated file or the heat-flow download is not publishable."""


class Kind(StrEnum):
    POWER = "power"
    HEAT = "heat"


class Phase(StrEnum):
    OPERATING = "operating"
    PROJECT = "project"
    POTENTIAL_CONFIRMED = "potential_confirmed"
    EXPLORATION = "exploration"
    LOCAL_PROJECT = "local_project"


class Use(StrEnum):
    ELECTRICITY = "electricity"
    HEATING = "heating"
    GREENHOUSES = "greenhouses"
    SPA = "spa"


class Site(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    name: str = Field(min_length=2)
    place: str = Field(min_length=2)
    # Croatia and a margin: a typo in a coordinate must not put a site in another country
    lon: float = Field(ge=13.0, le=19.6)
    lat: float = Field(ge=42.3, le=46.6)
    kind: Kind
    status: Phase
    electric_mw: float | None = Field(default=None, gt=0, le=1000)
    thermal_mw: float | None = Field(default=None, gt=0, le=1000)
    temperature_c: float | None = Field(default=None, gt=0, le=350)
    note_hr: str | None = None
    note_en: str | None = None
    uses: tuple[Use, ...] = Field(min_length=1)
    sources: tuple[HttpUrl, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def _both_languages(self) -> Site:
        if (self.note_hr is None) != (self.note_en is None):
            raise ValueError("a note needs both note_hr and note_en")
        return self


class SiteFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(ge=1, le=1)
    reviewed: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    sites: tuple[Site, ...]


def load_sites(path: Path) -> SiteFile:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        parsed = SiteFile.model_validate(data)
    except (OSError, yaml.YAMLError, ValidationError) as exc:
        raise GeothermalDataError(f"{path}: {exc}") from exc
    ids = [site.id for site in parsed.sites]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    if duplicates:
        raise GeothermalDataError(f"{path}: duplicate ids {duplicates}")
    return parsed


def site_records(parsed: SiteFile) -> list[dict[str, Any]]:
    """The sites as published: camelCase, URLs as text, empty fields left out."""
    out = []
    for site in parsed.sites:
        record: dict[str, Any] = {
            "id": site.id,
            "name": site.name,
            "place": site.place,
            "lon": site.lon,
            "lat": site.lat,
            "kind": site.kind.value,
            "status": site.status.value,
            "uses": [use.value for use in site.uses],
            "sources": [str(url) for url in site.sources],
        }
        for key, value in (
            ("electricMw", site.electric_mw),
            ("thermalMw", site.thermal_mw),
            ("temperatureC", site.temperature_c),
            ("noteHr", site.note_hr),
            ("noteEn", site.note_en),
        ):
            if value is not None:
                record[key] = value
        out.append(record)
    return out
