import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AsyncState } from "../app/useAsync";
import { clampYear, stackedSeries, summarize, type Timeline, type TimelineScope } from "../data/timeline";
import { useI18n } from "../i18n";
import { PALETTES, type Theme } from "../map/palette";
import { CHART_H, CHART_W, stackAreas, stepMs, yearX } from "./timeChart";
import { ChartShare } from "../share/ChartShare";
import { timelineTable } from "../share/tables";
import styles from "./TimeBar.module.css";

interface Props {
  data: AsyncState<Timeline> | null;
  year: number;
  scope: TimelineScope;
  theme: Theme;
  /** null closes the time machine */
  onYear: (year: number | null) => void;
  onRetry: () => void;
}

/**
 * The time machine (Faza 18-3): a year on the map, played or chosen. The chart under the slider is the
 * capacity in operation by source over the whole timeline, so the year is always seen in its history.
 */
export function TimeBar({ data, year, scope, theme, onYear, onRetry }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const timeline = data?.status === "ready" ? data.value : null;

  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || !timeline) return;
    const timer = window.setTimeout(() => {
      if (year >= timeline.lastYear) {
        setPlaying(false);
        return;
      }
      onYear(year + 1);
      if (year + 1 >= timeline.lastYear) setPlaying(false);
    }, stepMs(year));
    return () => {
      window.clearTimeout(timer);
    };
  }, [playing, timeline, year, onYear]);

  const rows = useMemo(() => (timeline ? stackedSeries(timeline, scope) : []), [timeline, scope]);
  const chart = useMemo(() => stackAreas(rows), [rows]);
  const scopeName =
    scope.countries.size === 0
      ? t("energyRegion")
      : [...scope.countries].map((code) => i18n.country(code)).join(", ");

  let body;
  if (!data || data.status === "loading") {
    body = (
      <p className={styles.muted} role="status">
        {t("loadingData")}
      </p>
    );
  } else if (data.status === "error" || !timeline) {
    body = (
      <p className={styles.muted} role="alert">
        {t("timeFailed")}{" "}
        <button type="button" className={styles.link} onClick={onRetry}>
          {t("retry")}
        </button>
      </p>
    );
  } else {
    const shown = clampYear(timeline, year);
    const summary = summarize(timeline, scope, shown);
    const palette = PALETTES[theme];
    const go = (to: number): void => {
      setPlaying(false);
      onYear(clampYear(timeline, to));
    };
    const togglePlay = (): void => {
      if (playing) {
        setPlaying(false);
        return;
      }
      if (shown >= timeline.lastYear) onYear(timeline.firstYear);
      setPlaying(true);
    };
    const cursor = yearX(shown, timeline.firstYear, timeline.lastYear);
    body = (
      <>
        <div className={styles.controls}>
          <output className={styles.year} aria-live={playing ? "off" : "polite"}>
            {shown}.
          </output>
          <button
            type="button"
            className={styles.step}
            onClick={() => {
              go(shown - 1);
            }}
            disabled={shown <= timeline.firstYear}
            aria-label={t("timePrev")}
          >
            <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <input
            name="year"
            className={styles.slider}
            type="range"
            min={timeline.firstYear}
            max={timeline.lastYear}
            value={shown}
            aria-label={t("timeYear")}
            onChange={(event) => {
              go(Number(event.target.value));
            }}
          />
          <button
            type="button"
            className={styles.step}
            onClick={() => {
              go(shown + 1);
            }}
            disabled={shown >= timeline.lastYear}
            aria-label={t("timeNext")}
          >
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button type="button" className={styles.play} onClick={togglePlay} aria-pressed={playing}>
            {playing ? (
              <Pause size={14} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Play size={14} strokeWidth={1.75} aria-hidden="true" />
            )}
            {playing ? t("timePause") : t("timePlay")}
          </button>
        </div>
        <svg
          className={styles.chart}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={t("timeChart", { max: i18n.power(chart.max) })}
        >
          {chart.areas.map((area) => (
            <path key={area.technology} d={area.d} fill={palette.technology[area.technology]} />
          ))}
          <rect
            className={styles.future}
            x={cursor}
            y={0}
            width={Math.max(0, CHART_W - cursor)}
            height={CHART_H}
          />
          <line
            className={styles.cursor}
            x1={cursor}
            x2={cursor}
            y1={0}
            y2={CHART_H}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className={styles.axis} aria-hidden="true">
          <span>{timeline.firstYear}.</span>
          <span>{t("timeAxisMax", { max: i18n.power(chart.max) })}</span>
          <span>{timeline.lastYear}.</span>
        </div>
        <p className={styles.figure}>
          {t("timeOperating", { year: String(shown), mw: i18n.power(summary.operatingMw) })}
        </p>
        {summary.closedPlants > 0 && (
          <p className={styles.muted}>
            {t("timeClosed", { count: i18n.number(summary.closedPlants), mw: i18n.power(summary.closedMw) })}
            {summary.lastClosure &&
              ` ${t("timeLastClosure", {
                name: summary.lastClosure.name,
                year: String(summary.lastClosure.retiredYear),
              })}`}
          </p>
        )}
        {summary.undatedPlants > 0 && (
          <p className={styles.muted}>{t("timeUndated", { count: i18n.number(summary.undatedPlants) })}</p>
        )}
        <p className={styles.muted}>{t("timeNote")}</p>
      </>
    );
  }

  return (
    <section className={styles.bar} aria-label={t("timeTitle")}>
      <div className={styles.head}>
        <h2>{t("timeTitle")}</h2>
        {timeline && rows.length > 0 && (
          <ChartShare
            title={t("timeTitle")}
            subtitle={`${scopeName} · ${String(timeline.firstYear)}–${String(timeline.lastYear)}`}
            sources={[t("shareTimelineSource")]}
            dataDate={timeline.generatedAt}
            sourceLine={t("chartSourceLine", {
              source: t("shareTimelineSource"),
              date: i18n.date(timeline.generatedAt),
              site: window.location.host,
            })}
            table={() =>
              timelineTable(rows, timeline.firstYear, {
                year: t("csvYear"),
                technology: (tech) => i18n.technology(tech),
              })
            }
            placement="above"
          />
        )}
        <button
          type="button"
          className={styles.close}
          onClick={() => {
            setPlaying(false);
            onYear(null);
          }}
          aria-label={t("timeClose")}
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {body}
    </section>
  );
}
