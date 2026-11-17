import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { HepRelease } from "../data/hep";
import { RELEASE } from "../data/hep.fixture";
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

  describe("the nearest substation", () => {
    // the fixture's TE-TO (category D, 48 MW free) moved next to the solar fixture's cells
    const near: HepRelease = {
      ...RELEASE,
      stations: RELEASE.stations.map((station) =>
        station.name === "TE-TO" ? { ...station, lon: 16.02, lat: 44.95 } : station,
      ),
    };
    const withCapacity = (release: HepRelease, onStation = vi.fn()) =>
      renderWithI18n(
        <SolarBar
          data={ready}
          point={{ lng: 16.02, lat: 44.93 }}
          onRetry={vi.fn()}
          onClose={vi.fn()}
          capacity={{ status: "ready", value: { kind: "ready", release, history: null } }}
          onStation={onStation}
        />,
      );

    it("names it with its distance, band and free capacity, and shows it on the map on request", () => {
      const onStation = vi.fn();
      withCapacity(near, onStation);
      const heading = screen.getByRole("heading", { name: "Najbliža trafostanica HEP ODS-a" });
      const card = heading.parentElement;
      expect(card).toHaveTextContent("TE-TO (4TS28) · 110/x kV · 2,2 km zračne linije");
      expect(card).toHaveTextContent("D: više od 20 MW, slobodno 48 MW");
      expect(card).toHaveTextContent(/određuje HEP ODS/);
      fireEvent.click(screen.getByRole("button", { name: "Pokaži na karti" }));
      expect(onStation).toHaveBeenCalledWith("TS 110/30kV 4TS 28 TE-TO");
    });

    it("says that capacity is published for Croatia only when no substation is near", () => {
      withCapacity(RELEASE);
      expect(screen.getByText(/U krugu od 30 km nema trafostanice HEP ODS-a/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Pokaži na karti" })).not.toBeInTheDocument();
    });

    it("points to PVGIS with the place's coordinates, with or without capacity data", () => {
      bar({ lng: 16.02, lat: 44.93 });
      expect(screen.getByRole("link", { name: "PVGIS" })).toHaveAttribute(
        "href",
        "https://re.jrc.ec.europa.eu/pvg_tools/en/",
      );
      expect(screen.getByText(/Ovo mjesto: 44.9300, 16.0200\./)).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Najbliža trafostanica HEP ODS-a" }),
      ).not.toBeInTheDocument();
    });
  });
});
