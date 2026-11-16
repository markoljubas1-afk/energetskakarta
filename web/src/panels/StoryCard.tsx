import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";

import { useI18n } from "../i18n";
import type { Story } from "../stories/stories";
import styles from "./StoryCard.module.css";

interface Props {
  story: Story;
  /** zero-based */
  step: number;
  onStep: (step: number) => void;
  /** the story ends: by its last button or by closing the card */
  onLeave: () => void;
}

/**
 * One step of a guided story, in the slot the details panel uses: what the map is showing now, in two
 * sentences, and the way on. The map itself is moved by the app (app/App.tsx); the card only says which
 * step is wanted.
 */
export function StoryCard({ story, step, onStep, onLeave }: Props) {
  const { t, lang } = useI18n();
  const current = story.steps[step];
  if (!current) return null;
  const last = step === story.steps.length - 1;
  return (
    <section className={styles.card} aria-label={story.title[lang]}>
      <div className={styles.head}>
        <p className={styles.story}>{story.title[lang]}</p>
        <button type="button" className={styles.close} onClick={onLeave} aria-label={t("storyClose")}>
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {/* announced when the step changes, so a screen reader follows the story as the map moves */}
      <div aria-live="polite">
        <h2>{current.title[lang]}</h2>
        <p className={styles.text}>{current.text[lang]}</p>
      </div>
      <div className={styles.foot}>
        <ol
          className={styles.dots}
          aria-label={t("storyProgress", { step: step + 1, total: story.steps.length })}
        >
          {story.steps.map((item, index) => (
            <li key={item.title.hr} data-current={index === step} data-done={index < step} />
          ))}
        </ol>
        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.back}
            disabled={step === 0}
            onClick={() => {
              onStep(step - 1);
            }}
          >
            <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
            {t("storyBack")}
          </button>
          {last ? (
            <button type="button" className={styles.next} onClick={onLeave}>
              <Check size={15} strokeWidth={1.75} aria-hidden="true" />
              {t("storyDone")}
            </button>
          ) : (
            <button
              type="button"
              className={styles.next}
              onClick={() => {
                onStep(step + 1);
              }}
            >
              {t("storyNext")}
              <ArrowRight size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
