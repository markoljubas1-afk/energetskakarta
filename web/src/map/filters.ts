/** MapLibre filter expressions derived from the app state. Pure and unit-tested. */
import type { ExpressionSpecification } from "maplibre-gl";

import { SCOPE_COUNTRIES, STATUSES, TECHNOLOGIES, VOLTAGE_CLASSES } from "../domain";
import { YEAR_RANGE, type AppState } from "../state/url";

/**
 * The parts of the state the map's style is made of. The view is not one of them, so panning does not
 * rebuild the style (MapView); a filter or layer that needed another field would not compile until it is
 * added here and to MapView's memo.
 */
export type StyleState = Pick<
  AppState,
  | "layers"
  | "statuses"
  | "technologies"
  | "voltages"
  | "minMw"
  | "countries"
  | "year"
  | "lang"
  | "live"
  | "selected"
>;

type Expr = ExpressionSpecification;

/**
 * Voltage class of a feature, computed from `maxVoltageKv` exactly like `voltageClass()` in domain.ts.
 * The two are checked against each other in filters.test.ts, because a map that filters by one rule and
 * colours by another is worse than either.
 */
export const voltageClassExpr: Expr = [
  "case",
  ["!", ["has", "maxVoltageKv"]],
  "unknown",
  [">=", ["get", "maxVoltageKv"], 380],
  "380+",
  [">=", ["get", "maxVoltageKv"], 220],
  "220-379",
  [">=", ["get", "maxVoltageKv"], 110],
  "110-219",
  [">=", ["get", "maxVoltageKv"], 60],
  "60-109",
  "<60",
];

function inList(value: Expr, allowed: ReadonlySet<string>, all: readonly string[]): Expr | null {
  if (allowed.size === all.length) return null; // everything allowed: no clause
  return ["in", value, ["literal", all.filter((item) => allowed.has(item))]];
}

function status(state: StyleState, operating: boolean): Expr[] {
  const allowed = [...state.statuses].filter((s) => (s === "operating") === operating);
  return [["in", ["get", "status"], ["literal", STATUSES.filter((s) => allowed.includes(s))]]];
}

function combine(clauses: (Expr | null)[]): Expr {
  const present = clauses.filter((clause): clause is Expr => clause !== null);
  return present.length === 0 ? ["literal", true] : ["all", ...present];
}

/**
 * Lines touch several countries, stored as "HR,SI". A line is kept if any of its countries is selected.
 * Substring matching is exact here: codes are two capital letters separated by commas, so no two-letter
 * run can span a separator.
 */
function lineCountries(state: StyleState): Expr | null {
  if (state.countries.size === 0) return null;
  return [
    "any",
    ...SCOPE_COUNTRIES.filter((c) => state.countries.has(c)).map(
      (c): Expr => ["in", c, ["get", "countries"]],
    ),
  ];
}

function pointCountry(state: StyleState): Expr | null {
  if (state.countries.size === 0) return null;
  return ["in", ["get", "country"], ["literal", SCOPE_COUNTRIES.filter((c) => state.countries.has(c))]];
}

/**
 * `operating` splits each layer into a solid (operating) and a dashed/hollow (planned) variant,
 * because MapLibre cannot switch dash patterns per feature.
 */
export function lineFilter(state: StyleState, operating: boolean): Expr {
  return combine([
    ...status(state, operating),
    inList(voltageClassExpr, state.voltages, VOLTAGE_CLASSES),
    lineCountries(state),
  ]);
}

/** Offshore pipelines: status and country filters apply; voltage and technology do not. */
export function pipelineFilter(state: StyleState, operating: boolean): Expr {
  return combine([...status(state, operating), lineCountries(state)]);
}

export function substationFilter(state: StyleState, operating: boolean): Expr {
  return combine([
    ...status(state, operating),
    inList(voltageClassExpr, state.voltages, VOLTAGE_CLASSES),
    pointCountry(state),
  ]);
}

export function plantFilter(state: StyleState, operating: boolean): Expr {
  return combine([
    ...status(state, operating),
    inList(["get", "technology"], state.technologies, TECHNOLOGIES),
    state.minMw > 0 ? [">=", ["coalesce", ["get", "capacityMw"], -1], state.minMw] : null,
    pointCountry(state),
    yearClause(state, operating),
  ]);
}

/**
 * Time machine (Faza 18-3): only plants in operation today that started by the chosen year. A plant without
 * a commissioning year cannot be placed in time, so it is hidden (the time bar says how many); plants under
 * construction or planned are hidden too. Retired plants come from the timeline, not from the tiles.
 */
function yearClause(state: StyleState, operating: boolean): Expr | null {
  if (state.year === null) return null;
  if (!operating) return ["literal", false];
  return ["<=", ["coalesce", ["get", "commissioningYear"], YEAR_RANGE[1] + 1], state.year];
}

/**
 * The distribution network is drawn in one layer per geometry, not split into operating and planned:
 * it is a background layer, and nearly every record in it is in operation. The status filter still
 * applies, so unticking a status hides those features here too.
 */
function anyStatus(state: StyleState): Expr {
  return ["in", ["get", "status"], ["literal", STATUSES.filter((s) => state.statuses.has(s))]];
}

export function distributionLineFilter(state: StyleState): Expr {
  return combine([
    anyStatus(state),
    inList(voltageClassExpr, state.voltages, VOLTAGE_CLASSES),
    lineCountries(state),
  ]);
}

export function distributionSubstationFilter(state: StyleState): Expr {
  return combine([
    anyStatus(state),
    inList(voltageClassExpr, state.voltages, VOLTAGE_CLASSES),
    pointCountry(state),
  ]);
}

/** Data centres: status and country apply; voltage and technology have no meaning for them. */
export function dataCenterFilter(state: StyleState, operating: boolean): Expr {
  return combine([...status(state, operating), pointCountry(state)]);
}

/** Cities carry no status: only the country filter applies. */
export function cityFilter(state: StyleState): Expr {
  return combine([pointCountry(state)]);
}

/** Charging stations: one layer, like the distribution network, and for the same reason. */
export function chargerFilter(state: StyleState): Expr {
  return combine([anyStatus(state), pointCountry(state)]);
}

/** Extraction sites: status and country, like charging stations; the substance is a colour, not a filter. */
export function extractionFilter(state: StyleState): Expr {
  return combine([anyStatus(state), pointCountry(state)]);
}

export function selectionFilter(selected: string | null): Expr {
  return ["==", ["get", "id"], selected ?? ""];
}
