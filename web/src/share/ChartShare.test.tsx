import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "../test/render";
import { composeChartPicture } from "./chartImage";
import { chartEmbedUrl, chartLink, ChartShare, type ChartShareProps } from "./ChartShare";

// jsdom draws nothing: the picture is checked for what it is given, and stops there
vi.mock("./chartImage", async (original) => ({
  ...(await original<typeof import("./chartImage")>()),
  composeChartPicture: vi.fn(() => {
    throw new Error("no canvas in jsdom");
  }),
}));

const props = (over: Partial<ChartShareProps> = {}): ChartShareProps => ({
  title: "Proizvodnja po izvoru i potrošnja",
  subtitle: "Hrvatska · mjesečno",
  anchor: "mix",
  sources: ["ENTSO-E Transparency Platform"],
  dataDate: "2026-11-14T06:00:00Z",
  sourceLine: "Izvor: ENTSO-E Transparency Platform · stanje 14. studenoga 2026. · karta.test",
  table: () => ({ header: ["Razdoblje", "Hidro (MWh)"], rows: [["2026-10", 1234.5]] }),
  canvas: () => null,
  embed: "mix",
  now: () => new Date("2026-11-15T10:00:00Z"),
  ...over,
});

/** The options live in a menu that is closed until its button is pressed. */
const openMenu = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "Podijeli: Proizvodnja po izvoru i potrošnja" }));
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chart links", () => {
  it("open the page as it is, at the card, never embedded", () => {
    expect(chartLink("https://karta.test/?p=energy&ea=HR&embed=1&ec=mix#x", "compare")).toBe(
      "https://karta.test/?p=energy&ea=HR#compare",
    );
    expect(chartEmbedUrl("https://karta.test/?p=energy&ea=HR#mix", "mix")).toBe(
      "https://karta.test/?p=energy&ea=HR&embed=1&ec=mix",
    );
  });
});

describe("ChartShare", () => {
  it("writes the card's note into the picture, under the chart", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const chart = document.createElement("canvas");
    renderWithI18n(<ChartShare {...props({ canvas: () => chart, note: "Hrvatskoj pripada i polovica…" })} />);
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Spremi sliku (PNG)" }));
    expect(vi.mocked(composeChartPicture)).toHaveBeenCalledWith(
      chart,
      expect.objectContaining({ note: "Hrvatskoj pripada i polovica…" }),
      expect.anything(),
      expect.any(Number),
    );
  });

  it("copies a link to the card and offers three ready citations", async () => {
    const writeClipboard = vi.fn(() => Promise.resolve());
    renderWithI18n(<ChartShare {...props({ writeClipboard })} />);
    openMenu();
    expect(screen.getByLabelText("Podijeli: Proizvodnja po izvoru i potrošnja")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Kopiraj poveznicu na graf" }));
    expect(writeClipboard).toHaveBeenCalledWith(expect.stringMatching(/#mix$/));
    expect(await screen.findByRole("status")).toHaveTextContent("Poveznica je kopirana.");

    await userEvent.click(screen.getByRole("button", { name: "Citiraj" }));
    expect(screen.getByText("Za objavu")).toBeInTheDocument();
    expect(
      screen.getByText(
        /^GridAtlas\. \(2026, 14\. studenoga\)\. Proizvodnja po izvoru i potrošnja: Hrvatska · mjesečno \[Skup podataka\]\. Preuzeto 15\. studenoga 2026\. s /,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/@misc\{energetskakarta2026,/)).toBeInTheDocument();
    const [first] = screen.getAllByRole("button", { name: "Kopiraj" });
    if (!first) throw new Error("no copy button");
    await userEvent.click(first);
    expect(writeClipboard).toHaveBeenLastCalledWith(expect.stringMatching(/^Izvor: GridAtlas/));
  });

  it("downloads the card's numbers as CSV, with a BOM so Excel reads č, ć and š", () => {
    const created: Blob[] = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => {
        created.push(blob);
        return "blob:test";
      }),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderWithI18n(<ChartShare {...props()} />);
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Preuzmi podatke (CSV)" }));
    expect(click).toHaveBeenCalledOnce();
    expect((click.mock.instances[0] as HTMLAnchorElement | undefined)?.download).toBe(
      "proizvodnja-po-izvoru-i-potrosnja-hrvatska-mjesecno-2026-11-15.csv",
    );
    expect(created[0]?.type).toBe("text/csv;charset=utf-8");
    // three bytes of BOM, then the rows
    expect(created[0]?.size).toBe(
      3 + new TextEncoder().encode("Razdoblje,Hidro (MWh)\r\n2026-10,1234.5\r\n").length,
    );
  });

  it("explains that a picture needs the chart view, and gives the embed code for the card alone", async () => {
    renderWithI18n(<ChartShare {...props()} />);
    openMenu();
    await userEvent.click(screen.getByRole("button", { name: "Spremi sliku (PNG)" }));
    expect(screen.getByRole("status")).toHaveTextContent("Slika je dostupna u prikazu grafa.");
    await userEvent.click(screen.getByRole("button", { name: "Ugradi graf" }));
    const code = screen.getByRole("textbox", { name: "Ugradi graf" });
    expect((code as HTMLTextAreaElement).value).toContain("embed=1&amp;ec=mix");
  });

  it("has no embed option for a card that cannot be embedded, and shows the text when copying fails", async () => {
    const writeClipboard = vi.fn(() => Promise.reject(new Error("denied")));
    renderWithI18n(<ChartShare {...props({ embed: null, writeClipboard })} />);
    openMenu();
    expect(screen.queryByRole("button", { name: "Ugradi graf" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Kopiraj poveznicu na graf" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Kopiranje nije uspjelo");
  });
});
