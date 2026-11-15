import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { KEY_OF, SHORTCUTS } from "../app/shortcuts";
import { useI18n } from "../i18n";
import styles from "./ShortcutsHelp.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

const KEY_LABEL: Record<string, string> = { Escape: "Esc" };

/** The list of keyboard shortcuts, as a native modal dialog (focus trap and Escape come for free). */
export function ShortcutsHelp({ open, onClose }: Props) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="shortcuts-title" onClose={onClose}>
      <div className={styles.head}>
        <h2 id="shortcuts-title">{t("shortcutsTitle")}</h2>
        <button type="button" className={styles.close} aria-label={t("closeDialog")} onClick={onClose}>
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <dl className={styles.list}>
        {SHORTCUTS.map((action) => (
          <div key={action}>
            <dt>
              <kbd>{KEY_LABEL[KEY_OF[action]] ?? KEY_OF[action]}</kbd>
            </dt>
            <dd>{t(`shortcut_${action}`)}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  );
}
