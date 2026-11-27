import type { Installed } from "./installed";

/**
 * Installed capacity shaped like the published document, with the ENTSO-E figures of the survey of
 * 2026-11-27 for Croatia (rounded) and Slovenia, which already has the next year.
 */
export const INSTALLED: Installed = {
  version: 1,
  source: "ENTSO-E Transparency Platform",
  sourceUrl: "https://transparency.entsoe.eu/",
  license: "ENTSO-E Transparency Platform terms of use",
  documentType: "A68",
  retrievedAt: "2026-11-27T12:00:00+00:00",
  year: 2026,
  countries: {
    HR: [
      {
        year: 2021,
        total: 3_100,
        mw: { hydro: 1_872, pumped_storage: 281, wind: 796, solar: 85, gas: 66 },
      },
      {
        year: 2025,
        total: 4_200,
        mw: { hydro: 1_874, pumped_storage: 281, wind: 1_240, solar: 450, gas: 355 },
      },
      {
        year: 2026,
        total: 4_640,
        mw: { hydro: 1_874, pumped_storage: 281, wind: 1_309, solar: 620, gas: 490, battery: 66 },
      },
    ],
    SI: [
      { year: 2026, total: 2_277, mw: { nuclear: 700, solar: 1_577 } },
      { year: 2027, total: 2_400, mw: { nuclear: 700, solar: 1_700 } },
    ],
  },
  contentHash: "0".repeat(64),
};
