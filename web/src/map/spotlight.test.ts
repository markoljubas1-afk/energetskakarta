import { describe, expect, it } from "vitest";

import { voltageClassExpr } from "./filters";
import { BACKGROUND, gridOpacity, plantOpacity, RECEDED } from "./spotlight";

describe("spotlight", () => {
  it("leaves every opacity as it is when nothing is lit", () => {
    expect(plantOpacity(null, 0.92)).toBe(0.92);
    expect(gridOpacity(null, 1)).toBe(1);
  });

  it("lights one technology, lets the other plants recede and the grid step back", () => {
    const spot = { kind: "technology", value: "hydro" } as const;
    expect(plantOpacity(spot, 0.92)).toEqual([
      "case",
      ["==", ["get", "technology"], "hydro"],
      0.92,
      Math.round(0.92 * RECEDED * 1000) / 1000,
    ]);
    expect(gridOpacity(spot, 1)).toBe(BACKGROUND);
  });

  it("lights one voltage class by the same rule the map colours and filters by", () => {
    const spot = { kind: "voltage", value: "380+" } as const;
    expect(gridOpacity(spot, 1)).toEqual(["case", ["==", voltageClassExpr, "380+"], 1, RECEDED]);
    expect(plantOpacity(spot, 1)).toBe(BACKGROUND);
  });
});
