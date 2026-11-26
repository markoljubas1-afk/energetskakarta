import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { DataSource, Technology, VoltageClass } from "../domain";
import type { Lang } from "../state/url";
import { en } from "./en";
import { hr, type Dictionary, type MessageKey, type PluralKey } from "./hr";
import { plantName } from "./plantName";

const DICTIONARIES: Record<Lang, Dictionary> = { hr, en };
const LOCALES: Record<Lang, string> = { hr: "hr-HR", en: "en-GB" };
const VOLTAGE_KEYS: Record<VoltageClass, MessageKey> = {
  "380+": "voltage_380",
  "220-379": "voltage_220",
  "110-219": "voltage_110",
  "60-109": "voltage_60",
  "<60": "voltage_lt60",
  unknown: "voltage_unknown",
};

export interface I18n {
  lang: Lang;
  locale: string;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** Plural-aware message; `{count}` is filled with the formatted number. */
  plural: (key: PluralKey, count: number) => string;
  number: (value: number, digits?: number) => string;
  /** 12.3 MW, or 1.2 GW from 1000 MW upwards */
  power: (mw: number) => string;
  km: (value: number) => string;
  /** MWh, GWh or TWh, whichever reads best */
  energy: (mwh: number) => string;
  /** "srp 2025" / "Jul 2025" for "2025-07"; a year stays as it is */
  period: (key: string) => string;
  /** short month names, January first */
  months: string[];
  percent: (share: number) => string;
  /** date and time, e.g. "16. 9. 2026. 12:12" */
  dateTime: (iso: string) => string;
  date: (iso: string) => string;
  /** Localised country name for an ISO code (scope countries and neighbours alike). */
  country: (code: string) => string;
  technology: (tech: Technology) => string;
  /** a plant's name as this language says it: GEM's English "X solar farm" is "Sunčana elektrana X" in Croatian */
  plantName: (name: string, tech: Technology) => string;
  voltage: (klass: VoltageClass) => string;
  /** "OpenStreetMap, Global Energy Monitor" */
  sources: (list: readonly DataSource[]) => string;
  /** Map attribution line for the sources a build uses. */
  attribution: (list: readonly DataSource[]) => string;
}

export function createI18n(lang: Lang): I18n {
  const dict = DICTIONARIES[lang];
  const locale = LOCALES[lang];
  const regions = new Intl.DisplayNames([locale], { type: "region" });
  const formatters = new Map<number, Intl.NumberFormat>();
  const number = (value: number, digits = 0): string => {
    let formatter = formatters.get(digits);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
      formatters.set(digits, formatter);
    }
    return formatter.format(value);
  };
  const t = (key: MessageKey, vars?: Record<string, string | number>): string =>
    dict[key].replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = vars?.[name];
      return value === undefined ? match : String(value);
    });
  const rules = new Intl.PluralRules(locale);
  const plural = (key: PluralKey, count: number): string => {
    const category = rules.select(count);
    const form: MessageKey = category === "one" || category === "few" ? `${key}_${category}` : `${key}_other`;
    return t(form, { count: number(count) });
  };
  return {
    lang,
    locale,
    t,
    plural,
    number,
    power: (mw) =>
      mw >= 1000 ? `${number(mw / 1000, 2)} ${dict.unitGw}` : `${number(mw, mw < 10 ? 1 : 0)} ${dict.unitMw}`,
    km: (value) => `${number(value)} ${dict.unitKm}`,
    energy: (mwh) => {
      const size = Math.abs(mwh);
      if (size >= 1e6) return `${number(mwh / 1e6, 2)} ${dict.unitTwh}`;
      if (size >= 1e3) return `${number(mwh / 1e3, size >= 1e5 ? 0 : 1)} ${dict.unitGwh}`;
      return `${number(mwh)} ${dict.unitMwh}`;
    },
    period: (key) => {
      const [year, month] = key.split("-");
      if (!month) return key;
      return new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(
        new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
      );
    },
    months: Array.from({ length: 12 }, (_, i) =>
      new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
        new Date(Date.UTC(2020, i, 1)),
      ),
    ),
    dateTime: (iso) =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Zagreb",
      }).format(new Date(iso)),
    percent: (share) =>
      new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(share),
    // the day in Croatia, whatever the time zone of the machine that formats it (Faza 31)
    date: (iso) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Zagreb" }).format(new Date(iso)),
    // the browser writes "Bosnia & Herzegovina"; prose and titles use the full form (Faza 31)
    country: (code) =>
      lang === "en" && code === "BA" ? "Bosnia and Herzegovina" : (regions.of(code) ?? code),
    technology: (tech) => t(`tech_${tech}`),
    plantName: (name, tech) => plantName(name, tech, lang),
    voltage: (klass) => t(VOLTAGE_KEYS[klass]),
    sources: (list) => list.map((source) => t(`source_${source}`)).join(", "),
    attribution: (list) => list.map((source) => t(`attr_${source}`)).join(" | "),
  };
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo(() => createI18n(lang), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
