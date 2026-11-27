/**
 * What a static page is and where it lives (Faza 26 split from pages.ts): the site data, the page model, the
 * addresses of every kind of page, and the JSON-LD the pages share.
 */
import { createI18n } from "../i18n";
import type { PriceMonths } from "../data/priceMonths";
import type { GasFlows } from "../data/gasFlows";
import type { GasStorage } from "../data/gasStorage";
import type { SolarCapita } from "../data/solarCapita";
import type { Installed } from "../data/installed";
import type { StorageMonths } from "../data/storageMonths";
import type { Door } from "./markup";
import type { CityRegister } from "../data/cities";
import type { Current } from "../data/current";
import type { Diff } from "../data/diff";
import type { Periods } from "../data/energy";
import type { Renewables } from "../data/eurostat";
import type { Geothermal } from "../data/geothermal";
import type { HepHistory, HepRelease } from "../data/hep";
import type { Live } from "../data/live";
import type { SearchIndex } from "../data/search";
import type { Stats } from "../data/stats";
import type { Timeline } from "../data/timeline";
import { DATA_SOURCES, DOWNLOAD_KEYS, isOneOf, SCOPE_COUNTRIES } from "../domain";
import type { I18n } from "../i18n";
import { type Lang, pathForLang } from "../state/url";
import type { SupportContent } from "../support";
import { type Copy, COPY, type HubKey } from "./copy";
import type { AssetRecord } from "./records";
import { TECHNOLOGIES } from "../domain";
import { DATASET_LICENSE } from "./license";

/** A plant gets its own page from this capacity, a substation from this voltage, a city from this use. */
export const ASSET_PAGE_MIN_MW = 10;
/** What one Cloudflare Pages deployment takes; the build refuses to go past it rather than fail on upload. */
export const PAGES_FILE_LIMIT = 20_000;
/** Files the application adds to the static pages (scripts, styles, fonts, source maps, the icon). */
export const APP_FILE_ALLOWANCE = 250;

export const ASSET_PAGE_MIN_KV = 220;

export const CITY_PAGE_MIN_MWH = 50_000;

/** Zoom of the map link on an asset page: every point asset is drawn from here (tiles.py rules). */
export const ASSET_ZOOM = 12;

/** A topic page lists at most this many assets (the largest first); the map has them all. */
export const HUB_ROWS = 500;

/** The regional list of the largest plants. */
export const LARGEST_ROWS = 100;

export interface SiteData {
  /** "https://karta.example" without a trailing slash, or null when the build has no public address */
  siteUrl: string | null;
  /** where the downloads live; absolute in production */
  dataBaseUrl: string;
  current: Current;
  stats: Stats;
  index: SearchIndex;
  /** the city register, when the release has one */
  cities: CityRegister | null;
  /** the change report, when the release has one (feed.ts) */
  diff: Diff | null;
  /** HEP ODS grid capacity (Faza 15), when the bucket has it */
  capacity?: HepRelease | null;
  capacityHistory?: HepHistory | null;
  /** complete records of the assets that get a page, from the NDJSON downloads (17-11) */
  records?: ReadonlyMap<string, AssetRecord>;
  /** ENTSO-E generation by period and the live document with day-ahead prices (17-10), when published */
  energy?: Periods | null;
  live?: Live | null;
  /** capacity in operation by year and retired plants (Faza 18-3), when the release has it */
  timeline?: Timeline | null;
  /** geothermal sites and heat-flow potential (Faza 21), when the bucket has them */
  geothermal?: Geothermal | null;
  /** the official renewable shares from Eurostat (Faza 28), when the bucket has them */
  renewables?: Renewables | null;
  /** monthly totals of the day-ahead price (hours and days at or below zero), when the bucket has them */
  priceMonths?: PriceMonths | null;
  /** gas in storage at the end of each month (GIE AGSI), when the bucket has it */
  storageMonths?: StorageMonths | null;
  /** solar electricity per inhabitant by country and year (Eurostat, Faza 46), when the bucket has it */
  solarCapita?: SolarCapita | null;
  /** installed capacity per source by country and year (ENTSO-E A68), when the bucket has it */
  installed?: Installed | null;
  /** the gas system's daily flows (ENTSOG) and the storage fill (GIE AGSI), for the gas page (Faza 47) */
  gasFlows?: GasFlows | null;
  gasStorage?: GasStorage | null;
  /** when ENTSO-E's monthly and yearly totals were last updated (the energy pointer), when known */
  energyUpdatedAt?: string | null;
  /** when this build of the pages ran: the day a changed page is dated in the sitemap (Faza 31) */
  builtAt?: string;
  /** what the "Support and partners" page says, when its switch is on (Faza 24); null: no page, no links */
  support?: SupportContent | null;
}

export interface Section {
  heading: string;
  /** HTML fragments, already escaped */
  html: string;
}

export interface StaticPage {
  path: string;
  lang: Lang;
  /** the same page in the other language */
  alternatePath: string;
  title: string;
  description: string;
  heading: string;
  lead: string;
  /** where the page leads, as cards under the lead (pageDoors.ts): mostly views of the map */
  doors?: Door[];
  /**
   * The key figures as tiles across the page under its head (charts.ts `keyFigures`, Faza 54-2), as HTML.
   * They repeat figures of the lead and the sections, so the Markdown copy leaves them out.
   */
  figures?: string;
  sections: Section[];
  jsonLd: Record<string, unknown>[];
  /** ISO instant of the data release the page was made from */
  lastModified: string;
  /** the trail from the home page to this page's parent; the page itself is the last step (html.ts) */
  breadcrumbs: Crumb[];
  /** the picture a shared link to the page shows, as a path; absent: the site's own (seo/ogImages.ts) */
  image?: string;
  /**
   * The day the page's content last changed ("2026-11-19", the SEO manifest's `lastmod`, set by prerender):
   * an Article's dateModified, which must not move with every data build (Faza 51-2).
   */
  contentModified?: string;
  /** the open JSON twin of this page (seo/api.ts), when there is one */
  apiPath?: string;
  /**
   * False for the page of one object (a plant, a substation, a city, a mine): its machine-readable twin is
   * its JSON in the API, and a Markdown copy of each one doubles the number of files. With the Global
   * Energy Monitor's plants the site passed the 20 000 files a Cloudflare Pages deployment takes, and
   * stopped deploying (2026-11-16).
   */
  markdownTwin?: false;
  /** False for a page that is not about data (who is behind the site): it gets no "how to cite" section. */
  citable?: false;
  /**
   * Links to neighbouring pages (the previous and next monthly report), shown after the sections but left out
   * of the page hash: a new neighbour does not make an unchanged page look changed (Faza 31).
   */
  nav?: Section;
}

export interface Crumb {
  name: string;
  path: string;
}

// ---------------------------------------------------------------- paths

interface Paths {
  about: string;
  learn: string;
  author: string;
  api: string;
  cities: string;
  largest: string;
  capacity: string;
  capacityStation: (slug: string) => string;
  generation: string;
  generationCountry: (code: string) => string;
  prices: string;
  transition: string;
  gas: string;
  geothermal: string;
  support: string;
  reports: string;
  /** a month's report: "2026-10" */
  report: (month: string) => string;
  country: (code: string) => string;
  hub: (code: string, key: HubKey) => string;
  asset: (slug: string) => string;
}

/** Topic page slugs, per language: what people type, not our internal keys. */
export const HUB_SLUGS: Record<Lang, Record<HubKey, string>> = {
  hr: {
    hydro: "hidroelektrane",
    pumped_storage: "reverzibilne-hidroelektrane",
    solar: "suncane-elektrane",
    wind: "vjetroelektrane",
    nuclear: "nuklearne-elektrane",
    gas: "plinske-elektrane",
    coal: "elektrane-na-ugljen",
    lignite: "elektrane-na-lignit",
    oil: "elektrane-na-naftu",
    biomass: "elektrane-na-biomasu",
    geothermal: "geotermalne-elektrane",
    battery: "baterijski-spremnici",
    other: "ostale-elektrane",
    substations: "trafostanice",
    datacenters: "podatkovni-centri",
    extraction: "crpilista-i-rudnici",
  },
  en: {
    hydro: "hydropower-plants",
    pumped_storage: "pumped-storage-plants",
    solar: "solar-power-plants",
    wind: "wind-farms",
    nuclear: "nuclear-power-plants",
    gas: "gas-power-plants",
    coal: "coal-power-plants",
    lignite: "lignite-power-plants",
    oil: "oil-power-plants",
    biomass: "biomass-power-plants",
    geothermal: "geothermal-power-plants",
    battery: "battery-storage",
    other: "other-power-plants",
    substations: "substations",
    datacenters: "data-centres",
    extraction: "extraction-sites",
  },
};

/** Topic pages in a fixed order: plant technologies first (as in the legend), then the other kinds. */
export const HUB_KEYS: readonly HubKey[] = [...TECHNOLOGIES, "substations", "datacenters", "extraction"];

export const PATHS: Record<Lang, Paths> = {
  hr: {
    about: "/o-karti/",
    learn: "/edukacija/",
    author: "/tko-stoji-iza/",
    api: "/api/",
    cities: "/gradovi/",
    largest: "/najvece-elektrane/",
    capacity: "/kapaciteti/",
    capacityStation: (slug) => `/kapaciteti/${slug}/`,
    generation: "/proizvodnja/",
    generationCountry: (code) => `/proizvodnja/${code}/`,
    prices: "/cijene-struje/",
    transition: "/zelena-tranzicija/",
    gas: "/plin/",
    geothermal: "/geotermalna-energija/",
    support: "/podrska/",
    reports: "/izvjestaji/",
    report: (month) => `/izvjestaji/${month}/`,
    country: (code) => `/zemlja/${code}/`,
    hub: (code, key) => `/zemlja/${code}/${HUB_SLUGS.hr[key]}/`,
    asset: (slug) => `/objekt/${slug}/`,
  },
  en: {
    about: "/en/about/",
    learn: "/en/learn/",
    author: "/en/who-is-behind/",
    api: "/en/api/",
    cities: "/en/cities/",
    largest: "/en/largest-power-plants/",
    capacity: "/en/grid-capacity/",
    capacityStation: (slug) => `/en/grid-capacity/${slug}/`,
    generation: "/en/electricity-generation/",
    generationCountry: (code) => `/en/electricity-generation/${code}/`,
    prices: "/en/electricity-prices/",
    transition: "/en/energy-transition/",
    gas: "/en/gas/",
    geothermal: "/en/geothermal-energy/",
    support: "/en/support/",
    reports: "/en/reports/",
    report: (month) => `/en/reports/${month}/`,
    country: (code) => `/en/country/${code}/`,
    hub: (code, key) => `/en/country/${code}/${HUB_SLUGS.en[key]}/`,
    asset: (slug) => `/en/asset/${slug}/`,
  },
};

export const other = (lang: Lang): Lang => (lang === "hr" ? "en" : "hr");

/** URL-safe, stable slug from an asset id: "osm:way/109" → "osm-way-109". Names change; ids do not. */
export function assetSlug(id: string): string {
  return id.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** The map at a view, in a language: the path carries the language ("/" or "/en/"), the query the rest. */
export function mapLink(lang: Lang, params: Record<string, string>): string {
  const text = new URLSearchParams(params).toString();
  const path = pathForLang(lang);
  return text ? `${path}?${text}` : path;
}

export const home = (lang: Lang): Crumb => ({ name: COPY[lang].breadcrumbHome, path: mapLink(lang, {}) });

export const homeCrumb = home;

/** Croatia's page, the step above the pages about Croatia alone (gas, the green transition; Faza 58-A). */
export const croatiaCrumb = (lang: Lang): Crumb => ({
  name: createI18n(lang).country("HR"),
  path: PATHS[lang].country("hr"),
});

// ---------------------------------------------------------------- pages

export function absolute(site: SiteData, path: string): string | null {
  return site.siteUrl ? `${site.siteUrl}${path}` : null;
}

/** Bucket-relative key → link. A relative data base (local development) stays relative. */
export function downloadUrl(site: SiteData, key: string): string {
  return /^https?:/.test(site.dataBaseUrl)
    ? new URL(key, site.dataBaseUrl).toString()
    : site.dataBaseUrl + key;
}

export function datasetJsonLd(site: SiteData, lang: Lang, i18n: I18n, copy: Copy): Record<string, unknown> {
  const sources = (site.current.attributionSources ?? []).filter((s) => isOneOf(DATA_SOURCES, s));
  const downloads = DOWNLOAD_KEYS.flatMap((key) => {
    const file = site.current.downloads[key];
    return file
      ? [
          {
            "@type": "DataDownload",
            encodingFormat: "application/x-ndjson+gzip",
            contentUrl: downloadUrl(site, file),
          },
        ]
      : [];
  });
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: copy.siteTitle,
    description: copy.siteDescription,
    inLanguage: lang,
    ...DATASET_LICENSE,
    isAccessibleForFree: true,
    dateModified: site.current.createdAt,
    version: site.current.buildId,
    spatialCoverage: spatialCoverage(site, i18n),
    creator: publisher(site, i18n),
    publisher: publisher(site, i18n),
    keywords: copy.keywords,
    variableMeasured: copy.variables,
    isBasedOn: sources.map((s) => i18n.t(`attr_${s}`)),
    distribution: downloads,
    ...(absolute(site, PATHS[lang].about) ? { url: absolute(site, PATHS[lang].about) } : {}),
  };
}

/** Who publishes the data: the project, with its address when the build knows it. */
export function publisher(site: SiteData, i18n: I18n): Record<string, unknown> {
  return {
    "@type": "Organization",
    name: i18n.t("appName"),
    ...(site.siteUrl ? { url: `${site.siteUrl}/` } : {}),
  };
}

/** The region as a place with a bounding box ("south west north east"), from the grid archive's bounds. */
export function spatialCoverage(site: SiteData, i18n: I18n): Record<string, unknown> {
  const [west, south, east, north] = site.current.tiles.grid.bounds;
  return {
    "@type": "Place",
    name: SCOPE_COUNTRIES.map((code) => i18n.country(code)).join(", "),
    geo: { "@type": "GeoShape", box: `${south} ${west} ${north} ${east}` },
  };
}

/**
 * The latest of some ISO instants or dates (null and missing ones are skipped), for a page built from several
 * sources; `fallback` when none is known.
 */
export function latestDate(dates: readonly (string | null | undefined)[], fallback: string): string {
  let best: string | null = null;
  for (const date of dates) {
    if (!date || Number.isNaN(Date.parse(date))) continue;
    if (best === null || Date.parse(date) > Date.parse(best)) best = date;
  }
  return best ?? fallback;
}
