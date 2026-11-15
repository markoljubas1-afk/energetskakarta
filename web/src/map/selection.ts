/** What the details panel shows, read from vector tile properties. */
import type { MapGeoJSONFeature } from "maplibre-gl";

import {
  DATA_SOURCES,
  EXTRACTION_KINDS,
  isOneOf,
  MEDIA,
  SCOPE_COUNTRIES,
  SECTORS,
  STATUSES,
  SUBSTANCES,
  TECHNOLOGIES,
  type CountryCode,
  type DataSource,
  type ExtractionKind,
  type Medium,
  type Sector,
  type Status,
  type Substance,
  type Technology,
} from "../domain";
import { INTERACTIVE_LAYERS } from "./layers";

interface Base {
  id: string;
  status: Status;
  operator: string | null;
  /** Where the record's data comes from; tiles without the property are OpenStreetMap only. */
  sources: DataSource[];
  /** GEM wiki page, when GEM contributed. */
  gemUrl: string | null;
}

/** One sector of a city's inventory: electricity and all carriers, in MWh per year. */
export interface SectorEnergy {
  electricityMwh: number;
  totalMwh: number;
}

/** A city's reported consumption is not an asset: no status, no operator, its own record shape. */
export interface CitySelection {
  kind: "city";
  id: string;
  name: string;
  country: string;
  population: number | null;
  inventoryYear: number;
  baseline: boolean;
  electricityMwh: number;
  totalMwh: number;
  baselineYear: number | null;
  baselineElectricityMwh: number | null;
  sectors: Partial<Record<Sector, SectorEnergy>>;
  sources: DataSource[];
}

/** A country's gas production over the last gas days: no status, no operator, its own record shape. */
export interface GasSelection {
  kind: "gas";
  id: string;
  country: CountryCode;
  /** gas days, ISO dates, oldest first */
  days: string[];
  /** kWh per gas day, null where nothing was reported */
  kwhPerDay: (number | null)[];
  /** the production points behind the figure, as the platform names them */
  points: { label: string; operator: string }[];
  generatedAt: string;
  sources: DataSource[];
}

export type Selection =
  | CitySelection
  | GasSelection
  | (Base & {
      kind: "line" | "cable";
      voltagesKv: number[];
      maxVoltageKv: number | null;
      circuits: number | null;
      isHvdc: boolean;
      isInterconnector: boolean;
      countries: string[];
    })
  | (Base & {
      kind: "substation";
      name: string | null;
      maxVoltageKv: number | null;
      voltagesKv: number[];
      country: string;
    })
  | (Base & {
      kind: "pipeline";
      name: string | null;
      medium: Medium;
      diameterIn: number | null;
      lengthKm: number | null;
      commissioningYear: number | null;
      countries: string[];
    })
  | (Base & {
      kind: "charger";
      name: string | null;
      points: number | null;
      country: string;
    })
  | (Base & {
      kind: "extraction";
      name: string | null;
      extractionKind: ExtractionKind;
      substance: Substance;
      country: string;
    })
  | (Base & {
      kind: "datacenter";
      name: string | null;
      powerMw: number | null;
      commissioningYear: number | null;
      country: string;
      /** the published page a hand-kept record was taken from */
      sourceUrl: string | null;
    })
  | (Base & {
      kind: "plant";
      name: string | null;
      technology: Technology;
      capacityMw: number | null;
      commissioningYear: number | null;
      country: string;
    });

type Props = Record<string, unknown>;

const str = (props: Props, key: string): string | null => {
  const value = props[key];
  return typeof value === "string" && value !== "" ? value : null;
};
const num = (props: Props, key: string): number | null => {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};
const bool = (props: Props, key: string): boolean => props[key] === true;
const voltages = (props: Props): number[] =>
  (str(props, "voltages") ?? "")
    .split(";")
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0);

/** The tile carries sectors as one JSON string ({"public_lighting":{"e":6500,"t":6500}}, tiles.py). */
function parseSectors(raw: string | null): Partial<Record<Sector, SectorEnergy>> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const result: Partial<Record<Sector, SectorEnergy>> = {};
  if (typeof parsed !== "object" || parsed === null) return result;
  for (const [key, value] of Object.entries(parsed)) {
    if (!isOneOf(SECTORS, key) || typeof value !== "object" || value === null) continue;
    const { e, t } = value as { e?: unknown; t?: unknown };
    if (typeof e === "number" && typeof t === "number") result[key] = { electricityMwh: e, totalMwh: t };
  }
  return result;
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function gas(props: Props): GasSelection | null {
  const id = str(props, "id");
  const country = props.country;
  const days = parseJson(str(props, "days"));
  const series = parseJson(str(props, "kwhPerDay"));
  const points = parseJson(str(props, "points"));
  if (!id || !isOneOf(SCOPE_COUNTRIES, country) || !isStringList(days) || !Array.isArray(series)) return null;
  const kwhPerDay = series.map((value: unknown) => (typeof value === "number" ? value : null));
  if (kwhPerDay.length !== days.length) return null;
  const named = Array.isArray(points)
    ? points.flatMap((point: unknown) => {
        if (typeof point !== "object" || point === null) return [];
        const { label, operator } = point as { label?: unknown; operator?: unknown };
        return typeof label === "string" && typeof operator === "string" ? [{ label, operator }] : [];
      })
    : [];
  return {
    kind: "gas",
    id,
    country,
    days,
    kwhPerDay,
    points: named,
    generatedAt: str(props, "generatedAt") ?? "",
    sources: ["entsog"],
  };
}

function city(props: Props): CitySelection | null {
  const id = str(props, "id");
  const name = str(props, "name");
  const inventoryYear = num(props, "inventoryYear");
  const electricityMwh = num(props, "electricityMwh");
  const totalMwh = num(props, "totalMwh");
  if (!id || !name || inventoryYear === null || electricityMwh === null || totalMwh === null) return null;
  return {
    kind: "city",
    id,
    name,
    country: str(props, "country") ?? "",
    population: num(props, "population"),
    inventoryYear,
    baseline: bool(props, "baseline"),
    electricityMwh,
    totalMwh,
    baselineYear: num(props, "baselineYear"),
    baselineElectricityMwh: num(props, "baselineElectricityMwh"),
    sectors: parseSectors(str(props, "sectors")),
    sources: ["com"],
  };
}

/** Build a selection from tile properties. `sourceLayer` is needed for features not from a styled layer. */
export function fromProperties(sourceLayer: string, props: Props): Selection | null {
  if (sourceLayer === "cities") return city(props);
  if (sourceLayer === "gas") return gas(props);
  const id = str(props, "id");
  const status = props.status;
  if (!id || !isOneOf(STATUSES, status)) return null;
  const operator = str(props, "operator");
  const listed = (str(props, "sources") ?? "")
    .split(",")
    .filter((s): s is DataSource => isOneOf(DATA_SOURCES, s));
  const gemUrl = str(props, "gemUrl");
  const common = {
    id,
    status,
    operator,
    sources: listed.length > 0 ? listed : (["openstreetmap"] satisfies DataSource[]),
    gemUrl: gemUrl?.startsWith("https://") ? gemUrl : null,
  };
  if (sourceLayer === "lines" || sourceLayer === "distribution_lines") {
    return {
      ...common,
      kind: props.kind === "cable" ? "cable" : "line",
      voltagesKv: voltages(props),
      maxVoltageKv: num(props, "maxVoltageKv"),
      circuits: num(props, "circuits"),
      isHvdc: bool(props, "isHvdc"),
      isInterconnector: bool(props, "isInterconnector"),
      countries: (str(props, "countries") ?? "").split(",").filter(Boolean),
    };
  }
  if (sourceLayer === "substations" || sourceLayer === "distribution_substations") {
    return {
      ...common,
      kind: "substation",
      name: str(props, "name"),
      maxVoltageKv: num(props, "maxVoltageKv"),
      voltagesKv: voltages(props),
      country: str(props, "country") ?? "",
    };
  }
  if (sourceLayer === "pipelines") {
    const medium = props.medium;
    return {
      ...common,
      kind: "pipeline",
      name: str(props, "name"),
      medium: isOneOf(MEDIA, medium) ? medium : "unknown",
      diameterIn: num(props, "diameterIn"),
      lengthKm: num(props, "lengthKm"),
      commissioningYear: num(props, "commissioningYear"),
      countries: (str(props, "countries") ?? "").split(",").filter(Boolean),
    };
  }
  if (sourceLayer === "chargers") {
    return {
      ...common,
      kind: "charger",
      name: str(props, "name"),
      points: num(props, "points"),
      country: str(props, "country") ?? "",
    };
  }
  if (sourceLayer === "extraction") {
    const kind = props.kind;
    const substance = props.substance;
    return {
      ...common,
      kind: "extraction",
      name: str(props, "name"),
      extractionKind: isOneOf(EXTRACTION_KINDS, kind) ? kind : "well",
      substance: isOneOf(SUBSTANCES, substance) ? substance : "unknown",
      country: str(props, "country") ?? "",
    };
  }
  if (sourceLayer === "datacenters") {
    const sourceUrl = str(props, "sourceUrl");
    return {
      ...common,
      kind: "datacenter",
      name: str(props, "name"),
      powerMw: num(props, "powerMw"),
      commissioningYear: num(props, "commissioningYear"),
      country: str(props, "country") ?? "",
      sourceUrl: sourceUrl?.startsWith("https://") ? sourceUrl : null,
    };
  }
  if (sourceLayer === "plants") {
    const technology = props.technology;
    return {
      ...common,
      kind: "plant",
      name: str(props, "name"),
      technology: isOneOf(TECHNOLOGIES, technology) ? technology : "other",
      capacityMw: num(props, "capacityMw"),
      commissioningYear: num(props, "commissioningYear"),
      country: str(props, "country") ?? "",
    };
  }
  return null;
}

/** From a rendered feature (click): the styled layer tells which data layer it belongs to. */
export function toSelection(feature: MapGeoJSONFeature): Selection | null {
  const layer = INTERACTIVE_LAYERS[feature.layer.id] ?? feature.sourceLayer ?? "";
  return fromProperties(layer, feature.properties);
}
