/**
 * The about page and the API page (Faza 26 split from pages.ts).
 */
import { DATA_SOURCES, DOWNLOAD_KEYS, isOneOf } from "../domain";
import { createI18n } from "../i18n";
import { DOWNLOAD_LABELS } from "../i18n/labels";
import type { Lang } from "../state/url";
import { AUTHOR, COPY } from "./copy";
import { definitions, e, list, steps } from "./markup";
import { countryJsonDoor, learnDoor, mapDoor } from "./pageDoors";
import { API_PATHS } from "./paths";
import {
  absolute,
  datasetJsonLd,
  downloadUrl,
  home,
  other,
  PATHS,
  publisher,
  type SiteData,
  type StaticPage,
} from "./site";
import { supportLinks } from "./support";
import { hasFeed } from "./feed";
import { SCOPE_COUNTRIES } from "../domain";

export function aboutPage(site: SiteData, lang: Lang): StaticPage {
  const copy = COPY[lang];
  const i18n = createI18n(lang);
  const about = copy.about;
  const sources = (site.current.attributionSources ?? []).filter((s) => isOneOf(DATA_SOURCES, s));
  const downloads = DOWNLOAD_KEYS.flatMap((key) => {
    const file = site.current.downloads[key];
    return file ? [`<a href="${e(downloadUrl(site, file))}">${e(i18n.t(DOWNLOAD_LABELS[key]))}</a>`] : [];
  });
  const countries = [
    ...SCOPE_COUNTRIES.map(
      (code) => `<a href="${PATHS[lang].country(code.toLowerCase())}">${e(i18n.country(code))}</a>`,
    ),
    `<a href="${PATHS[lang].largest}">${e(copy.largest.linkText)}</a>`,
  ];
  return {
    path: PATHS[lang].about,
    lang,
    alternatePath: PATHS[other(lang)].about,
    title: about.title,
    description: copy.siteDescription,
    heading: about.title,
    lead: about.intro.map((p) => `<p>${e(p)}</p>`).join(""),
    sections: [
      { heading: about.purposeHeading, html: list(about.purpose.map(e)) },
      { heading: about.whatHeading, html: list(about.what.map(e)) },
      { heading: about.readingHeading, html: list(about.reading.map(e)) },
      { heading: about.methodHeading, html: steps(about.method.map(e)) },
      { heading: about.sourcesHeading, html: list(sources.map((s) => e(i18n.t(`attr_${s}`)))) },
      { heading: copy.nav.countries, html: list(countries, "links") },
      { heading: about.updatesHeading, html: `<p>${e(about.updates)}</p>` },
      { heading: about.limitsHeading, html: list(about.limits.map(e)) },
      {
        heading: about.downloadsHeading,
        html: `<p>${e(about.downloadsNote)}</p>${list(downloads, "links")}`,
      },
      { heading: about.fixHeading, html: `<p>${e(about.fix)}</p>` },

      {
        heading: about.faqHeading,
        html: about.faq.map((f) => `<h3>${e(f.question)}</h3><p>${e(f.answer)}</p>`).join(""),
      },
      ...(supportLinks(site, lang).length > 0
        ? [
            {
              heading: about.supportHeading,
              html: `<p>${e(about.support)}</p>${list(supportLinks(site, lang))}`,
            },
          ]
        : []),
    ],
    jsonLd: [
      datasetJsonLd(site, lang, i18n, copy),
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: about.faq.map((f) => ({
          "@type": "Question",
          name: f.question,
          acceptedAnswer: { "@type": "Answer", text: f.answer },
        })),
      },
    ],
    lastModified: site.current.createdAt,
    breadcrumbs: [home(lang)],
    apiPath: API_PATHS.index,
  };
}

/**
 * Who is behind GridAtlas (2026-11-16, moved out of the about page at the owner's request): the owner's own
 * words, how to support the project and how to reach him.
 */
export function authorPage(site: SiteData, lang: Lang): StaticPage {
  const about = COPY[lang].about;
  const [first = "", ...rest] = about.author;
  return {
    path: PATHS[lang].author,
    lang,
    alternatePath: PATHS[other(lang)].author,
    title: about.authorHeading,
    description: first,
    heading: about.authorHeading,
    lead: `<p>${e(first)}</p>`,
    doors: [mapDoor(lang), learnDoor(lang)],
    sections: [
      {
        heading: about.authorSupportHeading,
        html: `${rest.map((p) => `<p>${e(p)}</p>`).join("")}<div class="support"><img src="/keks-pay.png" alt="${e(about.authorQrAlt)}" width="200" height="200" loading="lazy"><div><p>${e(about.authorKeksTag)}: <strong>${e(AUTHOR.keksTag)}</strong></p><p>${e(about.authorContact)}: <a href="mailto:${e(AUTHOR.email)}">${e(AUTHOR.email)}</a></p></div></div>`,
      },
    ],
    jsonLd: [],
    lastModified: site.current.createdAt,
    breadcrumbs: [home(lang)],
    citable: false,
  };
}

export function apiPage(site: SiteData, lang: Lang): StaticPage {
  const copy = COPY[lang];
  const api = copy.api;
  const base = site.siteUrl ?? "";
  const endpoints: [string, string][] = [
    [`${base}/api/index.json`, api.endpoints.index],
    [`${base}/api/zemlja/hr.json`, api.endpoints.country],
    [`${base}/api/objekt/osm-way-109.json`, api.endpoints.asset],
    ...(site.cities ? ([[`${base}/api/gradovi.json`, api.endpoints.cities]] as [string, string][]) : []),
    ...(hasFeed(site)
      ? ([[`${base}${lang === "hr" ? "/feed.xml" : "/en/feed.xml"}`, api.endpoints.feed]] as [
          string,
          string,
        ][])
      : []),
  ];
  const example = `fetch("${base}/api/zemlja/hr.json")
  .then((r) => r.json())
  .then((hr) => console.log(hr.operatingMw, hr.technologies[0]));`;
  const path = PATHS[lang].api;
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].api,
    title: api.title,
    description: api.description,
    heading: api.heading,
    lead: api.intro.map((p) => `<p>${e(p)}</p>`).join(""),
    doors: [countryJsonDoor(lang), mapDoor(lang)],
    sections: [
      {
        heading: api.endpointsHeading,
        html: definitions(endpoints.map(([url, text]) => [url, e(text)] as [string, string])),
      },
      { heading: api.exampleHeading, html: `<pre><code>${e(example)}</code></pre>` },
      { heading: api.rulesHeading, html: list(api.rules.map(e)) },
    ],
    jsonLd: [
      // the data the API serves, so that dataset search finds it from this page too
      datasetJsonLd(site, lang, createI18n(lang), copy),
      {
        "@context": "https://schema.org",
        "@type": "WebAPI",
        name: api.title,
        description: api.description,
        documentation: absolute(site, path) ?? path,
        termsOfService: "https://opendatacommons.org/licenses/odbl/1-0/",
        provider: publisher(site, createI18n(lang)),
      },
    ],
    lastModified: site.current.createdAt,
    breadcrumbs: [home(lang)],
    apiPath: API_PATHS.index,
  };
}
