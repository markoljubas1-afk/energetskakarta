import { useState } from "react";

import { useAsync } from "../app/useAsync";
import type { Mix } from "../data/mix";
import { loadWeather, loadYearlyIrradiation, roundCoord, solarNowKw, yieldPerKwp } from "../data/weather";
import { useI18n } from "../i18n";
import styles from "./MixCard.module.css";

interface Props {
  /** Croatia's grid mix in the live hour: "the rest comes from the grid, which is now…" */
  mix: Mix | null;
  mapCenter: { lat: number; lng: number } | null;
}

interface Where {
  lat: number;
  lon: number;
  source: "device" | "map";
}

const PVGIS = "https://re.jrc.ec.europa.eu/pvg_tools/en/";

/**
 * "Near me" (Faza 19): the weather now, what a rooftop system makes now and in a year at the visitor's
 * place. The location is asked for only on a press, rounded to about a kilometre, sent only to Open-Meteo
 * and never stored. Rough by design: no shading and no roof orientation; PVGIS is linked for the exact sum.
 */
export function HereCard({ mix, mapCenter }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const [where, setWhere] = useState<Where | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [kwpText, setKwpText] = useState("10");
  const typed = Number(kwpText.replace(",", "."));
  const kwp = Number.isFinite(typed) && typed >= 1 && typed <= 1000 ? typed : 10;

  const key = where ? `${roundCoord(where.lat)},${roundCoord(where.lon)}` : null;
  const [weather] = useAsync(key && `weather:${key}`, (signal) =>
    loadWeather(where?.lat ?? 0, where?.lon ?? 0, signal),
  );
  const [year] = useAsync(key && `sun-year:${key}`, (signal) =>
    loadYearlyIrradiation(where?.lat ?? 0, where?.lon ?? 0, new Date(), signal),
  );

  const locate = (): void => {
    setProblem(null);
    if (!("geolocation" in navigator)) {
      setProblem(t("hereNoLocation"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setWhere({ lat: position.coords.latitude, lon: position.coords.longitude, source: "device" });
      },
      () => {
        setProblem(t("hereNoLocation"));
      },
      { maximumAge: 10 * 60_000, timeout: 10_000 },
    );
  };

  const top = mix ? mix.technologies.slice(0, 3) : [];
  const perKwp = year?.status === "ready" && year.value !== null ? yieldPerKwp(year.value) : null;

  return (
    <div className={styles.here}>
      <div className={styles.whereButtons}>
        <button type="button" onClick={locate}>
          {t("hereUseDevice")}
        </button>
        {mapCenter && (
          <button
            type="button"
            onClick={() => {
              setProblem(null);
              setWhere({ lat: mapCenter.lat, lon: mapCenter.lng, source: "map" });
            }}
          >
            {t("hereUseMap")}
          </button>
        )}
      </div>
      {problem && (
        <p className={styles.muted} role="alert">
          {problem}
        </p>
      )}
      {where && (
        <>
          <p className={styles.muted}>
            {t(where.source === "device" ? "herePlaceDevice" : "herePlaceMap", {
              lat: i18n.number(roundCoord(where.lat), 2),
              lon: i18n.number(roundCoord(where.lon), 2),
            })}
          </p>
          <label className={styles.kwp} htmlFor="here-kwp">
            {t("hereKwp")}
            <input
              id="here-kwp"
              type="number"
              min={1}
              max={1000}
              step={1}
              value={kwpText}
              onChange={(event) => {
                setKwpText(event.target.value);
              }}
            />
          </label>
          {weather?.status === "ready" ? (
            <p className={styles.figure}>
              {weather.value.day
                ? t("hereNow", {
                    cloud: i18n.percent(weather.value.cloudCover / 100),
                    sun: i18n.number(Math.round(weather.value.radiation)),
                    kw: i18n.number(solarNowKw(kwp, weather.value.radiation), 1),
                    kwp: i18n.number(kwp),
                  })
                : t("hereNight", { cloud: i18n.percent(weather.value.cloudCover / 100) })}
            </p>
          ) : weather?.status === "error" ? (
            <p className={styles.muted}>{t("hereWeatherFailed")}</p>
          ) : (
            <p className={styles.muted} role="status">
              {t("loadingData")}
            </p>
          )}
          {top.length > 0 && (
            <p className={styles.muted}>
              {t("hereRest", {
                list: top
                  .map((part) => `${t(`tech_${part.technology}`).toLowerCase()} ${i18n.percent(part.share)}`)
                  .join(", "),
              })}
            </p>
          )}
          {perKwp !== null ? (
            <p className={styles.figure}>
              {t("hereYear", {
                perKwp: i18n.number(Math.round(perKwp / 10) * 10),
                total: i18n.number(Math.round((perKwp * kwp) / 100) * 100),
                kwp: i18n.number(kwp),
              })}
            </p>
          ) : year?.status === "error" || (year?.status === "ready" && year.value === null) ? (
            <p className={styles.muted}>{t("hereYearFailed")}</p>
          ) : null}
          <p className={styles.note}>
            {t("hereRough")}{" "}
            <a href={PVGIS} target="_blank" rel="noopener">
              PVGIS
            </a>
            . {t("herePrivacy")}{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noopener">
              Open-Meteo.com
            </a>{" "}
            (CC BY 4.0).
          </p>
        </>
      )}
    </div>
  );
}
