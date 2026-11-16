/**
 * Renders a static page model as a complete HTML document: no script, one small inline stylesheet, and
 * everything a crawler wants in <head>. The look follows the app's tokens so the two feel like one site.
 */
import {
  Braces,
  Building2,
  Gauge,
  GraduationCap,
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
import { pageCitation } from "./citation";
import { supportLinks } from "./support";
import { markdownPath } from "./markdown";
import { mapLink, PATHS, type SiteData, type StaticPage } from "./site";
import { escapeHtml as e } from "./markup";
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
    ...(site.siteUrl ? [`<meta property="og:image" content="${e(site.siteUrl + OG_IMAGE)}">`] : []),
    `<meta name="twitter:card" content="summary_large_image">`,
  ];
  const breadcrumbLd = breadcrumbJsonLd(page, site);
  const jsonLd = [...page.jsonLd, ...(breadcrumbLd ? [breadcrumbLd] : [])].map(jsonLdScript);
  return [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${e(page.title)}</title>`,
    `<meta name="description" content="${e(page.description)}">`,
    `<meta name="robots" content="index, follow, max-image-preview:large">`,
    ...(canonical ? [`<link rel="canonical" href="${e(canonical)}">`] : []),
    ...alternates,
    xDefault,
    ...og,
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`,
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
    `<style>${STATIC_STYLE}</style>`,
    ...jsonLd,
  ]
    .filter(Boolean)
    .join("\n");
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
  cities: icon(Building2),
  capacity: icon(Gauge),
  api: icon(Braces),
  language: icon(Globe),
};

export function renderPage(page: StaticPage, site: SiteData): string {
  const copy = COPY[page.lang];
  const i18n = createI18n(page.lang);
  const countries = SCOPE_COUNTRIES.map(
    (code) => `<a href="${PATHS[page.lang].country(code.toLowerCase())}">${e(i18n.country(code))}</a>`,
  ).join(" · ");
  const sections = [...page.sections, ...(page.nav ? [page.nav] : [])]
    .map((section) => `<section><h2>${e(section.heading)}</h2>${section.html}</section>`)
    .join("\n");
  const mapHref = mapLink(page.lang, {});
  return `<!doctype html>
<html lang="${page.lang}">
<head>
${head(page, site)}
</head>
<body>
<header>
<strong>${e(copy.siteTitle)}</strong>
<span class="tagline">${e(i18n.t("appTagline"))}</span>
<nav aria-label="${page.lang === "hr" ? "Glavna navigacija" : "Main navigation"}">
<a href="${mapHref}">${ICONS.map}${e(copy.nav.map)}</a>
<a href="${PATHS[page.lang].about}">${ICONS.about}${e(copy.nav.about)}</a>
<a href="${PATHS[page.lang].learn}">${ICONS.learn}${e(copy.nav.learn)}</a>
${site.cities ? `<a href="${PATHS[page.lang].cities}">${ICONS.cities}${e(copy.nav.cities)}</a>` : ""}
${site.capacity ? `<a href="${PATHS[page.lang].capacity}">${ICONS.capacity}${e(page.lang === "hr" ? "Kapaciteti" : "Grid capacity")}</a>` : ""}
<a href="${PATHS[page.lang].api}">${ICONS.api}${e(copy.nav.api)}</a>
<a href="${page.alternatePath}" lang="${page.lang === "hr" ? "en" : "hr"}" hreflang="${page.lang === "hr" ? "en" : "hr"}">${ICONS.language}${e(copy.nav.otherLang)}</a>
</nav>
</header>
<main>
${breadcrumbNav(page)}
<h1>${e(page.heading)}</h1>
<div class="lead">${page.lead}</div>
${sections}
${page.citable === false ? "" : citeSection(page, site)}
</main>
<footer>
<p>${e(copy.nav.countries)}: ${countries}</p>
<p>${e(copy.footer)} · ${e(i18n.t("dataVersion", { date: i18n.date(page.lastModified) }))}</p>
<p><a href="${PATHS[page.lang].author}">${e(copy.about.authorHeading)}</a> · ${e(copy.about.authorContact)}: <a href="mailto:${e(AUTHOR.email)}">${e(AUTHOR.email)}</a></p>
${supportLinks(site, page.lang)
  .map((link) => `<p>${link}</p>`)
  .join("")}
</footer>
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
<header>
<strong>${e(hr.siteTitle)}</strong>
</header>
<main>
<h1>${e(hr.notFound.heading)}</h1>
<p class="lead">${e(hr.notFound.text)}</p>
<p lang="en">${e(en.notFound.text)}</p>
<h2>${e(hr.notFound.linksHeading)}</h2>
<ul>${links.map((link) => `<li>${link}</li>`).join("")}</ul>
</main>
<footer>
<p>${e(hr.footer)}${site.siteUrl ? ` · <a href="${e(site.siteUrl)}/">${e(site.siteUrl.replace(/^https?:\/\//, ""))}</a>` : ""}</p>
</footer>
</body>
</html>
`;
}
