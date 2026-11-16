import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_FIXTURE } from "../data/current.test";
import type { Selection } from "../map/selection";
import { routeFetch } from "../test/render";
import { App } from "./App";

// The real map needs WebGL; e2e tests cover it. Here a stand-in reports what the shell asked for.
const mapProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("../map/MapView", () => ({
  MapView: (props: Record<string, unknown> & { onSelect: (s: Selection | null) => void }) => {
    mapProps.current = props;
    return (
      <button
        type="button"
        onClick={() => {
          props.onSelect({
            id: "osm:node/50",
            sources: ["openstreetmap"],
            gemUrl: null,
            kind: "substation",
            status: "operating",
            operator: "HOPS",
            name: "TS Žerjavinec",
            voltagesKv: [400, 110],
            maxVoltageKv: 400,
            country: "HR",
          });
        }}
      >
        fake map
      </button>
    );
  },
}));

const config = { dataBaseUrl: new URL("https://podaci.test/"), maptilerKey: null, support: false };
const STATS = {
  version: 1,
  voltageClasses: ["380+", "220-379", "110-219", "60-109", "unknown"],
  note: "OSM",
  plants: {},
  substations: {},
  lineKm: {},
};
// the welcome card asks whether live flows are published; this build has none (404)
const ROUTES = { "/live/current.json": null, "/current.json": CURRENT_FIXTURE, "/stats.json": STATS };

beforeEach(() => {
  mapProps.current = null;
  Object.defineProperty(navigator, "languages", { value: ["hr-HR"], configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("loads the data pointer and hands resolved tile URLs to the map", async () => {
    vi.stubGlobal("fetch", vi.fn(routeFetch(ROUTES)));
    render(<App config={config} />);
    expect(screen.getByRole("status")).toHaveTextContent("Učitavanje podataka…");
    // the first test of the file also pays for loading the whole application: the default second is too short
    expect(await screen.findByRole("button", { name: "fake map" }, { timeout: 5000 })).toBeInTheDocument();
    expect(mapProps.current?.tiles).toEqual({
      grid: "https://podaci.test/builds/20260916T120000Z/grid.pmtiles",
      boundaries: "https://podaci.test/builds/20260916T120000Z/boundaries.pmtiles",
      gridMaxZoom: 14,
      boundariesMaxZoom: 8,
    });
    expect(screen.getByText("Podaci od 16. rujna 2026.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preuzmi bazu" })); // the downloads are in a menu
    expect(screen.getByRole("link", { name: "Elektrane" })).toHaveAttribute(
      "href",
      "https://podaci.test/builds/20260916T120000Z/plants.ndjson.gz",
    );
    expect(document.documentElement.lang).toBe("hr");
  });

  it("shows a retryable error when data cannot be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockImplementation(routeFetch(ROUTES));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App config={config} />);
    expect(await screen.findByRole("heading", { name: "Podaci se nisu učitali" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pokušaj ponovno" }));
    expect(await screen.findByRole("button", { name: "fake map" })).toBeInTheDocument();
  });

  it("keeps the selection in the URL and shows its details", async () => {
    vi.stubGlobal("fetch", vi.fn(routeFetch(ROUTES)));
    const user = userEvent.setup();
    render(<App config={config} />);
    await user.click(await screen.findByRole("button", { name: "fake map" }));
    // the substation's layer is off by default: selecting it switches the layer on, and the link says so
    expect(window.location.search).toBe("?l=lines%2Csubstations&sel=osm%3Anode%2F50");
    expect(screen.getByRole("heading", { name: "TS Žerjavinec" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Zatvori detalje" }));
    expect(window.location.search).toBe("?l=lines%2Csubstations");
    expect(screen.queryByRole("heading", { name: "TS Žerjavinec" })).not.toBeInTheDocument();
  });

  it("switches language and remembers it in the URL", async () => {
    vi.stubGlobal("fetch", vi.fn(routeFetch(ROUTES)));
    const user = userEvent.setup();
    render(<App config={config} />);
    await user.click(await screen.findByRole("button", { name: "Switch to English" }));
    await waitFor(() => {
      expect(document.documentElement.lang).toBe("en");
    });
    // the language is the path now (/en/), not a query parameter
    expect(window.location.pathname).toBe("/en/");
    expect(window.location.search).toBe("");
    expect(screen.getByRole("tab", { name: "Filters" })).toHaveAttribute("aria-selected", "true");
    expect(document.title).toBe(
      "GridAtlas – regional energy map: power plants, transmission lines and substations of Croatia and the region",
    );
  });

  it("switches panels with arrow keys", async () => {
    vi.stubGlobal("fetch", vi.fn(routeFetch(ROUTES)));
    const user = userEvent.setup();
    render(<App config={config} />);
    const filters = await screen.findByRole("tab", { name: "Filtri" });
    filters.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Pregled" })).toHaveFocus();
    expect(window.location.search).toBe("?panel=overview");
  });
});
