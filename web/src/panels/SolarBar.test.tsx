import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SOLAR } from "../data/solar.fixture";
import { renderWithI18n } from "../test/render";
import { SolarBar } from "./SolarBar";

const ready = { status: "ready", value: { kind: "ready", solar: SOLAR } } as const;
const bar = (
  point: { lng: number; lat: number } | null,
  data: Parameters<typeof SolarBar>[0]["data"] = ready,
) => renderWithI18n(<SolarBar data={data} point={point} onRetry={vi.fn()} onClose={vi.fn()} />);

describe("SolarBar", () => {
  it("asks for a click, then says the value there and what it means", () => {
    const first = bar(null);
    expect(screen.getByText(/Kliknite bilo gdje na karti/)).toBeInTheDocument();
    first.unmount();
    bar({ lng: 16.02, lat: 44.93 });
    expect(screen.getByText("1.400")).toBeInTheDocument();
    expect(
      screen.getByText("Sustav snage 1 kW ovdje bi u prosječnoj godini proizveo oko 1.400 kWh."),
    ).toBeInTheDocument();
  });

  it("says so when the atlas has no value at the place", () => {
    bar({ lng: 16.07, lat: 44.92 });
    expect(screen.getByText(/atlas nema vrijednosti/)).toBeInTheDocument();
  });

  it("always carries its caveat and the source's own credit", () => {
    bar(null);
    expect(screen.getByText(/ne studija izvedivosti/)).toBeInTheDocument();
    expect(screen.getByText(/© 2019 Solargis, CC BY 4.0/)).toBeInTheDocument();
    expect(screen.getByText("900")).toBeInTheDocument();
    expect(screen.getByText("1.750")).toBeInTheDocument();
  });

  it("can be closed in every state, and offers to try again after a failure", () => {
    const onClose = vi.fn();
    const onRetry = vi.fn();
    const states: Parameters<typeof SolarBar>[0]["data"][] = [
      ready,
      null,
      { status: "ready", value: { kind: "none" } },
      { status: "error", error: new Error("x") },
    ];
    for (const data of states) {
      const view = renderWithI18n(<SolarBar data={data} point={null} onRetry={onRetry} onClose={onClose} />);
      fireEvent.click(screen.getByRole("button", { name: "Zatvori sunčani potencijal" }));
      if (data?.status === "error") fireEvent.click(screen.getByRole("button", { name: "Pokušaj ponovno" }));
      view.unmount();
    }
    expect(onClose).toHaveBeenCalledTimes(4);
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
