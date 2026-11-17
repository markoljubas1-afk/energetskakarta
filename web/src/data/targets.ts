/**
 * National renewable-energy targets for 2030, as each country's own plan states them (NECP), against the
 * indicator Eurostat publishes for the same thing (data/eurostat.ts). Hand-entered, so every figure names
 * the document it was read in; a country or an indicator without a verified figure is simply absent, and the
 * site then shows no target for it.
 */
import type { CountryCode } from "../domain";
import type { ResIndicator } from "./eurostat";

export interface Target2030 {
  /** the Eurostat indicator the target is measured by */
  indicator: ResIndicator;
  /** percent */
  value: number;
  /** the document the figure was read in */
  source: string;
  sourceUrl: string;
}

/**
 * The overall targets: the share of renewables in gross final energy consumption in 2030 (Eurostat's `REN`).
 * Read in the primary documents on 2026-11-17:
 * - EU members: the final updated plan each submitted to the Commission in 2024 or 2025 (Slovenia and Austria
 *   say "at least"); each figure is repeated in the Commission's assessment of the plan, SWD(2025) 140.
 * - Serbia, Bosnia and Herzegovina, Montenegro: the binding targets the Energy Community's Ministerial Council
 *   set in decision 2022/02/MC-EnC (Annex I of the adapted Directive 2018/2001). Serbia's own adopted plan
 *   aims lower (33.6 %) and says so; Bosnia and Herzegovina has no adopted plan; Montenegro's plan has the
 *   same 50 % as its national target.
 * Electricity targets are left out on purpose: the plans call them indicative, sectoral or projections, and
 * Austria's is a national balance, not the share Eurostat measures.
 */
export const TARGETS_2030: Partial<Record<CountryCode, Target2030[]>> = {
  HR: [
    {
      indicator: "REN",
      value: 42.5,
      source: "NECP (2025)",
      sourceUrl:
        "https://webgate.ec.europa.eu/circabc-ewpp/d/d/workspace/SpacesStore/700699cf-c540-4bcc-90f2-f39d7008bf19/details",
    },
  ],
  SI: [
    {
      indicator: "REN",
      value: 33,
      source: "NECP (2024)",
      sourceUrl:
        "https://webgate.ec.europa.eu/circabc-ewpp/d/d/workspace/SpacesStore/5f11dda9-21cf-46ee-93da-c78c05b3f60d/details",
    },
  ],
  HU: [
    {
      indicator: "REN",
      value: 30,
      source: "NECP (2024)",
      sourceUrl:
        "https://webgate.ec.europa.eu/circabc-ewpp/d/d/workspace/SpacesStore/1dea97e6-dc15-45ea-a4c3-b8ea49f9ccfb/details",
    },
  ],
  AT: [
    {
      indicator: "REN",
      value: 57,
      source: "NECP (2024)",
      sourceUrl:
        "https://webgate.ec.europa.eu/circabc-ewpp/d/d/workspace/SpacesStore/a9cc4c4d-479b-44e2-a610-bde40e24394f/details",
    },
  ],
  IT: [
    {
      indicator: "REN",
      value: 39.4,
      source: "NECP (2024)",
      sourceUrl:
        "https://webgate.ec.europa.eu/circabc-ewpp/d/d/workspace/SpacesStore/abe391a1-8392-4b7e-874a-b80a6ff84212/details",
    },
  ],
  RS: [
    {
      indicator: "REN",
      value: 40.7,
      source: "Energy Community, 2022/02/MC-EnC",
      sourceUrl:
        "https://www.energy-community.org/dam/jcr:78fd6b72-436f-45e7-aef5-5ade1d53f92a/Directive%20EU%202018-2001%20promotion%20of%20the%20use%20of%20RES.pdf",
    },
  ],
  BA: [
    {
      indicator: "REN",
      value: 43.6,
      source: "Energy Community, 2022/02/MC-EnC",
      sourceUrl:
        "https://www.energy-community.org/dam/jcr:78fd6b72-436f-45e7-aef5-5ade1d53f92a/Directive%20EU%202018-2001%20promotion%20of%20the%20use%20of%20RES.pdf",
    },
  ],
  ME: [
    {
      indicator: "REN",
      value: 50,
      source: "Energy Community, 2022/02/MC-EnC",
      sourceUrl:
        "https://www.energy-community.org/dam/jcr:78fd6b72-436f-45e7-aef5-5ade1d53f92a/Directive%20EU%202018-2001%20promotion%20of%20the%20use%20of%20RES.pdf",
    },
  ],
};

/** A country's 2030 target for one indicator, or null when none is verified. */
export function target2030(
  country: string,
  indicator: ResIndicator,
  targets: Partial<Record<string, Target2030[]>> = TARGETS_2030,
): Target2030 | null {
  return targets[country]?.find((target) => target.indicator === indicator) ?? null;
}

export interface Progress {
  target: Target2030;
  /** the latest official share: its year and its value in percent */
  year: number;
  value: number;
  /** how far the share is from the target in percentage points, from the figures as shown (one decimal) */
  gap: number;
  /** the share as a part of the target, 0 to 1 */
  part: number;
}

const oneDecimal = (value: number): number => Math.round(value * 10) / 10;

/** Where a share stands against its target; the gap is taken from the rounded figures a reader sees. */
export function progress(target: Target2030, share: { year: number; value: number }): Progress {
  const shown = oneDecimal(share.value);
  return {
    target,
    year: share.year,
    value: share.value,
    gap: Math.max(0, oneDecimal(target.value - shown)),
    part: target.value > 0 ? Math.min(1, Math.max(0, shown / target.value)) : 0,
  };
}
