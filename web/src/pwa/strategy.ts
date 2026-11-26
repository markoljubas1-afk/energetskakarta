/**
 * What the service worker (sw.ts) does with each request (Faza 59). Pure, for tests; the worker only carries
 * it out.
 *
 *   page         a page: the network first, then the copy kept from the last visit, then the map itself
 *   cache-first  the app's own files: their names carry a hash and never change, so a kept copy is the file
 *   data         the map's data: the network first, then the last copy, so an offline map shows the last seen
 *   tiles        a piece of a map tile archive (Faza 59-B): the archives never change (builds/<id>/), so a kept
 *                piece is the piece; kept by address and byte range
 *   bypass       not touched: other pieces, other sites (MapTiler, analytics), anything but reading
 */
export type Strategy = "page" | "cache-first" | "data" | "tiles" | "bypass";

export interface RequestLike {
  url: string;
  method: string;
  mode: RequestMode;
  headers: { has: (name: string) => boolean };
}

export function strategyFor(request: RequestLike, siteOrigin: string, dataBase: string): Strategy {
  if (request.method !== "GET") return "bypass";
  const url = new URL(request.url);
  const data = new URL(dataBase, siteOrigin);
  if (request.headers.has("range")) {
    return url.href.startsWith(data.href) && url.pathname.endsWith(".pmtiles") ? "tiles" : "bypass";
  }
  if (url.origin === siteOrigin) {
    if (request.mode === "navigate") return "page";
    if (url.pathname.startsWith("/assets/")) return "cache-first";
    if (url.href.startsWith(data.href) || url.pathname.endsWith(".json")) return "data";
    return "bypass";
  }
  return url.href.startsWith(data.href) ? "data" : "bypass";
}

/**
 * A copy is kept under its address without the query: a data file's cache-busting `?t=` and a map page's state
 * (`?v=…&sel=…`) must not multiply it.
 */
export function cacheKey(url: string): string {
  const parsed = new URL(url);
  parsed.search = "";
  return parsed.href;
}

/** The map to fall back to when a page was never opened: in the page's language (the path says which). */
export function shellFor(url: string, siteOrigin: string): string {
  const { pathname } = new URL(url);
  return `${siteOrigin}${pathname === "/en" || pathname.startsWith("/en/") ? "/en/" : "/"}`;
}

/** A piece of a tile archive is filed under the archive's address and the piece's byte range. */
export function tileKey(url: string, range: string): string {
  return `${cacheKey(url)}?range=${encodeURIComponent(range)}`;
}

export const KEPT_HEADER = "X-GridAtlas-Kept";

/** The headers a kept piece needs to be served again as the same piece: PMTiles checks the range and the ETag. */
const TILE_HEADERS = ["Content-Range", "ETag", "Content-Type"] as const;

/**
 * A piece from the network made into something a cache can keep (it keeps no 206), or null when the server sent
 * the whole file instead of the piece: that is not a piece, and not worth keeping.
 */
export async function keptTile(response: Response): Promise<Response | null> {
  if (response.status !== 206) return null;
  const headers = new Headers();
  for (const name of TILE_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(await response.arrayBuffer(), { status: 200, headers });
}

/** A kept piece served back as the 206 the map asked for. */
export async function servedTile(kept: Response): Promise<Response> {
  const body = await kept.arrayBuffer();
  const headers = new Headers(kept.headers);
  headers.set("Content-Length", String(body.byteLength));
  // said on every piece served from the cache: the e2e checks the map really reads them (Faza 59-B)
  headers.set(KEPT_HEADER, "1");
  return new Response(body, { status: 206, statusText: "Partial Content", headers });
}
