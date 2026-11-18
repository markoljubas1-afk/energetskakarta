import { describe, expect, it } from "vitest";

import {
  BATTERY_CHARGE_LOSS,
  DAYS,
  dayTotals,
  homeYear,
  HOURS,
  MONTHS,
  scaled,
  simulateDay,
  sunShapeAt,
  type HomeShapes,
} from "./homeFlow";

/** Sun from 07:00 to 17:00 with its peak at noon, twice as strong in the summer half of the year. */
const SUN = Array.from({ length: MONTHS }, (_, month) =>
  Array.from(
    { length: HOURS },
    (_, hour) => (month >= 3 && month <= 8 ? 2 : 1) * Math.max(0, 500 - 100 * Math.abs(hour - 12)),
  ),
);
/** A household that uses twice as much in the evening (18:00 to 23:00) as in the rest of the day. */
const HOUSEHOLD = Array.from({ length: MONTHS }, () =>
  Array.from({ length: HOURS }, (_, hour) => (hour >= 18 ? 200 : 100)),
);

const yearOf = (shape: number[][]): number =>
  shape.reduce((total, day, month) => total + (DAYS[month] ?? 0) * day.reduce((a, b) => a + b, 0), 0);

describe("the shapes", () => {
  it("scales a shape to the year it is told, and refuses an empty one", () => {
    const pv = scaled(SUN, 5000);
    if (!pv) throw new Error("no shape");
    expect(yearOf(pv)).toBeCloseTo(5000, 6);
    // the shape is kept: noon in July is twice noon in January
    expect((pv[6]?.[12] ?? 0) / (pv[0]?.[12] ?? 1)).toBeCloseTo(2, 9);
    expect(pv[0]?.[3]).toBe(0);
    expect(
      scaled(
        SUN.map((day) => day.map(() => 0)),
        5000,
      ),
    ).toBeNull();
  });

  it("takes the sun of the nearest point that has one, and none from far away", () => {
    const doc = {
      sun: {
        grid: { west: 13, south: 42, step: 1, cols: 3, rows: 2 },
        // south row: sea, A, B; north row: C, sea, sea
        points: [null, [[1]], [[2]], [[3]], null, null],
      },
    } as unknown as HomeShapes;
    expect(sunShapeAt(doc, 14.4, 42.6)).toEqual([[1]]);
    expect(sunShapeAt(doc, 15.6, 42.4)).toEqual([[2]]);
    // over the sea in the north: the nearest land point speaks for it while it is near enough
    expect(sunShapeAt(doc, 14.6, 43.4)).toEqual([[3]]);
    expect(sunShapeAt(doc, 19.5, 46)).toBeNull();
  });
});

describe("a day of the house", () => {
  const pv = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 4, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0];
  const load = Array.from({ length: HOURS }, (_, hour) => (hour >= 18 ? 1.5 : 0.5));

  it("keeps the balance in every hour, with and without a battery", () => {
    for (const battery of [0, 5, 100]) {
      const day = simulateDay(pv, load, battery);
      expect(day).toHaveLength(HOURS);
      for (const hour of day) {
        // what the panels made went somewhere, and what the house used came from somewhere
        expect(hour.pvToHome + hour.pvToBattery + hour.pvToGrid).toBeCloseTo(hour.pv, 9);
        expect(hour.pvToHome + hour.batteryToHome + hour.gridToHome).toBeCloseTo(hour.load, 9);
        expect(hour.stored).toBeGreaterThanOrEqual(-1e-9);
        expect(hour.stored).toBeLessThanOrEqual(battery + 1e-9);
        for (const value of Object.values(hour)) expect(value).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it("without a battery sends the surplus to the grid and buys the evening", () => {
    const day = simulateDay(pv, load, 0);
    expect(day[11]).toMatchObject({ pv: 4, pvToHome: 0.5, pvToBattery: 0, pvToGrid: 3.5, gridToHome: 0 });
    expect(day[20]).toMatchObject({ pv: 0, batteryToHome: 0, gridToHome: 1.5, stored: 0 });
    const totals = dayTotals(day);
    expect(totals.pv).toBe(24);
    expect(totals.load).toBe(18);
    // nine sunny hours use 0.5 kWh each of the 24 made
    expect(totals.selfConsumption).toBeCloseTo(4.5 / 24, 9);
    expect(totals.selfSufficiency).toBeCloseTo(4.5 / 18, 9);
  });

  it("with a battery stores the surplus less the loss, and the evening comes from the battery", () => {
    const day = simulateDay(pv, load, 5);
    // the battery is full after taking 5 / 0.9 kWh of surplus; the rest still goes to the grid
    const charged = day.reduce((total, hour) => total + hour.pvToBattery, 0);
    expect(charged).toBeCloseTo(5 / (1 - BATTERY_CHARGE_LOSS), 6);
    expect(day[18]?.batteryToHome).toBeCloseTo(1.5, 9);
    expect(day[18]?.gridToHome).toBeCloseTo(0, 9);
    // 5 kWh last from 16:00 into the hour of 20:00, where the last kWh is used and the grid takes over
    expect(day[20]?.batteryToHome).toBeCloseTo(1, 9);
    expect(day[20]?.gridToHome).toBeCloseTo(0.5, 9);
    expect(day[21]?.stored).toBeCloseTo(0, 9);
    const without = dayTotals(simulateDay(pv, load, 0));
    const withBattery = dayTotals(day);
    expect(withBattery.selfConsumption ?? 0).toBeGreaterThan(without.selfConsumption ?? 0);
    expect(withBattery.gridToHome).toBeCloseTo(without.gridToHome - 5, 6);
  });

  it("carries what is left in the battery into the next morning", () => {
    // a battery larger than the evening needs still has something at midnight, used before sunrise
    const day = simulateDay(pv, load, 15);
    expect(day[23]?.stored).toBeGreaterThan(0);
    expect(day[2]?.batteryToHome).toBeCloseTo(0.5, 9);
  });

  it("has no shares on a day without sun or without consumption", () => {
    const dark = dayTotals(
      simulateDay(
        pv.map(() => 0),
        load,
        5,
      ),
    );
    expect(dark.selfConsumption).toBeNull();
    expect(dark.selfSufficiency).toBe(0);
    expect(
      dayTotals(
        simulateDay(
          pv,
          load.map(() => 0),
          0,
        ),
      ).selfSufficiency,
    ).toBeNull();
  });
});

describe("the house through the year", () => {
  const inputs = { yearlyKwh: 4000, yieldKwhPerKwp: 1250, kwp: 3.2, batteryKwh: 0 };

  it("adds up to the calculator's own yearly amounts", () => {
    const year = homeYear(SUN, HOUSEHOLD, inputs);
    if (!year) throw new Error("no year");
    expect(year.months).toHaveLength(MONTHS);
    expect(year.year.pv).toBeCloseTo(3.2 * 1250, 6);
    expect(year.year.load).toBeCloseTo(4000, 6);
    expect(year.year.selfConsumption).toBeGreaterThan(0);
    expect(year.year.selfConsumption).toBeLessThan(1);
  });

  it("a battery raises both shares and never the amounts", () => {
    const without = homeYear(SUN, HOUSEHOLD, inputs);
    const withBattery = homeYear(SUN, HOUSEHOLD, { ...inputs, batteryKwh: 10 });
    if (!without || !withBattery) throw new Error("no year");
    expect(withBattery.year.pv).toBeCloseTo(without.year.pv, 6);
    expect(withBattery.year.load).toBeCloseTo(without.year.load, 6);
    expect(withBattery.year.selfConsumption ?? 0).toBeGreaterThan(without.year.selfConsumption ?? 0);
    expect(withBattery.year.selfSufficiency ?? 0).toBeGreaterThan(without.year.selfSufficiency ?? 0);
  });

  it("says nothing for an input that is not a positive number", () => {
    expect(homeYear(SUN, HOUSEHOLD, { ...inputs, kwp: 0 })).toBeNull();
    expect(homeYear(SUN, HOUSEHOLD, { ...inputs, yearlyKwh: Number.NaN })).toBeNull();
    expect(
      homeYear(
        SUN.map((day) => day.map(() => 0)),
        HOUSEHOLD,
        inputs,
      ),
    ).toBeNull();
  });
});
