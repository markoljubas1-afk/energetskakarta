/**
 * The house under the roof calculator (Faza 42): the sun, the house, the grid and, when asked for, a home
 * battery, with dots that travel the way the electricity goes in the chosen hour of an average day of the
 * chosen month. The figures are data/homeFlow.ts's calculation from PVGIS's shape of the sun and HEP ODS's
 * standard household curve; the drawing only shows them, and the same figures stand next to it as text.
 */
import { useState } from "react";

import {
  BATTERY_CHARGE_LOSS,
  dayTotals,
  homeYear,
  HOURS,
  sunShapeAt,
  type HomeShapes,
  type HourFlow,
} from "../data/homeFlow";
import { useI18n } from "../i18n";
import styles from "./HomeFlow.module.css";

interface Props {
  shapes: HomeShapes;
  point: { lng: number; lat: number };
  /** what the reader set on the calculator's slider, kWh a year */
  yearlyKwh: number;
  /** the place's yield from the atlas, kWh per kWp a year */
  yieldKwh: number;
  /** the installed power the calculator arrived at */
  kwp: number;
  /** the month the house opens on, 0 to 11 (the current one) */
  month?: number;
}

/** The battery sizes on offer, in kWh: the range home batteries are mostly sold in. */
export const BATTERY_SIZES = [5, 10, 15] as const;
/** A flow under this many kW is not drawn: it would be a dot of rounding. */
const SHOWN_FROM_KW = 0.005;

type FlowKey = "pvToHome" | "pvToGrid" | "pvToBattery" | "batteryToHome" | "gridToHome";

/** Each flow's path, drawn from where the electricity comes from to where it goes. */
const PATHS: Record<FlowKey, { d: string; tone: "sun" | "grid" | "battery"; label: [number, number] }> = {
  pvToHome: { d: "M160 46 L160 92", tone: "sun", label: [166, 66] },
  pvToGrid: { d: "M176 84 C214 50 258 62 276 112", tone: "sun", label: [232, 56] },
  pvToBattery: { d: "M144 84 C106 50 62 62 44 112", tone: "sun", label: [52, 56] },
  batteryToHome: { d: "M62 150 L118 150", tone: "battery", label: [70, 142] },
  gridToHome: { d: "M258 150 L202 150", tone: "grid", label: [212, 142] },
};
const FLOWS = Object.keys(PATHS) as FlowKey[];

const hourName = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

export function HomeFlow({ shapes, point, yearlyKwh, yieldKwh, kwp, month: openMonth }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const [month, setMonth] = useState(() => openMonth ?? new Date().getMonth());
  const [hour, setHour] = useState(13);
  const [battery, setBattery] = useState(false);
  const [size, setSize] = useState<number>(BATTERY_SIZES[1]);

  const sun = sunShapeAt(shapes, point.lng, point.lat);
  if (!sun) return <p className={styles.note}>{t("homeNoSun")}</p>;
  const inputs = { yearlyKwh, yieldKwhPerKwp: yieldKwh, kwp };
  const house = homeYear(sun, shapes.household.months, { ...inputs, batteryKwh: battery ? size : 0 });
  const bare = battery ? homeYear(sun, shapes.household.months, { ...inputs, batteryKwh: 0 }) : null;
  const day = house?.months[month];
  const now: HourFlow | undefined = day?.[hour];
  if (!house || !day || !now) return null;

  const kw = (value: number): string => `${i18n.number(value, value < 10 ? 1 : 0)} kW`;
  const kwh = (value: number): string => `${i18n.number(value, value < 100 ? 1 : 0)} kWh`;
  const share = (value: number | null): string => (value === null ? "–" : i18n.number(value * 100, 0));
  const monthName = new Intl.DateTimeFormat(i18n.locale, { month: "long", timeZone: "UTC" });
  const months = Array.from({ length: 12 }, (_, index) =>
    monthName.format(new Date(Date.UTC(2020, index, 1))),
  );
  // dots move faster and the line is thicker the more power there is, against the day's largest flow
  const peak = Math.max(...day.flatMap((each) => FLOWS.map((key) => each[key])), SHOWN_FROM_KW);
  const today = dayTotals(day);
  const fullPercent = battery ? Math.round((now.stored / size) * 100) : 0;

  const parts = [
    t("homeAriaSun", {
      hour: hourName(hour),
      month: months[month] ?? "",
      pv: kw(now.pv),
      load: kw(now.load),
    }),
    now.pvToGrid >= SHOWN_FROM_KW ? t("homeAriaExport", { value: kw(now.pvToGrid) }) : "",
    now.gridToHome >= SHOWN_FROM_KW ? t("homeAriaImport", { value: kw(now.gridToHome) }) : "",
    now.pvToBattery >= SHOWN_FROM_KW ? t("homeAriaCharge", { value: kw(now.pvToBattery) }) : "",
    now.batteryToHome >= SHOWN_FROM_KW ? t("homeAriaDischarge", { value: kw(now.batteryToHome) }) : "",
  ].filter((part) => part !== "");

  return (
    <div className={styles.home}>
      <h3>{t("homeTitle")}</h3>
      <svg className={styles.drawing} viewBox="0 0 320 190" role="img" aria-label={parts.join(" ")}>
        {/* the sun */}
        <g className={styles.sun} data-on={now.pv >= SHOWN_FROM_KW}>
          <circle cx="160" cy="24" r="11" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <line
              key={angle}
              x1="160"
              y1="6"
              x2="160"
              y2="9.5"
              transform={`rotate(${String(angle)} 160 24)`}
            />
          ))}
        </g>
        <text className={styles.figure} x="180" y="22">
          {kw(now.pv)}
        </text>
        <text className={styles.name} x="180" y="34">
          {t("homeSun")}
        </text>

        {/* the house, with panels on its roof */}
        <g className={styles.house}>
          <path d="M108 112 L160 74 L212 112 Z" />
          <rect x="120" y="112" width="80" height="54" />
          <rect className={styles.door} x="152" y="140" width="16" height="26" />
          <path className={styles.panels} d="M166 82 L196 104 L184 104 L158 84 Z" />
        </g>
        <text className={styles.figure} x="160" y="128" textAnchor="middle">
          {kw(now.load)}
        </text>
        <text className={styles.name} x="160" y="182" textAnchor="middle">
          {t("homeHouse")}
        </text>

        {/* the grid: a pylon */}
        <g className={styles.pylon}>
          <path d="M280 116 L270 166 M280 116 L290 166 M266 130 L294 130 M270 144 L290 144 M273 152 L287 166 M287 152 L273 166" />
        </g>
        <text className={styles.name} x="280" y="182" textAnchor="middle">
          {t("homeGrid")}
        </text>

        {/* the battery, with how full it is */}
        {battery && (
          <>
            <g className={styles.battery}>
              <rect x="26" y="120" width="36" height="46" rx="4" />
              <rect x="38" y="115" width="12" height="5" rx="1.5" />
              <rect
                className={styles.charge}
                x="29"
                y={163 - (40 * fullPercent) / 100}
                width="30"
                height={(40 * fullPercent) / 100}
                rx="2"
              />
            </g>
            <text className={styles.figure} x="44" y="108" textAnchor="middle">
              {fullPercent} %
            </text>
            <text className={styles.name} x="44" y="182" textAnchor="middle">
              {t("homeBattery")}
            </text>
          </>
        )}

        {FLOWS.map((key) => {
          const value = now[key];
          if (value < SHOWN_FROM_KW) return null;
          const path = PATHS[key];
          const strength = Math.min(1, value / peak);
          return (
            <g key={key} data-flow={key}>
              <path className={styles.track} d={path.d} />
              <path
                className={styles.dots}
                data-tone={path.tone}
                d={path.d}
                style={{
                  strokeWidth: 2.5 + 2.5 * strength,
                  animationDuration: `${(2.2 - 1.5 * strength).toFixed(2)}s`,
                }}
              />
              <text className={styles.flowFigure} x={path.label[0]} y={path.label[1]}>
                {kw(value)}
              </text>
            </g>
          );
        })}
      </svg>

      <label className={styles.slider}>
        <span>{t("homeHour")}</span>
        <input
          type="range"
          min={0}
          max={HOURS - 1}
          step={1}
          value={hour}
          aria-valuetext={hourName(hour)}
          onChange={(event) => {
            setHour(Number(event.target.value));
          }}
        />
        <output>{hourName(hour)}</output>
      </label>
      <div className={styles.choices}>
        <label>
          <span>{t("homeMonth")}</span>
          <select
            value={month}
            onChange={(event) => {
              setMonth(Number(event.target.value));
            }}
          >
            {months.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={battery}
            onChange={(event) => {
              setBattery(event.target.checked);
            }}
          />
          <span>{t("homeBatteryWant")}</span>
        </label>
        {battery && (
          <label>
            <span>{t("homeBatterySize")}</span>
            <select
              value={size}
              onChange={(event) => {
                setSize(Number(event.target.value));
              }}
            >
              {BATTERY_SIZES.map((each) => (
                <option key={each} value={each}>
                  {each} kWh
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div aria-live="polite">
        <p className={styles.result}>
          {t("homeDay", {
            month: months[month] ?? "",
            pv: kwh(today.pv),
            load: kwh(today.load),
            self: share(today.selfConsumption),
            own: share(today.selfSufficiency),
          })}
        </p>
        <p className={styles.result}>
          {t("homeYear", {
            self: share(house.year.selfConsumption),
            own: share(house.year.selfSufficiency),
            exported: kwh(house.year.pvToGrid),
            imported: kwh(house.year.gridToHome),
          })}
          {bare &&
            ` ${t("homeWithout", { self: share(bare.year.selfConsumption), own: share(bare.year.selfSufficiency) })}`}
        </p>
      </div>
      <p className={styles.note}>
        {t("homeNote", {
          slope: shapes.sun.plane.slopeDeg,
          year: shapes.household.year,
          loss: i18n.number(BATTERY_CHARGE_LOSS * 100, 0),
        })}
      </p>
      <p className={styles.note}>
        {t("homeSources")} {shapes.sun.attribution}; {shapes.household.source}.
      </p>
    </div>
  );
}
