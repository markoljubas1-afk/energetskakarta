/**
 * Linked highlighting: resting the pointer on a technology or a voltage in the legend or the overview lights
 * up just those marks on the map and lets everything else recede. It is a way of looking, not a filter:
 * nothing is hidden, nothing goes into the link, and it ends when the pointer leaves.
 */
import type { ExpressionSpecification } from "maplibre-gl";

import type { Technology, VoltageClass } from "../domain";
import { voltageClassExpr } from "./filters";

export type Spotlight =
  { kind: "technology"; value: Technology } | { kind: "voltage"; value: VoltageClass } | null;

type Opacity = number | ExpressionSpecification;

/** What is not in the light keeps this share of its opacity: still there, clearly behind. */
export const RECEDED = 0.12;
/** The other family (the grid while a technology is lit, plants while a voltage is) steps back less. */
export const BACKGROUND = 0.3;

const round = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * While the time machine runs, the grid steps this far back: the story is which plants stood in that year,
 * and the lines are today's (they have no years in the sources), so they stay only as a faint ground to
 * place the plants on.
 */
export const TIME_MACHINE_GRID = 0.16;

/** Opacity of a plant mark that is `full` when nothing is spotlighted. */
export function plantOpacity(spotlight: Spotlight, full: number): Opacity {
  if (spotlight === null) return full;
  if (spotlight.kind === "voltage") return round(full * BACKGROUND);
  return ["case", ["==", ["get", "technology"], spotlight.value], full, round(full * RECEDED)];
}

/** Opacity of a line or substation mark that is `full` when nothing is spotlighted. */
export function gridOpacity(spotlight: Spotlight, full: number): Opacity {
  if (spotlight === null) return full;
  if (spotlight.kind === "technology") return round(full * BACKGROUND);
  return ["case", ["==", voltageClassExpr, spotlight.value], full, round(full * RECEDED)];
}
