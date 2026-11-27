/**
 * Installed capacity per source from ENTSO-E (A68, data/installed.ts) on the static pages: a section on the
 * generation page of each country (the latest year as bars against five years earlier, every year as a
 * table behind a click) and a tile with one sentence on the country page, which says why the figure differs
 * from the sum of the plants on the map. Croatia's and Slovenia's say where Krško is counted.
 */
import { installedCountry, type Installed, type InstalledCountry } from "../data/installed";
import { KRSKO_HOST, KRSKO_PARTNER, KRSKO_PARTNER_SHARE } from "../data/krsko";
import type { CountryCode, Technology } from "../domain";
import { createI18n, type I18n } from "../i18n";
import type { Lang } from "../state/url";
import { CHART_COPY, sourceBars, splitUnit, tableBehind, type KeyFigure } from "./charts";
import { ENERGY_COPY } from "./energyCopy";
import { escapeHtml as e, linkedTable } from "./markup";
import type { Section } from "./site";

/** The sources whose growth the section names. */
const GROWING: readonly Technology[] = ["solar", "wind"];

interface InstalledCopy {
  heading: string;
  lead: (year: number, where: string, total: string, largest: string) => string;
  growth: (earlier: number, items: string) => string;
  grew: (source: string, before: string, now: string) => string;
  fresh: (source: string, now: string) => string;
  /** the legend of the bars */
  atStart: (year: number) => string;
  newSource: string;
  year: string;
  total: string;
  note: string;
  krskoHr: (whole: string, half: string) => string;
  krskoSi: (whole: string, half: string) => string;
  question: (where: string) => string;
  variable: string;
  /** the tile on the country page */
  figure: string;
  figureNote: (year: number) => string;
  figureKrskoHr: string;
  figureKrskoSi: string;
  compare: (year: number, where: string, total: string) => string;
  whyDifferent: string;
}

const COPY: Record<Lang, InstalledCopy> = {
  hr: {
    heading: "Instalirana snaga po izvoru",
    lead: (year, where, total, largest) =>
      `Na početku ${year}. ${where} je bilo instalirano ${total} elektrana, prema podacima koje operator prijenosnog sustava prijavljuje ENTSO-E-u.${largest ? ` Najveći izvori: ${largest}.` : ""}`,
    growth: (earlier, items) => `U pet godina (od početka ${earlier}.): ${items}.`,
    grew: (source, before, now) => `${source} s ${before} na ${now}`,
    fresh: (source, now) => `${source} ${now} (prije ih nije bilo)`,
    atStart: (year) => `Na početku ${year}.`,
    newSource: "novo",
    year: "Početak godine",
    total: "Ukupno",
    note: "Izvor: ENTSO-E Transparency Platform, instalirana snaga po vrsti proizvodnje. Brojka godine je snaga na njezinu početku. Ubraja sve priključene elektrane, i male na krovovima, pa je veća od zbroja elektrana na karti.",
    krskoHr: (whole, half) =>
      `NE Krško nije u ovom zbroju: ENTSO-E cijelu njezinu snagu (${whole}) vodi u Sloveniji, a polovica, oko ${half}, pripada Hrvatskoj (HEP).`,
    krskoSi: (whole, half) =>
      `Nuklearna snaga je cijela NE Krško (${whole}); polovica, oko ${half}, pripada Hrvatskoj (HEP).`,
    question: (where) => `Koliko je instalirane snage elektrana ${where}?`,
    variable: "instalirana snaga po izvoru (MW)",
    figure: "Instalirana snaga (ENTSO-E)",
    figureNote: (year) => `na početku ${year}.`,
    figureKrskoHr: "bez polovice NE Krško",
    figureKrskoSi: "s cijelom NE Krško",
    compare: (year, where, total) =>
      `Prema ENTSO-E-u, na početku ${year}. ${where} je bilo instalirano ${total}.`,
    whyDifferent:
      "Zbroj s karte je drukčiji: ENTSO-E broji svu priključenu snagu, i male sunčane elektrane na krovovima kojih na karti nema, a karta zbraja elektrane u pogonu kojima izvori upisuju snagu.",
  },
  en: {
    heading: "Installed capacity by source",
    lead: (year, where, total, largest) =>
      `At the start of ${String(year)}, ${where} had ${total} of generation capacity installed, as its transmission system operator reports it to ENTSO-E.${largest ? ` The largest sources: ${largest}.` : ""}`,
    growth: (earlier, items) => `In five years (since the start of ${String(earlier)}): ${items}.`,
    grew: (source, before, now) => `${source} from ${before} to ${now}`,
    fresh: (source, now) => `${source} ${now} (none before)`,
    atStart: (year) => `At the start of ${String(year)}`,
    newSource: "new",
    year: "Start of year",
    total: "Total",
    note: "Source: ENTSO-E Transparency Platform, installed capacity per production type. A year's figure is the capacity at its start. It counts every plant connected, the small rooftop ones too, so it is larger than the sum of the plants on the map.",
    krskoHr: (whole, half) =>
      `The Krško nuclear plant is not in this sum: ENTSO-E counts all of its capacity (${whole}) in Slovenia, and half of it, about ${half}, belongs to Croatia (HEP).`,
    krskoSi: (whole, half) =>
      `The nuclear capacity is the whole of the Krško plant (${whole}); half of it, about ${half}, belongs to Croatia (HEP).`,
    question: (where) => `How much generation capacity is installed in ${where}?`,
    variable: "installed capacity by source (MW)",
    figure: "Installed capacity (ENTSO-E)",
    figureNote: (year) => `at the start of ${String(year)}`,
    figureKrskoHr: "without half of Krško",
    figureKrskoSi: "with all of Krško",
    compare: (year, where, total) =>
      `According to ENTSO-E, ${where} had ${total} installed at the start of ${String(year)}.`,
    whyDifferent:
      "The sum on the map differs: ENTSO-E counts all capacity connected, small rooftop solar too, which is not on the map, while the map adds up the operating plants whose sources state their capacity.",
  },
};

/** Croatian prose says "u Hrvatskoj"; English the country's name. */
function where(lang: Lang, code: CountryCode, i18n: I18n): string {
  return lang === "hr" ? ENERGY_COPY.hr.generation.inCountry[code] : i18n.country(code);
}

const sourceName = (i18n: I18n, tech: Technology): string => i18n.t(`sourceName_${tech}`).toLowerCase();

/** Krško's whole capacity and Croatia's half, from Slovenia's latest year; null without it. */
function krsko(doc: Installed, i18n: I18n): { whole: string; half: string } | null {
  const mw = doc.countries[KRSKO_HOST]?.at(-1)?.mw.nuclear;
  return mw === undefined ? null : { whole: i18n.power(mw), half: i18n.power(mw * KRSKO_PARTNER_SHARE) };
}

function krskoSentence(doc: Installed, lang: Lang, code: CountryCode, i18n: I18n): string | null {
  if (code !== KRSKO_PARTNER && code !== KRSKO_HOST) return null;
  const figures = krsko(doc, i18n);
  if (!figures) return null;
  const copy = COPY[lang];
  return code === KRSKO_PARTNER
    ? copy.krskoHr(figures.whole, figures.half)
    : copy.krskoSi(figures.whole, figures.half);
}

/** The opening sentence of the section, the answer of its question in the structured data too. */
export function installedLead(doc: Installed, lang: Lang, code: CountryCode): string | null {
  const country = installedCountry(doc, code);
  if (!country) return null;
  const i18n = createI18n(lang);
  const largest = country.sources
    .slice(0, 3)
    .map((source) => `${sourceName(i18n, source.tech)} ${i18n.power(source.mw)}`)
    .join(", ");
  return COPY[lang].lead(
    country.latest.year,
    where(lang, code, i18n),
    i18n.power(country.latest.total),
    largest,
  );
}

function growthSentence(country: InstalledCountry, lang: Lang, i18n: I18n): string | null {
  const { earlier } = country;
  if (!earlier) return null;
  const copy = COPY[lang];
  const items = GROWING.flatMap((tech) => {
    const source = country.sources.find((each) => each.tech === tech);
    if (source?.before == null) return [];
    const name = sourceName(i18n, tech);
    return [
      source.before === 0
        ? copy.fresh(name, i18n.power(source.mw))
        : copy.grew(name, i18n.power(source.before), i18n.power(source.mw)),
    ];
  });
  return items.length === 0 ? null : copy.growth(earlier.year, items.join(", "));
}

function change(lang: Lang, i18n: I18n, now: number, before: number | null): string {
  if (before === null) return "";
  if (before === 0) return COPY[lang].newSource;
  const ratio = now / before - 1;
  const arrow = ratio > 0 ? "▲" : ratio < 0 ? "▼" : "=";
  return `${arrow} ${i18n.percent(Math.abs(ratio))}`;
}

export interface InstalledSection {
  section: Section;
  /** the question and its answer, for the page's FAQ */
  faq: [string, string];
  variable: string;
}

/** The section of a country's generation page; null when the document has nothing for the country. */
export function installedSection(doc: Installed, lang: Lang, code: CountryCode): InstalledSection | null {
  const country = installedCountry(doc, code);
  const lead = installedLead(doc, lang, code);
  if (!country || lead === null) return null;
  const i18n = createI18n(lang);
  const copy = COPY[lang];
  const { latest, earlier } = country;
  const bars = sourceBars(
    country.sources.map((source) => ({
      tech: source.tech,
      name: i18n.technology(source.tech),
      amount: i18n.power(source.mw),
      share: i18n.percent(source.mw / latest.total),
      value: source.mw,
      before: source.before,
      change: change(lang, i18n, source.mw, source.before),
    })),
    { now: copy.atStart(latest.year), before: earlier ? copy.atStart(earlier.year) : "" },
  );
  const columns = country.sources.map((source) => source.tech);
  const years = linkedTable(
    [copy.year, copy.total, ...columns.map((tech) => i18n.technology(tech))],
    country.years.map((each) => [
      e(String(each.year)),
      i18n.power(each.total),
      ...columns.map((tech) => {
        const mw = each.mw[tech];
        return mw === undefined ? "" : i18n.power(mw);
      }),
    ]),
  );
  const paragraphs = [lead, growthSentence(country, lang, i18n), krskoSentence(doc, lang, code, i18n)]
    .filter((text): text is string => text !== null)
    .map((text) => `<p>${e(text)}</p>`)
    .join("");
  return {
    section: {
      heading: copy.heading,
      html: paragraphs + bars + tableBehind(CHART_COPY[lang].table, years) + `<p>${e(copy.note)}</p>`,
    },
    faq: [copy.question(where(lang, code, i18n)), lead],
    variable: copy.variable,
  };
}

/** The tile of the country page; null without the country's figure. */
export function installedFigure(doc: Installed, lang: Lang, code: CountryCode): KeyFigure | null {
  const country = installedCountry(doc, code);
  if (!country) return null;
  const i18n = createI18n(lang);
  const copy = COPY[lang];
  const [value, unit] = splitUnit(i18n.power(country.latest.total));
  const krskoNote =
    code === KRSKO_PARTNER ? copy.figureKrskoHr : code === KRSKO_HOST ? copy.figureKrskoSi : null;
  const note = copy.figureNote(country.latest.year) + (krskoNote ? `, ${krskoNote}` : "");
  return { label: copy.figure, value, unit, note };
}

/** The sentence under the map's capacity on the country page: ENTSO-E's figure, and why the two differ. */
export function installedComparison(doc: Installed, lang: Lang, code: CountryCode): string {
  const country = installedCountry(doc, code);
  if (!country) return "";
  const i18n = createI18n(lang);
  const copy = COPY[lang];
  const krskoText = krskoSentence(doc, lang, code, i18n);
  return `<p>${e(
    [
      copy.compare(country.latest.year, where(lang, code, i18n), i18n.power(country.latest.total)),
      copy.whyDifferent,
      ...(krskoText ? [krskoText] : []),
    ].join(" "),
  )}</p>`;
}
