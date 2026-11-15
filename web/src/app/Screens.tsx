/** Full-page states shown instead of the map: loading, data failure, configuration failure. */
import { RotateCcw, TriangleAlert } from "lucide-react";

import { I18nProvider, useI18n } from "../i18n";
import { langFromPath } from "../state/url";
import styles from "./Screens.module.css";

export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className={styles.screen} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorScreen({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className={styles.screen} role="alert">
      <TriangleAlert size={28} strokeWidth={1.75} aria-hidden="true" className={styles.icon} />
      <h2>{title}</h2>
      <p>{body}</p>
      {onRetry && (
        <button type="button" className={styles.button} onClick={onRetry}>
          <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
          {t("retry")}
        </button>
      )}
    </div>
  );
}

/** Rendered without the app shell, so it brings its own language context. */
export function ConfigErrorScreen() {
  return (
    <I18nProvider lang={langFromPath(window.location.pathname)}>
      <ConfigError />
    </I18nProvider>
  );
}

function ConfigError() {
  const { t } = useI18n();
  return <ErrorScreen title={t("configFailedTitle")} body={t("configFailedBody")} />;
}
