import { useState } from "react";

import { useAsync } from "../app/useAsync";
import { fetchJson } from "../data/current";
import { StatsSchema, summarize } from "../data/stats";
import { isOneOf, SCOPE_COUNTRIES, type CountryCode } from "../domain";
import { useI18n } from "../i18n";
import { Skeleton } from "./Skeleton";
import { PALETTES, type Theme } from "../map/palette";
import styles from "./OverviewPanel.module.css";
import type { Spotlight } from "../map/spotlight";
import { spotHandlers } from "./spot";

interface Props {
  statsUrl: string;
  /** Country filter from the map; a single selected country becomes the default area. */
  countries: ReadonlySet<CountryCode>;
  theme: Theme;
  /** a row is pointed at (or left): the map lights that technology or voltage */
  onSpotlight?: (spotlight: Spotlight) => void;
}

type Area = CountryCode | "ALL";

export function OverviewPanel({ statsUrl, countries, theme, onSpotlight }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const palette = PALETTES[theme];
  const [choice, setChoice] = useState<Area | null>(null);
  const [only] = countries.size === 1 ? [...countries] : [];
  const area: Area = choice ?? only ?? "ALL";
  const [stats, retry] = useAsync(statsUrl, (signal) => fetchJson(statsUrl, StatsSchema, signal));

  if (!stats || stats.status === "loading") {
    return <Skeleton label={t("loadingData")} rows={6} />;
  }
  if (stats.status === "error") {
    return (
      <p className={styles.muted} role="alert">
        {t("overviewFailed")}{" "}
        <button type="button" className={styles.link} onClick={retry}>
          {t("retry")}
        </button>
      </p>
    );
  }

  const summary = summarize(stats.value, area, SCOPE_COUNTRIES);
  const largest = Math.max(1, ...summary.technologies.map((row) => row.operatingMw + row.pipelineMw));
  const plants = summary.technologies.reduce((sum, row) => sum + row.plants, 0);

  return (
    <div className={styles.overview}>
      <label className={styles.area}>
        <span>{t("overviewScope")}</span>
        <select
          value={area}
          onChange={(event) => {
            const value = event.target.value;
            setChoice(value === "ALL" || isOneOf(SCOPE_COUNTRIES, value) ? value : "ALL");
          }}
        >
          <option value="ALL">{t("overviewRegion")}</option>
          {SCOPE_COUNTRIES.map((code) => (
            <option key={code} value={code}>
              {i18n.country(code)}
            </option>
          ))}
        </select>
      </label>

      <h3 className={styles.heading}>{t("overviewTitle")}</h3>
      {summary.technologies.length === 0 ? (
        <p className={styles.muted}>{t("overviewEmpty")}</p>
      ) : (
        <>
          <dl className={styles.totals}>
            <div>
              <dt>{t("overviewTotal")}</dt>
              <dd className={styles.big}>{i18n.power(summary.operatingMw)}</dd>
            </div>
            <div>
              <dt>{t("overviewPipeline")}</dt>
              <dd>{i18n.power(summary.pipelineMw)}</dd>
            </div>
          </dl>
          <p className={styles.muted}>{i18n.plural("overviewPlants", plants)}</p>

          <ul className={styles.bars}>
            {summary.technologies.map((row) => {
              const color = palette.technology[row.technology];
              return (
                <li
                  key={row.technology}
                  {...spotHandlers(onSpotlight, { kind: "technology", value: row.technology })}
                >
                  <div className={styles.barHead}>
                    <span className={styles.dot} style={{ background: color }} aria-hidden="true" />
                    <span className={styles.name}>{i18n.technology(row.technology)}</span>
                    <span className={styles.value}>{i18n.power(row.operatingMw)}</span>
                  </div>
                  <div className={styles.track} aria-hidden="true">
                    <span style={{ width: `${(row.operatingMw / largest) * 100}%`, background: color }} />
                    <span
                      className={styles.pipeline}
                      style={{ width: `${(row.pipelineMw / largest) * 100}%`, color }}
                    />
                  </div>
                  {(row.pipelineMw > 0 || row.plantsWithoutCapacity > 0) && (
                    <p className={styles.sub}>
                      {[
                        row.pipelineMw > 0
                          ? `+${i18n.power(row.pipelineMw)} ${t("overviewPipeline").toLowerCase()}`
                          : null,
                        row.plantsWithoutCapacity > 0
                          ? t("overviewMissing", { count: i18n.number(row.plantsWithoutCapacity) })
                          : null,
                      ]
                        .filter(Boolean)
                        .join("; ")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {summary.lineKm.length > 0 && (
        <>
          <h3 className={styles.heading}>{t("overviewLines")}</h3>
          <ul className={styles.list}>
            {summary.lineKm.map(({ voltage, km }) => (
              <li key={voltage} {...spotHandlers(onSpotlight, { kind: "voltage", value: voltage })}>
                <span
                  className={styles.line}
                  style={{ background: palette.voltage[voltage] }}
                  aria-hidden="true"
                />
                <span className={styles.name}>{i18n.voltage(voltage)}</span>
                <span className={styles.value}>{i18n.km(km)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <dl className={styles.totals}>
        <div>
          <dt>{t("overviewSubstations")}</dt>
          <dd>{i18n.number(summary.substations)}</dd>
        </div>
        {summary.datacenters.count > 0 && (
          <div>
            <dt>{t("overviewDatacenters")}</dt>
            <dd>
              {i18n.number(summary.datacenters.count)}
              {summary.datacenters.withPower > 0 && (
                <span className={styles.muted}>
                  {" "}
                  {t("overviewDatacentersPower", {
                    power: i18n.power(summary.datacenters.powerMw),
                    count: i18n.number(summary.datacenters.withPower),
                  })}
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>

      <p className={styles.note}>{t("overviewNote")}</p>
    </div>
  );
}
