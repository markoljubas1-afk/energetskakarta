import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { alerts } from "../data/alerts";
import { GREEN_LIVE } from "../data/greenShare.fixture";
import type { Live, LiveDays } from "../data/live";
import { renderWithI18n } from "../test/render";
import { AlertBanner } from "./AlertBanner";

/** The fixture's hours run from 15 November 00:00 to 16 November 23:00 (indices 0 to 47). */
const price = (fill: (index: number) => number | null): Live => ({
  ...GREEN_LIVE,
  prices: { HR: { zone: "HR", eurPerMwh: GREEN_LIVE.hours.map((_, i) => fill(i)) } },
});
/** 15 November, 10:30: "today" is indices 0 to 23, "tomorrow" 24 to 47. */
const MORNING = new Date("2026-11-15T10:30:00+01:00");

const DAYS: LiveDays = {
  version: 1,
  generatedAt: "2026-11-15T06:00:00+00:00",
  source: "ENTSO-E Transparency Platform",
  country: "HR",
  days: [
    {
      date: "2024-07-19",
      key: "live/days/2024-07-19.json",
      records: [{ kind: "load_high", value: 68009.2, unit: "MWh" }],
    },
    {
      date: "2026-11-11",
      key: "live/days/2026-11-11.json",
      records: [{ kind: "wind", value: 25064, unit: "MWh" }],
    },
  ],
  missing: [],
};

describe("alerts", () => {
  it("announces a price of zero or below tomorrow, with the lowest hour", () => {
    // tomorrow 12:00 to 14:00 (indices 36 to 38): 0, -50.5, -3
    const live = price((i) => (i === 36 ? 0 : i === 37 ? -50.5 : i === 38 ? -3 : 90));
    const found = alerts(live, null, MORNING);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "free",
      id: "free:HR:2026-11-16",
      when: "tomorrow",
      hours: 3,
      lowest: { index: 37, eur: -50.5 },
    });
  });

  it("announces today's free hours only while some are still to come", () => {
    // today 03:00 (over by the morning) and 13:00 (still ahead)
    const live = price((i) => (i === 3 || i === 13 ? -1 : 90));
    expect(alerts(live, null, MORNING)[0]).toMatchObject({ when: "today", hours: 1, lowest: { index: 13 } });
    const evening = new Date("2026-11-15T20:30:00+01:00");
    expect(alerts(live, null, evening)).toEqual([]);
  });

  it("says nothing about prices from a document that does not hold the present hour", () => {
    const live = price(() => -5);
    expect(alerts(live, null, new Date("2026-11-20T10:30:00+01:00"))).toEqual([]);
    expect(alerts(null, null, MORNING)).toEqual([]);
  });

  it("announces a record day while it is news, and not an old one", () => {
    const found = alerts(null, DAYS, MORNING);
    expect(found).toEqual([
      {
        kind: "record",
        id: "record:2026-11-11:wind",
        country: "HR",
        date: "2026-11-11",
        record: { kind: "wind", value: 25064, unit: "MWh" },
      },
    ]);
    // eleven days on it is no longer news
    expect(alerts(null, DAYS, new Date("2026-11-23T10:30:00+01:00"))).toEqual([]);
  });

  it("puts a free price before a record", () => {
    const live = price((i) => (i === 37 ? -2 : 90));
    expect(alerts(live, DAYS, MORNING).map((alert) => alert.kind)).toEqual(["free", "record"]);
  });
});

describe("AlertBanner", () => {
  it("says what the price is and what it is not, and offers the hour", async () => {
    const [alert] = alerts(
      price((i) => (i === 37 ? -50.5 : 90)),
      null,
      MORNING,
    );
    if (!alert) throw new Error("an alert");
    const onShow = vi.fn();
    const onClose = vi.fn();
    renderWithI18n(<AlertBanner alert={alert} onShow={onShow} onClose={onClose} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Cijena struje nula ili niže.");
    // the hour is written in the reader's own time zone (L-073)
    expect(banner).toHaveTextContent(
      /Hrvatska: sutra cijena na burzi pada na nulu ili ispod nje, najniže −50,5 €\/MWh u \d\d:00\./,
    );
    expect(banner).toHaveTextContent("račun kućanstva je ne prati");
    await userEvent.click(screen.getByRole("button", { name: "Prikaži taj sat na karti" }));
    expect(onShow).toHaveBeenCalledWith(alert);
    await userEvent.click(screen.getByRole("button", { name: "Zatvori obavijest" }));
    expect(onClose).toHaveBeenCalledWith(alert);
  });

  it("says a record with its date and figure", () => {
    const [alert] = alerts(null, DAYS, MORNING);
    if (!alert) throw new Error("an alert");
    renderWithI18n(<AlertBanner alert={alert} onShow={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Novi rekord. Hrvatska, 11. studenoga 2026.: najviše struje iz vjetra u jednom danu u podacima od 2015. (25,1 GWh).",
    );
    expect(screen.getByRole("button", { name: "Prikaži taj dan na karti" })).toBeInTheDocument();
  });
});

describe("the day's occasion", () => {
  const TESLA = new Date("2026-07-10T09:00:00+02:00");

  it("is a notice only when asked for, and comes after what the data says", () => {
    expect(alerts(null, null, TESLA)).toEqual([]);
    expect(alerts(null, null, TESLA, "HR", true)).toEqual([
      { kind: "occasion", id: "occasion:tesla:2026", occasion: "tesla" },
    ]);
    // 4 December 2026 is not in the fixture's hours, so only the record days speak before it
    const barbara = new Date("2026-11-19T10:30:00+01:00");
    expect(alerts(null, DAYS, barbara, "HR", true).map((alert) => alert.kind)).toEqual([
      "record",
      "occasion",
    ]);
  });

  it("greets without a button when its words point at nothing on the map", async () => {
    const [alert] = alerts(null, null, TESLA, "HR", true);
    if (!alert) throw new Error("an alert");
    const onClose = vi.fn();
    renderWithI18n(<AlertBanner alert={alert} onShow={vi.fn()} onClose={onClose} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("data-alert", "occasion");
    expect(banner).toHaveTextContent(
      "Dan Nikole Tesle. Na današnji dan 1856. u Smiljanu je rođen Nikola Tesla.",
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Zatvori obavijest" }));
    expect(onClose).toHaveBeenCalledWith(alert);
  });

  it("offers the live layer on a day whose words are about the day's figures", async () => {
    const [alert] = alerts(null, null, new Date("2026-06-15T09:00:00+02:00"), "HR", true);
    if (!alert) throw new Error("an alert");
    const onShow = vi.fn();
    renderWithI18n(<AlertBanner alert={alert} onShow={onShow} onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Svjetski dan vjetra.");
    await userEvent.click(screen.getByRole("button", { name: "Otvori tokove i cijene uživo" }));
    expect(onShow).toHaveBeenCalledWith(alert);
  });
});
