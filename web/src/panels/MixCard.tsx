import { MapPin } from "lucide-react";
import { useState } from "react";

import { mixIntensity } from "../data/co2";
import { krskoHalfOfHour, krskoNote } from "../data/krsko";
import type { Live } from "../data/live";
import { gridMix, mixCountries, productionMix } from "../data/mix";
import type { CountryCode } from "../domain";
import { useI18n } from "../i18n";
import { PALETTES, type Theme } from "../map/palette";
import { ChartShare } from "../share/ChartShare";
import { mixTable } from "../share/tables";
import { HereCard } from "./HereCard";
import styles from "./MixCard.module.css";

interface Props {
  live: Live;
  index: number;
  theme: Theme;
  /** label of an hour index, as the live bar writes it ("danas 13:00") */
  hourLabel: (index: number) => string;
  /** where the map is looking, offered when the visitor does not share a location */
  mapCenter: { lat: number; lng: number } | null;
  /** false where the card sits under a heading of its own (the live bar folds it under its title) */
  heading?: boolean;
}

/** Shares under this are folded into one "other sources" line. */
const SMALL = 0.02;

/**
 * "What the grid's electricity is made of" for the live layer's hour (Faza 19), with "near me" under it.
 * Electricity mixes in the grid: the card shows shares of sources in an hour, never a plant-to-house path.
 */
export function MixCard({ live, index, theme, hourLabel, mapCenter, heading = true }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const countries = mixCountries(live);
  const [chosen, setChosen] = useState<CountryCode>("HR");
  const [withImports, setWithImports] = useState(true);
  const [near, setNear] = useState(false);
  if (countries.length === 0) return null;
  const country = countries.includes(chosen) ? chosen : (countries[0] ?? "HR");
  const mix = withImports ? gridMix(live, country, index) : productionMix(live, country, index);
  const palette = PALETTES[theme];
  const co2 = mix ? mixIntensity(mix) : null;

  const big = mix ? mix.technologies.filter((part) => part.share >= SMALL) : [];
  const smallShare = mix
    ? mix.technologies.filter((part) => part.share < SMALL).reduce((s, p) => s + p.share, 0)
    : 0;
  const unknownShare = mix && mix.totalMw > 0 ? mix.unknownImportMw / mix.totalMw : 0;
  const importShare = mix ? mix.imports.reduce((s, item) => s + item.share, 0) : 0;
  const unknownFrom = mix
    ? mix.imports.filter((item) => !item.known).map((item) => i18n.country(item.country))
    : [];
  // the hour the mix fell back to, not the hour asked for
  const krskoMw = mix ? krskoHalfOfHour(live, mix.index) : null;
  const krsko = krskoNote(i18n, country, krskoMw === null ? null : i18n.power(krskoMw), null);

  return (
    <section className={styles.card} aria-label={t("mixTitle")}>
      <div className={styles.head}>
        {heading && <h3>{t("mixTitle")}</h3>}
        <div className={styles.headActions}>
          <select
            id="mix-country"
            className={styles.select}
            value={country}
            aria-label={t("mixCountry")}
            onChange={(event) => {
              setChosen(event.target.value as CountryCode);
            }}
          >
            {countries.map((code) => (
              <option key={code} value={code}>
                {i18n.country(code)}
              </option>
            ))}
          </select>
          {mix && (
            <ChartShare
              title={t("mixTitle")}
              subtitle={`${i18n.country(country)} · ${hourLabel(mix.index)} · ${withImports ? t("mixGrid") : t("mixProduction")}`}
              sources={["ENTSO-E Transparency Platform"]}
              dataDate={live.generatedAt}
              sourceLine={t("chartSourceLine", {
                source: "ENTSO-E Transparency Platform",
                date: i18n.date(live.generatedAt),
                site: window.location.host,
              })}
              table={() =>
                mixTable(mix, {
                  source: t("energyCompareSource"),
                  share: t("csvShare"),
                  total: t("csvTotal"),
                  importFrom: (name) => t("csvImportFrom", { country: name }),
                  unknown: t("mixUnknownLabel"),
                  technology: (tech) => i18n.technology(tech),
                  country: (code) => i18n.country(code),
                })
              }
              placement="above"
            />
          )}
        </div>
      </div>
      <div className={styles.modes} role="group" aria-label={t("mixMode")}>
        <button type="button" aria-pressed={withImports} onClick={() => setWithImports(true)}>
          {t("mixGrid")}
        </button>
        <button type="button" aria-pressed={!withImports} onClick={() => setWithImports(false)}>
          {t("mixProduction")}
        </button>
      </div>

      {!mix ? (
        <p className={styles.muted}>{t("mixNone")}</p>
      ) : (
        <>
          {mix.index !== index && (
            <p className={styles.muted}>{t("mixLatest", { hour: hourLabel(mix.index) })}</p>
          )}
          <div className={styles.bar} aria-hidden="true">
            {mix.technologies.map((part) => (
              <span
                key={part.technology}
                style={{ flexGrow: part.share, background: palette.technology[part.technology] }}
              />
            ))}
            {unknownShare > 0 && <span className={styles.unknown} style={{ flexGrow: unknownShare }} />}
          </div>
          <ul className={styles.list}>
            {big.map((part) => (
              <li key={part.technology}>
                <i style={{ background: palette.technology[part.technology] }} aria-hidden="true" />
                <span>{t(`tech_${part.technology}`)}</span>
                <b>{i18n.percent(part.share)}</b>
              </li>
            ))}
            {smallShare > 0 && (
              <li>
                <i className={styles.small} aria-hidden="true" />
                <span>{t("mixOther")}</span>
                <b>{i18n.percent(smallShare)}</b>
              </li>
            )}
            {unknownShare > 0 && (
              <li>
                <i className={styles.unknown} aria-hidden="true" />
                <span>{t("mixUnknownLabel")}</span>
                <b>{i18n.percent(unknownShare)}</b>
              </li>
            )}
          </ul>
          <p className={styles.figure}>{t("mixTotal", { mw: i18n.power(mix.totalMw) })}</p>
          {co2 !== null && (
            <p className={styles.figure}>
              {t(withImports ? "mixCo2Grid" : "mixCo2Production", { value: i18n.number(Math.round(co2)) })}
            </p>
          )}
          {withImports && mix.imports.length > 0 && (
            <p className={styles.muted}>
              {t("mixImports", {
                share: i18n.percent(importShare),
                list: mix.imports
                  .map((item) => `${i18n.country(item.country)} ${i18n.percent(item.share)}`)
                  .join(", "),
              })}
              {unknownFrom.length > 0 && ` ${t("mixUnknown", { list: unknownFrom.join(", ") })}`}
            </p>
          )}
          {withImports && mix.incomplete && <p className={styles.muted}>{t("mixIncomplete")}</p>}
          {krsko !== null && <p className={styles.muted}>{krsko}</p>}
        </>
      )}
      <p className={styles.note}>{t("mixNote")}</p>

      <button
        type="button"
        className={styles.near}
        aria-expanded={near}
        onClick={() => {
          setNear((open) => !open);
        }}
      >
        <MapPin size={15} strokeWidth={1.75} aria-hidden="true" />
        {t("hereOpen")}
      </button>
      {near && <HereCard mix={gridMix(live, "HR", index)} mapCenter={mapCenter} />}
    </section>
  );
}
