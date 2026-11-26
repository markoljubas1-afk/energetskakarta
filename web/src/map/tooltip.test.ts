import { describe, expect, it } from "vitest";

import { createI18n } from "../i18n";
import { fromProperties } from "./selection";
import { timelineTooltip, tooltipFor } from "./tooltip";

const i18n = createI18n("hr");
const en = createI18n("en");

function selection(layer: string, props: Record<string, unknown>) {
  const result = fromProperties(layer, { id: "osm:way/1", status: "operating", ...props });
  if (!result) throw new Error("fixture does not parse");
  return result;
}

describe("tooltipFor", () => {
  it("names a plant with its technology and capacity", () => {
    const plant = selection("plants", { name: "RHE Primjer", technology: "hydro", capacityMw: 276 });
    expect(tooltipFor(plant, i18n)).toEqual({ title: "RHE Primjer", detail: "Hidro · 276 MW" });
    expect(tooltipFor(plant, en).detail).toBe("Hydro · 276 MW");
  });

  it("says a plant known by GEM's English name in Croatian, and leaves it as it is in English", () => {
    const plant = selection("plants", { name: "Apelovac solar farm", technology: "solar", capacityMw: 9 });
    expect(tooltipFor(plant, i18n).title).toBe("Sunčana elektrana Apelovac");
    expect(tooltipFor(plant, en).title).toBe("Apelovac solar farm");
  });

  it("says when a plant record is a new part of a running plant, which the source names alike", () => {
    const props = { name: "NE Primjer", technology: "nuclear", expansionOf: "osm:way/2" };
    expect(tooltipFor(selection("plants", { ...props, status: "planned" }), i18n).title).toBe(
      "NE Primjer (planirano proširenje)",
    );
    expect(tooltipFor(selection("plants", { ...props, status: "construction" }), en).title).toBe(
      "NE Primjer (expansion under construction)",
    );
  });

  it("falls back to the kind when there is no name, and leaves out what is unknown", () => {
    const plant = selection("plants", { technology: "solar" });
    expect(tooltipFor(plant, i18n)).toEqual({ title: "Elektrana", detail: "Sunčana" });
  });

  it("describes a line by its voltage and shows an interconnector's countries", () => {
    const line = selection("lines", {
      kind: "line",
      voltages: "400;220",
      maxVoltageKv: 400,
      isInterconnector: true,
      countries: "HR,SI",
    });
    expect(tooltipFor(line, i18n)).toEqual({
      title: "Dalekovod · 400 / 220 kV",
      detail: "Hrvatska – Slovenija",
    });
    const cable = selection("lines", { kind: "cable", status: "planned" });
    expect(tooltipFor(cable, i18n)).toEqual({ title: "Kabel", detail: "Planirano" });
  });

  it("says what a substation, data centre and charger are, not only their names", () => {
    const station = selection("substations", { name: "TS Primjer", voltages: "110;35", country: "HR" });
    expect(tooltipFor(station, i18n).detail).toBe("Trafostanica · 110 / 35 kV");
    const centre = selection("datacenters", { name: "DC", country: "HR" });
    expect(tooltipFor(centre, i18n).detail).toBe("Podatkovni centar");
    const charger = selection("chargers", { points: 4, country: "HR", status: "planned" });
    expect(tooltipFor(charger, i18n)).toEqual({
      title: "Punionica za električna vozila",
      detail: "Punionica za električna vozila · 4 mjesta za punjenje · Planirano",
    });
  });

  it("never returns an empty detail string", () => {
    const pipeline = selection("pipelines", { medium: "gas" });
    expect(tooltipFor(pipeline, i18n)).toEqual({ title: "Cjevovod", detail: "Plin" });
  });
});

describe("cities in the tooltip", () => {
  it("shows the city's yearly electricity and the inventory year", () => {
    const city = fromProperties("cities", {
      id: "com:1001",
      name: "Grad Primjer",
      inventoryYear: 2019,
      electricityMwh: 186500,
      totalMwh: 204500,
    });
    if (!city) throw new Error("fixture does not parse");
    expect(tooltipFor(city, i18n)).toEqual({ title: "Grad Primjer", detail: "Grad · 187 GWh/god · 2019" });
  });
});

describe("timelineTooltip (Faza 27)", () => {
  it("names a plant the time machine draws from the timeline, with its years", () => {
    const i18n = createI18n("hr");
    expect(
      timelineTooltip(
        {
          name: "TE Plomin 1",
          technology: "coal",
          capacityMw: 125,
          commissioningYear: 1970,
          retiredYear: 2017,
        },
        i18n,
      ),
    ).toEqual({
      title: "TE Plomin 1",
      detail: `${i18n.technology("coal")} · ${i18n.power(125)} · 1970–2017`,
    });
    expect(timelineTooltip({ name: "TE X", retiredYear: 2015 }, i18n)?.detail).toBe("zatvorena 2015.");
    expect(timelineTooltip({ retiredYear: 2015 }, i18n)).toBeNull();
  });
});
