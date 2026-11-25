/**
 * Renders a static page model as a complete HTML document: no script, one small inline stylesheet, and
 * everything a crawler wants in <head>. The look follows the app's tokens so the two feel like one site.
 */
import { compareLink, reportMonths } from "./report";
import {
  Braces,
  GitCompareArrows,
  Building2,
  Gauge,
  FileText,
  GraduationCap,
  UserRound,
  Info,
  Globe,
  Map as MapIcon,
  type LucideIcon,
} from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SCOPE_COUNTRIES } from "../domain";
import { createI18n } from "../i18n";
import { LANGS } from "../state/url";
import { AUTHOR, COPY } from "./copy";
import { FEED_PATHS, hasFeed } from "./feed";
import { jsonLdScript, OG_IMAGE } from "./home";
import { OG_SIZE } from "./ogImages";
import { pageCitation } from "./citation";
import { supportLinks } from "./support";
import { markdownPath } from "./markdown";
import { mapLink, PATHS, publisher, type SiteData, type StaticPage } from "./site";
import { contentsNav, doors, escapeHtml as e, sectionsHtml, snippet } from "./markup";
import { STATIC_STYLE } from "./style";

function head(page: StaticPage, site: SiteData): string {
  const copy = COPY[page.lang];
  const canonical = site.siteUrl ? `${site.siteUrl}${page.path}` : null;
  const alternates = LANGS.map((lang) => {
    const path = lang === page.lang ? page.path : page.alternatePath;
    return site.siteUrl ? `<link rel="alternate" hreflang="${lang}" href="${e(site.siteUrl + path)}">` : "";
  });
  const xDefault = site.siteUrl
    ? `<link rel="alternate" hreflang="x-default" href="${e(site.siteUrl + (page.lang === "hr" ? page.path : page.alternatePath))}">`
    : "";
  const og = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${e(copy.siteTitle)}">`,
    `<meta property="og:title" content="${e(page.title)}">`,
    `<meta property="og:description" content="${e(page.description)}">`,
    `<meta property="og:locale" content="${page.lang === "hr" ? "hr_HR" : "en_GB"}">`,
    ...(canonical ? [`<meta property="og:url" content="${e(canonical)}">`] : []),
    ...(site.siteUrl
      ? [
          `<meta property="og:image" content="${e(site.siteUrl + (page.image ?? OG_IMAGE))}">`,
          // every picture of the site is drawn at this size (scripts/og-image.mjs, og-topics.mjs)
          `<meta property="og:image:width" content="${String(OG_SIZE.width)}">`,
          `<meta property="og:image:height" content="${String(OG_SIZE.height)}">`,
        ]
      : []),
    `<meta name="twitter:card" content="summary_large_image">`,
  ];
  const breadcrumbLd = breadcrumbJsonLd(page, site);
  const dated = page.jsonLd.map((each) =>
    each["@type"] === "Dataset"
      ? completeDataset(each, page, site)
      : // a text is as new as its content, not as the data build that rendered it (Faza 51-2)
        each["@type"] === "Article" && page.contentModified !== undefined
        ? { ...each, dateModified: page.contentModified }
        : each,
  );
  const jsonLd = [...dated, ...(breadcrumbLd ? [breadcrumbLd] : [])].map(jsonLdScript);
  return [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${e(page.title)}</title>`,
    `<meta name="description" content="${e(snippet(page.description))}">`,
    `<meta name="robots" content="index, follow, max-image-preview:large">`,
    ...(canonical ? [`<link rel="canonical" href="${e(canonical)}">`] : []),
    ...alternates,
    xDefault,
    ...og,
    `<link rel="icon" href="/favicon.ico" sizes="32x32">`,
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
    `<link rel="manifest" href="/site.webmanifest">`,
    ...(page.markdownTwin === false
      ? []
      : [`<link rel="alternate" type="text/markdown" href="${e(markdownPath(page.path))}">`]),
    ...(page.apiPath
      ? [
          `<link rel="alternate" type="application/json" href="${e(site.siteUrl ? site.siteUrl + page.apiPath : page.apiPath)}">`,
        ]
      : []),
    ...(hasFeed(site) && site.siteUrl
      ? [
          `<link rel="alternate" type="application/atom+xml" title="${e(copy.siteTitle)}" href="${e(site.siteUrl + FEED_PATHS[page.lang])}">`,
        ]
      : []),
    `<meta name="theme-color" content="#1f6f8b">`,
    // the map's font, the two weights every page uses (style.ts): fetched at once, not after the stylesheet
    ...["400", "600"].map(
      (weight) =>
        `<link rel="preload" href="/fonts/ibm-plex-sans-latin-${weight}-normal.woff2" as="font" type="font/woff2" crossorigin>`,
    ),
    `<style>${STATIC_STYLE}</style>`,
    ...jsonLd,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * What every data set on a page says about itself (Faza 47-5, 51-1), unless the page already said it more
 * exactly: when its data is from, who put it together, and where it can be taken in a machine's form (the
 * page's Markdown twin and its JSON in the open API). A licence is left to the pages: each points at its
 * sources' own terms (SOURCE_TERMS in ./license), as the site states no licence of its own for their figures.
 */
export function completeDataset(
  dataset: Record<string, unknown>,
  page: StaticPage,
  site: SiteData,
): Record<string, unknown> {
  const at = (path: string): string | null => (site.siteUrl ? site.siteUrl + path : null);
  const markdown = page.markdownTwin === false ? null : at(markdownPath(page.path));
  const json = page.apiPath ? at(page.apiPath) : null;
  const distribution = [
    ...(markdown ? [{ "@type": "DataDownload", encodingFormat: "text/markdown", contentUrl: markdown }] : []),
    ...(json ? [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: json }] : []),
  ];
  return {
    ...dataset,
    ...("dateModified" in dataset ? {} : { dateModified: page.lastModified }),
    ...("creator" in dataset ? {} : { creator: publisher(site, createI18n(page.lang)) }),
    ...("distribution" in dataset || distribution.length === 0 ? {} : { distribution }),
  };
}

/** schema.org BreadcrumbList for the trail plus the page itself; needs absolute addresses, so a site URL. */
export function breadcrumbJsonLd(page: StaticPage, site: SiteData): Record<string, unknown> | null {
  if (!site.siteUrl || page.breadcrumbs.length === 0) return null;
  const base = site.siteUrl;
  const steps = [...page.breadcrumbs, { name: page.heading, path: page.path }];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: steps.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: base + step.path,
    })),
  };
}

function breadcrumbNav(page: StaticPage): string {
  if (page.breadcrumbs.length === 0) return "";
  const label = page.lang === "hr" ? "Putanja" : "Breadcrumb";
  const items = page.breadcrumbs.map((step) => `<li><a href="${e(step.path)}">${e(step.name)}</a></li>`);
  return `<nav class="crumbs" aria-label="${label}"><ol>${items.join("")}<li aria-current="page">${e(page.heading)}</li></ol></nav>`;
}

const CITE_COPY = {
  hr: { heading: "Kako citirati", text: "Za objavu", apa: "APA" },
  en: { heading: "How to cite", text: "For publication", apa: "APA" },
} as const;

function citeSection(page: StaticPage, site: SiteData): string {
  const copy = CITE_COPY[page.lang];
  const cite = pageCitation(page, site);
  return `<section class="cite"><h2>${e(copy.heading)}</h2><p><strong>${e(copy.text)}:</strong> ${e(cite.text)}</p><p><strong>${e(copy.apa)}:</strong> ${e(cite.apa)}</p></section>`;
}

/**
 * The same icons the map's header uses, as inline SVG: a static page then looks like part of the same site
 * without loading anything. They are decoration next to a word, so hidden from assistive technology.
 */
const icon = (Icon: LucideIcon): string =>
  renderToStaticMarkup(createElement(Icon, { size: 16, strokeWidth: 1.75, "aria-hidden": true }));
const ICONS = {
  map: icon(MapIcon),
  about: icon(Info),
  learn: icon(GraduationCap),
  reports: icon(FileText),
  author: icon(UserRound),
  cities: icon(Building2),
  capacity: icon(Gauge),
  api: icon(Braces),
  compare: icon(GitCompareArrows),
  language: icon(Globe),
};

const SHELL_COPY = {
  hr: {
    nav: "Glavna navigacija",
    compare: "Usporedbe",
    more: "Više",
    openMap: "Otvori kartu",
    contents: "Na ovoj stranici",
  },
  en: {
    nav: "Main navigation",
    compare: "Comparisons",
    more: "More",
    openMap: "Open the map",
    contents: "On this page",
  },
} as const;

/** A page has a side column with its contents once it is long enough to need one. */
const CONTENTS_MIN_SECTIONS = 4;

interface NavLink {
  href: string;
  label: string;
  icon: string;
  /** the page or one under it is open: the link is marked as where the reader is */
  current: boolean;
  extra?: string;
}

const navLink = (link: NavLink, cls = ""): string =>
  `<a href="${link.href}"${cls ? ` class="${cls}"` : ""}${link.current ? ' aria-current="page"' : ""}${link.extra ?? ""}>${link.icon}${e(link.label)}</a>`;

/**
 * The bar at the top of every static page (Faza 54-1), in one row like the map's: the main pages, the rest
 * under "More", and the way back to the map. On a phone the links scroll sideways in a row of their own, all
 * of them visible, so nothing needs a script or a menu that hides them.
 */
function headerHtml(page: StaticPage, site: SiteData): string {
  const lang = page.lang;
  const copy = COPY[lang];
  const shell = SHELL_COPY[lang];
  const i18n = createI18n(lang);
  const paths = PATHS[lang];
  const under = (path: string): boolean => page.path === path || page.path.startsWith(path);
  const hasReports = reportMonths(site).length > 0;
  const main: NavLink[] = [
    ...(hasReports
      ? [{ href: paths.reports, label: copy.nav.reports, icon: ICONS.reports, current: under(paths.reports) }]
      : []),
    { href: paths.learn, label: copy.nav.learn, icon: ICONS.learn, current: under(paths.learn) },
    ...(hasReports
      ? [{ href: compareLink(lang, null), label: shell.compare, icon: ICONS.compare, current: false }]
      : []),
    { href: paths.about, label: copy.nav.about, icon: ICONS.about, current: under(paths.about) },
  ];
  const more: NavLink[] = [
    {
      href: paths.author,
      label: copy.nav.author,
      icon: ICONS.author,
      current: under(paths.author),
      extra: ` title="${e(copy.about.authorHeading)}"`,
    },
    ...(site.cities
      ? [{ href: paths.cities, label: copy.nav.cities, icon: ICONS.cities, current: under(paths.cities) }]
      : []),
    ...(site.capacity
      ? [
          {
            href: paths.capacity,
            label: lang === "hr" ? "Kapaciteti" : "Grid capacity",
            icon: ICONS.capacity,
            current: under(paths.capacity),
          },
        ]
      : []),
    { href: paths.api, label: copy.nav.api, icon: ICONS.api, current: under(paths.api) },
  ];
  const other = lang === "hr" ? "en" : "hr";
  const language = `<a class="lang" href="${page.alternatePath}" lang="${other}" hreflang="${other}">${ICONS.language}<span>${e(copy.nav.otherLang)}</span></a>`;
  return `<header class="top"><div class="bar">
<a class="logo" href="${mapLink(lang, {})}"><b>${e(copy.siteTitle)}</b><span>${e(i18n.t("appTagline"))}</span></a>
<nav class="primary" aria-label="${shell.nav}">
${main.map((link) => navLink(link)).join("\n")}
${more.map((link) => navLink(link, "phone")).join("\n")}
<details class="more"><summary>${e(shell.more)}</summary><div>
${more.map((link) => navLink(link)).join("\n")}
</div></details>
</nav>
${language}
<a class="open-map" href="${mapLink(lang, {})}">${ICONS.map}<span>${e(shell.openMap)}</span></a>
</div></header>`;
}

export function renderPage(page: StaticPage, site: SiteData): string {
  const copy = COPY[page.lang];
  const i18n = createI18n(page.lang);
  const countries = SCOPE_COUNTRIES.map(
    (code) => `<a href="${PATHS[page.lang].country(code.toLowerCase())}">${e(i18n.country(code))}</a>`,
  ).join(" · ");
  const all = [...page.sections, ...(page.nav ? [page.nav] : [])];
  const sections = sectionsHtml(all);
  const contents =
    page.sections.length >= CONTENTS_MIN_SECTIONS
      ? `<aside class="side">${contentsNav(page.sections, SHELL_COPY[page.lang].contents)}</aside>`
      : "";
  return `<!doctype html>
<html lang="${page.lang}">
<head>
${head(page, site)}
</head>
<body>
${headerHtml(page, site)}
<main>
<div class="hero">
${breadcrumbNav(page)}
<h1>${e(page.heading)}</h1>
<div class="lead">${page.lead}</div>
</div>
<div class="body${contents ? " with-side" : ""}">
<div class="content">
${page.doors && page.doors.length > 0 ? doors(page.doors) : ""}
${sections}
${page.citable === false ? "" : citeSection(page, site)}
</div>
${contents}
</div>
</main>
<footer><div class="bar">
<p>${e(copy.nav.countries)}: ${countries}</p>
<p>${e(copy.footer)} · ${e(i18n.t("dataVersion", { date: i18n.date(page.lastModified) }))}</p>
<p><a href="${PATHS[page.lang].author}">${e(copy.about.authorHeading)}</a> · ${e(copy.about.authorContact)}: <a href="mailto:${e(AUTHOR.email)}">${e(AUTHOR.email)}</a></p>
${supportLinks(site, page.lang)
  .map((link) => `<p>${link}</p>`)
  .join("")}
</div></footer>
</body>
</html>
`;
}

/**
 * The page Cloudflare Pages serves with status 404 for every address that has no file (`404.html` at the
 * root). Without it Pages would answer every unknown address with the map and status 200, so search engines
 * would keep the pages of removed assets as copies of the home page. Bilingual, `noindex`, no canonical.
 */
export function renderNotFound(site: SiteData): string {
  const hr = COPY.hr;
  const en = COPY.en;
  const i18n = createI18n("hr");
  const links = [
    `<a href="${mapLink("hr", {})}">${e(hr.nav.map)}</a>`,
    `<a href="${PATHS.hr.about}">${e(hr.nav.about)}</a>`,
    `<a href="${PATHS.hr.largest}">${e(hr.largest.linkText)}</a>`,
    ...SCOPE_COUNTRIES.map(
      (code) => `<a href="${PATHS.hr.country(code.toLowerCase())}">${e(i18n.country(code))}</a>`,
    ),
    `<a href="${PATHS.en.about}" lang="en">${e(en.nav.about)} (English)</a>`,
  ];
  return `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(hr.notFound.title)}</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#1f6f8b">
<style>${STATIC_STYLE}</style>
</head>
<body>
<header class="top"><div class="bar">
<a class="logo" href="${mapLink("hr", {})}"><b>${e(hr.siteTitle)}</b></a>
<a class="open-map" href="${mapLink("hr", {})}">${ICONS.map}<span>${e(SHELL_COPY.hr.openMap)}</span></a>
</div></header>
<main>
<div class="hero">
<h1>${e(hr.notFound.heading)}</h1>
<p class="lead">${e(hr.notFound.text)}</p>
<p lang="en">${e(en.notFound.text)}</p>
</div>
<div class="body"><div class="content">
<section><h2>${e(hr.notFound.linksHeading)}</h2>
<ul>${links.map((link) => `<li>${link}</li>`).join("")}</ul></section>
</div></div>
</main>
<footer><div class="bar">
<p>${e(hr.footer)}${site.siteUrl ? ` · <a href="${e(site.siteUrl)}/">${e(site.siteUrl.replace(/^https?:\/\//, ""))}</a>` : ""}</p>
</div></footer>
</body>
</html>
`;
}
