import { ArrowLeftRight, Building2, Gauge, Route, Sparkles, X } from "lucide-react";
import { useState } from "react";

import { useI18n } from "../i18n";
import { PATHS } from "../seo/pages";
import styles from "./Welcome.module.css";

const STORAGE_KEY = "energymap-welcome";

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "seen";
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "seen");
  } catch {
    // no storage: the card simply comes back next time
  }
}

/**
 * Whether the welcome card is shown. It goes away for good when the reader closes it or takes one of
 * its entries, and for this visit as soon as something is selected on the map (the card and the details
 * share one slot, and a card that reappears after every closed panel would be a nag).
 */
export function useWelcome(embed: boolean, selected: string | null): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(wasDismissed);
  // derived during render, the React way to remember "this has happened once" without an effect
  const [usedTheMap, setUsedTheMap] = useState(false);
  if (selected !== null && !usedTheMap) setUsedTheMap(true);
  const dismiss = (): void => {
    setDismissed(true);
    remember();
  };
  return [!dismissed && !usedTheMap && !embed && selected === null, dismiss];
}

export interface WelcomeEntries {
  /** null while the hourly flows and prices are not published: a first door must never open on nothing */
  live: (() => void) | null;
  /** where the grid has room for new plants; stands in for `live` while there is none */
  capacity: () => void;
  /** null when this build has no change report */
  changes: (() => void) | null;
  cities: () => void;
  /** starts the first guided story (stories/stories.ts) */
  story: () => void;
}

interface Props {
  entries: WelcomeEntries;
  onClose: () => void;
  /** the "Support and partners" page is on (Faza 24): one quiet line links it */
  support?: boolean;
}

/** Three doors into the map for a first visit, in the slot the details panel uses later. */
export function Welcome({ entries, onClose, support = false }: Props) {
  const { t, lang } = useI18n();
  const take = (entry: () => void) => () => {
    entry();
    onClose();
  };
  return (
    <section className={styles.card} aria-label={t("welcomeTitle")} data-welcome>
      <div className={styles.head}>
        <h2>{t("welcomeTitle")}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t("welcomeClose")}>
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <p className={styles.lead}>{t("welcomeLead")}</p>
      <ul className={styles.entries}>
        <li>
          <button type="button" onClick={take(entries.story)}>
            <Route size={18} strokeWidth={1.75} aria-hidden="true" />
            <span>
              <strong>{t("welcomeStory")}</strong>
              <small>{t("welcomeStoryNote")}</small>
            </span>
          </button>
        </li>
        <li>
          {entries.live ? (
            <button type="button" onClick={take(entries.live)}>
              <ArrowLeftRight size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>
                <strong>{t("welcomeLive")}</strong>
                <small>{t("welcomeLiveNote")}</small>
              </span>
            </button>
          ) : (
            <button type="button" onClick={take(entries.capacity)}>
              <Gauge size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>
                <strong>{t("welcomeCapacity")}</strong>
                <small>{t("welcomeCapacityNote")}</small>
              </span>
            </button>
          )}
        </li>
        {entries.changes && (
          <li>
            <button type="button" onClick={take(entries.changes)}>
              <Sparkles size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>
                <strong>{t("welcomeChanges")}</strong>
                <small>{t("welcomeChangesNote")}</small>
              </span>
            </button>
          </li>
        )}
        <li>
          <button type="button" onClick={take(entries.cities)}>
            <Building2 size={18} strokeWidth={1.75} aria-hidden="true" />
            <span>
              <strong>{t("welcomeCities")}</strong>
              <small>{t("welcomeCitiesNote")}</small>
            </span>
          </button>
        </li>
      </ul>
      <p className={styles.hint}>{t("welcomeHint")}</p>
      {support && (
        <p className={styles.support}>
          {t("welcomeSupport")} <a href={PATHS[lang].support}>{t("welcomeSupportLink")}</a>
        </p>
      )}
    </section>
  );
}
