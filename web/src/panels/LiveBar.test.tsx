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

  it("folds the reading notes away and keeps the scale and the source in sight (Faza 57-C2)", () => {
    renderWithI18n(<LiveBar theme="dark" data={ready()} index={0} onHour={vi.fn()} onRetry={vi.fn()} />);
    const notes = screen.getByText("Kako čitati boje i strelice").closest("details");
    if (!notes) throw new Error("the notes are a <details>");
    expect(notes.open).toBe(false);
    for (const text of [
      "Zemlja bez boje nema cijenu za taj sat.",
      /Italija: cijena zone Sjever/,
      "Strelica pokazuje smjer neto toka, a debljina njegovu snagu.",
    ]) {
      expect(notes).toContainElement(screen.getByText(text));
    }
    expect(notes).not.toContainElement(screen.getByText(/Izvor: ENTSO-E/));
    expect(notes).not.toContainElement(screen.getByText("Boja zemlje: cijena u satu (€/MWh)"));
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

  describe("a price of zero or below", () => {
    // 16 September: three hours, the middle two at or below zero in Croatia; Italy stays positive
    const cheap = {
      ...SAMPLE_LIVE,
      hours: [
        "2026-09-16T11:00:00+02:00",
        "2026-09-16T12:00:00+02:00",
        "2026-09-16T13:00:00+02:00",
        "2026-09-17T12:00:00+02:00",
      ],
      flows: [],
      prices: {
        HR: { zone: "10YHR-HEP------M", eurPerMwh: [12.5, 0, -8.25, -99] },
        IT_NORD: { zone: "10Y1001A1001A73I", eurPerMwh: [120, 118, 117, 116] },
      },
    };
    const bar = (index: number, onHour = vi.fn()) =>
      renderWithI18n(
        <LiveBar
          theme="light"
          data={{ status: "ready", value: { kind: "ready", live: cheap } }}
          index={index}
          onHour={onHour}
          onRetry={vi.fn()}
          learnHref="/edukacija/"
        />,
      );

    it("names the day's free hours of that day only, the lowest price, and what kind of price it is", async () => {
      const onHour = vi.fn();
      bar(0, onHour);
      const note = screen.getByRole("note");
      expect(note).toHaveTextContent("Hrvatska: taj dan cijena pada na nulu ili ispod nje.");
      expect(note).toHaveTextContent(/Najniža je −8,25 €\/MWh u /);
      expect(note).toHaveTextContent(/veleprodajna cijena/);
      expect(within(note).getByRole("link", { name: "Zašto cijena može biti negativna?" })).toHaveAttribute(
        "href",
        "/edukacija/",
      );
      // two hours on the 16th; the -99 of the 17th belongs to another day
      const [first, second, ...more] = within(note).getAllByRole("button");
      expect(first).toBeDefined();
      expect(more).toHaveLength(0);
      if (!second) throw new Error("two free hours");
      await userEvent.click(second);
      expect(onHour).toHaveBeenCalledWith("2026-09-16T13+02");
    });

    it("marks the hour being shown, and says nothing on a day without such hours", () => {
      const view = bar(1);
      const [first, second] = within(screen.getByRole("note")).getAllByRole("button");
      expect(first).toHaveAttribute("aria-pressed", "true");
      expect(second).toHaveAttribute("aria-pressed", "false");
      view.unmount();
      renderWithI18n(<LiveBar theme="light" data={ready()} index={0} onHour={vi.fn()} onRetry={vi.fn()} />);
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    });
  });

  describe("record days", () => {
    const days = {
      version: 1 as const,
      generatedAt: "2026-11-17T16:00:00+00:00",
      source: "ENTSO-E Transparency Platform",
      country: "HR",
      days: [
        {
          date: "2024-07-19",
          key: "live/days/2024-07-19.json",
          records: [{ kind: "load_high", value: 68009.2, unit: "MWh" as const }],
        },
        {
          date: "2026-03-31",
          key: "live/days/2026-03-31.json",
          records: [
            { kind: "wind", value: 25064, unit: "MWh" as const },
            { kind: "renewable_share", value: 0.957, unit: "share" as const },
          ],
        },
      ],
      missing: [],
    };
    const past = {
      ...SAMPLE_LIVE,
      hours: ["2024-07-18T23:00:00+02:00", "2024-07-19T12:00:00+02:00", "2024-07-20T00:00:00+02:00"],
    };

    it("offers the days with their records, and switches to one", async () => {
      const onDay = vi.fn();
      renderWithI18n(
        <LiveBar
          theme="light"
          data={ready()}
          index={0}
          onHour={vi.fn()}
          onRetry={vi.fn()}
          days={days}
          onDay={onDay}
        />,
      );
      const picker = screen.getByRole("combobox", { name: "Povijesni dani" });
      expect(
        within(picker)
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual([
        "Danas (uživo)",
        "19. srpnja 2024.: najveća potrošnja (68 GWh)",
        "31. ožujka 2026.: najviše struje iz vjetra (25,1 GWh), najveći udio obnovljivih (96 %)",
      ]);
      expect(screen.queryByRole("button", { name: "Natrag na danas" })).not.toBeInTheDocument();
      await userEvent.selectOptions(picker, "2024-07-19");
      expect(onDay).toHaveBeenCalledWith("2024-07-19");
    });

    it("says plainly that a past day is shown, names its hours by date, and goes back to today", async () => {
      const onDay = vi.fn();
      renderWithI18n(
        <LiveBar
          theme="light"
          data={{ status: "ready", value: { kind: "ready", live: past } }}
          index={1}
          onHour={vi.fn()}
          onRetry={vi.fn()}
          days={days}
          day={days.days[0] ?? null}
          onDay={onDay}
        />,
      );
      expect(screen.getByText(/^Gledate prošli dan, 19\. srpnja 2024\. Rekord/)).toHaveTextContent(
        "Rekord za zemlju Hrvatska u podacima od 2015.: najveća potrošnja (68 GWh).",
      );
      // not "Danas 12:00": the hour carries its date
      expect(screen.getByRole("slider", { name: "Sat" })).toHaveAttribute(
        "aria-valuetext",
        "19. srpnja 2024. 12:00",
      );
      await userEvent.click(screen.getByRole("button", { name: "Natrag na danas" }));
      expect(onDay).toHaveBeenCalledWith(null);
    });

    it("has no picker when no record day is published", () => {
      renderWithI18n(<LiveBar theme="light" data={ready()} index={0} onHour={vi.fn()} onRetry={vi.fn()} />);
      expect(screen.queryByRole("combobox", { name: "Povijesni dani" })).not.toBeInTheDocument();
    });
  });
});
