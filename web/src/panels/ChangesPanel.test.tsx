import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, renderWithI18n } from "../test/render";
import { ChangesPanel } from "./ChangesPanel";

const empty = { added: [], changed: [], removed: [] };
const diff = {
  version: 1,
  buildId: "20260919T074428Z",
  baselineBuildId: "20260912T030000Z",
  layers: {
    plants: {
      added: 1,
      changed: 1,
      removed: 0,
      unchanged: 5,
      byCountry: { HR: { added: 1, changed: 1 } },
      examples: {
        ...empty,
        added: [{ id: "osm:way/109", name: "RHE Primjer", lon: 16.51, lat: 45.81 }],
        changed: [{ id: "gem:L1:planned", name: null }],
      },
    },
    lines: {
      added: 0,
      changed: 0,
      removed: 1,
      unchanged: 3,
      byCountry: { SI: { removed: 1 } },
      examples: { ...empty, removed: [{ id: "osm:way/999", name: "Stari vod", lon: 15.6, lat: 45.4 }] },
    },
    substations: { added: 0, changed: 0, removed: 0, unchanged: 2, byCountry: {}, examples: empty },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChangesPanel", () => {
  it("summarises the report and lets the reader jump to an example", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(diff)));
    const onLocate = vi.fn();
    const user = userEvent.setup();
    renderWithI18n(<ChangesPanel diffUrl="https://d.test/diff.json" onLocate={onLocate} />);

    expect(await screen.findByText("Promjene od prošle objave")).toBeInTheDocument();
    expect(screen.getByText("Uspoređeno s podacima od 12. rujna 2026.")).toBeInTheDocument();
    // quiet layers are not listed; busy ones are, with the OSM link where the id allows one
    expect(screen.queryByRole("region", { name: "Trafostanice" })).toBeNull();
    const plants = screen.getByRole("region", { name: "Elektrane" });
    expect(within(plants).getByText("5 bez promjene")).toBeInTheDocument();
    expect(within(plants).getByRole("link", { name: "RHE Primjer" })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/way/109",
    );
    // an example without a point cannot be located; one without a name is still shown
    expect(within(plants).getByText("Bez imena")).toBeInTheDocument();
    expect(within(plants).getAllByRole("button", { name: /Prikaži na karti/ })).toHaveLength(1);

    await user.click(within(plants).getByRole("button", { name: "Prikaži na karti: RHE Primjer" }));
    expect(onLocate).toHaveBeenCalledWith({ id: "osm:way/109", layer: "plants", lon: 16.51, lat: 45.81 });

    // a removed feature is only a place now: no id to select
    const lines = screen.getByRole("region", { name: "Dalekovodi i kabeli" });
    await user.click(within(lines).getByRole("button", { name: "Prikaži na karti: Stari vod" }));
    expect(onLocate).toHaveBeenLastCalledWith({ id: null, layer: "lines", lon: 15.6, lat: 45.4 });
  });

  it("explains a first publication and a failed load", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...diff, baselineBuildId: null })));
    renderWithI18n(<ChangesPanel diffUrl="https://d.test/diff.json" onLocate={vi.fn()} />);
    expect(await screen.findByText("Prva objava: sve je novo.")).toBeInTheDocument();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    renderWithI18n(<ChangesPanel diffUrl="https://d.test/other.json" onLocate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Popis promjena nije dostupan.");
  });
});
