import { ChartColumnStacked, Info, Languages, Map as MapIcon, Moon, Sun } from "lucide-react";

import { useI18n } from "../i18n";
import { PATHS } from "../seo/pages";
import type { Theme } from "../map/palette";
import { PAGES, type Page } from "../state/url";
import styles from "./Header.module.css";

interface Props {
  theme: Theme;
  page: Page;
  onPage: (page: Page) => void;
  onToggleTheme: () => void;
  onToggleLang: () => void;
  children: React.ReactNode;
}

const PAGE_ICONS = { map: MapIcon, energy: ChartColumnStacked } as const;

export function Header({ theme, page, onPage, onToggleTheme, onToggleLang, children }: Props) {
  const { t, lang } = useI18n();
  return (
    <header className={styles.header}>
      <a className={styles.skip} href="#map">
        {t("skipToMap")}
      </a>
      {/* The name alone (decision 2026-11-16): no mark and no second line next to it. */}
      <div className={styles.brand}>
        <strong>{t("appName")}</strong>
      </div>
      <div className={styles.search}>{page === "map" ? children : null}</div>
      <div className={styles.pages} role="group" aria-label={t("pageLabel")}>
        {PAGES.map((option) => {
          const Icon = PAGE_ICONS[option];
          return (
            <button
              key={option}
              type="button"
              aria-pressed={page === option}
              onClick={() => {
                onPage(option);
              }}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              <span className={styles.pageLabel}>{t(option === "map" ? "pageMap" : "pageEnergy")}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.actions}>
        <a className={styles.textButton} href={PATHS[lang].about}>
          <Info size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.buttonLabel}>{t("aboutLink")}</span>
        </a>
        <button
          type="button"
          className={styles.textButton}
          onClick={onToggleLang}
          aria-label={t("languageToggleLabel")}
        >
          <Languages size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.buttonLabel}>{t("languageToggle")}</span>
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onToggleTheme}
          aria-label={t("themeToggle")}
        >
          {theme === "dark" ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
        </button>
      </div>
    </header>
  );
}
