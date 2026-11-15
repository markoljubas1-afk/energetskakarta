/** Live data with generation for the mix tests: HR, SI and HU report, RS does not. */
import type { Live } from "./live";

const hours = ["2026-09-16T10:00:00+02:00", "2026-09-16T11:00:00+02:00", "2026-09-16T12:00:00+02:00"];
export const MIX_LIVE: Live = {
  version: 1,
  generatedAt: "2026-09-16T12:30:00+02:00",
  timezone: "Europe/Zagreb",
  hours,
  // SI sends 300 MW to HR; HR sends 100 MW to BA; HU→HR has no value at 11:00
  flows: [
    { from: "SI", to: "HR", mw: [300, 300, 300] },
    { from: "BA", to: "HR", mw: [-100, -100, -100] },
    { from: "HU", to: "HR", mw: [200, null, 200] },
    { from: "RS", to: "HR", mw: [50, 50, 50] },
  ],
  prices: {},
  generation: {
    HR: { hydro: [600, 600, null], wind: [200, 200, null], solar: [0, 0, null] },
    SI: { nuclear: [500, 500, 500], hydro: [500, 500, 500] },
    HU: { gas: [1000, 1000, 1000] },
  },
  missing: { flows: [], prices: [], generation: ["RS"] },
};
