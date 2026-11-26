/**
 * Said on the map while there is no network (Faza 59): what is on screen is the last data the service worker
 * kept, not today's, and parts of the map never opened have nothing to show.
 */
import { WifiOff } from "lucide-react";

import { useI18n } from "../i18n";
import styles from "./EmptyMapNotice.module.css";

export function OfflineNotice() {
  const { t } = useI18n();
  return (
    <div className={styles.notice} role="status">
      <WifiOff size={16} strokeWidth={1.75} aria-hidden="true" className={styles.icon} />
      <p>{t("offlineNotice")}</p>
    </div>
  );
}
