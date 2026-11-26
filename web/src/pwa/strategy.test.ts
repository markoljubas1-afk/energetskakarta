import { describe, expect, it } from "vitest";

import { cacheKey, keptTile, servedTile, shellFor, strategyFor, tileKey, type RequestLike } from "./strategy";

const SITE = "https://gridatlas.eu";
const DATA = "https://podaci.gridatlas.eu/";

function request(
  url: string,
  init: { method?: string; mode?: RequestMode; range?: boolean } = {},
): RequestLike {
  return {
    url,
    method: init.method ?? "GET",
    mode: init.mode ?? "cors",
    headers: { has: (name: string) => init.range === true && name.toLowerCase() === "range" },
  };
}

const route = (r: RequestLike) => strategyFor(r, SITE, DATA);

describe("what the service worker does with a request (Faza 59)", () => {
  it("takes pages from the network first, so a new release is seen at once", () => {
    expect(route(request(`${SITE}/`, { mode: "navigate" }))).toBe("page");
    expect(route(request(`${SITE}/zemlja/hr/`, { mode: "navigate" }))).toBe("page");
  });

  it("keeps the app's own files, whose names change with every release, from the cache", () => {
    expect(route(request(`${SITE}/assets/index-3f9a1c.js`))).toBe("cache-first");
    expect(route(request(`${SITE}/assets/MapView-77aa.css`))).toBe("cache-first");
  });

  it("takes the data from the network first and keeps the last copy for when there is none", () => {
    expect(route(request(`${DATA}current.json`))).toBe("data");
    expect(route(request(`${DATA}builds/20261123T134649Z/stats.json`))).toBe("data");
    expect(route(request(`${SITE}/api/zemlja/hr.json`))).toBe("data");
  });

  it("keeps the map's tiles, read in pieces from files that never change (Faza 59-B)", () => {
    expect(route(request(`${DATA}builds/x/grid.pmtiles`, { range: true }))).toBe("tiles");
  });

  it("leaves alone other pieces, other sites, and anything but reading", () => {
    expect(route(request(`${DATA}live/flows.bin`, { range: true }))).toBe("bypass");
    expect(route(request("https://api.maptiler.com/maps/x/style.json"))).toBe("bypass");
    expect(route(request(`${SITE}/api/x.json`, { method: "POST" }))).toBe("bypass");
  });

  it("files a copy under its address without the query: ?t=13 and ?t=14 are one, and so are two map views", () => {
    expect(cacheKey(`${DATA}hep/current.json?t=2026112613`)).toBe(`${DATA}hep/current.json`);
    expect(cacheKey(`${SITE}/?v=45,16,7&sel=osm:way/1`)).toBe(`${SITE}/`);
  });

  it("falls back to the map in the page's language when a page was never opened", () => {
    expect(shellFor(`${SITE}/en/country/hr/`, SITE)).toBe(`${SITE}/en/`);
    expect(shellFor(`${SITE}/zemlja/hr/`, SITE)).toBe(`${SITE}/`);
  });
});

describe("a map tile piece kept and served again (Faza 59-B)", () => {
  it("is filed under its address and its byte range, since one file holds every piece", () => {
    expect(tileKey(`${DATA}builds/x/grid.pmtiles`, "bytes=0-16383")).toBe(
      `${DATA}builds/x/grid.pmtiles?range=bytes%3D0-16383`,
    );
  });

  it("is kept as a whole answer (a cache keeps no 206) and served back as the same 206", async () => {
    const body = new Uint8Array([1, 2, 3, 4]).buffer;
    const network = new Response(body, {
      status: 206,
      headers: {
        "Content-Range": "bytes 100-103/5000",
        ETag: '"abc"',
        "Content-Type": "application/octet-stream",
      },
    });
    const kept = await keptTile(network);
    if (!kept) throw new Error("a 206 is kept");
    expect(kept.status).toBe(200);
    const served = await servedTile(kept);
    expect(served.status).toBe(206);
    expect(served.headers.get("Content-Range")).toBe("bytes 100-103/5000");
    expect(served.headers.get("ETag")).toBe('"abc"');
    expect(served.headers.get("Content-Length")).toBe("4");
    expect(served.headers.get("X-GridAtlas-Kept")).toBe("1");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("is not kept when the server sent the whole file instead of the piece", async () => {
    expect(await keptTile(new Response(new Uint8Array([1]).buffer, { status: 200 }))).toBeNull();
  });
});
