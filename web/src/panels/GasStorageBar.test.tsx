import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { latestReading, readings, type GasStorage } from "../data/gasStorage";
import { renderWithI18n } from "../test/render";
import { GasStorageBar } from "./GasStorageBar";

/** Two invented facilities over two gas days, in the shape the pipeline publishes (tests/test_gas_storage.py). */
const STORAGE: GasStorage = {
  version: 1,
  generatedAt: "2026-11-17T08:00:00+00:00",
  source: "GIE AGSI",
  sourceUrl: "https://agsi.gie.eu/",
  attribution: "GIE (Gas Infrastructure Europe), AGSI platform",
  license: "GIE-AGSI-attribution",
  days: ["2026-11-14", "2026-11-15"],
  facilities: [
    {
      id: "21W-PELDA-UGS--D",
      name: "UGS Pelda",
      operator: "Pelda",
      operatorId: "21X-PELDA------C",
      country: "HU",
      lon: null,
      lat: null,
      workingGasTwh: 20.48,
      // has not reported the last day yet
      status: ["E", null],
      fullPercent: [97.62, null],
      inStorageTwh: [19.994, null],
      injectionGwhPerDay: [9.3, null],
      withdrawalGwhPerDay: [0.6, null],
    },
    {
      id: "31W-PRIMJER-UGSB",
      name: "UGS Primjer",
      operator: "Primjer",
      operatorId: "31X-PRIMJER----A",
      country: "HR",
      lon: 16.6,
      lat: 45.6,
      workingGasTwh: 4.7725,
      status: ["C", "C"],
      fullPercent: [77.07, 76.63],
      inStorageTwh: [3.6781, 3.6572],
      injectionGwhPerDay: [0, 0.84],
      withdrawalGwhPerDay: [18.4, 21.1],
    },
  ],
  missing: { facilities: [], countries: ["SI"] },
};

const ready = { status: "ready", value: { kind: "ready", storage: STORAGE } } as const;

describe("gas storage", () => {
  it("reads each facility's last reported day, its direction and its change", () => {
    const [croatia, hungary] = readings(STORAGE, "HR");
    expect(croatia).toMatchObject({
      day: "2026-11-15",
      full: 76.63,
      direction: "withdrawing",
      estimated: false,
    });
    expect(croatia?.change).toBe(-0.44);
    // a facility a day behind is read at its own last day, and says the figure is an estimate
    expect(hungary).toMatchObject({
      day: "2026-11-14",
      full: 97.62,
      direction: "injecting",
      estimated: true,
    });
    expect(hungary?.change).toBeNull();
    const silent = {
      ...STORAGE.facilities[0],
      fullPercent: [null, null],
    } as GasStorage["facilities"][number];
    expect(latestReading(STORAGE, silent)).toBeNull();
  });

  it("shows how full each facility is, which way the gas goes, and always names GIE", () => {
    renderWithI18n(<GasStorageBar data={ready} onClose={vi.fn()} />);
    const bar = screen.getByRole("region", { name: "Skladišta plina: koliko su puna" });
    // Croatia is open; the other countries wait behind one line
    expect(within(bar).getByText("Skladišta u drugim zemljama (1)")).toBeInTheDocument();
    expect(within(bar).getByText("UGS Pelda").closest("details")).not.toHaveAttribute("open");
    expect(within(bar).getByText("UGS Primjer").closest("details")).toBeNull();
    const [first, second] = bar.querySelectorAll("li");
    if (!first || !second) throw new Error("two facilities");
    expect(first).toHaveTextContent("UGS Primjer");
    expect(first).toHaveTextContent("Hrvatska · Primjer");
    expect(first).toHaveTextContent("76,6 %");
    expect(first).toHaveTextContent("povlači se 21,1 GWh/dan");
    expect(first).toHaveTextContent("3,66 od 4,77 TWh");
    expect(first).not.toHaveTextContent("procjena operatora");
    expect(second).toHaveTextContent("UGS Pelda");
    expect(second).toHaveTextContent("utiskuje se 9,3 GWh/dan");
    expect(second).toHaveTextContent("procjena operatora");
    expect(
      within(bar).getByRole("link", { name: "GIE (Gas Infrastructure Europe), AGSI platform" }),
    ).toHaveAttribute("href", "https://agsi.gie.eu/");
  });

  it("closes by switching the gas layer off, and shows nothing without data", () => {
    const onClose = vi.fn();
    const view = renderWithI18n(<GasStorageBar data={ready} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Zatvori sloj plina" }));
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    const empty: Parameters<typeof GasStorageBar>[0]["data"][] = [
      null,
      { status: "loading" },
      { status: "ready", value: { kind: "none" } },
      { status: "ready", value: { kind: "ready", storage: { ...STORAGE, facilities: [] } } },
    ];
    for (const data of empty) {
      const { container, unmount } = renderWithI18n(<GasStorageBar data={data} onClose={onClose} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
