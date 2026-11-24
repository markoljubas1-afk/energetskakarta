import { X } from "lucide-react";
import { useState } from "react";

import type { AsyncState } from "../app/useAsync";
import { levelOf, NEAR_STATION_KM, nearestStation, stationSlugs, type HepLoad } from "../data/hep";
import type { HomeShapes } from "../data/homeFlow";
import {
  FACINGS,
  planeOf,
  planeShare,
  SLOPES,
  type Facing,
  type RoofPlanes,
  type Slope,
} from "../data/roofPlanes";
import { PANEL_W, roofSystem, valueAt, type SolarLoad } from "../data/solar";
import { useI18n } from "../i18n";
import { CAPACITY_COPY } from "../seo/capacityCopy";
import { PATHS } from "../seo/pages";
import { HomeFlow } from "./HomeFlow";
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
  /** the daily shapes of sun and of a household; null while loading or when there are none: no house */
  home?: HomeShapes | null;
  /** what each roof plane yields at the grid point nearest the click; null while loading or when there are none */
  planes?: RoofPlanes | null;
}

/** The European Commission's free calculator for a particular roof or plot (tilt, orientation, shading). */
export const PVGIS_URL = "https://re.jrc.ec.europa.eu/pvg_tools/en/";

/**
 * The solar potential layer's bar (Faza 34-2): what the colours mean, the value at the place the reader
 * clicked, and what the number is not. The figures are a model's long-term averages from the Global Solar
 * Atlas; the bar never lets them stand without that.
 */
export function SolarBar(props: Props) {
  const { data, point, onRetry, onClose, capacity = null, onStation, home = null, planes = null } = props;
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
          <Roof yieldKwh={value} point={point} home={home} planes={planes} />
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

/** The slider's range: from a small flat to a large house with a heat pump, in steps a bill can be read to. */
const CONSUMPTION = { min: 1000, max: 15000, step: 250, start: 4000 } as const;

/**
 * "How many panels would I need?" (prijedlog vlasnika 2026-11-17): the reader gives the yearly consumption
 * their bill states, the place gives its yield, and the answer is installed power and a number of panels.
 * Kilowatt-hours rather than euros, because turning a bill into consumption would need a tariff we would
 * have to assume. What the answer is not is said under it: a yearly balance, not independence from the grid.
 */
function Roof(props: {
  yieldKwh: number;
  point: { lng: number; lat: number };
  home: HomeShapes | null;
  planes: RoofPlanes | null;
}) {
  const { yieldKwh: atlasYield, point, home, planes } = props;
  const i18n = useI18n();
  const { t } = i18n;
  const [yearly, setYearly] = useState<number>(CONSUMPTION.start);
  const [facing, setFacing] = useState<Facing>("S");
  const [slope, setSlope] = useState<Slope>(30);
  // the atlas's amount, times what this plane gives of the best plane's at the nearest PVGIS point (Faza 52)
  const plane = planes ? planeOf(planes, facing, slope) : null;
  const share = planes && plane ? planeShare(planes, plane) : null;
  const yieldKwh = share === null ? atlasYield : Math.round(atlasYield * share);
  const system = roofSystem(yearly, yieldKwh);
  const calculator = (
    <div className={styles.roof}>
      <h3>{t("roofTitle")}</h3>
      <label>
        <span>{t("roofConsumption")}</span>
        <input
          name="roof-consumption"
          type="range"
          min={CONSUMPTION.min}
          max={CONSUMPTION.max}
          step={CONSUMPTION.step}
          value={yearly}
          aria-valuetext={`${i18n.number(yearly, 0)} kWh`}
          onChange={(event) => {
            setYearly(Number(event.target.value));
          }}
        />
        <output>{i18n.number(yearly, 0)} kWh</output>
      </label>
      {planes && (
        <div className={styles.roofPlane}>
          <label>
            <span>{t("roofFacing")}</span>
            <select
              name="roof-facing"
              value={facing}
              onChange={(event) => {
                setFacing(FACINGS.find((each) => each === event.target.value) ?? "S");
              }}
            >
              {FACINGS.map((each) => (
                <option key={each} value={each}>
                  {t(`roofFacing_${each}`)}
                </option>
              ))}
            </select>
          </label>
          {facing !== "flat" && (
            <label>
              <span>{t("roofSlope")}</span>
              <select
                name="roof-slope"
                value={slope}
                onChange={(event) => {
                  setSlope(SLOPES.find((each) => each === Number(event.target.value)) ?? 30);
                }}
              >
                {SLOPES.map((each) => (
                  <option key={each} value={each}>
                    {each}°
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {system && (
        <p className={styles.roofResult} aria-live="polite">
          {t("roofResult", { kwp: i18n.number(system.kwp, 1), panels: system.panels, watts: PANEL_W })}
        </p>
      )}
      {share !== null && (
        <p className={styles.roofYield}>
          {t("roofPlaneYield", { value: i18n.number(yieldKwh, 0), share: i18n.number(share * 100, 0) })}
        </p>
      )}
      <p className={styles.note}>
        {t("roofNote")} {t(share === null ? "roofNoteIdeal" : "roofNotePlanes")}
      </p>
    </div>
  );
  // the house is a block of its own beside the calculator: it has its own controls and their own layout
  return (
    <>
      {calculator}
      {system && home && (
        <HomeFlow
          shapes={home}
          point={point}
          yearlyKwh={yearly}
          yieldKwh={yieldKwh}
          kwp={system.kwp}
          roof={plane ? { shape: plane.shape, facing: plane.facing, slopeDeg: plane.slopeDeg } : null}
        />
      )}
    </>
  );
}
