/**
 * The days of the year that get a line above the map (Faza 48): days of energy and science, and the
 * holidays of the region, the Gregorian and the Julian ones alike. A day is the calendar day in Zagreb,
 * whatever the reader's own clock says. Nothing here is read from data: the words carry no figure that
 * could go out of date (i18n, `occasion_*`).
 */

export const OCCASIONS = [
  "tesla",
  "miners",
  "efficiency",
  "wind",
  "earth",
  "women",
  "men",
  "orthodoxChristmas",
  "easter",
  "orthodoxEaster",
  "christmas",
  "newYear",
] as const;

export type OccasionKey = (typeof OCCASIONS)[number];

export interface Occasion {
  key: OccasionKey;
  /** the year the occasion belongs to; the days after New Year belong to the year that ended */
  year: number;
}

interface Day {
  year: number;
  month: number;
  day: number;
}

const DAY_MS = 86_400_000;

/** A calendar day as a count of days, for arithmetic that crosses months. */
const count = (year: number, month: number, day: number): number => Date.UTC(year, month - 1, day) / DAY_MS;

const ZAGREB = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zagreb",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

/** The calendar day in Zagreb at this moment. */
export function zagrebDay(now: Date): Day {
  const part = (type: "year" | "month" | "day"): number =>
    Number(ZAGREB.formatToParts(now).find((each) => each.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

/** Easter Sunday of the Gregorian calendar (the Meeus/Jones/Butcher computus). */
export function easter(year: number): Day {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const sum = h + l - 7 * m + 114;
  return { year, month: Math.floor(sum / 31), day: (sum % 31) + 1 };
}

/** Easter Sunday of the Julian calendar (Meeus), as its date in the Gregorian one. */
export function orthodoxEaster(year: number): Day {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const sum = d + e + 114;
  // how far the Julian calendar is behind: 13 days from 1900 to 2099
  const behind = Math.floor(year / 100) - Math.floor(year / 400) - 2;
  const date = new Date((count(year, Math.floor(sum / 31), (sum % 31) + 1) + behind) * DAY_MS);
  return { year, month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** One day each, by month and day. */
const SINGLE: readonly (readonly [OccasionKey, number, number])[] = [
  ["tesla", 7, 10],
  ["miners", 12, 4],
  ["efficiency", 3, 5],
  ["wind", 6, 15],
  ["earth", 4, 22],
  ["women", 3, 8],
  ["men", 11, 19],
];

/** Good Friday to Easter Monday. */
const EASTER_BEFORE = 2;
const EASTER_AFTER = 1;

/**
 * The occasion of this moment's day in Zagreb, if it has one. Where two meet, a single day goes before a
 * holiday that lasts several, and when both Easters fall on the same Sunday there is one greeting.
 */
export function occasionOn(now: Date): Occasion | null {
  const { year, month, day } = zagrebDay(now);
  const single = SINGLE.find(([, m, d]) => m === month && d === day);
  if (single) return { key: single[0], year };
  if (month === 1 && (day === 6 || day === 7)) return { key: "orthodoxChristmas", year };
  const today = count(year, month, day);
  const around = (sunday: Day): boolean => {
    const at = count(sunday.year, sunday.month, sunday.day);
    return today >= at - EASTER_BEFORE && today <= at + EASTER_AFTER;
  };
  if (around(easter(year))) return { key: "easter", year };
  if (around(orthodoxEaster(year))) return { key: "orthodoxEaster", year };
  if (month === 12 && day >= 15 && day <= 26) return { key: "christmas", year };
  if (month === 12 && day >= 27) return { key: "newYear", year };
  if (month === 1 && day <= 5) return { key: "newYear", year: year - 1 };
  return null;
}

/** The occasions whose words point at the day's figures: their line offers the live layer. */
const LIVE: ReadonlySet<OccasionKey> = new Set(["efficiency", "wind", "earth", "easter"]);

export const leadsToLive = (key: OccasionKey): boolean => LIVE.has(key);
