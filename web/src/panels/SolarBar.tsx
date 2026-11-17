import { X } from "lucide-react";

import type { AsyncState } from "../app/useAsync";
import { levelOf, NEAR_STATION_KM, nearestStation, stationSlugs, type HepLoad } from "../data/hep";
import { valueAt, type SolarLoad } from "../data/solar";
import { useI18n } from "../i18n";
import { CAPACITY_COPY } from "../seo/capacityCopy";
import { PATHS } from "../seo/pages";
import styles from "./SolarBar.module.css";

interface Props {
  data: AsyncState<SolarLoad> | null;
  /** where the reader last clicked on the map, or null */
  point: { lng: number; lat: number } | null;
  onRetry: () => void;
  /** switches the layer off */
  onClose: () => void;
  /** HEP ODS's capacity release, loaded alongside: the nearest substation to the clicked place */
  capacity?: AsyncState<HepLoad> | null;
  /** shows a substation on the capacity layer */
  onStation?: (id: string) => void;
}

/** The European Commission's free calculator for a particular roof or plot (tilt, orientation, shading). */
export const PVGIS_URL = "https://re.jrc.ec.europa.eu/pvg_tools/en/";

/**
 * The solar potential layer's bar (Faza 34-2): what the colours mean, the value at the place the reader
 * clicked, and what the number is not. The figures are a model's long-term averages from the Global Solar
 * Atlas; the bar never lets them stand without that.
 */
export function SolarBar({ data, point, onRetry, onClose, capacity = null, onStation }: Props) {
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
      {point !== null && value !== null && (
        <>
          <Station capacity={capacity} point={point} {...(onStation ? { onStation } : {})} />
          <p className={styles.next}>
            {t("solarPvgis")}{" "}
            <a href={PVGIS_URL} target="_blank" rel="noopener noreferrer">
              PVGIS
            </a>{" "}
            {t("solarPvgisPlace", { lat: point.lat.toFixed(4), lng: point.lng.toFixed(4) })}
          </p>
        </>
      )}
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

/**
 * The nearest HEP ODS substation to the clicked place and what HEP ODS says about its room for new plants:
 * sun alone does not make a site. Croatia only, because only HEP ODS publishes this; elsewhere the bar says so.
 */
function Station({
  capacity,
  point,
  onStation,
}: {
  capacity: AsyncState<HepLoad> | null;
  point: { lng: number; lat: number };
  onStation?: (id: string) => void;
}) {
  const i18n = useI18n();
  const { t, lang } = i18n;
  // still loading, or nothing published: the reading above stands on its own
  if (capacity === null || capacity.status === "loading") return null;
  if (capacity.status === "error") return <p className={styles.note}>{t("capFailed")}</p>;
  if (capacity.value.kind === "none") return null;
  const { release } = capacity.value;
  const near = nearestStation(release, point.lng, point.lat);
  if (near === null) return <p className={styles.note}>{t("solarStationNone", { km: NEAR_STATION_KM })}</p>;
  const { station, km } = near;
  const copy = CAPACITY_COPY[lang];
  const level = levelOf(station);
  const slug = stationSlugs(release).get(station.id);
  return (
    <div className={styles.station}>
      <h3>{t("solarStation")}</h3>
      <p>
        <strong>{station.name}</strong>
        {station.label !== null && ` (${station.label})`}
        {level === "hv" ? " · 110/x kV" : level === "mv" ? " · 35/x kV" : ""} ·{" "}
        {t("solarStationAway", { km: i18n.number(km, km < 10 ? 1 : 0) })}
      </p>
      <p>
        {copy.category[station.existing]}
        {station.freeKw !== null &&
          station.freeKw > 0 &&
          `, ${t("capFree").toLowerCase()} ${i18n.power(station.freeKw / 1000)}`}
      </p>
      <p className={styles.links}>
        {onStation && (
          <button
            type="button"
            className={styles.retry}
            onClick={() => {
              onStation(station.id);
            }}
          >
            {t("solarStationShow")}
          </button>
        )}
        {slug && <a href={PATHS[lang].capacityStation(slug)}>{t("capStationPage")}</a>}
      </p>
      <p className={styles.note}>{t("solarStationNote", { date: i18n.date(release.dataDate) })}</p>
    </div>
  );
}
