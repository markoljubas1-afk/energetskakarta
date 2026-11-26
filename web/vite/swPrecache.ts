/**
 * The files the service worker keeps when it installs (Faza 59): without them a first visit that goes offline
 * has the page but not its code. Written into /sw.js at build time, in place of PRECACHE_TOKEN: the page's
 * entry and everything it imports, the map's chunk (offline is for the map) and MapLibre's worker, their
 * stylesheets, and the fonts.
 * Other views (production, comparisons) are kept as they are opened.
 */
import type { Plugin } from "vite";

export const PRECACHE_TOKEN = "__GRIDATLAS_PRECACHE__";

/** Only what this file reads of Rollup's output bundle. */
export type BundleItem =
  | {
      type: "chunk";
      fileName: string;
      name: string;
      isEntry: boolean;
      imports: string[];
      facadeModuleId: string | null;
      viteMetadata?: { importedCss: Set<string> };
    }
  | { type: "asset"; fileName: string };

const MAP_MODULE = "/src/map/MapView.tsx";

export function precacheList(bundle: Record<string, BundleItem>): string[] {
  const files = new Set<string>();
  const visit = (fileName: string): void => {
    const item = bundle[fileName];
    if (item?.type !== "chunk" || files.has(fileName)) return;
    files.add(fileName);
    item.viteMetadata?.importedCss.forEach((css) => files.add(css));
    item.imports.forEach(visit);
  };
  for (const item of Object.values(bundle)) {
    if (
      item.type === "chunk" &&
      ((item.isEntry && item.name === "main") ||
        (item.facadeModuleId ?? "").replaceAll("\\", "/").endsWith(MAP_MODULE))
    )
      visit(item.fileName);
    // fonts, and MapLibre's worker: a file of its own that the map starts, without which it draws nothing
    if (
      item.type === "asset" &&
      (item.fileName.endsWith(".woff2") || /-worker-[^/]+\.js$/.test(item.fileName))
    )
      files.add(item.fileName);
  }
  return [...files].map((fileName) => `/${fileName}`);
}

/** A static import at the start of the file or of a statement (`import{t as e}from"./assets/x.js"`). */
export function importsAChunk(code: string): boolean {
  return /(^|[;}\n])\s*import\s*[{*\w"']/.test(code);
}

/** Writes the list into the built /sw.js; a build whose worker lost the token fails rather than ship a worker without it. */
export function swPrecache(): Plugin {
  return {
    name: "gridatlas-sw-precache",
    apply: "build",
    generateBundle(_options, bundle) {
      const worker = bundle["sw.js"];
      if (worker?.type !== "chunk") return;
      if (!worker.code.includes(PRECACHE_TOKEN)) this.error("sw.js has no precache token to fill in");
      // a classic worker script imports nothing: a module shared with the page would have become a chunk
      if (importsAChunk(worker.code)) this.error("sw.js imports a chunk; it must stand alone");
      const list = precacheList(bundle).join(",");
      worker.code = worker.code.replace(PRECACHE_TOKEN, list);
    },
  };
}
