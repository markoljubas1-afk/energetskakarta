import { describe, expect, it } from "vitest";

import { placeMenu } from "./PopoverMenu";

const viewport = { width: 390, height: 844 };
const menu = { width: 220, height: 160 };
const button = (top: number, left: number) => ({ top, bottom: top + 26, left, right: left + 90 });

describe("placing a menu next to its button", () => {
  it("opens above a button at the bottom of the screen, under its left edge", () => {
    expect(placeMenu(button(780, 20), menu, viewport, "above")).toEqual({ top: 780 - 6 - 160, left: 20 });
  });

  it("flips below when there is no room above (the status bar at the top of a phone)", () => {
    expect(placeMenu(button(10, 10), menu, viewport, "above")).toEqual({ top: 10 + 26 + 6, left: 10 });
  });

  it("ends at the button's right edge near the right side, and never leaves the screen", () => {
    expect(placeMenu(button(400, 280), menu, viewport, "below").left).toBe(280 + 90 - 220);
    const wide = placeMenu(button(400, 300), { width: 380, height: 100 }, viewport, "below");
    expect(wide.left).toBe(8);
    const tall = placeMenu(button(400, 20), { width: 220, height: 900 }, viewport, "below");
    expect(tall.top).toBe(8);
  });
});
