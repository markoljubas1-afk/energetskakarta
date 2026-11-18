import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GREEN_LIVE } from "../data/greenShare.fixture";
import { compare, householdPower, type Households } from "../data/households";
import { usualFor, type Usual } from "../data/usual";
import { renderWithI18n } from "../test/render";
import { GreenLight } from "./GreenLight";

/** Croatia's latest reported hour is 09:00 to 10:00: hydro 600 + wind 300 of 1300 MW, 69 %. */
const SOON_AFTER = new Date("2026-11-16T11:20:00+01:00");

const show = (now: Date, onShow = vi.fn()) =>
  renderWithI18n(<GreenLight live={GREEN_LIVE} now={now} onShow={onShow} learnHref="/edukacija/" />);

describe("GreenLight", () => {
  it("says the share with a colour, what it is of, and how it compares with yesterday", async () => {
    show(SOON_AFTER);
    const pill = screen.getByRole("button", {
      name: "Udio obnovljivih u proizvodnji struje, Hrvatska: 69 %",
    });
    expect(pill).toHaveTextContent("HR 69 %");
    expect(pill.querySelector("[data-state]")).toHaveAttribute("data-state", "high");
    await userEvent.click(pill);
    const card = document.querySelector("[data-green]");
    if (!(card instanceof HTMLElement)) throw new Error("the card is in the document");
    expect(card).toHaveAttribute("data-green", "high");
    expect(card).toHaveTextContent("69 %proizvodnje je iz obnovljivih izvora");
    expect(card).toHaveTextContent("Najviše proizvodiHidro, 600 MW");
    // yesterday 09:00 it was 700 of 1100 MW, 64 %: six points more today
    expect(card).toHaveTextContent("Jučer u isto vrijemedanas 6 post. bodova više");
    expect(card).toHaveTextContent("uvoz i izvoz nisu uračunati");
    expect(card).toHaveTextContent("Zeleno je od 65 %, žuto od 35 %");
    expect(within(card).getByRole("link", { name: "Zašto je to važno?" })).toHaveAttribute(
      "href",
      "/edukacija/",
    );
  });

  it("shows on the map what generates the most, in the chosen country", async () => {
    const onShow = vi.fn();
    show(SOON_AFTER, onShow);
    await userEvent.click(screen.getByRole("button", { name: /Hrvatska: 69 %/ }));
    await userEvent.click(screen.getByRole("button", { name: "Pokaži na karti: hidro" }));
    expect(onShow).toHaveBeenCalledWith("HR", "hydro");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Zemlja" }), "SI");
    // Slovenia: 100 MW of hydro out of 800, the rest nuclear
    expect(screen.getByRole("button", { name: /Slovenija: 13 %/ })).toHaveTextContent("SI 13 %");
    expect(document.querySelector("[data-green]")).toHaveAttribute("data-green", "low");
    await userEvent.click(screen.getByRole("button", { name: "Pokaži na karti: nuklearna" }));
    expect(onShow).toHaveBeenLastCalledWith("SI", "nuclear");
  });

  it("takes the colour away when the figure is too old to speak for now", () => {
    // seven hours after the hour ended
    show(new Date("2026-11-16T17:10:00+01:00"));
    const card = document.querySelector("[data-green]");
    expect(card).toHaveAttribute("data-green", "stale");
    expect(card).toHaveTextContent("Podatak je prestar da bi govorio o ovom trenutku");
    expect(card).toHaveTextContent("prije 7 h");
    expect(
      screen.getByRole("button", { name: /Hrvatska: 69 %/ }).querySelector("[data-state]"),
    ).toHaveAttribute("data-state", "stale");
  });

  it("is not there when no country has reported generation", () => {
    const { container } = renderWithI18n(
      <GreenLight
        live={{ ...GREEN_LIVE, generation: {} }}
        now={SOON_AFTER}
        onShow={vi.fn()}
        learnHref="/edukacija/"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("puts the hour's exchange price next to the share, and says so when it is zero or below", async () => {
    // Croatia's hour is index 33 in the fixture; give it a price, first a positive one
    const priced = (eur: number) => {
      const eurPerMwh: (number | null)[] = GREEN_LIVE.hours.map(() => null);
      eurPerMwh[33] = eur;
      return { ...GREEN_LIVE, prices: { HR: { zone: "10YHR-HEP------M", eurPerMwh } } };
    };
    const view = renderWithI18n(
      <GreenLight live={priced(84.5)} now={SOON_AFTER} onShow={vi.fn()} learnHref="/edukacija/" />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Hrvatska: 69 %/ }));
    const card = (): HTMLElement => {
      const found = document.querySelector("[data-green]");
      if (!(found instanceof HTMLElement)) throw new Error("the card is in the document");
      return found;
    };
    expect(card()).toHaveTextContent("Cijena na burzi (dan unaprijed)84,5 €/MWh");
    expect(within(card()).queryByRole("note")).not.toBeInTheDocument();
    view.unmount();

    renderWithI18n(
      <GreenLight live={priced(-3.2)} now={SOON_AFTER} onShow={vi.fn()} learnHref="/edukacija/" />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Hrvatska: 69 %/ }));
    expect(card()).toHaveTextContent("−3,2 €/MWh");
    const note = within(card()).getByRole("note");
    expect(note).toHaveTextContent(/ne stoji ništa ili se onome tko je uzme još i plaća/);
    expect(within(note).getByRole("link", { name: "Zašto cijena može biti negativna?" })).toHaveAttribute(
      "href",
      "/edukacija/",
    );
  });

  describe("what the megawatts mean", () => {
    /** Invented: Croatia's households used 6,570 GWh in 2023 (750 MW on average) and nothing is known for 2024. */
    const HOUSEHOLDS: Households = {
      version: 1,
      dataset: "nrg_d_hhq",
      source: "Eurostat",
      sourceUrl: "https://ec.europa.eu/eurostat/databrowser/view/nrg_d_hhq/default/table",
      license: "CC-BY-4.0",
      unit: "GWh",
      updated: null,
      retrievedAt: "2026-11-17T14:00:00+00:00",
      years: [2022, 2023, 2024],
      series: { HR: [6400, 6570, null], SI: [3000, 3100, 8784] },
      missing: [],
    };

    it("turns a year's use into the average power, with the hours of that very year", () => {
      expect(householdPower(HOUSEHOLDS, "HR")).toEqual({ year: 2023, mw: 750 });
      // 2024 is a leap year: 8,784 GWh over 8,784 hours is 1,000 MW
      expect(householdPower(HOUSEHOLDS, "SI")).toEqual({ year: 2024, mw: 1000 });
      expect(householdPower(HOUSEHOLDS, "IT")).toBeNull();
      expect(compare(HOUSEHOLDS, "HR", 900)?.ratio).toBeCloseTo(1.2, 6);
    });

    it("holds the renewable megawatts against what households use on average, and names the source", async () => {
      // Croatia's hour: 900 MW from renewables, 1.2 times the households' 750 MW
      renderWithI18n(
        <GreenLight
          live={GREEN_LIVE}
          now={SOON_AFTER}
          onShow={vi.fn()}
          learnHref="/edukacija/"
          households={HOUSEHOLDS}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /Hrvatska: 69 %/ }));
      const card = document.querySelector("[data-green]");
      expect(card).toHaveTextContent(
        "Obnovljivi izvori sada daju 900 MW: 1,2 puta više nego što sva kućanstva u zemlji troše u prosjeku (750 MW, 2023.).",
      );
      expect(screen.getByRole("link", { name: "Eurostat" })).toHaveAttribute("href", HOUSEHOLDS.sourceUrl);

      // Slovenia's 100 MW of renewables are a tenth of its households' 1,000 MW: a share, not "times"
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Zemlja" }), "SI");
      expect(document.querySelector("[data-green]")).toHaveTextContent(
        /Obnovljivi izvori sada daju \d+ MW: \d+ % onoga što sva kućanstva u zemlji troše u prosjeku \(1\.000 MW, 2024\.\)/,
      );
    });

    it("says nothing without the yardstick", async () => {
      renderWithI18n(
        <GreenLight live={GREEN_LIVE} now={SOON_AFTER} onShow={vi.fn()} learnHref="/edukacija/" />,
      );
      await userEvent.click(screen.getByRole("button", { name: /Hrvatska: 69 %/ }));
      expect(document.querySelector("[data-green]")).not.toHaveTextContent(/kućanstva u zemlji/);
    });
  });

  describe("what is usual for the country", () => {
    /** Invented quartiles: Croatia's days mostly between 61 and 80 %, Slovenia's between 28 and 43 %. */
    const USUAL: Usual = {
      version: 1,
      generatedAt: "2026-11-17T06:00:00+00:00",
      source: "ENTSO-E Transparency Platform",
      from: "2025-11-15",
      to: "2026-11-14",
      windowDays: 365,
      countries: {
        HR: { low: 0.6054, median: 0.6758, high: 0.8011, days: 365 },
        SI: { low: 0.2762, median: 0.349, high: 0.4334, days: 365 },
      },
      missing: [],
    };

    it("places a share against the range as both are shown, in whole percents", () => {
      expect(usualFor(USUAL, "HR", 0.69)).toEqual({ low: 0.6054, high: 0.8011, against: "within" });
      expect(usualFor(USUAL, "HR", 0.806)?.against).toBe("above");
      // 80.4 % is shown as 80 %, like the upper end: not "above"
      expect(usualFor(USUAL, "HR", 0.804)?.against).toBe("within");
      expect(usualFor(USUAL, "HR", 0.4)?.against).toBe("below");
      expect(usualFor(USUAL, "IT", 0.5)).toBeNull();
    });

    it("says the country's own range next to the fixed colour, and where the hour stands", async () => {
      renderWithI18n(
        <GreenLight
          live={GREEN_LIVE}
          now={SOON_AFTER}
          onShow={vi.fn()}
          learnHref="/edukacija/"
          usual={USUAL}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /Hrvatska: 69 %/ }));
      const card = (): Element | null => document.querySelector("[data-green]");
      expect(card()).toHaveTextContent(
        "Uobičajeno za Hrvatsku: u polovici dana zadnjih godinu dana dnevni udio bio je između 61 i 80 %. Ovaj sat je unutar toga.",
      );
      // the colour is still the fixed scale: 69 % is green in every country
      expect(card()).toHaveAttribute("data-green", "high");
      // Slovenia's 13 % is red on the fixed scale, and below what is usual for Slovenia too
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Zemlja" }), "SI");
      expect(card()).toHaveAttribute("data-green", "low");
      expect(card()).toHaveTextContent(
        /Uobičajeno za Sloveniju: .* između 28 i 43 %\. Ovaj sat je ispod toga\./,
      );
    });

    it("says nothing about usual for an old figure or without the yardstick", async () => {
      const view = renderWithI18n(
        <GreenLight
          live={GREEN_LIVE}
          now={new Date("2026-11-16T20:30:00+01:00")}
          onShow={vi.fn()}
          learnHref="/edukacija/"
          usual={USUAL}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /Hrvatska: 69 %/ }));
      expect(document.querySelector("[data-green]")).not.toHaveTextContent(/Uobičajeno za/);
      view.unmount();
      renderWithI18n(
        <GreenLight live={GREEN_LIVE} now={SOON_AFTER} onShow={vi.fn()} learnHref="/edukacija/" />,
      );
      await userEvent.click(screen.getByRole("button", { name: /Hrvatska: 69 %/ }));
      expect(document.querySelector("[data-green]")).not.toHaveTextContent(/Uobičajeno za/);
    });
  });

  describe("carbon footprint", () => {
    it("gives the calculated figure with what it is, and shows the fossil plants behind it", async () => {
      const onShowFossil = vi.fn();
      renderWithI18n(
        <GreenLight
          live={GREEN_LIVE}
          now={SOON_AFTER}
          onShow={vi.fn()}
          onShowFossil={onShowFossil}
          learnHref="/edukacija/"
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /Hrvatska: 69 %/ }));
      const card = document.querySelector("[data-green]");
      if (!(card instanceof HTMLElement)) throw new Error("the card is in the document");
      // hydro 600, wind 300, gas 300 MW: 137 g, shown to the nearest ten
      expect(card).toHaveTextContent("Ugljični otisak proizvodnje (izračun)oko 140 g CO₂/kWh");
      expect(card).toHaveTextContent("Kako je otisak izračunat i što nije uračunato");
      expect(card).toHaveTextContent("Ugljični otisak je izračun, nije mjerenje");
      expect(card).toHaveTextContent("vjerojatno podcijenjen");
      expect(within(card).getByRole("link", { name: /IPCC AR5/ })).toHaveAttribute(
        "href",
        expect.stringContaining("ipcc.ch"),
      );
      await userEvent.click(within(card).getByRole("button", { name: "Pokaži elektrane u pogonu: plin" }));
      expect(onShowFossil).toHaveBeenCalledWith("HR", ["gas"]);
    });

    it("offers no fossil plants where none generated", async () => {
      renderWithI18n(
        <GreenLight
          live={GREEN_LIVE}
          now={SOON_AFTER}
          onShow={vi.fn()}
          onShowFossil={vi.fn()}
          learnHref="/edukacija/"
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /Hrvatska: 69 %/ }));
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Zemlja" }), "SI");
      const card = document.querySelector("[data-green]");
      if (!(card instanceof HTMLElement)) throw new Error("the card is in the document");
      // nuclear 700 and hydro 100 MW: (700 × 12 + 100 × 24) / 800 = 13.5 g
      expect(card).toHaveTextContent("oko 10 g CO₂/kWh");
      expect(within(card).queryByRole("button", { name: /Pokaži elektrane u pogonu/ })).toBeNull();
    });
  });
});
