/**
 * Solar electricity per inhabitant in the shape `energymap eurostat solar-fetch` writes, with Eurostat's
 * real figures of 2026-11-19 for 2023 and 2024 (pipeline/tests/test_eurostat_solar_capita.py).
 */
import type { SolarCapita } from "./solarCapita";

type Row = [year: number, gwh: number, people: number, kwhPerPerson: number, populationFlag?: string];

const years = (rows: Row[]): SolarCapita["countries"][string] =>
  rows.map(([year, gwh, people, kwhPerPerson, populationFlag]) => ({
    year,
    gwh,
    people,
    kwhPerPerson,
    generationFlag: null,
    populationFlag: populationFlag ?? null,
  }));

export const SAMPLE_SOLAR_CAPITA: SolarCapita = {
  version: 1,
  source: "Eurostat",
  license: "CC-BY-4.0",
  generation: {
    dataset: "nrg_bal_peh",
    url: "https://ec.europa.eu/eurostat/databrowser/view/nrg_bal_peh/default/table",
    updated: "2026-06-02T23:00:00+02:00",
  },
  population: {
    dataset: "demo_gind",
    url: "https://ec.europa.eu/eurostat/databrowser/view/demo_gind/default/table",
    updated: "2026-10-27T23:00:00+01:00",
  },
  retrievedAt: "2026-11-19T20:00:00+00:00",
  year: 2024,
  countries: {
    HR: years([
      [2023, 413.1, 3856431, 107.1],
      [2024, 820, 3868159, 212],
    ]),
    SI: years([
      [2023, 984.359, 2120461, 464.2],
      [2024, 1268.145, 2127400, 596.1],
    ]),
    HU: years([
      [2023, 6925, 9592186, 721.9],
      [2024, 9200, 9562065, 962.1],
    ]),
    RS: years([
      [2023, 46.565, 6623183, 7],
      [2024, 162.68, 6586476, 24.7],
    ]),
    BA: years([
      [2023, 253, 3429142, 73.8, "p"],
      [2024, 601, 3411829, 176.2, "p"],
    ]),
    ME: years([
      [2023, 17.2, 620188, 27.7],
      [2024, 63.7, 623504, 102.2],
    ]),
    IT: years([
      [2023, 30711.082, 58984216, 520.7],
      [2024, 35993.103, 58957347, 610.5],
    ]),
    AT: years([
      [2023, 6888.539, 9131761, 754.3],
      [2024, 8143.267, 9177982, 887.3],
    ]),
  },
  flagLabels: { p: "provisional" },
};
