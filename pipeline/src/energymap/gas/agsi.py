"""Gas in storage, from GIE's AGSI platform (Aggregated Gas Storage Inventory): step 1, a survey.

AGSI publishes, per storage facility, operator and country, how much gas is in storage at the end of a gas
day, how full that is, and what was injected and withdrawn (user manual "API access to AGSI / ALSI", v007).
Its data may be used and repackaged freely, on one condition: GIE is named as the source wherever the data
is shown (same manual, "API data usage").

The manual documents the answer's fields and the listing of datasets, but not the query that selects one
country or facility: the listing itself carries, for every dataset, the address to ask. So before a layer is
built on it, this module asks the listing what exists for the countries of the map and reads one day of each
dataset, and reports the real answer. It publishes nothing. The key comes from the environment
(``AGSI_API_KEY``) and is never written anywhere.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import urljoin

import httpx

log = logging.getLogger("energymap")

BASE_URL = "https://agsi.gie.eu/api"
LISTING_URL = f"{BASE_URL}/about"
KEY_ENV = "AGSI_API_KEY"
SOURCE = "GIE AGSI"
ATTRIBUTION = "GIE (Gas Infrastructure Europe), AGSI platform"
#: the fields of a day's row that the survey shows (manual, 2.3); the units are the platform's
SHOWN = (
    "gasDayStart",
    "gasInStorage",
    "full",
    "trend",
    "injection",
    "withdrawal",
    "workingGasVolume",
    "status",
)


class AgsiError(RuntimeError):
    """AGSI could not be read: no key, a refusal, or an answer that is not what the manual describes."""


def api_key() -> str:
    key = os.environ.get(KEY_ENV, "").strip()
    if not key:
        raise AgsiError(f"{KEY_ENV} is not set: AGSI answers only with a personal key (agsi.gie.eu/account)")
    return key


def _get(client: httpx.Client, url: str, key: str, params: dict[str, str | int] | None = None) -> Any:
    # the listing's addresses carry their own query, which httpx would replace with `params`: merge the two
    response = client.get(httpx.URL(url).copy_merge_params(params or {}), headers={"x-key": key})
    if response.status_code != 200:
        raise AgsiError(f"{url}: HTTP {response.status_code}")
    try:
        return response.json()
    except json.JSONDecodeError as exc:
        raise AgsiError(f"{url}: not JSON ({exc})") from exc


def _text(row: dict[str, Any], name: str) -> str:
    value = row.get(name)
    return value.strip() if isinstance(value, str) else ""


@dataclass(frozen=True, slots=True, order=True)
class Dataset:
    """One thing AGSI reports on: an operator's whole storage, or one of its facilities."""

    country: str
    company: str
    company_eic: str
    #: empty for the operator's own (aggregated) dataset
    facility: str
    facility_eic: str
    kind: str
    #: the address the listing gives for this dataset's data; empty when the listing has none
    url: str


def _companies(node: Any) -> list[dict[str, Any]]:
    """Every company in the listing, wherever it sits: the manual names its fields, not its nesting."""
    if isinstance(node, list):
        return [company for item in node for company in _companies(item)]
    if not isinstance(node, dict):
        return []
    if isinstance(node.get("facilities"), list) and "eic" in node:
        return [node]
    return [company for value in node.values() for company in _companies(value)]


def datasets(listing: Any, scope: frozenset[str]) -> list[Dataset]:
    """The storage datasets of the countries in ``scope``: each operator and each of its facilities."""
    found: set[Dataset] = set()
    for company in _companies(listing):
        if _text(company, "type").upper() not in ("SSO", ""):
            continue  # LNG terminals and transmission operators are not storage
        name = _text(company, "short_name") or _text(company, "name")
        country = _text(company, "country").upper()
        if country in scope:
            found.add(Dataset(country, name, _text(company, "eic"), "", "", "company", _text(company, "url")))
        for facility in company["facilities"]:
            if not isinstance(facility, dict):
                continue
            where = _text(facility, "country").upper() or country
            if where not in scope:
                continue
            found.add(
                Dataset(
                    where,
                    name,
                    _text(company, "eic"),
                    _text(facility, "name"),
                    _text(facility, "eic"),
                    _text(facility, "type") or "facility",
                    _text(facility, "url"),
                )
            )
    return sorted(found)


def latest_row(client: httpx.Client, key: str, url: str) -> tuple[dict[str, Any], list[str]]:
    """The first day's row of a dataset and the names of the answer's top-level fields."""
    answer = _get(client, urljoin(BASE_URL, url), key, {"size": 1})
    rows = answer.get("data") if isinstance(answer, dict) else None
    if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
        shape = sorted(answer) if isinstance(answer, dict) else type(answer).__name__
        raise AgsiError(f"{url}: no 'data' rows in the answer ({shape})")
    return rows[0], sorted(answer)


def survey(client: httpx.Client, now: datetime, scope: frozenset[str]) -> dict[str, Any]:
    """What AGSI has for the countries in ``scope``, with one day's figures of each dataset."""
    key = api_key()
    listing = _get(client, LISTING_URL, key, {"show": "listing"})
    found = datasets(listing, scope)
    if not found:
        raise AgsiError(
            f"the listing has no storage for {', '.join(sorted(scope))}: empty, or its shape changed"
        )
    row_fields: set[str] = set()
    answer_fields: set[str] = set()
    entries: list[dict[str, Any]] = []
    for dataset in found:
        entry: dict[str, Any] = {
            "country": dataset.country,
            "company": dataset.company,
            "companyEic": dataset.company_eic,
            "facility": dataset.facility,
            "facilityEic": dataset.facility_eic,
            "kind": dataset.kind,
            "url": dataset.url,
            "latest": None,
            "error": None,
        }
        # one dataset that fails is noted and the survey goes on (L-058)
        try:
            if not dataset.url:
                raise AgsiError("the listing gives no address for this dataset")
            row, top = latest_row(client, key, dataset.url)
            row_fields.update(row)
            answer_fields.update(top)
            entry["latest"] = {name: row.get(name) for name in SHOWN}
        except AgsiError as exc:
            log.warning("AGSI dataset unavailable", extra={"dataset": dataset.url, "error": str(exc)})
            entry["error"] = str(exc)[:200]
        entries.append(entry)
    log.info(
        "surveyed gas storage",
        extra={"datasets": len(entries), "with_data": sum(1 for e in entries if e["latest"] is not None)},
    )
    return {
        "generatedAt": now.isoformat(),
        "source": SOURCE,
        "attribution": ATTRIBUTION,
        "listingShape": type(listing).__name__
        + (": " + ", ".join(sorted(map(str, listing))[:12]) if isinstance(listing, dict) else ""),
        "answerFields": sorted(answer_fields),
        "rowFields": sorted(row_fields),
        "datasets": entries,
    }


def markdown(document: dict[str, Any]) -> str:
    """The survey as a table for the job summary."""
    lines = [
        "## Skladišta plina na AGSI-ju (pregled prije izrade sloja)",
        "",
        f"Izvor: {document['attribution']}. Oblik popisa: `{document['listingShape']}`.",
        "",
        "Polja odgovora: " + ", ".join(f"`{name}`" for name in document["answerFields"]),
        "",
        "Polja retka: " + ", ".join(f"`{name}`" for name in document["rowFields"]),
        "",
        "| Zemlja | Operator | Postrojenje | Vrsta | Dan | U skladištu (TWh) | Puno (%) | Utiskivanje | "
        "Povlačenje | Kapacitet (TWh) | Status | Adresa |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for entry in document["datasets"]:
        latest = entry["latest"] or {}
        cells = [
            entry["country"],
            entry["company"],
            entry["facility"] or "(sve)",
            entry["kind"],
            *(
                str(latest.get(name) if latest.get(name) is not None else "")
                for name in SHOWN
                if name != "trend"
            ),
            f"`{entry['url']}`" if entry["error"] is None else f"greška: {entry['error']}",
        ]
        lines.append("| " + " | ".join(cell.replace("|", "/") for cell in cells) + " |")
    return "\n".join(lines) + "\n"
