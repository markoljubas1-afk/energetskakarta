import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GasStorage } from "../data/gasStorage";
import { GREEN_LIVE } from "../data/greenShare.fixture";
import type { Live } from "../data/live";
import { dayCard, figureFonts, wrap } from "../share/dayCard";
import { renderWithI18n } from "../test/render";
import { DayCardDialog } from "./DayCardDialog";

/** Croatia's latest reported hour is 09:00 to 10:00 on 16 November: 900 of 1300 MW renewable, 69 %. */
const NOW = new Date("2026-11-16T11:20:00+01:00");

/** The second day (indices 24 to 47) priced at 80 €/MWh for twelve hours and 120 for the other twelve. */
const PRICED: Live = {
  ...GREEN_LIVE,
  prices: {
    HR: { zone: "HR", eurPerMwh: GREEN_LIVE.hours.map((_, i) => (i < 24 ? 50 : i < 36 ? 80 : 120)) },
    // Slovenia's day lacks one hour: no average
    SI: { zone: "SI", eurPerMwh: GREEN_LIVE.hours.map((_, i) => (i === 40 ? null : 90)) },
  },
};

const facility = (id: string, country: string, name: string, twh: number, of: number) => ({
  id,
  name,
  operator: "Operator",
  operatorId: "X",
  country,
  lon: null,
  lat: null,
  workingGasTwh: of,
  status: ["C"],
  fullPercent: [(twh / of) * 100],
  inStorageTwh: [twh],
  injectionGwhPerDay: [0],
  withdrawalGwhPerDay: [10],
});

const STORAGE: GasStorage = {
  version: 1,
  generatedAt: "2026-11-16T08:00:00+00:00",
  source: "GIE AGSI",
  sourceUrl: "https://agsi.gie.eu/",
  attribution: "GIE AGSI",
  license: "see source",
  days: ["2026-11-15"],
  facilities: [
    facility("HR1", "HR", "PSP Okoli", 4.25, 5),
    facility("AT1", "AT", "Speicher Eins", 10, 20),
    facility("AT2", "AT", "Speicher Zwei", 30, 60),
  ],
  missing: { facilities: [], countries: [] },
};

describe("the day in three figures", () => {
  it("takes each figure with its own time, and leaves out what the data does not have", () => {
    const croatia = dayCard(PRICED, STORAGE, "HR", NOW);
    expect(croatia?.share).toBeCloseTo(900 / 1300, 6);
    expect(croatia?.price).toEqual({ average: 100, hours: 24 });
    expect(croatia?.storage).toEqual({ full: 85, day: "2026-11-15", facilities: 1, name: "PSP Okoli" });

    // Slovenia: a day with a missing price has no average; the country has no storage
    const slovenia = dayCard(PRICED, STORAGE, "SI", NOW);
    expect(slovenia?.price).toBeNull();
    expect(slovenia?.storage).toBeNull();

    // several facilities are added up by volume: 40 of 80 TWh
    expect(
      dayCard({ ...PRICED, generation: { AT: { hydro: PRICED.hours.map(() => 10) } } }, STORAGE, "AT", NOW),
    ).toMatchObject({ storage: { full: 50, facilities: 2 } });

    // figures from last night are not a picture of today
    expect(dayCard(PRICED, STORAGE, "HR", new Date("2026-11-16T20:30:00+01:00"))).toBeNull();
    expect(dayCard(PRICED, STORAGE, "ME", NOW)).toBeNull();
  });

  it("breaks a label at spaces to fit its column", () => {
    const measure = (text: string): number => text.length * 10;
    expect(wrap(measure, "popunjenost skladišta plina", 200)).toEqual(["popunjenost", "skladišta plina"]);
    expect(wrap(measure, "kratko", 200)).toEqual(["kratko"]);
  });

  it("draws a figure smaller when it and its unit would not fit their column", () => {
    // every character as wide as 0.6 of the font size
    const measure = (text: string, size: number): number => text.length * size * 0.6;
    // "67" + "%": 130 + 12 + 24 = 166 px, fits 320
    expect(figureFonts(measure, { value: "67", unit: "%" }, 320)).toEqual({ value: 108, unit: 40, gap: 12 });
    // "196" + "€/MWh": 194 + 12 + 120 = 326 px into 280: everything shrinks by the same factor
    const tight = figureFonts(measure, { value: "196", unit: "€/MWh" }, 280);
    expect(tight.value).toBe(Math.floor(108 * (280 / 326.4)));
    expect(tight.unit).toBe(Math.floor(40 * (280 / 326.4)));
    expect(measure("196", tight.value) + tight.gap + measure("€/MWh", tight.unit)).toBeLessThanOrEqual(280);
  });

  describe("as a picture", () => {
    const drawn: string[] = [];
    const blobs: (string | undefined)[] = [];

    beforeEach(() => {
      drawn.length = 0;
      blobs.length = 0;
      // jsdom has no dialog methods and no canvas: stand-ins that record what the page asks of them
      HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      };
      HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
        this.removeAttribute("open");
      };
      const gradient = { addColorStop: vi.fn() };
      const context = {
        createLinearGradient: () => gradient,
        fillRect: vi.fn(),
        fillText: (text: string) => {
          drawn.push(text);
        },
        measureText: (text: string) => ({ width: text.length * 12 }),
      };
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
        () => context as unknown as CanvasRenderingContext2D,
      );
      vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type) => {
        blobs.push(type);
        callback(new Blob(["png"], { type: "image/png" }));
      });
      URL.createObjectURL = vi.fn(() => "blob:test");
      URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("draws the three figures with their sources and saves them as a PNG", async () => {
      const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
      renderWithI18n(
        <DayCardDialog
          open
          onClose={vi.fn()}
          live={PRICED}
          storage={STORAGE}
          now={NOW}
          dataBaseUrl={new URL("https://data.test/")}
        />,
      );

      const picture = screen.getByRole("img");
      // the hour is written in the reader's own time zone (L-073): match it, do not spell it
      expect(picture).toHaveAccessibleName(
        /^GridAtlas: Energetska slika dana\. Hrvatska · 16\. studenoga 2026\.: 69 % obnovljivi izvori u proizvodnji struje \(sat od \d\d:00, bez uvoza\); 100 €\/MWh prosječna cijena na burzi, dan unaprijed \(prosjek 24 sati tog dana\); 85 % popunjenost skladišta plina \(PSP Okoli, plinski dan 15\. studenoga 2026\.\)\. Izvori: ENTSO-E Transparency Platform; GIE AGSI · gridatlas\.eu$/,
      );
      expect(drawn).toEqual(
        expect.arrayContaining(["69", "100", "85", "€/MWh", "Hrvatska · 16. studenoga 2026."]),
      );
      expect(drawn.at(-1)).toBe("Izvori: ENTSO-E Transparency Platform; GIE AGSI · gridatlas.eu");
      expect(screen.getByText("Slobodno dijeljenje uz navođenje izvora: gridatlas.eu.")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Preuzmi sliku (PNG)" }));
      expect(blobs).toEqual(["image/png"]);
      expect(clicked).toHaveBeenCalledTimes(1);
    });

    it("offers an upright picture for a story, saved under its own name", async () => {
      const names: string[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(
        this: HTMLAnchorElement,
      ) {
        names.push(this.download);
      });
      renderWithI18n(
        <DayCardDialog
          open
          onClose={vi.fn()}
          live={PRICED}
          storage={STORAGE}
          now={NOW}
          dataBaseUrl={new URL("https://data.test/")}
        />,
      );
      const picture = screen.getByRole("img");
      expect(picture).toHaveAttribute("width", "1200");
      expect(screen.getByRole("radio", { name: "Vodoravna" })).toBeChecked();

      drawn.length = 0;
      await userEvent.click(screen.getByRole("radio", { name: "Okomita" }));
      expect(picture).toHaveAttribute("width", "1080");
      expect(picture).toHaveAttribute("height", "1920");
      // the same words, drawn again for the new shape
      expect(drawn).toEqual(expect.arrayContaining(["69", "100", "85", "€/MWh"]));
      expect(drawn.join(" ")).toContain("gridatlas.eu");

      await userEvent.click(screen.getByRole("button", { name: "Preuzmi sliku (PNG)" }));
      expect(names).toEqual([expect.stringMatching(/^gridatlas-dan-hr-story-\d{4}-\d{2}-\d{2}\.png$/)]);
    });

    it("shows another country with the figures it has, and says so when it has none", async () => {
      renderWithI18n(
        <DayCardDialog
          open
          onClose={vi.fn()}
          live={PRICED}
          storage={null}
          now={NOW}
          dataBaseUrl={new URL("https://data.test/")}
        />,
      );
      // Croatia was drawn first, with its price: only what is drawn from here on counts
      drawn.length = 0;
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Zemlja" }), "SI");
      // nuclear 700 and hydro 100 MW: 13 % renewable; no price average, no storage: one figure, one source
      expect(screen.getByRole("img")).toHaveAccessibleName(
        /Slovenija · 16\. studenoga 2026\.: 13 % obnovljivi/,
      );
      expect(screen.getByRole("img")).toHaveAccessibleName(
        /Izvor: ENTSO-E Transparency Platform · gridatlas\.eu$/,
      );
      expect(drawn).not.toContain("€/MWh");
    });

    it("says that there is nothing fresh instead of drawing an old picture", () => {
      renderWithI18n(
        <DayCardDialog
          open
          onClose={vi.fn()}
          live={PRICED}
          storage={STORAGE}
          now={new Date("2026-11-16T20:30:00+01:00")}
          dataBaseUrl={new URL("https://data.test/")}
        />,
      );
      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Za ovu zemlju trenutačno nema svježih podataka o proizvodnji.",
      );
      expect(screen.queryByRole("button", { name: "Preuzmi sliku (PNG)" })).toBeNull();
    });
  });
});
