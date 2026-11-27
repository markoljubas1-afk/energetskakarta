import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultState, type AppState } from "../state/url";
import { renderWithI18n, routeFetch } from "../test/render";
import { EnergyView, groupOf } from "./EnergyView";

// Chart.js needs a real canvas; the charts only receive props here
vi.mock("./charts", () => ({
  StackedChart: (props: { labels: string[]; description: string }) => (
    <div role="img" aria-label={props.description} data-labels={props.labels.join("|")} />
  ),
  LinesChart: (props: { lines: { label: string }[]; description: string }) => (
    <div role="img" aria-label={props.description} data-lines={props.lines.map((l) => l.label).join("|")} />
  ),
}));

const BASE = new URL("https://data.test/");
const blob = (key: string) => ({ key, sha256: "0".repeat(64), bytes: 1 });
const POINTER = {
  version: 1,
  updatedAt: "2026-09-16T05:30:00+00:00",
  unit: "MWh",
  timezone: "Europe/Zagreb",
  countries: ["HR"],
  years: { "2025": blob("energy/daily/2025-aaaaaaaaaaaa.json") },
  periods: blob("energy/periods-bbbbbbbbbbbb.json"),
};
const months = ["2025-01", "2025-02", "2025-03"];
const PERIODS = {
  version: 1,
  unit: "MWh",
  countries: {
    HR: {
      months: {
        periods: months,
        generation: { hydro: [12_000, 11_000, 9_000], solar: [800, 900, null] },
        consumption: {},
        load: [20_000, 19_000, 12_000],
        coverage: { generation: [1, 1, 0.6129], load: [1, 1, 0.6129] },
      },
      years: {
        periods: ["2025"],
        generation: { hydro: [32_000], solar: [1_700] },
        consumption: {},
        load: [51_000],
        coverage: { generation: [0.8], load: [0.8] },
      },
    },
  },
};
const days = ["2025-06-01", "2025-06-02"];
const YEAR = {
  version: 1,
  year: 2025,
  unit: "MWh",
  days,
  countries: {
    HR: {
      generation: { hydro: [400, 400], solar: [100, 100] },
      consumption: { pumped_storage: [20, 20] },
      load: [1_000, 1_000],
      coverage: { generation: [1, 1], load: [1, 1] },
    },
  },
};

function Harness({ initial, embed = false }: { initial?: Partial<AppState["energy"]>; embed?: boolean }) {
  const [state, setState] = useState<AppState>(() => {
    const base = defaultState("hr");
    return { ...base, page: "energy", energy: { ...base.energy, ...initial } };
  });
  return (
    <EnergyView
      dataBaseUrl={BASE}
      energy={state.energy}
      setState={(update) => {
        setState(update);
      }}
      theme="light"
      embed={embed}
    />
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("source groups", () => {
  it("puts every source in exactly one group: renewable, fossil, nuclear, or storage and other", () => {
    expect(groupOf("wind")).toBe("renewable");
    expect(groupOf("hydro")).toBe("renewable");
    expect(groupOf("lignite")).toBe("fossil");
    expect(groupOf("gas")).toBe("fossil");
    expect(groupOf("nuclear")).toBe("nuclear");
    // pumped storage returns electricity it took, so it is not counted as renewable
    expect(groupOf("pumped_storage")).toBe("other");
    expect(groupOf("battery")).toBe("other");
  });
});

describe("EnergyView", () => {
  it("says so when nothing is published yet", async () => {
    vi.stubGlobal("fetch", vi.fn(routeFetch({})));
    renderWithI18n(<Harness />);
    expect(await screen.findByText(/još nisu objavljeni/)).toBeInTheDocument();
  });

  it("offers a retry when the data fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("", { status: 500 }))),
    );
    renderWithI18n(<Harness />);
    expect(await screen.findByRole("alert")).toHaveTextContent("nisu učitali");
  });

  it("draws the monthly mix and compares years", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(routeFetch({ "energy/current.json": POINTER, "periods-bbbbbbbbbbbb.json": PERIODS })),
    );
    renderWithI18n(<Harness />);
    const mix = await screen.findByRole("img", { name: /Složeni stupci/ });
    expect(mix.dataset.labels?.split("|")).toHaveLength(3);
    // exactly one full stop after the date
    expect(screen.getByText(/Ažurirano: 16\. rujna 2026\.(?!\.)/)).toBeInTheDocument();
    const compare = screen.getByRole("img", { name: /Crte po godinama/ });
    expect(compare.dataset.lines).toBe("2025");
  });

  it("shows the sources of the latest complete month as a ring, and of a chosen month", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(routeFetch({ "energy/current.json": POINTER, "periods-bbbbbbbbbbbb.json": PERIODS })),
    );
    renderWithI18n(<Harness />);
    // March is 61 % reported: the card opens on February
    const ring = await screen.findByRole("img", { name: /Prstenasti grafikon/ });
    expect(ring).toHaveAccessibleName(
      /^Prstenasti grafikon udjela izvora u proizvodnji za Sve zemlje s podacima, velj 2025\.: Hidro 92,4\s%, Sunčana 7,6\s%\.$/,
    );
    const card = screen.getByRole("region", { name: "Udio izvora u proizvodnji" });
    expect(card).toHaveTextContent(/Proizvedeno: 11,9 GWh\. Potrošnja: 19 GWh\./);
    // beside the ring (Faza 55-1): the groups of the periods up to the ring's own, oldest first
    const groups = await within(card).findByRole("img", { name: /^Udio obnovljivih, fosilnih i nuklearnih/ });
    expect(groups).toHaveAccessibleName(/za Sve zemlje s podacima, 2 razdoblja do velj 2025\.\.?$/);
    expect(groups).toHaveAttribute("data-labels", "sij 2025.|velj 2025.");
    // an incomplete month can be looked at, and says that it is incomplete; its load is not shown
    await userEvent.selectOptions(within(card).getByLabelText("Razdoblje"), "2025-03");
    expect(screen.getByRole("img", { name: /Prstenasti grafikon/ })).toHaveAccessibleName(
      /ožu 2025\.: Hidro 100\s%\.$/,
    );
    expect(card).toHaveTextContent(/Proizvedeno: 9 GWh\. Nepotpuno: podaci za 61 % razdoblja\./);
    expect(within(card).queryByText(/Potrošnja:/)).toBeNull();
  });

  it("shows the same numbers as a table, with incomplete months marked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(routeFetch({ "energy/current.json": POINTER, "periods-bbbbbbbbbbbb.json": PERIODS })),
    );
    renderWithI18n(<Harness />);
    await userEvent.click(await screen.findByRole("button", { name: "Tablica" }));
    const table = screen.getAllByRole("table")[0];
    if (!table) throw new Error("table missing");
    const march = within(table).getByRole("row", { name: /ožu 2025/ });
    expect(march).toHaveAttribute("data-incomplete", "true");
    expect(within(march).getByText("nema podataka")).toBeInTheDocument(); // solar gap is not zero
    expect(within(march).getByText("61,3 %")).toBeInTheDocument();
  });

  it("totals a chosen range with shares of load", async () => {
    const fetchMock = vi.fn(
      routeFetch({
        "energy/current.json": POINTER,
        "periods-bbbbbbbbbbbb.json": PERIODS,
        "daily/2025-aaaaaaaaaaaa.json": YEAR,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWithI18n(<Harness initial={{ area: "HR" }} />);
    await screen.findByRole("img", { name: /Složeni stupci/ });
    const from = screen.getByLabelText("Od");
    const to = screen.getByLabelText("Do");
    await userEvent.clear(from);
    await userEvent.type(from, "2025-06-01");
    await userEvent.clear(to);
    await userEvent.type(to, "2025-06-02");
    await userEvent.click(screen.getByRole("button", { name: "Izračunaj" }));

    const status = await screen.findByText("Podaci za 2 od 2 dana.");
    expect(status).toBeInTheDocument();
    const hydro = screen.getByRole("row", { name: /^Hidro/ });
    expect(hydro).toHaveTextContent("800 MWh");
    expect(hydro).toHaveTextContent("80 %"); // of generation
    expect(hydro).toHaveTextContent("40 %"); // of load
    expect(screen.getByRole("row", { name: /Pumpanje/ })).toHaveTextContent("40 MWh");
    // daily files are only requested once a range is chosen
    const requested = fetchMock.mock.calls.map(([input]) =>
      input instanceof Request ? input.url : input.toString(),
    );
    expect(requested.filter((url) => url.includes("daily/"))).toHaveLength(1);
  });

  it("refuses an inverted range", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(routeFetch({ "energy/current.json": POINTER, "periods-bbbbbbbbbbbb.json": PERIODS })),
    );
    renderWithI18n(<Harness />);
    const from = await screen.findByLabelText("Od");
    await userEvent.clear(from);
    await userEvent.type(from, "2025-12-01");
    expect(screen.getByRole("button", { name: "Izračunaj" })).toBeDisabled();
    expect(screen.getByText(/Početak mora biti prije kraja/)).toBeInTheDocument();
  });

  it("falls back to the region when the chosen country has no data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(routeFetch({ "energy/current.json": POINTER, "periods-bbbbbbbbbbbb.json": PERIODS })),
    );
    renderWithI18n(<Harness initial={{ area: "AT" }} />);
    const select = await screen.findByLabelText("Područje");
    await waitFor(() => {
      expect(select).toHaveValue("ALL");
    });
    expect(within(select).queryByRole("option", { name: "Austrija" })).not.toBeInTheDocument();
  });

  it("lets every card be passed on: its own source line, a link to it, and a citation (Faza 23)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(routeFetch({ "energy/current.json": POINTER, "periods-bbbbbbbbbbbb.json": PERIODS })),
    );
    // user-event stubs the clipboard, so what was copied can be read back
    const user = userEvent.setup();
    renderWithI18n(<Harness />);
    await screen.findByRole("img", { name: /Složeni stupci/ });
    const card = screen.getByRole("region", { name: "Proizvodnja po izvoru i potrošnja" });
    expect(card).toHaveAttribute("id", "mix");
    // a screenshot of the card alone still names the source and the site
    expect(
      within(card).getByText(/^Izvor: ENTSO-E Transparency Platform · stanje 16\. rujna 2026\. · /),
    ).toBeInTheDocument();
    await user.click(within(card).getByText("Podijeli"));
    await user.click(within(card).getByRole("button", { name: "Kopiraj poveznicu na graf" }));
    expect(await navigator.clipboard.readText()).toMatch(/#mix$/);
    await user.click(within(card).getByRole("button", { name: "Citiraj" }));
    expect(
      within(card).getByText(
        /^Izvor: GridAtlas \(.+\), prema podacima ENTSO-E Transparency Platform; stanje 16\. rujna 2026\.$/,
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText(/\[Skup podataka\]\. Preuzeto /)).toBeInTheDocument();
  });

  it("shows one card alone when embedded with ec, with a link to the full view and nothing to share", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(routeFetch({ "energy/current.json": POINTER, "periods-bbbbbbbbbbbb.json": PERIODS })),
    );
    renderWithI18n(<Harness embed initial={{ chart: "compare" }} />);
    await screen.findByRole("img", { name: /Crte po godinama/ });
    expect(screen.queryByRole("img", { name: /Složeni stupci/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Podijeli:/)).not.toBeInTheDocument();
    const full = screen.getByRole("link", { name: /Otvori cijeli prikaz/ });
    expect(full.getAttribute("href")).toMatch(/#compare$/);
    expect(full.getAttribute("href")).not.toMatch(/embed=1/);
  });
});

describe("Croatia's half of Krško", () => {
  // Slovenia's nuclear: 480 MWh in February, 600 MWh over the two June days
  const nuclear = (values: number[], coverage: number[]) => ({
    generation: { nuclear: values },
    consumption: {},
    load: values.map(() => 1),
    coverage: { generation: coverage, load: coverage },
  });
  const WITH_SI = {
    ...PERIODS,
    countries: {
      ...PERIODS.countries,
      SI: {
        months: { periods: months, ...nuclear([500, 480, 300], [1, 1, 0.6]) },
        years: { periods: ["2025"], ...nuclear([1_280], [0.8]) },
      },
    },
  };
  const YEAR_SI = { ...YEAR, countries: { ...YEAR.countries, SI: nuclear([300, 300], [1, 1]) } };
  const stub = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(
        routeFetch({
          "energy/current.json": { ...POINTER, countries: ["HR", "SI"] },
          "periods-bbbbbbbbbbbb.json": WITH_SI,
          "daily/2025-aaaaaaaaaaaa.json": YEAR_SI,
        }),
      ),
    );

  it("says beside Croatia's ring how much of it is Croatia's half, with its share of consumption", async () => {
    stub();
    renderWithI18n(<Harness initial={{ area: "HR" }} />);
    await screen.findByRole("img", { name: /Prstenasti grafikon/ });
    const card = screen.getByRole("region", { name: "Udio izvora u proizvodnji" });
    // February: 240 MWh of 19 GWh consumed
    expect(card).toHaveTextContent(
      /Hrvatskoj pripada i polovica proizvodnje Nuklearne elektrane Krško, oko 240 MWh \(1,3\s%\spotrošnje\)\./,
    );
  });

  it("says nothing of the kind for the whole region, which holds both halves", async () => {
    stub();
    renderWithI18n(<Harness />);
    await screen.findByRole("img", { name: /Prstenasti grafikon/ });
    expect(screen.queryByText(/Krško/)).not.toBeInTheDocument();
  });

  it("says it under the totals of a chosen range", async () => {
    stub();
    renderWithI18n(<Harness initial={{ area: "HR", range: { from: "2025-06-01", to: "2025-06-02" } }} />);
    await screen.findByText("Podaci za 2 od 2 dana.");
    const card = screen.getByRole("region", { name: /Zbroj za odabrano razdoblje/ });
    // 300 MWh of the 2 000 MWh consumed
    expect(card).toHaveTextContent(/oko 300 MWh \(15\s%\spotrošnje\)\./);
  });
});
