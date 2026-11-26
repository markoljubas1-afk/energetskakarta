import { describe, expect, it } from "vitest";

import { plantName } from "./plantName";

describe("a plant's name in Croatian (GEM's English descriptions)", () => {
  it("puts the kind of plant, in Croatian, in place of GEM's English description", () => {
    expect(plantName("Senj II hydroelectric plant", "hydro", "hr")).toBe("Hidroelektrana Senj II");
    expect(plantName("Apelovac solar farm", "solar", "hr")).toBe("Sunčana elektrana Apelovac");
    expect(plantName("Brda Umovi wind farm", "wind", "hr")).toBe("Vjetroelektrana Brda Umovi");
    expect(plantName("Babina Greda geothermal power plant", "geothermal", "hr")).toBe(
      "Geotermalna elektrana Babina Greda",
    );
    expect(plantName("Ajka Power Plant", "gas", "hr")).toBe("Plinska elektrana Ajka");
    expect(plantName("Bar gas power station", "gas", "hr")).toBe("Plinska elektrana Bar");
    expect(plantName("Gorizia CHP power station", "gas", "hr")).toBe("Plinska elektrana Gorizia");
  });

  it("takes the kind from the technology, so the description's own words can go", () => {
    expect(plantName("Blaca Pumped Storage hydroelectric plant", "pumped_storage", "hr")).toBe(
      "Reverzibilna hidroelektrana Blaca",
    );
  });

  it("keeps a number after the description with the name, and says floating and offshore", () => {
    expect(plantName("Acate Ragusa solar farm II", "solar", "hr")).toBe("Sunčana elektrana Acate Ragusa II");
    expect(plantName("Abruzzo 1 floating wind farm", "wind", "hr")).toBe(
      "Plutajuća vjetroelektrana Abruzzo 1",
    );
    expect(plantName("Rimini offshore wind farm", "wind", "hr")).toBe("Pučinska vjetroelektrana Rimini");
  });

  it("leaves alone names without such a description, a description alone, and the English page", () => {
    expect(plantName("Hidroelektrana Zakučac", "hydro", "hr")).toBe("Hidroelektrana Zakučac");
    expect(plantName("TE Plomin", "coal", "hr")).toBe("TE Plomin");
    expect(plantName("Ada PVPP Solar Energy Plant", "solar", "hr")).toBe("Ada PVPP Solar Energy Plant");
    expect(plantName("wind farm", "wind", "hr")).toBe("wind farm");
    expect(plantName("Senj II hydroelectric plant", "hydro", "en")).toBe("Senj II hydroelectric plant");
  });
});
