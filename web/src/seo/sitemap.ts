/** sitemap.xml, robots.txt and llms.txt for a release. All three need the public address of the site. */
import { DOWNLOAD_KEYS, SCOPE_COUNTRIES } from "../domain";
import { createI18n } from "../i18n";
import { DOWNLOAD_LABELS } from "../i18n/labels";
import { COPY } from "./copy";
import { downloadUrl, LARGEST_ROWS, PATHS, type SiteData, type StaticPage } from "./site";
import { escapeHtml as e } from "./markup";
import { groupHubs } from "./countryPages";
import { hasGenerationOverview, hasPrices } from "./energyPages";
import { hasGeothermal } from "./geothermal";
import { hasFeed } from "./feed";
import { compareLink, reportMonths } from "./report";
import { monthName } from "./reportCopy";
import { hasTransition } from "./transition";
import { hasGasPage } from "./gasPages";
import { gasPlacePages } from "./gasPlaces";

/** Sitemaps are capped at 50 000 URLs; the pages are split into files of this many, home first. */
export const SITEMAP_CHUNK = 5000;

export interface SitemapFile {
  path: string;
  xml: string;
}

function urlEntry(siteUrl: string, page: StaticPage, lastmod: string): string {
  const alternates = [
    [page.lang, page.path],
    [page.lang === "hr" ? "en" : "hr", page.alternatePath],
  ] as const;
  const links = alternates
    .map(([lang, path]) => `<xhtml:link rel="alternate" hreflang="${lang}" href="${e(siteUrl + path)}"/>`)
    .join("");
  const xDefault = `<xhtml:link rel="alternate" hreflang="x-default" href="${e(siteUrl + (page.lang === "hr" ? page.path : page.alternatePath))}"/>`;
  return `<url><loc>${e(siteUrl + page.path)}</loc><lastmod>${e(lastmod)}</lastmod>${links}${xDefault}</url>`;
}

/**
 * The home page (the map itself) plus every static page, as one or more sitemap files and an index. A page's
 * lastmod comes from `lastmods` (the SEO manifest: the day its content last changed) when given.
 */
export function sitemapFiles(
  siteUrl: string,
  pages: StaticPage[],
  lastModified: string,
  lastmods: ReadonlyMap<string, string> = new Map(),
): SitemapFile[] {
  // the map in both languages (/ and /en/, todo 16-A3); it changes with every data release
  const homeAlternates = `<xhtml:link rel="alternate" hreflang="hr" href="${e(`${siteUrl}/`)}"/><xhtml:link rel="alternate" hreflang="en" href="${e(`${siteUrl}/en/`)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${e(`${siteUrl}/`)}"/>`;
  const homes = ["/", "/en/"].map(
    (path) =>
      `<url><loc>${e(siteUrl + path)}</loc><lastmod>${e(lastModified.slice(0, 10))}</lastmod>${homeAlternates}</url>`,
  );
  const entries = [
    ...homes,
    ...pages.map((page) =>
      urlEntry(siteUrl, page, lastmods.get(page.path) ?? page.lastModified.slice(0, 10)),
    ),
  ];
  const open = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n`;
  const close = `\n</urlset>\n`;
  if (entries.length <= SITEMAP_CHUNK) {
    return [{ path: "/sitemap.xml", xml: open + entries.join("\n") + close }];
  }
  const files: SitemapFile[] = [];
  for (let i = 0; i * SITEMAP_CHUNK < entries.length; i++) {
    const chunk = entries.slice(i * SITEMAP_CHUNK, (i + 1) * SITEMAP_CHUNK);
    files.push({ path: `/sitemap-${i + 1}.xml`, xml: open + chunk.join("\n") + close });
  }
  const index =
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    files
      .map(
        (f) =>
          `<sitemap><loc>${e(siteUrl + f.path)}</loc><lastmod>${e(lastModified.slice(0, 10))}</lastmod></sitemap>`,
      )
      .join("\n") +
    `\n</sitemapindex>\n`;
  return [{ path: "/sitemap.xml", xml: index }, ...files];
}

/** Everyone may crawl, search engines and AI assistants alike: the data is open and meant to be found. */
export function robotsTxt(siteUrl: string | null): string {
  return [
    "User-agent: *",
    "Allow: /",
    "",
    "# AI assistants are welcome; the data is open (ODbL, CC BY) and citing this site is the point.",
    // training crawlers, AI search indexes and the fetchers that act on a user's question, by name
    ...[
      "GPTBot",
      "OAI-SearchBot",
      "ChatGPT-User",
      "ClaudeBot",
      "Claude-SearchBot",
      "Claude-User",
      "PerplexityBot",
      "Perplexity-User",
      "Google-Extended",
      "Applebot-Extended",
      "CCBot",
    ].flatMap((agent) => [`User-agent: ${agent}`, "Allow: /", ""]),
    ...(siteUrl ? [`Sitemap: ${siteUrl}/sitemap.xml`] : []),
    "",
  ].join("\n");
}

/** llms.txt: what the site is, in plain words, with the links an assistant should follow. */
export function llmsTxt(site: SiteData): string {
  const base = site.siteUrl ?? "";
  const hr = COPY.hr;
  const en = COPY.en;
  const i18nHr = createI18n("hr");
  const i18nEn = createI18n("en");
  const downloads = DOWNLOAD_KEYS.flatMap((key) => {
    const file = site.current.downloads[key];
    if (!file) return [];
    const url = downloadUrl(site, file);
    return [
      `- [${i18nEn.t(DOWNLOAD_LABELS[key])} / ${i18nHr.t(DOWNLOAD_LABELS[key])}](${url}): NDJSON, gzip, ODbL; non-commercial as a whole`,
    ];
  });
  const hubs = groupHubs(site);
  const countries = SCOPE_COUNTRIES.map((code) => {
    const topics = [...(hubs.get(code)?.keys() ?? [])].map(
      (key) => `[${en.hub.plural[key].toLowerCase()}](${base}${PATHS.en.hub(code.toLowerCase(), key)})`,
    );
    return `- [${i18nEn.country(code)}](${base}${PATHS.en.country(code.toLowerCase())}) · [${i18nHr.country(code)}](${base}${PATHS.hr.country(code.toLowerCase())})${topics.length ? `: ${topics.join(", ")}` : ""}`;
  });
  return [
    `# ${en.siteTitle}`,
    "",
    `> ${en.siteDescription}`,
    "",
    `> ${hr.siteDescription}`,
    "",
    `Data release: ${site.current.buildId} (${site.current.createdAt}). Licence of the data: ODbL 1.0 with attribution; parts CC BY 4.0 (Global Energy Monitor) and CC BY-NC 4.0 (TransitionZero Solar Asset Mapper), so the downloads are for non-commercial use as a whole; every record names its licence. Code: MIT.`,
    "",
    "## Pages",
    "",
    `Every page below also exists as Markdown: add index.md to its address (e.g. ${base}${PATHS.en.about}index.md). The main English pages in one file: ${base}/llms-full.txt`,
    "",
    `- [About the map (English)](${base}${PATHS.en.about}): sources, licences, update schedule, FAQ`,
    `- [O karti (hrvatski)](${base}${PATHS.hr.about})`,
    `- [Learn: how electricity and gas reach a home (English)](${base}${PATHS.en.learn}): the path of electricity and of gas explained step by step, a glossary and questions answered, each fact with its source`,
    `- [Who is behind GridAtlas (English)](${base}${PATHS.en.author}): who makes the map, why, and how to get in touch`,
    `- [Interactive map](${base}/): every asset; the URL carries the view, filters and the selected asset`,
    `- [Largest power plants in the region](${base}${PATHS.en.largest}): the ${LARGEST_ROWS} largest by recorded capacity`,
    ...(hasGenerationOverview(site)
      ? [
          `- [Electricity generation by country and source (English)](${base}${PATHS.en.generation}): yearly totals by source and the renewable share, ENTSO-E data`,
        ]
      : []),
    ...(hasGeothermal(site)
      ? [
          `- [Geothermal energy in Croatia (English)](${base}${PATHS.en.geothermal}): power plants and heat in operation, projects, cities with confirmed potential, heat-flow potential and the heat cascade; every site with its source`,
        ]
      : []),
    ...(hasTransition(site)
      ? [
          `- [Croatia's energy transition: indicators (English)](${base}${PATHS.en.transition}): ${site.renewables ? "the official renewable share of gross final energy consumption (Eurostat) against the 2030 target and compared with the neighbours, " : ""}renewable share and carbon intensity of electricity generation, installed renewable capacity, what is being built and closed, free grid capacity; with methodology`,
        ]
      : []),
    ...(hasGasPage(site)
      ? [
          `- [Gas in Croatia: the day's picture (English)](${base}${PATHS.en.gas}): what entered the gas transmission system on the latest gas day and at which point (the LNG terminal on Krk, domestic fields, storage, the borders), how much was delivered to customers on each of the last gas days, and how full the gas storage facilities are; from the ENTSOG Transparency Platform and GIE AGSI, rebuilt daily`,
        ]
      : []),
    ...gasPlacePages(site)
      .filter((page) => page.lang === "en")
      .map((page) => `- [${page.heading}](${base}${page.path}): ${page.description}`),
    ...(reportMonths(site).length > 0
      ? [
          `- [Monthly reports: electricity in Croatia and the region (English)](${base}${PATHS.en.reports}): one page per complete month with generation by source, the renewable share and carbon intensity in Croatia, compared with the previous month, the same month a year earlier and the neighbours; latest: [${monthName("en", reportMonths(site).at(-1) ?? "")}](${base}${PATHS.en.report(reportMonths(site).at(-1) ?? "")})`,
          `- [Comparisons (interactive)](${base}${compareLink("en", null)}): the same month across the years, one year against another over the months both reported in full, and the countries side by side, with the monthly reports' figures; every choice is kept in the address, so a comparison can be linked`,
        ]
      : []),
    ...(hasPrices(site)
      ? [
          `- [Electricity prices today and tomorrow (English)](${base}${PATHS.en.prices}): hourly day-ahead prices per bidding zone, rebuilt daily`,
        ]
      : []),
    ...(site.capacity
      ? [
          `- [Free grid capacity, HEP ODS (English)](${base}${PATHS.en.capacity}): acceptance category and free capacity per substation in Croatia's distribution grid, by area and over time; data reused with HEP ODS's permission, for information only`,
        ]
      : []),
    ...(site.cities
      ? [
          `- [City register (English)](${base}${PATHS.en.cities}): electricity by purpose per city, Covenant of Mayors data`,
        ]
      : []),
    "",
    "## Countries",
    "",
    ...countries,
    "",
    "## Open JSON and feed",
    "",
    `- [API documentation](${base}${PATHS.en.api}): static JSON per country (${base}/api/zemlja/hr.json), per asset (${base}/api/objekt/{slug}.json) and the index (${base}/api/index.json)`,
    ...(hasFeed(site) ? [`- [Atom feed: data changes and monthly reports](${base}/en/feed.xml)`] : []),
    "",
    "## Downloads",
    "",
    ...downloads,
    "",
    "## Notes for assistants",
    "",
    "- Capacity figures are sums of what the sources record; treat them as lower bounds.",
    "- Every asset page names its sources; OpenStreetMap objects link to their OSM page.",
    `- The full list of asset pages is in the sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");
}
