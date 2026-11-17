import { ArrowDownToLine, ArrowUpFromLine, X } from "lucide-react";

import type { AsyncState } from "../app/useAsync";
import { readings, type GasStorageLoad, type Reading } from "../data/gasStorage";
import { useI18n } from "../i18n";
import styles from "./GasStorageBar.module.css";

interface Props {
  data: AsyncState<GasStorageLoad> | null;
  /** switches the gas layer off */
  onClose: () => void;
}

/**
 * Gas in storage, next to the gas layer (Faza 37): how full each storage facility of the region is, and
 * whether gas is going in or coming out, as its operator reported for the last gas day. The source is GIE's
 * AGSI platform, which asks to be named wherever its data is shown; the bar never appears without that line.
 * Nothing is shown while there is nothing to show: the gas layer stands on its own without storage.
 */
export function GasStorageBar({ data, onClose }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  if (data?.status !== "ready" || data.value.kind !== "ready") return null;
  const { storage } = data.value;
  const rows = readings(storage, "HR");
  if (rows.length === 0) return null;
  return (
    <section className={styles.bar} aria-label={t("storageTitle")}>
      <div className={styles.head}>
        <h2>{t("storageTitle")}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t("storageClose")}>
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <ul className={styles.list}>
        {rows.map((row) => (
          <Row key={row.facility.id} row={row} />
        ))}
      </ul>
      <p className={styles.note}>
        {t("storageNote")}{" "}
        <a href={storage.sourceUrl} target="_blank" rel="noopener noreferrer">
          {storage.attribution}
        </a>
        .
      </p>
    </section>
  );
}

function Row({ row }: { row: Reading }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { facility } = row;
  const flow =
    row.direction === "injecting"
      ? t("storageInjecting", { value: i18n.number(row.injection ?? 0, 1) })
      : row.direction === "withdrawing"
        ? t("storageWithdrawing", { value: i18n.number(row.withdrawal ?? 0, 1) })
        : t("storageSteady");
  return (
    <li>
      <div className={styles.name}>
        <strong>{facility.name}</strong>
        <span>
          {i18n.country(facility.country)} · {facility.operator}
        </span>
      </div>
      <div className={styles.fill}>
        <span className={styles.track} aria-hidden="true">
          <span style={{ width: `${String(Math.min(100, Math.max(0, row.full)))}%` }} />
        </span>
        <strong>{i18n.number(row.full, 1)} %</strong>
      </div>
      <p className={styles.detail}>
        {row.direction === "injecting" && <ArrowDownToLine size={13} strokeWidth={1.75} aria-hidden="true" />}
        {row.direction === "withdrawing" && (
          <ArrowUpFromLine size={13} strokeWidth={1.75} aria-hidden="true" />
        )}
        {flow}
        {row.inStorageTwh !== null &&
          facility.workingGasTwh !== null &&
          ` · ${t("storageVolume", {
            stored: i18n.number(row.inStorageTwh, 2),
            capacity: i18n.number(facility.workingGasTwh, 2),
          })}`}
        {` · ${i18n.date(row.day)}`}
        {row.estimated && ` · ${t("storageEstimated")}`}
      </p>
    </li>
  );
}
