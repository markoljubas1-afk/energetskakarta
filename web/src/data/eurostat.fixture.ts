/**
 * A renewables document in the shape `energymap eurostat fetch` writes (pipeline/tests/test_eurostat.py).
 * **The numbers are invented**: one point a year from a round start, so tests can work them out by hand.
 */
import type { Renewables } from "./eurostat";

const YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
/** start, start + 1, … over the eleven years */
const line = (start: number): (number | null)[] => YEARS.map((_, i) => Math.round((start + i) * 10) / 10);
/** the same, a year behind: no value in the last year */
const behind = (start: number): (number | null)[] => [...line(start).slice(0, -1), null];

export const SAMPLE_RENEWABLES: Renewables = {
  version: 1,
  dataset: "nrg_ind_ren",
  source: "Eurostat",
  sourceUrl: "https://ec.europa.eu/eurostat/databrowser/view/nrg_ind_ren/default/table",
  license: "CC-BY-4.0",
  updated: "2026-01-09T23:00:00+01:00",
  retrievedAt: "2026-11-15T04:17:00+00:00",
  indicators: ["REN", "REN_ELC", "REN_HEAT_CL", "REN_TRA"],
  years: YEARS,
  series: {
    // Croatia 2024: 34.1 % overall, 8.4 points short of 42.5 %
    HR: { REN: line(24.1), REN_ELC: line(45), REN_HEAT_CL: line(36), REN_TRA: line(2) },
    SI: { REN: line(20), REN_ELC: line(30), REN_HEAT_CL: line(30), REN_TRA: line(1) },
    // reports a year later
    BA: { REN: behind(40), REN_ELC: behind(70), REN_HEAT_CL: behind(50), REN_TRA: behind(0) },
    EU27_2020: { REN: line(15), REN_ELC: line(28), REN_HEAT_CL: line(18), REN_TRA: line(5) },
  },
  flags: { HR: { REN: { "2024": "p" }, REN_TRA: { "2020": "b" } } },
  flagLabels: { b: "break in time series", p: "provisional" },
  missing: ["HU", "RS", "ME", "IT", "AT"],
  contentHash: "0".repeat(64),
};
