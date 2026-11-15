"""Read the Global Energy Monitor Global Integrated Power Tracker (GIPT) export.

GEM publishes one row per generating unit or project phase. Column names have changed between releases
(for example "Country" became "Country/Area" in 2024), so every accepted spelling lives in ``COLUMNS``.
An unknown layout fails with the list of missing fields *and* the headers that were found, which makes
adapting to a new release a one-line change.
"""

from __future__ import annotations

import csv
import re
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import openpyxl

# canonical field → accepted header spellings (compared case- and whitespace-insensitively)
COLUMNS: dict[str, tuple[str, ...]] = {
    "unit_id": ("GEM unit/phase ID", "GEM unit ID", "GEM phase ID"),
    "location_id": ("GEM location ID",),
    "country": ("Country/Area", "Country/area", "Country"),
    "plant_name": ("Plant / Project name", "Project Name", "Plant name", "Project name"),
    "unit_name": ("Unit / Phase name", "Unit name", "Phase name"),
    "type": ("Type",),
    "technology": ("Technology",),
    "fuel": ("Fuel",),
    "capacity_mw": ("Capacity (MW)",),
    "status": ("Status",),
    "start_year": ("Start year",),
    "retired_year": ("Retired year",),
    "operator": ("Operator(s)", "Operator"),
    "owner": ("Owner(s)", "Owner"),
    "latitude": ("Latitude",),
    "longitude": ("Longitude",),
    "location_accuracy": ("Location accuracy",),
    "wiki_url": ("Wiki URL", "GEM wiki URL", "GEM Wiki URL"),
    "other_ids": ("Other IDs (unit/phase)", "Other IDs (location)", "Other IDs"),
}
REQUIRED: frozenset[str] = frozenset(
    {
        "unit_id",
        "location_id",
        "country",
        "plant_name",
        "type",
        "capacity_mw",
        "status",
        "latitude",
        "longitude",
    }
)
HEADER_SCAN_ROWS = 20


class GemFormatError(ValueError):
    """The file does not look like a GIPT export this code understands."""


def _key(header: Any) -> str:
    return re.sub(r"\s+", " ", str(header or "")).strip().casefold()


_LOOKUP: dict[str, str] = {_key(alias): field for field, aliases in COLUMNS.items() for alias in aliases}


@dataclass(frozen=True, slots=True)
class Layout:
    """Which column index holds which canonical field."""

    positions: Mapping[str, int]
    headers: tuple[str, ...]


def detect_layout(headers: Sequence[Any]) -> Layout | None:
    positions: dict[str, int] = {}
    for index, header in enumerate(headers):
        field = _LOOKUP.get(_key(header))
        if field is not None and field not in positions:
            positions[field] = index
    if not positions.keys() >= REQUIRED:
        return None
    return Layout(positions, tuple(str(h or "") for h in headers))


def _missing_message(source: str, candidates: list[Sequence[Any]]) -> str:
    best = max(candidates, key=lambda row: sum(_key(h) in _LOOKUP for h in row), default=[])
    found = {_LOOKUP[_key(h)] for h in best if _key(h) in _LOOKUP}
    headers = ", ".join(str(h) for h in best if h not in (None, ""))
    return (
        f"{source} is not a recognised GEM power tracker export. "
        f"Missing fields: {', '.join(sorted(REQUIRED - found))}. "
        f"Headers found: {headers or '(none)'}. "
        "Add the new spellings to energymap.gem.read.COLUMNS."
    )


def _records(rows: Iterator[Sequence[Any]], layout: Layout) -> Iterator[dict[str, Any]]:
    for row in rows:
        if not any(cell not in (None, "") for cell in row):
            continue
        yield {field: (row[index] if index < len(row) else None) for field, index in layout.positions.items()}


def _read_xlsx(path: Path) -> Iterator[dict[str, Any]]:
    try:
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as exc:  # openpyxl raises many unrelated types for broken files
        raise GemFormatError(f"{path.name} cannot be opened as an Excel workbook: {exc}") from exc
    try:
        candidates: list[Sequence[Any]] = []
        for sheet in workbook.worksheets:
            rows = sheet.iter_rows(values_only=True)
            # the header is usually the first row, but tolerate a few title rows above it
            for _ in range(HEADER_SCAN_ROWS):
                header = next(rows, None)
                if header is None:
                    break
                layout = detect_layout(header)
                if layout is not None:
                    yield from _records(rows, layout)
                    return
                candidates.append(header)
        raise GemFormatError(_missing_message(path.name, candidates))
    finally:
        workbook.close()


def _read_csv(path: Path) -> Iterator[dict[str, Any]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = csv.reader(handle)
        header = next(rows, [])
        layout = detect_layout(header)
        if layout is None:
            raise GemFormatError(_missing_message(path.name, [header]))
        yield from _records(rows, layout)


def read_units(path: Path) -> Iterator[dict[str, Any]]:
    """Unit rows with canonical keys (see ``COLUMNS``); values are raw cell values."""
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xlsm"}:
        return _read_xlsx(path)
    if suffix == ".csv":
        return _read_csv(path)
    raise GemFormatError(f"{path.name}: expected .xlsx or .csv")
