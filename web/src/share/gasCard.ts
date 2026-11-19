/**
 * "Gas in storage": a picture for sharing of one country's storage on its last reported gas day (Faza 44-2).
 *
 * The figures are the operators' own reports as GIE's AGSI platform publishes them (data/gasStorage.ts):
 * how full the storage is, how much gas that is, and how the fill changed against the gas day seven days
 * before. A country with several facilities is added up only on a day every one of them reported, so the
 * total is of one day and not a mix of two. A figure the data does not have is left out; the picture always
 * names GIE AGSI, which is the condition the data is given under.
 */
import type { GasStorage } from "../data/gasStorage";
import type { I18n } from "../i18n";
import type { CardText } from "./dayCard";

export interface GasCard {
  country: string;
  /** the gas day the figures are of */
  day: string;
  /** percent of the working volume */
  full: number;
  /** gas in storage and what the storage can hold, TWh; null when a facility does not state them */
  volume: { storedTwh: number; capacityTwh: number } | null;
  facilities: number;
  /** the facility's name when there is one only */
  name: string;
  /** the operator marked the day as an estimate */
  estimated: boolean;
  /** the fill on the gas day seven days before; null when that day is not in the data */
  weekBefore: { day: string; full: number } | null;
}

interface DayTotal {
  full: number;
  volume: GasCard["volume"];
  estimated: boolean;
}

type Facility = GasStorage["facilities"][number];

/** A country's storage on the day at `index`; null unless every one of its facilities reported it. */
function totalOn(facilities: readonly Facility[], index: number): DayTotal | null {
  const [only] = facilities;
  if (!only) return null;
  const estimated = facilities.some((facility) => facility.status[index] === "E");
  let stored = 0;
  let capacity = 0;
  let volumes = true;
  for (const facility of facilities) {
    const holds = facility.workingGasTwh;
    const has = facility.inStorageTwh[index];
    if (has == null || holds === null || holds <= 0) {
      volumes = false;
      break;
    }
    stored += has;
    capacity += holds;
  }
  const volume = volumes ? { storedTwh: stored, capacityTwh: capacity } : null;
  if (facilities.length === 1) {
    const full = only.fullPercent[index];
    return full == null ? null : { full, volume, estimated };
  }
  // several facilities have one fill only as gas held over gas that fits
  return volume ? { full: (stored / capacity) * 100, volume, estimated } : null;
}

/** The facilities of a country that reported a fill on at least one day. */
function facilitiesOf(storage: GasStorage, country: string): Facility[] {
  return storage.facilities.filter(
    (facility) => facility.country === country && facility.fullPercent.some((value) => value != null),
  );
}

/** "2026-11-17" seven days earlier, as the data writes its days. */
function sevenDaysBefore(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

/** The card of a country; null when it has no storage, or no day all its facilities reported. */
export function gasCard(storage: GasStorage, country: string): GasCard | null {
  const facilities = facilitiesOf(storage, country);
  for (let index = storage.days.length - 1; index >= 0; index -= 1) {
    const day = storage.days[index];
    const total = totalOn(facilities, index);
    if (day === undefined || !total) continue;
    const beforeDay = sevenDaysBefore(day);
    const beforeIndex = storage.days.indexOf(beforeDay);
    const before = beforeIndex < 0 ? null : totalOn(facilities, beforeIndex);
    return {
      country,
      day,
      full: total.full,
      volume: total.volume,
      facilities: facilities.length,
      name: facilities.length === 1 ? (facilities[0]?.name ?? "") : "",
      estimated: total.estimated,
      weekBefore: before ? { day: beforeDay, full: before.full } : null,
    };
  }
  return null;
}

/** The countries that have a picture, in the order given. */
export function gasCountries(storage: GasStorage, order: readonly string[]): string[] {
  return order.filter((code) => gasCard(storage, code) !== null);
}

/**
 * The gas pictures a link can open: the storage ("?pic=gas"), what entered the system ("?pic=gasflow") and
 * what was delivered to consumers ("?pic=gasuse").
 */
export const GAS_PICTURES = ["gas", "gasflow", "gasuse"] as const;
export type GasPicture = (typeof GAS_PICTURES)[number];

/** The gas picture the address the page was opened with asks for; null without one. */
export function askedGasPicture(search: string): GasPicture | null {
  const asked = new URLSearchParams(search).get("pic");
  return GAS_PICTURES.find((each) => each === asked) ?? null;
}

/** A change with its sign written out; the minus is the real one, not a hyphen. */
export function signed(value: number, i18n: I18n): string {
  const rounded = Math.round(value * 10) / 10;
  const figure = i18n.number(Math.abs(rounded), 1);
  return rounded > 0 ? `+${figure}` : rounded < 0 ? `−${figure}` : figure;
}

/** What the picture says, in the reader's language. */
export function gasCardText(card: GasCard, i18n: I18n): CardText {
  const { t } = i18n;
  const where =
    card.facilities === 1
      ? t("dayCardStorageOne", { name: card.name, date: i18n.date(card.day) })
      : t("dayCardStorageMany", { count: card.facilities, date: i18n.date(card.day) });
  const figures = [
    {
      value: i18n.number(card.full, 1),
      unit: "%",
      label: t("dayCardStorage"),
      note: card.estimated ? `${where}; ${t("storageEstimated")}` : where,
    },
  ];
  if (card.volume) {
    figures.push({
      value: i18n.number(card.volume.storedTwh, 1),
      unit: t("unitTwh"),
      label: t("gasCardStored"),
      note: t("gasCardStoredNote", { capacity: i18n.number(card.volume.capacityTwh, 1) }),
    });
  }
  if (card.weekBefore) {
    figures.push({
      value: signed(card.full - card.weekBefore.full, i18n),
      unit: t("gasCardPoints"),
      label: t("gasCardWeek"),
      note: t("gasCardWeekNote", {
        date: i18n.date(card.weekBefore.day),
        before: i18n.number(card.weekBefore.full, 1),
      }),
    });
  }
  return {
    title: t("gasCardTitle"),
    subtitle: `${i18n.country(card.country)} · ${i18n.date(card.day)}`,
    figures,
    footer: t("gasCardFooter"),
  };
}
