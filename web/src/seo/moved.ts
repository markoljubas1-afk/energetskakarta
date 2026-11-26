/**
 * Pages that moved (provjera spajanja, 2026-11-26): a plant known only from Global Energy Monitor has a page
 * of its own (/objekt/gem-…/); when a later release merges it into the OpenStreetMap plant it is, that page
 * would be a 404. Its address is sent on to the plant's page instead, by a permanent redirect in Cloudflare
 * Pages' `_redirects`, and the redirect is carried from release to release in the SEO manifest for as long
 * as the plant keeps its page.
 */
import type { SeoManifest } from "./prerender";
import type { AssetRecord } from "./records";
import { assetSlug, PATHS } from "./site";

/** A GEM-only record's id is this prefix and its GEM source id (pipeline conflate.py, GEM_ID_PREFIX). */
const GEM_PREFIX = "gem:";

/** Cloudflare Pages reads this many static redirects and ignores the rest. */
export const MAX_REDIRECTS = 2000;

/** Old page path → the page it now lives at. */
export type Moved = Record<string, string>;

/**
 * The redirects of this release: those carried from earlier releases whose target is still published, and
 * one for every published page of a GEM record that this release merged into another record. A page that
 * this release publishes itself is never redirected.
 */
export function movedPages(
  records: ReadonlyMap<string, AssetRecord>,
  published: ReadonlySet<string>,
  previous: SeoManifest | null,
): Moved {
  const moved: Moved = {};
  const add = (from: string, to: string): void => {
    if (from !== to && !published.has(from) && published.has(to)) moved[from] = to;
  };
  for (const [from, to] of Object.entries(previous?.moved ?? {})) add(from, to);
  for (const [id, record] of records) {
    for (const source of record.sources) {
      if (source.source !== "gem" || source.sourceId === undefined) continue;
      const gemId = `${GEM_PREFIX}${source.sourceId}`;
      if (gemId === id) continue;
      for (const lang of ["hr", "en"] as const) {
        const from = PATHS[lang].asset(assetSlug(gemId));
        if (previous?.pages[from] !== undefined) add(from, PATHS[lang].asset(assetSlug(id)));
      }
    }
  }
  return moved;
}

/** Cloudflare Pages' `_redirects`: "from to 301", one a line, sorted so the file only changes with its content. */
export function redirectsFile(moved: Moved): string {
  const lines = Object.entries(moved)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([from, to]) => `${from} ${to} 301\n`);
  if (lines.length > MAX_REDIRECTS) {
    throw new Error(
      `${String(lines.length)} moved pages; Cloudflare Pages reads ${String(MAX_REDIRECTS)} redirects and ` +
        "ignores the rest. Drop the oldest from the SEO manifest or move them to a Bulk Redirect list.",
    );
  }
  return lines.join("");
}
