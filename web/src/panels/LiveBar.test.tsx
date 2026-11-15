import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SAMPLE_LIVE } from "../data/live.fixture";
import { renderWithI18n } from "../test/render";
import { dayRange, LiveBar, PLAY_STEP_MS } from "./LiveBar";

const ready = (fixture?: string) =>
  ({
    status: "ready",
    value: { kind: "ready", live: { ...SAMPLE_LIVE, ...(fixture ? { fixture } : {}) } },
  }) as const;

describe("LiveBar", () => {
  it("explains missing data", () => {
    renderWithI18n(
      <LiveBar
        theme="light"
        data={{ status: "ready", value: { kind: "none" } }}
        index={0}
        onHour={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("Tokovi i cijene još nisu objavljeni.")).toBeInTheDocument();
  });

  it("moves between hours and labels the day", async () => {
    const onHour = vi.fn();
    renderWithI18n(<LiveBar theme="light" data={ready()} index={1} onHour={onHour} onRetry={vi.fn()} />);
    expect(screen.getByText("danas 00:00")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sljedeći sat" }));
    expect(onHour).toHaveBeenLastCalledWith("2026-09-17T00+02");
    await userEvent.click(screen.getByRole("button", { name: "Prethodni sat" }));
    expect(onHour).toHaveBeenLastCalledWith("2026-09-15T23+02");
    fireEvent.change(screen.getByRole("slider", { name: "Sat" }), { target: { value: "2" } });
    expect(onHour).toHaveBeenLastCalledWith("2026-09-17T00+02");
  });

  it("disables stepping past the ends", () => {
    renderWithI18n(<LiveBar theme="light" data={ready()} index={0} onHour={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Prethodni sat" })).toBeDisabled();
    expect(screen.getByText("jučer 23:00")).toBeInTheDocument();
    // the refresh time matters for hourly data; one clean separator, no doubled full stop
    expect(screen.getByText(/Stanje: 16\. 09\. 2026\. 12:12 · Izvor: ENTSO-E/)).toBeInTheDocument();
  });

  it("lists figures for the hour, with gaps and missing markets named", async () => {
    renderWithI18n(
      <LiveBar theme="light" data={ready("synthetic")} index={1} onHour={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(screen.getByText("Testni podaci, nisu stvarni")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Brojke za odabrani sat"));
    const [flows, prices] = screen.getAllByRole("table");
    if (!flows || !prices) throw new Error("tables missing");
    expect(within(flows).getByRole("row", { name: /Slovenija → Hrvatska/ })).toHaveTextContent(
      "nema podataka",
    );
    expect(within(flows).getByRole("row", { name: /Mađarska → Hrvatska/ })).toHaveTextContent("380 MW");
    expect(within(prices).getByRole("row", { name: /Hrvatska/ })).toHaveTextContent("101,25 €/MWh");
    expect(within(prices).getByRole("row", { name: /Italija/ })).toHaveTextContent("IT NORD");
    expect(screen.getByText("Bez burze: Bosna i Hercegovina, Crna Gora.")).toBeInTheDocument();
    expect(screen.getByText("Bez podataka o tokovima: Crna Gora – Bosna i Hercegovina.")).toBeInTheDocument();
  });

  it("offers a retry after a failure", async () => {
    const retry = vi.fn();
    renderWithI18n(
      <LiveBar
        theme="light"
        data={{ status: "error", error: new Error("x") }}
        index={0}
        onHour={vi.fn()}
        onRetry={retry}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Pokušaj ponovno" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("explains the price colours when the hour has prices", () => {
    renderWithI18n(<LiveBar theme="dark" data={ready()} index={0} onHour={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText("Boja zemlje: cijena u satu (€/MWh)")).toBeInTheDocument();
    expect(screen.getByText("Zemlja bez boje nema cijenu za taj sat.")).toBeInTheDocument();
  });

  it("plays the day one hour per step and stops at its end", () => {
    vi.useFakeTimers();
    try {
      const onHour = vi.fn();
      const day = {
        ...SAMPLE_LIVE,
        hours: ["2026-09-16T10:00:00+02:00", "2026-09-16T11:00:00+02:00", "2026-09-17T00:00:00+02:00"],
        flows: [],
        prices: {},
      };
      const data = { status: "ready", value: { kind: "ready", live: day } } as const;
      renderWithI18n(<LiveBar theme="light" data={data} index={0} onHour={onHour} onRetry={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Pusti dan" }));
      act(() => {
        vi.advanceTimersByTime(PLAY_STEP_MS);
      });
      expect(onHour).toHaveBeenLastCalledWith("2026-09-16T11+02");
      // the next hour belongs to the next day: playing has stopped
      expect(screen.getByRole("button", { name: "Pusti dan" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("dayRange", () => {
  it("finds the calendar day around an hour", () => {
    const live = {
      ...SAMPLE_LIVE,
      hours: ["2026-09-15T23:00:00+02:00", "2026-09-16T00:00:00+02:00", "2026-09-16T01:00:00+02:00"],
    };
    expect(dayRange(live, 1)).toEqual([1, 2]);
    expect(dayRange(live, 0)).toEqual([0, 0]);
  });
});
