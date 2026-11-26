/**
 * What the service worker (sw.ts) does with each request (Faza 59). Pure, for tests; the worker only carries
 * it out.
 *
 *   page         a page: the network first, then the copy kept from the last visit, then the map itself
 *   cache-first  the app's own files: their names carry a hash and never change, so a kept copy is the file
 *   data         the map's data: the network first, then the last copy, so an offline map shows the last seen
 *   bypass       not touched: tiles read in pieces (a 206 cannot be kept), other sites (MapTiler, analytics),
 *                anything but reading
 */
export type Strategy = "page" | "cache-first" | "data" | "bypass";

export interface RequestLike {
  url: string;
  method: string;
  mode: RequestMode;
  headers: { has: (name: string) => boolean };
}

export function strategyFor(request: RequestLike, siteOrigin: string, dataBase: string): Strategy {
  if (request.method !== "GET" || request.headers.has("range")) return "bypass";
  const url = new URL(request.url);
  const data = new URL(dataBase, siteOrigin);
  if (url.origin === siteOrigin) {
    if (request.mode === "navigate") return "page";
    if (url.pathname.startsWith("/assets/")) return "cache-first";
    if (url.href.startsWith(data.href) || url.pathname.endsWith(".json")) return "data";
    return "bypass";
  }
  return url.href.startsWith(data.href) ? "data" : "bypass";
}

/** A data copy is kept under its address without the query: a cache-busting `?t=` must not multiply it. */
export function dataKey(url: string): string {
  const parsed = new URL(url);
  parsed.search = "";
  return parsed.href;
}

/** The map to fall back to when a page was never opened: in the page's language (the path says which). */
export function shellFor(url: string, siteOrigin: string): string {
  const { pathname } = new URL(url);
  return `${siteOrigin}${pathname === "/en" || pathname.startsWith("/en/") ? "/en/" : "/"}`;
}
