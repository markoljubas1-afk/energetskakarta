"""Yearly files of daily energy — the single source of truth for every time-based view.

    energy/daily/<year>.json    columnar: one array per value, aligned with "days"
    energy/periods.json         months and years, derived from the daily files at publish time

Merging keeps the better data: a day is replaced only if the new data covers at least as much of it
as the stored data (the platform sometimes returns less on a retry).
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from energymap.entsoe.energy import TIMEZONE, DailyEnergy, totals
from energymap.schema import Technology

VERSION = 1
UNIT = "MWh"


class EnergyDataError(ValueError):
    """A daily file is malformed."""


def year_days(year: int) -> list[date]:
    first = date(year, 1, 1)
    return [first + timedelta(days=i) for i in range((date(year + 1, 1, 1) - first).days)]


@dataclass(slots=True)
class CountryYear:
    generation: dict[str, list[float | None]] = field(default_factory=dict)
    consumption: dict[str, list[float | None]] = field(default_factory=dict)
    load: list[float | None] = field(default_factory=list)
    generation_coverage: list[float] = field(default_factory=list)
    load_coverage: list[float] = field(default_factory=list)
    areas: list[str] = field(default_factory=list)


@dataclass(slots=True)
class YearFile:
    year: int
    countries: dict[str, CountryYear] = field(default_factory=dict)

    @property
    def days(self) -> list[date]:
        return year_days(self.year)

    # -------------------------------------------------------------- merge

    def merge(self, country: str, energy: DailyEnergy, areas: Iterable[str]) -> int:
        """Merge one country's fresh data for this year. Returns the number of days that changed."""
        days = self.days
        n = len(days)
        target = self.countries.setdefault(
            country, CountryYear(load=[None] * n, generation_coverage=[0.0] * n, load_coverage=[0.0] * n)
        )
        target.areas = sorted(set(target.areas) | set(areas))
        changed = 0
        for i, day in enumerate(days):
            new_cov = energy.generation_coverage.get(day)
            if new_cov is not None and new_cov > 0 and new_cov >= target.generation_coverage[i]:
                for kind in ("generation", "consumption"):
                    columns: dict[str, list[float | None]] = getattr(target, kind)
                    values: Mapping[Technology, float] = getattr(energy, kind).get(day, {})
                    for tech in {*columns, *(t.value for t in values)}:
                        column = columns.setdefault(tech, [None] * n)
                        column[i] = values.get(Technology(tech))
                target.generation_coverage[i] = new_cov
                changed += 1
            load_cov = energy.load_coverage.get(day)
            if load_cov is not None and load_cov > 0 and load_cov >= target.load_coverage[i]:
                target.load[i] = energy.load.get(day)
                target.load_coverage[i] = load_cov
                changed += 1
        return changed

    # -------------------------------------------------------------- (de)serialisation

    def to_json(self) -> dict[str, Any]:
        return {
            "version": VERSION,
            "year": self.year,
            "unit": UNIT,
            "timezone": str(TIMEZONE),
            "days": [d.isoformat() for d in self.days],
            "countries": {
                code: {
                    "areas": c.areas,
                    "generation": dict(sorted(c.generation.items())),
                    "consumption": dict(sorted(c.consumption.items())),
                    "load": c.load,
                    "coverage": {"generation": c.generation_coverage, "load": c.load_coverage},
                }
                for code, c in sorted(self.countries.items())
            },
        }

    @classmethod
    def from_json(cls, data: Any) -> YearFile:
        if not isinstance(data, dict) or data.get("version") != VERSION or data.get("unit") != UNIT:
            raise EnergyDataError("unsupported daily energy file")
        year = data.get("year")
        if not isinstance(year, int):
            raise EnergyDataError("daily energy file without a year")
        result = cls(year)
        n = len(result.days)
        if data.get("days") != [d.isoformat() for d in result.days]:
            raise EnergyDataError(f"{year}: days do not match the calendar")
        for code, raw in (data.get("countries") or {}).items():
            coverage = raw.get("coverage") or {}
            country = CountryYear(
                generation={k: _values(v, n, f"{code} generation {k}") for k, v in raw["generation"].items()},
                consumption={
                    k: _values(v, n, f"{code} consumption {k}") for k, v in raw["consumption"].items()
                },
                load=_values(raw["load"], n, f"{code} load"),
                generation_coverage=_coverage(coverage.get("generation"), n, code),
                load_coverage=_coverage(coverage.get("load"), n, code),
                areas=[str(a) for a in raw.get("areas", [])],
            )
            unknown = set(country.generation) | set(country.consumption)
            unknown -= {t.value for t in Technology}
            if unknown:
                raise EnergyDataError(f"{code}: unknown technologies {sorted(unknown)}")
            result.countries[code] = country
        return result


def _values(raw: Any, n: int, what: str) -> list[float | None]:
    if not isinstance(raw, list) or len(raw) != n:
        raise EnergyDataError(f"{what}: expected {n} values")
    out: list[float | None] = []
    for value in raw:
        if value is None:
            out.append(None)
        elif isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value):
            out.append(float(value))
        else:
            raise EnergyDataError(f"{what}: invalid value {value!r}")
    return out


def _coverage(raw: Any, n: int, what: str) -> list[float]:
    values = _values(raw, n, f"{what} coverage")
    if any(v is None or not 0 <= v <= 1 for v in values):
        raise EnergyDataError(f"{what}: coverage must be between 0 and 1")
    return [float(v or 0.0) for v in values]


def periods(files: Iterable[YearFile]) -> dict[str, Any]:
    """Monthly and yearly totals per country, derived from the daily files."""
    ordered = sorted(files, key=lambda f: f.year)
    codes = sorted({code for f in ordered for code in f.countries})
    result: dict[str, Any] = {"version": VERSION, "unit": UNIT, "timezone": str(TIMEZONE), "countries": {}}
    for code in codes:
        days: list[date] = []
        n_total = 0
        generation: dict[str, list[float | None]] = {}
        consumption: dict[str, list[float | None]] = {}
        load: list[float | None] = []
        gen_cov: list[float] = []
        load_cov: list[float] = []
        for f in ordered:
            n = len(f.days)
            c = f.countries.get(code) or CountryYear(
                load=[None] * n, generation_coverage=[0.0] * n, load_coverage=[0.0] * n
            )
            for kind, target in (("generation", generation), ("consumption", consumption)):
                source: dict[str, list[float | None]] = getattr(c, kind)
                # every known technology grows by this year's days, so all columns stay aligned
                for tech in {*target, *source}:
                    target.setdefault(tech, [None] * n_total).extend(source.get(tech, [None] * n))
            days += f.days
            load += c.load
            gen_cov += c.generation_coverage
            load_cov += c.load_coverage
            n_total += n
        country: dict[str, Any] = {}
        for unit in ("month", "year"):
            t = totals(days, generation, consumption, load, gen_cov, load_cov, unit)
            country[f"{unit}s"] = {
                "periods": t.periods,
                "generation": dict(sorted(t.generation.items())),
                "consumption": dict(sorted(t.consumption.items())),
                "load": t.load,
                "coverage": {"generation": t.generation_coverage, "load": t.load_coverage},
            }
        result["countries"][code] = country
    return result
