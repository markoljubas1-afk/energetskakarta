/**
 * Static pages from the ENTSO-E data the pipeline already publishes (Faza 17-10): electricity generation by
 * country and year (`energy/…`), and today's and tomorrow's day-ahead prices (`live/current.json`). They
 * answer what people and AI assistants ask ("how much electricity does Croatia make from the sun", "price of
 * electricity today") with the figures, the year and the source in one sentence. No data, no page.
 */
import { series, type Periods } from "../data/energy";
import { COUNTRY_PRICE_ZONE, type Live } from "../data/live";
import { isOneOf, SCOPE_COUNTRIES, TECHNOLOGIES, type CountryCode, type Technology } from "../domain";
import { createI18n } from "../i18n";
import { LANGS, type Lang } from "../state/url";
import { ENERGY_COPY } from "./energyCopy";
import { homeCrumb, PATHS, publisher, type SiteData, type StaticPage } from "./site";
import { escapeHtml as e, linkedTable, list } from "./markup";

/** Sources counted as renewable; pumped storage returns electricity it consumed, so it is left out. */
export const RENEWABLE: readonly Technology[] = ["hydro", "wind", "solar", "biomass", "geothermal"];
/** A year counts as complete when the platform reported at least this share of it. */
export const COMPLETE_COVERAGE = 0.98;
/** Source columns on a country page: the largest over all years. */
const SOURCE_COLUMNS = 6;
const ENTSOE_URL = "https://transparency.entsoe.eu/";

const other = (lang: Lang): Lang => (lang === "hr" ? "en" : "hr");

// ---------------------------------------------------------------- generation

export interface PeriodRow {
  /** "2025" or "2025-10" */
  period: string;
  /** MWh; null when no source reported anything in the period */
  total: number | null;
  renewable: number | null;
  /** renewable / total (0–1) */
  share: number | null;
  load: number | null;
  coverage: number;
  /** share of the period with load reported */
  loadCoverage: number;
  complete: boolean;
  byTech: Partial<Record<Technology, number>>;
}

export type YearRow = Omit<PeriodRow, "period"> & { year: string };

/** One country's years or months, oldest first; null when the release has no energy data for it. */
export function periodRows(periods: Periods, code: CountryCode, unit: "year" | "month"): PeriodRow[] | null {
  if (!periods.countries[code]) return null;
  const data = series(periods, code, unit);
  return data.periods.map((period, index) => {
    const byTech: Partial<Record<Technology, number>> = {};
    for (const tech of TECHNOLOGIES) {
      const value = data.generation[tech]?.[index] ?? null;
      if (value !== null) byTech[tech] = value;
    }
    const values = Object.values(byTech);
    const total = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
    const renewable = RENEWABLE.reduce((sum, tech) => sum + (byTech[tech] ?? 0), 0);
    const coverage = data.coverage[index] ?? 0;
    return {
      period,
      total,
      renewable: total === null ? null : renewable,
      share: total !== null && total > 0 ? renewable / total : null,
      load: data.load[index] ?? null,
      coverage,
      loadCoverage: data.loadCoverage[index] ?? 0,
      complete: coverage >= COMPLETE_COVERAGE,
      byTech,
    };
  });
}

/** One country's years, oldest first; null when the release has no energy data for it. */
export function yearRows(periods: Periods, code: CountryCode): YearRow[] | null {
  return periodRows(periods, code, "year")?.map(({ period, ...row }) => ({ year: period, ...row })) ?? null;
}

/** The latest year that is complete and has a total: what a citable sentence may be about. */
export function lastComplete(rows: readonly YearRow[]): YearRow | null {
  return [...rows].reverse().find((row) => row.complete && row.total !== null) ?? null;
}

/** The source that made the most in a period, or null. */
export function largestSource(row: Pick<PeriodRow, "byTech">): Technology | null {
  const entries = Object.entries(row.byTech).filter(([, value]) => value > 0);
  entries.sort((a, b) => b[1] - a[1]);
  const first = entries[0]?.[0];
  return first !== undefined && isOneOf(TECHNOLOGIES, first) ? first : null;
}

function generationCountries(periods: Periods): CountryCode[] {
  return SCOPE_COUNTRIES.filter((code) => periods.countries[code] !== undefined);
}

/** Whether the overview of generation is built: some country has a complete year (Faza 31: links checked it). */
export function hasGenerationOverview(site: SiteData): boolean {
  const periods = site.energy;
  if (!periods) return false;
  return generationCountries(periods).some((code) => {
    const last = lastComplete(yearRows(periods, code) ?? []);
    return last !== null && last !== undefined && last.total !== null;
  });
}

/** Whether the price page is built. */
export function hasPrices(site: SiteData): boolean {
  return Boolean(site.live && priceDays(site.live));
}

function overviewPage(site: SiteData, lang: Lang, periods: Periods): StaticPage | null {
  const copy = ENERGY_COPY[lang].generation;
  const i18n = createI18n(lang);
  const rows = generationCountries(periods).flatMap((code) => {
    const last = lastComplete(yearRows(periods, code) ?? []);
    if (!last || last.total === null) return [];
    const largest = largestSource(last);
    return [
      [
        `<a href="${PATHS[lang].generationCountry(code.toLowerCase())}">${e(i18n.country(code))}</a>`,
        last.year,
        i18n.energy(last.total),
        last.share === null ? "" : i18n.percent(last.share),
        largest ? i18n.technology(largest) : "",
        last.load === null ? "" : i18n.energy(last.load),
      ] as [string, ...string[]],
    ];
  });
  if (rows.length === 0) return null;
  const latest =
    rows
      .map((row) => row[1])
      .sort()
      .at(-1) ?? "";
  const c = copy.columns;
  const path = PATHS[lang].generation;
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].generation,
    title: copy.title,
    description: copy.description,
    heading: copy.heading,
    lead: `<p>${e(copy.lead(latest))}</p>`,
    sections: [
      {
        heading: copy.heading,
        html: linkedTable([c.country, c.year, c.total, c.renewable, c.largest, c.load], rows),
      },
      ...(hasPrices(site)
        ? [{ heading: ENERGY_COPY[lang].prices.linkText, html: list([pricesLink(site, lang)]) }]
        : []),
      {
        heading: "ENTSO-E",
        html: `<p>${e(copy.note)}</p>${list([`<a href="${ENTSOE_URL}" rel="noopener">ENTSO-E Transparency Platform</a>`])}`,
      },
    ],
    jsonLd: [generationDataset(site, lang, copy.title, copy.description, path, null)],
    lastModified: site.energyUpdatedAt ?? site.current.createdAt,
    breadcrumbs: [homeCrumb(lang)],
  };
}

function generationDataset(
  site: SiteData,
  lang: Lang,
  name: string,
  description: string,
  path: string,
  country: string | null,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name,
    description,
    inLanguage: lang,
    isAccessibleForFree: true,
    isBasedOn: ENTSOE_URL,
    creator: { "@type": "Organization", name: "ENTSO-E", url: "https://www.entsoe.eu/" },
    publisher: publisher(site, createI18n(lang)),
    variableMeasured: ["electricity generation by source (MWh)", "total load (MWh)"],
    ...(country ? { spatialCoverage: { "@type": "Country", name: country } } : {}),
    ...(site.siteUrl ? { url: site.siteUrl + path } : {}),
  };
}

function countryPage(site: SiteData, lang: Lang, periods: Periods, code: CountryCode): StaticPage | null {
  const rows = yearRows(periods, code);
  const last = rows ? lastComplete(rows) : null;
  if (!rows || !last || last.total === null) return null;
  const copy = ENERGY_COPY[lang].generation;
  const i18n = createI18n(lang);
  const name = i18n.country(code);
  const where = copy.inCountry[code];
  const totals = new Map<Technology, number>();
  for (const row of rows)
    for (const [tech, value] of Object.entries(row.byTech)) {
      if (isOneOf(TECHNOLOGIES, tech)) totals.set(tech, (totals.get(tech) ?? 0) + value);
    }
  const columns = [...totals]
    .sort((a, b) => b[1] - a[1])
    .slice(0, SOURCE_COLUMNS)
    .map(([tech]) => tech);
  const share = (value: number | undefined): string =>
    value === undefined || last.total === null || last.total <= 0 ? "" : i18n.percent(value / last.total);
  const mix = RENEWABLE.flatMap((tech) => {
    const value = last.byTech[tech];
    return value !== undefined && value > 0 ? [[tech, value] as const] : [];
  })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tech, value]) => `${i18n.technology(tech).toLowerCase()} ${share(value)}`)
    .join(", ");
  const total = i18n.energy(last.total);
  const renewable = last.share === null ? "" : i18n.percent(last.share);
  const first = rows.find((row) => row.total !== null)?.year ?? last.year;
  const c = copy.columns;
  const yearTable = linkedTable(
    [c.year, c.total, c.renewable, ...columns.map((tech) => i18n.technology(tech)), c.load],
    rows
      .filter((row) => row.total !== null)
      .reverse()
      .map((row) => [
        e(row.complete ? row.year : `${row.year}*`),
        row.total === null ? "" : i18n.energy(row.total),
        row.share === null ? "" : i18n.percent(row.share),
        ...columns.map((tech) => {
          const value = row.byTech[tech];
          return value === undefined ? "" : i18n.energy(value);
        }),
        row.load === null ? "" : i18n.energy(row.load),
      ]),
  );
  const sourceTable = linkedTable(
    [c.source, c.total, c.share],
    Object.entries(last.byTech)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([tech, value]) => [
        e(isOneOf(TECHNOLOGIES, tech) ? i18n.technology(tech) : tech),
        i18n.energy(value),
        share(value),
      ]),
  );
  const path = PATHS[lang].generationCountry(code.toLowerCase());
  const title = copy.countryTitle(where, first, last.year);
  const description = copy.countryDescription(name, first, last.year, total, renewable);
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].generationCountry(code.toLowerCase()),
    title,
    description,
    heading: copy.countryHeading(where),
    lead: `<p>${e(copy.countryLead(name, last.year, total, renewable, mix, last.load === null ? "" : i18n.energy(last.load)))}</p>`,
    sections: [
      { heading: copy.lastYearHeading(last.year), html: sourceTable },
      {
        heading: copy.yearsHeading,
        html:
          yearTable +
          (rows.some((row) => row.total !== null && !row.complete) ? `<p>${e(copy.incomplete)}</p>` : ""),
      },
      {
        heading: "ENTSO-E",
        html:
          `<p>${e(copy.note)}</p>` +
          list([
            `<a href="${PATHS[lang].country(code.toLowerCase())}">${e(name)}</a>`,
            `<a href="${PATHS[lang].generation}">${e(copy.linkText)}</a>`,
            `<a href="${ENTSOE_URL}" rel="noopener">ENTSO-E Transparency Platform</a>`,
          ]),
      },
    ],
    jsonLd: [
      {
        ...generationDataset(site, lang, title, description, path, name),
        temporalCoverage: `${first}/${last.year}`,
      },
    ],
    lastModified: site.energyUpdatedAt ?? site.current.createdAt,
    breadcrumbs: [
      homeCrumb(lang),
      { name, path: PATHS[lang].country(code.toLowerCase()) },
      { name: copy.linkText, path: PATHS[lang].generation },
    ],
  };
}

// ---------------------------------------------------------------- day-ahead prices

export interface ZoneDay {
  country: CountryCode;
  zone: string;
  /** €/MWh per local hour of the day; null for an hour without a price */
  values: (number | null)[];
  average: number | null;
  low: { value: number; hour: string } | null;
  high: { value: number; hour: string } | null;
}

export interface DayPrices {
  date: string;
  /** "13:00" per hour of the day, local time */
  hours: string[];
  zones: ZoneDay[];
}

/** The local calendar day of an instant: "2026-11-08". */
export function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** The prices of one local day per country (its price zone; Italy's northern one), countries without prices left out. */
export function dayPrices(live: Live, date: string): DayPrices {
  const indexes = live.hours.flatMap((hour, index) => (hour.startsWith(date) ? [index] : []));
  const hours = indexes.map((index) => live.hours[index]?.slice(11, 16) ?? "");
  const zones = SCOPE_COUNTRIES.flatMap((country): ZoneDay[] => {
    const zone = COUNTRY_PRICE_ZONE[country];
    const prices = live.prices[zone];
    if (!prices) return [];
    const values = indexes.map((index) => prices.eurPerMwh[index] ?? null);
    const known = values.flatMap((value, i) => (value === null ? [] : [{ value, hour: hours[i] ?? "" }]));
    if (known.length === 0) return [];
    const low = known.reduce((best, item) => (item.value < best.value ? item : best));
    const high = known.reduce((best, item) => (item.value > best.value ? item : best));
    return [
      {
        country,
        zone,
        values,
        average: known.reduce((sum, item) => sum + item.value, 0) / known.length,
        low,
        high,
      },
    ];
  });
  return { date, hours, zones };
}

/** Today (the local day the document was made) and, once published, tomorrow. */
export function priceDays(live: Live): { today: DayPrices; tomorrow: DayPrices | null } | null {
  const days = [...new Set(live.hours.map((hour) => hour.slice(0, 10)))];
  const generated = localDate(live.generatedAt, live.timezone);
  const todayDate = days.includes(generated) ? generated : (days[1] ?? days[0]);
  if (todayDate === undefined) return null;
  const today = dayPrices(live, todayDate);
  if (today.zones.length === 0) return null;
  const next = days[days.indexOf(todayDate) + 1];
  const tomorrow = next === undefined ? null : dayPrices(live, next);
  return { today, tomorrow: tomorrow && tomorrow.zones.length > 0 ? tomorrow : null };
}

function pricesLink(site: SiteData, lang: Lang): string {
  return site.live && priceDays(site.live)
    ? `<a href="${PATHS[lang].prices}">${e(ENERGY_COPY[lang].prices.linkText)}</a>`
    : "";
}

function pricesPage(site: SiteData, lang: Lang, live: Live): StaticPage | null {
  const days = priceDays(live);
  if (!days) return null;
  const copy = ENERGY_COPY[lang].prices;
  const i18n = createI18n(lang);
  const price = (value: number | null): string => (value === null ? "" : i18n.number(value, 2));
  const { today, tomorrow } = days;
  const lead = today.zones.find((zone) => zone.country === "HR") ?? today.zones[0];
  const date = i18n.date(today.date);
  const c = copy.columns;
  const tomorrowAverage = (country: CountryCode): string =>
    price(tomorrow?.zones.find((zone) => zone.country === country)?.average ?? null);
  const summary = linkedTable(
    [c.country, c.zone, c.average, c.low, c.high, ...(tomorrow ? [c.tomorrow] : [])],
    today.zones.map((zone) => [
      e(i18n.country(zone.country)),
      zone.zone,
      price(zone.average),
      zone.low ? `${price(zone.low.value)} (${zone.low.hour})` : "",
      zone.high ? `${price(zone.high.value)} (${zone.high.hour})` : "",
      ...(tomorrow ? [tomorrowAverage(zone.country)] : []),
    ]),
  );
  const hourly = (day: DayPrices): string =>
    linkedTable(
      [c.hour, ...day.zones.map((zone) => i18n.country(zone.country))],
      day.hours.map((hour, index) => [
        e(hour),
        ...day.zones.map((zone) => price(zone.values[index] ?? null)),
      ]),
    );
  const hrTomorrow = tomorrow?.zones.find((zone) => zone.country === (lead?.country ?? "HR"));
  const path = PATHS[lang].prices;
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].prices,
    title: copy.title,
    description: copy.description,
    heading: copy.heading(date),
    lead:
      lead && lead.average !== null && lead.low && lead.high
        ? `<p>${e(
            copy.lead(
              date,
              i18n.country(lead.country),
              price(lead.average),
              price(lead.low.value),
              lead.low.hour,
              price(lead.high.value),
              lead.high.hour,
            ),
          )}${tomorrow && hrTomorrow ? ` ${e(copy.tomorrowLead(i18n.date(tomorrow.date), price(hrTomorrow.average)))}` : ""}</p>`
        : "",
    sections: [
      { heading: copy.summaryHeading, html: summary },
      { heading: copy.hoursHeading(date), html: hourly(today) },
      ...(tomorrow ? [{ heading: copy.hoursHeading(i18n.date(tomorrow.date)), html: hourly(tomorrow) }] : []),
      {
        heading: "ENTSO-E",
        html:
          `<p>${e(copy.note)}</p>` +
          list([
            ...(hasGenerationOverview(site)
              ? [`<a href="${PATHS[lang].generation}">${e(ENERGY_COPY[lang].generation.linkText)}</a>`]
              : []),
            `<a href="${ENTSOE_URL}" rel="noopener">ENTSO-E Transparency Platform</a>`,
          ]),
      },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: copy.title,
        description: copy.description,
        inLanguage: lang,
        isAccessibleForFree: true,
        isBasedOn: ENTSOE_URL,
        creator: { "@type": "Organization", name: "ENTSO-E", url: "https://www.entsoe.eu/" },
        publisher: publisher(site, i18n),
        temporalCoverage: tomorrow ? `${today.date}/${tomorrow.date}` : today.date,
        variableMeasured: "day-ahead price (EUR/MWh)",
        ...(site.siteUrl ? { url: site.siteUrl + path } : {}),
      },
    ],
    lastModified: live.generatedAt,
    breadcrumbs: [homeCrumb(lang)],
  };
}

/** Every generation and price page the release's data allows, both languages. */
export function energyPages(site: SiteData): StaticPage[] {
  const pages: StaticPage[] = [];
  for (const lang of LANGS) {
    if (site.energy) {
      const overview = overviewPage(site, lang, site.energy);
      if (overview) pages.push(overview);
      for (const code of generationCountries(site.energy)) {
        const page = countryPage(site, lang, site.energy, code);
        if (page) pages.push(page);
      }
    }
    if (site.live) {
      const page = pricesPage(site, lang, site.live);
      if (page) pages.push(page);
    }
  }
  return pages;
}

/** Links to the generation page of a country and the price page, for other pages; empty without the data. */
export function energyLinks(site: SiteData, lang: Lang, code: CountryCode | null): string[] {
  const copy = ENERGY_COPY[lang];
  const links: string[] = [];
  if (site.energy && code && lastComplete(yearRows(site.energy, code) ?? [])) {
    links.push(
      `<a href="${PATHS[lang].generationCountry(code.toLowerCase())}">${e(copy.generation.countryHeading(copy.generation.inCountry[code]))}</a>`,
    );
  } else if (!code && hasGenerationOverview(site)) {
    links.push(`<a href="${PATHS[lang].generation}">${e(copy.generation.linkText)}</a>`);
  }
  const prices = pricesLink(site, lang);
  if (prices) links.push(prices);
  return links;
}
