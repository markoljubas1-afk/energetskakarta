/**
 * The geothermal layer (Faza 21, pipeline/src/energymap/geothermal): curated sites with their phase and
 * uses, and heat-flow potential on a 0.1° grid (orientation only). Pure helpers turn it into map features,
 * headline figures and the steps of the heat cascade.
 */
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import { z } from "zod";

import { assetUrl, DataError } from "./current";

export const PHASES = [
  "operating",
  "project",
  "potential_confirmed",
  "exploration",
  "local_project",
] as const;
export type Phase = (typeof PHASES)[number];
export const USES = ["electricity", "heating", "greenhouses", "spa"] as const;
export type Use = (typeof USES)[number];

const SiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  place: z.string(),
  lon: z.number(),
  lat: z.number(),
  kind: z.enum(["power", "heat"]),
  status: z.enum(PHASES),
  uses: z.array(z.enum(USES)).min(1),
  sources: z.array(z.url()).min(1),
  electricMw: z.number().optional(),
  thermalMw: z.number().optional(),
  temperatureC: z.number().optional(),
  noteHr: z.string().optional(),
  noteEn: z.string().optional(),
});
export type GeoSite = z.infer<typeof SiteSchema>;

export const GeothermalSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  sitesReviewed: z.string(),
  sites: z.array(SiteSchema),
  heatFlow: z
    .object({
      source: z.string(),
      url: z.url(),
      license: z.string(),
      cellDeg: z.number().positive(),
      radiusKm: z.number(),
      minPoints: z.number().int(),
      points: z.number().int(),
      cells: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])),
    })
    .nullable(),
});
export type Geothermal = z.infer<typeof GeothermalSchema>;
export type GeothermalLoad = { kind: "none" } | { kind: "ready"; geothermal: Geothermal };

export const GEOTHERMAL_KEY = "geothermal/current.json";

export async function loadGeothermal(base: URL, signal: AbortSignal): Promise<GeothermalLoad> {
  const response = await fetch(assetUrl(base, GEOTHERMAL_KEY), { signal });
  if (response.status === 404) return { kind: "none" };
  if (!response.ok) throw new DataError(`geothermal data returned HTTP ${response.status}`);
  return { kind: "ready", geothermal: GeothermalSchema.parse(await response.json()) };
}

/** Heat-flow cells as squares (property `q`, mW/m²) and sites as points, for one GeoJSON source. */
export function geothermalFeatures(doc: Geothermal): FeatureCollection<Polygon | Point> {
  const features: Feature<Polygon | Point>[] = [];
  const half = (doc.heatFlow?.cellDeg ?? 0) / 2;
  const r = (value: number): number => Math.round(value * 1e5) / 1e5; // no 45.800000000000004 corners
  for (const [x, y, q] of doc.heatFlow?.cells ?? []) {
    const [w, e, s, n] = [r(x - half), r(x + half), r(y - half), r(y + half)];
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [w, s],
            [e, s],
            [e, n],
            [w, n],
            [w, s],
          ],
        ],
      },
      properties: { q },
    });
  }
  for (const site of doc.sites) {
    features.push({
      type: "Feature",
      id: site.id,
      geometry: { type: "Point", coordinates: [site.lon, site.lat] },
      properties: { id: site.id, status: site.status, kind: site.kind, mw: site.electricMw ?? 0 },
    });
  }
  return { type: "FeatureCollection", features };
}

export interface GeoTotals {
  /** electricity in operation, MW */
  operatingMw: number;
  /** electricity planned in projects with a stated capacity, MW */
  plannedMw: number;
  /** sites using geothermal heat today */
  heatSites: number;
  /** cities where exploration confirmed potential for district heating */
  confirmed: number;
  /** cities and towns developing projects of their own, or exploring */
  developing: number;
}

export function totals(doc: Geothermal): GeoTotals {
  const sum = (sites: GeoSite[]): number => sites.reduce((s, site) => s + (site.electricMw ?? 0), 0);
  const power = doc.sites.filter((site) => site.kind === "power");
  return {
    operatingMw: sum(power.filter((site) => site.status === "operating")),
    plannedMw: sum(power.filter((site) => site.status === "project")),
    heatSites: doc.sites.filter((site) => site.kind === "heat" && site.status === "operating").length,
    confirmed: doc.sites.filter((site) => site.status === "potential_confirmed").length,
    developing: doc.sites.filter((site) => site.status === "local_project" || site.status === "exploration")
      .length,
  };
}

/** Uses of hot water from the hottest to the coolest: the cascade a site may run (Lindal's idea). */
export const CASCADE: readonly { use: Use | "well" | "return"; range: string }[] = [
  { use: "well", range: "" },
  { use: "electricity", range: "> 100 °C" },
  { use: "heating", range: "70–90 °C" },
  { use: "greenhouses", range: "40–60 °C" },
  { use: "spa", range: "25–40 °C" },
  { use: "return", range: "" },
];

/** Which cascade steps a site actually uses (the well and the return to the ground always apply). */
export const activeSteps = (site: GeoSite): Set<string> => new Set(["well", "return", ...site.uses]);
