/**
 * The Krško nuclear plant on the public pages (2026-11-27): its own page says who owns it and how the
 * statistics count it, with Croatia's half in the latest year Slovenia reported in full; the pages of
 * Croatia and Slovenia say it in one sentence and link the plant's page. The rule and the figure are in
 * data/krsko.ts.
 */
import { series, type Periods } from "../data/energy";
import { KRSKO_HOST, KRSKO_ID, KRSKO_PARTNER, krskoHalfOfPeriod } from "../data/krsko";
import type { CountryCode } from "../domain";
import { createI18n } from "../i18n";
import type { Lang } from "../state/url";
import { COMPLETE_COVERAGE } from "./energyPages";
import { e } from "./markup";

interface KrskoYear {
  year: string;
  mwh: number;
  /** of Croatia's load in that year; null when the load was not reported in full */
  share: number | null;
}

/** The latest year with Croatia's half known. */
export function latestKrskoYear(periods: Periods): KrskoYear | null {
  if (!periods.countries[KRSKO_HOST]) return null;
  const years = series(periods, KRSKO_HOST, "year").periods;
  const croatia = periods.countries[KRSKO_PARTNER] ? series(periods, KRSKO_PARTNER, "year") : null;
  for (const year of [...years].reverse()) {
    const mwh = krskoHalfOfPeriod(periods, "year", year);
    if (mwh === null) continue;
    const at = croatia ? croatia.periods.indexOf(year) : -1;
    const load = croatia && at >= 0 ? croatia.load[at] : null;
    const known = croatia !== null && at >= 0 && (croatia.loadCoverage[at] ?? 0) >= COMPLETE_COVERAGE;
    return { year, mwh, share: known && load ? mwh / load : null };
  }
  return null;
}

/** The paragraphs for the Krško plant's own page; nothing for any other asset. */
export function krskoPlantLead(periods: Periods | null | undefined, lang: Lang, id: string): string {
  if (id !== KRSKO_ID) return "";
  const i18n = createI18n(lang);
  const latest = periods ? latestKrskoYear(periods) : null;
  const year =
    latest === null
      ? ""
      : latest.share === null
        ? i18n.t("krskoPlantYear", { year: latest.year, amount: i18n.energy(latest.mwh) })
        : i18n.t("krskoPlantYearShare", {
            year: latest.year,
            amount: i18n.energy(latest.mwh),
            share: i18n.percent(latest.share),
          });
  return `<p>${e(i18n.t("krskoPlant"))}${year ? ` ${e(year)}` : ""}</p>`;
}

/**
 * The sentence for the pages of Croatia and Slovenia, linking the plant's page when it has one
 * (`plantPath`); nothing for any other country.
 */
export function krskoCountryLead(lang: Lang, code: CountryCode, plantPath: string | null): string {
  if (code !== KRSKO_PARTNER && code !== KRSKO_HOST) return "";
  const i18n = createI18n(lang);
  const sentence = i18n.t(code === KRSKO_PARTNER ? "krskoCountryHr" : "krskoCountrySi");
  const link = plantPath === null ? "" : ` <a href="${e(plantPath)}">${e(i18n.t("krskoMore"))}</a>`;
  return `<p>${e(sentence)}${link}</p>`;
}
