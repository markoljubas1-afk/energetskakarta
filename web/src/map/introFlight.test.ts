import { describe, expect, it } from "vitest";

import { flightPlan, INTRO_STAGE_AT, introEnd, type Camera } from "./introFlight";

const final = { center: [16.2, 44.6] as [number, number], zoom: 5.6 };

describe("the intro's flight", () => {
  it("starts on the globe on a wide screen and turns flat before the tilted pass over the Adriatic", () => {
    const plan = flightPlan(final, 1440);
    expect(plan.start.zoom).toBeLessThan(2);
    expect(plan.globe).not.toBeNull();
    const [over] = plan.legs;
    expect(over?.to.pitch).toBeGreaterThan(40);
    // the globe has become the flat map by the time the camera tilts over the Adriatic
    expect(plan.globe && over && plan.globe.to < over.to.zoom).toBe(true);
    expect(plan.globe && plan.start.zoom < plan.globe.from).toBe(true);
    expect(plan.totalMs).toBe(plan.legs.reduce((sum, leg) => sum + leg.durationMs, 0));
  });

  it("keeps the globe on a laptop, whose first view is the whole region (around zoom 4.5)", () => {
    const laptop = flightPlan({ center: [15, 42.6], zoom: 4.5 }, 1366);
    expect(laptop.globe).not.toBeNull();
    expect(laptop.globe && laptop.start.zoom < laptop.globe.from).toBe(true);
  });

  it("is a shorter tilted descent on a phone, without the globe", () => {
    const phone = flightPlan({ center: final.center, zoom: 4.2 }, 390);
    expect(phone.globe).toBeNull();
    expect(phone.legs).toHaveLength(1);
    expect(phone.start.pitch).toBeGreaterThan(0);
    expect(flightPlan(final, 700).globe).toBeNull();
  });

  it("always lands exactly on the view the map opens on without it", () => {
    for (const plan of [flightPlan(final, 1440), flightPlan(final, 390)]) {
      expect(plan.legs.at(-1)?.to).toEqual({ center: [16.2, 44.6], zoom: 5.6, pitch: 0, bearing: 0 });
    }
  });

  it("lights the grid up in stages, in order, within the flight", () => {
    expect([...INTRO_STAGE_AT]).toEqual([...INTRO_STAGE_AT].sort((a, b) => a - b));
    expect(INTRO_STAGE_AT.every((share) => share >= 0 && share < 1)).toBe(true);
  });
});

describe("the end of the intro (Faza 56, 4.4f)", () => {
  const landing: Camera = { center: [16.2, 44.6], zoom: 5.6, pitch: 0, bearing: 0 };

  it("puts the camera on the first view when the flight did not get there (skipped, given up)", () => {
    const halfway: Camera = { center: [10, 40], zoom: 2, pitch: 40, bearing: 0 };
    expect(introEnd(false, landing, halfway)).toEqual({ jumpTo: landing, moved: false });
  });

  it("leaves a camera that landed alone, so a pan made while the title fades is not undone", () => {
    expect(introEnd(true, landing, landing)).toEqual({ jumpTo: null, moved: false });
    const panned: Camera = { ...landing, center: [16.9, 45.1] };
    expect(introEnd(true, landing, panned)).toEqual({ jumpTo: null, moved: true });
    expect(introEnd(true, landing, { ...landing, zoom: 6.4 })).toEqual({ jumpTo: null, moved: true });
  });
});
