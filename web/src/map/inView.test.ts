import { describe, expect, it } from "vitest";

import type { LayerKey } from "../domain";
import { nothingShown } from "./inView";

const set = (...keys: LayerKey[]): ReadonlySet<LayerKey> => new Set(keys);

describe("nothing on the map from what is switched on (Faza 57-C2)", () => {
  it("is said when every layer that is on has nothing in view", () => {
    expect(nothingShown(set("lines", "plants"), set("lines", "plants"))).toBe(true);
  });

  it("is not said while one of them still shows something", () => {
    expect(nothingShown(set("lines", "plants"), set("plants"))).toBe(false);
  });

  it("is not said when a layer the map cannot count is on (gas, solar potential…)", () => {
    expect(nothingShown(set("plants", "gas"), set("plants"))).toBe(false);
    expect(nothingShown(set("plants", "solar"), set("plants"))).toBe(false);
  });

  it("is not said with nothing switched on: that is the reader's choice, and the list says so", () => {
    expect(nothingShown(set(), set())).toBe(false);
  });
});
