/**
 * The energy transition page (Faza 20-3): indicators for Croatia from data the site already publishes:
 * the official renewable share that the NECP target is measured by (Eurostat, Faza 28), the renewable share
 * of generation and the carbon intensity of generation (ENTSO-E), installed renewable capacity and closed
 * fossil plants (the time machine's timeline), what is being built (the release's statistics) and free grid
 * capacity (HEP ODS). Every section needs its data; with none of it there is no page. Without Eurostat's
 * share the target is only explained, because it covers all energy, not only electricity.
 */
import { intensity } from "../data/co2";
import { series } from "../data/energy";
import {
  EU_AREA,
  latestShare,
  RES_INDICATORS,
  RES_TARGET_2030,
  shareAt,
  type Renewables,
  type Share,
} from "../data/eurostat";
import { countByCategory } from "../data/hep";
import { summarize } from "../data/stats";
import type { Timeline } from "../data/timeline";
import { isOneOf, SCOPE_COUNTRIES, TECHNOLOGIES, type Technology } from "../domain";
import { createI18n } from "../i18n";
import { LANGS, type Lang } from "../state/url";
import { COMPLETE_COVERAGE, lastComplete, RENEWABLE, yearRows } from "./energyPages";
import {
  homeCrumb,
  latestDate,
  PATHS,
  publisher,
  type Section,
  type SiteData,
  type StaticPage,
} from "./site";
import { counted, escapeHtml as e, linkedTable, list, stationsOf } from "./markup";
import { monthName } from "./reportCopy";
import { geothermalLinks } from "./geothermal";
import { reportLinks } from "./report";
import { REPORT_COPY } from "./reportCopy";
import { TRANSITION_COPY } from "./transitionCopy";

const FOSSIL: readonly Technology[] = ["coal", "lignite", "gas", "oil"];
export { RES_TARGET_2030 };
const OFFICIAL_YEARS = 10;
const CAPACITY_YEARS = [1960, 1970, 1980, 1990, 2000, 2010, 2015, 2020];
const SHARE_YEARS = 10;
const CO2_MONTHS = 12;

const other = (lang: Lang): Lang => (lang === "hr" ? "en" : "hr");
/** A table row for `linkedTable` (at least one cell). */
type Row = [string, ...string[]];

/** Whether the release has enough for the page (generation, the timeline or Eurostat's share for Croatia). */
export function hasTransition(site: SiteData): boolean {
  return (
    Boolean(site.energy?.countries.HR) ||
    Boolean(site.timeline?.series.HR) ||
    Boolean(site.renewables && latestShare(site.renewables, "HR", "REN"))
  );
}

/** The link to the page for other pages; empty when there is no page. */
export const transitionLinks = (site: SiteData, lang: Lang): string[] =>
  hasTransition(site) ? [`<a href="${PATHS[lang].transition}">${e(TRANSITION_COPY[lang].linkText)}</a>`] : [];

/** Monthly carbon intensity of Croatia's generation, complete months only, oldest first. */
export function monthlyIntensity(site: SiteData): { month: string; value: number }[] {
  if (!site.energy?.countries.HR) return [];
  const data = series(site.energy, "HR", "month");
  return data.periods.flatMap((month, index) => {
    if ((data.coverage[index] ?? 0) < COMPLETE_COVERAGE) return [];
    const parts = TECHNOLOGIES.map((tech) => [tech, data.generation[tech]?.[index] ?? 0] as const);
    const value = intensity(parts);
    return value === null ? [] : [{ month, value }];
  });
}

/** Installed renewable capacity by year from the timeline: hydro, wind, solar, other renewables. */
export function renewableCapacity(
  timeline: Timeline,
  year: number,
): { hydro: number; wind: number; solar: number; other: number } {
  const index = year - timeline.firstYear;
  const at = (tech: string): number => timeline.series.HR?.[tech]?.[index] ?? 0;
  const otherMw = RENEWABLE.filter((t) => t !== "hydro" && t !== "wind" && t !== "solar").reduce(
    (s, t) => s + at(t),
    0,
  );
  return { hydro: at("hydro"), wind: at("wind"), solar: at("solar"), other: otherMw };
}

/** Eurostat's share, percent → "34,1 %"; a flag, or the year of an earlier value, in brackets. */
function shareCell(lang: Lang, share: Share | null, year: number): string {
  if (!share) return "";
  const i18n = createI18n(lang);
  const notes = [
    share.flag,
    share.year === year ? null : TRANSITION_COPY[lang].compare.earlier(String(share.year)),
  ];
  const shown = notes.filter((note): note is string => Boolean(note));
  const value = i18n.percent(share.value / 100);
  return shown.length > 0 ? `${value} (${shown.join("; ")})` : value;
}

/** "p – privremeno, b – prekid vremenske serije" for the flags among `shares`, or nothing. */
function flagLegend(doc: Renewables, lang: Lang, shares: (Share | null)[]): string {
  const copy = TRANSITION_COPY[lang].official;
  const used = [...new Set(shares.flatMap((share) => (share?.flag ? [share.flag] : [])))].sort();
  if (used.length === 0) return "";
  const words = used.map((flag) => {
    const word =
      lang === "en"
        ? (doc.flagLabels[flag] ?? copy.flagWords[flag])
        : (copy.flagWords[flag] ?? doc.flagLabels[flag]);
    return `${flag} – ${word ?? flag}`;
  });
  return `<p>${e(copy.flags(words.join(", ")))}</p>`;
}

/**
 * Eurostat's official share: the lead sentence, Croatia over the last years against the 2030 target, and the
 * region in Croatia's latest year. Null without Croatia's overall share.
 */
export function officialSections(
  doc: Renewables,
  lang: Lang,
): { lead: string; sections: Section[]; year: number } | null {
  const latest = latestShare(doc, "HR", "REN");
  if (!latest) return null;
  const copy = TRANSITION_COPY[lang];
  const i18n = createI18n(lang);
  const pct = (value: number): string => i18n.percent(value / 100);
  const year = latest.year;
  const target = pct(RES_TARGET_2030);
  // the gap is taken from the share as shown (one decimal), so "42,5 %" never sits next to "0 points short"
  const shown = Math.round(latest.value * 10) / 10;
  const gap = Math.round((RES_TARGET_2030 - shown) * 10) / 10;
  const eu = shareAt(doc, EU_AREA, "REN", year);
  const opening = [
    copy.official.sentence(String(year), pct(latest.value), eu ? pct(eu.value) : null),
    gap >= 0.1
      ? copy.official.gap(target, counted(lang, gap, copy.official.points, 1))
      : copy.official.reached(target),
  ].join(" ");

  const updated = doc.updated ? copy.official.updated(i18n.date(doc.updated)) : "";
  const tail = ` (CC BY 4.0)${updated}`;
  const source =
    `<p>${e(copy.official.source)} <a href="${e(doc.sourceUrl)}">Eurostat, ${e(doc.dataset)}</a>` +
    `${e(tail)}${tail.endsWith(".") ? "" : "."}</p>`;

  const years = doc.years.filter((y) => shareAt(doc, "HR", "REN", y) !== null).slice(-OFFICIAL_YEARS);
  const history = years.map((y) => RES_INDICATORS.map((indicator) => shareAt(doc, "HR", indicator, y)));
  const historyRows = years.map((y, i): Row => [
    String(y),
    ...(history[i] ?? []).map((share) => shareCell(lang, share, y)),
  ]);

  /** the eight countries, linked to their pages, then the EU; each with its four shares */
  const named: { code: string; label: string; name: string }[] = [
    ...SCOPE_COUNTRIES.map((code) => ({
      code,
      label: i18n.country(code),
      name: `<a href="${PATHS[lang].country(code.toLowerCase())}">${e(i18n.country(code))}</a>`,
    })),
    { code: EU_AREA, label: copy.compare.eu, name: e(copy.compare.eu) },
  ];
  const areas = named.map((area) => ({
    ...area,
    shares: RES_INDICATORS.map((indicator) => latestShare(doc, area.code, indicator, year)),
  }));
  const present = areas.filter((area) => area.shares.some((share) => share !== null));
  const countries = present
    .filter((area) => area.code !== EU_AREA)
    .sort((a, b) => (b.shares[0]?.value ?? -1) - (a.shares[0]?.value ?? -1));
  const compared = [...countries, ...present.filter((area) => area.code === EU_AREA)];
  const missing = areas.filter((area) => !present.includes(area)).map((area) => area.label);
  const c = copy.official.columns;
  const k = copy.compare.columns;

  return {
    year,
    lead: copy.leadOfficial(String(year), pct(latest.value), target),
    sections: [
      {
        heading: copy.official.heading,
        html:
          `<p>${e(opening)}</p>` +
          linkedTable([c[0], c[1], c[2], c[3], c[4]], historyRows) +
          flagLegend(doc, lang, history.flat()) +
          `<p>${e(copy.official.electricity)}</p>` +
          source,
      },
      {
        heading: copy.compare.heading(String(year)),
        html:
          linkedTable(
            [k[0], k[1], k[2], k[3], k[4]],
            compared.map((area): Row => [
              area.name,
              ...area.shares.map((share) => shareCell(lang, share, year)),
            ]),
          ) +
          flagLegend(
            doc,
            lang,
            compared.flatMap((area) => area.shares),
          ) +
          `<p>${e(copy.compare.note(String(year)))}</p>` +
          (missing.length > 0 ? `<p>${e(copy.compare.missing(missing.join(", ")))}</p>` : "") +
          source,
      },
    ],
  };
}

function transitionPage(site: SiteData, lang: Lang): StaticPage | null {
  if (!hasTransition(site)) return null;
  const copy = TRANSITION_COPY[lang];
  const i18n = createI18n(lang);
  const official = site.renewables ? officialSections(site.renewables, lang) : null;
  const sections: StaticPage["sections"] = [...(official?.sections ?? [])];
  const lead: string[] = official ? [official.lead] : [];

  // renewable share of generation
  const rows = site.energy ? (yearRows(site.energy, "HR") ?? []) : [];
  const complete = rows.filter((row) => row.complete && row.share !== null && row.total !== null);
  const last = lastComplete(rows);
  if (last?.share != null) {
    const prev = complete.filter((row) => row.year < last.year).at(-1);
    lead.push(
      prev?.share != null
        ? copy.leadShare(last.year, i18n.percent(last.share), prev.year, i18n.percent(prev.share))
        : copy.leadShareOnly(last.year, i18n.percent(last.share)),
    );
  }
  if (complete.length > 0) {
    const c = copy.share.columns;
    sections.push({
      heading: copy.share.heading,
      html:
        linkedTable(
          [c[0], c[1], c[2], c[3]],
          complete
            .slice(-SHARE_YEARS)
            .map((y): Row => [
              y.year,
              i18n.energy(y.total ?? 0),
              i18n.energy(y.renewable ?? 0),
              y.share === null ? "" : i18n.percent(y.share),
            ]),
        ) + `<p>${e(copy.share.note)}</p>`,
    });
  }

  // carbon intensity of generation
  const months = monthlyIntensity(site);
  const lastMonth = months.at(-1);
  if (lastMonth) {
    lead.push(copy.leadCo2(monthName(lang, lastMonth.month), i18n.number(Math.round(lastMonth.value))));
    sections.push({
      heading: copy.co2.heading,
      html:
        linkedTable(
          [copy.co2.columns[0], copy.co2.columns[1]],
          months
            .slice(-CO2_MONTHS)
            .map((m): Row => [monthName(lang, m.month), i18n.number(Math.round(m.value))]),
        ) + `<p>${e(copy.co2.note)}</p>`,
    });
  }

  // installed renewable capacity, and closed fossil plants (timeline)
  const timeline = site.timeline;
  if (timeline?.series.HR) {
    const years = [
      ...CAPACITY_YEARS.filter((y) => y >= timeline.firstYear && y < timeline.lastYear),
      timeline.lastYear,
    ];
    const table = years.map((year) => {
      const mw = renewableCapacity(timeline, year);
      const total = mw.hydro + mw.wind + mw.solar + mw.other;
      return { year, mw, total };
    });
    const now = table.at(-1);
    if (now && now.total > 0) lead.push(copy.leadCapacity(String(now.year), i18n.power(now.total)));
    const c = copy.capacity.columns;
    sections.push({
      heading: copy.capacity.heading,
      html:
        linkedTable(
          [c[0], c[1], c[2], c[3], c[4], c[5]],
          table.map(({ year, mw, total }): Row => [
            String(year),
            i18n.power(mw.hydro),
            i18n.power(mw.wind),
            i18n.power(mw.solar),
            i18n.power(mw.other),
            i18n.power(total),
          ]),
        ) + `<p>${e(copy.capacity.note(i18n.number(timeline.undated.HR?.plants ?? 0)))}</p>`,
    });
    const closed = timeline.retired
      .filter((p) => p.country === "HR" && isOneOf(FOSSIL, p.technology))
      .sort((a, b) => b.retiredYear - a.retiredYear || b.capacityMw - a.capacityMw);
    sections.push({
      heading: copy.closed.heading,
      html:
        closed.length > 0
          ? list(
              closed.map((p) =>
                e(copy.closed.item(p.name, p.commissioningYear, p.retiredYear, i18n.power(p.capacityMw))),
              ),
            )
          : `<p>${e(copy.closed.none)}</p>`,
    });
  }

  // what is being built (the release's statistics)
  const summary = summarize(site.stats, "HR", SCOPE_COUNTRIES);
  if (summary.pipelineMw > 0) {
    const renewable = summary.technologies
      .filter((t) => isOneOf(RENEWABLE, t.technology))
      .reduce((s, t) => s + t.pipelineMw, 0);
    const c = copy.pipeline.columns;
    sections.push({
      heading: copy.pipeline.heading,
      html:
        `<p>${e(copy.pipeline.sentence(i18n.power(summary.pipelineMw), i18n.percent(renewable / summary.pipelineMw)))}</p>` +
        linkedTable(
          [c[0], c[1], c[2]],
          summary.technologies
            .filter((t) => t.pipelineMw > 0)
            .sort((a, b) => b.pipelineMw - a.pipelineMw)
            .map((t): Row => [
              e(i18n.technology(t.technology)),
              i18n.power(t.operatingMw),
              i18n.power(t.pipelineMw),
            ]),
        ),
    });
  }

  // free grid capacity (HEP ODS)
  if (site.capacity) {
    const counts = countByCategory(site.capacity.stations, "existing");
    const total = counts.none + counts.A + counts.B + counts.C + counts.D;
    if (total > 0) {
      sections.push({
        heading: copy.grid.heading,
        html:
          `<p>${e(copy.grid.sentence(i18n.number(total - counts.none), stationsOf(lang, total), i18n.date(site.capacity.dataDate)))}</p>` +
          list([`<a href="${PATHS[lang].capacity}">${e(copy.grid.link)}</a>`]),
      });
    }
  }

  const reports = reportLinks(site, lang, { latest: true });
  if (reports.length > 0) sections.push({ heading: REPORT_COPY[lang].indexTitle, html: list(reports) });
  const geo = geothermalLinks(site, lang);
  if (geo.length > 0) sections.push({ heading: copy.geothermalHeading, html: list(geo) });
  sections.push({
    heading: copy.target.heading,
    html: `<p>${e(official ? copy.target.measured : copy.target.text)}</p>`,
  });
  const method = [...copy.method.items, ...(official ? [copy.method.official] : [])];
  sections.push({ heading: copy.method.heading, html: list(method.map((item) => e(item))) });

  const path = PATHS[lang].transition;
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].transition,
    title: copy.title,
    description: official ? copy.descriptionOfficial : copy.description,
    heading: copy.heading,
    lead: lead.map((sentence) => `<p>${e(sentence)}</p>`).join(""),
    sections,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: copy.title,
        description: official ? copy.descriptionOfficial : copy.description,
        inLanguage: lang,
        isAccessibleForFree: true,
        spatialCoverage: { "@type": "Country", name: i18n.country("HR") },
        variableMeasured: [...(official ? [copy.variableOfficial] : []), ...copy.variables].map((name) => ({
          "@type": "PropertyValue",
          name,
        })),
        isBasedOn: [
          ...(official && site.renewables ? [site.renewables.sourceUrl] : []),
          "https://transparency.entsoe.eu/",
          "https://www.openstreetmap.org/",
          "https://globalenergymonitor.org/",
          "https://kapaciteti.hep.hr/",
        ],
        publisher: publisher(site, i18n),
        ...(site.siteUrl ? { url: site.siteUrl + path } : {}),
      },
    ],
    lastModified: latestDate(
      [
        site.current.createdAt,
        site.energyUpdatedAt,
        site.capacity?.publishedAt,
        site.renewables?.retrievedAt,
      ],
      site.current.createdAt,
    ),
    breadcrumbs: [homeCrumb(lang)],
  };
}

/** The page in both languages, when the release has the data. */
export function transitionPages(site: SiteData): StaticPage[] {
  return LANGS.flatMap((lang) => {
    const page = transitionPage(site, lang);
    return page ? [page] : [];
  });
}
