"""Download and read the three GCoM Excel files of one release.

The files are found by listing the release folder, because their names are irregular from release to
release (spaces, non-breaking spaces, ``_final_`` suffixes). Sheets are found by the prefix of their
name **and** their header: the first sheet with that prefix whose header carries the required columns.
Releases open with README and metadata sheets and name the data sheets "1", "2", "2D_1"..., so neither
the position nor the name alone identifies a sheet. An unexpected layout fails with what was found, so
that adapting to a new release is a change to the layouts below with a test, never a silent zero.
"""

from __future__ import annotations

import html
import re
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urljoin

import httpx
import openpyxl

from energymap.files import write_json_atomic

BASE_URL = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GCOM-MyCovenant/"
DATASET_URL = "https://data.jrc.ec.europa.eu/collection/CoM"
META_FILE = "cities.json"
#: file kinds and the prefix that identifies each in a release folder
FILE_PREFIXES: dict[str, str] = {"signatories": "df1_", "plans": "df2_", "monitoring": "df3_"}


class CitiesFormatError(ValueError):
    """The files do not have the layout this code understands."""


class CitiesDownloadError(RuntimeError):
    pass


# ---------------------------------------------------------------- layout


@dataclass(frozen=True, slots=True)
class SheetLayout:
    """The first sheet whose name starts with ``prefix`` and whose header provides the ``required``
    canonical fields (``columns``: field → header spellings)."""

    prefix: str
    columns: Mapping[str, tuple[str, ...]]
    required: frozenset[str]


SIGNATORIES = SheetLayout(
    prefix="",  # any sheet: "1" in the 7th release, after README and df1_METADATA
    columns={
        "organisation_id": ("organisation_id",),
        "name": ("organisation_name",),
        "country": ("country_code",),
        "population": ("population_adhesion", "population"),
        "lon": ("organisation_longitude", "longitude"),
        "lat": ("organisation_latitude", "latitude"),
        "status": ("signatory_status",),
    },
    required=frozenset({"organisation_id", "name", "country", "lon", "lat"}),
)

_INVENTORY_COLUMNS: dict[str, tuple[str, ...]] = {
    "organisation_id": ("organisation_id",),
    "plan_id": ("action_plan_id", "monitoring_report_id"),
    "inventory_id": ("emission_inventory_id",),
    "baseline": ("baseline_flag", "baseline_year_flag"),
    "year": ("inventory_year",),
    "population": ("population", "population_in_the_inventory_year"),
    "sector": ("sector", "activity sector", "aggregated_sector"),
    "carrier": ("carrier", "type of energy carrier used", "energy_carrier", "aggregated_carrier"),
    "unit": ("activity_reporting_unit",),
    "energy": ("energy_measure",),
}
_INVENTORY_REQUIRED = frozenset({"plan_id", "year", "sector", "carrier", "energy"})
PLAN_INVENTORIES = SheetLayout("2D_1", _INVENTORY_COLUMNS, _INVENTORY_REQUIRED)
MONITORING_INVENTORIES = SheetLayout("3D_1", _INVENTORY_COLUMNS, _INVENTORY_REQUIRED)
#: sheets that tie a plan or report to its organisation, for files whose inventory sheet lacks the id
#: ("2" and "3" in the 7th release; "2A_1 ..." and "3A ..." in the layout of the data paper)
PLAN_LINK = SheetLayout(
    "2",
    {"organisation_id": ("organisation_id",), "plan_id": ("action_plan_id",)},
    frozenset({"organisation_id", "plan_id"}),
)
MONITORING_LINK = SheetLayout(
    "3",
    {"organisation_id": ("organisation_id",), "plan_id": ("monitoring_report_id",)},
    frozenset({"organisation_id", "plan_id"}),
)
HEADER_SCAN_ROWS = 10


def _key(header: Any) -> str:
    return re.sub(r"\s+", " ", str(header or "")).strip().casefold()


def _positions(layout: SheetLayout, headers: Sequence[Any]) -> dict[str, int] | None:
    lookup = {_key(alias): name for name, aliases in layout.columns.items() for alias in aliases}
    found: dict[str, int] = {}
    for index, header in enumerate(headers):
        name = lookup.get(_key(header))
        if name is not None and name not in found:
            found[name] = index
    return found if found.keys() >= layout.required else None


def _header(sheet: Any, layout: SheetLayout) -> tuple[Any, dict[str, int] | None, list[Sequence[Any]]]:
    """The sheet's rows positioned after its header, the header's column positions (None when no row
    among the first ``HEADER_SCAN_ROWS`` provides the required fields) and the rows that were looked at."""
    rows = sheet.iter_rows(values_only=True)
    seen: list[Sequence[Any]] = []
    for _ in range(HEADER_SCAN_ROWS):
        header = next(rows, None)
        if header is None:
            break
        positions = _positions(layout, header)
        if positions is not None:
            return rows, positions, seen
        seen.append(header)
    return rows, None, seen


def _describe(seen: Sequence[Sequence[Any]]) -> str:
    return "; ".join(", ".join(str(h) for h in row if h not in (None, "")) for row in seen) or "(none)"


def read_sheet(path: Path, layout: SheetLayout) -> Iterator[dict[str, Any]]:
    """Rows of the sheet as canonical-field dicts (missing optional fields are None)."""
    try:
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as exc:  # openpyxl raises many unrelated types for broken files
        raise CitiesFormatError(f"{path.name} cannot be opened as an Excel workbook: {exc}") from exc
    try:
        candidates = [sheet for sheet in workbook.worksheets if sheet.title.startswith(layout.prefix)]
        if not candidates:
            names = [sheet.title for sheet in workbook.worksheets]
            raise CitiesFormatError(f"{path.name}: no sheet starting with {layout.prefix!r}; sheets: {names}")
        rejected: list[str] = []
        for sheet in candidates:
            rows, positions, seen = _header(sheet, layout)
            if positions is None:
                rejected.append(f"sheet {sheet.title!r} headers found: {_describe(seen)}")
                continue
            for row in rows:
                if not any(cell not in (None, "") for cell in row):
                    continue
                yield {name: (row[index] if index < len(row) else None) for name, index in positions.items()}
            return
        raise CitiesFormatError(
            f"{path.name} has no sheet with {sorted(layout.required)}; "
            f"{' | '.join(rejected)}. Adjust energymap.cities.read layouts."
        )
    finally:
        workbook.close()


def inspect(path: Path) -> dict[str, list[str]]:
    """Sheet names and their first non-empty row, for adapting the layout to a new release."""
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        result: dict[str, list[str]] = {}
        for sheet in workbook.worksheets:
            for row in sheet.iter_rows(values_only=True, max_row=HEADER_SCAN_ROWS):
                if any(cell not in (None, "") for cell in row):
                    result[sheet.title] = [str(cell) for cell in row if cell not in (None, "")]
                    break
            else:
                result[sheet.title] = []
        return result
    finally:
        workbook.close()


# ---------------------------------------------------------------- download


@dataclass(frozen=True, slots=True)
class ReleaseFiles:
    release: str
    files: Mapping[str, Path]  # kind → local file
    fetched_at: str
    urls: Mapping[str, str] = field(default_factory=dict)


_HREF = re.compile(r'href="([^"]+)"', re.IGNORECASE)


def list_release(client: httpx.Client, release: str, base_url: str = BASE_URL) -> dict[str, str]:
    """kind → absolute URL of the three files, from the folder's index page."""
    folder = urljoin(base_url, f"{release}/")
    response = client.get(folder)
    if response.status_code != 200:
        raise CitiesDownloadError(f"{folder} returned HTTP {response.status_code}")
    found: dict[str, str] = {}
    for href in _HREF.findall(response.text):
        name = unquote(html.unescape(href))
        if not name.lower().endswith(".xlsx"):
            continue
        for kind, prefix in FILE_PREFIXES.items():
            if name.startswith(prefix) and kind not in found:
                found[kind] = urljoin(folder, href)
    missing = sorted(set(FILE_PREFIXES) - set(found))
    if missing:
        raise CitiesDownloadError(f"{folder} lists no file for: {', '.join(missing)}")
    return found


def latest_release(client: httpx.Client, base_url: str = BASE_URL) -> str:
    """The newest release folder ("2025_Sixth_release"), by the year that starts its name."""
    response = client.get(base_url)
    if response.status_code != 200:
        raise CitiesDownloadError(f"{base_url} returned HTTP {response.status_code}")
    folders = [
        unquote(href).strip("/")
        for href in _HREF.findall(response.text)
        if re.match(r"^\d{4}_[A-Za-z]+_release/$", unquote(href))
    ]
    if not folders:
        raise CitiesDownloadError(f"{base_url} lists no release folders")
    return max(folders, key=lambda name: int(name[:4]))


def download(
    client: httpx.Client, target_dir: Path, release: str | None = None, fetched_at: str = ""
) -> ReleaseFiles:
    """Fetch the three files of ``release`` (default: the newest) into ``target_dir``."""
    chosen = release or latest_release(client)
    urls = list_release(client, chosen)
    target_dir.mkdir(parents=True, exist_ok=True)
    files: dict[str, Path] = {}
    for kind, url in urls.items():
        target = target_dir / f"{kind}.xlsx"
        with client.stream("GET", url) as response:
            if response.status_code != 200:
                raise CitiesDownloadError(f"{url} returned HTTP {response.status_code}")
            with target.open("wb") as handle:
                for chunk in response.iter_bytes():
                    handle.write(chunk)
        files[kind] = target
    write_json_atomic(
        target_dir / META_FILE,
        {
            "release": chosen,
            "fetchedAt": fetched_at,
            "urls": urls,
            "licence": "CC-BY-4.0",
            "dataset": DATASET_URL,
        },
    )
    return ReleaseFiles(chosen, files, fetched_at, urls)
