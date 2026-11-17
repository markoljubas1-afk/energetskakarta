/**
 * Static pages for HEP ODS's grid capacity (Faza 15): one overview with the analytics (categories, areas,
 * trend, changes, where an upgrade helps) and one page per substation. They are what investors and AI
 * assistants find when they search for a substation by name, and they cite HEP ODS with its disclaimer.
 */
import {
  byArea,
  CATEGORIES,
  childrenOf,
  countByCategory,
  HEP_KEYS,
  lastChanges,
  matchOsm,
  stationSlug,
  stationSlugs,
  trend,
  upgradeGains,
  type Category,
  type HepHistory,
  type HepRelease,
  type HepStation,
  type OsmSubstation,
} from "../data/hep";
import { toHit } from "../data/search";
import { createI18n, type I18n } from "../i18n";
import { LANGS, type Lang } from "../state/url";
import { CAPACITY_COPY, type CapacityCopy } from "./capacityCopy";
import {
  downloadUrl,
  homeCrumb,
  assetSlug,
  mapLink,
  PATHS,
  publisher,
  type SiteData,
  type StaticPage,
} from "./site";
import { definitions, escapeHtml as e, linkedTable, list, stationsOf } from "./markup";
import { capacityDoor, solarDoor } from "./pageDoors";
import { pageWorthy } from "./assetPages";

export const HEP_SOURCE_URL = "https://kapaciteti.hep.hr/";
const HEP_ODS = { "@type": "Organization", name: "HEP ODS", url: "https://www.hep.hr/ods/" };
/** rows of the "where an upgrade helps" table */
export const UPGRADE_ROWS = 30;

const other = (lang: Lang): Lang => (lang === "hr" ? "en" : "hr");

/** Stable slugs per substation, unique even if two names slug alike (the later one, by name, gets "-2"). */

/** Re-exported for the pages' tests and callers that import it from here. */
export { stationSlugs };

const mw = (i18n: I18n, kw: number | null): string => (kw === null ? "" : i18n.power(kw / 1000));

/** Slugs and the links between HEP substations and the map's OpenStreetMap substations (17-7). */
export interface CapacityIndex {
  release: HepRelease;
  slugs: Map<string, string>;
  osmByHep: Map<string, OsmSubstation>;
  hepByOsm: Map<string, HepStation>;
}

export function capacityIndex(site: SiteData): CapacityIndex | null {
  const release = site.capacity;
  if (!release) return null;
  const substations: OsmSubstation[] = site.index.rows
    .map(toHit)
    .flatMap((hit) =>
      hit.kind === "substation"
        ? [{ id: hit.id, name: hit.name, lat: hit.lat, lon: hit.lon, maxVoltageKv: hit.maxVoltageKv }]
        : [],
    );
  const osmByHep = matchOsm(release, substations);
  const byId = new Map(release.stations.map((station) => [station.id, station]));
  const hepByOsm = new Map<string, HepStation>();
  for (const [hepId, osm] of osmByHep) {
    const station = byId.get(hepId);
    // two HEP substations on one OSM site: the page shows the first by name, and both link to the map
    if (station && !hepByOsm.has(osm.id)) hepByOsm.set(osm.id, station);
  }
  return { release, slugs: stationSlugs(release), osmByHep, hepByOsm };
}

/** Whether an OSM substation has a page of its own (≥ 220 kV), by the same rule as the asset pages. */
function osmPageWorthy(osm: OsmSubstation): boolean {
  return pageWorthy({
    kind: "substation",
    id: osm.id,
    name: osm.name,
    country: "HR",
    lon: osm.lon,
    lat: osm.lat,
    maxVoltageKv: osm.maxVoltageKv,
  });
}

function stationLink(lang: Lang, station: HepStation, slugs: Map<string, string>): string {
  const slug = slugs.get(station.id);
  return slug ? `<a href="${PATHS[lang].capacityStation(slug)}">${e(station.id)}</a>` : e(station.id);
}

function categoryTable(copy: CapacityCopy, i18n: I18n, release: HepRelease): string {
  const existing = countByCategory(release.stations, "existing");
  const upgraded = countByCategory(release.stations, "upgraded");
  return linkedTable(
    [copy.columns.category, copy.columns.existing, copy.columns.upgraded],
    CATEGORIES.map((category) => [
      e(copy.category[category]),
      i18n.number(existing[category]),
      i18n.number(upgraded[category]),
    ]),
  );
}

function areaTable(copy: CapacityCopy, i18n: I18n, release: HepRelease): string {
  return linkedTable(
    [copy.columns.area, copy.columns.stations, copy.columns.noneShare],
    byArea(release).map((area) => [
      e(area.name ?? copy.noArea),
      i18n.number(area.stations),
      `${i18n.number(area.existing.none)} (${i18n.percent(area.noneShare)})`,
    ]),
  );
}

function trendTable(copy: CapacityCopy, i18n: I18n, history: HepHistory): string {
  return linkedTable(
    [copy.columns.release, ...CATEGORIES.map((category) => copy.category[category])],
    trend(history).map((release) => [
      e(`${i18n.date(release.dataDate)} (v${release.dataVersion})`),
      ...CATEGORIES.map((category: Category) => i18n.number(release.existing[category])),
    ]),
  );
}

function changesHtml(
  lang: Lang,
  copy: CapacityCopy,
  release: HepRelease,
  history: HepHistory,
  slugs: Map<string, string>,
): string {
  const { worse, better } = lastChanges(history);
  const byId = new Map(release.stations.map((station) => [station.id, station]));
  const item = (change: { id: string; from: Category; to: Category }): string => {
    const station = byId.get(change.id);
    const name = station ? stationLink(lang, station, slugs) : e(change.id);
    return `${name}: ${e(copy.category[change.from])} → ${e(copy.category[change.to])}`;
  };
  return [
    ...(worse.length ? [`<h3>${e(copy.worse)} (${worse.length})</h3>${list(worse.map(item))}`] : []),
    ...(better.length ? [`<h3>${e(copy.better)} (${better.length})</h3>${list(better.map(item))}`] : []),
  ].join("");
}

function sourceHtml(lang: Lang, copy: CapacityCopy, i18n: I18n, release: HepRelease): string {
  const state = lang === "hr" ? "Stanje podataka" : "State of the data";
  return [
    `<p>${e(copy.source)}</p>`,
    `<p>${e(state)}: ${e(i18n.date(release.dataDate))} (v${release.dataVersion}).</p>`,
    list([`<a href="${HEP_SOURCE_URL}" rel="noopener">${e(copy.openSource)}</a>`]),
  ].join("");
}

function overviewPage(
  site: SiteData,
  lang: Lang,
  release: HepRelease,
  history: HepHistory | null,
  slugs: Map<string, string>,
): StaticPage {
  const copy = CAPACITY_COPY[lang];
  const i18n = createI18n(lang);
  const existing = countByCategory(release.stations, "existing");
  const upgraded = countByCategory(release.stations, "upgraded");
  const gains = upgradeGains(release).slice(0, UPGRADE_ROWS);
  const roots = release.stations
    .filter((station) => station.parent === null)
    .sort((a, b) => (b.levelKv ?? 0) - (a.levelKv ?? 0) || a.id.localeCompare(b.id, "hr"));
  const releases = history?.snapshots ?? [];
  const first = releases[0]?.dataDate ?? release.dataDate;
  const path = PATHS[lang].capacity;
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].capacity,
    title: copy.title,
    description: copy.description,
    heading: copy.heading,
    doors: [capacityDoor(lang), solarDoor(lang)],
    lead: `<p>${e(
      copy.lead(
        i18n.number(existing.none),
        stationsOf(lang, release.stations.length),
        i18n.number(upgraded.none),
        i18n.date(release.dataDate),
        String(release.dataVersion),
      ),
    )}</p>`,
    sections: [
      { heading: copy.categoriesHeading, html: categoryTable(copy, i18n, release) },
      { heading: copy.areasHeading, html: areaTable(copy, i18n, release) },
      ...(history && releases.length > 0
        ? [{ heading: copy.trendHeading, html: trendTable(copy, i18n, history) }]
        : []),
      ...(history && releases.length > 1
        ? [
            {
              heading: copy.changesHeading(
                i18n.date(releases[releases.length - 2]?.dataDate ?? ""),
                i18n.date(releases[releases.length - 1]?.dataDate ?? ""),
              ),
              html: changesHtml(lang, copy, release, history, slugs),
            },
          ]
        : []),
      ...(gains.length > 0
        ? [
            {
              heading: copy.upgradeHeading,
              html:
                `<p>${e(copy.upgradeNote)}</p>` +
                linkedTable(
                  [
                    copy.columns.station,
                    copy.columns.existing,
                    copy.columns.upgraded,
                    copy.columns.additional,
                  ],
                  gains.map(({ station }) => [
                    stationLink(lang, station, slugs),
                    copy.category[station.existing],
                    copy.category[station.upgraded],
                    mw(i18n, station.additionalFreeKw),
                  ]),
                ),
            },
          ]
        : []),
      {
        heading: copy.rootsHeading,
        html:
          `<p>${e(copy.rootsNote)}</p>` +
          linkedTable(
            [
              copy.columns.station,
              copy.columns.ratio,
              copy.columns.existing,
              copy.columns.free,
              copy.columns.feeds,
            ],
            roots.map((station) => [
              stationLink(lang, station, slugs),
              station.ratio ?? "",
              copy.category[station.existing],
              mw(i18n, station.freeKw),
              i18n.number(childrenOf(release, station.id).length),
            ]),
          ),
      },
      { heading: copy.sourceHeading, html: sourceHtml(lang, copy, i18n, release) },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: copy.title,
        description: copy.description,
        inLanguage: lang,
        isAccessibleForFree: true,
        isBasedOn: HEP_SOURCE_URL,
        creator: HEP_ODS,
        publisher: publisher(site, i18n),
        dateModified: release.publishedAt,
        temporalCoverage: `${first}/${release.dataDate}`,
        spatialCoverage: { "@type": "Country", name: i18n.country("HR") },
        distribution: [
          {
            "@type": "DataDownload",
            encodingFormat: "application/json",
            contentUrl: downloadUrl(site, HEP_KEYS.current),
          },
        ],
        ...(site.siteUrl ? { url: site.siteUrl + path } : {}),
      },
    ],
    lastModified: release.publishedAt,
    breadcrumbs: [homeCrumb(lang)],
  };
}

function stationPage(
  site: SiteData,
  lang: Lang,
  index: CapacityIndex,
  history: HepHistory | null,
  station: HepStation,
): StaticPage {
  const { release, slugs } = index;
  const copy = CAPACITY_COPY[lang];
  const labels = copy.station.labels;
  const i18n = createI18n(lang);
  const slug = slugs.get(station.id) ?? stationSlug(station.id);
  const path = PATHS[lang].capacityStation(slug);
  const byId = new Map(release.stations.map((s) => [s.id, s]));
  const parent = station.parent ? byId.get(station.parent) : undefined;
  const area = release.areas.find((a) => a.id === station.area)?.name ?? null;
  const children = childrenOf(release, station.id);
  const osm = index.osmByHep.get(station.id);
  const position =
    station.lon !== null && station.lat !== null ? { lon: station.lon, lat: station.lat } : null;
  const mva = (units: number[]): string => units.map((unit) => i18n.number(unit)).join(" + ");
  const facts: [string, string][] = (
    [
      [labels.existing, e(copy.category[station.existing])],
      [labels.upgraded, e(copy.category[station.upgraded])],
      [labels.free, e(mw(i18n, station.freeKw))],
      [labels.additional, e(mw(i18n, station.additionalFreeKw))],
      [labels.existingUsers, e(mw(i18n, station.existingUsersKw))],
      [labels.contracted, e(mw(i18n, station.contractedUsersKw))],
      [labels.pending, e(mw(i18n, station.pendingUsersKw))],
      [labels.total, e(mw(i18n, station.totalConnectionKw))],
      [labels.minConsumption, e(mw(i18n, station.minConsumptionKw))],
      [labels.transformers, e(mva(station.transformersMva))],
      [labels.planned, e(mva(station.plannedTransformersMva))],
      [labels.ratio, e(station.ratio ?? "")],
      [labels.area, e(area ?? "")],
      [labels.parent, parent ? stationLink(lang, parent, slugs) : ""],
      [labels.position, position ? e(`${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`) : ""],
      [labels.onMap, osm ? osmLink(lang, osm) : ""],
    ] satisfies [string, string][]
  ).filter(([, value]) => value !== "");
  const series = history?.stations[station.id];
  const historyRows =
    history && series
      ? history.snapshots.flatMap((snapshot, index): [string, ...string[]][] => {
          const category = series.existing[index] ?? null;
          return category === null
            ? []
            : [
                [
                  e(`${i18n.date(snapshot.dataDate)} (v${snapshot.dataVersion})`),
                  copy.category[category],
                  mw(i18n, series.freeKw[index] ?? null),
                ],
              ];
        })
      : [];
  const free = mw(i18n, station.freeKw);
  const description = copy.station.description(station.name, copy.category[station.existing], free);
  const view = position ? `${position.lat.toFixed(4)},${position.lon.toFixed(4)},12` : null;
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].capacityStation(slug),
    title: copy.station.title(station.id, ""),
    description,
    heading: station.id,
    lead: `<p>${e(labels.existing)}: ${e(copy.category[station.existing])}${free ? ` · ${e(labels.free)}: ${e(free)}` : ""}</p>`,
    sections: [
      { heading: copy.station.factsHeading, html: definitions(facts) },
      ...(children.length > 0
        ? [
            {
              heading: copy.station.feedsHeading,
              html: linkedTable(
                [copy.columns.station, copy.columns.existing, copy.columns.free],
                children.map((child) => [
                  stationLink(lang, child, slugs),
                  copy.category[child.existing],
                  mw(i18n, child.freeKw),
                ]),
              ),
            },
          ]
        : []),
      ...(historyRows.length > 0
        ? [
            {
              heading: copy.station.historyHeading,
              html: linkedTable(
                [copy.columns.release, copy.columns.existing, copy.columns.free],
                historyRows,
              ),
            },
          ]
        : []),
      {
        heading: copy.sourceHeading,
        html:
          list([
            ...(view ? [`<a href="${e(mapLink(lang, { v: view }))}">${e(copy.station.openMap)}</a>`] : []),
            `<a href="${PATHS[lang].capacity}">${e(copy.heading)}</a>`,
          ]) + sourceHtml(lang, copy, i18n, release),
      },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Place",
        name: station.id,
        description,
        ...(position
          ? { geo: { "@type": "GeoCoordinates", latitude: position.lat, longitude: position.lon } }
          : {}),
        address: { "@type": "PostalAddress", addressCountry: "HR" },
        additionalProperty: [
          { "@type": "PropertyValue", name: "acceptanceCategoryExistingNetwork", value: station.existing },
          { "@type": "PropertyValue", name: "acceptanceCategoryUpgradedNetwork", value: station.upgraded },
          ...(station.freeKw !== null
            ? [{ "@type": "PropertyValue", name: "freeCapacity", value: station.freeKw, unitCode: "KWT" }]
            : []),
          ...(station.levelKv !== null
            ? [{ "@type": "PropertyValue", name: "voltageLevel", value: station.levelKv, unitCode: "KVT" }]
            : []),
        ],
        isBasedOn: HEP_SOURCE_URL,
        ...(site.siteUrl ? { url: site.siteUrl + path } : {}),
      },
    ],
    lastModified: release.publishedAt,
    breadcrumbs: [
      homeCrumb(lang),
      { name: copy.heading, path: PATHS[lang].capacity },
      ...(parent ? [{ name: parent.id, path: PATHS[lang].capacityStation(slugs.get(parent.id) ?? "") }] : []),
    ],
  };
}

/** The OSM substation on the map: its own page when it has one, otherwise the map opened on it. */
function osmLink(lang: Lang, osm: OsmSubstation): string {
  const name = e(osm.name);
  if (osmPageWorthy(osm)) return `<a href="${PATHS[lang].asset(assetSlug(osm.id))}">${name}</a>`;
  const view = `${osm.lat.toFixed(4)},${osm.lon.toFixed(4)},12`;
  return `<a href="${e(mapLink(lang, { sel: osm.id, v: view }))}">${name}</a>`;
}

/** The overview and one page per substation, both languages; nothing when the release has no capacity data. */
export function capacityPages(
  site: SiteData,
  index: CapacityIndex | null = capacityIndex(site),
): StaticPage[] {
  if (!index) return [];
  const history = site.capacityHistory ?? null;
  const pages: StaticPage[] = [];
  for (const lang of LANGS) {
    pages.push(overviewPage(site, lang, index.release, history, index.slugs));
    for (const station of index.release.stations)
      pages.push(stationPage(site, lang, index, history, station));
  }
  return pages;
}

/** The section of an OSM substation page that shows HEP's capacity for the same place, or null. */
export function assetCapacitySection(
  lang: Lang,
  osmId: string,
  index: CapacityIndex | null,
): { heading: string; html: string } | null {
  const station = index?.hepByOsm.get(osmId);
  if (!index || !station) return null;
  const copy = CAPACITY_COPY[lang];
  const i18n = createI18n(lang);
  const slug = index.slugs.get(station.id);
  return {
    heading: copy.asset.heading,
    html:
      `<p>${e(copy.asset.text(copy.category[station.existing], mw(i18n, station.freeKw)))}</p>` +
      (slug
        ? list([`<a href="${PATHS[lang].capacityStation(slug)}">${e(station.id)}: ${e(copy.asset.link)}</a>`])
        : ""),
  };
}
