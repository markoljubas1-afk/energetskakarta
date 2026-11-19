import { Pause, Play, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AsyncState } from "../app/useAsync";
import { balances, type Balance, type FlowRow, type GasFlows, type GasFlowsLoad } from "../data/gasFlows";
import { useI18n } from "../i18n";
import { deliveryChange, flowName, gwh } from "../share/gasFlowCard";
import styles from "./GasFlowBar.module.css";
import { drawing, frame, slotId, TRUNK_LEFT, TRUNK_RIGHT, type Frame, type Slot } from "./gasSankey";

/** The country whose system the bar shows. */
const HOME = "HR";
/** How long a day stays on the screen while the period is played. */
const STEP_MS = 700;

interface Props {
  data: AsyncState<GasFlowsLoad> | null;
  /** switches the gas layer off */
  onClose: () => void;
}

/**
 * The gas system's day, next to the gas layer (Faza 44-3): what entered the transmission system and where
 * it went, point by point, as the operator reported it to ENTSOG. The two lists are the two sides of one
 * balance, joined by a diagram whose bands are as thick as the flows (Faza 45-1); the line under them says
 * what the figures are not (consumption, or who supplied whom). The reader can go back through the days
 * the data has, or have them played. Nothing is shown while there is nothing to show.
 */
export function GasFlowBar({ data, onClose }: Props) {
  if (data?.status !== "ready" || data.value.kind !== "ready") return null;
  return <Bar flows={data.value.flows} onClose={onClose} />;
}

function Bar({ flows, onClose }: { flows: GasFlows; onClose: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const days = useMemo(() => balances(flows, HOME), [flows]);
  const shape = useMemo(() => frame(days), [days]);
  // the day the reader chose; null: the last one, also when newer data arrives
  const [chosen, setChosen] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const last = days.length - 1;
  const found = chosen === null ? -1 : days.findIndex((each) => each.day === chosen);
  const at = found === -1 ? last : found;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (at >= last) {
        setPlaying(false);
        return;
      }
      setChosen(days[at + 1]?.day ?? null);
    }, STEP_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [playing, at, last, days]);

  const day = days[at];
  if (!day || !shape) return null;
  const title = t("gasFlowTitle", { country: i18n.country(day.country) });
  // the day's deliveries against the seven days before: said only when both are in the data
  const change = deliveryChange(day);
  const rounded = change === null ? null : Math.round(change);
  const picture = drawing(day, shape);
  const play = (): void => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // played from the first day when the reader is on the last one
    if (at >= last) setChosen(days[0]?.day ?? null);
    setPlaying(true);
  };
  return (
    <section className={styles.bar} aria-label={title}>
      <div className={styles.head}>
        <h2>{title}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t("storageClose")}>
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <p className={styles.day}>
        {t(day.provisional ? "gasFlowDayProvisional" : "gasFlowDay", {
          date: i18n.date(day.day),
          operator: day.operator,
        })}
      </p>
      {days.length > 1 && (
        <div className={styles.days}>
          <button
            type="button"
            className={styles.play}
            onClick={play}
            aria-label={t(playing ? "gasFlowPause" : "gasFlowPlay", { days: String(days.length) })}
            title={t(playing ? "gasFlowPause" : "gasFlowPlay", { days: String(days.length) })}
          >
            {playing ? (
              <Pause size={16} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Play size={16} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={at}
            aria-label={t("gasFlowDayPick")}
            aria-valuetext={i18n.date(day.day)}
            onChange={(event) => {
              setPlaying(false);
              const picked = Number(event.target.value);
              setChosen(picked >= last ? null : (days[picked]?.day ?? null));
            }}
          />
        </div>
      )}
      <div className={styles.sides}>
        <h3 className={styles.entered}>{t("gasFlowEntered", { value: gwh(day.enteredKwh, i18n) })}</h3>
        <h3 className={styles.left}>{t("gasFlowLeft", { value: gwh(day.leftKwh, i18n) })}</h3>
        <Side
          className={styles.entered}
          heading={t("gasFlowEntered", { value: gwh(day.enteredKwh, i18n) })}
          rows={day.entries}
          room={shape.entries}
        />
        <Diagram shape={shape} picture={picture} />
        <Side
          className={styles.left}
          heading={t("gasFlowLeft", { value: gwh(day.leftKwh, i18n) })}
          rows={day.exits}
          room={shape.exits}
        />
      </div>
      {rounded !== null && day.consumersKwh !== null && day.usualConsumersKwh !== null && (
        <p className={styles.use}>
          {t(rounded > 0 ? "gasUseMore" : rounded < 0 ? "gasUseLess" : "gasUseSame", {
            value: gwh(day.consumersKwh, i18n),
            change: String(Math.abs(rounded)),
            usual: gwh(day.usualConsumersKwh, i18n),
          })}
        </p>
      )}
      <p className={styles.note}>
        {t("gasFlowNote")}{" "}
        <a href={flows.sourceUrl} target="_blank" rel="noopener noreferrer">
          {flows.source}
        </a>
        .
      </p>
    </section>
  );
}

/** The bands between the two lists. The lists say everything the picture shows, so it is not read out. */
function Diagram({ shape, picture }: { shape: Frame; picture: ReturnType<typeof drawing> }) {
  return (
    <svg
      className={styles.diagram}
      viewBox={`0 0 100 ${String(shape.height)}`}
      preserveAspectRatio="none"
      style={{ height: `${String(shape.height)}px` }}
      aria-hidden="true"
    >
      {picture.entries.map((band) => (
        <path key={band.id} className={styles.bandIn} d={band.path} />
      ))}
      {picture.exits.map((band) => (
        <path key={band.id} className={styles.bandOut} d={band.path} />
      ))}
      <rect
        className={styles.trunk}
        x={TRUNK_LEFT}
        width={TRUNK_RIGHT - TRUNK_LEFT}
        y={picture.trunk.top}
        height={picture.trunk.height}
      />
    </svg>
  );
}

/** One side of the balance: the points in the diagram's order, each in the room the diagram gives it. */
function Side({
  className,
  heading,
  rows,
  room,
}: {
  className: string | undefined;
  heading: string;
  rows: Balance["entries"];
  room: readonly Slot[];
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const byId = new Map<string, FlowRow>(rows.map((row) => [slotId(row), row]));
  return (
    <ul className={[styles.list, className].filter(Boolean).join(" ")} aria-label={heading}>
      {room.map((slot) => {
        const row = byId.get(slot.id);
        if (!row) return null;
        return (
          <li
            key={slot.id}
            className={row.kwh > 0 ? undefined : styles.idle}
            style={{ height: `${String(slot.height)}px` }}
          >
            <span className={styles.name}>{flowName(row, i18n)}</span>
            <strong>
              {t("gasFlowRow", { value: gwh(row.kwh, i18n), share: String(Math.round(row.share * 100)) })}
            </strong>
          </li>
        );
      })}
    </ul>
  );
}
