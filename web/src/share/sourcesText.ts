/**
 * The words of the "sources of electricity" picture and where its figures come from (Faza 41): the text in
 * the reader's language, and the loader of the daily and monthly totals behind it.
 */
import { assetUrl, DataError, fetchJson } from "../data/current";
import {
  EnergyPointerSchema,
  PeriodsSchema,
  YearFileSchema,
  type Periods,
  type YearFile,
} from "../data/energy";
import type { I18n } from "../i18n";
import { PALETTES } from "../map/palette";
import { foldParts, type SourcesCard, type SourcesText } from "./sourcesCard";

/** A year file with fewer days than this is read together with the year before it (the first days of January). */
const FEW_DAYS = 10;

export type SourcesData =
  { kind: "none" } | { kind: "ready"; periods: Periods; days: YearFile[]; updatedAt: string };

/** The monthly totals and the latest daily file; "none" when the build has no energy data. */
export async function loadSources(base: URL, signal: AbortSignal): Promise<SourcesData> {
  const pointerUrl = `${assetUrl(base, "energy/current.json")}?t=${String(Math.floor(Date.now() / 60_000))}`;
  const probe = await fetch(pointerUrl, { signal });
  if (probe.status === 404) return { kind: "none" };
  if (!probe.ok) throw new DataError(`energy pointer returned HTTP ${String(probe.status)}`);
  const pointer = EnergyPointerSchema.parse(await probe.json());
  const periods = await fetchJson(assetUrl(base, pointer.periods.key), PeriodsSchema, signal);
  const years = Object.keys(pointer.years).sort();
  const days: YearFile[] = [];
  for (const year of years.reverse().slice(0, 2)) {
    const entry = pointer.years[year];
    if (!entry) continue;
    const file = await fetchJson(assetUrl(base, entry.key), YearFileSchema, signal);
    days.push(file);
    // a year that has got going needs no help from the one before it
    const reported = file.days.filter((_, index) =>
      Object.values(file.countries).some((country) => (country.coverage.generation[index] ?? 0) > 0),
    ).length;
    if (reported >= FEW_DAYS) break;
  }
  return { kind: "ready", periods, days, updatedAt: pointer.updatedAt };
}

/** "50,1 GWh" as a figure and its unit. */
function split(energy: string): { value: string; unit: string } {
  const at = energy.lastIndexOf(" ");
  return at < 0 ? { value: energy, unit: "" } : { value: energy.slice(0, at), unit: energy.slice(at + 1) };
}

const percent = (share: number): string =>
  share > 0 && share < 0.005 ? "<1 %" : `${String(Math.round(share * 100))} %`;

/** The colours of the sources on the dark card. */
const COLOURS = PALETTES.dark.technology;
const REST_COLOUR = "#8a949e";

export function periodName(card: Pick<SourcesCard, "unit" | "period">, i18n: I18n): string {
  if (card.unit === "day") return i18n.date(card.period);
  const [year = "", month = "1"] = card.period.split("-");
  return new Intl.DateTimeFormat(i18n.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
  );
}

/** What the picture says, in the reader's language. */
export function sourcesText(card: SourcesCard, i18n: I18n): SourcesText {
  const { t } = i18n;
  const { named, restShare } = foldParts(card.parts);
  const legend = named.map((part) => ({
    label: t(`sourceName_${part.technology}`),
    value: percent(part.share),
    share: part.share,
    colour: COLOURS[part.technology],
  }));
  if (restShare > 0) {
    legend.push({
      label: t("sourcesOther"),
      value: percent(restShare),
      share: restShare,
      colour: REST_COLOUR,
    });
  }
  const figures = [{ ...split(i18n.energy(card.totalMwh)), label: t("sourcesProduced") }];
  if (card.loadMwh !== null) figures.push({ ...split(i18n.energy(card.loadMwh)), label: t("sourcesLoad") });
  if (card.co2 !== null) {
    figures.push({
      value: `≈ ${i18n.number(Math.round(card.co2 / 10) * 10)}`,
      unit: t("sourcesCo2Unit"),
      label: t("sourcesCo2"),
    });
  }
  let sentence: string | null = null;
  if (card.loadMwh !== null && card.loadMwh !== card.totalMwh) {
    const more = card.loadMwh > card.totalMwh;
    sentence = t(more ? "sourcesImport" : "sourcesExport", {
      diff: i18n.energy(Math.abs(card.loadMwh - card.totalMwh)),
    });
  }
  return {
    title: t("sourcesTitle"),
    subtitle: `${i18n.country(card.country)} · ${periodName(card, i18n)}${card.unit === "day" ? ` · ${t("sourcesWholeDay")}` : ""}`,
    centre: { value: percent(card.renewableShare), label: t("sourcesRenewable") },
    legend,
    figures,
    sentence,
    footer: t(card.co2 !== null ? "sourcesFooter" : "dayCardFooter"),
  };
}

/** The picture in words, for a screen reader and for the test. */
export function sourcesSummary(text: SourcesText): string {
  const legend = text.legend.map((row) => `${row.label} ${row.value}`).join(", ");
  const figures = text.figures.map((f) => `${f.value} ${f.unit} ${f.label}`).join("; ");
  return `${text.title}. ${text.subtitle}: ${text.centre.value} ${text.centre.label}; ${legend}. ${figures}.${text.sentence ? ` ${text.sentence}` : ""} ${text.footer}`;
}
