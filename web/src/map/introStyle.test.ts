import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";

import { overlay } from "../data/live";
import { SAMPLE_LIVE } from "../data/live.fixture";
import { defaultState } from "../state/url";
import { composeStyle, fallbackStyle } from "./basemap";
import {
  INTRO_CITY_GLOW_LAYER,
  INTRO_NIGHT_LAYER,
  INTRO_REGION_LAYER,
  INTRO_SETTLE,
  INTRO_TRANSITION_MS,
  introLayers,
  introStyle,
  type IntroStage,
} from "./introStyle";
import { SCOPE_COUNTRIES, type CountryCode } from "../domain";
import {
  BOUNDARY_SOURCE,
  dataLayers,
  dataSources,
  LINE_GLOW_LAYER,
  NOTHING_OPTED_IN,
  PRICE_FILL_LAYER,
} from "./layers";
import { PALETTES } from "./palette";

const palette = PALETTES.dark;
const tiles = {
  grid: "https://podaci.test/grid.pmtiles",
  boundaries: "https://podaci.test/boundaries.pmtiles",
  gridMaxZoom: 14,
  boundariesMaxZoom: 8,
};
const live = overlay(SAMPLE_LIVE, 0);
const state = { ...defaultState("hr"), live: true };
const layers = dataLayers({
  state,
  palette,
  labels: ["Noto Sans Regular"],
  maskOutside: true,
  optIn: NOTHING_OPTED_IN,
  livePrices: live.prices,
});

const at = (stage: IntroStage) => introLayers(layers, stage, palette);
const find = (list: LayerSpecification[], id: string): LayerSpecification => {
  const layer = list.find((l) => l.id === id);
  if (!layer) throw new Error(`no layer ${id}`);
  return layer;
};
const paint = (list: LayerSpecification[], id: string, prop: string): unknown =>
  (find(list, id) as { paint?: Record<string, unknown> }).paint?.[prop];

/** A basemap with one label layer of its own, as MapTiler's have. */
const fallback = fallbackStyle(palette);
const base: StyleSpecification = {
  ...fallback,
  glyphs: "https://fonts.test/{fontstack}/{range}.pbf",
  layers: [
    ...fallback.layers,
    {
      id: "place-country",
      type: "symbol",
      source: BOUNDARY_SOURCE,
      "source-layer": "countries",
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"] },
      paint: { "text-opacity": 0.9 },
    },
  ],
};
const label = Object.fromEntries(SCOPE_COUNTRIES.map((code) => [code, `ime ${code}`])) as Record<
  CountryCode,
  string
>;
const names = { label, fonts: ["Noto Sans Regular"] };

function styleAt(
  stage: IntroStage,
  globe: { from: number; to: number } | null,
  withNames: boolean = false,
): StyleSpecification {
  return introStyle(
    composeStyle(base, dataSources(tiles, { live: live.features }, NOTHING_OPTED_IN), at(stage)),
    {
      stage,
      globe,
      palette,
      names: withNames ? names : null,
    },
  );
}

describe("the grid lighting up during the intro", () => {
  it("starts at night: the basemap veiled, only the region's outline drawn", () => {
    const night = at(0);
    expect(night[0]?.id).toBe(INTRO_NIGHT_LAYER);
    expect(paint(night, INTRO_NIGHT_LAYER, "background-opacity")).toBe(palette.intro.veil);
    expect(paint(night, "energymap-lines", "line-opacity")).toBe(0);
    expect(paint(night, "energymap-plants", "circle-opacity")).toBe(0);
    expect(paint(night, "energymap-plants", "circle-stroke-opacity")).toBe(0);
    expect(paint(night, "energymap-live-arcs", "line-opacity")).toBe(0);
    // shown layers keep their own opacity (1 where none was set)
    expect(paint(night, "energymap-scope-outline", "line-opacity")).toBe(
      paint(layers, "energymap-scope-outline", "line-opacity") ?? 1,
    );
  });

  it("then lines, then each voltage band's glow in turn, cities, and points with the flows", () => {
    expect(paint(at(1), "energymap-lines", "line-opacity")).toBe(1);
    const glow = (stage: IntroStage, band: string) =>
      paint(at(stage), `energymap-intro-glow-${band}`, "line-opacity");
    expect([
      glow(1, "380"),
      glow(2, "380"),
      glow(2, "220"),
      glow(3, "220"),
      glow(3, "110"),
      glow(4, "110"),
    ]).toEqual([0, palette.intro.glow, 0, palette.intro.glow, 0, palette.intro.glow]);
    expect(paint(at(2), INTRO_CITY_GLOW_LAYER, "circle-opacity")).toBe(0);
    expect(paint(at(3), INTRO_CITY_GLOW_LAYER, "circle-opacity")).toBeGreaterThan(0);
    // a point keeps its own opacity once shown
    expect(paint(at(5), "energymap-plants", "circle-opacity")).toBe(
      paint(layers, "energymap-plants", "circle-opacity"),
    );
    expect(paint(at(5), "energymap-live-arcs", "line-opacity")).toBe(
      paint(layers, "energymap-live-arcs", "line-opacity") ?? 1,
    );
  });

  it("settles into the theme: the veil lifts, the intro's glows and the flows fade, the theme's glow returns", () => {
    const settled = at(INTRO_SETTLE);
    expect(paint(settled, INTRO_NIGHT_LAYER, "background-opacity")).toBe(0);
    expect(paint(settled, INTRO_CITY_GLOW_LAYER, "circle-opacity")).toBe(0);
    expect(paint(settled, "energymap-intro-glow-380", "line-opacity")).toBe(0);
    expect(paint(settled, LINE_GLOW_LAYER, "line-opacity")).toBe(palette.lineGlow);
    expect(paint(settled, "energymap-live-arcs", "line-opacity")).toBe(0);
  });

  it("keeps the price fill out of it and leaves the ordinary layers untouched", () => {
    for (const stage of [0, 3, 5, 6] as const)
      expect(paint(at(stage), PRICE_FILL_LAYER, "fill-opacity")).toBe(0);
    const before = JSON.stringify(layers);
    at(3);
    expect(JSON.stringify(layers)).toBe(before);
    // every ordinary layer is still there, in the same order
    const ids = at(4)
      .map((l) => l.id)
      .filter((id) => !id.startsWith("energymap-intro-"));
    expect(ids).toEqual(layers.map((l) => l.id));
  });

  it("adds the globe, the sky and slower fades only while it plays", () => {
    const withGlobe = styleAt(2, { from: 4, to: 4.7 });
    expect(withGlobe.projection?.type).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      4,
      "vertical-perspective",
      4.7,
      "mercator",
    ]);
    expect(withGlobe.sky?.["sky-color"]).toBe(palette.intro.sky);
    expect(withGlobe.transition).toEqual({ duration: INTRO_TRANSITION_MS, delay: 0 });
    expect(styleAt(2, null).projection).toBeUndefined();
  });

  it("shows the region first: its borders glow from the start and calm down once the grid is lit", () => {
    const glow = (stage: IntroStage) => paint(at(stage), INTRO_REGION_LAYER, "line-opacity") as number;
    expect(glow(0)).toBeGreaterThan(0.5);
    expect(glow(3)).toBeLessThan(glow(0));
    expect(glow(3)).toBeGreaterThan(0);
    expect(glow(INTRO_SETTLE)).toBe(0);
    // right under the region's own outline
    const ids = at(0).map((l) => l.id);
    expect(ids.indexOf(INTRO_REGION_LAYER)).toBe(ids.indexOf("energymap-scope-outline") - 1);
  });

  it("names Croatia first, then its neighbours, while the basemap's own labels wait for the night to lift", () => {
    const opacity = (stage: IntroStage, id: string) =>
      paint(styleAt(stage, null, true).layers, id, "text-opacity");
    expect([0, 1, 2, 6].map((stage) => opacity(stage as IntroStage, "energymap-intro-names-home"))).toEqual([
      0, 1, 1, 0,
    ]);
    expect([1, 2, 5, 6].map((stage) => opacity(stage as IntroStage, "energymap-intro-names-region"))).toEqual(
      [0, 1, 1, 0],
    );
    expect(opacity(3, "place-country")).toBe(0);
    expect(opacity(INTRO_SETTLE, "place-country")).toBe(0.9);
    const source = styleAt(1, null, true).sources["energymap-intro-names"] as {
      data: { features: { properties: { name: string; home: boolean } }[] };
    };
    expect(source.data.features).toHaveLength(SCOPE_COUNTRIES.length);
    expect(source.data.features.filter((f) => f.properties.home).map((f) => f.properties.name)).toEqual([
      "ime HR",
    ]);
  });

  it("has no names without the basemap's fonts", () => {
    const style = styleAt(2, null);
    expect(style.sources["energymap-intro-names"]).toBeUndefined();
    expect(style.layers.some((l) => l.id.startsWith("energymap-intro-names"))).toBe(false);
  });
});
