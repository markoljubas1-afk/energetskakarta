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
import type { Renewables } from "../data/eurostat";
import type { Live } from "../data/live";
import { isOneOf, SCOPE_COUNTRIES, type CountryCode, type Technology } from "../domain";
import { useI18n } from "../i18n";
import { PopoverMenu } from "../share/PopoverMenu";
import { Goal2030 } from "./Goal2030";
import styles from "./GreenLight.module.css";

interface Props {
  live: Live;
  now: Date;
  /** show on the map what generates the most in the chosen country right now */
  onShow: (country: CountryCode, technology: Technology) => void;
  /** the learning page, which explains why the hour matters */
  learnHref: string;
  /** Eurostat's official yearly shares, for the 2030 target under the hour's figure; null: not loaded */
  renewables?: Renewables | null;
  /** Croatia's transition page, which says more about the target */
  transitionHref?: string;
}

const percent = (share: number): number => Math.round(share * 100);

/**
 * "How green is the electricity right now" (Faza 36): one coloured dot and a number in the status bar, and
 * behind it what the number is, what it is not, and how it compares with the same hour yesterday. Figures
 * older than a few hours are shown without a colour: a traffic light must not show the afternoon at night.
 */
export function GreenLight({ live, now, onShow, learnHref, renewables = null, transitionHref }: Props) {
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
  return (
    <PopoverMenu
      label={t("greenLabel", { country: i18n.country(country), share })}
      triggerClassName={styles.trigger}
      menuClassName={styles.menu}
      placement="above"
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
          <div>
            <dt>{t("greenHour")}</dt>
            <dd>{stale ? t("greenStale", { hour, hours: age }) : t("greenFresh", { hour })}</dd>
          </div>
        </dl>
        <button
          type="button"
          className={styles.show}
          onClick={() => {
            onShow(country, green.top.technology);
          }}
        >
          {t("greenShow", { technology: t(`tech_${green.top.technology}`).toLowerCase() })}
        </button>
        <p className={styles.note}>
          {t("greenNote", { mid: percent(BAND_LIMITS.mid), high: percent(BAND_LIMITS.high) })}{" "}
          <a href={learnHref}>{t("greenWhy")}</a>
        </p>
        {renewables && (
          <Goal2030
            country={country}
            renewables={renewables}
            {...(country === "HR" && transitionHref ? { moreHref: transitionHref } : {})}
          />
        )}
      </div>
    </PopoverMenu>
  );
}
