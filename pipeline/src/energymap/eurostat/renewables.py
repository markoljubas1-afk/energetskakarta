"""The official share of energy from renewable sources (Eurostat, ``nrg_ind_ren``), for the transition page.

Eurostat computes the shares that the Renewable Energy Directive counts (SHARES): overall, in gross final
energy consumption (``REN``), and for electricity (``REN_ELC``), heating and cooling (``REN_HEAT_CL``) and
transport (``REN_TRA``). The overall share is what Croatia's NECP target (42.5 % in 2030) is measured by. The
data are annual and come out about a year after the year (2024 on 2025-12-18), for the EU members and for the
Energy Community's contracting parties (Serbia, Bosnia and Herzegovina, Montenegro), sometimes a year later.

The Statistics API answers in JSON-stat 2.0: ``id`` names the dimensions in order and ``size`` gives their
lengths; ``dimension[d].category.index`` gives each code's position; ``value`` holds the cells, either as an
object keyed by the flat position (row-major, the last dimension fastest; Eurostat leaves out empty cells) or
as an array. ``status`` holds the flags (``p`` provisional, ``e`` estimated, ``b`` break in series …) in the
same way. The real answer could not be fetched where this was written (no network), so the reader follows the
specification and Eurostat's API documentation and accepts both forms. Anything else fails loudly, and nothing
is published.

Licence: CC BY 4.0; the source must be acknowledged (https://ec.europa.eu/eurostat/help/copyright-notice). A
customised extract is cited by the dataset's link, ``SOURCE_URL``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

from energymap.config import COUNTRIES
from energymap.publish import ObjectMeta, ObjectStore

log = logging.getLogger(__name__)

DATASET = "nrg_ind_ren"
API_URL = f"https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{DATASET}"
SOURCE = "Eurostat"
SOURCE_URL = f"https://ec.europa.eu/eurostat/databrowser/view/{DATASET}/default/table"
LICENSE = "CC-BY-4.0"
VERSION = 1

KEY = "eurostat/renewables.json"
# a few releases a year; an hour in caches is nothing
META = ObjectMeta("application/json; charset=utf-8", "public, max-age=3600, must-revalidate")

INDICATORS: tuple[str, ...] = ("REN", "REN_ELC", "REN_HEAT_CL", "REN_TRA")
OVERALL = "REN"
EU = "EU27_2020"
#: the map's countries in its own order, then the EU for comparison
GEOS: tuple[str, ...] = (*(country.code for country in COUNTRIES), EU)
HOME = "HR"
#: Croatia has data from 2004; far fewer years means a broken answer, not a short series
MIN_YEARS = 10
#: the electricity share can pass 100 % (a country that makes more renewable electricity than it uses)
MAX_SHARE = 200.0
#: dimensions the request fixes to one code each
FIXED = {"freq": "A", "unit": "PC"}


class EurostatSourceError(RuntimeError):
    """The API answered with an error or with something that is not the expected JSON-stat dataset."""


class EurostatDataError(ValueError):
    """The renewables document is not publishable."""


def query() -> tuple[tuple[str, str], ...]:
    """One request for everything: four indicators, nine areas, all years (14 categories; the limit is 50)."""
    return (
        ("format", "JSON"),
        ("lang", "EN"),
        *FIXED.items(),
        *(("nrg_bal", code) for code in INDICATORS),
        *(("geo", code) for code in GEOS),
    )


# ---------------------------------------------------------------- reading JSON-stat 2.0


@dataclass(frozen=True, slots=True)
class Cell:
    codes: dict[str, str]
    value: float | None
    flag: str | None


def _error_text(document: object) -> str | None:
    """Eurostat's error object (``{"error": …}``, or a JSON-stat ``class: error``), shortened for the log."""
    if isinstance(document, dict) and ("error" in document or document.get("class") == "error"):
        return json.dumps(document, ensure_ascii=False)[:300]
    return None


def _categories(dimension: object, name: str) -> list[str]:
    """The codes of one dimension, in position order."""
    category = dimension.get("category") if isinstance(dimension, dict) else None
    if not isinstance(category, dict):
        raise EurostatSourceError(f"dimension {name}: no categories")
    index = category.get("index")
    if isinstance(index, list) and all(isinstance(code, str) for code in index):
        return list(index)
    if isinstance(index, dict):
        positions = {
            code: position
            for code, position in index.items()
            if isinstance(position, int) and not isinstance(position, bool)
        }
        ordered = sorted(positions, key=positions.__getitem__)
        if len(positions) != len(index) or [positions[c] for c in ordered] != list(range(len(ordered))):
            raise EurostatSourceError(f"dimension {name}: positions are not 0 to {len(index) - 1}")
        return ordered
    # JSON-stat lets a dimension with a single category leave out the index
    labels = category.get("label")
    if index is None and isinstance(labels, dict) and len(labels) == 1:
        return [str(code) for code in labels]
    raise EurostatSourceError(f"dimension {name}: no category index")


def _by_position(field: object, total: int, name: str) -> dict[int, object]:
    """``value`` or ``status`` as position → entry, from an object keyed by position or an array."""
    if field is None:
        return {}
    if isinstance(field, list):
        if len(field) != total:
            raise EurostatSourceError(f"{name}: {len(field)} entries for {total} cells")
        return {position: entry for position, entry in enumerate(field) if entry is not None}
    if isinstance(field, dict):
        entries: dict[int, object] = {}
        for key, entry in field.items():
            try:
                position = int(key)
            except ValueError:
                raise EurostatSourceError(f"{name}: {key!r} is not a position") from None
            if not 0 <= position < total:
                raise EurostatSourceError(f"{name}: position {position} outside {total} cells")
            entries[position] = entry
        return entries
    if name == "status" and isinstance(field, str):  # one flag for every cell
        return dict.fromkeys(range(total), field)
    raise EurostatSourceError(f"{name}: neither an object nor an array")


def cells(document: object) -> Iterator[Cell]:
    """Every cell that has a value or a flag, with the code of each dimension."""
    error = _error_text(document)
    if error is not None:
        raise EurostatSourceError(f"the API answered with an error: {error}")
    if not isinstance(document, dict) or document.get("class") != "dataset":
        raise EurostatSourceError("the answer is not a JSON-stat dataset")
    ids, sizes, dimensions = document.get("id"), document.get("size"), document.get("dimension")
    if (
        not isinstance(ids, list)
        or not all(isinstance(name, str) for name in ids)
        or not isinstance(sizes, list)
        or not all(isinstance(size, int) and not isinstance(size, bool) and size >= 0 for size in sizes)
        or len(ids) != len(sizes)
        or not isinstance(dimensions, dict)
    ):
        raise EurostatSourceError("the dataset has no valid id, size and dimension")
    codes = [_categories(dimensions.get(name), name) for name in ids]
    if [len(options) for options in codes] != sizes:
        raise EurostatSourceError(f"dimension sizes {sizes} do not match the categories")
    total = math.prod(sizes)
    if total == 0:
        raise EurostatSourceError("the dataset is empty")
    values = _by_position(document.get("value"), total, "value")
    flags = _by_position(document.get("status"), total, "status")
    strides = [math.prod(sizes[i + 1 :]) for i in range(len(sizes))]
    for position in sorted(values.keys() | flags.keys()):
        rest, where = position, {}
        for name, options, stride in zip(ids, codes, strides, strict=True):
            where[name] = options[rest // stride]
            rest %= stride
        value = values.get(position)
        if value is not None and (
            not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value)
        ):
            raise EurostatSourceError(f"value at {where} is not a number: {value!r}")
        flag = flags.get(position)
        yield Cell(
            where,
            None if value is None else float(value),
            flag.strip() if isinstance(flag, str) and flag.strip() else None,
        )


# ---------------------------------------------------------------- the document for the site


def _year(code: str) -> int:
    if len(code) != 4 or not code.isdigit():
        raise EurostatSourceError(f"time {code!r} is not a year")
    return int(code)


def _updated(document: dict[str, Any]) -> str | None:
    """Eurostat's last update of the dataset ("2026-01-09T23:00:00+0100"), as ISO 8601."""
    raw = document.get("updated")
    if raw is None:
        return None
    try:
        return datetime.fromisoformat(str(raw)).isoformat()
    except ValueError:
        raise EurostatSourceError(f"updated is not a date: {raw!r}") from None


def _flag_labels(document: dict[str, Any], used: set[str]) -> dict[str, str]:
    """Eurostat's own words for the flags in use ("p": "provisional"), from ``extension.status.label``."""
    extension = document.get("extension")
    status = extension.get("status") if isinstance(extension, dict) else None
    labels = status.get("label") if isinstance(status, dict) else None
    if not isinstance(labels, dict):
        return {}
    return {flag: str(labels[flag]) for flag in sorted(used) if isinstance(labels.get(flag), str)}


def content_hash(years: Sequence[int], series: dict[str, Any], flags: dict[str, Any]) -> str:
    canonical = json.dumps({"years": years, "series": series, "flags": flags}, sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()


def renewables_document(answer: object, now: datetime) -> dict[str, Any]:
    """The shares by area, indicator and year, as arrays aligned with ``years`` (``None`` where none)."""
    if not isinstance(answer, dict):
        raise EurostatSourceError("the answer is not a JSON object")
    table: dict[str, dict[str, dict[int, float]]] = {}
    marks: dict[str, dict[str, dict[int, str]]] = {}
    for cell in cells(answer):
        for name, code in FIXED.items():
            if cell.codes.get(name, code) != code:
                raise EurostatSourceError(f"{name} is {cell.codes[name]!r}, expected {code!r}")
        geo, indicator, time = (cell.codes.get(name) for name in ("geo", "nrg_bal", "time"))
        if geo is None or indicator is None or time is None:
            raise EurostatSourceError("the dataset has no geo, nrg_bal or time dimension")
        if geo not in GEOS or indicator not in INDICATORS or cell.value is None:
            continue  # not asked for, or a flag without a value (":" not available)
        if not 0 <= cell.value <= MAX_SHARE:
            raise EurostatDataError(f"{geo} {indicator} {time}: {cell.value} % is not a share")
        year = _year(time)
        table.setdefault(geo, {}).setdefault(indicator, {})[year] = round(cell.value, 3)
        if cell.flag:
            marks.setdefault(geo, {}).setdefault(indicator, {})[year] = cell.flag
    found = [year for by_indicator in table.values() for by_year in by_indicator.values() for year in by_year]
    if not found:
        raise EurostatSourceError("the dataset has no values for the areas asked for")
    years = list(range(min(found), max(found) + 1))
    series = {
        geo: {
            indicator: [table[geo][indicator].get(year) for year in years]
            for indicator in INDICATORS
            if indicator in table[geo]
        }
        for geo in GEOS
        if geo in table
    }
    flags = {
        geo: {
            indicator: {str(year): flag for year, flag in sorted(by_year.items())}
            for indicator, by_year in marks[geo].items()
        }
        for geo in GEOS
        if geo in marks
    }
    used = {
        flag
        for by_indicator in flags.values()
        for by_year in by_indicator.values()
        for flag in by_year.values()
    }
    return {
        "version": VERSION,
        "dataset": DATASET,
        "source": SOURCE,
        "sourceUrl": SOURCE_URL,
        "license": LICENSE,
        "updated": _updated(answer),
        "retrievedAt": now.isoformat(),
        "indicators": list(INDICATORS),
        "years": years,
        "series": series,
        "flags": flags,
        "flagLabels": _flag_labels(answer, used),
        "missing": [geo for geo in GEOS if geo not in series],
        "contentHash": content_hash(years, series, flags),
    }


def fetch(client: httpx.Client) -> object:
    response = client.get(API_URL, params=query(), headers={"Accept": "application/json"}, timeout=60)
    try:
        body: object = response.json()
    except json.JSONDecodeError:
        body = None
    if response.status_code != 200:
        raise EurostatSourceError(f"HTTP {response.status_code}: {_error_text(body) or 'no error details'}")
    if body is None:
        raise EurostatSourceError("the answer is not JSON")
    return body


def collect(client: httpx.Client, now: datetime) -> dict[str, Any]:
    document = renewables_document(fetch(client), now)
    if document["missing"]:
        log.warning("areas without renewable shares", extra={"missing": document["missing"]})
    return document


# ---------------------------------------------------------------- validation and publishing


def last_year(document: dict[str, Any], geo: str = HOME, indicator: str = OVERALL) -> int | None:
    """The latest year with a value, e.g. Croatia's overall share."""
    series, years = document.get("series"), document.get("years")
    by_indicator = series.get(geo) if isinstance(series, dict) else None
    values = by_indicator.get(indicator) if isinstance(by_indicator, dict) else None
    if not isinstance(values, list) or not isinstance(years, list):
        return None
    present = [year for year, value in zip(years, values, strict=False) if value is not None]
    return max(present) if present else None


def validate(document: dict[str, Any]) -> None:
    if document.get("version") != VERSION or document.get("dataset") != DATASET:
        raise EurostatDataError(f"document must be version {VERSION} of {DATASET}")
    years = document.get("years")
    if (
        not isinstance(years, list)
        or not years
        or not all(isinstance(y, int) and not isinstance(y, bool) for y in years)
        or years != list(range(years[0], years[0] + len(years)))
    ):
        raise EurostatDataError("years must be consecutive whole years")
    series = document.get("series")
    if not isinstance(series, dict) or not set(series) <= set(GEOS):
        raise EurostatDataError(f"series must be keyed by {', '.join(GEOS)}")
    for geo, by_indicator in series.items():
        if not isinstance(by_indicator, dict) or not set(by_indicator) <= set(INDICATORS):
            raise EurostatDataError(f"{geo}: unknown indicators")
        for indicator, values in by_indicator.items():
            if not isinstance(values, list) or len(values) != len(years):
                raise EurostatDataError(f"{geo} {indicator}: not one value per year")
            for value in values:
                if value is not None and (
                    not isinstance(value, (int, float))
                    or isinstance(value, bool)
                    or not 0 <= value <= MAX_SHARE
                ):
                    raise EurostatDataError(f"{geo} {indicator}: {value!r} is not a share")
    home = series.get(HOME, {})
    if set(home) != set(INDICATORS):
        raise EurostatDataError(f"{HOME} must have all of {', '.join(INDICATORS)}")
    counted = sum(1 for value in home[OVERALL] if value is not None)
    if counted < MIN_YEARS:
        raise EurostatDataError(
            f"{HOME} has {counted} years of the overall share, expected at least {MIN_YEARS}"
        )
    flags = document.get("flags")
    if not isinstance(flags, dict):
        raise EurostatDataError("flags must be an object")
    for geo, by_indicator in flags.items():
        if not isinstance(by_indicator, dict):
            raise EurostatDataError(f"flags of {geo} must be an object")
        for indicator, by_year in by_indicator.items():
            if (
                indicator not in series.get(geo, {})
                or not isinstance(by_year, dict)
                or not all(
                    isinstance(flag, str) and str(year).isdigit() and int(year) in years
                    for year, flag in by_year.items()
                )
            ):
                raise EurostatDataError(f"flags of {geo} {indicator} do not match the series")
    if document.get("contentHash") != content_hash(years, series, flags):
        raise EurostatDataError("contentHash does not match the content")


def losses(published: dict[str, Any], document: dict[str, Any]) -> list[str]:
    """Every published area and indicator that the new document lost, or whose latest year went backwards."""
    found: list[str] = []
    series = published.get("series")
    if not isinstance(series, dict):
        return found
    for geo, by_indicator in series.items():
        if not isinstance(by_indicator, dict):
            continue
        for indicator in by_indicator:
            before = last_year(published, geo, indicator)
            after = last_year(document, geo, indicator)
            if before is not None and (after is None or after < before):
                found.append(f"{geo} {indicator}: {after} after {before}")
    return found


def publish_renewables(store: ObjectStore, document: dict[str, Any], *, allow_drop: bool = False) -> bool:
    """Validate, then replace the published document; ``False`` when nothing changed.

    A document that lost a published area or indicator, or whose latest year for any of them is older
    than the published one, is refused (a truncated answer, not a revision) unless ``allow_drop``, and the
    published document stays (Faza 31: the check covered only Croatia's overall share). The bucket decides
    (L-015).
    """
    validate(document)
    raw = store.get_bytes(KEY)
    if raw is not None:
        try:
            published = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise EurostatDataError(f"the published {KEY} is not JSON ({exc})") from exc
        if isinstance(published, dict):
            lost = losses(published, document)
            if lost and not allow_drop:
                shown = "; ".join(lost[:6]) + ("…" if len(lost) > 6 else "")
                raise EurostatDataError(
                    f"{len(lost)} published series lost their latest year ({shown}); "
                    "use --allow-drop if that is right"
                )
            if published.get("contentHash") == document["contentHash"] and published.get(
                "updated"
            ) == document.get("updated"):
                log.info("renewable shares unchanged", extra={"last_year": last_year(document)})
                return False
    store.put_bytes(KEY, json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode(), META)
    log.info(
        "published renewable shares",
        extra={
            "last_year": last_year(document),
            "areas": len(document["series"]),
            "missing": document.get("missing", []),
        },
    )
    return True
