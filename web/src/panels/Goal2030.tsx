import { latestShare, type Renewables } from "../data/eurostat";
import { progress, target2030, TARGETS_2030, type Target2030 } from "../data/targets";
import { useI18n } from "../i18n";
import styles from "./Goal2030.module.css";

interface Props {
  country: string;
  renewables: Renewables;
  /** the page that says more (Croatia's transition page); absent for countries without one */
  moreHref?: string;
  /** shows on the map what is being built and planned towards the target: wind and solar plants */
  onShowComing?: () => void;
  /** Injected in tests; defaults to the verified targets (data/targets.ts). */
  targets?: Partial<Record<string, Target2030[]>>;
}

const RADIUS = 26;
const LENGTH = 2 * Math.PI * RADIUS;

/**
 * "Where the country stands against its own 2030 target" (prijedlog vlasnika 2026-11-17): the latest official
 * share of renewables in all energy used (Eurostat) as a part of the target in the country's plan. A yearly,
 * official figure on purpose: the hourly number above it measures something else (electricity generated in
 * one hour), and the two must not be read as one. A country without a verified target shows nothing.
 */
export function Goal2030({ country, renewables, moreHref, onShowComing, targets = TARGETS_2030 }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const target = target2030(country, "REN", targets);
  const share = target ? latestShare(renewables, country, "REN") : null;
  if (!target || !share) return null;
  const state = progress(target, share);
  return (
    <section className={styles.goal} aria-label={t("goalTitle")}>
      <h3>{t("goalTitle")}</h3>
      <div className={styles.row}>
        <svg className={styles.ring} viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
          <circle className={styles.track} cx="32" cy="32" r={RADIUS} />
          <circle
            className={styles.done}
            cx="32"
            cy="32"
            r={RADIUS}
            strokeDasharray={`${(state.part * LENGTH).toFixed(1)} ${LENGTH.toFixed(1)}`}
            transform="rotate(-90 32 32)"
          />
          <text x="32" y="36" textAnchor="middle">
            {Math.round(state.part * 100)} %
          </text>
        </svg>
        <p>
          {t("goalNow", { year: state.year, value: i18n.number(state.value, 1) })}
          <br />
          {t("goalTarget", { value: i18n.number(target.value, 1) })}
          <br />
          <strong>
            {state.gap > 0 ? t("goalGap", { points: i18n.number(state.gap, 1) }) : t("goalReached")}
          </strong>
        </p>
      </div>
      {onShowComing && (
        <button type="button" className={styles.show} onClick={onShowComing}>
          {t("goalShowComing")}
        </button>
      )}
      <p className={styles.note}>
        {t("goalNote")}{" "}
        <a href={renewables.sourceUrl} target="_blank" rel="noopener noreferrer">
          Eurostat
        </a>
        {"; "}
        <a href={target.sourceUrl} target="_blank" rel="noopener noreferrer">
          {target.source}
        </a>
        . {moreHref && <a href={moreHref}>{t("goalMore")}</a>}
      </p>
    </section>
  );
}
