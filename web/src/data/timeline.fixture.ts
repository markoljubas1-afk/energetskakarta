/** A small hand-written timeline for unit tests: HR and SI, 1960–1964. */
import type { Timeline } from "./timeline";

export const SAMPLE_TIMELINE: Timeline = {
  version: 1,
  generatedAt: "2026-11-15T12:00:00+00:00",
  firstYear: 1960,
  lastYear: 1964,
  series: {
    HR: { hydro: [0, 576, 576, 576, 576], coal: [0, 0, 125, 125, 0] },
    SI: { hydro: [50, 50, 50, 50, 50] },
  },
  undated: { HR: { plants: 3, mw: 12 }, SI: { plants: 1, mw: 0 } },
  retired: [
    {
      id: "retired:L1",
      name: "TE Plomin 1",
      technology: "coal",
      country: "HR",
      capacityMw: 125,
      commissioningYear: 1962,
      retiredYear: 1964,
      lon: 14.17,
      lat: 45.14,
    },
  ],
};
