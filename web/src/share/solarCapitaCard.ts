/**
 * The picture "solar electricity per inhabitant" (Faza 46): a country's figure for the year the region is
 * compared in, its place among the countries, and the change from the year before. A calculation from two
 * of Eurostat's figures, and the picture says so in its footer.
 */
import { standings, type SolarCapita, type Standing } from "../data/solarCapita";
import type { I18n } from "../i18n";
import type { CardText } from "./dayCard";
import { signed } from "./gasCard";

/** "?pic=solarhead" in the address the page was opened with. */
export const SOLAR_PICTURE = "solarhead";

export function askedSolarPicture(search: string): typeof SOLAR_PICTURE | null {
  return new URLSearchParams(search).get("pic") === SOLAR_PICTURE ? SOLAR_PICTURE : null;
}

/** A country's standing with the one in first place; null when the country is not compared. */
export function solarCapitaCard(
  doc: SolarCapita,
  country: string,
): { row: Standing; first: Standing } | null {
  const rows = standings(doc);
  const row = rows.find((each) => each.country === country);
  const first = rows[0];
  return row && first ? { row, first } : null;
}

/** Whole kilowatt-hours; one decimal under ten, where a whole number would hide the figure. */
export const kwhEach = (value: number, i18n: I18n): string => i18n.number(value, value < 10 ? 1 : 0);

/** What the picture says, in the reader's language. */
export function solarCapitaCardText(card: { row: Standing; first: Standing }, i18n: I18n): CardText {
  const { t } = i18n;
  const { row, first } = card;
  const figures = [
    {
      value: kwhEach(row.kwhPerPerson, i18n),
      unit: t("unitKwh"),
      label: t("solarHeadCardLabel"),
      note: t("solarHeadCardNote", {
        gwh: i18n.number(row.gwh, row.gwh < 100 ? 1 : 0),
        people: i18n.number(row.people / 1e6, 2),
      }),
    },
    {
      value: t("solarHeadCardPlace", { place: row.place }),
      unit: t("solarHeadCardOf", { of: row.of }),
      label: t("solarHeadCardPlaceLabel"),
      note:
        row.place === 1
          ? t("solarHeadCardTop")
          : t("solarHeadCardFirst", {
              country: i18n.country(first.country),
              value: kwhEach(first.kwhPerPerson, i18n),
            }),
    },
  ];
  if (row.previous && row.previous.kwhPerPerson > 0) {
    figures.push({
      value: signed(Math.round((row.kwhPerPerson / row.previous.kwhPerPerson - 1) * 100), i18n),
      unit: "%",
      label: t("solarHeadCardChange", { year: row.previous.year }),
      note: t("solarHeadCardChangeNote", { value: kwhEach(row.previous.kwhPerPerson, i18n) }),
    });
  }
  return {
    title: t("solarHeadCardTitle"),
    subtitle: t("solarHeadCardYear", { country: i18n.country(row.country), year: row.year }),
    figures,
    footer: t(row.flags.length > 0 ? "solarHeadCardFooterProvisional" : "solarHeadCardFooter"),
  };
}
