"""Read a downloaded release into city records (the piece the build calls)."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from energymap.files import read_json
from energymap.schema import CityEnergy

from . import normalize, read


@dataclass(frozen=True, slots=True)
class Loaded:
    cities: list[CityEnergy]
    stats: Counter[str]
    release: str
    fetched_at: str | None


def load(
    directory: Path,
    scope: frozenset[str],
    retrieved_at: datetime,
    in_country: normalize.InCountry | None = None,
) -> Loaded:
    """``directory`` holds signatories.xlsx, plans.xlsx, monitoring.xlsx and cities.json (from
    ``read.download``); monitoring.xlsx is optional, since only some releases have inventories there.
    ``in_country`` checks each city's location against its country (see ``normalize.signatories``)."""
    meta_file = directory / read.META_FILE
    meta: dict[str, Any] = read_json(meta_file) if meta_file.exists() else {}
    release = str(meta.get("release") or directory.name)
    stats: Counter[str] = Counter()
    signatories = normalize.signatories(
        read.read_sheet(directory / "signatories.xlsx", read.SIGNATORIES), scope, stats, in_country
    )
    stats["signatories_in_scope"] = len(signatories)

    plans = directory / "plans.xlsx"
    plan_links = _links(plans, read.PLAN_LINK)
    inventories = normalize.inventories(
        read.read_sheet(plans, read.PLAN_INVENTORIES), plan_links, monitoring=False, stats=stats
    )
    monitoring = directory / "monitoring.xlsx"
    if monitoring.exists():
        inventories += normalize.inventories(
            read.read_sheet(monitoring, read.MONITORING_INVENTORIES),
            _links(monitoring, read.MONITORING_LINK),
            monitoring=True,
            stats=stats,
        )
    cities = normalize.build_cities(
        signatories, inventories, release=release, retrieved_at=retrieved_at, stats=stats
    )
    fetched = meta.get("fetchedAt")
    return Loaded(cities, stats, release, str(fetched) if fetched else None)


def _links(path: Path, layout: read.SheetLayout) -> dict[str, str]:
    """The plan → organisation table, or nothing when the file has no such sheet (then the inventory
    sheet must carry organisation_id itself; unlinked rows are counted, never guessed)."""
    try:
        return normalize.links(read.read_sheet(path, layout))
    except read.CitiesFormatError:
        return {}
