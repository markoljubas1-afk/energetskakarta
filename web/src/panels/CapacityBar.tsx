/**
 * The HEP ODS capacity layer's bar (Faza 25): how many substations sit in each acceptance band (the map's
 * legend), the date and source with HEP ODS's own note, and a clicked substation's card linking its page.
 * The wording of the bands and of the note is the capacity pages' (seo/capacityCopy.ts), so map and pages
 * say the same thing.
 */
import { X } from "lucide-react";

import type { AsyncState } from "../app/useAsync";
import { CATEGORIES, countByCategory, levelOf, stationSlugs, type HepLoad } from "../data/hep";
import { useI18n } from "../i18n";
import { PALETTES, type Theme } from "../map/palette";
import { CAPACITY_COPY } from "../seo/capacityCopy";
import { PATHS } from "../seo/pages";
import styles from "./CapacityBar.module.css";

interface Props {
  data: AsyncState<HepLoad> | null;
  theme: Theme;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onRetry: () => void;
  /** closes the whole bar by switching the layer off, as the live bar's and the time machine's ✕ do */
  onClose?: () => void;
}

export function CapacityBar({ data, theme, selected, onSelect, onRetry, onClose }: Props) {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const copy = CAPACITY_COPY[lang];
  if (!data || data.status === "loading") {
    return (
      <section className={styles.bar} aria-label={t("layer_capacity")}>
        <p className={styles.muted} role="status">
          {t("loadingData")}
        </p>
      </section>
    );
  }
  if (data.status === "error" || data.value.kind === "none") {
    return (
      <section className={styles.bar} aria-label={t("layer_capacity")}>
        <p className={styles.muted} role="alert">
          {data.status === "error" ? t("capFailed") : t("capNone")}{" "}
          {data.status === "error" && (
            <button type="button" className={styles.link} onClick={onRetry}>
              {t("retry")}
            </button>
          )}
        </p>
      </section>
    );
  }
  const { release } = data.value;
  const palette = PALETTES[theme].capacity;
  const counts = countByCategory(release.stations, "existing");
  const station = release.stations.find((candidate) => candidate.id === selected) ?? null;
  const slug = station ? stationSlugs(release).get(station.id) : undefined;
  const area = station ? release.areas.find((candidate) => candidate.id === station.area)?.name : undefined;
  const free = station && station.freeKw !== null ? i18n.power(station.freeKw / 1000) : null;
  const level = station ? levelOf(station) : null;

  return (
    <section className={styles.bar} aria-label={t("layer_capacity")}>
      <div className={styles.head}>
        <h2>{t("capTitle")}</h2>
        {onClose && (
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("capClose")}>
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>
      <ul className={styles.legend} aria-label={copy.categoriesHeading}>
        {CATEGORIES.map((category) => (
          <li key={category}>
            <i
              data-category={category}
              style={{
                background: palette[category],
                boxShadow: `0 0 0 1px ${category === "none" ? palette.noneRing : palette.ring}`,
              }}
              aria-hidden="true"
            />
            <span>{copy.category[category]}</span>
            <strong>{i18n.number(counts[category])}</strong>
          </li>
        ))}
      </ul>
      {station ? (
        <div className={styles.station}>
          <div className={styles.stationHead}>
            <h3>{station.label ?? station.name}</h3>
            <button
              type="button"
              className={styles.close}
              onClick={() => {
                onSelect(null);
              }}
              aria-label={t("capCloseStation")}
            >
              <X size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <p className={styles.muted}>
            {[level === "hv" ? "110/x kV" : level === "mv" ? "35/x kV" : null, area]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <dl className={styles.figures}>
            <div>
              <dt>{copy.columns.existing}</dt>
              <dd>{copy.category[station.existing]}</dd>
            </div>
            <div>
              <dt>{t("capUpgraded")}</dt>
              <dd>{copy.category[station.upgraded]}</dd>
            </div>
            {free && (
              <div>
                <dt>{t("capFree")}</dt>
                <dd>{free}</dd>
              </div>
            )}
          </dl>
          {slug && (
            <a className={styles.link} href={PATHS[lang].capacityStation(slug)}>
              {t("capStationPage")}
            </a>
          )}
        </div>
      ) : (
        <p className={styles.muted}>{t("capPick")}</p>
      )}
      <p className={styles.note}>
        {t("capSource", { date: i18n.date(release.dataDate) })}{" "}
        <a href={PATHS[lang].capacity}>{copy.linkText}</a>
      </p>
      <p className={styles.note}>{t("capDisclaimer")}</p>
    </section>
  );
}
