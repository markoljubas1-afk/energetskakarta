/**
 * Photographs of plants (pipeline images/wikimedia.py): copies of Wikimedia Commons images kept in our own
 * bucket, with who made each one and under which licence. The index is its own document, published on its
 * own schedule; a data release without it simply has no photographs.
 */
import { z } from "zod";

import { assetUrl, DataError } from "./current";

const PhotoSchema = z.object({
  key: z.string().regex(/^images\/[a-f0-9]{20}\.(jpg|png|webp)$/),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  author: z.string(),
  license: z.string().min(1),
  licenseUrl: z.url().nullable(),
  page: z.url(),
});

export const ImageIndexSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  source: z.string(),
  width: z.number().int().positive(),
  images: z.record(z.string(), PhotoSchema),
});
export type ImageIndex = z.infer<typeof ImageIndexSchema>;

/** What the details panel shows: the copy's address and the credit the licence asks for. */
export interface Photo {
  url: string;
  width: number;
  height: number;
  author: string;
  license: string;
  licenseUrl: string | null;
  page: string;
}

export type ImagesLoad = { kind: "none" } | { kind: "ready"; index: ImageIndex };

export async function loadImages(base: URL, signal: AbortSignal): Promise<ImagesLoad> {
  // the index changes about once a month; a new address a day keeps a stale copy from lingering
  const url = `${assetUrl(base, "images/index.json")}?t=${Math.floor(Date.now() / 86_400_000)}`;
  const response = await fetch(url, { signal });
  if (response.status === 404) return { kind: "none" };
  if (!response.ok) throw new DataError(`photographs returned HTTP ${response.status}`);
  return { kind: "ready", index: ImageIndexSchema.parse(await response.json()) };
}

/** The photograph of one asset, or null when there is none. */
export function photoOf(index: ImageIndex, base: URL, id: string): Photo | null {
  const record = index.images[id];
  if (!record) return null;
  return {
    url: assetUrl(base, record.key),
    width: record.width,
    height: record.height,
    author: record.author,
    license: record.license,
    licenseUrl: record.licenseUrl,
    page: record.page,
  };
}
