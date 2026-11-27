/**
 * The Krško nuclear plant (2026-11-27): it stands in Slovenia and is owned in equal halves by Slovenia's GEN
 * energija and Croatia's HEP, each of which takes half of what it generates. ENTSO-E and Eurostat count by
 * territory, so all of it is Slovenian generation and the half HEP takes is an import into Croatia. Our
 * figures stay territorial, as the sources publish them; where Croatia's or Slovenia's generation,
 * consumption or imports are shown, a note says how much of it is Croatia's half.
 *
 * The half is half of Slovenia's nuclear generation in the same period: Krško is the only nuclear plant in
 * Slovenia. It is given only for a period Slovenia reported in full, and not when the plant stood still.
 */
import type { Area, Periods, Unit, YearFile } from "./energy";
import { rangeDays, series } from "./energy";
import type { I18n } from "../i18n";
import type { Live } from "./live";
import { generationAt } from "./mix";

/** The operating plant; GEM's planned second block nearby is a record of its own. */
export const KRSKO_ID = "osm:way/89819245";
export const KRSKO_HOST = "SI";
export const KRSKO_PARTNER = "HR";
/** HEP's part of the plant and of its output (interstate agreement of 2001). */
export const KRSKO_PARTNER_SHARE = 0.5;
/** A month or year counts as reported when this much of it is (the generation pages' rule). */
const COMPLETE = 0.98;
/** A day counts as reported from here (as the pictures for sharing: share/sourcesCard.ts). */
const COMPLETE_DAY = 0.999;

const half = (nuclear: number | null | undefined): number | null =>
  nuclear !== null && nuclear !== undefined && nuclear > 0 ? nuclear * KRSKO_PARTNER_SHARE : null;

/** Croatia's half in MWh for a month ("2025-01") or a year ("2025"). */
export function krskoHalfOfPeriod(periods: Periods, unit: Unit, period: string): number | null {
  if (!periods.countries[KRSKO_HOST]) return null;
  const slovenia = series(periods, KRSKO_HOST, unit);
  const index = slovenia.periods.indexOf(period);
  if (index < 0 || (slovenia.coverage[index] ?? 0) < COMPLETE) return null;
  return half(slovenia.generation.nuclear?.[index]);
}

/**
 * Croatia's half in MWh for the days from `from` to `to` (inclusive), when Slovenia reported each of them in
 * full (a day is complete at 1.0; the pipeline writes less for a day with missing hours).
 */
export function krskoHalfOfRange(files: readonly YearFile[], from: string, to: string): number | null {
  const days = rangeDays(from, to);
  if (days === null) return null;
  let complete = 0;
  let nuclear = 0;
  for (const file of files) {
    const slovenia = file.countries[KRSKO_HOST];
    if (!slovenia) continue;
    file.days.forEach((day, index) => {
      if (day < from || day > to || (slovenia.coverage.generation[index] ?? 0) < COMPLETE_DAY) return;
      complete += 1;
      nuclear += slovenia.generation.nuclear?.[index] ?? 0;
    });
  }
  return complete === days ? half(nuclear) : null;
}

/** Croatia's half in MW for an hour of the live data. */
export function krskoHalfOfHour(live: Live, index: number): number | null {
  return half(generationAt(live, KRSKO_HOST, index)?.get("nuclear"));
}

/**
 * The sentence for Croatia or Slovenia; null for any other area (a sum of countries already holds both
 * halves) or without a figure. `amount` and `share` are formatted by the caller ("2,8 TWh", "15 %").
 */
/**
 * The sentence a picture of a chart carries for Croatia or Slovenia: with Croatia's half when the chart is of
 * one period that has it (`mwh`, and `load` for the share of consumption), else without a figure; null for
 * any other area.
 */
export function krskoPictureNote(
  i18n: I18n,
  area: Area,
  mwh: number | null,
  load: number | null,
): string | null {
  if (area !== KRSKO_PARTNER && area !== KRSKO_HOST) return null;
  const amount = mwh === null ? null : i18n.energy(mwh);
  const share = mwh === null || !load ? null : i18n.percent(mwh / load);
  return (
    krskoNote(i18n, area, amount, share) ??
    i18n.t(area === KRSKO_PARTNER ? "krskoCountryHr" : "krskoCountrySi")
  );
}

export function krskoNote(
  i18n: I18n,
  area: Area,
  amount: string | null,
  share: string | null,
): string | null {
  if (amount === null) return null;
  if (area === KRSKO_PARTNER) {
    return share === null ? i18n.t("krskoHr", { amount }) : i18n.t("krskoHrShare", { amount, share });
  }
  if (area === KRSKO_HOST) return i18n.t("krskoSi", { amount });
  return null;
}
