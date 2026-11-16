import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { defaultState, parseState, serializeState, type AppState } from "../state/url";
import { renderWithI18n } from "../test/render";
import { LAYER_KEYS } from "../domain";
import { FiltersPanel, LAYER_GROUPS, resetFilters, toggled } from "./FiltersPanel";

function Harness({ initial, onState }: { initial: AppState; onState: (s: AppState) => void }) {
  const [state, setState] = useState(initial);
  return (
    <FiltersPanel
      state={state}
      theme="light"
      setState={(update) => {
        setState((s) => {
          const next = update(s);
          onState(next);
          return next;
        });
      }}
    />
  );
}

describe("FiltersPanel", () => {
  // the map opens on the lines alone; these tests are about the filters of layers that are switched on
  const WITH_PLANTS = "?l=lines%2Csubstations%2Cplants%2Cpipelines%2Cdatacenters";

  it("toggles layers, statuses, technologies and countries", async () => {
    let latest = parseState(WITH_PLANTS, "hr");
    const user = userEvent.setup();
    renderWithI18n(<Harness initial={latest} onState={(s) => (latest = s)} />);

    await user.click(screen.getByRole("checkbox", { name: /Trafostanice/ }));
    await user.click(screen.getByRole("button", { name: "Planirano" }));
    await user.click(screen.getByRole("button", { name: "Vjetar" }));
    await user.click(screen.getByRole("button", { name: "Slovenija" }));

    expect(serializeState(latest, "hr")).toBe(
      "?l=lines%2Cplants%2Cpipelines%2Cdatacenters&s=operating%2Cconstruction&t=hydro%2Cpumped_storage%2Csolar" +
        "%2Cnuclear%2Cgas%2Ccoal%2Clignite%2Coil%2Cbiomass%2Cgeothermal%2Cbattery%2Cother&c=SI",
    );
    expect(screen.getByRole("button", { name: "Slovenija" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Sve zemlje" })).toHaveAttribute("aria-pressed", "false");
  });

  it("selects none and then all technologies", async () => {
    let latest = parseState(WITH_PLANTS, "hr");
    const user = userEvent.setup();
    renderWithI18n(<Harness initial={latest} onState={(s) => (latest = s)} />);
    await user.click(screen.getByRole("button", { name: "Ništa" }));
    expect(latest.technologies.size).toBe(0);
    await user.click(screen.getByRole("button", { name: "Sve" }));
    expect(serializeState(latest, "hr")).toBe(WITH_PLANTS);
  });

  it("sets a minimum capacity", async () => {
    let latest = parseState(WITH_PLANTS, "hr");
    const user = userEvent.setup();
    renderWithI18n(<Harness initial={latest} onState={(s) => (latest = s)} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Najmanja snaga elektrane" }), "100");
    expect(latest.minMw).toBe(100);
  });

  it("disables plant-only filters when plants are hidden", () => {
    renderWithI18n(<Harness initial={parseState("?l=lines", "hr")} onState={() => undefined} />);
    expect(screen.getByRole("button", { name: "Vjetar" })).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("resets only filters and is disabled when there is nothing to reset", async () => {
    const initial = parseState("?v=45,15,6&t=wind&mw=10&sel=osm:node/1&panel=filters", "hr");
    let latest = initial;
    const user = userEvent.setup();
    renderWithI18n(<Harness initial={initial} onState={(s) => (latest = s)} />);
    const reset = screen.getByRole("button", { name: "Poništi filtre" });
    await user.click(reset);
    expect(serializeState(latest, "hr")).toBe("?v=45.0000%2C15.0000%2C6.00&sel=osm%3Anode%2F1");
    expect(reset).toBeDisabled();
  });
});

describe("helpers", () => {
  it("toggled returns a new set", () => {
    const original = new Set(["a"]);
    expect([...toggled(original, "b")]).toEqual(["a", "b"]);
    expect([...toggled(original, "a")]).toEqual([]);
    expect([...original]).toEqual(["a"]);
  });

  it("resetFilters keeps language", () => {
    expect(resetFilters(parseState("?lang=en&t=wind", "hr")).lang).toBe("en");
  });
});

describe("layer groups and notes", () => {
  it("lists every layer exactly once", () => {
    const listed = LAYER_GROUPS.flatMap((group) => group.layers);
    expect([...listed].sort()).toEqual([...LAYER_KEYS].sort());
  });

  it("opens a layer's note when it is switched on, and on request", async () => {
    let latest = defaultState("hr");
    const user = userEvent.setup();
    renderWithI18n(<Harness initial={latest} onState={(s) => (latest = s)} />);
    // nothing is explained until something asks
    expect(screen.queryByText(/Naftne i plinske bušotine/)).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: /Crpilišta i rudnici/ }));
    expect(latest.layers.has("extraction")).toBe(true);
    expect(screen.getByText(/Naftne i plinske bušotine/)).toBeVisible();
    // the reader can put it away, and open another one by its button
    await user.click(screen.getByRole("button", { name: "O sloju: Crpilišta i rudnici" }));
    expect(screen.queryByText(/Naftne i plinske bušotine/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "O sloju: Distribucijska mreža" }));
    expect(screen.getByText(/Srednji i niski napon/)).toBeVisible();
    // switching a layer off leaves its note alone; a layer without a note has no button
    expect(screen.queryByRole("button", { name: "O sloju: Elektrane" })).toBeNull();
    expect(screen.getByRole("group", { name: "Uživo" })).toBeVisible();
  });
  it("says so when a layer that is on has nothing in this view, and only then", () => {
    const state = { ...defaultState("hr"), layers: new Set(["lines", "cities"] as const) };
    const hint = "Na ovom dijelu karte nema ničega iz ovog sloja. Približite kartu ili je pomaknite.";
    const { unmount } = renderWithI18n(
      <FiltersPanel
        state={state}
        theme="dark"
        setState={() => undefined}
        emptyLayers={new Set(["cities", "chargers"] as const)}
      />,
    );
    // cities are on and empty; chargers are empty too but switched off, so nothing is said about them
    expect(screen.getAllByText(hint)).toHaveLength(1);
    unmount();
    renderWithI18n(<FiltersPanel state={state} theme="dark" setState={() => undefined} />);
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });
});
