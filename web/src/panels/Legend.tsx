import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { BAND_LIMITS } from "../data/greenShare";
import { SUBSTANCES, TECHNOLOGIES, VOLTAGE_CLASSES } from "../domain";
import { useI18n } from "../i18n";
import { NOTHING_IN_VIEW, type InView } from "../map/inView";
import type { Spotlight } from "../map/spotlight";
import { spotHandlers } from "./spot";
import { PALETTES, type Theme } from "../map/palette";
import styles from "./Legend.module.css";

interface Props {
  theme: Theme;
  /** Start collapsed (e.g. while the details panel occupies the same side of the screen). */
  compact: boolean;
  /** The distribution layer is on, so voltages below 60 kV can actually appear on the map. */
  distribution: boolean;
  /** The charging stations layer is on. */
  chargers: boolean;
  /** the stations are coloured by how green their country's electricity is right now */
  chargersBanded?: boolean;
  /** The extraction sites layer is on. */
  extraction: boolean;
  /** The gas production layer is on. */
  gas: boolean;
  /** The cities layer is on. */
  cities: boolean;
  /** what the map is showing right now; kinds that are not on screen are played down */
  inView?: InView;
  /** a row is pointed at (or left): the map lights that voltage or technology */
  onSpotlight?: (spotlight: Spotlight) => void;
}

export function Legend({
  theme,
  compact,
  distribution,
  chargers,
  chargersBanded = false,
  extraction,
  gas,
  cities,
  inView = NOTHING_IN_VIEW,
  onSpotlight,
}: Props) {
  // absent only when the map has said what it shows and this is not among it
  const absent = (set: ReadonlySet<string> | null, value: string): boolean => set !== null && !set.has(value);
  const i18n = useI18n();
  const { t } = i18n;
  const palette = PALETTES[theme];
  // An explicit choice by the user wins; until then the legend follows `compact`.
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? !compact;
  return (
    <details
      className={styles.legend}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next !== open) setChoice(next);
      }}
    >
      <summary>
        {t("legend")}
        <ChevronDown size={15} strokeWidth={1.75} aria-hidden="true" className={styles.chevron} />
      </summary>
      <h3>{t("legendVoltage")}</h3>
      <ul className={styles.voltages}>
        {VOLTAGE_CLASSES.filter((klass) => distribution || klass !== "<60").map((klass) => (
          <li key={klass} {...spotHandlers(onSpotlight, { kind: "voltage", value: klass })}>
            <span className={styles.line} style={{ background: palette.voltage[klass] }} aria-hidden="true" />
            {i18n.voltage(klass)}
          </li>
        ))}
      </ul>
      <h3>{t("legendTechnology")}</h3>
      <ul className={styles.technologies}>
        {TECHNOLOGIES.map((tech) => (
          <li
            key={tech}
            data-absent={absent(inView.technologies, tech) || undefined}
            {...spotHandlers(onSpotlight, { kind: "technology", value: tech })}
          >
            <span
              className={styles.dot}
              style={{ background: palette.technology[tech] }}
              aria-hidden="true"
            />
            {i18n.technology(tech)}
          </li>
        ))}
      </ul>
      <h3>{t("layer_datacenters")}</h3>
      <ul className={styles.technologies}>
        <li>
          <span className={styles.dot} style={{ background: palette.datacenter }} aria-hidden="true" />
          {t("legendDatacenter")}
        </li>
      </ul>
      {cities && (
        <>
          <h3>{t("layer_cities")}</h3>
          <ul className={styles.technologies}>
            <li>
              <span
                className={styles.dot}
                style={{ background: palette.city, boxShadow: `inset 0 0 0 1.5px ${palette.cityRing}` }}
                aria-hidden="true"
              />
              {t("legendCity")}
            </li>
          </ul>
        </>
      )}
      {chargers && (
        <>
          <h3>{t("layer_chargers")}</h3>
          <ul className={styles.technologies}>
            <li>
              <span className={styles.dot} style={{ background: palette.charger }} aria-hidden="true" />
              {t(chargersBanded ? "legendChargerNoData" : "legendCharger")}
            </li>
            {chargersBanded &&
              (["high", "mid", "low"] as const).map((band) => (
                <li key={band}>
                  <span
                    className={styles.dot}
                    style={{ background: palette.green[band] }}
                    aria-hidden="true"
                  />
                  {t(`legendCharger_${band}`, {
                    mid: Math.round(BAND_LIMITS.mid * 100),
                    high: Math.round(BAND_LIMITS.high * 100),
                  })}
                </li>
              ))}
          </ul>
          {chargersBanded && <p className={styles.note}>{t("legendChargerNote")}</p>}
        </>
      )}
      {extraction && (
        <>
          <h3>{t("layer_extraction")}</h3>
          <ul className={styles.technologies}>
            {SUBSTANCES.map((substance) => (
              <li key={substance} data-absent={absent(inView.substances, substance) || undefined}>
                <span
                  className={styles.dot}
                  style={{ background: palette.substance[substance] }}
                  aria-hidden="true"
                />
                {t(`substance_${substance}`)}
              </li>
            ))}
          </ul>
          <p className={styles.note}>{t("legendExtractionNote")}</p>
        </>
      )}
      {gas && (
        <>
          <h3>{t("layer_gas")}</h3>
          <ul className={styles.technologies}>
            <li>
              <span
                className={styles.dot}
                style={{ background: palette.gas, opacity: 0.7 }}
                aria-hidden="true"
              />
              {t("legendGas")}
            </li>
          </ul>
        </>
      )}
      <h3>{t("legendPipelines")}</h3>
      <ul className={styles.voltages}>
        {(["gas", "oil"] as const).map((medium) => (
          <li key={medium}>
            <span
              className={styles.line}
              style={{ background: palette.pipeline[medium] }}
              aria-hidden="true"
            />
            {t(`medium_${medium}`)}
          </li>
        ))}
      </ul>
      {distribution && <p className={styles.note}>{t("legendDistribution")}</p>}
      <p className={styles.note}>{t("legendStatus")}</p>
    </details>
  );
}
