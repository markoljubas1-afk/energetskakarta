import { useState } from "react";

import {
  ageHours,
  band,
  BAND_LIMITS,
  changeFromYesterday,
  greenCountries,
  latestGreen,
  STALE_AFTER_HOURS,
} from "../data/greenShare";
import { carbonAt, FACTORS_SOURCE, shownGrams } from "../data/carbon";
import type { Renewables } from "../data/eurostat";
import { compare, type Households } from "../data/households";
import { pricesAt, type Live } from "../data/live";
import { usualFor, type Usual } from "../data/usual";
import { isOneOf, SCOPE_COUNTRIES, type CountryCode, type Technology } from "../domain";
import { useI18n } from "../i18n";
import { closeMenuOf, PopoverMenu } from "../share/PopoverMenu";
import { Goal2030 } from "./Goal2030";
import styles from "./GreenLight.module.css";

interface Props {
  live: Live;
  now: Date;
  /** show on the map what generates the most in the chosen country right now */
  onShow: (country: CountryCode, technology: Technology) => void;
  /** show on the map the country's operating plants on the given fossil fuels */
  onShowFossil?: (country: CountryCode, technologies: Technology[]) => void;
  /** the learning page, which explains why the hour matters */
  learnHref: string;
  /** Eurostat's official yearly shares, for the 2030 target under the hour's figure; null: not loaded */
  renewables?: Renewables | null;
  /** households' yearly electricity use (Eurostat), the yardstick for the megawatts; null: not loaded */
  households?: Households | null;
  /** what is usual for each country over the last year (data/usual.ts); null: not loaded */
  usual?: Usual | null;
  /** Croatia's transition page, which says more about the target */
  transitionHref?: string;
  /** show on the map the wind and solar plants being built and planned in the chosen country */
  onShowComing?: (country: CountryCode) => void;
  /** the card has been opened: the moment to ask for the yearly shares */
  onOpen?: () => void;
}

const percent = (share: number): number => Math.round(share * 100);

/**
 * "How green is the electricity right now" (Faza 36): one coloured dot and a number in the status bar, and
 * behind it what the number is, what it is not, and how it compares with the same hour yesterday. Figures
 * older than a few hours are shown without a colour: a traffic light must not show the afternoon at night.
 */
export function GreenLight({
  live,
  now,
  onShow,
  onShowFossil,
  learnHref,
  renewables = null,
  households = null,
  usual = null,
  transitionHref,
  onShowComing,
  onOpen,
}: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const countries = greenCountries(live).filter((code): code is CountryCode =>
    isOneOf(SCOPE_COUNTRIES, code),
  );
  const [chosen, setChosen] = useState<CountryCode>("HR");
  const country = countries.includes(chosen) ? chosen : countries[0];
  const green = country ? latestGreen(live, country, now) : null;
  if (!country || !green) return null;

  const age = ageHours(green, now);
  const stale = age > STALE_AFTER_HOURS;
  const state = stale ? "stale" : band(green.share);
  const change = changeFromYesterday(live, country, green);
  const hour = new Intl.DateTimeFormat(i18n.locale, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(green.hour),
  );
  const share = percent(green.share);
  // a calculation from the same hour's generation and published factors (data/carbon.ts), not a measurement
  const carbon = carbonAt(live, country, green.index);
  const fossil = carbon?.fossil ?? [];
  // the country's own yardstick, in words: the colour above stays the same fixed scale for every country
  const range = usual && !stale ? usualFor(usual, country, green.share) : null;
  // the day-ahead price of the same hour, where the country has a market: a green hour is often a cheap one
  const price = pricesAt(live, green.index).find((row) => row.country === country)?.eur ?? null;
  return (
    <PopoverMenu
      label={t("greenLabel", { country: i18n.country(country), share })}
      triggerClassName={styles.trigger}
      menuClassName={styles.menu}
      placement="above"
      {...(onOpen ? { onOpen } : {})}
      trigger={
        <>
          <span className={styles.dot} data-state={state} aria-hidden="true" />
          <span>
            {country} {share} %
          </span>
          <span className={styles.wide}>{t("greenShort", { hour })}</span>
        </>
      }
    >
      <div className={styles.card} data-green={state}>
        <p className={styles.kicker}>{t("greenTitle")}</p>
        <label className={styles.country}>
          <span className={styles.hidden}>{t("greenCountry")}</span>
          <select
            name="green-country"
            value={country}
            onChange={(event) => {
              const next = event.target.value;
              if (isOneOf(SCOPE_COUNTRIES, next)) setChosen(next);
            }}
          >
            {countries.map((code) => (
              <option key={code} value={code}>
                {i18n.country(code)}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.number}>
          <span className={styles.dot} data-state={state} aria-hidden="true" />
          <strong>{share} %</strong>
          <span>{t("greenOf")}</span>
        </p>
        <p className={styles.meaning}>{t(`green_${state}`)}</p>
        {range && (
          <p className={styles.usual}>
            {t("usualRange", {
              subject: t(`usualFor_${country}`),
              low: percent(range.low),
              high: percent(range.high),
            })}{" "}
            <strong>{t(`usual_${range.against}`)}</strong>
          </p>
        )}
        <dl className={styles.facts}>
          <div>
            <dt>{t("greenTop")}</dt>
            <dd>
              {t(`tech_${green.top.technology}`)}, {i18n.number(green.top.mw, 0)} MW
            </dd>
          </div>
          {change !== null && (
            <div>
              <dt>{t("greenYesterday")}</dt>
              <dd>{t(change >= 0 ? "greenMore" : "greenLess", { points: Math.abs(percent(change)) })}</dd>
            </div>
          )}
          {price !== null && (
            <div>
              <dt>{t("greenPrice")}</dt>
              <dd>
                {i18n.number(price, 2)} {t("unitEurMwh")}
              </dd>
            </div>
          )}
          {carbon && (
            <div>
              <dt>{t("carbonLabel")}</dt>
              <dd>{t("carbonValue", { grams: i18n.number(shownGrams(carbon), 0) })}</dd>
            </div>
          )}
          <div>
            <dt>{t("greenHour")}</dt>
            <dd>{stale ? t("greenStale", { hour, hours: age }) : t("greenFresh", { hour })}</dd>
          </div>
        </dl>
        {households && <Megawatts households={households} country={country} mw={green.renewableMw} />}
        {price !== null && price <= 0 && (
          <p className={styles.free} role="note">
            {t("greenFree")} <a href={learnHref}>{t("freeWhy")}</a>
          </p>
        )}
        <button
          type="button"
          className={styles.show}
          onClick={(event) => {
            closeMenuOf(event.currentTarget);
            onShow(country, green.top.technology);
          }}
        >
          {t("greenShow", { technology: t(`tech_${green.top.technology}`).toLowerCase() })}
        </button>
        {onShowFossil && fossil.length > 0 && (
          <button
            type="button"
            className={styles.show}
            onClick={(event) => {
              closeMenuOf(event.currentTarget);
              onShowFossil(country, fossil);
            }}
          >
            {t("carbonShow", {
              fuels: fossil.map((technology) => t(`tech_${technology}`).toLowerCase()).join(", "),
            })}
          </button>
        )}
        {carbon && (
          <details className={styles.how}>
            <summary>{t("carbonHow")}</summary>
            <p>
              {t("carbonNote")}{" "}
              <a href={FACTORS_SOURCE.url} target="_blank" rel="noopener noreferrer">
                {FACTORS_SOURCE.name}
              </a>
              .
            </p>
          </details>
        )}
        <p className={styles.note}>
          {t("greenNote", { mid: percent(BAND_LIMITS.mid), high: percent(BAND_LIMITS.high) })}{" "}
          <a href={learnHref}>{t("greenWhy")}</a>
        </p>
        {renewables && (
          <Goal2030
            country={country}
            renewables={renewables}
            {...(country === "HR" && transitionHref ? { moreHref: transitionHref } : {})}
            {...(onShowComing
              ? {
                  onShowComing: () => {
                    onShowComing(country);
                  },
                }
              : {})}
          />
        )}
      </div>
    </PopoverMenu>
  );
}

/** From this multiple on, "so many times" reads better than a percentage. */
const TIMES_FROM = 1.05;

/**
 * "What do these megawatts mean" (prijedlog vlasnika 2026-11-17): what the country's renewable plants generate
 * in the hour, held against the average power all its households draw (their yearly use from Eurostat,
 * divided by the hours of the year). An official yardstick, not an invented appliance; "on average" is part
 * of the sentence, because households use more in the evening and in winter.
 */
function Megawatts({ households, country, mw }: { households: Households; country: string; mw: number }) {
  const i18n = useI18n();
  const { t } = i18n;
  const found = mw > 0 ? compare(households, country, mw) : null;
  if (!found) return null;
  const values = {
    mw: i18n.number(mw, 0),
    average: i18n.number(found.power.mw, 0),
    year: found.power.year,
  };
  return (
    <p className={styles.megawatts}>
      {found.ratio >= TIMES_FROM
        ? t("megawattsTimes", { ...values, times: i18n.number(found.ratio, 1) })
        : t("megawattsShare", { ...values, share: Math.round(found.ratio * 100) })}{" "}
      <a href={households.sourceUrl} target="_blank" rel="noopener noreferrer">
        Eurostat
      </a>
      .
    </p>
  );
}
