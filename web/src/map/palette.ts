/** Map colours. One source of truth for the map layers and the legend; tuned for both themes. */
import type { Medium, Substance, Technology, VoltageClass } from "../domain";

export type Theme = "light" | "dark";

export interface Palette {
  voltage: Record<VoltageClass, string>;
  technology: Record<Technology, string>;
  casing: string;
  interconnector: string;
  selection: string;
  /** live cross-border flows */
  flow: string;
  /** gas production discs: the pipeline gas colour, so gas is one colour everywhere */
  gas: string;
  /** offshore pipelines by medium */
  pipeline: Record<Medium, string>;
  /** extraction sites by what they dig; oil and gas match the pipeline media so one colour means one fuel */
  substance: Record<Substance, string>;
  datacenter: string;
  /** opacity of the blurred halo under running data centres */
  datacenterGlow: number;
  /** opacity of the halo under running plants; 0: none (the light theme, like the lines' glow) */
  plantGlow: number;
  charger: string;
  /** cities' consumption: a warm tone, unlike any generation technology */
  city: string;
  cityRing: string;
  labelText: string;
  labelHalo: string;
  /** fallback basemap */
  sea: string;
  land: string;
  landOutside: string;
  border: string;
  outsideMask: string;
  /**
   * Day-ahead price fill of the countries (Faza 18-2): cold below zero, neutral at zero, warm when dear.
   * Stops are EUR/MWh; the fill sits under the grid, so it stays translucent.
   */
  price: { stops: readonly (readonly [number, string])[]; opacity: number };
  /** Soft glow under transmission lines (Faza 18-4): only the muted dark theme glows; 0 switches it off. */
  lineGlow: number;
  /**
   * Under the live flow arcs: in the dark theme a glow in the flow colour; in the light theme a soft shadow,
   * shifted down, that lifts the arc off the map, plus a pale casing that parts it from the grid beneath.
   * `extra` and `casing` are line widths added to the arc's own (px); casing 0 = none.
   */
  flowHalo: { color: string; opacity: number; extra: number; blur: number; offsetY: number; casing: number };
  /** Geothermal potential (Faza 21): heat flow in mW/m², one warm ramp from pale yellow to deep red. */
  heatFlow: { stops: readonly (readonly [number, string])[]; opacity: number };
  /**
   * HEP ODS acceptance categories (Faza 25), one hue from light to strong: an ordinal band of how much a new
   * plant can connect, not a verdict, so no red and green. "none" is a muted ring.
   */
  capacity: Record<"none" | "A" | "B" | "C" | "D", string> & { ring: string; noneRing: string };
  /** Geothermal sites by phase: what runs is solid and strong, what is coming is lighter. */
  geoPhase: Record<"operating" | "project" | "potential_confirmed" | "exploration" | "local_project", string>;
  /**
   * The first-visit intro (Faza 22) is always at night, whatever the theme: a veil darkens the basemap under
   * the data, the region's borders glow, the grid glows at `glow`, cities give off a warm light, and around
   * the globe there is sky.
   */
  intro: {
    night: string;
    veil: number;
    glow: number;
    cityGlow: string;
    sky: string;
    horizon: string;
    /** the region's borders, glowing while the camera comes in */
    region: string;
    /** the countries' names over the night */
    ink: string;
  };
}

/** The same in both themes: the intro is night, and the light theme dawns when it ends. */
const INTRO: Palette["intro"] = {
  night: "#0E151C",
  veil: 0.62,
  glow: 0.9,
  cityGlow: "#FFC680",
  sky: "#0B1622",
  horizon: "#2F6E9E",
  region: "#F2D9A6",
  ink: "#EEF3F7",
};

const light: Palette = {
  voltage: {
    "380+": "#B8403A",
    "220-379": "#2F8A5E",
    "110-219": "#2F6FAE",
    "60-109": "#7E63AE",
    "<60": "#A08FBE",
    unknown: "#7D8791",
  },
  technology: {
    hydro: "#3F78AD",
    pumped_storage: "#2A5A8A",
    solar: "#D09A25",
    wind: "#4E9F94",
    nuclear: "#8466B0",
    gas: "#C06F4D",
    coal: "#5F564E",
    lignite: "#86684B",
    oil: "#9A4F3F",
    biomass: "#6F9A4A",
    geothermal: "#B5574F",
    battery: "#4A8C8C",
    other: "#8A949E",
  },
  casing: "#F3F4F5",
  interconnector: "rgba(31, 111, 139, 0.28)",
  selection: "#1F6F8B",
  flow: "#1F6F8B",
  gas: "#B5652B",
  pipeline: { gas: "#B5652B", oil: "#5B4636", other: "#8A6F9E", unknown: "#8A8F96" },
  datacenter: "#2E3B4E",
  datacenterGlow: 0.3,
  plantGlow: 0,
  charger: "#8E6480",
  substance: {
    oil: "#5B4636",
    gas: "#B5652B",
    oil_gas: "#8A5A2E",
    coal: "#2F2F33",
    lignite: "#6B4F2A",
    peat: "#7A6A3A",
    uranium: "#4C8C3A",
    other: "#8A6F9E",
    unknown: "#8A8F96",
  },
  city: "rgba(214, 120, 48, 0.28)",
  cityRing: "#B8611E",
  labelText: "#1E262E",
  labelHalo: "rgba(243, 244, 245, 0.92)",
  sea: "#CDD8E0",
  land: "#F3F4F5",
  landOutside: "#E2E5E8",
  border: "#8A949E",
  outsideMask: "rgba(220, 223, 226, 0.55)",
  price: {
    stops: [
      [-50, "#3D7FB8"],
      [0, "#E4E7EA"],
      [100, "#D9A35B"],
      [200, "#B5532F"],
    ],
    opacity: 0.42,
  },
  lineGlow: 0,
  flowHalo: { color: "#1E262E", opacity: 0.22, extra: 5, blur: 4, offsetY: 2, casing: 3 },
  heatFlow: {
    stops: [
      [40, "#FFF1B8"],
      [60, "#FDC86A"],
      [80, "#F28B3C"],
      [100, "#D43D22"],
      [120, "#8E1414"],
    ],
    opacity: 0.5,
  },
  // no room is red, room is green and darker the more there is (decision 2026-11-16; "none" used to be grey)
  capacity: {
    none: "#C8493F",
    A: "#CFE8DA",
    B: "#9DD0B5",
    C: "#5BAE88",
    D: "#2A7F5E",
    ring: "#FFFFFF",
    noneRing: "#8E2A22",
  },
  geoPhase: {
    operating: "#B3261E",
    project: "#E07A3F",
    potential_confirmed: "#C7922B",
    exploration: "#8A949E",
    local_project: "#8A949E",
  },
  intro: INTRO,
};

const dark: Palette = {
  voltage: {
    "380+": "#E27A70",
    "220-379": "#62C28F",
    "110-219": "#6AA6DE",
    "60-109": "#AE95D8",
    "<60": "#C6B6E2",
    unknown: "#A3AEB8",
  },
  technology: {
    hydro: "#6E9FCC",
    pumped_storage: "#8FB6E0",
    solar: "#E0B654",
    wind: "#7DC0B6",
    nuclear: "#A792CC",
    gas: "#D69476",
    coal: "#A69A8F",
    lignite: "#BE9A74",
    oil: "#CF7E6C",
    biomass: "#98B878",
    geothermal: "#DB857C",
    battery: "#7CC0C0",
    other: "#A3AEB8",
  },
  casing: "#2A3036",
  interconnector: "rgba(95, 176, 204, 0.3)",
  selection: "#5FB0CC",
  flow: "#5FB0CC",
  gas: "#E09A5F",
  pipeline: { gas: "#E09A5F", oil: "#B89A84", other: "#B8A2CC", unknown: "#9EA5AD" },
  datacenter: "#C3D0E0",
  datacenterGlow: 0.5,
  plantGlow: 0.38,
  charger: "#C9A0BC",
  substance: {
    oil: "#B89A84",
    gas: "#E09A5F",
    oil_gas: "#D2A070",
    coal: "#B9BCC4",
    lignite: "#C8A46E",
    peat: "#C9B77A",
    uranium: "#8FD07A",
    other: "#B8A2CC",
    unknown: "#9EA5AD",
  },
  city: "rgba(240, 160, 90, 0.26)",
  cityRing: "#F0A05A",
  labelText: "#E4E8EC",
  labelHalo: "rgba(42, 48, 54, 0.92)",
  sea: "#26323B",
  land: "#3E464E",
  landOutside: "#353C43",
  border: "#6D7882",
  outsideMask: "rgba(42, 48, 54, 0.55)",
  price: {
    stops: [
      [-50, "#5F9FD6"],
      [0, "#4B545D"],
      [100, "#C08A45"],
      [200, "#E07A55"],
    ],
    opacity: 0.45,
  },
  lineGlow: 0.28,
  flowHalo: { color: "#5FB0CC", opacity: 0.5, extra: 8, blur: 7, offsetY: 0, casing: 0 },
  heatFlow: {
    stops: [
      [40, "#5A4A1E"],
      [60, "#8A5E1E"],
      [80, "#C0662A"],
      [100, "#E2502E"],
      [120, "#FF8A6B"],
    ],
    opacity: 0.55,
  },
  capacity: {
    none: "#D9655B",
    A: "#4B7464",
    B: "#5E9B7F",
    C: "#76C29C",
    D: "#A6E6C3",
    ring: "#1E262E",
    noneRing: "#F2A39B",
  },
  geoPhase: {
    operating: "#FF7A66",
    project: "#F2A36B",
    potential_confirmed: "#E0B65C",
    exploration: "#9AA6B2",
    local_project: "#9AA6B2",
  },
  intro: INTRO,
};

export const PALETTES: Record<Theme, Palette> = { light, dark };
