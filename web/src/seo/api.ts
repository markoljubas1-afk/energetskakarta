/**
 * Open JSON files under /api/, written with every build. They are summaries: what the search index and
 * the statistics know, shaped for a script or an assistant that wants one object or one country without
 * downloading the whole database. The complete records stay in the NDJSON downloads, which every file
 * links to.
 */
import { cityRows, type CityRow } from "../data/cities";
import { HEP_KEYS } from "../data/hep";
import { toHit, type SearchHit } from "../data/search";
import { summarize } from "../data/stats";
import { SCOPE_COUNTRIES, type CountryCode } from "../domain";
import { createI18n } from "../i18n";
import { assetSlug, downloadUrl, mapLink, PATHS, type SiteData } from "./site";
import { pageWorthy } from "./assetPages";
import { DATA_LICENSE } from "./license";
import { API_PATHS } from "./paths";

export const API_VERSION = 1;
export { API_PATHS };

const LICENSE = DATA_LICENSE;

type Json = Record<string, unknown>;

function abs(site: SiteData, path: string): string {
  return site.siteUrl ? site.siteUrl + path : path;
}

const LAYER_OF_KIND: Record<
  SearchHit["kind"],
  "plants" | "substations" | "datacenters" | "cities" | "extraction"
> = {
  plant: "plants",
  substation: "substations",
  datacenter: "datacenters",
  city: "cities",
  extraction: "extraction",
};

function assetJson(site: SiteData, hit: SearchHit, city: CityRow | undefined): Json {
  const slug = assetSlug(hit.id);
  const layer = LAYER_OF_KIND[hit.kind];
  const download = site.current.downloads[layer];
  const facts: Json =
    hit.kind === "plant"
      ? { technology: hit.technology, capacityMw: hit.capacityMw }
      : hit.kind === "substation"
        ? { maxVoltageKv: hit.maxVoltageKv }
        : hit.kind === "datacenter"
          ? { powerMw: hit.powerMw }
          : hit.kind === "extraction"
            ? {
                extractionKind: hit.extractionKind,
                substance: hit.substance,
                note: "Location only; no open source measures the output of a single well or mine.",
              }
            : {
                inventoryYear: hit.inventoryYear,
                electricityMwh: hit.electricityMwh,
                ...(city
                  ? {
                      population: city.population,
                      baselineInventory: city.baseline,
                      totalMwh: city.totalMwh,
                      baselineYear: city.baselineYear,
                      baselineElectricityMwh: city.baselineElectricityMwh,
                      electricityBySectorMwh: city.electricityBySector,
                    }
                  : {}),
              };
  return {
    apiVersion: API_VERSION,
    id: hit.id,
    slug,
    kind: hit.kind,
    name: hit.name,
    country: hit.country,
    location: { lon: hit.lon, lat: hit.lat },
    ...facts,
    summary: true,
    links: {
      map: abs(site, mapLink("hr", { sel: hit.id, v: `${hit.lat.toFixed(4)},${hit.lon.toFixed(4)},12` })),
      page: abs(site, PATHS.hr.asset(slug)),
      pageEn: abs(site, PATHS.en.asset(slug)),
      ...(hit.id.startsWith("osm:")
        ? { openstreetmap: `https://www.openstreetmap.org/${hit.id.slice(4)}` }
        : {}),
      ...(download ? { fullRecords: downloadUrl(site, download) } : {}),
    },
    buildId: site.current.buildId,
    license: LICENSE,
  };
}

function countryJson(site: SiteData, code: CountryCode): Json {
  const hr = createI18n("hr");
  const en = createI18n("en");
  const summary = summarize(site.stats, code, SCOPE_COUNTRIES);
  return {
    apiVersion: API_VERSION,
    country: code,
    name: { hr: hr.country(code), en: en.country(code) },
    operatingMw: summary.operatingMw,
    pipelineMw: summary.pipelineMw,
    technologies: summary.technologies,
    lineKm: summary.lineKm,
    substations: summary.substations,
    datacenters: summary.datacenters,
    note: "Sums of what the sources record; a lower bound of the real figures.",
    links: {
      map: abs(site, mapLink("hr", { c: code })),
      page: abs(site, PATHS.hr.country(code.toLowerCase())),
      pageEn: abs(site, PATHS.en.country(code.toLowerCase())),
    },
    buildId: site.current.buildId,
    createdAt: site.current.createdAt,
    license: LICENSE,
  };
}

/** Every /api/ file of a release: path (without leading slash) → JSON text. */
export function apiFiles(site: SiteData): Map<string, string> {
  const files = new Map<string, string>();
  const write = (path: string, body: Json): void => {
    files.set(path.replace(/^\/+/, ""), JSON.stringify(body));
  };
  const cities = site.cities ? cityRows(site.cities) : [];
  const cityById = new Map(cities.map((row) => [row.id, row]));
  const hits = site.index.rows.map(toHit).filter(pageWorthy);
  for (const hit of hits)
    write(API_PATHS.asset(assetSlug(hit.id)), assetJson(site, hit, cityById.get(hit.id)));
  for (const code of SCOPE_COUNTRIES) write(API_PATHS.country(code.toLowerCase()), countryJson(site, code));
  if (site.cities) {
    write(API_PATHS.cities, {
      apiVersion: API_VERSION,
      buildId: site.current.buildId,
      source: "Covenant of Mayors / JRC (CC BY 4.0)",
      note: "A register with an inventory year per city, not a live meter; a sector a city did not report is absent.",
      cities,
    });
  }
  write(API_PATHS.index, {
    apiVersion: API_VERSION,
    buildId: site.current.buildId,
    createdAt: site.current.createdAt,
    docs: { hr: abs(site, API_PATHS.docs.hr), en: abs(site, API_PATHS.docs.en) },
    endpoints: {
      country: abs(site, "/api/zemlja/{hr|si|hu|rs|ba|me|it|at}.json"),
      asset: abs(site, "/api/objekt/{slug}.json"),
      ...(site.cities ? { cities: abs(site, API_PATHS.cities) } : {}),
    },
    ...(site.capacity
      ? {
          capacity: {
            source: "HEP ODS (kapaciteti.hep.hr), reused with permission; for information only",
            dataVersion: site.capacity.dataVersion,
            dataDate: site.capacity.dataDate,
            current: downloadUrl(site, HEP_KEYS.current),
            history: downloadUrl(site, HEP_KEYS.history),
            areas: downloadUrl(site, HEP_KEYS.regions),
          },
        }
      : {}),
    countries: SCOPE_COUNTRIES,
    assets: hits.length,
    downloads: Object.fromEntries(
      Object.entries(site.current.downloads).flatMap(([layer, key]) =>
        key ? [[layer, downloadUrl(site, key)]] : [],
      ),
    ),
    license: LICENSE,
  });
  return files;
}
