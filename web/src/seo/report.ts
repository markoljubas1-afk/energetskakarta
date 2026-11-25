/**
 * Monthly reports (Faza 29): one page with a permanent address for every complete month of the last two
 * years, about Croatia and the region, plus a list of them all. Everything comes from the ENTSO-E monthly
 * totals the site already publishes (and HEP ODS's release, when one came out that month); there are no
 * projections, only totals, shares and comparisons. A month counts once ENTSO-E has reported it in full
 * (`COMPLETE_COVERAGE`), so a report never shows half a month. No energy data for Croatia, no reports.
 */
import { intensity } from "../data/co2";
import { priceMonth } from "../data/priceMonths";
import { monthEnd } from "../data/storageMonths";
import { latestShare, RES_TARGET_2030 } from "../data/eurostat";
import { trend } from "../data/hep";
import { SCOPE_COUNTRIES, TECHNOLOGIES, type CountryCode } from "../domain";
import { createI18n } from "../i18n";
import { LANGS, type Lang } from "../state/url";
import { SOURCE_TERMS } from "./license";
import { COMPLETE_COVERAGE, largestSource, periodRows, type PeriodRow } from "./energyPages";
import type { FeedEntry } from "./feed";
import { callout, escapeHtml as e, linkedTable, list, stationsOf } from "./markup";
import { countOf, inMonth, monthName, REPORT_COPY } from "./reportCopy";
import { TRANSITION_COPY } from "./transitionCopy";
import { gasLinks } from "./gasPages";
import { ogImage } from "./ogImages";
import {
  homeCrumb,
  mapLink,
  other,
  PATHS,
  publisher,
  type Section,
  type SiteData,
  type StaticPage,
} from "./site";

/**
 * The first month with a report: the two years before the reports were launched (November 2026), so each could be
 * compared with the same month a year earlier. From then on every complete month is added and none is removed,
 * because each report promises a permanent address that can be cited (Faza 31: a sliding window of 24 months
 * deleted the oldest report every month).
 */
export const REPORTS_FROM = "2024-11";
/** How many of the latest reports go into the Atom feed. */
export const FEED_REPORTS = 3;
const ENTSOE_URL = "https://transparency.entsoe.eu/";

/**
 * The comparisons page (Faza 49, reports/CompareView.tsx), opened on a report's month: that month across
 * the years, and the countries in that month.
 */
export function compareLink(lang: Lang, month: string | null): string {
  if (month === null) return mapLink(lang, { p: "compare" });
  return mapLink(lang, { p: "compare", cm: String(Number(month.slice(5, 7))), cp: month });
}

/** A table row for `linkedTable` (at least one cell). */
type Row = [string, ...string[]];

interface Context {
  /** country → month ("2026-10") → its totals */
  byCountry: Map<CountryCode, Map<string, PeriodRow>>;
  /** the months with a report, oldest first */
  months: string[];
}

/** A month that can be reported: complete, and something was generated. */
const usable = (row: PeriodRow | undefined): row is PeriodRow =>
  row !== undefined && row.complete && row.total !== null && row.total > 0;

const contexts = new WeakMap<SiteData, Context | null>();

/** The months and their rows, worked out once per release (the pages, the links and the feed all ask). */
function context(site: SiteData): Context | null {
  const known = contexts.get(site);
  if (known !== undefined) return known;
  let found: Context | null = null;
  if (site.energy?.countries.HR) {
    const byCountry = new Map<CountryCode, Map<string, PeriodRow>>();
    for (const code of SCOPE_COUNTRIES) {
      const rows = periodRows(site.energy, code, "month");
      if (rows) byCountry.set(code, new Map(rows.map((row) => [row.period, row])));
    }
    const months = [...(byCountry.get("HR")?.values() ?? [])]
      .filter(usable)
      .map((row) => row.period)
      .filter((month) => month >= REPORTS_FROM);
    found = months.length > 0 ? { byCountry, months } : null;
  }
  contexts.set(site, found);
  return found;
}

/** The months with a report, oldest first (empty without data). */
export function reportMonths(site: SiteData): string[] {
  return context(site)?.months ?? [];
}

/** "2026-10" moved by `delta` months: shiftMonth("2026-01", -1) = "2025-12". */
export function shiftMonth(month: string, delta: number): string {
  const [year = 0, number = 1] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + delta;
  return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** g CO₂/kWh of a month's generation (storage not counted), or null. */
export function rowIntensity(row: PeriodRow): number | null {
  return intensity(TECHNOLOGIES.map((tech) => [tech, row.byTech[tech] ?? 0] as const));
}

/** The latest HEP ODS release published in `month`, with how many substations had free capacity. */
function hepRelease(
  site: SiteData,
  month: string,
): { published: string; dataDate: string; free: number; total: number } | null {
  const history = site.capacityHistory;
  if (!history) return null;
  const counts = trend(history);
  for (let index = history.snapshots.length - 1; index >= 0; index--) {
    const snapshot = history.snapshots[index];
    const count = counts[index];
    if (!snapshot || !count) continue;
    const published = snapshot.publishedAt ?? snapshot.dataDate;
    if (published.slice(0, 7) !== month) continue;
    return {
      published,
      dataDate: snapshot.dataDate,
      free: count.stations - count.existing.none,
      total: count.stations,
    };
  }
  return null;
}

/** The report's opening sentence: the month's renewable share against the month before and a year before. */
function leadSentence(lang: Lang, ctx: Context, month: string): string {
  const copy = REPORT_COPY[lang];
  const i18n = createI18n(lang);
  const hr = ctx.byCountry.get("HR");
  const row = hr?.get(month);
  if (!usable(row)) return "";
  const comparisons = [shiftMonth(month, -1), shiftMonth(month, -12)].flatMap((earlierMonth) => {
    const earlier = hr?.get(earlierMonth);
    return usable(earlier) && earlier.share !== null
      ? [copy.comparison(monthName(lang, earlierMonth), i18n.percent(earlier.share))]
      : [];
  });
  const co2 = rowIntensity(row);
  return copy.lead(
    inMonth(lang, month),
    i18n.percent(row.share ?? 0),
    comparisons,
    co2 === null ? null : i18n.number(Math.round(co2)),
  );
}

/** The month in a few points, each one a figure from the tables below, and the line that invites sharing. */
function briefSection(site: SiteData, lang: Lang, ctx: Context, month: string): Section | null {
  const copy = REPORT_COPY[lang].brief;
  const i18n = createI18n(lang);
  const hr = ctx.byCountry.get("HR");
  const row = hr?.get(month);
  if (!usable(row) || row.total === null) return null;
  const points: string[] = [];
  const main = largestSource(row);
  if (main) points.push(copy.main(i18n.technology(main), i18n.percent((row.byTech[main] ?? 0) / row.total)));
  if (row.share !== null) {
    const yearAgo = hr?.get(shiftMonth(month, -12));
    const before = usable(yearAgo) ? yearAgo.share : null;
    points.push(copy.renewable(i18n.percent(row.share), before === null ? null : i18n.percent(before)));
  }
  const co2 = rowIntensity(row);
  if (co2 !== null) points.push(copy.co2(i18n.number(Math.round(co2))));
  let top: { code: CountryCode; share: number } | null = null;
  for (const [code, rows] of ctx.byCountry) {
    const theirs = rows.get(month);
    if (usable(theirs) && theirs.share !== null && (top === null || theirs.share > top.share)) {
      top = { code, share: theirs.share };
    }
  }
  if (top) points.push(copy.top(i18n.country(top.code), i18n.percent(top.share)));
  // only a month whose every hour has a price says how many of them were free
  const prices = priceMonth(site.priceMonths, "HR", month);
  if (prices) {
    const lowest = i18n.number(prices.min, 2);
    points.push(
      prices.freeHours > 0
        ? copy.free(countOf(lang, "day", prices.freeDays), countOf(lang, "hour", prices.freeHours), lowest)
        : copy.neverFree(lowest),
    );
  }
  // the storage at the month's end, and at the same month's end a year earlier when that is known
  const stored = monthEnd(site.storageMonths, "HR", month);
  if (stored && site.storageMonths) {
    const before = monthEnd(site.storageMonths, "HR", shiftMonth(month, -12));
    const percent = (full: number): string => `${i18n.number(full, 1)} %`;
    points.push(
      copy.storage(
        percent(stored.full),
        i18n.date(stored.day),
        before ? percent(before.full) : null,
        site.storageMonths.attribution,
      ),
    );
  }
  return {
    heading: copy.heading,
    html: `${list(points.map((point) => e(point)))}<p>${e(copy.share)}</p><p><a href="${e(mapLink(lang, { pic: month }))}">${e(copy.picture)}</a></p>`,
  };
}

function sourcesSection(lang: Lang, ctx: Context, month: string): Section {
  const copy = REPORT_COPY[lang];
  const i18n = createI18n(lang);
  const hr = ctx.byCountry.get("HR");
  const months = [month, shiftMonth(month, -1), shiftMonth(month, -12)];
  const [row, previous, yearAgo] = months.map((m) => {
    const found = hr?.get(m);
    return usable(found) ? found : null;
  });
  const columns = [row, previous, yearAgo];
  const techs = TECHNOLOGIES.filter((tech) => columns.some((r) => (r?.byTech[tech] ?? 0) > 0)).sort(
    (a, b) => (row?.byTech[b] ?? 0) - (row?.byTech[a] ?? 0),
  );
  const energy = (r: PeriodRow | null | undefined, value: number | null | undefined): string =>
    r && value != null ? i18n.energy(value) : "";
  const total = row?.total ?? 0;
  const rows: Row[] = techs.map((tech) => [
    e(i18n.technology(tech)),
    energy(row, row?.byTech[tech]),
    row?.byTech[tech] !== undefined && total > 0 ? i18n.percent((row.byTech[tech] ?? 0) / total) : "",
    energy(previous, previous?.byTech[tech]),
    energy(yearAgo, yearAgo?.byTech[tech]),
  ]);
  const summary = (label: string, cell: (r: PeriodRow) => string): Row => [
    e(label),
    row ? cell(row) : "",
    "",
    previous ? cell(previous) : "",
    yearAgo ? cell(yearAgo) : "",
  ];
  const co2 = (r: PeriodRow): string => {
    const value = rowIntensity(r);
    return value === null ? "" : i18n.number(Math.round(value));
  };
  const load = (r: PeriodRow): string =>
    r.load !== null && r.loadCoverage >= COMPLETE_COVERAGE ? i18n.energy(r.load) : "";
  rows.push(
    summary(copy.sources.total, (r) => i18n.energy(r.total ?? 0)),
    summary(copy.sources.renewable, (r) => i18n.energy(r.renewable ?? 0)),
    summary(copy.sources.share, (r) => (r.share === null ? "" : i18n.percent(r.share))),
    summary(copy.sources.co2, co2),
  );
  if (columns.some((r) => r != null && load(r) !== "")) rows.push(summary(copy.sources.load, load));
  const [c0, c1, c2, c3, c4] = copy.sources.columns(
    monthName(lang, month),
    monthName(lang, shiftMonth(month, -1)),
    monthName(lang, shiftMonth(month, -12)),
  );
  return {
    heading: copy.sources.heading,
    html: linkedTable([c0, c1, c2, c3, c4], rows) + `<p>${e(copy.sources.note)}</p>`,
  };
}

function regionSection(lang: Lang, ctx: Context, month: string): Section {
  const copy = REPORT_COPY[lang];
  const i18n = createI18n(lang);
  const present = SCOPE_COUNTRIES.flatMap((code) => {
    const row = ctx.byCountry.get(code)?.get(month);
    return usable(row) ? [{ code, row }] : [];
  }).sort((a, b) => (b.row.share ?? 0) - (a.row.share ?? 0));
  const missing = SCOPE_COUNTRIES.filter((code) => !present.some((p) => p.code === code));
  const rows = present.map(({ code, row }): Row => {
    const co2 = rowIntensity(row);
    const largest = largestSource(row);
    return [
      `<a href="${PATHS[lang].country(code.toLowerCase())}">${e(i18n.country(code))}</a>`,
      i18n.energy(row.total ?? 0),
      row.share === null ? "" : i18n.percent(row.share),
      co2 === null ? "" : i18n.number(Math.round(co2)),
      largest ? i18n.technology(largest) : "",
    ];
  });
  const [c0, c1, c2, c3, c4] = copy.region.columns;
  return {
    heading: copy.region.heading(monthName(lang, month)),
    html:
      linkedTable([c0, c1, c2, c3, c4], rows) +
      `<p>${e(copy.region.note)}</p>` +
      (missing.length > 0
        ? `<p>${e(copy.region.missing(missing.map((code) => i18n.country(code)).join(", ")))}</p>`
        : ""),
  };
}

function reportPage(site: SiteData, lang: Lang, ctx: Context, month: string): StaticPage {
  const copy = REPORT_COPY[lang];
  const i18n = createI18n(lang);
  const name = monthName(lang, month);
  const row = ctx.byCountry.get("HR")?.get(month);
  const load =
    row && row.load !== null && row.loadCoverage >= COMPLETE_COVERAGE ? i18n.energy(row.load) : null;
  const brief = briefSection(site, lang, ctx, month);
  const sections: Section[] = [
    ...(brief ? [brief] : []),
    sourcesSection(lang, ctx, month),
    regionSection(lang, ctx, month),
  ];

  const hep = hepRelease(site, month);
  if (hep) {
    sections.push({
      heading: copy.hep.heading,
      html:
        `<p>${e(copy.hep.sentence(i18n.date(hep.published), i18n.date(hep.dataDate), i18n.number(hep.free), stationsOf(lang, hep.total)))}</p>` +
        (site.capacity ? list([`<a href="${PATHS[lang].capacity}">${e(copy.hep.link)}</a>`]) : ""),
    });
  }
  sections.push({ heading: copy.method.heading, html: list(copy.method.items.map((item) => e(item))) });

  const at = ctx.months.indexOf(month);
  const previous = ctx.months[at - 1];
  const next = ctx.months[at + 1];
  // outside the page hash: the next month's arrival does not make this report look changed
  const nav = {
    heading: copy.nav.heading,
    html: list([
      ...(previous
        ? [`<a href="${PATHS[lang].report(previous)}">${e(copy.nav.previous(monthName(lang, previous)))}</a>`]
        : []),
      ...(next
        ? [`<a href="${PATHS[lang].report(next)}">${e(copy.nav.next(monthName(lang, next)))}</a>`]
        : []),
      `<a href="${PATHS[lang].reports}">${e(copy.linkText)}</a>`,
      `<a href="${PATHS[lang].transition}">${e(TRANSITION_COPY[lang].linkText)}</a>`,
      ...gasLinks(site, lang),
    ]),
  };

  const path = PATHS[lang].report(month);
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].report(month),
    title: copy.title(name),
    description: copy.description(name),
    heading: copy.title(name),
    lead:
      `<p>${e(leadSentence(lang, ctx, month))}</p>` +
      (row?.total != null ? `<p>${e(copy.totals(i18n.energy(row.total), load))}</p>` : "") +
      callout(copy.compare.month(name), { href: compareLink(lang, month), label: copy.compare.label }),
    sections,
    nav,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: copy.title(name),
        description: copy.description(name),
        inLanguage: lang,
        isAccessibleForFree: true,
        temporalCoverage: month,
        spatialCoverage: { "@type": "Place", name: i18n.country("HR") },
        variableMeasured: copy.variables.map((variable) => ({ "@type": "PropertyValue", name: variable })),
        isBasedOn: [ENTSOE_URL, ...(hep ? ["https://kapaciteti.hep.hr/"] : [])],
        license: [SOURCE_TERMS.entsoe, ...(hep ? [SOURCE_TERMS.hepOds] : [])],
        publisher: publisher(site, i18n),
        ...(site.siteUrl ? { url: site.siteUrl + path } : {}),
      },
    ],
    lastModified: site.energyUpdatedAt ?? site.current.createdAt,
    image: ogImage("report", lang),
    breadcrumbs: [homeCrumb(lang), { name: copy.indexTitle, path: PATHS[lang].reports }],
  };
}

function indexPage(site: SiteData, lang: Lang, ctx: Context): StaticPage {
  const copy = REPORT_COPY[lang];
  const i18n = createI18n(lang);
  const hr = ctx.byCountry.get("HR");
  const rows = [...ctx.months].reverse().flatMap((month): Row[] => {
    const row = hr?.get(month);
    if (!usable(row)) return [];
    const co2 = rowIntensity(row);
    return [
      [
        `<a href="${PATHS[lang].report(month)}">${e(monthName(lang, month))}</a>`,
        row.share === null ? "" : i18n.percent(row.share),
        co2 === null ? "" : i18n.number(Math.round(co2)),
        i18n.energy(row.total ?? 0),
      ],
    ];
  });
  const [c0, c1, c2, c3] = copy.indexColumns;
  const sections: Section[] = [{ heading: copy.indexSection, html: linkedTable([c0, c1, c2, c3], rows) }];
  // the official yearly share changes once a year: here, not on every report, so the reports stay as they were
  const official = site.renewables ? latestShare(site.renewables, "HR", "REN") : null;
  if (official) {
    sections.push({
      heading: copy.official.heading,
      html:
        `<p>${e(
          copy.official.sentence(
            String(official.year),
            i18n.percent(official.value / 100),
            i18n.percent(RES_TARGET_2030 / 100),
          ),
        )}</p>` + list([`<a href="${PATHS[lang].transition}">${e(TRANSITION_COPY[lang].linkText)}</a>`]),
    });
  }
  sections.push({ heading: copy.method.heading, html: list(copy.method.items.map((item) => e(item))) });
  const first = ctx.months[0] ?? "";
  const last = ctx.months.at(-1) ?? "";
  const path = PATHS[lang].reports;
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].reports,
    title: copy.indexTitle,
    description: copy.indexDescription,
    heading: copy.indexTitle,
    lead:
      `<p>${e(copy.indexLead)}</p>` +
      callout(copy.compare.index, { href: compareLink(lang, null), label: copy.compare.label }),
    sections,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: copy.indexTitle,
        description: copy.indexDescription,
        inLanguage: lang,
        isAccessibleForFree: true,
        temporalCoverage: `${first}/${last}`,
        spatialCoverage: { "@type": "Place", name: i18n.country("HR") },
        variableMeasured: copy.variables.map((variable) => ({ "@type": "PropertyValue", name: variable })),
        isBasedOn: [ENTSOE_URL],
        license: SOURCE_TERMS.entsoe,
        publisher: publisher(site, i18n),
        ...(site.siteUrl ? { url: site.siteUrl + path } : {}),
      },
    ],
    lastModified: site.energyUpdatedAt ?? site.current.createdAt,
    image: ogImage("report", lang),
    breadcrumbs: [homeCrumb(lang)],
  };
}

/** The list and every month's report, in both languages; nothing without Croatia's monthly data. */
export function reportPages(site: SiteData): StaticPage[] {
  const ctx = context(site);
  if (!ctx) return [];
  return LANGS.flatMap((lang) => [
    indexPage(site, lang, ctx),
    ...ctx.months.map((month) => reportPage(site, lang, ctx, month)),
  ]);
}

/** Links for other pages: the list of reports and, with `latest`, the newest report; empty without reports. */
export function reportLinks(site: SiteData, lang: Lang, { latest = false } = {}): string[] {
  const months = reportMonths(site);
  const newest = months.at(-1);
  if (newest === undefined) return [];
  const copy = REPORT_COPY[lang];
  return [
    ...(latest
      ? [`<a href="${PATHS[lang].report(newest)}">${e(copy.latestLink(monthName(lang, newest)))}</a>`]
      : []),
    `<a href="${PATHS[lang].reports}">${e(copy.linkText)}</a>`,
  ];
}

/**
 * The newest reports as feed entries, dated by the day their content last changed (`lastmods`, from the SEO
 * manifest), so a reader sees a report when it appears and again only when ENTSO-E's corrections change it.
 */
export function reportFeedEntries(
  site: SiteData,
  lang: Lang,
  lastmods: ReadonlyMap<string, string>,
): FeedEntry[] {
  const ctx = context(site);
  if (!ctx || !site.siteUrl) return [];
  const siteUrl = site.siteUrl;
  return ctx.months
    .slice(-FEED_REPORTS)
    .reverse()
    .map((month) => {
      const page = reportPage(site, lang, ctx, month);
      const day = lastmods.get(page.path);
      return {
        id: siteUrl + page.path,
        title: page.title,
        link: siteUrl + page.path,
        html: page.lead,
        updated: day ? `${day}T00:00:00Z` : page.lastModified,
      };
    });
}
