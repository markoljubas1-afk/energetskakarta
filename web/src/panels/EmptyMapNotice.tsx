/**
 * Said on the map when nothing that is switched on is in this part of it (Faza 57-C2). The layer list says the
 * same next to each layer, but on a phone the list is a closed sheet and the reader only sees an empty map.
 */
import { SearchX } from "lucide-react";

import { useI18n } from "../i18n";
import styles from "./EmptyMapNotice.module.css";

interface Props {
  /** the filters differ from the defaults: offer to put them back */
  onReset?: (() => void) | undefined;
}

export function EmptyMapNotice({ onReset }: Props) {
  const { t } = useI18n();
  return (
    <div className={styles.notice} role="status">
      <SearchX size={16} strokeWidth={1.75} aria-hidden="true" className={styles.icon} />
      <p>{t("emptyMap")}</p>
      {onReset && (
        <button type="button" className={styles.reset} onClick={onReset}>
          {t("resetFilters")}
        </button>
      )}
    </div>
  );
}
