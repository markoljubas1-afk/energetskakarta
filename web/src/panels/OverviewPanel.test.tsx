import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, renderWithI18n } from "../test/render";
import { OverviewPanel } from "./OverviewPanel";

const stats = {
  version: 1,
  voltageClasses: ["380+", "220-379", "110-219", "60-109", "unknown"],
  note: "OSM",
  plants: {
    HR: {
      hydro: { operating: { count: 1, capacityMw: 276, withCapacity: 1 } },
      solar: { planned: { count: 2, capacityMw: 9.9, withCapacity: 1 } },
    },
    SI: { nuclear: { operating: { count: 1, capacityMw: 696, withCapacity: 1 } } },
  },
  substations: { HR: { "380+": 1 }, SI: { "380+": 2 } },
  lineKm: { HR: { "380+": { operating: 37.9 } }, SI: { "380+": { operating: 40 } } },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OverviewPanel", () => {
  it("shows the region by default and a country on request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(stats)));
    const user = userEvent.setup();
    renderWithI18n(
      <OverviewPanel statsUrl="https://d.test/stats.json" countries={new Set()} theme="light" />,
    );

    expect(await screen.findByText("972 MW")).toBeInTheDocument();
    expect(screen.getByText("4 elektrane")).toBeInTheDocument();
    expect(screen.getByText("78 km")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Područje" }), "HR");
    const totals = screen.getAllByRole("definition").map((cell) => cell.textContent);
    expect(totals).toContain("276 MW");
    expect(totals).toContain("9,9 MW");
    const solar = screen.getByText("Sunčana").closest("li");
    expect(solar).not.toBeNull();
    expect(within(solar as HTMLElement).getByText(/1 bez upisane snage/)).toBeInTheDocument();
  });

  it("follows a single-country map filter", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(stats)));
    renderWithI18n(
      <OverviewPanel statsUrl="https://d.test/stats.json" countries={new Set(["SI"])} theme="dark" />,
    );
    expect(await screen.findByRole("combobox", { name: "Područje" })).toHaveValue("SI");
    expect(screen.getByText("Nuklearna")).toBeInTheDocument();
  });

  it("shows an empty state for a country without plants", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(stats)));
    renderWithI18n(
      <OverviewPanel statsUrl="https://d.test/stats.json" countries={new Set(["ME"])} theme="light" />,
    );
    expect(await screen.findByText(/još nema podataka o elektranama/)).toBeInTheDocument();
  });

  it("offers a retry when loading fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 502 }))
      .mockResolvedValueOnce(jsonResponse(stats));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithI18n(
      <OverviewPanel statsUrl="https://d.test/stats.json" countries={new Set()} theme="light" />,
    );
    await user.click(await screen.findByRole("button", { name: "Pokušaj ponovno" }));
    expect(await screen.findByText("972 MW")).toBeInTheDocument();
  });
});
