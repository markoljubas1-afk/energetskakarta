import { describe, expect, it } from "vitest";

import { firstViewBounds, HOME_BOUNDS, type Bounds } from "./firstView";

const REGION: Bounds = [6.66, 35.51, 22.91, 48.99];

describe("the map's first view", () => {
  it("is the whole region on a wide screen, and on a phone held sideways", () => {
    expect(firstViewBounds(REGION, 1440, 900)).toEqual(REGION);
    expect(firstViewBounds(REGION, 700, 400)).toEqual(REGION);
  });

  it("is Croatia on a phone held upright", () => {
    expect(firstViewBounds(REGION, 412, 700)).toEqual(HOME_BOUNDS);
  });

  it("never reaches past the data: a small build is shown as it is", () => {
    const zagreb: Bounds = [14.5, 45.2, 16.5, 45.8];
    expect(firstViewBounds(zagreb, 412, 700)).toEqual(zagreb);
    const italyOnly: Bounds = [6.6, 36.6, 12.0, 47.1];
    expect(firstViewBounds(italyOnly, 412, 700)).toEqual(italyOnly);
  });
});
