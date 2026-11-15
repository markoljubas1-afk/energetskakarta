import { describe, expect, it } from "vitest";

import { SELECTED_RING_STROKE } from "./layers";
import { pulseWidth, SELECTION_PULSE_MS } from "./selectionPulse";

describe("selection pulse", () => {
  it("rests at the ring's own width at the start, between the swells and at the end", () => {
    expect(pulseWidth(0)).toBe(SELECTED_RING_STROKE);
    expect(pulseWidth(SELECTION_PULSE_MS / 2)).toBe(SELECTED_RING_STROKE);
    expect(pulseWidth(SELECTION_PULSE_MS)).toBe(SELECTED_RING_STROKE);
    expect(pulseWidth(SELECTION_PULSE_MS * 5)).toBe(SELECTED_RING_STROKE);
  });

  it("swells twice, to the same height", () => {
    const first = pulseWidth(SELECTION_PULSE_MS / 4);
    const second = pulseWidth((SELECTION_PULSE_MS * 3) / 4);
    expect(first).toBeGreaterThan(SELECTED_RING_STROKE + 3);
    expect(second).toBe(first);
  });
});
