import { X } from "lucide-react";

import type { AsyncState } from "../app/useAsync";
import { balance, type FlowRow, type GasFlowsLoad } from "../data/gasFlows";
import { useI18n } from "../i18n";
import { flowName, gwh } from "../share/gasFlowCard";
import styles from "./GasFlowBar.module.css";

/** The country whose system the bar shows. */
const HOME = "HR";

interface Props {
  data: AsyncState<GasFlowsLoad> | null;
  /** switches the gas layer off */
  onClose: () => void;
}

/**
 * The gas system's day, next to the gas layer (Faza 44-3): what entered the transmission system and where
 * it went, point by point, as the operator reported it to ENTSOG. The two columns are the two sides of one
 * balance; the line under them says what the figures are not (consumption, or who supplied whom). Nothing
 * is shown while there is nothing to show.
 */
export function GasFlowBar({ data, onClose }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  if (data?.status !== "ready" || data.value.kind !== "ready") return null;
  const { flows } = data.value;
  const day = balance(flows, HOME);
  if (!day) return null;
  const title = t("gasFlowTitle", { country: i18n.country(day.country) });
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
      <div className={styles.sides}>
        <Side heading={t("gasFlowEntered", { value: gwh(day.enteredKwh, i18n) })} rows={day.entries} />
        <Side heading={t("gasFlowLeft", { value: gwh(day.leftKwh, i18n) })} rows={day.exits} />
      </div>
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

function Side({ heading, rows }: { heading: string; rows: readonly FlowRow[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <div>
      <h3>{heading}</h3>
      <ul className={styles.list} aria-label={heading}>
        {rows.map((row) => (
          <li key={`${row.key}-${row.direction}`}>
            <span className={styles.name}>{flowName(row, i18n)}</span>
            <span className={styles.track} aria-hidden="true">
              <span style={{ width: `${String(Math.round(row.share * 100))}%` }} />
            </span>
            <strong>
              {t("gasFlowRow", { value: gwh(row.kwh, i18n), share: String(Math.round(row.share * 100)) })}
            </strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
