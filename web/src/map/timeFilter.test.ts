import { describe, expect, it } from "vitest";

import { parseState } from "../state/url";
import { plantFilter } from "./filters";

describe("plant filter in the time machine", () => {
  it("keeps plants that started by the year and hides those without a year", () => {
    const filter = plantFilter(parseState("?y=1970", "hr"), true);
    // a missing year sorts after every year the time machine accepts, so it never passes
    expect(filter).toContainEqual(["<=", ["coalesce", ["get", "commissioningYear"], 2101], 1970]);
  });

  it("hides plants under construction and planned while it is open", () => {
    expect(plantFilter(parseState("?y=1970", "hr"), false)).toContainEqual(["literal", false]);
  });

  it("adds nothing when it is closed", () => {
    expect(JSON.stringify(plantFilter(parseState("", "hr"), true))).not.toContain("commissioningYear");
  });
});
