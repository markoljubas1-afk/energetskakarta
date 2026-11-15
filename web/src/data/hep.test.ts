import { afterEach, describe, expect, it, vi } from "vitest";

import { DataError } from "./current";
import {
  byArea,
  capacityOverlay,
  categoryRank,
  checkedHistory,
  childrenOf,
  countByCategory,
  distanceM,
  lastChanges,
  levelOf,
  loadHep,
  matchOsm,
  stationSlug,
  trend,
  upgradeGains,
  type HepStation,
} from "./hep";
import { HISTORY, RELEASE } from "./hep.fixture";

const station = (id: string): HepStation => {
  const found = RELEASE.stations.find((s) => s.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};

describe("one release", () => {
  it("tells HV/MV from MV/MV substations by their level", () => {
    expect(levelOf(station("TS 110/35kV 4TS 117 JERTOVEC"))).toBe("hv");
    expect(levelOf(station("TS 220/110/35kV PEHLIN"))).toBe("hv");
    expect(levelOf(station("TS 35/20/10kV ILOVAC"))).toBe("mv");
    expect(levelOf({ ...station("TS 35/20/10kV ILOVAC"), levelKv: null })).toBe("unknown");
  });

  it("counts substations per category, for the existing and the upgraded network", () => {
    // version 5: none = JERTOVEC, ILOVAC, CIGLENA, BJELOVAR, RAZROMIR, NOVALJA (6); A SILBA; C POKUPJE; D PEHLIN, TE-TO
    expect(countByCategory(RELEASE.stations, "existing")).toEqual({ none: 6, A: 1, B: 0, C: 1, D: 2 });
    // upgraded: ILOVAC stays B and POKUPJE D, so one "none" fewer
    expect(countByCategory(RELEASE.stations, "upgraded")).toEqual({ none: 5, A: 1, B: 1, C: 0, D: 3 });
  });

  it("summarises the distribution areas, most constrained first and the unnamed ones last", () => {
    const areas = byArea(RELEASE);
    expect(areas.map((area) => [area.name, area.stations, area.existing.none])).toEqual([
      ["Elektra Bjelovar", 1, 1], // 100 %
      ["Elektra Karlovac", 2, 1], // 50 % each, then by name
      ["Elektra Zagreb", 2, 1],
      ["Elektroprimorje Rijeka", 2, 1],
      [null, 3, 2], // CIGLENA, SILBA, NOVALJA have no area
    ]);
    expect(areas[0]?.noneShare).toBe(1);
  });

  it("finds where an upgraded transformer gains the most bands", () => {
    // ILOVAC none → B is two bands, POKUPJE C → D one
    expect(upgradeGains(RELEASE).map((gain) => [gain.station.name, gain.steps])).toEqual([
      ["ILOVAC", 2],
      ["POKUPJE", 1],
    ]);
    expect(categoryRank("none")).toBe(0);
    expect(categoryRank("D")).toBe(4);
  });

  it("links an HV/MV substation to the MV/MV ones it feeds", () => {
    expect(childrenOf(RELEASE, "TS 110/35kV POKUPJE").map((s) => s.name)).toEqual(["ILOVAC"]);
    expect(childrenOf(RELEASE, "TS 110/35 kV BJELOVAR 1").map((s) => s.name)).toEqual(["GTE CIGLENA"]);
    expect(childrenOf(RELEASE, "TS 220/110/35kV PEHLIN")).toEqual([]);
  });

  it("puts only substations with a position on the map", () => {
    const overlay = capacityOverlay(RELEASE);
    // 10 substations, of which CIGLENA, SILBA and NOVALJA have no position
    expect(overlay.features).toHaveLength(7);
    const pokupje = overlay.features.find((f) => f.id === "TS 110/35kV POKUPJE");
    expect(pokupje?.geometry.coordinates).toEqual([15.551805, 45.535741]);
    expect(pokupje?.properties).toMatchObject({ level: "hv", existing: "C", upgraded: "D", rank: 3 });
  });

  it("makes stable URL slugs, Croatian letters included", () => {
    expect(stationSlug("TS 110/35kV 4TS 117 JERTOVEC")).toBe("ts-110-35kv-4ts-117-jertovec");
    expect(stationSlug("TS 110/35kV LOŠINJ")).toBe("ts-110-35kv-losinj");
    expect(stationSlug("TS 110/35/10kV ĐAKOVO 2")).toBe("ts-110-35-10kv-djakovo-2");
    expect(stationSlug("TS 110/35/10kV TROKUT ČAKOVEC (T01)")).toBe("ts-110-35-10kv-trokut-cakovec-t01");
  });
});

describe("across releases", () => {
  it("counts each band per release: the trend", () => {
    expect(trend(HISTORY)).toEqual([
      // version 4: ILOVAC still B, POKUPJE still D
      { dataVersion: 4, dataDate: "2026-10-01", stations: 10, existing: { none: 5, A: 1, B: 1, C: 0, D: 3 } },
      { dataVersion: 5, dataDate: "2026-11-01", stations: 10, existing: { none: 6, A: 1, B: 0, C: 1, D: 2 } },
    ]);
  });

  it("lists what moved between the last two releases, the biggest drop first", () => {
    expect(lastChanges(HISTORY)).toEqual({
      worse: [
        { id: "TS 35/20/10kV ILOVAC", from: "B", to: "none" },
        { id: "TS 110/35kV POKUPJE", from: "D", to: "C" },
      ],
      better: [],
    });
    expect(lastChanges({ ...HISTORY, snapshots: HISTORY.snapshots.slice(0, 1) })).toEqual({
      worse: [],
      better: [],
    });
  });

  it("refuses a history whose series do not line up with its releases", () => {
    expect(checkedHistory(HISTORY)).toBe(HISTORY);
    const broken = {
      ...HISTORY,
      stations: { ...HISTORY.stations, X: { existing: ["A"], upgraded: ["A"], freeKw: [null] } },
    } as typeof HISTORY;
    expect(() => checkedHistory(broken)).toThrow(DataError);
  });
});

describe("loadHep", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const base = new URL("https://podaci.example/");
  const respond = (routes: Record<string, Response>) =>
    vi.fn((url: string) => {
      const match = Object.entries(routes).find(([path]) => url.includes(path));
      return Promise.resolve(match ? match[1] : new Response("", { status: 404 }));
    });

  it("is 'none' before the first release, and works without a history", async () => {
    vi.stubGlobal("fetch", respond({}));
    expect(await loadHep(base, new AbortController().signal)).toEqual({ kind: "none" });
    vi.stubGlobal("fetch", respond({ "hep/current.json": new Response(JSON.stringify(RELEASE)) }));
    const load = await loadHep(base, new AbortController().signal);
    expect(load.kind === "ready" && load.release.dataVersion).toBe(5);
    expect(load.kind === "ready" && load.history).toBeNull();
  });

  it("leaves the history out for the map, so a broken history cannot take the layer down (L-058)", async () => {
    const fetchMock = respond({
      "hep/current.json": new Response(JSON.stringify(RELEASE)),
      "hep/history.json": new Response("", { status: 500 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const load = await loadHep(base, new AbortController().signal, { history: false });
    expect(load.kind === "ready" && load.release.dataVersion).toBe(5);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("history"))).toBe(false);
  });

  it("reports a broken answer instead of showing nothing", async () => {
    vi.stubGlobal("fetch", respond({ "hep/current.json": new Response("", { status: 500 }) }));
    await expect(loadHep(base, new AbortController().signal)).rejects.toThrow("HTTP 500");
  });
});

describe("matchOsm", () => {
  // POKUPJE (110 kV) is at 45.535741, 15.551805; PEHLIN (220 kV) at 45.354785, 14.409512
  const osm = (id: string, name: string, lat: number, lon: number, kv: number | null) => ({
    id,
    name,
    lat,
    lon,
    maxVoltageKv: kv,
  });

  it("pairs a HEP substation with the OSM one at the same place and level", () => {
    const matches = matchOsm(RELEASE, [
      osm("osm:way/1", "TS Pokupje", 45.5359, 15.5521, 110), // ~30 m
      osm("osm:way/2", "TS Pehlin", 45.3551, 14.4099, 220), // ~45 m
      osm("osm:way/3", "TS Daleko", 45.6, 15.7, 110), // kilometres away
    ]);
    expect(matches.get("TS 110/35kV POKUPJE")?.id).toBe("osm:way/1");
    expect(matches.get("TS 220/110/35kV PEHLIN")?.id).toBe("osm:way/2");
    // MV/MV substations are not in the search index and are never matched
    expect(matches.has("TS 35/20/10kV ILOVAC")).toBe(false);
  });

  it("prefers the matching name and level over the nearest, and never a lower voltage", () => {
    const matches = matchOsm(RELEASE, [
      osm("osm:way/10", "TS Pokupje 400", 45.5358, 15.5519, 400), // nearest, but the operator's 400 kV station
      osm("osm:way/11", "TS Pokupje", 45.5368, 15.5531, 110), // ~150 m, name and level agree
      osm("osm:way/12", "TS 35 kV", 45.5357, 15.5518, 35), // lower voltage: never
    ]);
    expect(matches.get("TS 110/35kV POKUPJE")?.id).toBe("osm:way/11");
  });

  it("leaves a HEP substation unmatched when two candidates are equally good", () => {
    const matches = matchOsm(RELEASE, [
      osm("osm:way/20", "TS A", 45.5362, 15.5518, 110),
      osm("osm:way/21", "TS B", 45.5353, 15.5518, 110),
    ]);
    expect(matches.has("TS 110/35kV POKUPJE")).toBe(false);
    expect(distanceM(45.5, 15.5, 45.5, 15.5)).toBe(0);
    // one degree of latitude is about 111 km
    expect(Math.round(distanceM(45, 15, 46, 15) / 1000)).toBe(111);
  });
});
