import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { AsyncState } from "../app/useAsync";
import { dayOf, flowsAt, hourKey, pricesAt, type Live, type LiveLoad } from "../data/live";
import { useI18n } from "../i18n";
import { PALETTES, type Theme } from "../map/palette";
import { PRICE_LEGEND_TICKS, priceGradient, priceTickAt } from "../map/priceScale";
import styles from "./LiveBar.module.css";
import { MixCard } from "./MixCard";

interface Props {
  data: AsyncState<LiveLoad> | null;
  index: number;
  theme: Theme;
  /** where the map is looking, for "near me" when the visitor does not share a location */
  mapCenter?: { lat: number; lng: number } | null;
  onHour: (key: string) => void;
  onRetry: () => void;
  /** turns the live layer off; without it the bar has no close button */
  onClose?: () => void;
}

const DAY_KEYS = { [-1]: "liveYesterday", 0: "liveToday", 1: "liveTomorrow" } as const;
/** One hour per step while a day plays: slow enough to read the map, a day in about 20 seconds. */
export const PLAY_STEP_MS = 850;

/** First and last index of the calendar day (in the document's local time) that `index` falls on. */
export function dayRange(live: Live, index: number): [number, number] {
  const day = live.hours[index]?.slice(0, 10);
  let first = index;
  let last = index;
  while (first > 0 && live.hours[first - 1]?.slice(0, 10) === day) first--;
  while (last < live.hours.length - 1 && live.hours[last + 1]?.slice(0, 10) === day) last++;
  return [first, last];
}

export function LiveBar({ data, index, theme, mapCenter = null, onHour, onRetry, onClose }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const ready = data?.status === "ready" && data.value.kind === "ready" ? data.value.live : null;

  // "Play the day": one hour per step to the end of the selected day. Each step is a normal hour change,
  // so the URL, the map and the table follow; a visitor's own choice of hour stops it (Faza 18-2).
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || !ready) return;
    const [, end] = dayRange(ready, index);
    const timer = window.setTimeout(() => {
      const next = ready.hours[index + 1];
      if (index >= end || !next) {
        setPlaying(false);
        return;
      }
      onHour(hourKey(next));
      if (index + 1 >= end) setPlaying(false);
    }, PLAY_STEP_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [playing, ready, index, onHour]);

  let body;
  if (!data || data.status === "loading") {
    body = (
      <p className={styles.muted} role="status">
        {t("loadingData")}
      </p>
    );
  } else if (data.status === "error") {
    body = (
      <p className={styles.muted} role="alert">
        {t("liveFailed")}{" "}
        <button type="button" className={styles.link} onClick={onRetry}>
          {t("retry")}
        </button>
      </p>
    );
  } else if (data.value.kind === "none") {
    body = <p className={styles.muted}>{t("liveNoData")}</p>;
  } else {
    const live = data.value.live;
    const last = live.hours.length - 1;
    const hour = live.hours[index] ?? "";
    const label = `${t(DAY_KEYS[dayOf(live, index)])} ${hour.slice(11, 16)}`;
    const go = (to: number): void => {
      setPlaying(false);
      const target = live.hours[Math.max(0, Math.min(last, to))];
      if (target) onHour(hourKey(target));
    };
    const togglePlay = (): void => {
      if (playing) {
        setPlaying(false);
        return;
      }
      const [first, end] = dayRange(live, index);
      // at the day's last hour, playing starts the day again
      if (index >= end) {
        const start = live.hours[first];
        if (start) onHour(hourKey(start));
      }
      setPlaying(true);
    };
    const stops = PALETTES[theme].price.stops;
    const flows = flowsAt(live, index);
    const prices = pricesAt(live, index);
    const noMarket = live.missing.prices.filter((zone) => zone.length === 2);
    const value = (text: string | null): string => text ?? t("energyNoValue");
    body = (
      <>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.step}
            onClick={() => {
              go(index - 1);
            }}
            disabled={index <= 0}
            aria-label={t("livePrev")}
          >
            <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <input
            className={styles.slider}
            type="range"
            min={0}
            max={last}
            value={index}
            aria-label={t("liveHour")}
            aria-valuetext={label}
            onChange={(event) => {
              go(Number(event.target.value));
            }}
          />
          <button
            type="button"
            className={styles.step}
            onClick={() => {
              go(index + 1);
            }}
            disabled={index >= last}
            aria-label={t("liveNext")}
          >
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <output className={styles.hour} aria-live={playing ? "off" : "polite"}>
            {label}
          </output>
          <button type="button" className={styles.play} onClick={togglePlay} aria-pressed={playing}>
            {playing ? (
              <Pause size={14} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Play size={14} strokeWidth={1.75} aria-hidden="true" />
            )}
            {playing ? t("livePause") : t("livePlayDay")}
          </button>
        </div>
        {prices.some((price) => price.eur !== null) && (
          <div className={styles.scale}>
            <span className={styles.scaleLabel}>{t("livePriceScale")}</span>
            <span
              className={styles.scaleBar}
              style={{ background: priceGradient(stops) }}
              aria-hidden="true"
            />
            <span className={styles.scaleTicks} aria-hidden="true">
              {PRICE_LEGEND_TICKS.map((eur) => (
                <span key={eur} style={{ left: `${(priceTickAt(eur) * 100).toFixed(1)}%` }}>
                  {i18n.number(eur)}
                </span>
              ))}
            </span>
            <span className={styles.scaleLabel}>{t("livePriceNoColor")}</span>
            <span className={styles.scaleLabel}>{t("livePriceItaly")}</span>
          </div>
        )}
        <MixCard
          live={live}
          index={index}
          theme={theme}
          mapCenter={mapCenter}
          hourLabel={(i) => `${t(DAY_KEYS[dayOf(live, i)])} ${(live.hours[i] ?? "").slice(11, 16)}`}
        />
        <p className={styles.muted}>
          {t("liveLegend")} {t("liveUpdated", { time: i18n.dateTime(live.generatedAt) })}
        </p>
        <details className={styles.details}>
          <summary>{t("liveTable")}</summary>
          <div className={styles.tables}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("liveBorder")}</th>
                  <th scope="col">{t("liveNetFlow")}</th>
                </tr>
              </thead>
              <tbody>
                {flows.map((flow) => (
                  <tr key={`${flow.from}-${flow.to}`}>
                    <th scope="row">
                      {i18n.country(flow.from)} → {i18n.country(flow.to)}
                    </th>
                    <td>{value(flow.mw === null ? null : `${i18n.number(flow.mw)} ${t("unitMw")}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("detailsCountry")}</th>
                  <th scope="col">{t("liveZone")}</th>
                  <th scope="col">{t("livePrice")}</th>
                </tr>
              </thead>
              <tbody>
                {prices.map((price) => (
                  <tr key={price.country}>
                    <th scope="row">{i18n.country(price.country)}</th>
                    <td>{price.zone.replace("_", " ")}</td>
                    <td>
                      {value(price.eur === null ? null : `${i18n.number(price.eur, 2)} ${t("unitEurMwh")}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {noMarket.length > 0 && (
            <p className={styles.muted}>
              {t("liveNoMarket", { list: noMarket.map((c) => i18n.country(c)).join(", ") })}
            </p>
          )}
          {live.missing.flows.length > 0 && (
            <p className={styles.muted}>
              {t("liveNoFlows", {
                list: live.missing.flows
                  .map((pair) =>
                    pair
                      .split("-")
                      .map((c) => i18n.country(c))
                      .join(" – "),
                  )
                  .join(", "),
              })}
            </p>
          )}
        </details>
      </>
    );
  }

  const fixture = data?.status === "ready" && data.value.kind === "ready" && data.value.live.fixture;
  return (
    <section className={styles.bar} aria-label={t("liveTitle")}>
      <div className={styles.head}>
        <h2>{t("liveTitle")}</h2>
        {fixture && <span className={styles.fixture}>{t("liveFixture")}</span>}
        {onClose && (
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("liveClose")}>
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>
      {body}
    </section>
  );
}
