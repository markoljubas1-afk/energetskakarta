/**
 * "Where the gas came in": a picture for sharing of what entered a country's gas transmission system on
 * its last complete gas day (Faza 44-3), from the ENTSOG Transparency Platform (data/gasFlows.ts).
 *
 * The figures are parts of what entered the system, and the picture says so in those words. It does not
 * say who "covered the country's needs": part of the gas goes on across the border and into storage. What
 * was delivered to consumers inside the country is written under the figures, so the two are not confused.
 */
import type { Balance, BorderFlow, FlowRow } from "../data/gasFlows";
import type { I18n } from "../i18n";
import type { CardText } from "./dayCard";
import { signed } from "./gasCard";

/** How many entries the picture has room for; the largest ones are shown. */
const SHOWN = 3;

/** A flow in the unit the bar and the picture use, GWh a day. */
export const gwh = (kwh: number, i18n: I18n): string => i18n.number(kwh / 1e6, 1);

/**
 * A point in the reader's words. The kinds the balance is made of have names; a border point keeps the
 * platform's name with the country across the border; anything else keeps the platform's own label.
 */
export function flowName(row: FlowRow, i18n: I18n): string {
  const { t } = i18n;
  // two points of one kind on the same side keep the platform's own name next to ours
  const named = (name: string): string => (row.shared ? `${name} (${row.label})` : name);
  switch (row.kind) {
    case "LNG":
      return named(t("gasFlow_LNG"));
    case "PRD":
      // gas leaves at a production point too (Hungary's "Exit for Blending"): that is not a field's output
      return row.direction === "entry" ? named(t("gasFlow_PRD")) : row.label;
    case "UGS":
      return named(t(row.direction === "entry" ? "gasFlow_UGS_entry" : "gasFlow_UGS_exit"));
    case "FNC":
    case "DIS":
      return named(t("gasFlow_consumers"));
    case "ITP":
    case "VIP":
      return row.neighbour === null ? row.label : `${row.label} (${i18n.country(row.neighbour)})`;
    case "OTHER":
      return row.label;
  }
}

/** A point's label on the map: its name, and under it what flowed through it that day and which way. */
export function flowPointText(row: FlowRow, i18n: I18n): string {
  const { t } = i18n;
  const flow =
    row.kwh > 0
      ? t(row.direction === "entry" ? "gasFlowPointIn" : "gasFlowPointOut", { value: gwh(row.kwh, i18n) })
      : t("gasFlowPointIdle");
  return `${flowName(row, i18n)}\n${flow}`;
}

/** A border crossing's label on the map: its name, and under it which way the gas went net and how much. */
export function borderFlowText(flow: BorderFlow, i18n: I18n): string {
  const { t } = i18n;
  const across =
    flow.kwh > 0
      ? t("gasBorderFlow", {
          from: i18n.country(flow.from),
          to: i18n.country(flow.to),
          value: gwh(flow.kwh, i18n),
        })
      : t("gasFlowPointIdle");
  return `${flow.border.label}
${across}`;
}

/** What the picture says, in the reader's language. */
export function gasFlowCardText(balance: Balance, i18n: I18n): CardText {
  const { t } = i18n;
  const entered = gwh(balance.enteredKwh, i18n);
  const figures = balance.entries
    .filter((row) => row.kwh > 0)
    .slice(0, SHOWN)
    .map((row, at) => ({
      value: String(Math.round(row.share * 100)),
      unit: "%",
      label: flowName(row, i18n),
      note:
        at === 0
          ? t("gasFlowCardFirstNote", { value: gwh(row.kwh, i18n), total: entered })
          : t("gasFlowCardNote", { value: gwh(row.kwh, i18n) }),
    }));
  const footer = [
    ...(balance.consumersKwh === null
      ? []
      : [t("gasFlowCardConsumers", { value: gwh(balance.consumersKwh, i18n) })]),
    t("gasFlowCardFooter"),
  ].join(" · ");
  return {
    title: t("gasFlowCardTitle"),
    subtitle: t(balance.provisional ? "gasFlowCardDayProvisional" : "gasFlowCardDay", {
      country: i18n.country(balance.country),
      date: i18n.date(balance.day),
    }),
    figures,
    footer,
  };
}

/**
 * How the day's deliveries to consumers stand against the average of the seven days before, in percent;
 * null when there is nothing to compare with.
 */
export function deliveryChange(balance: Balance): number | null {
  const { consumersKwh: now, usualConsumersKwh: usual } = balance;
  return now === null || usual === null || !(usual > 0) ? null : (now / usual - 1) * 100;
}

/**
 * "Gas delivered to consumers": the day's figure and how it stands against the seven days before (the
 * owner's "consumption jump", 2026-11-19). It is the transmission operator's exit to final consumers and
 * distribution, which is why the picture calls it delivered and not consumed; null when the country's
 * system reports no such exit.
 */
export function gasUseCardText(balance: Balance, i18n: I18n): CardText | null {
  const { t } = i18n;
  if (balance.consumersKwh === null) return null;
  const figures = [
    {
      value: gwh(balance.consumersKwh, i18n),
      unit: t("unitGwh"),
      label: t("gasUseCardDelivered"),
      note: t("gasUseCardDeliveredNote", { operator: balance.operator }),
    },
  ];
  const change = deliveryChange(balance);
  if (change !== null && balance.usualConsumersKwh !== null) {
    figures.push({
      value: signed(Math.round(change), i18n),
      unit: "%",
      label: t("gasUseCardChange"),
      note: t("gasUseCardChangeNote", { value: gwh(balance.usualConsumersKwh, i18n) }),
    });
  }
  return {
    title: t("gasUseCardTitle"),
    subtitle: t(balance.provisional ? "gasFlowCardDayProvisional" : "gasFlowCardDay", {
      country: i18n.country(balance.country),
      date: i18n.date(balance.day),
    }),
    figures,
    footer: t("gasFlowCardFooter"),
  };
}
