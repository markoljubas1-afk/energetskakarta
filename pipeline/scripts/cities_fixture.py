"""A tiny, invented Covenant of Mayors release in the layout ``energymap.cities.read`` expects.

Used by the tests and by ``web_fixture.py``. Every number here is made up; the sheet and column names
follow the GCoM data paper (Scientific Data, 2024) so the reader is exercised on the real layout.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import openpyxl

RELEASE = "2025_Sixth_release"

SIGNATORIES: list[list[Any]] = [
    [
        "organisation_id",
        "organisation_name",
        "country_code",
        "population_adhesion",
        "organisation_longitude",
        "organisation_latitude",
        "signatory_status",
    ],
    [1001, "Grad Primjer", "HR", 120000, 16.0, 45.5, "active"],
    [1002, "Mesto Vzorec", "SVN", 8000, 14.6, 46.1, "active"],
    [1003, "Beispielstadt", "DE", 50000, 10.0, 50.0, "active"],  # outside the region
    [1004, "Grad Bez Inventara", "HR", 30000, 15.2, 45.9, "active"],  # signed, never reported
    [1005, "Città Esempio", "IT", 400000, 12.3, 45.4, "active"],
]

PLAN_COMMITMENTS: list[list[Any]] = [
    ["organisation_id", "action_plan_id", "co2_target", "base_year", "target_year"],
    [1001, 501, 40, 2011, 2030],
    [1002, 502, 20, 2015, 2020],
    [1003, 503, 40, 2010, 2030],
    [1005, 505, 40, 2012, 2030],
]

_INV_HEADER = [
    "action_plan_id",
    "emission_inventory_id",
    "baseline_flag",
    "inventory_year",
    "population",
    "sector",
    "carrier",
    "activity_reporting_unit",
    "energy_measure",
    "emission_factor_type",
    "emission_reporting_unit",
    "emission_measure",
]


def _inv(
    plan: int, inv: int, baseline: str, year: int, pop: int, rows: list[tuple[str, str, str, float]]
) -> list[list[Any]]:
    return [
        [plan, inv, baseline, year, pop, sector, carrier, unit, value, "IPCC", "tCO2", 0]
        for sector, carrier, unit, value in rows
    ]


PLAN_INVENTORIES: list[list[Any]] = [
    _INV_HEADER,
    *_inv(
        501,
        9001,
        "Yes",
        2011,
        118000,
        [
            ("Municipal buildings, equipment/facilities", "Electricity", "MWh/year", 12000),
            ("Municipal buildings, equipment/facilities", "Natural gas", "MWh/year", 20000),
            ("Public lighting", "Electricity", "MWh/year", 9000),
            ("Residential buildings", "Electricity", "MWh/year", 150000),
            ("Residential buildings", "Natural gas", "MWh/year", 300000),
            ("Public transport", "Diesel", "MWh/year", 25000),
            ("Public transport", "Electricity", "MWh/year", 4000),
            ("Private and commercial transport", "Diesel", "MWh/year", 500000),
        ],
    ),
    *_inv(
        502,
        9002,
        "Yes",
        2015,
        8000,
        [
            ("Public lighting", "Electricity", "GWh", 1.2),  # a different unit
            ("Residential buildings", "Electricity", "MWh/year", 15000),
            ("Something unusual", "Electricity", "MWh/year", 100),  # lands in "other"
        ],
    ),
    *_inv(503, 9003, "Yes", 2010, 50000, [("Public lighting", "Electricity", "MWh/year", 5000)]),
    *_inv(
        505,
        9005,
        "Yes",
        2012,
        390000,
        [
            ("Public lighting", "Electricity", "MWh/year", 40000),
            ("Tertiary (non municipal) buildings, equipment/facilities", "Electricity", "MWh/year", 600000),
            ("Industry", "Electricity", "MWh/year", 900000),
            ("Municipal fleet", "Diesel", "MWh/year", 3000),
            ("Public transport", "Electricity", "MWh/year", 20000),
            ("Bad row", "Electricity", "furlongs", 1),  # unusable unit, counted and skipped
        ],
    ),
]

MONITORING_REPORTS: list[list[Any]] = [
    ["organisation_id", "monitoring_report_id", "monitoring_report_type", "submission_timestamp"],
    [1001, 701, "full", "2021-03-01"],
]

MONITORING_INVENTORIES: list[list[Any]] = [
    [
        "monitoring_report_id",
        "emission_inventory_id",
        "inventory_year",
        "population",
        "sector",
        "carrier",
        "activity_reporting_unit",
        "energy_measure",
    ],
    *[
        [701, 9101, 2019, 121000, s, c, u, v]
        for s, c, u, v in [
            ("Municipal buildings, equipment/facilities", "Electricity", "MWh/year", 11000),
            ("Public lighting", "Electricity", "MWh/year", 6500),  # LED conversion
            ("Residential buildings", "Electricity", "MWh/year", 160000),
            ("Public transport", "Electricity", "MWh/year", 9000),
            ("Public transport", "Diesel", "MWh/year", 18000),
        ]
    ],
]


def _workbook(path: Path, sheets: dict[str, list[list[Any]]]) -> None:
    workbook = openpyxl.Workbook()
    first = workbook.active
    assert first is not None
    workbook.remove(first)
    for title, rows in sheets.items():
        sheet = workbook.create_sheet(title)
        for row in rows:
            sheet.append(row)
    workbook.save(path)


def write_fixture(directory: Path) -> Path:
    """Write signatories.xlsx, plans.xlsx, monitoring.xlsx and cities.json into ``directory``."""
    directory.mkdir(parents=True, exist_ok=True)
    _workbook(directory / "signatories.xlsx", {"Signatories": SIGNATORIES})
    _workbook(
        directory / "plans.xlsx",
        {
            "2A_1 Mitigation Commitments": PLAN_COMMITMENTS,
            "2D_1 Mitigation inventories": PLAN_INVENTORIES,
        },
    )
    _workbook(
        directory / "monitoring.xlsx",
        {"3A Monitoring Reports": MONITORING_REPORTS, "3D_1 Monitoring inventories": MONITORING_INVENTORIES},
    )
    (directory / "cities.json").write_text(
        json.dumps(
            {
                "release": RELEASE,
                "fetchedAt": "2026-09-19T00:00:00+00:00",
                "fixture": "invented values for development and tests",
                "licence": "CC-BY-4.0",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return directory


if __name__ == "__main__":
    import sys

    print(write_fixture(Path(sys.argv[1])))
