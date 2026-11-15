import { Download, TriangleAlert } from "lucide-react";

import { assetUrl, type Current } from "../data/current";
import { DOWNLOAD_KEYS } from "../domain";
import { useI18n } from "../i18n";
import { DOWNLOAD_LABELS } from "../i18n/labels";
import type { Basemap } from "../map/basemap";
import type { MapApi } from "../map/MapView";
import { PopoverMenu } from "../share/PopoverMenu";
import { ShareMenu } from "./ShareMenu";
import styles from "./StatusBar.module.css";

/** MapTiler's terms require their logo on maps that use their basemap. */
export const MAPTILER_LOGO_URL = "https://api.maptiler.com/resources/logo.svg";

/** Weekly updates (osm-scheduled): older than two missed runs means the automation has stopped. */
export const STALE_AFTER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export function dataAgeDays(createdAt: string, now: Date): number {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) ? Math.floor((now.getTime() - created) / DAY_MS) : 0;
}

interface Props {
  current: Current;
  dataBaseUrl: URL;
  basemap: Basemap["kind"] | null;
  /** A MapTiler key is configured, so the fallback basemap means MapTiler failed. */
  basemapExpected: boolean;
  /** The map, once it is up: the share menu copies its link and saves its picture. */
  map: MapApi | null;
  /** Injected in tests; defaults to the current time. */
  now?: Date;
}

export function StatusBar({ current, dataBaseUrl, basemap, basemapExpected, map, now = new Date() }: Props) {
  const { t, date, locale } = useI18n();
  // phones get the numeric date: the long one alone would fill the single row the bar has there
  const shortDate = new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(
    new Date(current.createdAt),
  );
  const age = dataAgeDays(current.createdAt, now);
  const stale = age > STALE_AFTER_DAYS;
  return (
    <div className={styles.bar}>
      {basemap === "maptiler" && (
        <a className={styles.logo} href="https://www.maptiler.com" target="_blank" rel="noopener noreferrer">
          <img src={MAPTILER_LOGO_URL} alt="MapTiler" height={18} />
        </a>
      )}
      <span
        className={stale ? styles.notice : styles.item}
        role={stale ? "status" : undefined}
        data-data-version=""
      >
        {stale && <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" />}
        <span className={styles.wide}>{t("dataVersion", { date: date(current.createdAt) })}</span>
        <span className={styles.narrow}>{t("dataVersion", { date: shortDate })}</span>
        {stale && ` ${t("dataStale", { days: age })}`}
      </span>
      <PopoverMenu
        label={t("download")}
        triggerClassName={styles.trigger}
        menuClassName={styles.menu}
        placement="above"
        trigger={
          <>
            <Download size={14} strokeWidth={1.75} aria-hidden="true" />
            <span className={styles.wide}>{t("download")}</span>
          </>
        }
      >
        <p>{t("downloadTitle")}</p>
        <ul>
          {DOWNLOAD_KEYS.map((layer) => {
            const key = current.downloads[layer];
            // optional layers are only listed when the build has them
            if (key === undefined) return null;
            return (
              <li key={layer}>
                <a href={assetUrl(dataBaseUrl, key)} download>
                  {t(DOWNLOAD_LABELS[layer])}
                </a>
              </li>
            );
          })}
        </ul>
      </PopoverMenu>
      <ShareMenu map={map} />
      {basemapExpected && basemap === "fallback" && (
        <span className={styles.notice} role="status">
          <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
          {t("basemapFallback")}
        </span>
      )}
    </div>
  );
}
