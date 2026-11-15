/**
 * Available capacity for new connections in HEP ODS's distribution grid (pipeline/src/energymap/hep/).
 *
 * The pipeline publishes the current release (`hep/current.json`) and the history of every release it has
 * seen (`hep/history.json`). Everything here is a pure function of those two files, so the map, the analytics
 * view, the static pages and the open JSON all count the same way.
 *
 * What the figures are not: a category is a band, not a number (D is "more than 20 MW"), and free capacity at
 * an MV/MV substation is limited again by the HV/MV substation above it. Nothing here adds capacities up.
 */
import type { Feature, FeatureCollection, Point } from "geojson";
import { z } from "zod";

import { assetUrl, DataError } from "./current";
import { distanceM } from "./geo";

export { distanceM };

export const HEP_KEYS = {
  current: "hep/current.json",
  history: "hep/history.json",
  regions: "hep/regions.geojson",
} as const;

export const CATEGORIES = ["none", "A", "B", "C", "D"] as const;
export type Category = (typeof CATEGORIES)[number];
/** The upper bound of each band in MW, as HEP ODS defines it; D has none. */
export const CATEGORY_LIMIT_MW: Record<Category, number | null> = { none: 0, A: 5, B: 10, C: 20, D: null };
/** Worse to better: "none" is 0, D is 4. */
export const categoryRank = (category: Category): number => CATEGORIES.indexOf(category);

const Kw = z.number().nullable();
const CategorySchema = z.enum(CATEGORIES);

export const HepStationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  label: z.string().nullable(),
  ratio: z.string().nullable(),
  levelKv: z.number().int().nullable(),
  area: z.number().int().nullable(),
  parent: z.string().nullable(),
  lon: z.number().nullable(),
  lat: z.number().nullable(),
  existing: CategorySchema,
  upgraded: CategorySchema,
  freeKw: Kw,
  additionalFreeKw: Kw,
  existingUsersKw: Kw,
  contractedUsersKw: Kw,
  pendingUsersKw: Kw,
  totalConnectionKw: Kw,
  minConsumptionKw: Kw,
  transformationKva: Kw,
  upgradeKva: Kw,
  transformersMva: z.array(z.number()),
  plannedTransformersMva: z.array(z.number()),
});
export type HepStation = z.infer<typeof HepStationSchema>;

export const HepReleaseSchema = z.object({
  version: z.literal(1),
  source: z.string(),
  sourceUrl: z.string(),
  license: z.string(),
  dataVersion: z.number().int(),
  dataDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  publishedAt: z.string(),
  retrievedAt: z.string(),
  contentHash: z.string(),
  areas: z.array(z.object({ id: z.number().int(), name: z.string() })),
  stations: z.array(HepStationSchema),
  problems: z.object({
    skipped: z.array(z.string()),
    outsideCroatia: z.array(z.string()),
    unresolvedParents: z.array(z.string()),
  }),
});
export type HepRelease = z.infer<typeof HepReleaseSchema>;

export const HepHistorySchema = z.object({
  version: z.literal(1),
  source: z.string(),
  license: z.string(),
  snapshots: z.array(
    z.object({
      dataVersion: z.number().int(),
      dataDate: z.string(),
      publishedAt: z.string().nullable(),
      key: z.string(),
    }),
  ),
  stations: z.record(
    z.string(),
    z.object({
      existing: z.array(CategorySchema.nullable()),
      upgraded: z.array(CategorySchema.nullable()),
      freeKw: z.array(z.number().nullable()),
    }),
  ),
});
export type HepHistory = z.infer<typeof HepHistorySchema>;

export type HepLoad = { kind: "none" } | { kind: "ready"; release: HepRelease; history: HepHistory | null };

/**
 * The capacity release and its history; a bucket without them (before the first `hep-daily`) is "none".
 * The map asks for the release only: its history is for the pages, and a broken history must not take the
 * layer down with it (L-058).
 */
export async function loadHep(
  base: URL,
  signal: AbortSignal,
  { history = true }: { history?: boolean } = {},
): Promise<HepLoad> {
  // releases come weeks apart; an hourly cache key is plenty
  const hour = Math.floor(Date.now() / 3_600_000);
  const current = await fetch(`${assetUrl(base, HEP_KEYS.current)}?t=${hour}`, { signal });
  if (current.status === 404) return { kind: "none" };
  if (!current.ok) throw new DataError(`capacity data returned HTTP ${current.status}`);
  const release = HepReleaseSchema.parse(await current.json());
  if (!history) return { kind: "ready", release, history: null };
  const past = await fetch(`${assetUrl(base, HEP_KEYS.history)}?t=${hour}`, { signal });
  if (past.status === 404) return { kind: "ready", release, history: null };
  if (!past.ok) throw new DataError(`capacity history returned HTTP ${past.status}`);
  return { kind: "ready", release, history: checkedHistory(HepHistorySchema.parse(await past.json())) };
}

/** Every series must have one value per snapshot, or the charts would shift releases against each other. */
export function checkedHistory(history: HepHistory): HepHistory {
  const length = history.snapshots.length;
  for (const [id, series] of Object.entries(history.stations)) {
    if (
      series.existing.length !== length ||
      series.upgraded.length !== length ||
      series.freeKw.length !== length
    ) {
      throw new DataError(`capacity history: ${id} does not have one value per release`);
    }
  }
  return history;
}

// ---------------------------------------------------------------- reading one release

/** HV/MV (110 kV and above) feed MV/MV substations (35 and 30 kV); a substation without a level is "unknown". */
export type Level = "hv" | "mv" | "unknown";
export function levelOf(station: HepStation): Level {
  if (station.levelKv === null) return "unknown";
  return station.levelKv >= 110 ? "hv" : "mv";
}

export type CategoryCounts = Record<Category, number>;

export function countByCategory(
  stations: readonly HepStation[],
  network: "existing" | "upgraded",
): CategoryCounts {
  const counts: CategoryCounts = { none: 0, A: 0, B: 0, C: 0, D: 0 };
  for (const station of stations) counts[station[network]] += 1;
  return counts;
}

export interface AreaSummary {
  /** null: substations HEP lists without a distribution area */
  id: number | null;
  name: string | null;
  stations: number;
  existing: CategoryCounts;
  upgraded: CategoryCounts;
  /** share of the area's substations that take no new generation today (0–1) */
  noneShare: number;
}

/** Per distribution area, most constrained first; the substations without an area come last. */
export function byArea(release: HepRelease): AreaSummary[] {
  const names = new Map(release.areas.map((area) => [area.id, area.name]));
  const grouped = new Map<number | null, HepStation[]>();
  for (const station of release.stations) {
    const key = station.area !== null && names.has(station.area) ? station.area : null;
    grouped.set(key, [...(grouped.get(key) ?? []), station]);
  }
  const summaries = [...grouped].map(([id, stations]): AreaSummary => {
    const existing = countByCategory(stations, "existing");
    return {
      id,
      name: id === null ? null : (names.get(id) ?? null),
      stations: stations.length,
      existing,
      upgraded: countByCategory(stations, "upgraded"),
      noneShare: stations.length > 0 ? existing.none / stations.length : 0,
    };
  });
  return summaries.sort(
    (a, b) =>
      Number(a.id === null) - Number(b.id === null) ||
      b.noneShare - a.noneShare ||
      (a.name ?? "").localeCompare(b.name ?? "", "hr"),
  );
}

export interface UpgradeGain {
  station: HepStation;
  /** how many bands the upgraded network gains over the existing one */
  steps: number;
}

/** Where an upgraded HV/MV transformer would open the most: largest category gain first, then the most kW. */
export function upgradeGains(release: HepRelease): UpgradeGain[] {
  return release.stations
    .map((station) => ({ station, steps: categoryRank(station.upgraded) - categoryRank(station.existing) }))
    .filter((gain) => gain.steps > 0)
    .sort(
      (a, b) =>
        b.steps - a.steps ||
        (b.station.additionalFreeKw ?? 0) - (a.station.additionalFreeKw ?? 0) ||
        a.station.name.localeCompare(b.station.name, "hr"),
    );
}

/** The MV/MV substations an HV/MV one feeds, by name. */
export function childrenOf(release: HepRelease, id: string): HepStation[] {
  return release.stations
    .filter((station) => station.parent === id)
    .sort((a, b) => a.name.localeCompare(b.name, "hr"));
}

/** The substations with a position, as points for the map; the category drives the colour. */
export function capacityOverlay(release: HepRelease): FeatureCollection<Point> {
  const features = release.stations.flatMap<Feature<Point>>((station) =>
    station.lon === null || station.lat === null
      ? []
      : [
          {
            type: "Feature",
            id: station.id,
            geometry: { type: "Point", coordinates: [station.lon, station.lat] },
            properties: {
              id: station.id,
              name: station.name,
              level: levelOf(station),
              existing: station.existing,
              upgraded: station.upgraded,
              rank: categoryRank(station.existing),
            },
          },
        ],
  );
  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------- across releases

export interface ReleaseCounts {
  dataVersion: number;
  dataDate: string;
  existing: CategoryCounts;
  /** substations present in that release */
  stations: number;
}

/** Per release, how many substations sat in each band: the trend the analytics view draws. */
export function trend(history: HepHistory): ReleaseCounts[] {
  return history.snapshots.map((snapshot, index) => {
    const existing: CategoryCounts = { none: 0, A: 0, B: 0, C: 0, D: 0 };
    let stations = 0;
    for (const series of Object.values(history.stations)) {
      const category = series.existing[index] ?? null;
      if (category === null) continue;
      existing[category] += 1;
      stations += 1;
    }
    return { dataVersion: snapshot.dataVersion, dataDate: snapshot.dataDate, existing, stations };
  });
}

export interface CategoryChange {
  id: string;
  from: Category;
  to: Category;
}

/** What moved between the last two releases, worse first; empty with fewer than two releases. */
export function lastChanges(history: HepHistory): { worse: CategoryChange[]; better: CategoryChange[] } {
  const last = history.snapshots.length - 1;
  const worse: CategoryChange[] = [];
  const better: CategoryChange[] = [];
  if (last < 1) return { worse, better };
  for (const [id, series] of Object.entries(history.stations)) {
    const from = series.existing[last - 1] ?? null;
    const to = series.existing[last] ?? null;
    if (from === null || to === null || from === to) continue;
    (categoryRank(to) < categoryRank(from) ? worse : better).push({ id, from, to });
  }
  const order = (a: CategoryChange, b: CategoryChange): number =>
    Math.abs(categoryRank(b.to) - categoryRank(b.from)) -
      Math.abs(categoryRank(a.to) - categoryRank(a.from)) || a.id.localeCompare(b.id, "hr");
  return { worse: worse.sort(order), better: better.sort(order) };
}

/** URL-safe slug of a substation name: "TS 110/35kV 4TS 117 JERTOVEC" → "ts-110-35kv-4ts-117-jertovec". */
export function stationSlug(id: string): string {
  const latin: Record<string, string> = { č: "c", ć: "c", đ: "dj", š: "s", ž: "z" };
  return id
    .toLowerCase()
    .replace(/[čćđšž]/g, (letter) => latin[letter] ?? letter)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Every substation's page address, unique within a release (a clash gets "-2"); the map links the same pages. */
export function stationSlugs(release: HepRelease): Map<string, string> {
  const slugs = new Map<string, string>();
  const used = new Set<string>();
  for (const station of [...release.stations].sort((a, b) => a.id.localeCompare(b.id))) {
    const base = stationSlug(station.id) || "ts";
    let slug = base;
    for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;
    used.add(slug);
    slugs.set(station.id, slug);
  }
  return slugs;
}

// ---------------------------------------------------------------- HEP substation ↔ OpenStreetMap substation

/** Farther than this, a HEP substation and an OSM substation are not the same place. */
export const MATCH_RADIUS_M = 500;
/** Two candidates closer to each other than this (in distance from the HEP point) are a tie: no match. */
export const MATCH_TIE_M = 100;

const plain = (text: string): string =>
  text
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/Đ/g, "DJ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

/** An OSM substation as the search index has it (data/search.ts, kind "substation"). */
export interface OsmSubstation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  maxVoltageKv: number | null;
}

/**
 * The OSM substation that is the same place as each HV/MV HEP substation (MV/MV ones are not in the search
 * index). Ranked by: the name agrees, the top voltage equals the HEP level, distance; a candidate whose top
 * voltage is below the HEP level never matches. When the two best are equally ranked and within MATCH_TIE_M
 * of each other, there is no match: a wrong link is worse than none (a 110/20 kV HEP substation often stands
 * next to the operator's 400/110 kV one).
 */
export function matchOsm(
  release: HepRelease,
  substations: readonly OsmSubstation[],
): Map<string, OsmSubstation> {
  const matches = new Map<string, OsmSubstation>();
  for (const station of release.stations) {
    if (station.lat === null || station.lon === null || station.levelKv === null || station.levelKv < 110)
      continue;
    const { lat, lon, levelKv } = station;
    const words = plain(station.name)
      .split(" ")
      .filter((word) => word.length >= 3 && !/^\d+$/.test(word));
    const ranked = substations
      .filter((osm) => osm.maxVoltageKv === null || osm.maxVoltageKv >= levelKv)
      .map((osm) => {
        const name = ` ${plain(osm.name)} `;
        return {
          osm,
          named: words.length > 0 && words.every((word) => name.includes(` ${word} `)) ? 0 : 1,
          level: osm.maxVoltageKv === levelKv ? 0 : 1,
          distance: distanceM(lat, lon, osm.lat, osm.lon),
        };
      })
      .filter((candidate) => candidate.distance <= MATCH_RADIUS_M)
      .sort((a, b) => a.named - b.named || a.level - b.level || a.distance - b.distance);
    const [best, second] = ranked;
    if (!best) continue;
    const tie =
      second?.named === best.named &&
      second.level === best.level &&
      second.distance - best.distance < MATCH_TIE_M;
    if (!tie) matches.set(station.id, best.osm);
  }
  return matches;
}
