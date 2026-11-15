/**
 * The intro's overlay (Faza 22): the title over the night while the map loads, then over the map as it flies
 * in. A click, a key or the wheel skips it; Tab still moves focus, so the skip button can be reached. A
 * click rather than a press: the whole click lands on the overlay, never on the map beneath it.
 */
import { useEffect } from "react";

import { useI18n } from "../i18n";
import type { IntroMode } from "./introMode";
import styles from "./Intro.module.css";
import type { IntroPhase } from "./useIntro";

/** Keys that move focus or are held for a shortcut; they do not skip. */
const PASSIVE_KEYS = new Set(["Tab", "Shift", "Control", "Alt", "Meta"]);

interface Props {
  mode: IntroMode;
  phase: Exclude<IntroPhase, "done">;
  onSkip: () => void;
}

export function Intro({ mode, phase, onSkip }: Props) {
  const { t } = useI18n();
  useEffect(() => {
    if (phase === "handoff") return;
    const onKey = (event: KeyboardEvent): void => {
      if (!PASSIVE_KEYS.has(event.key)) onSkip();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onSkip, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onSkip);
    };
  }, [phase, onSkip]);

  return (
    <div className={styles.intro} data-phase={phase} data-mode={mode} data-intro-overlay onClick={onSkip}>
      <div className={styles.sky} aria-hidden="true" />
      <div className={styles.titleBlock}>
        <p className={styles.title}>{t("introTitle")}</p>
        <span className={styles.rule} aria-hidden="true" />
      </div>
      <button type="button" className={styles.skip} onClick={onSkip}>
        {t("introSkip")}
      </button>
    </div>
  );
}
