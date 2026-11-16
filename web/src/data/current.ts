/** The `current.json` pointer published by the pipeline (pipeline/src/energymap/publish.py). */
import { z } from "zod";

const Bounds = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const Archive = z.object({
  url: z.string().min(1),
  minZoom: z.number().int().min(0),
  maxZoom: z.number().int().min(0),
  bounds: Bounds,
});

export const CurrentSchema = z.object({
  buildId: z.string().regex(/^\d{8}T\d{6}Z$/),
  createdAt: z.string(),
  counts: z.object({ lines: z.number(), substations: z.number(), plants: z.number() }),
  attribution: z.string(),
  /** Absent in builds published before multi-source support. */
  attributionSources: z.array(z.string()).optional(),
  license: z.string(),
  /** `distribution` exists only in builds that have a distribution network (pipeline tiles.py). */
  tiles: z.object({
    grid: Archive,
    boundaries: Archive,
    distribution: Archive.optional(),
    chargers: Archive.optional(),
    extraction: Archive.optional(),
  }),
  manifest: z.string(),
  search: z.string(),
  stats: z.string(),
  /** Change report against the previously published build; absent on the first publication. */
  diff: z.string().optional(),
  downloads: z.object({
    lines: z.string(),
    substations: z.string(),
    plants: z.string(),
    /** EMODnet offshore pipelines; absent in builds made before they were added */
    pipelines: z.string().optional(),
    /** the distribution network; absent in builds made before it was added */
    distribution_lines: z.string().optional(),
    distribution_substations: z.string().optional(),
    /** data centres; absent in builds made before they were added */
    datacenters: z.string().optional(),
    chargers: z.string().optional(),
    /** cities' energy consumption; absent in builds made without the Covenant of Mayors release */
    cities: z.string().optional(),
    /** oil and gas wells, platforms and mines; absent in builds made before they were added */
    extraction: z.string().optional(),
  }),
  /** compact city register for the /gradovi/ pages; present with the cities layer */
  cities: z.string().optional(),
  /** capacity in operation by year and retired plants, for the time machine; absent in older builds */
  timeline: z.string().optional(),
  /** plants added up by cell, for "what is on the map" in the overview (data/plantGrid.ts) */
  plantGrid: z.string().optional(),
});

export type Current = z.infer<typeof CurrentSchema>;

export class DataError extends Error {
  override name = "DataError";
}

/** Resolve a bucket-relative key against the data base URL. */
export function assetUrl(base: URL, key: string): string {
  if (key.startsWith("/") || /^[a-z]+:/i.test(key)) {
    throw new DataError(`Unexpected absolute key in data pointer: ${key}`);
  }
  return new URL(key, base).toString();
}

export async function fetchJson<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : {});
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new DataError(`Network error while loading ${url}`, { cause });
  }
  if (!response.ok) throw new DataError(`${url} returned HTTP ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new DataError(`${url} is not valid JSON`, { cause });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new DataError(`${url} has an unexpected shape: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  return parsed.data;
}

export function loadCurrent(base: URL, signal?: AbortSignal): Promise<Current> {
  // current.json is cached for 60 s at the edge; the query string avoids stale browser caches on reload
  return fetchJson(
    `${assetUrl(base, "current.json")}?t=${Math.floor(Date.now() / 60_000)}`,
    CurrentSchema,
    signal,
  );
}
