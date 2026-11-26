import { describe, expect, it } from "vitest";

import type { GasStorage } from "../data/gasStorage";
import { createI18n } from "../i18n";
import { askedGasPicture, gasCard, gasCardText, gasCountries } from "./gasCard";

const DAYS = [
  "2026-11-09",
  "2026-11-10",
  "2026-11-11",
  "2026-11-12",
  "2026-11-13",
  "2026-11-14",
  "2026-11-15",
  "2026-11-16",
  "2026-11-17",
];

/** A facility whose gas in storage is given day by day; its fill follows from what it can hold. */
const facility = (
  id: string,
  country: string,
  name: string,
  holds: number | null,
  stored: (number | null)[],
  status: string[] = [],
): GasStorage["facilities"][number] => ({
  id,
  name,
  operator: "Operator",
  operatorId: "X",
  country,
  lon: null,
  lat: null,
  workingGasTwh: holds,
  status: stored.map((_, at) => status[at] ?? "C"),
  fullPercent: stored.map((twh) => (twh === null || holds === null ? null : (twh / holds) * 100)),
  inStorageTwh: stored,
  injectionGwhPerDay: stored.map(() => 0),
  withdrawalGwhPerDay: stored.map(() => 10),
});

const falling = (from: number, step: number): number[] => DAYS.map((_, at) => from - at * step);

const STORAGE: GasStorage = {
  version: 1,
  generatedAt: "2026-11-18T08:00:00+00:00",
  source: "GIE AGSI",
  sourceUrl: "https://agsi.gie.eu/",
  attribution: "GIE AGSI",
  license: "see source",
  days: DAYS,
  facilities: [
    // 4.0 TWh of 5 on the first day, 0.05 less each day: 80 % → 72 % over the eight days after
    facility("HR1", "HR", "UGS Okoli", 5, falling(4, 0.05)),
    // two in Austria: the second one has not reported the last day yet
    facility("AT1", "AT", "Speicher Eins", 20, falling(10, 0.1)),
    facility("AT2", "AT", "Speicher Zwei", 60, [...falling(30, 0.2).slice(0, 8), null]),
    // one that never reported, and one without its volumes
    facility(
      "HU0",
      "HU",
      "Néma",
      10,
      DAYS.map(() => null),
    ),
    {
      ...facility(
        "IT1",
        "IT",
        "Stoccaggio",
        null,
        DAYS.map(() => null),
      ),
      fullPercent: DAYS.map(() => 88.4),
    },
  ],
  missing: { facilities: [], countries: [] },
};

describe("the gas storage card", () => {
  it("reads one facility's last day, its volume and the fill seven days before", () => {
    const card = gasCard(STORAGE, "HR");
    expect(card).toMatchObject({
      country: "HR",
      day: "2026-11-17",
      facilities: 1,
      name: "UGS Okoli",
      estimated: false,
      volume: { capacityTwh: 5 },
      weekBefore: { day: "2026-11-10" },
    });
    expect(card?.full).toBeCloseTo(72, 6);
    expect(card?.volume?.storedTwh).toBeCloseTo(3.6, 6);
    expect(card?.weekBefore?.full).toBeCloseTo(79, 6);
  });

  it("adds several facilities up only on a day all of them reported", () => {
    const card = gasCard(STORAGE, "AT");
    // the 17th lacks the second facility: the total is of the 16th, (9.3 + 28.6) of 80 TWh
    expect(card?.day).toBe("2026-11-16");
    expect(card?.facilities).toBe(2);
    expect(card?.name).toBe("");
    expect(card?.full).toBeCloseTo((37.9 / 80) * 100, 6);
    expect(card?.weekBefore).toMatchObject({ day: "2026-11-09" });
    expect(card?.weekBefore?.full).toBeCloseTo(50, 6);
  });

  it("leaves out what the data does not have", () => {
    // no volumes: the fill alone; a facility that never reported is no card
    expect(gasCard(STORAGE, "IT")).toMatchObject({ full: 88.4, volume: null });
    expect(gasCard(STORAGE, "HU")).toBeNull();
    expect(gasCard(STORAGE, "SI")).toBeNull();
    // seven days before is not in the data: no change
    const short: GasStorage = {
      ...STORAGE,
      days: DAYS.slice(4),
      facilities: [facility("HR1", "HR", "UGS Okoli", 5, falling(4, 0.05).slice(4))],
    };
    expect(gasCard(short, "HR")?.weekBefore).toBeNull();
    expect(gasCountries(STORAGE, ["HR", "SI", "HU", "AT", "IT"])).toEqual(["HR", "AT", "IT"]);
  });

  it("marks a day the operator only estimated", () => {
    const estimated: GasStorage = {
      ...STORAGE,
      facilities: [
        facility(
          "HR1",
          "HR",
          "UGS Okoli",
          5,
          falling(4, 0.05),
          DAYS.map((_, at) => (at === 8 ? "E" : "C")),
        ),
      ],
    };
    expect(gasCard(estimated, "HR")?.estimated).toBe(true);
    const card = gasCard(estimated, "HR");
    expect(card && gasCardText(card, createI18n("hr")).figures[0]?.note).toBe(
      "UGS Okoli, plinski dan 17. studenoga 2026.; procjena operatora",
    );
  });

  it("says it in words, with the source the data asks to be named", () => {
    const card = gasCard(STORAGE, "HR");
    if (!card) throw new Error("no card");
    const text = gasCardText(card, createI18n("hr"));
    expect(text.title).toBe("GridAtlas: zalihe plina");
    expect(text.subtitle).toBe("Hrvatska · 17. studenoga 2026.");
    expect(text.figures.map((f) => `${f.value} ${f.unit}`)).toEqual(["72 %", "3,6 TWh", "−7 p. b."]);
    expect(text.figures[1]).toMatchObject({ label: "plina u skladištu", note: "stane 5 TWh" });
    expect(text.figures[2]).toMatchObject({
      label: "promjena popunjenosti u sedam dana",
      note: "u postotnim bodovima; 10. studenoga 2026. bilo je 79 %",
    });
    expect(text.footer).toBe("Izvor: GIE AGSI (agsi.gie.eu) · gridatlas.eu");

    const english = gasCardText(card, createI18n("en"));
    expect(english.figures.map((f) => `${f.value} ${f.unit}`)).toEqual(["72 %", "3.6 TWh", "−7 pp"]);
    expect(english.footer).toContain("GIE AGSI");

    // a storage that is being filled carries a plus
    const rising: GasStorage = {
      ...STORAGE,
      facilities: [facility("HR1", "HR", "UGS Okoli", 5, [...falling(4, 0.05)].reverse())],
    };
    const up = gasCard(rising, "HR");
    expect(up && gasCardText(up, createI18n("hr")).figures[2]?.value).toBe("+7");
  });

  it("opens from a link", () => {
    expect(askedGasPicture("?pic=gas")).toBe("gas");
    expect(askedGasPicture("?l=lines&pic=gasflow")).toBe("gasflow");
    expect(askedGasPicture("?pic=2026-10")).toBeNull();
    expect(askedGasPicture("")).toBeNull();
  });
});
