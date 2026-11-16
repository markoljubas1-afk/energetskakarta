/**
 * The static pages built from a data release for search engines and AI assistants, which read the
 * HTML they are given and do not run the map. Pure: data in, page models out (html.ts renders them).
 */
import { type SearchHit, toHit } from "../data/search";
import { SCOPE_COUNTRIES } from "../domain";
import { LANGS } from "../state/url";
import { aboutPage, apiPage } from "./aboutPages";
import { learnPage } from "./learnPages";
import { assetContext } from "./assetFacts";
import { assetPage, citiesPage, pageWorthy } from "./assetPages";
import type { HubKey } from "./copy";
import { countryPage, groupHubs, hubPage, largestPage } from "./countryPages";
import type { SiteData, StaticPage } from "./site";

// Everything other modules and tests import from "./pages" stays importable from here.
export { hubKeyOf, pageWorthy } from "./assetPages";
export { groupHubs } from "./countryPages";
export { definitions, escapeHtml, linkedTable, list } from "./markup";
export {
  ASSET_PAGE_MIN_KV,
  ASSET_PAGE_MIN_MW,
  assetSlug,
  CITY_PAGE_MIN_MWH,
  type Crumb,
  downloadUrl,
  homeCrumb,
  HUB_KEYS,
  HUB_ROWS,
  HUB_SLUGS,
  LARGEST_ROWS,
  mapLink,
  PATHS,
  publisher,
  type Section,
  type SiteData,
  type StaticPage,
} from "./site";
import { capacityIndex, capacityPages } from "./capacity";
import { energyPages } from "./energyPages";
import { geothermalPages } from "./geothermal";
import { reportPages } from "./report";
import { supportPages } from "./support";
import { transitionPages } from "./transition";

/** Every static page of a release, both languages: about, API, cities, the largest plants, countries with
 * their topic pages, then the assets. Every asset page is linked from a topic page (no orphans). */
export function buildPages(site: SiteData): StaticPage[] {
  const pages: StaticPage[] = [];
  const hubs = groupHubs(site);
  for (const lang of LANGS) {
    pages.push(aboutPage(site, lang));
    pages.push(learnPage(site, lang));
    pages.push(apiPage(site, lang));
    if (site.cities) pages.push(citiesPage(site, lang, site.cities));
    pages.push(largestPage(site, lang));
    for (const code of SCOPE_COUNTRIES) {
      const countryHubs = hubs.get(code) ?? new Map<HubKey, SearchHit[]>();
      pages.push(countryPage(site, lang, code, countryHubs));
      for (const [key, hits] of countryHubs) pages.push(hubPage(site, lang, code, key, hits));
    }
  }
  const assets = site.index.rows.map(toHit).filter(pageWorthy);
  const capacity = capacityIndex(site);
  const context = assetContext(site, site.index.rows.map(toHit), assets);
  for (const lang of LANGS)
    for (const hit of assets) pages.push(assetPage(site, lang, hit, capacity, context));
  pages.push(...capacityPages(site, capacity));
  pages.push(...energyPages(site));
  pages.push(...transitionPages(site));
  pages.push(...reportPages(site));
  pages.push(...geothermalPages(site));
  pages.push(...supportPages(site));
  return pages;
}
