/**
 * Carbon intensity of electricity (Faza 20-1), from a mix of sources and lifecycle emission factors.
 *
 * Factors are lifecycle medians in g CO₂-eq per kWh from IPCC AR5 WGIII, Annex III (2014), Table A.III.2:
 * coal 820 (also used for lignite, whose own figure is higher, so the result errs low), gas 490 (combined
 * cycle), biomass 230, solar 48 (utility PV), geothermal 38, hydro 24, nuclear 12, wind 11 (onshore).
 * IPCC gives no figure for oil or for unclassified generation: 650 and 700 are assumptions, said so on the
 * methodology page. Storage (pumped hydro, batteries) returns electricity made elsewhere and is not counted.
 */
import type { Technology } from "../domain";
import type { Mix } from "./mix";

export const EMISSION_FACTORS: Readonly<Record<Technology, number | null>> = {
  coal: 820,
  lignite: 820,
  gas: 490,
  oil: 650,
  biomass: 230,
  solar: 48,
  geothermal: 38,
  hydro: 24,
  nuclear: 12,
  wind: 11,
  other: 700,
  pumped_storage: null,
  battery: null,
};

/** g CO₂-eq per kWh of a mix of MW or MWh by technology; null when nothing countable is in it. */
export function intensity(parts: Iterable<readonly [Technology, number]>): number | null {
  let energy = 0;
  let grams = 0;
  for (const [technology, amount] of parts) {
    const factor = EMISSION_FACTORS[technology];
    if (factor === null || !(amount > 0)) continue;
    energy += amount;
    grams += amount * factor;
  }
  return energy > 0 ? grams / energy : null;
}

/** Intensity of a production or grid mix; imports of unknown make-up are left out (the card says so). */
export const mixIntensity = (mix: Mix): number | null =>
  intensity(mix.technologies.map((part) => [part.technology, part.mw] as const));
