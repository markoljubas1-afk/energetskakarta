/**
 * GridAtlas's service worker (Faza 59): the site installs as an app and, without a network, opens the last
 * release it saw with the last data it read. Built as its own entry with a fixed name (/sw.js, vite.config.ts);
 * the rules are in strategy.ts. No exports: the file must run as a classic worker script.
 *
 * The caches are not tied to a release. The app's files carry a hash in their names, so a new release's files
 * never collide with an old one's; and a worker that deleted the cache of the release before would delete the
 * files the page it is serving is made of (a newer worker activates while that page is still open).
 */
// a type only: a value shared with the page would become a chunk both import, and /sw.js must import nothing
import type { DataSourceMessage } from "./dataSource";
import { cacheKey, keptTile, servedTile, shellFor, strategyFor, tileKey } from "./strategy";

/** Only what this worker uses of ServiceWorkerGlobalScope (the WebWorker lib cannot share a program with DOM). */
interface ExtendableEvent extends Event {
  waitUntil: (promise: Promise<unknown>) => void;
}
interface FetchEvent extends ExtendableEvent {
  request: Request;
  /** the page that asked; empty for a navigation */
  clientId: string;
  respondWith: (response: Promise<Response>) => void;
}
interface WorkerScope {
  location: Location;
  skipWaiting: () => Promise<void>;
  clients: {
    claim: () => Promise<void>;
    get: (id: string) => Promise<{ postMessage: (message: DataSourceMessage) => void } | undefined>;
  };
  addEventListener: ((type: "install" | "activate", listener: (event: ExtendableEvent) => void) => void) &
    ((type: "fetch", listener: (event: FetchEvent) => void) => void);
}
const worker = self as unknown as WorkerScope;

const PAGES = "gridatlas-pages";
const ASSETS = "gridatlas-assets";
const DATA = "gridatlas-data";
/** pieces of the map's tile archives (Faza 59-B): the map as it was seen */
const TILES = "gridatlas-tiles";
const KEPT = new Set([PAGES, ASSETS, DATA, TILES]);
/** at most this many copies each; the oldest go first (every release and data build brings new names) */
const LIMIT: Record<string, number> = { [PAGES]: 60, [ASSETS]: 250, [DATA]: 300, [TILES]: 2000 };

// filled in at build time (vite/swPrecache.ts): the page's code, the map's code, their styles and the fonts
const PRECACHE = "__GRIDATLAS_PRECACHE__".split(",").filter((path) => path.startsWith("/"));

const SITE = worker.location.origin;
// the same address the app reads its data from (config.ts); a local build serves it from the site itself
const configured: unknown = import.meta.env.VITE_DATA_BASE_URL;
const DATA_BASE = typeof configured === "string" && configured !== "" ? configured : "/local-data/";

worker.addEventListener("install", (event) => {
  // all of it now, so the very first visit already opens offline: the map in both languages, its code and the
  // data index (the rest of the data is kept as the map reads it)
  event.waitUntil(
    Promise.all([
      keep(PAGES, ["/", "/en/"]),
      keep(ASSETS, PRECACHE),
      keep(DATA, [new URL("current.json", new URL(DATA_BASE, SITE)).href]),
    ]).then(() => worker.skipWaiting()),
  );
});

worker.addEventListener("activate", (event) => {
  // only caches of an earlier design of this worker go; the three above outlive releases
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("gridatlas-") && !KEPT.has(name))
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => worker.clients.claim()),
  );
});

worker.addEventListener("fetch", (event) => {
  const strategy = strategyFor(event.request, SITE, DATA_BASE);
  if (strategy === "bypass") return;
  if (strategy === "cache-first") event.respondWith(cacheFirst(event.request));
  else if (strategy === "tiles") event.respondWith(tiles(event.request));
  else event.respondWith(networkFirst(event.request, strategy === "page" ? PAGES : DATA, event.clientId));
});

/** Each file on its own: one that fails (a moment without network) must not leave the others unkept. */
async function keep(name: string, urls: readonly string[]): Promise<void> {
  const cache = await caches.open(name);
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const address = new URL(url, SITE).href;
      const response = await fetch(address, { mode: "cors", credentials: "omit" });
      if (!response.ok) throw new Error(`${address}: HTTP ${String(response.status)}`);
      await cache.put(cacheKey(address), response);
    }),
  );
  results.forEach((result) => {
    if (result.status === "rejected") console.warn("[sw] not kept for offline use", result.reason);
  });
}

async function networkFirst(request: Request, name: string, clientId: string): Promise<Response> {
  const cache = await caches.open(name);
  const key = cacheKey(request.url);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(key, response.clone());
      await trim(cache, name);
    }
    if (name === DATA) tell(clientId, "network");
    return response;
  } catch (error) {
    const kept =
      (await cache.match(key)) ??
      (name === PAGES ? await cache.match(shellFor(request.url, SITE)) : undefined);
    if (!kept) throw error;
    if (name === DATA) tell(clientId, "cache");
    return kept;
  }
}

/**
 * Tells the page where its data came from (dataSource.ts): the browser may call itself online on a network that
 * reaches nothing, and only the worker knows that it served a kept copy.
 */
function tell(clientId: string, source: DataSourceMessage["source"]): void {
  if (!clientId) return;
  void worker.clients.get(clientId).then((client) => {
    client?.postMessage({ type: "gridatlas:data-source", source } satisfies DataSourceMessage);
  });
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(ASSETS);
  const key = cacheKey(request.url);
  const kept = await cache.match(key);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(key, response.clone());
    await trim(cache, ASSETS);
  }
  return response;
}

/**
 * A piece of a tile archive (Faza 59-B). The archives never change (builds/<id>/), so a kept piece is served at
 * once, with a network or without; a new piece is fetched, kept, and passed on.
 */
async function tiles(request: Request): Promise<Response> {
  const cache = await caches.open(TILES);
  const key = tileKey(request.url, request.headers.get("range") ?? "");
  const kept = await cache.match(key);
  if (kept) return servedTile(kept);
  const response = await fetch(request);
  const copy = await keptTile(response.clone());
  if (copy) {
    await cache.put(key, copy);
    await trim(cache, TILES);
  }
  return response;
}

async function trim(cache: Cache, name: string): Promise<void> {
  const keys = await cache.keys();
  const extra = keys.length - (LIMIT[name] ?? 100);
  if (extra > 0) await Promise.all(keys.slice(0, extra).map((key) => cache.delete(key)));
}
