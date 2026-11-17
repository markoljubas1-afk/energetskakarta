import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GREEN_LIVE } from "../data/greenShare.fixture";
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
});
