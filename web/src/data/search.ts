/** Client-side name search over `search.json` (pipeline/src/energymap/products.py). */
import { z } from "zod";

import {
  EXTRACTION_KINDS,
  isOneOf,
  SCOPE_COUNTRIES,
  SUBSTANCES,
  TECHNOLOGIES,
  type CountryCode,
  type ExtractionKind,
  type Substance,
  type Technology,
} from "../domain";

const Row = z.tuple([
  z.string(),
  z.string(),
  z.enum(["plants", "substations", "datacenters", "cities", "extraction"]),
  z.string(),
  z.number(),
  z.number(),
  z.string(),
]);

export const SearchIndexSchema = z.object({
  version: z.literal(1),
  fields: z.tuple([
    z.literal("id"),
    z.literal("name"),
    z.literal("layer"),
    z.literal("country"),
    z.literal("lon"),
    z.literal("lat"),
    z.literal("detail"),
  ]),
  rows: z.array(Row),
});
export type SearchIndex = z.infer<typeof SearchIndexSchema>;

export type SearchHit =
  | {
      kind: "plant";
      id: string;
      name: string;
      country: CountryCode | null;
      lon: number;
      lat: number;
      technology: Technology;
      capacityMw: number | null;
    }
  | {
      kind: "substation";
      id: string;
      name: string;
      country: CountryCode | null;
      lon: number;
      lat: number;
      maxVoltageKv: number | null;
    }
  | {
      kind: "datacenter";
      id: string;
      name: string;
      country: CountryCode | null;
      lon: number;
      lat: number;
      powerMw: number | null;
    }
  | {
      kind: "city";
      id: string;
      name: string;
      country: CountryCode | null;
      lon: number;
      lat: number;
      inventoryYear: number;
      electricityMwh: number;
    }
  | {
      kind: "extraction";
      id: string;
      name: string;
      country: CountryCode | null;
      lon: number;
      lat: number;
      extractionKind: ExtractionKind;
      substance: Substance;
    };

/** Lower-case and strip diacritics so "zerjav" finds "Žerjavinec". Đ/đ has no decomposition. */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase().trim();
}

export function toHit(row: SearchIndex["rows"][number]): SearchHit {
  const [id, name, layer, rawCountry, lon, lat, detail] = row;
  const country = isOneOf(SCOPE_COUNTRIES, rawCountry) ? rawCountry : null;
  if (layer === "plants") {
    const [tech = "", capacity = ""] = detail.split("|");
    return {
      kind: "plant",
      id,
      name,
      country,
      lon,
      lat,
      technology: isOneOf(TECHNOLOGIES, tech) ? tech : "other",
      capacityMw: capacity === "" ? null : Number(capacity),
    };
  }
  if (layer === "cities") {
    const [year = "", electricity = ""] = detail.split("|");
    return {
      kind: "city",
      id,
      name,
      country,
      lon,
      lat,
      inventoryYear: Number(year),
      electricityMwh: Number(electricity),
    };
  }
  if (layer === "extraction") {
    const [kind = "", substance = ""] = detail.split("|");
    return {
      kind: "extraction",
      id,
      name,
      country,
      lon,
      lat,
      extractionKind: isOneOf(EXTRACTION_KINDS, kind) ? kind : "well",
      substance: isOneOf(SUBSTANCES, substance) ? substance : "unknown",
    };
  }
  if (layer === "datacenters") {
    return {
      kind: "datacenter",
      id,
      name,
      country,
      lon,
      lat,
      powerMw: detail === "" ? null : Number(detail),
    };
  }
  return {
    kind: "substation",
    id,
    name,
    country,
    lon,
    lat,
    maxVoltageKv: detail === "" ? null : Number(detail),
  };
}

export interface PreparedIndex {
  rows: SearchIndex["rows"];
  keys: string[];
}

export function prepareIndex(index: SearchIndex): PreparedIndex {
  return { rows: index.rows, keys: index.rows.map((row) => normalize(row[1])) };
}

/** Names starting with the query rank first, then names containing it; ties keep index order. */
export function search(index: PreparedIndex, query: string, limit = 8): SearchHit[] {
  const needle = normalize(query);
  if (needle.length < 2) return [];
  const starts: number[] = [];
  const contains: number[] = [];
  index.keys.forEach((key, i) => {
    if (key.startsWith(needle)) starts.push(i);
    else if (key.includes(needle)) contains.push(i);
  });
  return [...starts, ...contains].slice(0, limit).flatMap((i) => {
    const row = index.rows[i];
    return row ? [toHit(row)] : [];
  });
}
