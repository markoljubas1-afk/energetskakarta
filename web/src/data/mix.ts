/**
 * What the electricity in a country's grid is made of in an hour (Faza 19), from the live layer's actual
 * generation and cross-border flows. Electricity mixes in the grid, so this is a share of sources in that
 * hour, never a path from one plant to one house.
 *
 * - production mix: the country's own generation by technology;
 * - grid mix: own generation plus net imports, each import split by the exporting country's own production
 *   in that hour (one step: what the exporter itself imported is not traced further). An import from a
 *   country without generation data stays "import, make-up unknown" instead of being guessed. Exports leave
 *   the pool in proportion, so they do not change the shares.
 *
 * ENTSO-E publishes actual generation late, so when the asked hour has no data yet the latest earlier hour
 * with data is used, and the result says which hour that is.
 */
import { isOneOf, SCOPE_COUNTRIES, TECHNOLOGIES, type CountryCode, type Technology } from "../domain";
import type { Live } from "./live";

export interface TechShare {
  technology: Technology;
  mw: number;
  share: number;
}

export interface ImportShare {
  country: CountryCode;
  mw: number;
  share: number;
  /** whether the exporter's generation is known (its import is split into technologies) */
  known: boolean;
}

export interface Mix {
  /** the hour the figures are for */
  index: number;
  totalMw: number;
  technologies: TechShare[];
  /** grid mix only: where imports came from, largest first */
  imports: ImportShare[];
  /** grid mix only: imports from countries without generation data */
  unknownImportMw: number;
  /** grid mix only: a border of the country had no flow value in that hour */
  incomplete: boolean;
}

const isCountry = (code: string): code is CountryCode => isOneOf(SCOPE_COUNTRIES, code);

/** MW per technology for one country and hour, or null when that hour was not fully reported. */
export function generationAt(
  live: Live,
  country: CountryCode,
  index: number,
): Map<Technology, number> | null {
  const techs = live.generation?.[country];
  if (!techs) return null;
  const out = new Map<Technology, number>();
  for (const [key, values] of Object.entries(techs)) {
    const value = values[index];
    if (value === null || value === undefined) return null;
    const technology: Technology = isOneOf(TECHNOLOGIES, key) ? key : "other";
    out.set(technology, (out.get(technology) ?? 0) + Math.max(0, value));
  }
  return out.size > 0 ? out : null;
}

/** The asked hour, or the latest earlier hour with generation for the country; null if there is none. */
export function latestWithData(live: Live, country: CountryCode, index: number): number | null {
  for (let i = Math.min(index, live.hours.length - 1); i >= 0; i--) {
    if (generationAt(live, country, i)) return i;
  }
  return null;
}

/** Countries that report generation in this document, in the map's order. */
export const mixCountries = (live: Live): CountryCode[] =>
  SCOPE_COUNTRIES.filter((country) => live.generation?.[country] !== undefined);

const sum = (values: Iterable<number>): number => {
  let total = 0;
  for (const v of values) total += v;
  return total;
};

function shares(index: number, pool: Map<Technology, number>, unknownImportMw: number): Mix {
  const totalMw = sum(pool.values()) + unknownImportMw;
  const technologies = [...pool.entries()]
    .filter(([, mw]) => mw > 0)
    .map(([technology, mw]) => ({ technology, mw, share: totalMw > 0 ? mw / totalMw : 0 }))
    .sort((a, b) => b.mw - a.mw);
  return { index, totalMw, technologies, imports: [], unknownImportMw, incomplete: false };
}

export function productionMix(live: Live, country: CountryCode, index: number): Mix | null {
  const at = latestWithData(live, country, index);
  if (at === null) return null;
  const own = generationAt(live, country, at);
  return own ? shares(at, own, 0) : null;
}

export function gridMix(live: Live, country: CountryCode, index: number): Mix | null {
  const at = latestWithData(live, country, index);
  if (at === null) return null;
  const own = generationAt(live, country, at);
  if (!own) return null;
  const pool = new Map(own);
  const imports: Omit<ImportShare, "share">[] = [];
  let unknownImportMw = 0;
  let incomplete = false;
  for (const flow of live.flows) {
    if (flow.from !== country && flow.to !== country) continue;
    const value = flow.mw[at];
    if (value === null || value === undefined) {
      incomplete = true;
      continue;
    }
    const neighbour = flow.from === country ? flow.to : flow.from;
    const intoCountry = flow.to === country ? value : -value;
    if (intoCountry <= 0 || !isCountry(neighbour)) continue;
    const theirs = generationAt(live, neighbour, at);
    const theirTotal = theirs ? sum(theirs.values()) : 0;
    if (theirs && theirTotal > 0) {
      for (const [technology, mw] of theirs) {
        pool.set(technology, (pool.get(technology) ?? 0) + (intoCountry * mw) / theirTotal);
      }
      imports.push({ country: neighbour, mw: intoCountry, known: true });
    } else {
      unknownImportMw += intoCountry;
      imports.push({ country: neighbour, mw: intoCountry, known: false });
    }
  }
  const mix = shares(at, pool, unknownImportMw);
  return {
    ...mix,
    imports: imports
      .map((item) => ({ ...item, share: mix.totalMw > 0 ? item.mw / mix.totalMw : 0 }))
      .sort((a, b) => b.mw - a.mw),
    incomplete,
  };
}
