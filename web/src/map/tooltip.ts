/**
 * The two lines shown next to the pointer while it rests on a feature: what it is, and the one number
 * that matters for its kind. Everything else waits for a click (DetailsPanel).
 */
import { latest } from "../data/gas";
import { isOneOf, TECHNOLOGIES } from "../domain";
import type { I18n } from "../i18n";
import type { Selection } from "./selection";

export interface Tooltip {
  title: string;
  detail: string | null;
}

const kv = (i18n: I18n, voltages: number[]): string | null =>
  voltages.length > 0 ? `${voltages.map((v) => i18n.number(v)).join(" / ")} ${i18n.t("unitKv")}` : null;

const join = (...parts: (string | null)[]): string | null => {
  const present = parts.filter((part): part is string => part !== null);
  return present.length > 0 ? present.join(" · ") : null;
};

export function tooltipFor(selection: Selection, i18n: I18n): Tooltip {
  const { t } = i18n;
  const kind = t(`kind_${selection.kind}`);
  if (selection.kind === "city") {
    return {
      title: selection.name,
      detail: join(
        kind,
        `${i18n.energy(selection.electricityMwh)}/${t("unitYear")}`,
        String(selection.inventoryYear),
      ),
    };
  }
  if (selection.kind === "gas") {
    const last = latest(selection.kwhPerDay);
    return {
      title: i18n.country(selection.country),
      detail: join(
        kind,
        last ? `${i18n.number(last.kwh / 1_000_000, 1)} ${t("unitGwh")}/${t("unitDay")}` : null,
      ),
    };
  }
  const status = selection.status === "operating" ? null : t(`status_${selection.status}`);
  switch (selection.kind) {
    case "line":
    case "cable":
      return {
        title: join(kind, kv(i18n, selection.voltagesKv)) ?? kind,
        detail: join(
          selection.isInterconnector ? selection.countries.map((c) => i18n.country(c)).join(" – ") : null,
          selection.isHvdc ? "HVDC" : null,
          status,
        ),
      };
    case "substation":
      return { title: selection.name ?? kind, detail: join(kind, kv(i18n, selection.voltagesKv), status) };
    case "plant":
      return {
        title: selection.name ?? kind,
        detail: join(
          i18n.technology(selection.technology),
          selection.capacityMw !== null ? i18n.power(selection.capacityMw) : null,
          status,
        ),
      };
    case "pipeline":
      return {
        title: selection.name ?? kind,
        detail: join(
          t(`medium_${selection.medium}`),
          selection.lengthKm !== null ? i18n.km(selection.lengthKm) : null,
          status,
        ),
      };
    case "datacenter":
      return {
        title: selection.name ?? kind,
        detail: join(kind, selection.powerMw !== null ? i18n.power(selection.powerMw) : null, status),
      };
    case "extraction":
      return {
        title: selection.name ?? t(`extraction_${selection.extractionKind}`),
        detail: join(
          selection.name ? t(`extraction_${selection.extractionKind}`) : null,
          t(`substance_${selection.substance}`),
          status,
        ),
      };
    case "charger":
      return {
        title: selection.name ?? kind,
        detail: join(
          kind,
          selection.points !== null ? `${selection.points} ${t("detailsPoints").toLowerCase()}` : null,
          status,
        ),
      };
  }
}

/**
 * Plants the time machine draws from the timeline (GEM), which are not in the tiles: running in the chosen
 * year, or already closed. Their properties come from `retiredFeatures` (data/timeline.ts).
 */
export function timelineTooltip(properties: Record<string, unknown>, i18n: I18n): Tooltip | null {
  const { name, technology, capacityMw, commissioningYear, retiredYear } = properties;
  if (typeof name !== "string" || typeof retiredYear !== "number") return null;
  const tech =
    typeof technology === "string" && isOneOf(TECHNOLOGIES, technology) ? i18n.technology(technology) : null;
  const mw = typeof capacityMw === "number" ? i18n.power(capacityMw) : null;
  const years =
    typeof commissioningYear === "number"
      ? i18n.t("timelineYears", { from: String(commissioningYear), to: String(retiredYear) })
      : i18n.t("timelineClosed", { year: String(retiredYear) });
  return { title: name, detail: join(tech, mw, years) };
}
