"""The geothermal document for the map (``geothermal/current.json``): heat-flow potential and sites."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from energymap.geothermal import heatflow
from energymap.geothermal.sites import GeothermalDataError, SiteFile, load_sites, site_records
from energymap.publish import ObjectMeta, ObjectStore

log = logging.getLogger(__name__)

GEOTHERMAL_KEY = "geothermal/current.json"
# changes a few times a year: browsers and the edge may keep it for an hour
GEOTHERMAL_META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")


def collect(client: httpx.Client, sites_file: Path, now: datetime) -> dict[str, Any]:
    """Curated sites (checked first, so a broken file fails before any download) plus the heat-flow grid."""
    sites = load_sites(sites_file)
    response = client.get(heatflow.SOURCE_URL, timeout=120)
    response.raise_for_status()
    return document(sites, heatflow.read_workbook(response.content), now)


def document(sites: SiteFile, points: list[heatflow.Point] | None, now: datetime) -> dict[str, Any]:
    return {
        "version": 1,
        "generatedAt": now.isoformat(),
        "sitesReviewed": sites.reviewed,
        "sites": site_records(sites),
        "heatFlow": heatflow.heat_flow_document(points) if points is not None else None,
    }


def validate(doc: dict[str, Any]) -> None:
    if doc.get("version") != 1 or not doc.get("sites"):
        raise GeothermalDataError("geothermal document has no sites")
    flow = doc.get("heatFlow")
    if flow is not None and (not flow.get("cells") or any(len(cell) != 4 for cell in flow["cells"])):
        raise GeothermalDataError("geothermal document has an empty or malformed heat-flow grid")


def publish_geothermal(store: ObjectStore, doc: dict[str, Any]) -> None:
    """Validate, then replace the published document; a failed validation leaves the old one."""
    validate(doc)
    store.put_bytes(GEOTHERMAL_KEY, json.dumps(doc, separators=(",", ":")).encode(), GEOTHERMAL_META)
    flow = doc["heatFlow"]
    log.info(
        "published geothermal data",
        extra={"sites": len(doc["sites"]), "cells": len(flow["cells"]) if flow else 0},
    )
