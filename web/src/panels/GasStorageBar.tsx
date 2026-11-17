import { ArrowDownToLine, ArrowUpFromLine, X } from "lucide-react";

import type { AsyncState } from "../app/useAsync";
import { readings, type GasStorageLoad, type Reading } from "../data/gasStorage";
import { useI18n } from "../i18n";
import styles from "./GasStorageBar.module.css";

/** The country whose storage is shown first and open. */
const HOME = "HR";

interface Props {
  data: AsyncState<GasStorageLoad> | null;
  /** switches the gas layer off */
  onClose: () => void;
  /** the facility clicked on the map: shown open and first, whichever country it is in */
  picked?: string | null;
}

/**
 * Gas in storage, next to the gas layer (Faza 37): how full each storage facility of the region is, and
 * whether gas is going in or coming out, as its operator reported for the last gas day. The source is GIE's
 * AGSI platform, which asks to be named wherever its data is shown; the bar never appears without that line.
 * Nothing is shown while there is nothing to show: the gas layer stands on its own without storage.
 */
export function GasStorageBar({ data, onClose, picked = null }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  if (data?.status !== "ready" || data.value.kind !== "ready") return null;
  const { storage } = data.value;
  const rows = readings(storage, HOME);
  if (rows.length === 0) return null;
  // The reader's own country stays open; ten facilities at once would cover the map the bar belongs to.
  // Where the home country has none, the first country's stand in.
  const lead = rows.some((row) => row.facility.country === HOME) ? HOME : (rows[0]?.facility.country ?? HOME);
  const open = (row: Reading): boolean => row.facility.country === lead || row.facility.id === picked;
  const shown = rows
    .filter(open)
    .sort((a, b) => Number(b.facility.id === picked) - Number(a.facility.id === picked));
  const others = rows.filter((row) => !open(row));
  return (
    <section className={styles.bar} aria-label={t("storageTitle")}>
      <div className={styles.head}>
        <h2>{t("storageTitle")}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t("storageClose")}>
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <ul className={styles.list}>
        {shown.map((row) => (
          <Row key={row.facility.id} row={row} picked={row.facility.id === picked} />
        ))}
      </ul>
      {others.length > 0 && (
        <details className={styles.others}>
          <summary>{t("storageOthers", { count: others.length })}</summary>
          <ul className={styles.list}>
            {others.map((row) => (
              <Row key={row.facility.id} row={row} />
            ))}
          </ul>
        </details>
      )}
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

function Row({ row, picked = false }: { row: Reading; picked?: boolean }) {
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
    <li {...(picked ? { "data-picked": "" } : {})}>
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
      <Trend row={row} />
    </li>
  );
}

const TREND_WIDTH = 120;
const TREND_HEIGHT = 26;
/** Fewer days than this are not a curve. */
const TREND_MIN_DAYS = 5;

/**
 * The fill over the days the data holds (a month): a small curve, with its first and last value in words.
 * The curve is stretched between its own lowest and highest day to show the direction, so it says nothing
 * about how full the store is; the two figures next to it do.
 */
function Trend({ row }: { row: Reading }) {
  const i18n = useI18n();
  const { t } = i18n;
  const first = row.history[0];
  const last = row.history[row.history.length - 1];
  if (row.history.length < TREND_MIN_DAYS || !first || !last) return null;
  const values = row.history.map((point) => point.full);
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const step = TREND_WIDTH / (values.length - 1);
  const points = values
    .map((value, index) => {
      const y = TREND_HEIGHT - 2 - ((value - low) / span) * (TREND_HEIGHT - 4);
      return `${(index * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <p className={styles.trend}>
      <svg
        viewBox={`0 0 ${String(TREND_WIDTH)} ${String(TREND_HEIGHT)}`}
        width={TREND_WIDTH}
        height={TREND_HEIGHT}
        aria-hidden="true"
      >
        <polyline points={points} />
      </svg>
      <span>
        {t("storageTrend", {
          from: i18n.date(first.day),
          before: i18n.number(first.full, 1),
          now: i18n.number(last.full, 1),
        })}
      </span>
    </p>
  );
}
