/**
 * The geometry of the gas flow diagram (Faza 45-1): what entered the transmission system on the left,
 * what left it on the right, and the system itself as a trunk in the middle.
 *
 * A band is as thick as the point's flow. The bands go from each entry to the trunk and from the trunk to
 * each exit, and never from an entry to an exit: the platform says how much passed each point, not which
 * gas went where, and a band from the LNG terminal to Hungary would be a claim nobody measured.
 *
 * The scale, the order of the points and the room each one has are those of the whole period, so the
 * diagram holds still while the days are played and only the bands change.
 */
import type { Balance, FlowRow } from "../data/gasFlows";

/** The trunk's height on the period's largest day, in pixels. */
const TRUNK = 110;
/** The least room a point has: its label, two or three short lines. */
const SLOT = 46;
/** The air between a band and the next point's room. */
const AIR = 8;
/** The diagram is drawn 100 units wide and stretched; the trunk stands between these two. */
export const TRUNK_LEFT = 42;
export const TRUNK_RIGHT = 58;

export interface Slot {
  /** the point and its direction */
  id: string;
  top: number;
  height: number;
}

export interface Frame {
  /** pixels per kWh a day */
  scale: number;
  height: number;
  /** the room of each point, top to bottom: the period's largest first */
  entries: Slot[];
  exits: Slot[];
}

export const slotId = (row: Pick<FlowRow, "key" | "direction">): string => `${row.key}-${row.direction}`;

function slots(days: readonly Balance[], side: "entries" | "exits", scale: number): Slot[] {
  const total = new Map<string, number>();
  const peak = new Map<string, number>();
  const label = new Map<string, string>();
  for (const day of days) {
    for (const row of day[side]) {
      const id = slotId(row);
      total.set(id, (total.get(id) ?? 0) + row.kwh);
      peak.set(id, Math.max(peak.get(id) ?? 0, row.kwh));
      label.set(id, row.label);
    }
  }
  const order = [...total.keys()].sort(
    (a, b) =>
      (total.get(b) ?? 0) - (total.get(a) ?? 0) || (label.get(a) ?? "").localeCompare(label.get(b) ?? ""),
  );
  let top = 0;
  return order.map((id) => {
    const height = Math.max(SLOT, (peak.get(id) ?? 0) * scale + AIR);
    const slot = { id, top, height };
    top += height;
    return slot;
  });
}

/** The frame the period's days are all drawn in; null when there is nothing to draw. */
export function frame(days: readonly Balance[]): Frame | null {
  const peak = Math.max(0, ...days.map((day) => Math.max(day.enteredKwh, day.leftKwh)));
  if (!(peak > 0)) return null;
  const scale = TRUNK / peak;
  const entries = slots(days, "entries", scale);
  const exits = slots(days, "exits", scale);
  const bottom = (side: readonly Slot[]): number => side.reduce((sum, slot) => sum + slot.height, 0);
  return { scale, height: Math.max(bottom(entries), bottom(exits), TRUNK + AIR), entries, exits };
}

export interface Band {
  id: string;
  /** the outline, in the diagram's units (100 wide, `height` high) */
  path: string;
}

export interface Drawing {
  entries: Band[];
  exits: Band[];
  trunk: { top: number; height: number };
}

const round = (value: number): number => Math.round(value * 10) / 10;

/** A band from `outer` (the label's side) to the trunk's edge at `inner`, `thick` pixels thick. */
function band(outer: number, inner: number, middle: number, onTrunk: number, thick: number): string {
  const bend = (outer + inner) / 2;
  const a = round(middle - thick / 2);
  const b = round(onTrunk);
  const a2 = round(middle + thick / 2);
  const b2 = round(onTrunk + thick);
  return (
    `M${String(outer)},${String(a)} C${String(bend)},${String(a)} ${String(bend)},${String(b)} ${String(inner)},${String(b)} ` +
    `L${String(inner)},${String(b2)} C${String(bend)},${String(b2)} ${String(bend)},${String(a2)} ${String(outer)},${String(a2)} Z`
  );
}

function side(
  rows: readonly FlowRow[],
  room: readonly Slot[],
  frame: Frame,
  outer: number,
  inner: number,
): { bands: Band[]; top: number; height: number } {
  const kwh = new Map(rows.map((row) => [slotId(row), row.kwh]));
  // a flow too small for one pixel is still drawn, as a hairline: it did flow
  const thick = (id: string): number => {
    const value = kwh.get(id) ?? 0;
    return value > 0 ? Math.max(1, value * frame.scale) : 0;
  };
  const height = room.reduce((sum, slot) => sum + thick(slot.id), 0);
  const top = frame.height / 2 - height / 2;
  let at = top;
  const bands: Band[] = [];
  for (const slot of room) {
    const size = thick(slot.id);
    if (size > 0) {
      bands.push({ id: slot.id, path: band(outer, inner, slot.top + slot.height / 2, at, size) });
    }
    at += size;
  }
  return { bands, top, height };
}

/** One day's bands in the period's frame. */
export function drawing(day: Balance, frame: Frame): Drawing {
  const entered = side(day.entries, frame.entries, frame, 0, TRUNK_LEFT);
  const left = side(day.exits, frame.exits, frame, 100, TRUNK_RIGHT);
  const top = Math.min(entered.top, left.top);
  const bottom = Math.max(entered.top + entered.height, left.top + left.height);
  return {
    entries: entered.bands,
    exits: left.bands,
    trunk: { top: round(top), height: round(bottom - top) },
  };
}
