/** The two swells of a freshly selected point's ring: pure timing, so it can be tested without a map. */
import { SELECTED_RING_STROKE } from "./layers";

export const SELECTION_PULSE_MS = 900;
const PULSES = 2;
/** how much wider than at rest the ring gets at the top of a swell */
const SWELL_PX = 4;

/** Stroke width at `elapsed` ms into the pulse: at rest at the start, the end and between swells. */
export function pulseWidth(elapsed: number): number {
  const t = Math.min(Math.max(elapsed / SELECTION_PULSE_MS, 0), 1);
  const swell = Math.sin(Math.PI * t * PULSES) ** 2;
  return Math.round((SELECTED_RING_STROKE + SWELL_PX * swell) * 100) / 100;
}
