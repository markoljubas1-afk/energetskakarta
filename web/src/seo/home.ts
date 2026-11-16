/**
 * The home pages are the map itself: `/` in Croatian and `/en/` in English (todo 16-A3), both made from the
 * index.html Vite builds. Crawlers that do not run JavaScript, and the first response every crawler gets, see
 * only what is in that file, so the prerender step writes into it what the static pages carry: the absolute
 * canonical, language alternates, share image and address, WebSite JSON-LD, and a summary per country with
 * links into the static pages. The application replaces the summary as soon as it starts.
 */
import { summarize } from "../data/stats";
import { SCOPE_COUNTRIES } from "../domain";
import { createI18n } from "../i18n";
import { LANGS, pathForLang, type Lang } from "../state/url";
import { CAPACITY_COPY } from "./capacityCopy";
import { COPY } from "./copy";
import { FEED_PATHS, hasFeed } from "./feed";
import { energyLinks } from "./energyPages";
import { geothermalLinks } from "./geothermal";
import { reportLinks } from "./report";
import { transitionLinks } from "./transition";
import { DATASET_LICENSE } from "./license";
import { PATHS, publisher, type SiteData } from "./site";
import { escapeHtml as e } from "./markup";
import { API_PATHS } from "./paths";

/** Where index.html wants the generated head tags and the summary; both must be present (L-025). */
export const HEAD_MARKER = "<!--seo:head-->";
export const BODY_MARKER = "<!--seo:body-->";
export const OG_IMAGE = "/og.png";

/** The script-safe JSON-LD element: "<" never appears literally, so no value can close it early. */
export function jsonLdScript(doc: Record<string, unknown>): string {
  return `<script type="application/ld+json">${JSON.stringify(doc).replaceAll("<", "\\u003c")}</script>`;
}

const other = (lang: Lang): Lang => (lang === "hr" ? "en" : "hr");

export function homeHead(site: SiteData, lang: Lang = "hr"): string {
  const copy = COPY[lang];
  const i18n = createI18n(lang);
  const base = site.siteUrl;
  const home = base ? base + pathForLang(lang) : null;
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: i18n.t("appName"),
    alternateName: createI18n(other(lang)).t("appName"),
    ...(base ? { url: `${base}/` } : {}),
    inLanguage: ["hr", "en"],
    description: copy.siteDescription,
    license: DATASET_LICENSE.license,
    isAccessibleForFree: true,
    publisher: publisher(site, i18n),
  };
  const absolute = (path: string): string => (base ? base + path : path);
  const alternates = base
    ? [
        ...LANGS.map(
          (each) => `<link rel="alternate" hreflang="${each}" href="${e(base + pathForLang(each))}">`,
        ),
        `<link rel="alternate" hreflang="x-default" href="${e(`${base}/`)}">`,
      ]
    : [];
  return [
    ...(home
      ? [`<link rel="canonical" href="${e(home)}">`, `<meta property="og:url" content="${e(home)}">`]
      : []),
    ...alternates,
    `<meta property="og:image" content="${e(absolute(OG_IMAGE))}">`,
    `<link rel="alternate" type="application/json" href="${e(absolute(API_PATHS.index))}">`,
    ...(hasFeed(site) && base
      ? [
          `<link rel="alternate" type="application/atom+xml" title="${e(copy.siteTitle)}" href="${e(base + FEED_PATHS[lang])}">`,
        ]
      : []),
    jsonLdScript(website),
  ].join("\n    ");
}

/** What a reader without JavaScript gets below the intro: the countries with their key numbers, and links. */
export function homeBody(site: SiteData, lang: Lang = "hr"): string {
  const copy = COPY[lang];
  const i18n = createI18n(lang);
  const rows = SCOPE_COUNTRIES.map((code) => {
    const summary = summarize(site.stats, code, SCOPE_COUNTRIES);
    const plants = summary.technologies.reduce((sum, row) => sum + row.operatingPlants, 0);
    return `<tr><td><a href="${PATHS[lang].country(code.toLowerCase())}">${e(i18n.country(code))}</a></td><td>${e(i18n.power(summary.operatingMw))}</td><td>${e(i18n.number(plants))}</td></tr>`;
  });
  const c = copy.home.columns;
  const links = [
    `<a href="${PATHS[lang].largest}">${e(copy.largest.linkText)}</a>`,
    ...(site.cities ? [`<a href="${PATHS[lang].cities}">${e(copy.cities.title)}</a>`] : []),
    ...(site.capacity ? [`<a href="${PATHS[lang].capacity}">${e(CAPACITY_COPY[lang].linkText)}</a>`] : []),
    ...energyLinks(site, lang, null),
    ...transitionLinks(site, lang),
    ...reportLinks(site, lang),
    ...geothermalLinks(site, lang),
    `<a href="${PATHS[lang].api}">${e(copy.api.title)}</a>`,
  ];
  // the same countries in the other language, so both language trees are one click from either home
  const twin = other(lang);
  const twinI18n = createI18n(twin);
  const inTwin = SCOPE_COUNTRIES.map(
    (code) => `<a href="${PATHS[twin].country(code.toLowerCase())}">${e(twinI18n.country(code))}</a>`,
  ).join(" · ");
  const twinLabel = twin === "en" ? "In English" : "Na hrvatskom";
  return [
    `<h2>${e(copy.home.countriesHeading)}</h2>`,
    `<table><thead><tr><th>${e(c.country)}</th><th>${e(c.operating)}</th><th>${e(c.plants)}</th></tr></thead><tbody>${rows.join("")}</tbody></table>`,
    `<h2>${e(copy.home.more)}</h2>`,
    `<ul>${links.map((link) => `<li>${link}</li>`).join("")}</ul>`,
    `<p lang="${twin}">${twinLabel}: ${inTwin} · <a href="${PATHS[twin].largest}">${e(COPY[twin].largest.linkText)}</a></p>`,
    `<p>${e(i18n.t("dataVersion", { date: i18n.date(site.current.createdAt) }))}</p>`,
  ].join("\n        ");
}

/** The English intro that replaces the Croatian one of index.html on /en/. */
function englishIntro(): string {
  const copy = COPY.en;
  const i18n = createI18n("en");
  const countries = SCOPE_COUNTRIES.map(
    (code) => `<a href="${PATHS.en.country(code.toLowerCase())}">${e(i18n.country(code))}</a>`,
  ).join(", ");
  return [
    `<h1>${e(i18n.t("appName"))}: ${e(i18n.t("appTagline"))}</h1>`,
    `<p>${e(copy.home.intro)}</p>`,
    `<ul><li><a href="${PATHS.en.about}">${e(copy.about.title)}</a></li><li>${e(copy.nav.countries)}: ${countries}</li><li><a href="${PATHS.hr.about}" lang="hr">O karti (hrvatski)</a></li></ul>`,
  ].join("\n        ");
}

/** Replace exactly one match, or fail the build: a silently unchanged English page would ship in Croatian. */
function replaceOnce(
  html: string,
  pattern: RegExp,
  replacement: (match: string, ...groups: string[]) => string,
  what: string,
): string {
  const matches = html.match(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`)) ?? [];
  if (matches.length !== 1)
    throw new Error(`prerender: index.html has ${matches.length} ${what}, expected one`);
  return html.replace(pattern, replacement);
}

/** The Croatian index.html turned into the English home: language, title, descriptions, locale, intro. */
function toEnglish(template: string): string {
  const copy = COPY.en;
  const i18n = createI18n("en");
  const attr = (text: string): string => e(text);
  let html = replaceOnce(template, /<html lang="hr"/, () => '<html lang="en"', "html lang");
  html = replaceOnce(
    html,
    /<title>[^<]*<\/title>/,
    () => `<title>${e(i18n.t("documentTitle"))}</title>`,
    "titles",
  );
  html = replaceOnce(
    html,
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    () => `<meta name="description" content="${attr(copy.siteDescription)}" />`,
    "descriptions",
  );
  html = replaceOnce(
    html,
    /<meta\s+property="og:site_name"\s+content="[^"]*"\s*\/?>/,
    () => `<meta property="og:site_name" content="${attr(i18n.t("appName"))}" />`,
    "og:site_name tags",
  );
  html = replaceOnce(
    html,
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
    () => `<meta property="og:title" content="${attr(copy.siteTitle)}" />`,
    "og:title tags",
  );
  html = replaceOnce(
    html,
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
    () => `<meta property="og:description" content="${attr(copy.home.shareDescription)}" />`,
    "og:description tags",
  );
  html = replaceOnce(
    html,
    /<meta\s+property="og:locale"\s+content="hr_HR"\s*\/?>/,
    () => '<meta property="og:locale" content="en_GB" />',
    "og:locale tags",
  );
  html = replaceOnce(
    html,
    /<meta\s+property="og:locale:alternate"\s+content="en_GB"\s*\/?>/,
    () => '<meta property="og:locale:alternate" content="hr_HR" />',
    "og:locale:alternate tags",
  );
  // the intro is everything in <main> before the summary marker
  return replaceOnce(
    html,
    /(<main[^>]*>)[\s\S]*?(<!--seo:body-->)/,
    (_match, open = "", marker = "") => `${open}\n        ${englishIntro()}\n        ${marker}`,
    "intros",
  );
}

/** index.html with the markers filled, for one language; a template without them fails the build. */
export function homeHtml(template: string, site: SiteData, lang: Lang = "hr"): string {
  const missing = [HEAD_MARKER, BODY_MARKER].filter((marker) => !template.includes(marker));
  if (missing.length > 0) throw new Error(`prerender: index.html has no ${missing.join(" or ")} marker`);
  const localized = lang === "en" ? toEnglish(template) : template;
  return localized
    .replace(HEAD_MARKER, () => homeHead(site, lang))
    .replace(BODY_MARKER, () => homeBody(site, lang));
}
