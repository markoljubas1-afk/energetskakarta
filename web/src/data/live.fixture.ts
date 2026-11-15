/** A small hand-written live document for unit tests (three hours). */
import type { Live } from "./live";

export const SAMPLE_LIVE: Live = {
  version: 1,
  generatedAt: "2026-09-16T10:12:00+00:00",
  timezone: "Europe/Zagreb",
  hours: ["2026-09-15T23:00:00+02:00", "2026-09-16T00:00:00+02:00", "2026-09-17T00:00:00+02:00"],
  flows: [
    { from: "SI", to: "HR", mw: [-200, null, 150] },
    { from: "HU", to: "HR", mw: [400, 380, 0] },
    { from: "XX", to: "HR", mw: [1, 1, 1] },
  ],
  prices: {
    HR: { zone: "10YHR-HEP------M", eurPerMwh: [95.5, 101.25, null] },
    IT_NORD: { zone: "10Y1001A1001A73I", eurPerMwh: [120, 118, 117] },
    IT_SUD: { zone: "10Y1001A1001A788", eurPerMwh: [99, 99, 99] },
  },
  missing: { flows: ["ME-BA"], prices: ["BA", "ME"] },
};
