/**
 * Pages for single assets and for cities (Faza 26 split from pages.ts): which assets are worth a page, and what
 * each page says.
 */
import { type CityRegister, type CityRow, cityRows } from "../data/cities";
import type { SearchHit } from "../data/search";
import { type ExtractionKind, SCOPE_COUNTRIES, SECTORS } from "../domain";
import { createI18n, type I18n } from "../i18n";
import type { Lang } from "../state/url";
import { type AssetContext, assetExtras } from "./assetFacts";
import { assetCapacitySection, type CapacityIndex } from "./capacity";
import { COPY, type HubKey } from "./copy";
import { definitions, e, list, scrollable, table } from "./markup";
import { citiesDoor } from "./pageDoors";
import { API_PATHS } from "./paths";
import {
  absolute,
  ASSET_PAGE_MIN_KV,
  ASSET_PAGE_MIN_MW,
  ASSET_ZOOM,
  assetSlug,
  CITY_PAGE_MIN_MWH,
  type Crumb,
  home,
  mapLink,
  other,
  PATHS,
  publisher,
  type Section,
  type SiteData,
  type StaticPage,
} from "./site";

/** The assets that earn a page of their own: large enough to be looked up by name. */
export function pageWorthy(hit: SearchHit): boolean {
  if (hit.kind === "plant") return (hit.capacityMw ?? 0) >= ASSET_PAGE_MIN_MW;
  if (hit.kind === "substation") return (hit.maxVoltageKv ?? 0) >= ASSET_PAGE_MIN_KV;
  if (hit.kind === "city") return hit.electricityMwh >= CITY_PAGE_MIN_MWH;
  // a named platform, mine or open pit is a landmark; a single well or shaft is not
  if (hit.kind === "extraction") return PAGE_WORTHY_EXTRACTION.has(hit.extractionKind);
  return true; // data centres are few and named
}

const mwh = (i18n: I18n, value: number): string => i18n.number(value);

/** The sector table of a city page, when the register knows the city. */
function citySectors(row: CityRow | undefined, lang: Lang, i18n: I18n): Section | null {
  if (!row) return null;
  const copy = COPY[lang].cities;
  const entries = SECTORS.flatMap((sector) => {
    const value = row.electricityBySector[sector];
    return value === undefined ? [] : [[sector, value] as const];
  }).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return {
    heading: copy.sectorsHeading,
    html: table(
      [copy.sectorColumns.sector, copy.sectorColumns.electricity, copy.sectorColumns.share],
      entries.map(([sector, value]) => [
        i18n.t(`sector_${sector}`),
        mwh(i18n, value),
        row.electricityMwh > 0 ? i18n.percent(value / row.electricityMwh) : "",
      ]),
    ),
  };
}

export function citiesPage(site: SiteData, lang: Lang, register: CityRegister): StaticPage {
  const copy = COPY[lang];
  const i18n = createI18n(lang);
  const c = copy.cities;
  const rows = cityRows(register);
  const cell = (value: number | undefined): string => (value === undefined ? "" : mwh(i18n, value));
  const name = (row: CityRow): string =>
    row.electricityMwh >= CITY_PAGE_MIN_MWH
      ? `<a href="${PATHS[lang].asset(assetSlug(row.id))}">${e(row.name)}</a>`
      : e(row.name);
  const byCountry = SCOPE_COUNTRIES.flatMap((code) => {
    const here = rows.filter((row) => row.country === code);
    if (here.length === 0) return [];
    const columns = [
      c.columns.city,
      c.columns.year,
      c.columns.population,
      c.columns.electricity,
      c.columns.lighting,
      c.columns.transport,
    ];
    const tableHtml = `<table><thead><tr>${columns.map((h) => `<th>${e(h)}</th>`).join("")}</tr></thead><tbody>${here
      .map(
        (row) =>
          `<tr><td>${name(row)}</td><td class="num">${row.inventoryYear}</td><td class="num">${row.population === null ? "" : i18n.number(row.population)}</td><td class="num">${mwh(i18n, row.electricityMwh)}</td><td class="num">${cell(row.electricityBySector.public_lighting)}</td><td class="num">${cell(row.electricityBySector.public_transport)}</td></tr>`,
      )
      .join("")}</tbody></table>`;
    const html = scrollable(tableHtml, columns);
    return [{ heading: `${i18n.country(code)} (${i18n.number(here.length)})`, html }];
  });
  const path = PATHS[lang].cities;
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].cities,
    title: c.title,
    description: c.description,
    heading: c.heading,
    lead: c.intro.map((p) => `<p>${e(p)}</p>`).join(""),
    doors: [citiesDoor(lang)],
    sections: [...byCountry, { heading: copy.about.sourcesHeading, html: `<p>${e(c.note)}</p>` }],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: c.title,
        description: c.description,
        inLanguage: lang,
        license: "https://creativecommons.org/licenses/by/4.0/",
        isBasedOn: "https://data.jrc.ec.europa.eu/collection/CoM",
        dateModified: site.current.createdAt,
        creator: publisher(site, i18n),
        ...(absolute(site, path) ? { url: absolute(site, path) } : {}),
      },
    ],
    lastModified: site.current.createdAt,
    breadcrumbs: [home(lang)],
    apiPath: API_PATHS.cities,
  };
}

const PAGE_WORTHY_EXTRACTION: ReadonlySet<ExtractionKind> = new Set(["platform", "mine", "quarry"]);

/** The topic page an asset belongs to; cities have the register instead. */
export function hubKeyOf(hit: SearchHit): HubKey | null {
  if (hit.kind === "plant") return hit.technology;
  if (hit.kind === "substation") return "substations";
  if (hit.kind === "datacenter") return "datacenters";
  if (hit.kind === "extraction") return "extraction";
  return null;
}

/** "hidroelektrana", "trafostanica", …: the lower-case kind that goes into an asset's title. */
function singularKind(hit: SearchHit, lang: Lang, i18n: I18n): string {
  const copy = COPY[lang].asset;
  if (hit.kind === "plant") return copy.plant[hit.technology];
  if (hit.kind === "substation") return copy.substation;
  if (hit.kind === "datacenter") return copy.datacenter;
  if (hit.kind === "extraction") return i18n.t(`extraction_${hit.extractionKind}`).toLowerCase();
  return i18n.t(`kind_${hit.kind}`).toLowerCase();
}

/** The one number that identifies an asset at a glance, for its title. */
function keyFigure(hit: SearchHit, i18n: I18n): string {
  if (hit.kind === "plant" && hit.capacityMw !== null) return i18n.power(hit.capacityMw);
  if (hit.kind === "substation" && hit.maxVoltageKv !== null)
    return `${i18n.number(hit.maxVoltageKv)} ${i18n.t("unitKv")}`;
  if (hit.kind === "datacenter" && hit.powerMw !== null) return i18n.power(hit.powerMw);
  return "";
}

export function assetPage(
  site: SiteData,
  lang: Lang,
  hit: SearchHit,
  capacity: CapacityIndex | null,
  context: AssetContext,
): StaticPage {
  const copy = COPY[lang];
  const i18n = createI18n(lang);
  const kind = i18n.t(`kind_${hit.kind}`);
  const country = hit.country ? i18n.country(hit.country) : "";
  const kv = (value: number): string => `${i18n.number(value)} ${i18n.t("unitKv")}`;
  const detail =
    hit.kind === "plant"
      ? [i18n.technology(hit.technology), hit.capacityMw !== null ? i18n.power(hit.capacityMw) : null]
      : hit.kind === "substation"
        ? [hit.maxVoltageKv !== null ? kv(hit.maxVoltageKv) : null]
        : hit.kind === "datacenter"
          ? [hit.powerMw !== null ? i18n.power(hit.powerMw) : null]
          : hit.kind === "extraction"
            ? [i18n.t(`extraction_${hit.extractionKind}`), i18n.t(`substance_${hit.substance}`)]
            : [`${i18n.energy(hit.electricityMwh)}/${i18n.t("unitYear")}`, String(hit.inventoryYear)];
  const detailText = detail.filter((d): d is string => d !== null).join(", ");
  const slug = assetSlug(hit.id);
  const path = PATHS[lang].asset(slug);
  const osm = hit.id.startsWith("osm:") ? `https://www.openstreetmap.org/${hit.id.slice(4)}` : null;
  const view = `${hit.lat.toFixed(4)},${hit.lon.toFixed(4)},${ASSET_ZOOM}`;
  const facts: [string, string | null][] = [
    [copy.labels.kind, kind],
    [copy.labels.technology, hit.kind === "plant" ? i18n.technology(hit.technology) : null],
    [
      copy.labels.capacity,
      hit.kind === "plant" && hit.capacityMw !== null ? i18n.power(hit.capacityMw) : null,
    ],
    [
      copy.labels.voltage,
      hit.kind === "substation" && hit.maxVoltageKv !== null ? kv(hit.maxVoltageKv) : null,
    ],
    [copy.labels.power, hit.kind === "datacenter" && hit.powerMw !== null ? i18n.power(hit.powerMw) : null],
    [copy.labels.technology, hit.kind === "extraction" ? i18n.t(`extraction_${hit.extractionKind}`) : null],
    [copy.labels.substance, hit.kind === "extraction" ? i18n.t(`substance_${hit.substance}`) : null],
    [copy.labels.country, country || null],
    [copy.asset.coordinates, `${hit.lat.toFixed(5)}, ${hit.lon.toFixed(5)}`],
  ];
  const extras = assetExtras(
    context,
    lang,
    hit,
    hit.kind === "city" ? i18n.t("kind_city").toLowerCase() : singularKind(hit, lang, i18n),
  );
  const rows = [
    ...facts.flatMap(([label, value]): [string, string][] => (value === null ? [] : [[label, e(value)]])),
    ...extras.facts,
  ];
  const hubKey = hubKeyOf(hit);
  const code = hit.country?.toLowerCase() ?? null;
  const hub = hubKey && code ? { key: hubKey, path: PATHS[lang].hub(code, hubKey) } : null;
  const links = [
    `<a href="${e(mapLink(lang, { sel: hit.id, v: view }))}">${e(copy.asset.openMap)}</a>`,
    ...(osm ? [`<a href="${e(osm)}" rel="noopener">${e(copy.asset.onOsm)}</a>`] : []),
    ...extras.links,
    ...(hub && hit.country
      ? [`<a href="${hub.path}">${e(copy.hub.plural[hub.key])} ${e(copy.hub.inCountry[hit.country])}</a>`]
      : []),
    ...(code
      ? [`<a href="${PATHS[lang].country(code)}">${e(copy.asset.countryOverview)}: ${e(country)}</a>`]
      : []),
    ...(hit.kind === "city" && site.cities
      ? [`<a href="${PATHS[lang].cities}">${e(copy.cities.title)}</a>`]
      : []),
  ];
  const title =
    hit.kind === "city"
      ? copy.asset.cityTitle(hit.name, country)
      : copy.asset.title(hit.name, singularKind(hit, lang, i18n), keyFigure(hit, i18n), country);
  const breadcrumbs: Crumb[] = [
    home(lang),
    ...(hit.kind === "city" && site.cities ? [{ name: copy.cities.title, path: PATHS[lang].cities }] : []),
    ...(code ? [{ name: country, path: PATHS[lang].country(code) }] : []),
    ...(hub ? [{ name: copy.hub.plural[hub.key], path: hub.path }] : []),
  ];
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].asset(slug),
    title,
    description: copy.asset.description(kind, hit.name, detailText, country),
    heading: hit.name,
    lead: `<p>${e(kind)}${detailText ? ` · ${e(detailText)}` : ""}${country ? ` · ${e(country)}` : ""}</p>${extras.lead}`,
    sections: [
      { heading: kind, html: definitions(rows) },
      ...(hit.kind === "city" && site.cities
        ? [
            citySectors(
              cityRows(site.cities).find((row) => row.id === hit.id),
              lang,
              i18n,
            ),
          ].filter((section): section is Section => section !== null)
        : []),
      ...(extras.nearby ? [extras.nearby] : []),
      ...(hit.kind === "substation"
        ? [assetCapacitySection(lang, hit.id, capacity)].filter((section) => section !== null)
        : []),
      { heading: copy.nav.map, html: list(links) },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Place",
        name: hit.name,
        description: copy.asset.description(kind, hit.name, detailText, country),
        geo: { "@type": "GeoCoordinates", latitude: hit.lat, longitude: hit.lon },
        ...(country ? { address: { "@type": "PostalAddress", addressCountry: hit.country } } : {}),
        additionalProperty: [
          { "@type": "PropertyValue", name: "kind", value: hit.kind },
          ...(hit.kind === "plant"
            ? [{ "@type": "PropertyValue", name: "technology", value: hit.technology }]
            : []),
          ...(hit.kind === "plant" && hit.capacityMw !== null
            ? [{ "@type": "PropertyValue", name: "capacityMw", value: hit.capacityMw, unitCode: "MAW" }]
            : []),
          ...(hit.kind === "substation" && hit.maxVoltageKv !== null
            ? [{ "@type": "PropertyValue", name: "maxVoltageKv", value: hit.maxVoltageKv, unitCode: "KVT" }]
            : []),
          ...(hit.kind === "extraction"
            ? [
                { "@type": "PropertyValue", name: "extractionKind", value: hit.extractionKind },
                { "@type": "PropertyValue", name: "substance", value: hit.substance },
              ]
            : []),
        ],
        ...(osm || extras.sameAs.length > 0 ? { sameAs: [...(osm ? [osm] : []), ...extras.sameAs] } : {}),
        ...(absolute(site, path) ? { url: absolute(site, path) } : {}),
      },
    ],
    lastModified: site.current.createdAt,
    breadcrumbs,
    apiPath: API_PATHS.asset(slug),
    markdownTwin: false,
  };
}
