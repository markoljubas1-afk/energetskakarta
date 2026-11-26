/**
 * GridAtlas's service worker (Faza 59): the site installs as an app and, without a network, opens the last
 * release it saw with the last data it read. Built as its own entry with a fixed name (/sw.js, vite.config.ts);
 * the rules are in strategy.ts. No exports: the file must run as a classic worker script.
 */
import { dataKey, shellFor, strategyFor } from "./strategy";

/** Only what this worker uses of ServiceWorkerGlobalScope (the WebWorker lib cannot share a program with DOM). */
interface ExtendableEvent extends Event {
  waitUntil: (promise: Promise<unknown>) => void;
}
interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith: (response: Promise<Response>) => void;
}
interface WorkerScope {
  location: Location;
  skipWaiting: () => Promise<void>;
  clients: { claim: () => Promise<void> };
  addEventListener: ((type: "install" | "activate", listener: (event: ExtendableEvent) => void) => void) &
    ((type: "fetch", listener: (event: FetchEvent) => void) => void);
}
const worker = self as unknown as WorkerScope;

// a new release is a new worker (its text changes with the id) and a new cache of the app's files; the data
// cache outlives releases, so the last data seen is still there right after an update
const APP_CACHE = `gridatlas-app-${__BUILD_ID__}`;
const DATA_CACHE = "gridatlas-data";
/** data files kept at most; the oldest go first (each data release has new file names) */
const DATA_LIMIT = 300;

const SITE = worker.location.origin;
// the same address the app reads its data from (config.ts); a local build serves it from the site itself
const configured: unknown = import.meta.env.VITE_DATA_BASE_URL;
const DATA_BASE = typeof configured === "string" && configured !== "" ? configured : "/local-data/";

worker.addEventListener("install", (event) => {
  // the map in both languages, so even a page never opened has the map to fall back to
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(["/", "/en/"]))
      .then(() => worker.skipWaiting()),
  );
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("gridatlas-app-") && name !== APP_CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => worker.clients.claim()),
  );
});

worker.addEventListener("fetch", (event) => {
  const strategy = strategyFor(event.request, SITE, DATA_BASE);
  if (strategy === "bypass") return;
  if (strategy === "page") event.respondWith(page(event.request));
  else if (strategy === "cache-first") event.respondWith(cacheFirst(event.request));
  else event.respondWith(data(event.request));
});

async function page(request: Request): Promise<Response> {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const kept = (await cache.match(request)) ?? (await cache.match(shellFor(request.url, SITE)));
    if (kept) return kept;
    throw error;
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(APP_CACHE);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function data(request: Request): Promise<Response> {
  const cache = await caches.open(DATA_CACHE);
  const key = dataKey(request.url);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(key, response.clone());
      await trim(cache);
    }
    return response;
  } catch (error) {
    const kept = await cache.match(key);
    if (kept) return kept;
    throw error;
  }
}

async function trim(cache: Cache): Promise<void> {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - DATA_LIMIT)).map((key) => cache.delete(key)));
}
