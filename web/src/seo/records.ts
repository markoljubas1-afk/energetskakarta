/**
 * The complete records behind the asset pages (Faza 17-11): the search index has a name, a place and one
 * figure; the NDJSON downloads (pipeline build.py, one GeoJSON feature per line) also have the status,
 * operator, commissioning year, every voltage, the sources with their licences and links to Wikidata and
 * Wikipedia. Only the assets that get a page are kept.
 */
import { isOneOf, STATUSES, type Status } from "../domain";

export interface AssetSource {
  source: string;
  /** the record's id at the source ("way/123", "L100000604070:operating"), when the download has it */
  sourceId?: string;
  license: string;
  url: string | null;
}

export interface AssetRecord {
  status: Status | null;
  operator: string | null;
  commissioningYear: number | null;
  voltagesKv: number[];
  wikidata: string | null;
  wikipedia: string | null;
  sources: AssetSource[];
}

/** More broken lines than this share means the file is not what the pipeline writes: the build stops. */
export const MAX_BROKEN_SHARE = 0.01;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

function sourcesOf(value: unknown): AssetSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const entry = item as Record<string, unknown>;
    const source = text(entry.source);
    const license = text(entry.license);
    const sourceId = text(entry.sourceId);
    if (!source || !license) return [];
    return [{ source, ...(sourceId ? { sourceId } : {}), license, url: text(entry.url) }];
  });
}

/** The records of `wanted` ids from one NDJSON layer; lines for other ids are skipped without parsing. */
export function parseRecords(ndjson: string, wanted: ReadonlySet<string>): Map<string, AssetRecord> {
  const records = new Map<string, AssetRecord>();
  let lines = 0;
  let broken = 0;
  for (const line of ndjson.split("\n")) {
    if (line.trim() === "") continue;
    lines += 1;
    let feature: unknown;
    try {
      feature = JSON.parse(line);
    } catch {
      broken += 1;
      continue;
    }
    const props =
      typeof feature === "object" && feature !== null
        ? (feature as { properties?: unknown }).properties
        : undefined;
    if (typeof props !== "object" || props === null) {
      broken += 1;
      continue;
    }
    const record = props as Record<string, unknown>;
    const id = text(record.id);
    if (!id || !wanted.has(id)) continue;
    const status = text(record.status);
    const year = record.commissioningYear;
    const voltages = Array.isArray(record.voltagesKv)
      ? record.voltagesKv.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      : [];
    records.set(id, {
      status: status && isOneOf(STATUSES, status) ? status : null,
      operator: text(record.operator),
      commissioningYear: typeof year === "number" && Number.isInteger(year) ? year : null,
      voltagesKv: voltages,
      wikidata: text(record.wikidata),
      wikipedia: text(record.wikipedia),
      sources: sourcesOf(record.provenance),
    });
  }
  if (lines > 0 && broken > MAX_BROKEN_SHARE * lines) {
    throw new Error(`prerender: ${broken} of ${lines} NDJSON lines are not features; the download is broken`);
  }
  return records;
}

/** "hr:HE Zakučac" → its address on Wikipedia. */
export function wikipediaUrl(title: string): string | null {
  const match = /^([a-z][a-z-]{1,11}):(.+)$/.exec(title);
  if (!match?.[1] || !match[2]) return null;
  return `https://${match[1]}.wikipedia.org/wiki/${encodeURIComponent(match[2].trim().replaceAll(" ", "_"))}`;
}

export const wikidataUrl = (id: string): string => `https://www.wikidata.org/wiki/${id}`;
