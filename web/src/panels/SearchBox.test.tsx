import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, renderWithI18n } from "../test/render";
import { SearchBox } from "./SearchBox";

const index = {
  version: 1,
  fields: ["id", "name", "layer", "country", "lon", "lat", "detail"],
  rows: [
    ["osm:way/109", "RHE Primjer", "plants", "HR", 16.51, 45.81, "pumped_storage|276"],
    ["osm:node/50", "TS Žerjavinec", "substations", "HR", 15.95, 45.55, "400"],
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SearchBox", () => {
  it("downloads the index only after focus, then picks with the keyboard", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(index));
    vi.stubGlobal("fetch", fetchMock);
    const onPick = vi.fn();
    const user = userEvent.setup();
    renderWithI18n(<SearchBox indexUrl="https://d.test/search.json" onPick={onPick} />);

    expect(fetchMock).not.toHaveBeenCalled();
    const input = screen.getByRole("combobox", { name: "Pretraga" });
    await user.type(input, "zerjav");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const option = await screen.findByRole("option", { name: /TS Žerjavinec/ });
    expect(option).toHaveTextContent("Trafostanica, 400 kV, Hrvatska");
    expect(input).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "osm:node/50", kind: "substation" }));
    expect(input).toHaveValue("TS Žerjavinec");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(index)));
    const user = userEvent.setup();
    renderWithI18n(<SearchBox indexUrl="https://d.test/search.json" onPick={vi.fn()} />);
    await user.type(screen.getByRole("combobox"), "xyz");
    expect(await screen.findByRole("status")).toHaveTextContent("Nema rezultata za „xyz“");
  });

  it("says when search is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    const user = userEvent.setup();
    // its own address: an index that loaded once is shared for the rest of the page's life (data/search.ts)
    renderWithI18n(<SearchBox indexUrl="https://d.test/broken/search.json" onPick={vi.fn()} />, "en");
    await user.type(screen.getByRole("combobox"), "rhe");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Search is unavailable right now.");
    });
  });

  it("picks with the mouse", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(index)));
    const onPick = vi.fn();
    const user = userEvent.setup();
    renderWithI18n(<SearchBox indexUrl="https://d.test/search.json" onPick={onPick} />);
    await user.type(screen.getByRole("combobox"), "rhe");
    await user.click(await screen.findByRole("option", { name: /RHE Primjer/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "osm:way/109", capacityMw: 276 }));
  });
});
