import { describe, expect, it } from "vitest";

import { CityRegisterSchema, cityRows } from "./cities";

const register = {
  version: 1,
  fields: [
    "id",
    "name",
    "country",
    "lon",
    "lat",
    "population",
    "inventoryYear",
    "baseline",
    "electricityMwh",
    "totalMwh",
    "baselineYear",
    "baselineElectricityMwh",
    "electricityBySector",
  ],
  sectors: ["municipal_buildings", "public_lighting", "not_a_sector"],
  rows: [
    ["com:1", "Grad", "HR", 16, 45.5, 120000, 2019, false, 186500, 204500, 2011, 175000, [11000, 6500, 7]],
  ],
};

describe("cityRows", () => {
  it("turns rows into objects and keeps only the sectors the site knows", () => {
    const [row] = cityRows(CityRegisterSchema.parse(register));
    expect(row).toMatchObject({ id: "com:1", country: "HR", inventoryYear: 2019, baselineYear: 2011 });
    expect(row?.electricityBySector).toEqual({ municipal_buildings: 11000, public_lighting: 6500 });
  });

  it("treats an unknown country as none rather than failing", () => {
    const [row] = register.rows;
    if (!row) throw new Error("fixture has no row");
    const foreign = { ...register, rows: [[...row.slice(0, 2), "DE", ...row.slice(3)]] };
    expect(cityRows(CityRegisterSchema.parse(foreign))[0]?.country).toBeNull();
  });
});
