import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";

import { capacityOverlay } from "../data/hep";
import { RELEASE } from "../data/hep.fixture";
import { LAYER_KEYS, SCOPE_COUNTRIES, TECHNOLOGIES, type CountryCode } from "../domain";
import { defaultState, parseState, type AppState } from "../state/url";
import { composeStyle, fallbackStyle, labelFonts } from "./basemap";
import { lineFilter, plantFilter } from "./filters";
import {
  dataLayers,
  dataSources,
  FLOW_CASING_LAYER,
  FLOW_HALO_LAYER,
  CAPACITY_LAYER,
  GEOTHERMAL_SITES_LAYER,
  INTERACTIVE_LAYERS,
  LINE_GLOW_LAYER,
  NOTHING_OPTED_IN,
  optedIn,
  PRICE_FILL_LAYER,
  SELECTABLE,
  type OptIn,
  type OptInArchive,
} from "./layers";
import { introLayers, introStyle } from "./introStyle";
import { fromProperties } from "./selection";
import { PALETTES } from "./palette";
import { overlay } from "../data/live";
import { SAMPLE_LIVE } from "../data/live.fixture";
import { retiredFeatures } from "../data/timeline";
import { SAMPLE_TIMELINE } from "../data/timeline.fixture";

const tiles = {
  grid: "https://podaci.test/grid.pmtiles",
  boundaries: "https://podaci.test/boundaries.pmtiles",
  gridMaxZoom: 14,
  boundariesMaxZoom: 8,
  distribution: { url: "https://podaci.test/distribution.pmtiles", minZoom: 10, maxZoom: 14 },
  chargers: { url: "https://podaci.test/chargers.pmtiles", minZoom: 11, maxZoom: 14 },
  extraction: { url: "https://podaci.test/extraction.pmtiles", minZoom: 6, maxZoom: 14 },
};

function style(
  state: AppState,
  theme: "light" | "dark",
  labels: string[] | null,
  mask: boolean,
): StyleSpecification {
  const base = fallbackStyle(PALETTES[theme]);
  const withGlyphs = labels ? { ...base, glyphs: "https://fonts.test/{fontstack}/{range}.pbf" } : base;
  const optIn = optedIn(tiles, state.layers);
  return composeStyle(
    withGlyphs,
    dataSources(tiles, {}, optIn),
    dataLayers({ state, palette: PALETTES[theme], labels, maskOutside: mask, optIn }),
  );
}

const STATES: [string, AppState][] = [
  ["defaults", defaultState("hr")],
  [
    "everything filtered",
    parseState("?l=lines&s=planned&t=wind,solar&kv=380%2B,unknown&mw=500&c=HR,SI&sel=osm:way/1", "hr"),
  ],
  ["nothing selected", parseState("?l=&s=&t=&kv=&c=", "hr")],
  ["live layer on", parseState("?live=1&lt=2026-09-16T13", "hr")],
  ["time machine open", parseState("?y=1975", "hr")],
  ["distribution layer on", parseState("?l=lines,substations,plants,pipelines,distribution", "hr")],
  ["charging stations on", parseState("?l=datacenters,chargers", "hr")],
  ["extraction sites on", parseState("?l=plants,extraction", "hr")],
];

describe("generated map style", () => {
  it.each(
    STATES.flatMap(
      ([name, state]) =>
        [
          [name, state, "light", null, false],
          [name, state, "dark", ["Noto Sans Regular"], true],
        ] as const,
    ),
  )("is valid MapLibre style: %s (%s)", (_, state, theme, labels, mask) => {
    const errors = validateStyleMin(style(state, theme, labels ? [...labels] : null, mask));
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  it("only adds labels when the basemap has glyphs", () => {
    const ids = (s: StyleSpecification) => s.layers.map((layer) => layer.id);
    expect(ids(style(defaultState("hr"), "light", null, false))).not.toContain("energymap-plant-labels");
    const withGlyphs = ids(style(defaultState("hr"), "light", ["Noto Sans Regular"], false));
    expect(withGlyphs).toContain("energymap-plant-labels");
    // a new part of a running plant has a label layer of its own, always drawn under the plant's own label
    const expansion = style(defaultState("hr"), "light", ["Noto Sans Regular"], false).layers.find(
      (layer) => layer.id === "energymap-plant-expansion-labels",
    );
    expect(expansion?.layout).toMatchObject({ "text-allow-overlap": true, "text-offset": [0, 4] });
    expect(JSON.stringify(expansion?.layout)).toContain("planirano proširenje");
    // the gas figure is a label too, so it exists only with glyphs and is hidden while the layer is off
    expect(ids(style(defaultState("hr"), "light", null, false))).not.toContain("energymap-gas-labels");
    expect(withGlyphs).toContain("energymap-gas-labels");
    const gasOn = style(parseState("?l=gas", "hr"), "light", ["Noto Sans Regular"], false).layers;
    expect(gasOn.find((layer) => layer.id === "energymap-gas-labels")?.layout?.visibility).toBe("visible");
  });

  it("hides layers the user switched off instead of removing them", () => {
    const layers = style(parseState("?l=plants", "hr"), "light", null, false).layers;
    const lines = layers.find((layer) => layer.id === "energymap-lines");
    expect(lines?.layout).toMatchObject({ visibility: "none" });
    expect(layers.find((layer) => layer.id === "energymap-plants")?.layout).toMatchObject({
      visibility: "visible",
    });
  });

  it("draws pipelines by medium and filters them by status and country", () => {
    const layers = style(parseState("?l=lines,pipelines&s=operating&c=HR", "hr"), "dark", null, false).layers;
    const pipelines = layers.find((layer) => layer.id === "energymap-pipelines");
    expect(pipelines).toMatchObject({ "source-layer": "pipelines", layout: { visibility: "visible" } });
    expect(JSON.stringify(pipelines)).toContain('["in","HR",["get","countries"]]');
    const planned = layers.find((layer) => layer.id === "energymap-pipelines-planned");
    // no planned status selected: the dashed layer matches nothing
    expect(JSON.stringify(planned)).toContain('["literal",[]]');
    const hidden = style(parseState("?l=lines", "hr"), "light", null, false).layers;
    expect(hidden.find((layer) => layer.id === "energymap-pipelines")?.layout).toMatchObject({
      visibility: "none",
    });
  });

  it("registers every clickable layer that exists in the style", () => {
    // with every layer switched on, so that layers only drawn on demand are covered too
    const everything = parseState(`?l=${LAYER_KEYS.join(",")}`, "hr");
    const ids = new Set(style(everything, "light", null, false).layers.map((layer) => layer.id));
    for (const id of Object.keys(INTERACTIVE_LAYERS)) expect(ids).toContain(id);
  });

  it("promotes the tile id on every vector source and reacts to hover state in every clickable layer", () => {
    const sources = dataSources(tiles, {}, { distribution: true, chargers: true, extraction: true });
    for (const { source: name } of SELECTABLE) {
      const source = sources[name];
      // the gas overlay is GeoJSON: it promotes the same property so hover state works there too
      const promoted = source?.type === "vector" || source?.type === "geojson" ? source.promoteId : undefined;
      expect(promoted, name).toBe("id");
    }
    const everything = parseState(`?l=${LAYER_KEYS.join(",")}`, "hr");
    const layers = style(everything, "light", null, false).layers;
    for (const id of Object.keys(INTERACTIVE_LAYERS)) {
      const layer = layers.find((candidate) => candidate.id === id);
      expect(JSON.stringify(layer?.paint), id).toContain('["feature-state","hover"]');
    }
  });

  it("refuses layer id collisions with the basemap", () => {
    const base = fallbackStyle(PALETTES.light);
    expect(() => composeStyle(base, {}, [base.layers[0] ?? { id: "x", type: "background" }])).toThrow(
      /collision/,
    );
  });
});

describe("filters", () => {
  it("adds no clauses when nothing is filtered", () => {
    expect(plantFilter(defaultState("hr"), true)).toEqual([
      "all",
      ["in", ["get", "status"], ["literal", ["operating"]]],
    ]);
  });

  it("splits operating from planned and construction", () => {
    const state = defaultState("hr");
    expect(lineFilter(state, false)).toEqual([
      "all",
      ["in", ["get", "status"], ["literal", ["construction", "planned"]]],
    ]);
  });

  it("keeps a line when any of its countries is selected", () => {
    const filter = lineFilter(parseState("?c=SI,HR", "hr"), true);
    expect(JSON.stringify(filter)).toContain(
      '["any",["in","HR",["get","countries"]],["in","SI",["get","countries"]]]',
    );
  });

  it("filters plants by minimum capacity, treating unknown capacity as too small", () => {
    expect(JSON.stringify(plantFilter(parseState("?mw=100", "hr"), true))).toContain(
      '[">=",["coalesce",["get","capacityMw"],-1],100]',
    );
  });
});

describe("labelFonts", () => {
  it("reuses a font stack from the basemap", () => {
    const base: StyleSpecification = {
      version: 8,
      glyphs: "https://x/{fontstack}/{range}.pbf",
      sources: {},
      layers: [
        { id: "bg", type: "background" },
        { id: "place", type: "symbol", source: "s", layout: { "text-font": ["Noto Sans Bold"] } },
      ],
    };
    expect(labelFonts(base)).toEqual(["Noto Sans Bold"]);
    expect(labelFonts({ version: 8, sources: {}, layers: base.layers })).toBeNull();
  });
});

describe("spotlight", () => {
  const options = {
    state: defaultState("hr"),
    palette: PALETTES.dark,
    labels: null,
    maskOutside: false,
    optIn: NOTHING_OPTED_IN,
  };
  const paintOf = (layers: ReturnType<typeof dataLayers>, id: string): Record<string, unknown> => {
    const layer = layers.find((candidate) => candidate.id === id);
    return layer && "paint" in layer ? { ...layer.paint } : {};
  };

  it("changes nothing while nothing is lit", () => {
    expect(dataLayers({ ...options, spotlight: null })).toEqual(dataLayers(options));
  });

  it("lights one technology in a valid style: its plants stay, the others and the grid recede", () => {
    const layers = dataLayers({ ...options, spotlight: { kind: "technology", value: "hydro" } });
    const style = composeStyle(fallbackStyle(PALETTES.dark), dataSources(tiles, {}), layers);
    expect(validateStyleMin(style).map((e) => e.message)).toEqual([]);
    expect(paintOf(layers, "energymap-plants")["circle-opacity"]).toEqual([
      "case",
      ["==", ["get", "technology"], "hydro"],
      0.92,
      0.11,
    ]);
    expect(paintOf(layers, "energymap-lines")["line-opacity"]).toBe(0.3);
    // the same marks, in the same order: a spotlight never adds or removes a layer
    expect(layers.map((layer) => layer.id)).toEqual(dataLayers(options).map((layer) => layer.id));
  });

  it("lights one voltage class on lines and substations, and lets the plants step back", () => {
    const layers = dataLayers({ ...options, spotlight: { kind: "voltage", value: "380+" } });
    const style = composeStyle(fallbackStyle(PALETTES.dark), dataSources(tiles, {}), layers);
    expect(validateStyleMin(style).map((e) => e.message)).toEqual([]);
    const lines = paintOf(layers, "energymap-lines")["line-opacity"];
    expect(Array.isArray(lines) && lines[0]).toBe("case");
    const stations = paintOf(layers, "energymap-substations")["circle-opacity"];
    expect(Array.isArray(stations) && stations[0]).toBe("case");
    expect(paintOf(layers, "energymap-plants")["circle-opacity"]).toBe(0.276);
  });
});

describe("time machine and the grid", () => {
  it("lets today's lines and substations step back while it runs, and leaves the plants alone", () => {
    const options = { palette: PALETTES.dark, labels: null, maskOutside: false, optIn: NOTHING_OPTED_IN };
    const paintOf = (layers: ReturnType<typeof dataLayers>, id: string): Record<string, unknown> => {
      const layer = layers.find((candidate) => candidate.id === id);
      return layer && "paint" in layer ? { ...layer.paint } : {};
    };
    const running = dataLayers({ state: parseState("?y=1990&l=lines,substations,plants", "hr"), ...options });
    const resting = dataLayers({ state: parseState("?l=lines,substations,plants", "hr"), ...options });
    expect(paintOf(running, "energymap-lines")["line-opacity"]).toBe(0.16);
    expect(paintOf(running, "energymap-substations")["circle-opacity"]).toBeCloseTo(0.92 * 0.16, 3);
    expect(paintOf(resting, "energymap-lines")["line-opacity"]).toBeUndefined();
    expect(paintOf(running, "energymap-plants")["circle-opacity"]).toEqual(
      paintOf(resting, "energymap-plants")["circle-opacity"],
    );
    // a spotlight is the reader's own question and wins over the time machine
    const lit = dataLayers({
      state: parseState("?y=1990&l=lines,plants", "hr"),
      ...options,
      spotlight: { kind: "technology", value: "hydro" },
    });
    expect(paintOf(lit, "energymap-lines")["line-opacity"]).toBe(0.3);
  });
});

describe("live layer", () => {
  it("is a valid style with real flow features and stays hidden when off", () => {
    const features = overlay(SAMPLE_LIVE, 0).features;
    const on = composeStyle(
      fallbackStyle(PALETTES.light),
      dataSources(tiles, { live: features }),
      dataLayers({
        state: parseState("?live=1", "hr"),
        palette: PALETTES.light,
        labels: null,
        maskOutside: false,
        optIn: NOTHING_OPTED_IN,
      }),
    );
    expect(validateStyleMin(on).map((e) => e.message)).toEqual([]);
    const arcs = on.layers.find((layer) => layer.id === "energymap-live-arcs");
    expect(arcs?.layout?.visibility).toBe("visible");
    const off = dataLayers({
      state: defaultState("hr"),
      palette: PALETTES.light,
      labels: null,
      maskOutside: false,
      optIn: NOTHING_OPTED_IN,
    });
    expect(off.find((layer) => layer.id === "energymap-live-arcs")?.layout?.visibility).toBe("none");
    expect(Object.keys(INTERACTIVE_LAYERS)).not.toContain("energymap-live-arcs");
  });

  it("fills countries by the hour's price only while the layer is on, and leaves the rest unpainted", () => {
    const { features, prices } = overlay(SAMPLE_LIVE, 0);
    const options = { palette: PALETTES.dark, labels: null, maskOutside: false, optIn: NOTHING_OPTED_IN };
    const on = composeStyle(
      fallbackStyle(PALETTES.dark),
      dataSources(tiles, { live: features }),
      dataLayers({ state: parseState("?live=1", "hr"), ...options, livePrices: prices }),
      true,
    );
    expect(validateStyleMin(on).map((e) => e.message)).toEqual([]);
    expect(on.transition).toEqual({ duration: 0, delay: 0 });
    const fill = on.layers.find((layer) => layer.id === PRICE_FILL_LAYER);
    expect(fill?.layout?.visibility).toBe("visible");
    const color = (fill?.paint as { "fill-color"?: unknown } | undefined)?.["fill-color"];
    expect(Array.isArray(color) && color[0] === "match").toBe(true);
    expect((color as unknown[]).at(-1)).toBe("rgba(0, 0, 0, 0)");
    const off = dataLayers({ state: defaultState("hr"), ...options, livePrices: prices });
    expect(off.find((layer) => layer.id === PRICE_FILL_LAYER)?.layout?.visibility).toBe("none");
    const empty = dataLayers({ state: parseState("?live=1", "hr"), ...options, livePrices: {} });
    expect(empty.find((layer) => layer.id === PRICE_FILL_LAYER)?.layout?.visibility).toBe("none");
  });
});

describe("night glow", () => {
  it("halos lines in the dark theme only", () => {
    const options = { labels: null, maskOutside: false, optIn: NOTHING_OPTED_IN };
    const glow = (theme: "light" | "dark") =>
      dataLayers({ state: defaultState("hr"), palette: PALETTES[theme], ...options }).find(
        (layer) => layer.id === LINE_GLOW_LAYER,
      );
    expect(glow("dark")?.layout?.visibility).toBe("visible");
    expect(glow("light")?.layout?.visibility).toBe("none");
    const lines = dataLayers({ state: parseState("?l=plants", "hr"), palette: PALETTES.dark, ...options });
    expect(lines.find((layer) => layer.id === LINE_GLOW_LAYER)?.layout?.visibility).toBe("none");
    expect(Object.keys(INTERACTIVE_LAYERS)).not.toContain(LINE_GLOW_LAYER);
  });
});

describe("live flows stand out in both themes", () => {
  it("glow in the dark theme and float on a shadow with a pale edge in the light theme", () => {
    const { features, prices } = overlay(SAMPLE_LIVE, 0);
    const layersFor = (theme: "light" | "dark") => {
      const style = composeStyle(
        fallbackStyle(PALETTES[theme]),
        dataSources(tiles, { live: features }),
        dataLayers({
          state: parseState("?live=1", "hr"),
          palette: PALETTES[theme],
          labels: null,
          maskOutside: false,
          optIn: NOTHING_OPTED_IN,
          livePrices: prices,
        }),
      );
      expect(validateStyleMin(style).map((e) => e.message)).toEqual([]);
      return style.layers;
    };
    const dark = layersFor("dark");
    const light = layersFor("light");
    const paint = (layers: typeof dark, id: string) =>
      layers.find((layer) => layer.id === id)?.paint as Record<string, unknown> | undefined;
    expect(paint(dark, FLOW_HALO_LAYER)?.["line-color"]).toBe(PALETTES.dark.flow);
    expect(dark.find((layer) => layer.id === FLOW_CASING_LAYER)?.layout?.visibility).toBe("none");
    expect(paint(light, FLOW_HALO_LAYER)?.["line-translate"]).toEqual([0, 2]);
    expect(light.find((layer) => layer.id === FLOW_CASING_LAYER)?.layout?.visibility).toBe("visible");
    // halo and casing sit under the arc
    const order = light.map((layer) => layer.id);
    expect(order.indexOf(FLOW_HALO_LAYER)).toBeLessThan(order.indexOf(FLOW_CASING_LAYER));
    expect(order.indexOf(FLOW_CASING_LAYER)).toBeLessThan(order.indexOf("energymap-live-arcs"));
  });
});

describe("geothermal layer", () => {
  it("draws potential and sites only while the layer is on, in a valid style", () => {
    const options = { palette: PALETTES.light, labels: null, maskOutside: false, optIn: NOTHING_OPTED_IN };
    const features = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: {
            type: "Polygon" as const,
            coordinates: [
              [
                [16, 45.8],
                [16.1, 45.8],
                [16.1, 45.9],
                [16, 45.9],
                [16, 45.8],
              ],
            ],
          },
          properties: { q: 92 },
        },
        {
          type: "Feature" as const,
          id: "velika-1",
          geometry: { type: "Point" as const, coordinates: [16.88, 45.87] },
          properties: { id: "velika-1", status: "operating", kind: "power", mw: 16.5 },
        },
      ],
    };
    const on = composeStyle(
      fallbackStyle(PALETTES.light),
      dataSources(tiles, { geothermal: features }),
      dataLayers({ state: parseState("?l=lines,geothermal", "hr"), ...options }),
    );
    expect(validateStyleMin(on).map((e) => e.message)).toEqual([]);
    const visibility = (layers: typeof on.layers, id: string) =>
      layers.find((l) => l.id === id)?.layout?.visibility;
    expect(visibility(on.layers, "energymap-geothermal-potential")).toBe("visible");
    expect(visibility(on.layers, GEOTHERMAL_SITES_LAYER)).toBe("visible");
    const off = dataLayers({ state: defaultState("hr"), ...options });
    expect(visibility(off, GEOTHERMAL_SITES_LAYER)).toBe("none");
  });
});

describe("HEP ODS capacity layer (Faza 25)", () => {
  it("draws each substation by its category only while the layer is on, in a valid style", () => {
    const options = { palette: PALETTES.dark, labels: null, maskOutside: false, optIn: NOTHING_OPTED_IN };
    const on = composeStyle(
      fallbackStyle(PALETTES.dark),
      dataSources(tiles, { capacity: capacityOverlay(RELEASE) }),
      dataLayers({ state: parseState("?l=lines,capacity", "hr"), ...options }),
    );
    expect(validateStyleMin(on).map((e) => e.message)).toEqual([]);
    const layer = on.layers.find((l) => l.id === CAPACITY_LAYER);
    expect(layer?.layout?.visibility).toBe("visible");
    // one hue from light to strong, never red: the colours are the palette's capacity ramp
    expect(JSON.stringify(layer?.paint)).toContain(PALETTES.dark.capacity.D);
    const off = dataLayers({ state: defaultState("hr"), ...options });
    expect(off.find((l) => l.id === CAPACITY_LAYER)?.layout?.visibility).toBe("none");
  });
});

describe("time machine", () => {
  it("is a valid style with retired plants, drawn only while it is open", () => {
    const scope = { countries: new Set<never>(), technologies: new Set(TECHNOLOGIES) };
    const features = retiredFeatures(SAMPLE_TIMELINE, scope, 1963);
    const options = { palette: PALETTES.light, labels: null, maskOutside: false, optIn: NOTHING_OPTED_IN };
    const on = composeStyle(
      fallbackStyle(PALETTES.light),
      dataSources(tiles, { timeline: features }),
      dataLayers({ state: parseState("?y=1963&l=lines,plants", "hr"), ...options }),
    );
    expect(validateStyleMin(on).map((e) => e.message)).toEqual([]);
    expect(on.layers.find((layer) => layer.id === "energymap-timeline-running")?.layout?.visibility).toBe(
      "visible",
    );
    const off = dataLayers({ state: defaultState("hr"), ...options });
    expect(off.find((layer) => layer.id === "energymap-timeline-closed")?.layout?.visibility).toBe("none");
    expect(Object.keys(INTERACTIVE_LAYERS)).not.toContain("energymap-timeline-running");
  });
});

const only = (archive: OptInArchive): OptIn => ({ ...NOTHING_OPTED_IN, [archive]: true });

describe("distribution layer", () => {
  const options = { palette: PALETTES.light, labels: null, maskOutside: false } as const;
  const on = parseState("?l=distribution", "hr");

  it("is off by default and absent from the style until it is switched on", () => {
    const ids = (state: AppState, showDistribution: boolean): string[] =>
      dataLayers({
        state,
        ...options,
        optIn: showDistribution ? only("distribution") : NOTHING_OPTED_IN,
      }).map((layer) => layer.id);
    expect(defaultState("hr").layers.has("distribution")).toBe(false);
    expect(ids(defaultState("hr"), false)).not.toContain("energymap-distribution-lines");
    expect(ids(on, true)).toContain("energymap-distribution-lines");
    // a link asking for the layer against a build that has no such archive must not break the style
    expect(ids(on, false)).not.toContain("energymap-distribution-lines");
  });

  it("draws underneath the transmission grid it gives context to", () => {
    const ids = dataLayers({ state: on, ...options, optIn: only("distribution") }).map((layer) => layer.id);
    expect(ids.indexOf("energymap-distribution-lines")).toBeLessThan(ids.indexOf("energymap-lines"));
  });

  it("declares its source only while it is drawn, so an unused archive is never requested", () => {
    expect(Object.keys(dataSources(tiles, {}, only("distribution")))).toContain("energymap-distribution");
    expect(Object.keys(dataSources(tiles, {}, NOTHING_OPTED_IN))).not.toContain("energymap-distribution");
    const { grid, boundaries, gridMaxZoom, boundariesMaxZoom } = tiles;
    const older = { grid, boundaries, gridMaxZoom, boundariesMaxZoom };
    expect(Object.keys(dataSources(older, {}, only("distribution")))).not.toContain("energymap-distribution");
    // and the decision itself: on only when the switch is on and the build has the archive
    expect(optedIn(tiles, on.layers)).toEqual(only("distribution"));
    expect(optedIn(older, on.layers)).toEqual(NOTHING_OPTED_IN);
  });

  it("reads its features with the same code as the transmission grid", () => {
    const props = { id: "osm:way/104", status: "operating", kind: "line", voltages: "20", maxVoltageKv: 20 };
    expect(fromProperties("distribution_lines", props)).toMatchObject({ kind: "line", maxVoltageKv: 20 });
    const station = { id: "osm:node/62", status: "operating", country: "HR", maxVoltageKv: 10 };
    expect(fromProperties("distribution_substations", station)).toMatchObject({ kind: "substation" });
    // every clickable layer must name a tile layer that selection.ts understands
    for (const sourceLayer of Object.values(INTERACTIVE_LAYERS)) {
      const props =
        sourceLayer === "cities"
          ? { id: "com:1", name: "Grad", inventoryYear: 2019, electricityMwh: 1, totalMwh: 1 }
          : sourceLayer === "gas"
            ? { id: "gas:HR", country: "HR", days: '["2026-09-18"]', kwhPerDay: "[1]", points: "[]" }
            : { id: "osm:way/1", status: "operating" };
      expect(fromProperties(sourceLayer, props), sourceLayer).not.toBeNull();
    }
  });
});

describe("charging stations", () => {
  const on = parseState("?l=chargers", "hr");
  const options = { palette: PALETTES.light, labels: null, maskOutside: false } as const;

  it("is off by default and loads its archive only while it is drawn", () => {
    expect(defaultState("hr").layers.has("chargers")).toBe(false);
    const ids = (showChargers: boolean): string[] =>
      dataLayers({ state: on, ...options, optIn: showChargers ? only("chargers") : NOTHING_OPTED_IN }).map(
        (layer) => layer.id,
      );
    expect(ids(true)).toContain("energymap-chargers");
    expect(ids(false)).not.toContain("energymap-chargers");
    expect(Object.keys(dataSources(tiles, {}, only("chargers")))).toContain("energymap-chargers");
    expect(Object.keys(dataSources(tiles, {}, NOTHING_OPTED_IN))).not.toContain("energymap-chargers");
  });

  it("reads its features with the shared selection code", () => {
    const props = { id: "osm:node/72", status: "operating", country: "HR", points: 4 };
    expect(fromProperties("chargers", props)).toMatchObject({ kind: "charger", points: 4 });
  });
});

describe("extraction sites", () => {
  const on = parseState("?l=extraction", "hr");
  const options = { palette: PALETTES.light, labels: null, maskOutside: false } as const;

  it("is off by default and loads its archive only while it is drawn", () => {
    expect(defaultState("hr").layers.has("extraction")).toBe(false);
    const ids = (show: boolean): string[] =>
      dataLayers({ state: on, ...options, optIn: show ? only("extraction") : NOTHING_OPTED_IN }).map(
        (layer) => layer.id,
      );
    expect(ids(true)).toContain("energymap-extraction");
    expect(ids(false)).not.toContain("energymap-extraction");
    expect(Object.keys(dataSources(tiles, {}, only("extraction")))).toContain("energymap-extraction");
    expect(Object.keys(dataSources(tiles, {}, NOTHING_OPTED_IN))).not.toContain("energymap-extraction");
    expect(optedIn(tiles, on.layers)).toEqual(only("extraction"));
  });

  it("colours by substance and reads its features with the shared selection code", () => {
    const layer = dataLayers({ state: on, ...options, optIn: only("extraction") }).find(
      (candidate) => candidate.id === "energymap-extraction",
    );
    expect(JSON.stringify(layer?.paint)).toContain('"substance"');
    const props = { id: "osm:node/80", status: "operating", country: "HR", kind: "well", substance: "gas" };
    expect(fromProperties("extraction", props)).toMatchObject({
      kind: "extraction",
      extractionKind: "well",
      substance: "gas",
    });
    // an unknown value from a newer build falls back instead of breaking the panel
    expect(fromProperties("extraction", { ...props, kind: "rig", substance: "helium" })).toMatchObject({
      extractionKind: "well",
      substance: "unknown",
    });
  });
});

describe("the intro's stages (Faza 22)", () => {
  it("are valid styles at every stage, with the globe's projection and the sky", () => {
    const palette = PALETTES.dark;
    const live = overlay(SAMPLE_LIVE, 0);
    const state = { ...defaultState("hr"), live: true };
    const base = { ...fallbackStyle(palette), glyphs: "https://fonts.test/{fontstack}/{range}.pbf" };
    const layers = dataLayers({
      state,
      palette,
      labels: ["Noto Sans Regular"],
      maskOutside: true,
      optIn: NOTHING_OPTED_IN,
      livePrices: live.prices,
    });
    const label = Object.fromEntries(SCOPE_COUNTRIES.map((code) => [code, code])) as Record<
      CountryCode,
      string
    >;
    for (const stage of [0, 1, 2, 3, 4, 5, 6] as const) {
      for (const globe of [{ from: 4, to: 4.7 }, null]) {
        const staged = introStyle(
          composeStyle(
            base,
            dataSources(tiles, { live: live.features }, NOTHING_OPTED_IN),
            introLayers(layers, stage, palette),
          ),
          { stage, globe, palette, names: { label, fonts: ["Noto Sans Regular"] } },
        );
        expect(validateStyleMin(staged).map((e) => e.message)).toEqual([]);
      }
    }
  });
});

describe("charging stations on a wide view", () => {
  const withOverview = { ...tiles, chargerOverview: "https://podaci.test/chargergrid.json" };
  const on = parseState("?l=chargers&c=HR,SI", "hr");
  const options = { palette: PALETTES.dark, maskOutside: false };
  const ids = (layers: { id: string }[]) =>
    layers.map((layer) => layer.id).filter((id) => id.includes("chargers"));

  it("draws the stations added up by cell below the zoom where single stations start", () => {
    const optIn = optedIn(withOverview, on.layers);
    const layers = dataLayers({
      state: on,
      ...options,
      labels: ["Noto Sans Regular"],
      optIn,
      chargerOverviewBelow: 11,
    });
    expect(ids(layers)).toEqual([
      "energymap-chargers-overview",
      "energymap-chargers-overview-count",
      "energymap-chargers",
      "energymap-chargers-selected",
    ]);
    const overview = layers.find((layer) => layer.id === "energymap-chargers-overview");
    const single = layers.find((layer) => layer.id === "energymap-chargers");
    // the same countries and statuses as the stations themselves, and never both at one zoom
    expect(overview?.type === "circle" && overview.filter).toEqual(
      single?.type === "circle" && single.filter,
    );
    expect(overview?.maxzoom).toBe(11);
    const sources = dataSources(withOverview, {}, optIn);
    expect(sources["energymap-chargers-overview"]).toEqual({
      type: "geojson",
      data: "https://podaci.test/chargergrid.json",
    });
    const composed = composeStyle(fallbackStyle(PALETTES.dark), sources, layers);
    expect(validateStyleMin(composed).map((e) => e.message)).toEqual([]);
  });

  it("leaves the numbers out without a font, and asks for nothing while the layer is off", () => {
    const optIn = optedIn(withOverview, on.layers);
    expect(
      ids(dataLayers({ state: on, ...options, labels: null, optIn, chargerOverviewBelow: 11 })),
    ).not.toContain("energymap-chargers-overview-count");
    const off = defaultState("hr");
    const none = optedIn(withOverview, off.layers);
    expect(dataSources(withOverview, {}, none)["energymap-chargers-overview"]).toBeUndefined();
    expect(
      ids(dataLayers({ state: off, ...options, labels: null, optIn: none, chargerOverviewBelow: 11 })),
    ).toEqual([]);
  });

  it("is as before for a build that has no overview", () => {
    const optIn = optedIn(tiles, on.layers);
    expect(ids(dataLayers({ state: on, ...options, labels: null, optIn }))).toEqual([
      "energymap-chargers",
      "energymap-chargers-selected",
    ]);
    expect(dataSources(tiles, {}, optIn)["energymap-chargers-overview"]).toBeUndefined();
  });
});

describe("the grid next to a selected plant", () => {
  const options = { palette: PALETTES.dark, labels: null, maskOutside: false, optIn: NOTHING_OPTED_IN };
  const around = { substation: "osm:way/10", metres: 334, lines: ["osm:way/20", "osm:way/21"] };
  const ids = (layers: { id: string }[]) =>
    layers.map((layer) => layer.id).filter((id) => id.includes("around"));

  it("lights the substation and its lines, whether or not their layers are switched on", () => {
    const state = parseState("?l=plants&sel=osm:way/1", "hr");
    const layers = dataLayers({ state, ...options, around });
    expect(ids(layers)).toEqual([
      "energymap-around-lines-glow",
      "energymap-around-lines",
      "energymap-around-substation",
    ]);
    const lines = layers.find((layer) => layer.id === "energymap-around-lines");
    expect(lines?.type === "line" && lines.filter).toEqual(["in", ["get", "id"], ["literal", around.lines]]);
    const substation = layers.find((layer) => layer.id === "energymap-around-substation");
    expect(substation?.type === "circle" && substation.filter).toEqual(["==", ["get", "id"], "osm:way/10"]);
    const composed = composeStyle(fallbackStyle(PALETTES.dark), dataSources(tiles, {}), layers);
    expect(validateStyleMin(composed).map((e) => e.message)).toEqual([]);
  });

  it("adds nothing when the plant has no plain answer", () => {
    const state = parseState("?l=plants&sel=osm:way/1", "hr");
    expect(ids(dataLayers({ state, ...options, around: null }))).toEqual([]);
    expect(ids(dataLayers({ state, ...options }))).toEqual([]);
  });
});

describe("the solar potential picture", () => {
  const options = { palette: PALETTES.dark, labels: null, maskOutside: false, optIn: NOTHING_OPTED_IN };
  const picture = {
    url: "https://podaci.test/solar/pvout-0123456789abcdef.png",
    bounds: [6, 35, 24, 50] as [number, number, number, number],
  };

  it("lies under everything else, between its four corners", () => {
    const state = parseState("?l=lines,solar", "hr");
    const layers = dataLayers({ state, ...options, solar: true });
    expect(layers[0]?.id).toBe("energymap-solar");
    const sources = dataSources(tiles, { solar: picture });
    expect(sources["energymap-solar"]).toEqual({
      type: "image",
      url: picture.url,
      coordinates: [
        [6, 50],
        [24, 50],
        [24, 35],
        [6, 35],
      ],
    });
    const composed = composeStyle(fallbackStyle(PALETTES.dark), sources, layers);
    expect(validateStyleMin(composed).map((e) => e.message)).toEqual([]);
  });

  it("is neither a source nor a layer until it is there to draw", () => {
    expect(dataSources(tiles, {})["energymap-solar"]).toBeUndefined();
    const layers = dataLayers({ state: parseState("?l=lines,solar", "hr"), ...options });
    expect(layers.some((layer) => layer.id === "energymap-solar")).toBe(false);
  });
});
