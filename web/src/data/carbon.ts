/**
 * The carbon footprint of what a country's plants generated in an hour, in grams of CO2 equivalent per
 * kilowatt-hour (decision 2026-11-18).
 *
 * This is a CALCULATION, not a measurement, and the only figure on the map that is one: the hour's
 * generation by source (ENTSO-E, the same figures as the green share) times one published factor per
 * technology. Every text that shows it says so, names the source of the factors and says what is left out.
 *
 * The factors are the medians of life-cycle emissions in IPCC AR5 (2014), Working Group III, Annex III,
 * table A.III.2: one source, not a mix of sources. What follows from that:
 *  - The table has one figure for coal. Lignite, which Serbia, Bosnia and Herzegovina, Montenegro and
 *    Slovenia burn, emits more per kWh than that, so their footprint is probably understated.
 *  - The table has no figure for oil or for "other": they are left out, and when what is left out is more
 *    than a tenth of the hour's generation no footprint is given at all.
 *  - Pumped storage and batteries give back electricity taken from the grid earlier; they are not a source.
 *  - Imports are not counted, as in the green share: this is the footprint of domestic generation.
 */
import { isOneOf, TECHNOLOGIES, type Technology } from "../domain";
import type { Live } from "./live";

export const FACTORS_SOURCE = {
  name: "IPCC AR5 (2014), WG III, Annex III",
  url: "https://www.ipcc.ch/site/assets/uploads/2018/02/ipcc_wg3_ar5_annex-iii.pdf",
} as const;

/** g CO2-eq per kWh, life-cycle medians (table A.III.2). No entry: the table has no figure. */
export const FACTORS_G_PER_KWH: Partial<Record<Technology, number>> = {
  coal: 820,
  lignite: 820,
  gas: 490,
  biomass: 230,
  solar: 48,
  geothermal: 38,
  hydro: 24,
  nuclear: 12,
  wind: 11,
};

/** Gives back what it took from the grid: neither a source nor part of what has to be covered. */
const STORAGE: readonly Technology[] = ["pumped_storage", "battery"];
/** The sources whose plants the card offers to show: where nearly all of the footprint comes from. */
const FOSSIL: readonly Technology[] = ["lignite", "coal", "gas"];

/** Less of the hour's generation than this with a factor, and no footprint is given. */
export const MIN_COVERED = 0.9;
/** The figure is shown to the nearest ten grams: the factors do not carry more precision than that. */
export const ROUND_TO_G = 10;

export interface Carbon {
  /** grams of CO2 equivalent per kWh of the generation that has a factor */
  gPerKwh: number;
  /** the part of the hour's generation (storage aside) that has a factor, 0 to 1 */
  covered: number;
  /** fossil sources that generated in the hour, largest first */
  fossil: Technology[];
}

/** The footprint of one country's generation in one hour; null when not reported or too little is covered. */
export function carbonAt(live: Live, country: string, index: number): Carbon | null {
  const byTechnology = live.generation?.[country];
  if (!byTechnology) return null;
  let sources = 0;
  let covered = 0;
  let grams = 0;
  const fossil: { technology: Technology; mw: number }[] = [];
  for (const [technology, values] of Object.entries(byTechnology)) {
    const mw = values[index];
    if (mw === null || mw === undefined || mw <= 0 || !isOneOf(TECHNOLOGIES, technology)) continue;
    if (STORAGE.includes(technology)) continue;
    sources += mw;
    const factor = FACTORS_G_PER_KWH[technology];
    if (factor === undefined) continue;
    covered += mw;
    grams += mw * factor;
    if (FOSSIL.includes(technology)) fossil.push({ technology, mw });
  }
  if (covered <= 0 || covered / sources < MIN_COVERED) return null;
  return {
    gPerKwh: grams / covered,
    covered: covered / sources,
    fossil: fossil.sort((a, b) => b.mw - a.mw).map((part) => part.technology),
  };
}

/** The figure as it is shown: to the nearest ten grams. */
export function shownGrams(carbon: Carbon): number {
  return Math.round(carbon.gPerKwh / ROUND_TO_G) * ROUND_TO_G;
}
