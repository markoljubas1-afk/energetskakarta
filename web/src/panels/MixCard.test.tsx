import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MIX_LIVE } from "../data/mix.fixture";
import { renderWithI18n } from "../test/render";
import { MixCard } from "./MixCard";

const label = (i: number) => `sat ${i}`;

describe("MixCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the grid mix with imports and says that electricity mixes", () => {
    renderWithI18n(<MixCard live={MIX_LIVE} index={0} theme="light" hourLabel={label} mapCenter={null} />);
    expect(screen.getByText("Od čega je struja u mreži")).toBeInTheDocument();
    expect(screen.getByText("Uvoz, sastav nepoznat")).toBeInTheDocument();
    expect(screen.getByText(/^Uvoz .*Slovenija.*Mađarska.*Srbija/)).toBeInTheDocument();
    expect(screen.getByText(/Struja se u mreži miješa/)).toBeInTheDocument();
    // (750×24 + 200×11 + 200×490 + 150×12) / 1300 ≈ 92
    expect(
      screen.getByText("CO₂ intenzitet struje u mreži: oko 92 g/kWh (životni ciklus)."),
    ).toBeInTheDocument();
  });

  it("switches to production only and falls back to the latest hour with data", () => {
    renderWithI18n(<MixCard live={MIX_LIVE} index={2} theme="dark" hourLabel={label} mapCenter={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Proizvodnja" }));
    expect(screen.getByText("Zadnji sat s podacima: sat 1")).toBeInTheDocument();
    expect(screen.queryByText("Uvoz, sastav nepoznat")).not.toBeInTheDocument();
  });

  it("near me: uses the map centre, asks the weather service and estimates solar now and in a year", async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes("archive")
              ? { daily: { time: [], shortwave_radiation_sum: new Array<number>(365).fill(18) } }
              : {
                  current: { time: "2026-09-16T12:00", cloud_cover: 20, shortwave_radiation: 500, is_day: 1 },
                },
          ),
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWithI18n(
      <MixCard
        live={MIX_LIVE}
        index={0}
        theme="light"
        hourLabel={label}
        mapCenter={{ lat: 45.8144, lng: 15.978 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Kod mene" }));
    fireEvent.click(screen.getByRole("button", { name: "Koristi središte karte" }));
    await waitFor(() => {
      expect(screen.getByText(/Sustav od 10 kW sada daje oko 4 kW/)).toBeInTheDocument();
    });
    // 365 days × 18 MJ/m² = 1 825 kWh/m² → × 0,8 × 1,12 ≈ 1 635 kWh per kW (rounded to tens)
    await waitFor(() => {
      expect(screen.getByText(/oko 1\.640 kWh godišnje po kW snage/)).toBeInTheDocument();
    });
    expect(
      fetchMock.mock.calls.every(([url]) => String(url).includes("latitude=45.81&longitude=15.98")),
    ).toBe(true);
  });

  it("can be passed on with the hour's numbers and its source (Faza 27)", () => {
    renderWithI18n(<MixCard live={MIX_LIVE} index={0} theme="light" hourLabel={label} mapCenter={null} />);
    expect(screen.getByLabelText(/^Podijeli: /)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Citiraj" }));
    expect(screen.getByText(/prema podacima ENTSO-E Transparency Platform/)).toBeInTheDocument();
  });
});
