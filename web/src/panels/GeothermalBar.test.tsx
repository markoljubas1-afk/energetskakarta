import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Geothermal } from "../data/geothermal";
import { renderWithI18n } from "../test/render";
import { GeothermalBar } from "./GeothermalBar";

const doc: Geothermal = {
  version: 1,
  generatedAt: "2026-11-15T09:00:00+00:00",
  sitesReviewed: "2026-11-15",
  sites: [
    {
      id: "velika-1",
      name: "Velika 1",
      place: "Velika Ciglena",
      lon: 16.88,
      lat: 45.87,
      kind: "power",
      status: "operating",
      electricMw: 16.5,
      uses: ["electricity"],
      sources: ["https://example.org/a"],
    },
    {
      id: "topusko",
      name: "Toplice Topusko",
      place: "Topusko",
      lon: 15.97,
      lat: 45.3,
      kind: "heat",
      status: "operating",
      temperatureC: 65,
      uses: ["heating", "spa"],
      sources: ["https://example.org/b"],
      noteHr: "Bilješka.",
      noteEn: "Note.",
    },
  ],
  heatFlow: {
    source: "GHFDB",
    url: "https://doi.org/x",
    license: "CC-BY-4.0",
    cellDeg: 0.1,
    radiusKm: 75,
    minPoints: 3,
    points: 40,
    cells: [[16.05, 45.85, 92, 5]],
  },
};
const data = { status: "ready", value: { kind: "ready", geothermal: doc } } as const;

describe("GeothermalBar", () => {
  it("shows today's figures, the potential's caveat and the sites", () => {
    renderWithI18n(
      <GeothermalBar data={data} theme="light" selected={null} onSelect={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(screen.getByText(/16,5 MW struje · 1 lokacija s toplinom/)).toBeInTheDocument();
    expect(screen.getByText(/ne zamjenjuje istraživanje/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Toplice Topusko/ }));
  });

  it("draws the cascade of a picked site with its own temperature and sources", () => {
    renderWithI18n(
      <GeothermalBar data={data} theme="dark" selected="topusko" onSelect={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(screen.getByRole("img", { name: /Put topline za Toplice Topusko/ })).toBeInTheDocument();
    expect(screen.getByText("≈ 65 °C")).toBeInTheDocument();
    expect(screen.getByText("Bilješka.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "example.org" })).toHaveAttribute(
      "href",
      "https://example.org/b",
    );
  });

  it("says when nothing is published yet", () => {
    renderWithI18n(
      <GeothermalBar
        data={{ status: "ready", value: { kind: "none" } }}
        theme="light"
        selected={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("Geotermalni podaci još nisu objavljeni.")).toBeInTheDocument();
  });

  it("can be closed in every state, and has no button when nobody can close it", () => {
    const onClose = vi.fn();
    const bar = (value: Parameters<typeof GeothermalBar>[0]["data"], close?: () => void) => (
      <GeothermalBar
        data={value}
        theme="light"
        selected={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        {...(close ? { onClose: close } : {})}
      />
    );
    const name = "Zatvori geotermalnu energiju";
    for (const value of [data, { status: "ready", value: { kind: "none" } } as const, null]) {
      const view = renderWithI18n(bar(value, onClose));
      fireEvent.click(screen.getByRole("button", { name }));
      view.unmount();
    }
    expect(onClose).toHaveBeenCalledTimes(3);
    renderWithI18n(bar(data));
    expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });
});
