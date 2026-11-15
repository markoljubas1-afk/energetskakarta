/**
 * Build step: `vite build --ssr src/seo/entry.ts --outDir .prerender && node .prerender/entry.js`.
 * Bundled by Vite so it shares the app's modules (schemas, i18n, copy) without a second toolchain.
 */
import { z } from "zod";

import { supportEnabled } from "../support";
import { normalizeSiteUrl, writeStaticFiles } from "./prerender";

const env = z
  .object({
    VITE_DATA_BASE_URL: z.string().optional(),
    VITE_SITE_URL: z.string().optional(),
    VITE_SUPPORT: z.string().optional(),
  })
  .parse(import.meta.env);
const dataBaseUrl = env.VITE_DATA_BASE_URL ?? "/local-data/";
const siteUrl = normalizeSiteUrl(env.VITE_SITE_URL);
const localDataDir = process.env.LOCAL_DATA_DIR ?? ".data";
const outDir = process.env.PRERENDER_OUT ?? "dist";
const configuredKey = process.env.INDEXNOW_KEY?.trim();
const indexNowKey = configuredKey === "" ? undefined : configuredKey;

if (!siteUrl)
  console.warn("[prerender] VITE_SITE_URL is not set: pages get no canonical link and no sitemap");
const { count, buildId } = await writeStaticFiles(
  { siteUrl, dataBaseUrl, localDataDir, indexNowKey, support: supportEnabled(env.VITE_SUPPORT) },
  outDir,
);
console.info(
  `[prerender] ${count} files from release ${buildId} into ${outDir}${siteUrl ? ` for ${siteUrl}` : ""}`,
);
