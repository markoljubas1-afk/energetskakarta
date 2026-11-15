import { describe, expect, it } from "vitest";

import { en } from "./en";
import { hr } from "./hr";
import { createI18n } from "./index";

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();

describe("dictionaries", () => {
  it("have the same keys and the same placeholders", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(hr).sort());
    for (const key of Object.keys(hr) as (keyof typeof hr)[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(hr[key]));
    }
  });
});

describe("formatting", () => {
  const hrI18n = createI18n("hr");
  const enI18n = createI18n("en");

  it("formats power with the local decimal separator and switches to GW", () => {
    expect(hrI18n.power(9.9)).toBe("9,9 MW");
    expect(hrI18n.power(276)).toBe("276 MW");
    expect(hrI18n.power(1200)).toBe("1,2 GW");
    expect(enI18n.power(1250.5)).toBe("1.25 GW");
  });

  it("fills placeholders and leaves unknown ones visible", () => {
    expect(hrI18n.t("searchNoResults", { query: "abc" })).toBe("Nema rezultata za „abc“");
    expect(enI18n.t("searchNoResults")).toBe("No results for “{query}”");
  });

  it.each([
    [1, "1 elektrana", "1 power plant"],
    [3, "3 elektrane", "3 power plants"],
    [5, "5 elektrana", "5 power plants"],
    [21, "21 elektrana", "21 power plants"],
    [22, "22 elektrane", "22 power plants"],
    [1234, "1.234 elektrane", "1,234 power plants"],
  ])("uses the right plural form for %i", (count, croatian, english) => {
    expect(hrI18n.plural("overviewPlants", count)).toBe(croatian);
    expect(enI18n.plural("overviewPlants", count)).toBe(english);
  });

  it("names countries in the interface language", () => {
    expect(hrI18n.country("HR")).toBe("Hrvatska");
    expect(enI18n.country("HR")).toBe("Croatia");
  });

  it("names every technology and voltage class", () => {
    expect(hrI18n.technology("pumped_storage")).toBe("Reverzibilna hidro");
    expect(enI18n.voltage("380+")).toMatch(/380/);
  });
});

describe("sources", () => {
  it("names sources and builds the attribution line in each language", () => {
    const hr = createI18n("hr");
    expect(hr.sources(["openstreetmap", "gem"])).toBe("OpenStreetMap, Global Energy Monitor");
    expect(hr.attribution(["openstreetmap", "naturalearth"])).toBe(
      "© OpenStreetMap suradnici (ODbL) | Granice: Natural Earth",
    );
    expect(createI18n("en").attribution(["gem", "transitionzero"])).toBe(
      "Global Energy Monitor (CC BY 4.0) | TransitionZero Solar Asset Mapper (CC BY-NC 4.0)",
    );
  });
});

describe("energy formatting", () => {
  it("picks a readable unit and names periods", () => {
    const hr = createI18n("hr");
    expect(hr.energy(950)).toBe("950 MWh");
    expect(hr.energy(26_410.9)).toBe("26,4 GWh");
    expect(hr.energy(412_000)).toBe("412 GWh");
    expect(hr.energy(12_345_678)).toBe("12,35 TWh");
    expect(hr.period("2025")).toBe("2025");
    expect(hr.months).toHaveLength(12);
    expect(createI18n("en").period("2025-07")).toBe("Jul 2025");
    expect(createI18n("en").percent(0.6129)).toBe("61.3%");
  });
});
