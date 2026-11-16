/** Live data for the green-share tests: Croatia reports up to 09:00 on the second day, Slovenia every hour. */
import type { Live } from "./live";

/** Two days of hours, 2026-11-15 00:00 to 2026-11-16 23:00 local. */
const HOURS = Array.from({ length: 48 }, (_, i) => {
  const day = 15 + Math.floor(i / 24);
  return `2026-11-${String(day)}T${String(i % 24).padStart(2, "0")}:00:00+01:00`;
});
const column = (fill: (index: number) => number | null): (number | null)[] => HOURS.map((_, i) => fill(i));

export const GREEN_LIVE: Live = {
  version: 1,
  generatedAt: "2026-11-16T10:05:00+00:00",
  timezone: "Europe/Zagreb",
  hours: HOURS,
  flows: [],
  prices: {},
  generation: {
    HR: {
      // reported up to 2026-11-16 09:00 (index 33); nothing after
      hydro: column((i) => (i <= 33 ? 600 : null)),
      wind: column((i) => (i <= 33 ? (i === 33 ? 300 : 100) : null)),
      gas: column((i) => (i <= 33 ? 300 : null)),
      pumped_storage: column((i) => (i <= 33 ? 100 : null)),
      // a name the map does not know is not counted, rather than guessed at
      marine: column(() => 500),
    },
    SI: { nuclear: column(() => 700), hydro: column(() => 100), solar: column(() => 0) },
    // listed, but never reported
    ME: { hydro: column(() => null) },
  },
  missing: { flows: [], prices: [] },
};
