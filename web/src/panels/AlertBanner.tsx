import {
  Earth,
  Egg,
  HardHat,
  Lightbulb,
  PartyPopper,
  Pickaxe,
  Sparkles,
  TreePine,
  TrendingDown,
  Trophy,
  Wind,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { Alert } from "../data/alerts";
import { RECORD_KINDS } from "../data/live";
import { leadsToLive, type OccasionKey } from "../data/occasions";
import { isOneOf } from "../domain";
import { useI18n, type I18n } from "../i18n";
import styles from "./AlertBanner.module.css";

interface Props {
  alert: Alert;
  /** open the live layer at what the notice is about */
  onShow: (alert: Alert) => void;
  onClose: (alert: Alert) => void;
}

const OCCASION_ICONS: Record<OccasionKey, LucideIcon> = {
  tesla: Zap,
  miners: Pickaxe,
  efficiency: Lightbulb,
  wind: Wind,
  earth: Earth,
  women: Sparkles,
  men: HardHat,
  orthodoxChristmas: TreePine,
  easter: Egg,
  orthodoxEaster: Egg,
  christmas: TreePine,
  newYear: PartyPopper,
};

/** The notice in words: what happened, where, when, and the figure; or the day's greeting. */
export function alertText(alert: Alert, i18n: I18n): { title: string; text: string } {
  const { t } = i18n;
  if (alert.kind === "occasion") {
    return { title: t(`occasion_${alert.occasion}_title`), text: t(`occasion_${alert.occasion}_text`) };
  }
  if (alert.kind === "free") {
    const hour = new Intl.DateTimeFormat(i18n.locale, { hour: "2-digit", minute: "2-digit" }).format(
      new Date(alert.lowest.hour),
    );
    return {
      title: t("alertFreeTitle"),
      text: t(alert.when === "today" ? "alertFreeToday" : "alertFreeTomorrow", {
        country: i18n.country(alert.country),
        eur: i18n.number(alert.lowest.eur, 2),
        hour,
      }),
    };
  }
  const { record } = alert;
  const what = isOneOf(RECORD_KINDS, record.kind) ? t(`record_${record.kind}`) : record.kind;
  const value =
    record.unit === "share"
      ? `${String(Math.round(record.value * 100))} %`
      : `${i18n.number(record.value / 1000, 1)} GWh`;
  return {
    title: t("alertRecordTitle"),
    text: t("alertRecord", {
      country: i18n.country(alert.country),
      date: i18n.date(alert.date),
      what,
      value,
    }),
  };
}

/** One line above the map for something out of the ordinary, with a way to see it and a way to close it. */
export function AlertBanner({ alert, onShow, onClose }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const { title, text } = alertText(alert, i18n);
  const Icon =
    alert.kind === "occasion"
      ? OCCASION_ICONS[alert.occasion]
      : alert.kind === "free"
        ? TrendingDown
        : Trophy;
  // a greeting offers the live layer only when its words point at the day's figures
  const show = alert.kind !== "occasion" || leadsToLive(alert.occasion);
  return (
    <div className={styles.banner} role="status" data-alert={alert.kind}>
      <Icon className={styles.icon} size={18} strokeWidth={1.75} aria-hidden="true" />
      <p>
        <strong>{title}</strong> {text}
        {show && (
          <>
            {" "}
            <button
              type="button"
              className={styles.show}
              onClick={() => {
                onShow(alert);
              }}
            >
              {t(
                alert.kind === "occasion"
                  ? "occasionShow"
                  : alert.kind === "free"
                    ? "alertShowHour"
                    : "alertShowDay",
              )}
            </button>
          </>
        )}
      </p>
      <button
        type="button"
        className={styles.close}
        aria-label={t("alertClose")}
        onClick={() => {
          onClose(alert);
        }}
      >
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
