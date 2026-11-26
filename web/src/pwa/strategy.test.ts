import { describe, expect, it } from "vitest";

import { dataKey, shellFor, strategyFor, type RequestLike } from "./strategy";

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

  it("leaves alone map tiles read in pieces, other sites, and anything but reading", () => {
    expect(route(request(`${DATA}builds/x/grid.pmtiles`, { range: true }))).toBe("bypass");
    expect(route(request("https://api.maptiler.com/maps/x/style.json"))).toBe("bypass");
    expect(route(request(`${SITE}/api/x.json`, { method: "POST" }))).toBe("bypass");
  });

  it("files a data copy under its address without the query, so ?t=13 and ?t=14 are one copy", () => {
    expect(dataKey(`${DATA}hep/current.json?t=2026112613`)).toBe(`${DATA}hep/current.json`);
  });

  it("falls back to the map in the page's language when a page was never opened", () => {
    expect(shellFor(`${SITE}/en/country/hr/`, SITE)).toBe(`${SITE}/en/`);
    expect(shellFor(`${SITE}/zemlja/hr/`, SITE)).toBe(`${SITE}/`);
  });
});
