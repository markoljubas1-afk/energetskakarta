/**
 * Deploy step: `node .prerender/notify.js` after the site is live. Reads the sitemap the build wrote and
 * tells IndexNow which pages exist now. Bundled by `vite build --ssr` next to entry.ts.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  describeResponse,
  INDEXNOW_ENDPOINT,
  indexNowPayloads,
  isValidKey,
  sitemapLocations,
} from "./indexnow";
import { normalizeSiteUrl } from "./prerender";

const env = z.object({ VITE_SITE_URL: z.string().optional() }).parse(import.meta.env);
const siteUrl = normalizeSiteUrl(env.VITE_SITE_URL);
const key = process.env.INDEXNOW_KEY?.trim();
const outDir = process.env.PRERENDER_OUT ?? "dist";
const endpoint = process.env.INDEXNOW_ENDPOINT ?? INDEXNOW_ENDPOINT;

if (!siteUrl) {
  console.info("[indexnow] no VITE_SITE_URL: nothing to announce");
  process.exit(0);
}
if (!isValidKey(key)) {
  console.info("[indexnow] no valid INDEXNOW_KEY: skipped (set the variable to announce updates)");
  process.exit(0);
}

/** Every page URL: the sitemap, or, for a sitemap index, the union of its parts (read locally). */
async function pageUrls(base: string): Promise<string[]> {
  const root = await readFile(path.join(outDir, "sitemap.xml"), "utf8");
  const locations = sitemapLocations(root);
  if (!root.includes("<sitemapindex")) return locations;
  const parts = await Promise.all(
    locations.map((loc) => readFile(path.join(outDir, new URL(loc).pathname.replace(/^\/+/, "")), "utf8")),
  );
  return parts.flatMap(sitemapLocations).filter((url) => url.startsWith(base));
}

const urls = await pageUrls(siteUrl);
let failed = false;
for (const payload of indexNowPayloads(siteUrl, key, urls)) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const outcome = describeResponse(response.status);
  console.info(`[indexnow] ${payload.urlList.length} URLs → HTTP ${response.status} (${outcome})`);
  if (outcome !== "accepted") failed = true;
}
process.exit(failed ? 1 : 0);
