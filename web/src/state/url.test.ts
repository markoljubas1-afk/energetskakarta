import { describe, expect, it } from "vitest";

import {
  askedSunPoint,
  browserLang,
  canonicalUrl,
  defaultState,
  keepEqualSets,
  langFromPath,
  parseState,
  pathForLang,
  serializeState,
} from "./url";

describe("URL state", () => {
  it("omits defaults so a fresh map has a clean URL", () => {
    expect(serializeState(defaultState("hr"), "hr")).toBe("");
  });

  it("round-trips every field", () => {
    const state = {
      ...defaultState("hr"),
      view: { lat: 45.8123, lng: 15.9789, zoom: 8.25 },
      layers: new Set(["plants"] as const),
      statuses: new Set(["planned", "operating"] as const),
      technologies: new Set(["wind", "hydro"] as const),
      voltages: new Set(["380+"] as const),
      minMw: 100,
      countries: new Set(["SI", "HR"] as const),
      selected: "osm:way/109",
      lang: "en" as const,
      panel: "overview" as const,
    };
    const query = serializeState(state, "hr");
    // canonical order, independent of insertion order
    expect(query).toBe(
      "?v=45.8123%2C15.9789%2C8.25&l=plants&s=operating%2Cplanned&t=hydro%2Cwind&kv=380%2B&c=HR%2CSI" +
        "&mw=100&sel=osm%3Away%2F109&lang=en&panel=overview",
    );
    const parsed = parseState(query, "hr");
    expect(serializeState(parsed, "hr")).toBe(query);
    expect([...parsed.countries].sort()).toEqual(["HR", "SI"]);
  });

  it("keeps an explicitly empty set distinct from the default", () => {
    const state = parseState("?l=", "hr");
    expect(state.layers.size).toBe(0);
    expect(serializeState(state, "hr")).toBe("?l=");
  });

  it.each([
    ["?v=91,15,5", "latitude out of range"],
    ["?v=45,15", "missing zoom"],
    ["?v=abc,15,5", "not a number"],
    ["?v=45,15,40", "zoom out of range"],
  ])("ignores an invalid view (%s: %s)", (query) => {
    expect(parseState(query, "hr").view).toBeNull();
  });

  it("drops unknown values instead of failing", () => {
    const state = parseState("?t=wind,unicorn&c=HR,XX&mw=42&sel=javascript:alert(1)&lang=de&panel=x", "hr");
    expect([...state.technologies]).toEqual(["wind"]);
    expect([...state.countries]).toEqual(["HR"]);
    expect(state.minMw).toBe(0);
    expect(state.selected).toBeNull();
    expect(state.lang).toBe("hr");
    expect(state.panel).toBe("filters");
  });

  it("takes the language from the path: / is Croatian, /en/ English", () => {
    expect(langFromPath("/")).toBe("hr");
    expect(langFromPath("/en/")).toBe("en");
    expect(langFromPath("/en")).toBe("en");
    expect(langFromPath("/english/")).toBe("hr");
    expect(pathForLang("en")).toBe("/en/");
    expect(pathForLang("hr")).toBe("/");
  });

  it("moves the language of old links into the path and keeps the rest", () => {
    expect(canonicalUrl("/", "?lang=en&sel=osm%3Away%2F109")).toBe("/en/?sel=osm%3Away%2F109");
    expect(canonicalUrl("/", "?embed=1&lang=en")).toBe("/en/?embed=1");
    expect(canonicalUrl("/en/", "?lang=hr&c=HR")).toBe("/?c=HR");
    expect(canonicalUrl("/", "?lang=de")).toBe("/"); // unknown language: the path's, without the parameter
    expect(canonicalUrl("/", "?c=HR")).toBeNull();
    expect(canonicalUrl("/en/", "")).toBeNull();
  });

  it("chooses Croatian for regional browser languages", () => {
    expect(browserLang(["hr-HR"])).toBe("hr");
    expect(browserLang(["sl"])).toBe("hr");
    expect(browserLang(["en-US", "hr"])).toBe("en");
    expect(browserLang([])).toBe("hr");
  });
});

describe("the place a link asks the solar layer to read", () => {
  it("reads latitude and longitude, and nothing else", () => {
    expect(askedSunPoint("?l=lines,solar&sun=45.8150,15.9819")).toEqual({ lat: 45.815, lng: 15.9819 });
    expect(askedSunPoint("?l=lines,solar")).toBeNull();
    for (const bad of ["", "45.8", "45.8,15.9,10", "x,15.9", "95,15.9", "45.8,181", "NaN,NaN"]) {
      expect(askedSunPoint(`?sun=${bad}`)).toBeNull();
    }
  });

  it("is a moment, not a view: the address the map writes back does not carry it", () => {
    const state = parseState("?l=lines,solar&sun=45.8150,15.9819", "hr");
    expect(serializeState(state, "hr")).not.toContain("sun");
  });
});

describe("asset ids in links", () => {
  it.each([
    ["osm:node/50", true],
    ["gem:L100000000004:operating", true],
    ["gem:L100000000004:planned", true],
    ["gem:L100000000004", false],
    ["gem:L12345:operating", false],
    ["gem:L100000000004:retired", false],
    ["emodnet:pipelines/101", true],
    ["emodnet:windfarmspoly/12", true],
    ["emodnet:cables/1", false],
    ["emodnet:pipelines/<script>", false],
  ])("%s → %s", (id, valid) => {
    const state = parseState(`?sel=${encodeURIComponent(id)}`, "hr");
    expect(state.selected).toBe(valid ? id : null);
  });
});

describe("energy view state", () => {
  it("round-trips through the URL and omits defaults", () => {
    const state = parseState("", "hr");
    expect(state.page).toBe("map");
    expect(serializeState(state, "hr")).toBe("");
    const custom = {
      ...state,
      page: "energy" as const,
      energy: {
        area: "HR" as const,
        unit: "year" as const,
        tech: "hydro" as const,
        range: { from: "2025-06-01", to: "2025-08-31" },
        show: "table" as const,
        chart: null,
      },
    };
    const query = serializeState(custom, "hr");
    expect(query).toBe("?p=energy&ea=HR&eu=year&et=hydro&er=2025-06-01%2C2025-08-31&es=table");
    expect(parseState(query, "hr")).toEqual(custom);
  });

  it("names the one card an embedded energy page shows (Faza 23-5)", () => {
    const state = parseState("?p=energy&embed=1&ec=compare", "hr");
    expect(state.energy.chart).toBe("compare");
    expect(serializeState(state, "hr")).toBe("?p=energy&embed=1&ec=compare");
    expect(parseState("?p=energy&ec=pie", "hr").energy.chart).toBeNull();
  });

  it("ignores invalid values", () => {
    const state = parseState("?p=admin&ea=XX&eu=week&et=fusion&er=2025-09-01,2025-01-01&es=pdf&ec=pie", "hr");
    expect(state.page).toBe("map");
    expect(state.energy).toEqual(parseState("", "hr").energy);
    expect(parseState("?er=2025-01-01", "hr").energy.range).toBeNull();
    expect(parseState("?er=2025-01-01,2025-02-01,x", "hr").energy.range).toBeNull();
    // a date that does not exist, or a range the totals refuse, never reaches the page (Faza 56, 4.4e)
    expect(parseState("?er=2026-13-01,2026-13-02", "hr").energy.range).toBeNull();
    expect(parseState("?er=2026-02-30,2026-03-02", "hr").energy.range).toBeNull();
    expect(parseState("?er=2020-01-01,2025-01-01", "hr").energy.range).toBeNull();
    expect(parseState("?er=2024-02-29,2024-03-01", "hr").energy.range).toEqual({
      from: "2024-02-29",
      to: "2024-03-01",
    });
  });
});

describe("live layer state", () => {
  it("keeps the hour only while the layer is on", () => {
    const on = parseState("?live=1&lt=2026-09-16T13", "hr");
    expect([on.live, on.liveHour]).toEqual([true, "2026-09-16T13"]);
    expect(serializeState(on, "hr")).toBe("?live=1&lt=2026-09-16T13");
    expect(serializeState({ ...on, live: false }, "hr")).toBe("");
    expect(parseState("?live=1&lt=13:00", "hr").liveHour).toBeNull();
    // with the offset (encoded "+"), as current links are written
    const offset = parseState("?live=1&lt=2026-10-25T02%2B01", "hr");
    expect(offset.liveHour).toBe("2026-10-25T02+01");
    expect(serializeState(offset, "hr")).toBe("?live=1&lt=2026-10-25T02%2B01");
    expect(parseState("?live=yes", "hr").live).toBe(false);
  });

  it("keeps the time machine's year in the link, and only a sensible one", () => {
    const on = parseState("?y=1970", "hr");
    expect(on.year).toBe(1970);
    expect(serializeState(on, "hr")).toBe("?y=1970");
    expect(defaultState("hr").year).toBeNull();
    for (const bad of ["?y=70", "?y=1700", "?y=2200", "?y=19x0", "?y="])
      expect(parseState(bad, "hr").year).toBeNull();
  });
});

describe("parsed state between addresses (Faza 56, 4.1)", () => {
  it("keeps the previous set objects when only the view changes, so the map style is not rebuilt", () => {
    const before = parseState("?v=45,16,7&l=lines,pipelines&kv=400", "hr");
    const after = keepEqualSets(before, parseState("?v=45.1,16.2,8&l=lines,pipelines&kv=400", "hr"));
    expect(after.view).toEqual({ lat: 45.1, lng: 16.2, zoom: 8 });
    expect(after.layers).toBe(before.layers);
    expect(after.statuses).toBe(before.statuses);
    expect(after.technologies).toBe(before.technologies);
    expect(after.voltages).toBe(before.voltages);
    expect(after.countries).toBe(before.countries);
  });

  it("takes the new set when its contents change", () => {
    const before = parseState("?l=lines", "hr");
    const after = keepEqualSets(before, parseState("?l=lines,pipelines", "hr"));
    expect(after.layers).not.toBe(before.layers);
    expect([...after.layers].sort()).toEqual(["lines", "pipelines"]);
    expect(after.voltages).toBe(before.voltages);
  });
});
