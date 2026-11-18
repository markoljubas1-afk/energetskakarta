/**
 * The carbon footprint of what a country's plants generated in an hour, in grams of CO2 equivalent per
 * kilowatt-hour, for the green card (decision 2026-11-18).
 *
 * The same calculation and the same factors as everywhere else on the site (data/co2.ts: the mix card,
 * the monthly reports, the transition page), so one hour never has two footprints. It is a CALCULATION,
 * not a measurement: the hour's generation by source (ENTSO-E) times one factor per technology, the
 * life-cycle medians of IPCC AR5 (2014), Working Group III, Annex III, table A.III.2. What follows:
 *  - The table has one figure for coal. Lignite, which Serbia, Bosnia and Herzegovina, Montenegro and
 *    Slovenia burn, emits more per kWh than that, so their footprint is probably understated.
 *  - The table has no figure for oil or for unclassified generation: co2.ts assumes 650 and 700 g/kWh,
 *    and the card says that these two are assumptions.
 *  - Pumped storage and batteries give back electricity taken from the grid earlier; they are not a source.
 *  - Imports are not counted, as in the green share: this is the footprint of domestic generation.
 */
import { isOneOf, TECHNOLOGIES, type Technology } from "../domain";
import { intensity } from "./co2";
import type { Live } from "./live";

export const FACTORS_SOURCE = {
  name: "IPCC AR5 (2014), WG III, Annex III",
  url: "https://www.ipcc.ch/site/assets/uploads/2018/02/ipcc_wg3_ar5_annex-iii.pdf",
} as const;

/** The sources whose plants the card offers to show: where nearly all of the footprint comes from. */
const FOSSIL: readonly Technology[] = ["lignite", "coal", "gas"];

/** The figure is shown to the nearest ten grams: the factors do not carry more precision than that. */
export const ROUND_TO_G = 10;

export interface Carbon {
  /** grams of CO2 equivalent per kWh of the hour's generation, storage aside */
  gPerKwh: number;
  /** fossil sources that generated in the hour, largest first */
  fossil: Technology[];
}

/** The footprint of one country's generation in one hour; null when it reported nothing countable. */
export function carbonAt(live: Live, country: string, index: number): Carbon | null {
  const byTechnology = live.generation?.[country];
  if (!byTechnology) return null;
  const parts: [Technology, number][] = [];
  for (const [technology, values] of Object.entries(byTechnology)) {
    const mw = values[index];
    if (mw === null || mw === undefined || mw <= 0 || !isOneOf(TECHNOLOGIES, technology)) continue;
    parts.push([technology, mw]);
  }
  const gPerKwh = intensity(parts);
  if (gPerKwh === null) return null;
  return {
    gPerKwh,
    fossil: parts
      .filter(([technology]) => FOSSIL.includes(technology))
      .sort((a, b) => b[1] - a[1])
      .map(([technology]) => technology),
  };
}

/** The figure as it is shown: to the nearest ten grams. */
export function shownGrams(carbon: Carbon): number {
  return Math.round(carbon.gPerKwh / ROUND_TO_G) * ROUND_TO_G;
}
