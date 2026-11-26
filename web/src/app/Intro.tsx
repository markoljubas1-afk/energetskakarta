/**
 * The intro's overlay (Faza 22): the title over the night while the map loads, then over the map as it flies
 * in. A click, a key, the wheel or a finger dragging across it skips it; Tab still moves focus, so the skip
 * button can be reached. A click rather than a press: the whole click lands on the overlay, never on the map
 * beneath it. A drag never becomes a click, so on a touch screen the first move of the finger skips.
 */
import { useEffect } from "react";

import { useI18n } from "../i18n";
import type { IntroMode } from "./introMode";
import styles from "./Intro.module.css";
import type { IntroPhase } from "./useIntro";

/** The name in two parts: the second is set in the map's own light. */
const WORDMARK = [
  ["G", "r", "i", "d"],
  ["A", "t", "l", "a", "s"],
] as const;
const NAME = "GridAtlas";

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
    window.addEventListener("touchmove", onSkip, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onSkip);
      window.removeEventListener("touchmove", onSkip);
    };
  }, [phase, onSkip]);

  return (
    <div className={styles.intro} data-phase={phase} data-mode={mode} data-intro-overlay onClick={onSkip}>
      <div className={styles.sky} aria-hidden="true" />
      <div className={styles.titleBlock}>
        {/* The wordmark (2026-11-16): the site's address, letter by letter, over a line that lights up
            like a transmission line being switched on. Read out as one word, not nine letters. */}
        <p className={styles.wordmark} aria-label={NAME}>
          {WORDMARK.map((part) => (
            <span key={part.join("")} className={styles.part} aria-hidden="true">
              {part.map((letter, index) => (
                <span key={`${letter}${String(index)}`}>{letter}</span>
              ))}
            </span>
          ))}
        </p>
        <span className={styles.rule} aria-hidden="true" />
        <p className={styles.title}>{t("introTitle")}</p>
      </div>
      <button type="button" className={styles.skip} onClick={onSkip}>
        {t("introSkip")}
      </button>
    </div>
  );
}
