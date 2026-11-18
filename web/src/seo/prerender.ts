/**
 * Writes the static pages, sitemap, robots.txt and llms.txt into the build output, from the data release
 * the build points at. Crawlers and AI assistants read these; the map stays an application.
 *
 * Runs in Node after `vite build` (see entry.ts and package.json "build"). The data comes from
 * VITE_DATA_BASE_URL when it is absolute (production: the public bucket) and from LOCAL_DATA_DIR when it
 * is the local prefix (development, e2e). A build without reachable data fails, because a site whose
 * pages contradict its map is worse than no build.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { z } from "zod";

import { CityRegisterSchema } from "../data/cities";
import { CurrentSchema, type Current } from "../data/current";
import { DiffSchema } from "../data/diff";
import { EnergyPointerSchema, PeriodsSchema } from "../data/energy";
import { PRICE_MONTHS_KEY, PriceMonthsSchema } from "../data/priceMonths";
import { STORAGE_MONTHS_KEY, StorageMonthsSchema } from "../data/storageMonths";
import { checkedRenewables, RENEWABLES_KEY, RenewablesSchema } from "../data/eurostat";
import { GEOTHERMAL_KEY, GeothermalSchema } from "../data/geothermal";
import { SUPPORT_CONTENT } from "../support";
import { checkedHistory, HEP_KEYS, HepHistorySchema, HepReleaseSchema } from "../data/hep";
import { LiveSchema } from "../data/live";
import { TimelineSchema } from "../data/timeline";
import { SearchIndexSchema, toHit, type SearchIndex } from "../data/search";
import { StatsSchema } from "../data/stats";
import { apiFiles } from "./api";
import { pageWorthy } from "./assetPages";
import { parseRecords, type AssetRecord } from "./records";
import { atomFeed, FEED_PATHS } from "./feed";
import { reportFeedEntries } from "./report";
import { homeHtml } from "./home";
import { llmsFull, markdownPath, pageMarkdown } from "./markdown";
import { renderNotFound, renderPage } from "./html";
import { isValidKey, keyFileName } from "./indexnow";
import { APP_FILE_ALLOWANCE, PAGES_FILE_LIMIT, type SiteData, type StaticPage } from "./site";
import { buildPages } from "./pages";
import { llmsTxt, robotsTxt, sitemapFiles } from "./sitemap";

export interface PrerenderOptions {
  /** public address of the site without a trailing slash, or null: then canonical links and the sitemap are left out */
  siteUrl: string | null;
  dataBaseUrl: string;
  /** directory behind the local data prefix */
  localDataDir: string;
  /** IndexNow key to publish as `<key>.txt`, when one is configured (indexnow.ts) */
  indexNowKey?: string | undefined;
  /** the "Support and partners" page is switched on (Faza 24) */
  support?: boolean;
}

/** "https://example.com/" → "https://example.com"; anything that is not an http(s) URL → null. */
export function normalizeSiteUrl(raw: string | undefined): string | null {
  const text = (raw ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^/\s]+$/.test(text) ? text : null;
}

async function loadJson<T>(options: PrerenderOptions, key: string, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  if (/^https?:/.test(options.dataBaseUrl)) {
    const url = new URL(key, options.dataBaseUrl).toString();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`prerender: ${url} returned HTTP ${response.status}`);
    body = await response.json();
  } else {
    const file = path.resolve(options.localDataDir, key);
    body = JSON.parse(await readFile(file, "utf8"));
  }
  return schema.parse(body);
}

/**
 * A file that a bucket may not have yet (HEP capacity before the first `hep-daily` run): null when it is
 * absent (HTTP 404 or no local file), an error for anything else, so a broken file never ships silently.
 */
async function loadOptionalJson<T>(
  options: PrerenderOptions,
  key: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  if (/^https?:/.test(options.dataBaseUrl)) {
    const url = new URL(key, options.dataBaseUrl).toString();
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`prerender: ${url} returned HTTP ${response.status}`);
    return schema.parse(await response.json());
  }
  const file = path.resolve(options.localDataDir, key);
  try {
    return schema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
}

/** A gzip file of the bucket as text (the NDJSON downloads); null when it is absent. */
export async function loadGzipText(options: PrerenderOptions, key: string): Promise<string | null> {
  let bytes: Uint8Array;
  if (/^https?:/.test(options.dataBaseUrl)) {
    const url = new URL(key, options.dataBaseUrl).toString();
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`prerender: ${url} returned HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    try {
      bytes = await readFile(path.resolve(options.localDataDir, key));
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  }
  // served as application/gzip, so the bytes arrive packed; a server that unpacked them on the way is fine too
  const packed = bytes[0] === 0x1f && bytes[1] === 0x8b;
  return new TextDecoder("utf-8").decode(packed ? gunzipSync(bytes) : bytes);
}

/**
 * The complete records of the assets that get a page (17-11): status, operator, year, voltages, sources and
 * Wikidata, from the plants and substations downloads. Without them the asset pages have only the search
 * index's name, place and one figure (Faza 31: they were never loaded in production).
 */
async function loadRecords(
  options: PrerenderOptions,
  current: Current,
  index: SearchIndex,
): Promise<Map<string, AssetRecord>> {
  const wanted = new Set(
    index.rows
      .map(toHit)
      .filter(pageWorthy)
      .map((hit) => hit.id),
  );
  const records = new Map<string, AssetRecord>();
  if (wanted.size === 0) return records;
  for (const layer of ["plants", "substations"] as const) {
    const text = await loadGzipText(options, current.downloads[layer]);
    if (text === null)
      throw new Error(`prerender: the ${layer} download ${current.downloads[layer]} is missing`);
    for (const [id, record] of parseRecords(text, wanted)) records.set(id, record);
  }
  return records;
}

export async function loadSiteData(options: PrerenderOptions): Promise<SiteData> {
  const current = await loadJson(options, "current.json", CurrentSchema);
  const [
    stats,
    index,
    cities,
    diff,
    timeline,
    capacity,
    capacityHistory,
    energyPointer,
    live,
    geothermal,
    renewables,
    priceMonths,
    storageMonths,
  ] = await Promise.all([
    loadJson(options, current.stats, StatsSchema),
    loadJson(options, current.search, SearchIndexSchema),
    current.cities ? loadJson(options, current.cities, CityRegisterSchema) : Promise.resolve(null),
    current.diff ? loadJson(options, current.diff, DiffSchema) : Promise.resolve(null),
    current.timeline ? loadJson(options, current.timeline, TimelineSchema) : Promise.resolve(null),
    loadOptionalJson(options, HEP_KEYS.current, HepReleaseSchema),
    loadOptionalJson(options, HEP_KEYS.history, HepHistorySchema),
    loadOptionalJson(options, "energy/current.json", EnergyPointerSchema),
    loadOptionalJson(options, "live/current.json", LiveSchema),
    loadOptionalJson(options, GEOTHERMAL_KEY, GeothermalSchema),
    loadOptionalJson(options, RENEWABLES_KEY, RenewablesSchema),
    loadOptionalJson(options, PRICE_MONTHS_KEY, PriceMonthsSchema),
    loadOptionalJson(options, STORAGE_MONTHS_KEY, StorageMonthsSchema),
  ]);
  // the pointer names the file with monthly and yearly totals; once it exists, that file must load
  const energy = energyPointer ? await loadJson(options, energyPointer.periods.key, PeriodsSchema) : null;
  const records = await loadRecords(options, current, index);
  return {
    siteUrl: options.siteUrl,
    dataBaseUrl: options.dataBaseUrl,
    current,
    stats,
    index,
    cities,
    diff,
    capacity,
    capacityHistory: capacityHistory ? checkedHistory(capacityHistory) : null,
    energy,
    live,
    timeline,
    geothermal,
    renewables: renewables ? checkedRenewables(renewables) : null,
    priceMonths,
    storageMonths,
    energyUpdatedAt: energyPointer?.updatedAt ?? null,
    records,
    builtAt: new Date().toISOString(),
    support: options.support ? SUPPORT_CONTENT : null,
  };
}

// ---------------------------------------------------------------- lastmod that means something

/** Published next to the pages: per page, a hash of its content and the day that content last changed. */
export const SEO_MANIFEST = "seo-manifest.json";

export interface SeoManifest {
  version: 1;
  buildId: string;
  pages: Record<string, { hash: string; lastmod: string }>;
}

/** What a page says, without the date of the data release (which changes with every build). */
export function pageHash(page: StaticPage): string {
  const content = JSON.stringify([
    page.title,
    page.description,
    page.heading,
    page.lead,
    page.sections,
    page.breadcrumbs,
  ]);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * A page keeps the lastmod of the previous release while its content is unchanged; a new or changed page
 * gets the day of this release. Search engines stop trusting a lastmod that moves every week for every page.
 */
export function seoManifest(
  pages: StaticPage[],
  previous: SeoManifest | null,
  buildId: string,
  today: string,
): SeoManifest {
  const entries: SeoManifest["pages"] = {};
  for (const page of pages) {
    const hash = pageHash(page);
    const before = previous?.pages[page.path];
    entries[page.path] = { hash, lastmod: before?.hash === hash ? before.lastmod : today };
  }
  return { version: 1, buildId, pages: entries };
}

/** The manifest of the live site, or null (first deploy, unreachable, or not ours): then every page is new. */
export function parseSeoManifest(body: unknown): SeoManifest | null {
  if (typeof body !== "object" || body === null) return null;
  const { version, buildId, pages } = body as Record<string, unknown>;
  if (version !== 1 || typeof buildId !== "string" || typeof pages !== "object" || pages === null)
    return null;
  const valid: SeoManifest["pages"] = {};
  for (const [key, value] of Object.entries(pages as Record<string, unknown>)) {
    const entry = value as Record<string, unknown> | null;
    if (
      typeof entry?.hash === "string" &&
      typeof entry.lastmod === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(entry.lastmod)
    ) {
      valid[key] = { hash: entry.hash, lastmod: entry.lastmod };
    }
  }
  return { version: 1, buildId, pages: valid };
}

export async function loadPreviousManifest(siteUrl: string | null): Promise<SeoManifest | null> {
  if (!siteUrl) return null;
  const url = `${siteUrl}/${SEO_MANIFEST}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[prerender] ${url}: HTTP ${response.status}; every page gets this release's date`);
      return null;
    }
    return parseSeoManifest(await response.json());
  } catch (error) {
    console.warn(`[prerender] ${url} not readable (${String(error)}); every page gets this release's date`);
    return null;
  }
}

export interface StaticOptions {
  /** the built index.html, to fill its SEO markers (home.ts); absent in tests that do not need it */
  template?: string;
  /** the live site's manifest, to keep the lastmod of unchanged pages */
  previous?: SeoManifest | null;
}

/** Everything to write, as output-relative path → content (no leading slash); pure so tests can inspect it. */
export function staticFiles(
  site: SiteData,
  indexNowKey?: string,
  options: StaticOptions = {},
): Map<string, string> {
  const pages = buildPages(site);
  const files = new Map<string, string>();
  const relative = (p: string): string => p.replace(/^\/+/, "");
  for (const page of pages) {
    files.set(relative(path.posix.join(page.path, "index.html")), renderPage(page, site));
    if (page.markdownTwin !== false) files.set(relative(markdownPath(page.path)), pageMarkdown(page, site));
  }
  files.set("llms-full.txt", llmsFull(pages, site));
  if (options.template !== undefined) {
    files.set("index.html", homeHtml(options.template, site, "hr"));
    // the map in English: the same app at /en/ (todo 16-A3)
    files.set("en/index.html", homeHtml(options.template, site, "en"));
  }
  files.set("404.html", renderNotFound(site));
  files.set("robots.txt", robotsTxt(site.siteUrl));
  files.set("llms.txt", llmsTxt(site));
  const manifest = seoManifest(
    pages,
    options.previous ?? null,
    site.current.buildId,
    // a changed page is dated by this build, which runs daily, not by the weekly OSM release (Faza 31)
    (site.builtAt ?? site.current.createdAt).slice(0, 10),
  );
  files.set(SEO_MANIFEST, JSON.stringify(manifest));
  const lastmods = new Map(Object.entries(manifest.pages).map(([key, entry]) => [key, entry.lastmod]));
  if (site.siteUrl) {
    for (const file of sitemapFiles(site.siteUrl, pages, site.current.createdAt, lastmods)) {
      files.set(relative(file.path), file.xml);
    }
  }
  for (const lang of ["hr", "en"] as const) {
    const feed = atomFeed(site, site.diff, lang, reportFeedEntries(site, lang, lastmods));
    if (feed) files.set(relative(FEED_PATHS[lang]), feed);
  }
  for (const [path, body] of apiFiles(site)) files.set(path, body);
  if (isValidKey(indexNowKey)) files.set(keyFileName(indexNowKey), indexNowKey);
  return files;
}

/** Write every file under `outDir`; returns what was written, for the log. */
export async function writeStaticFiles(
  options: PrerenderOptions,
  outDir: string,
): Promise<{ count: number; buildId: string }> {
  const site = await loadSiteData(options);
  const template = await readFile(path.resolve(outDir, "index.html"), "utf8");
  const previous = await loadPreviousManifest(site.siteUrl);
  const files = staticFiles(site, options.indexNowKey, { template, previous });
  // Said here, with numbers, rather than by the upload failing after the tests and the build have run.
  if (files.size + APP_FILE_ALLOWANCE > PAGES_FILE_LIMIT) {
    throw new Error(
      `The site would have ${String(files.size)} static files plus the application's; a Cloudflare Pages ` +
        `deployment takes ${String(PAGES_FILE_LIMIT)}. Raise a page threshold in seo/site.ts or drop a kind of file.`,
    );
  }
  for (const [relative, content] of files) {
    const target = path.resolve(outDir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return { count: files.size, buildId: site.current.buildId };
}
