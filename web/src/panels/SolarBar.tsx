import { X } from "lucide-react";

import type { AsyncState } from "../app/useAsync";
import { valueAt, type SolarLoad } from "../data/solar";
import { useI18n } from "../i18n";
import styles from "./SolarBar.module.css";

interface Props {
  data: AsyncState<SolarLoad> | null;
  /** where the reader last clicked on the map, or null */
  point: { lng: number; lat: number } | null;
  onRetry: () => void;
  /** switches the layer off */
  onClose: () => void;
}

/**
 * The solar potential layer's bar (Faza 34-2): what the colours mean, the value at the place the reader
 * clicked, and what the number is not. The figures are a model's long-term averages from the Global Solar
 * Atlas; the bar never lets them stand without that.
 */
export function SolarBar({ data, point, onRetry, onClose }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const close = (
    <button type="button" className={styles.close} onClick={onClose} aria-label={t("solarClose")}>
      <X size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
  const head = (
    <div className={styles.head}>
      <h2>{t("solarTitle")}</h2>
      {close}
    </div>
  );
  if (data === null || data.status === "loading") {
    return (
      <section className={styles.bar} aria-label={t("layer_solar")}>
        {head}
        <p className={styles.muted} role="status">
          {t("loadingData")}
        </p>
      </section>
    );
  }
  if (data.status === "error") {
    return (
      <section className={styles.bar} aria-label={t("layer_solar")}>
        {head}
        <p className={styles.muted} role="alert">
          {t("solarFailed")}{" "}
          <button type="button" className={styles.retry} onClick={onRetry}>
            {t("retry")}
          </button>
        </p>
      </section>
    );
  }
  if (data.value.kind === "none") {
    return (
      <section className={styles.bar} aria-label={t("layer_solar")}>
        {head}
        <p className={styles.muted}>{t("solarNone")}</p>
      </section>
    );
  }
  const solar = data.value.solar;
  const value = point ? valueAt(solar, point.lng, point.lat) : null;
  const first = solar.ramp[0];
  const last = solar.ramp[solar.ramp.length - 1];
  const span = first && last ? last[0] - first[0] : 1;
  // the picture's own colours, at their own positions along the scale
  const gradient = `linear-gradient(90deg, ${solar.ramp
    .map(([stop, colour]) => `${colour} ${((((stop - (first?.[0] ?? 0)) / span) * 100) | 0).toString()}%`)
    .join(", ")})`;
  return (
    <section className={styles.bar} aria-label={t("layer_solar")}>
      {head}
      <div className={styles.reading} aria-live="polite">
        {point === null ? (
          <p className={styles.muted}>{t("solarHint")}</p>
        ) : value === null ? (
          <p className={styles.muted}>{t("solarNoValue")}</p>
        ) : (
          <>
            <p className={styles.value}>
              <strong>{i18n.number(value, 0)}</strong> {t("solarUnit")}
            </p>
            <p>{t("solarMeaning", { value: i18n.number(value, 0) })}</p>
          </>
        )}
      </div>
      <div className={styles.legend}>
        <span className={styles.scale} style={{ background: gradient }} aria-hidden="true" />
        <span className={styles.ends}>
          <span>{first ? i18n.number(first[0], 0) : ""}</span>
          <span>{t("solarLegend")}</span>
          <span>{last ? i18n.number(last[0], 0) : ""}</span>
        </span>
      </div>
      <p className={styles.note}>{t("solarCaveat")}</p>
      <p className={styles.note}>{solar.attribution}</p>
    </section>
  );
}
