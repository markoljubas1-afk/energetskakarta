import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { HomeShapes } from "../data/homeFlow";
import { renderWithI18n } from "../test/render";
import { HomeFlow } from "./HomeFlow";

/** Sun from 07:00 to 17:00 with its peak at noon; a household that uses the most from 18:00 on. */
const SUN = Array.from({ length: 24 }, (_, hour) => Math.max(0, 600 - 100 * Math.abs(hour - 12)));
const HOUSE = Array.from({ length: 24 }, (_, hour) => (hour >= 18 ? 200 : 90));
const SHAPES: HomeShapes = {
  version: 1,
  generatedAt: "2026-11-18T20:00:00+00:00",
  timezone: "Europe/Zagreb",
  sun: {
    source: "PVGIS 5.3",
    sourceUrl: "https://re.jrc.ec.europa.eu/pvg_tools/en/",
    license: "CC-BY-4.0",
    attribution: "PVGIS © European Communities, 2001-2026",
    plane: { slopeDeg: 35, azimuthDeg: 0 },
    unit: "W/m2",
    grid: { west: 15, south: 45, step: 1, cols: 1, rows: 1 },
    points: [Array.from({ length: 12 }, () => SUN)],
  },
  household: {
    source: "HEP ODS, nadomjesne krivulje opterećenja (NKO KSK), skupina kućanstvo K0",
    sourceUrl: "https://www.hep.hr/ods/",
    license: "HEP-ODS-permission",
    year: 2026,
    group: "K0",
    unit: "W per 1000 kWh/year",
    months: Array.from({ length: 12 }, () => HOUSE),
  },
};
const ZAGREB = { lng: 15.98, lat: 45.81 };

function house(point = ZAGREB) {
  return renderWithI18n(
    <HomeFlow shapes={SHAPES} point={point} yearlyKwh={4000} yieldKwh={1250} kwp={3.2} month={5} />,
  );
}

describe("the house under the roof calculator", () => {
  it("at 13:00 feeds the house from the panels and sends the rest to the grid", () => {
    const { container } = house();
    const drawing = screen.getByRole("img");
    expect(drawing).toHaveAccessibleName(
      /^U 13:00, prosječan dan, lipanj: paneli daju [\d,]+ kW, kuća troši [\d,]+ kW\. U mrežu ide [\d,]+ kW\.$/,
    );
    expect(container.querySelector('[data-flow="pvToHome"]')).not.toBeNull();
    expect(container.querySelector('[data-flow="pvToGrid"]')).not.toBeNull();
    expect(container.querySelector('[data-flow="gridToHome"]')).toBeNull();
    expect(container.querySelector('[data-flow="batteryToHome"]')).toBeNull();
    // the same figures as text, and what the calculation assumes
    expect(
      screen.getByText(/^Prosječan dan, lipanj: paneli daju [\d,]+ kWh, kuća troši [\d,]+ kWh\./),
    ).toBeVisible();
    expect(screen.getByText(/^Kroz godinu \(izračun\): \d+ % proizvedenog ostaje u kući/)).toBeVisible();
    expect(
      screen.getByText(/Krov nagiba 35° okrenut jugu\..*za 2026\., ne vašeg kućanstva\..*gubi 10 %/),
    ).toBeVisible();
    expect(screen.getByText(/PVGIS © European Communities, 2001-2026; HEP ODS/)).toBeVisible();
  });

  it("in the evening takes from the grid, and from the battery once there is one", async () => {
    const { container } = house();
    fireEvent.change(screen.getByRole("slider", { name: /Sat u danu/ }), { target: { value: "20" } });
    expect(screen.getByRole("img")).toHaveAccessibleName(/paneli daju 0 kW, .*Iz mreže dolazi [\d,]+ kW\.$/);
    expect(container.querySelector('[data-flow="gridToHome"]')).not.toBeNull();
    const withoutBattery = screen.getByText(/^Kroz godinu/).textContent;

    await userEvent.click(screen.getByRole("checkbox", { name: /Želim i kućnu bateriju/ }));
    expect(screen.getByRole("img")).toHaveAccessibleName(/Baterija daje kući [\d,]+ kW\.$/);
    expect(container.querySelector('[data-flow="batteryToHome"]')).not.toBeNull();
    expect(container.querySelector('[data-flow="gridToHome"]')).toBeNull();
    // the year's shares are higher with the battery, and the ones without it stay beside them
    const withBattery = screen.getByText(/^Kroz godinu/).textContent;
    expect(withBattery).not.toBe(withoutBattery);
    expect(withBattery).toMatch(/Bez baterije: \d+ % i \d+ %\.$/);
    const own = (text: string | null): number => Number(/(\d+) % proizvedenog/.exec(text ?? "")?.[1]);
    expect(own(withBattery)).toBeGreaterThan(own(withoutBattery));
    // a larger battery can be chosen
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Kapacitet/ }), "15");
    expect(own(screen.getByText(/^Kroz godinu/).textContent)).toBeGreaterThanOrEqual(own(withBattery));
  });

  it("says so where there is no course of the sun for the place, instead of borrowing one from far away", () => {
    house({ lng: 22, lat: 49 });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/nema podatka o dnevnom hodu sunca/)).toBeVisible();
  });
});
