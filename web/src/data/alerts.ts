/**
 * Things worth a line above the map (Faza 40-2, "detektor ekstrema"): only what the published data proves.
 *
 *  - A day-ahead price of zero or below, today (hours still to come) or tomorrow, in the home country. The
 *    prices are the exchange's own, in the live document the map already has.
 *  - A new record day: one of the record days read off the daily data (pipeline entsoe/records.py) that
 *    falls within the last days. A record is found once its day is completely reported, so the notice
 *    comes a few days after the day itself and says its date.
 *
 *  - An occasion of the calendar (data/occasions.ts, Faza 48): a day of energy or science, a holiday.
 *    It comes last, after anything the data has to say.
 *
 * What is deliberately not here: "the country imports X % of its electricity" (the map has no hourly
 * demand to divide by) and anything predicted.
 */
import type { CountryCode } from "../domain";
import { freeHours, type FreeHour, type Live, type LiveDays } from "./live";
import { occasionOn, type OccasionKey } from "./occasions";

/** A record day is news for this long after the day itself. */
export const RECORD_FRESH_DAYS = 10;

export type Alert =
  | {
      kind: "free";
      id: string;
      country: CountryCode;
      when: "today" | "tomorrow";
      /** the hour with the lowest price among the free hours */
      lowest: FreeHour;
      hours: number;
    }
  | {
      kind: "record";
      id: string;
      country: string;
      date: string;
      record: { kind: string; value: number; unit: "MWh" | "share" };
    }
  | { kind: "occasion"; id: string; occasion: OccasionKey };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function freeAlerts(live: Live, now: Date, home: CountryCode): Alert[] {
  const at = now.getTime();
  const current = live.hours.findIndex((hour) => {
    const start = Date.parse(hour);
    return at >= start && at < start + HOUR_MS;
  });
  // a document that does not hold the present hour says nothing about today or tomorrow
  if (current < 0) return [];
  const today = live.hours[current]?.slice(0, 10);
  const tomorrow = live.hours.findIndex((hour, index) => index > current && hour.slice(0, 10) !== today);
  const found: Alert[] = [];
  const add = (when: "today" | "tomorrow", index: number, onlyAhead: boolean): void => {
    const hours = freeHours(live, home, index).filter(
      (hour) => !onlyAhead || Date.parse(hour.hour) + HOUR_MS > at,
    );
    const [first] = hours;
    if (!first) return;
    const lowest = hours.reduce((low, hour) => (hour.eur < low.eur ? hour : low), first);
    found.push({
      kind: "free",
      id: `free:${home}:${first.hour.slice(0, 10)}`,
      country: home,
      when,
      lowest,
      hours: hours.length,
    });
  };
  add("today", current, true);
  if (tomorrow >= 0) add("tomorrow", tomorrow, false);
  return found;
}

function recordAlerts(days: LiveDays, now: Date): Alert[] {
  const found: Alert[] = [];
  for (const day of days.days) {
    // noon UTC of the day: far enough from both ends for any time zone the reader is in
    const age = (now.getTime() - Date.parse(`${day.date}T12:00:00Z`)) / DAY_MS;
    if (age < 0 || age > RECORD_FRESH_DAYS) continue;
    for (const record of day.records) {
      found.push({
        kind: "record",
        id: `record:${day.date}:${record.kind}`,
        country: days.country,
        date: day.date,
        record,
      });
    }
  }
  // the newest first
  return found.sort((a, b) =>
    a.kind === "record" && b.kind === "record" ? b.date.localeCompare(a.date) : 0,
  );
}

/** The day's occasion as a notice; closing it holds for that year's occurrence only. */
function occasionAlerts(now: Date): Alert[] {
  const occasion = occasionOn(now);
  if (!occasion) return [];
  return [
    { kind: "occasion", id: `occasion:${occasion.key}:${String(occasion.year)}`, occasion: occasion.key },
  ];
}

/**
 * What there is to announce, most pressing first: a free price today, one tomorrow, then new records,
 * then the day's occasion (`greet`; off for automated browsers, which get the plain map).
 */
export function alerts(
  live: Live | null,
  days: LiveDays | null,
  now: Date,
  home: CountryCode = "HR",
  greet = false,
): Alert[] {
  return [
    ...(live ? freeAlerts(live, now, home) : []),
    ...(days ? recordAlerts(days, now) : []),
    ...(greet ? occasionAlerts(now) : []),
  ];
}

const STORAGE_KEY = "gridatlas-alerts-closed";
const REMEMBERED = 30;

/** The notices the reader has closed; a browser without storage simply shows them again. */
export function closedAlerts(): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function rememberClosed(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(-REMEMBERED)));
  } catch {
    // no storage: the notice comes back on the next visit
  }
}
