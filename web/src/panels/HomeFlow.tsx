/**
 * The house under the roof calculator (Faza 42): the sun, the house, the grid and, when asked for, a home
 * battery, with dots that travel the way the electricity goes in the chosen hour of an average day of the
 * chosen month. The figures are data/homeFlow.ts's calculation from PVGIS's shape of the sun and HEP ODS's
 * standard household curve; the drawing only shows them, and the same figures stand next to it as text.
 */
import { useId, useState } from "react";

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

type Tone = "sun" | "grid" | "battery";

/** The four places on the drawing: a disc each, the panels above the house, the battery and the grid beside it. */
const NODES = {
  sun: { x: 170, y: 50, r: 30 },
  house: { x: 170, y: 164, r: 34 },
  battery: { x: 48, y: 164, r: 30 },
  grid: { x: 292, y: 164, r: 30 },
} as const;

/** Each flow's path, drawn from where the electricity comes from to where it goes, and where its figure stands. */
const PATHS: Record<
  FlowKey,
  { d: string; tone: Tone; label: [number, number]; anchor: "start" | "middle" | "end"; battery: boolean }
> = {
  pvToHome: { d: "M170 80 L170 130", tone: "sun", label: [177, 109], anchor: "start", battery: false },
  pvToGrid: {
    d: "M199 58 C262 62 292 94 292 134",
    tone: "sun",
    label: [277, 76],
    anchor: "start",
    battery: false,
  },
  pvToBattery: {
    d: "M141 58 C78 62 48 94 48 134",
    tone: "sun",
    label: [63, 76],
    anchor: "end",
    battery: true,
  },
  batteryToHome: {
    d: "M78 164 L136 164",
    tone: "battery",
    label: [107, 156],
    anchor: "middle",
    battery: true,
  },
  gridToHome: { d: "M262 164 L204 164", tone: "grid", label: [233, 156], anchor: "middle", battery: false },
};
/** Moves the house and the grid, as a pair, to the middle of the drawing: their span is 136 to 322 of 340. */
const NO_BATTERY_SHIFT = -59;
const FLOWS = Object.keys(PATHS) as FlowKey[];

/**
 * A disc's ring, drawn clockwise from the top: each part is a share of the whole turn in its own colour, over
 * a pale full ring. The house's ring is what its electricity is made of, the battery's how full it is.
 */
function Ring({
  at,
  parts,
}: {
  at: { x: number; y: number; r: number };
  parts: { tone: Tone; share: number }[];
}) {
  const around = 2 * Math.PI * at.r;
  const arcs = parts.reduce<{ tone: Tone; length: number; offset: number }[]>((done, part) => {
    const offset = done.reduce((sum, arc) => sum + arc.length, 0);
    const length = around * Math.min(1, Math.max(0, part.share));
    return [...done, { tone: part.tone, length: Math.min(length, around - offset), offset }];
  }, []);
  return (
    <g transform={`rotate(-90 ${String(at.x)} ${String(at.y)})`}>
      <circle className={styles.disc} cx={at.x} cy={at.y} r={at.r} />
      {arcs.map((arc) =>
        arc.length < 0.5 ? null : (
          <circle
            key={arc.tone}
            className={styles.arc}
            data-tone={arc.tone}
            cx={at.x}
            cy={at.y}
            r={at.r}
            strokeDasharray={`${arc.length.toFixed(1)} ${(around - arc.length).toFixed(1)}`}
            strokeDashoffset={(-arc.offset).toFixed(1)}
          />
        ),
      )}
    </g>
  );
}

const hourName = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

export function HomeFlow({ shapes, point, yearlyKwh, yieldKwh, kwp, month: openMonth }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const [month, setMonth] = useState(() => openMonth ?? new Date().getMonth());
  const [hour, setHour] = useState(13);
  const [battery, setBattery] = useState(false);
  const [size, setSize] = useState<number>(BATTERY_SIZES[1]);
  const gradients = useId();

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
  // how high the sun stands in this hour against the day's best hour: the sky and the panels' ring follow it
  const brightest = Math.max(...day.map((each) => each.pv));
  const light = brightest > 0 ? Math.min(1, now.pv / brightest) : 0;
  const fed = now.load >= SHOWN_FROM_KW ? now.load : Infinity;
  const exchanging = now.pvToGrid >= SHOWN_FROM_KW || now.gridToHome >= SHOWN_FROM_KW;

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
      <svg className={styles.drawing} viewBox="0 0 340 220" role="img" aria-label={parts.join(" ")}>
        <defs>
          <linearGradient id={`${gradients}-day`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f2b53a" stopOpacity="0.3" />
            <stop offset="0.7" stopColor="#f2b53a" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${gradients}-night`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4a63c4" stopOpacity="0.34" />
            <stop offset="0.8" stopColor="#4a63c4" stopOpacity="0.06" />
          </linearGradient>
          <radialGradient id={`${gradients}-glow`}>
            <stop offset="0.45" stopColor="#f2b53a" stopOpacity="0.45" />
            <stop offset="1" stopColor="#f2b53a" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* the sky behind it all: warm by day, blue with a moon and stars by night */}
        <rect className={styles.backdrop} width="340" height="220" rx="14" />
        <rect
          className={styles.sky}
          width="340"
          height="220"
          rx="14"
          fill={`url(#${gradients}-day)`}
          style={{ opacity: Math.sqrt(light) }}
        />
        <g className={styles.sky} style={{ opacity: (1 - light) ** 2 }}>
          <rect width="340" height="220" rx="14" fill={`url(#${gradients}-night)`} />
          <path className={styles.moon} d="M300 20 a11 11 0 1 0 12 15 a9 9 0 0 1 -12 -15 Z" />
          {[
            [28, 24, 1.3],
            [62, 44, 0.9],
            [96, 18, 1.1],
            [244, 30, 0.9],
            [268, 58, 1.2],
            [322, 66, 0.9],
          ].map(([x, y, r]) => (
            <circle key={`${String(x)}-${String(y)}`} className={styles.star} cx={x} cy={y} r={r} />
          ))}
        </g>
        {/* without a battery its place is empty: the rest moves over, so the drawing stays centred */}
        <g
          className={styles.scene}
          style={{ transform: `translateX(${String(battery ? 0 : NO_BATTERY_SHIFT)}px)` }}
        >
          <circle
            className={styles.sky}
            cx={NODES.sun.x}
            cy={NODES.sun.y}
            r="54"
            fill={`url(#${gradients}-glow)`}
            style={{ opacity: light }}
          />

          {/* the wires are always there; the dots run on the ones that carry electricity in this hour */}
          {FLOWS.filter((key) => battery || !PATHS[key].battery).map((key) => (
            <path key={key} className={styles.track} d={PATHS[key].d} />
          ))}
          {FLOWS.map((key) => {
            const value = now[key];
            if (value < SHOWN_FROM_KW) return null;
            const path = PATHS[key];
            const strength = Math.min(1, value / peak);
            return (
              <g key={key} data-flow={key}>
                <path className={styles.live} data-tone={path.tone} d={path.d} />
                <path
                  className={styles.dots}
                  data-tone={path.tone}
                  d={path.d}
                  style={{
                    strokeWidth: 3 + 2.5 * strength,
                    animationDuration: `${(2.2 - 1.5 * strength).toFixed(2)}s`,
                  }}
                />
                <text
                  className={styles.flowFigure}
                  x={path.label[0]}
                  y={path.label[1]}
                  textAnchor={path.anchor}
                >
                  {kw(value)}
                </text>
              </g>
            );
          })}

          {/* the panels: the ring fills as the sun climbs to the day's best hour */}
          <Ring at={NODES.sun} parts={[{ tone: "sun", share: light }]} />
          <g className={styles.sun} data-on={now.pv >= SHOWN_FROM_KW}>
            <circle cx="170" cy="38" r="5" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
              <line
                key={angle}
                x1="170"
                y1="29.5"
                x2="170"
                y2="27"
                transform={`rotate(${String(angle)} 170 38)`}
              />
            ))}
          </g>
          <text className={styles.figure} x="170" y="65" textAnchor="middle">
            {kw(now.pv)}
          </text>
          <text className={styles.name} x="170" y="13" textAnchor="middle">
            {t("homeSun")}
          </text>

          {/* the house: its ring is what its electricity is made of in this hour */}
          <Ring
            at={NODES.house}
            parts={[
              { tone: "sun", share: now.pvToHome / fed },
              { tone: "battery", share: now.batteryToHome / fed },
              { tone: "grid", share: now.gridToHome / fed },
            ]}
          />
          <path
            className={styles.icon}
            d="M158 154 L170 143 L182 154 M161.5 152 V163 H178.5 V152 M168 163 V157 H172 V163"
          />
          <text className={styles.figure} x="170" y="181" textAnchor="middle">
            {kw(now.load)}
          </text>
          <text className={styles.name} x="170" y="213" textAnchor="middle">
            {t("homeHouse")}
          </text>

          {/* the grid: a pylon */}
          <Ring at={NODES.grid} parts={[{ tone: "grid", share: exchanging ? 1 : 0 }]} />
          <path
            className={styles.icon}
            d="M292 148 L285 180 M292 148 L299 180 M283 157 H301 M285.5 166 H298.5 M287 172 L297.5 180 M297 172 L286.5 180"
          />
          <text className={styles.name} x="292" y="213" textAnchor="middle">
            {t("homeGrid")}
          </text>

          {/* the battery: its ring is how full it is */}
          {battery && (
            <>
              <Ring at={NODES.battery} parts={[{ tone: "battery", share: fullPercent / 100 }]} />
              <path
                className={styles.icon}
                d="M41 146 H55 A2 2 0 0 1 57 148 V162 A2 2 0 0 1 55 164 H41 A2 2 0 0 1 39 162 V148 A2 2 0 0 1 41 146 Z M45 146 V143.5 H51 V146"
              />
              <text className={styles.figure} x="48" y="181" textAnchor="middle">
                {fullPercent} %
              </text>
              <text className={styles.name} x="48" y="213" textAnchor="middle">
                {t("homeBattery")}
              </text>
            </>
          )}
        </g>
      </svg>

      <label className={styles.slider}>
        <span>{t("homeHour")}</span>
        <input
          name="home-hour"
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
            name="home-month"
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
            name="home-battery"
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
              name="home-battery-size"
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
