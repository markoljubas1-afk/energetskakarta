/**
 * "Where the gas came in": a picture for sharing of what entered a country's gas transmission system on
 * its last complete gas day (Faza 44-3), from the ENTSOG Transparency Platform (data/gasFlows.ts).
 *
 * The figures are parts of what entered the system, and the picture says so in those words. It does not
 * say who "covered the country's needs": part of the gas goes on across the border and into storage. What
 * was delivered to consumers inside the country is written under the figures, so the two are not confused.
 */
import type { Balance, FlowRow } from "../data/gasFlows";
import type { I18n } from "../i18n";
import type { CardText } from "./dayCard";

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
  switch (row.kind) {
    case "LNG":
      return t("gasFlow_LNG");
    case "PRD":
      return t("gasFlow_PRD");
    case "UGS":
      return t(row.direction === "entry" ? "gasFlow_UGS_entry" : "gasFlow_UGS_exit");
    case "FNC":
    case "DIS":
      return t("gasFlow_consumers");
    case "ITP":
    case "VIP":
      return row.neighbour === null ? row.label : `${row.label} (${i18n.country(row.neighbour)})`;
    case "OTHER":
      return row.label;
  }
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
