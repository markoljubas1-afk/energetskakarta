/** Shared vocabulary of the map. Mirrors the pipeline schema (pipeline/src/energymap/schema.py). */

export const SCOPE_COUNTRIES = ["HR", "SI", "HU", "RS", "BA", "ME", "IT", "AT"] as const;
export type CountryCode = (typeof SCOPE_COUNTRIES)[number];

export const STATUSES = ["operating", "construction", "planned"] as const;
export type Status = (typeof STATUSES)[number];

export const TECHNOLOGIES = [
  "hydro",
  "pumped_storage",
  "solar",
  "wind",
  "nuclear",
  "gas",
  "coal",
  "lignite",
  "oil",
  "biomass",
  "geothermal",
  "battery",
  "other",
] as const;
export type Technology = (typeof TECHNOLOGIES)[number];

/** Same classes as pipeline/src/energymap/products.py. "<60" only ever occurs in the distribution layer. */
export const VOLTAGE_CLASSES = ["380+", "220-379", "110-219", "60-109", "<60", "unknown"] as const;
export type VoltageClass = (typeof VOLTAGE_CLASSES)[number];

/**
 * What can be switched on and off on the map. One switch can cover more than one published file:
 * "distribution" draws both distribution layers, which is why downloads are listed separately.
 */
export const LAYER_KEYS = [
  "lines",
  "substations",
  "plants",
  "pipelines",
  "datacenters",
  "cities",
  "distribution",
  "chargers",
  "extraction",
  "gas",
  "geothermal",
  "capacity",
] as const;
/**
 * The map opens on the transmission lines alone (decision 2026-11-16): the grid is the picture, and with
 * substations, plants, pipelines and data centres all on, the first screen was crowded before anyone had
 * asked for anything. Everything else is one tick away, and a search result, a shared link or a page's
 * "open on the map" switches on the layer of what it points at.
 */
export const DEFAULT_LAYER_KEYS = ["lines"] as const;
/** Downloadable files, in the order the download menu lists them (pipeline tiles.py LAYERS). */
export const DOWNLOAD_KEYS = [
  "lines",
  "substations",
  "plants",
  "pipelines",
  "distribution_lines",
  "distribution_substations",
  "datacenters",
  "chargers",
  "cities",
  "extraction",
] as const;
export type DownloadKey = (typeof DOWNLOAD_KEYS)[number];
export const MEDIA = ["gas", "oil", "other", "unknown"] as const;
export type Medium = (typeof MEDIA)[number];
/** What an extraction site takes out of the ground (pipeline schema.Substance), in legend order. */
export const SUBSTANCES = [
  "oil",
  "gas",
  "oil_gas",
  "coal",
  "lignite",
  "peat",
  "uranium",
  "other",
  "unknown",
] as const;
export type Substance = (typeof SUBSTANCES)[number];
/** The kind of site, by its OpenStreetMap tag (pipeline schema.ExtractionKind). */
export const EXTRACTION_KINDS = ["platform", "well", "mine", "shaft", "adit", "quarry"] as const;
export type ExtractionKind = (typeof EXTRACTION_KINDS)[number];
export type LayerKey = (typeof LAYER_KEYS)[number];

export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function voltageClass(maxKv: number | null | undefined): VoltageClass {
  if (maxKv === null || maxKv === undefined) return "unknown";
  if (maxKv >= 380) return "380+";
  if (maxKv >= 220) return "220-379";
  if (maxKv >= 110) return "110-219";
  if (maxKv >= 60) return "60-109";
  return "<60";
}

/** Map asset ids: OpenStreetMap objects, and GEM plants without an OSM counterpart (pipeline conflate.py). */
export const ASSET_ID =
  /^(osm:(node|way|relation)\/\d+|gem:L1\d{11}:(operating|construction|planned)|emodnet:(pipelines|windfarms|windfarmspoly)\/[A-Za-z0-9_.:-]{1,80}|dc:[a-z0-9]+(-[a-z0-9]+)*|com:[A-Za-z0-9_-]{1,40}|gas:[A-Z]{2})$/;

/** Energy consumption sectors of the Covenant of Mayors template (pipeline schema.Sector). */
export const SECTORS = [
  "municipal_buildings",
  "tertiary",
  "residential",
  "public_lighting",
  "industry",
  "municipal_fleet",
  "public_transport",
  "private_transport",
  "transport",
  "other",
] as const;
export type Sector = (typeof SECTORS)[number];

export const DATA_SOURCES = [
  "openstreetmap",
  "gem",
  "transitionzero",
  "emodnet",
  "naturalearth",
  "manual",
  "com",
  "entsog",
] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

/** "osm:way/123" → https://www.openstreetmap.org/way/123 */
export function osmUrl(id: string): string | null {
  const match = /^osm:(node|way|relation)\/(\d+)$/.exec(id);
  return match ? `https://www.openstreetmap.org/${match[1] ?? ""}/${match[2] ?? ""}` : null;
}
