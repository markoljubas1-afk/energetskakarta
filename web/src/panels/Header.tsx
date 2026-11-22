import {
  ChartColumnStacked,
  FileText,
  GitCompareArrows,
  GraduationCap,
  UserRound,
  Info,
  Globe,
  Map as MapIcon,
  Moon,
  Sun,
} from "lucide-react";

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

const PAGE_ICONS = { map: MapIcon, energy: ChartColumnStacked, compare: GitCompareArrows } as const;
const PAGE_LABELS = { map: "pageMap", energy: "pageEnergy", compare: "pageCompare" } as const;

export function Header({ theme, page, onPage, onToggleTheme, onToggleLang, children }: Props) {
  const { t, lang } = useI18n();
  return (
    <header className={styles.header}>
      <a className={styles.skip} href="#map">
        {t("skipToMap")}
      </a>
      {/* The name as the intro writes it, and what it is in small letters (decision 2026-11-16). */}
      <div className={styles.brand}>
        <strong aria-label={t("appName")}>
          Grid<span>Atlas</span>
        </strong>
        <span className={styles.tagline}>{t("appTagline")}</span>
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
              // on a phone the comparisons are reached from the reports; the row has no room for a third
              className={option === "compare" ? styles.widePage : undefined}
              onClick={() => {
                onPage(option);
              }}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              <span className={styles.pageLabel}>{t(PAGE_LABELS[option])}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.actions}>
        <a className={styles.textButton} href={PATHS[lang].learn}>
          <GraduationCap size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.buttonLabel}>{t("learnLink")}</span>
        </a>
        {/* the monthly reports exist wherever generation data is published, as on the live site */}
        <a className={`${styles.textButton} ${styles.optional}`} href={PATHS[lang].reports}>
          <FileText size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.buttonLabel}>{t("reportsLink")}</span>
        </a>
        <a
          className={`${styles.textButton} ${styles.optional}`}
          href={PATHS[lang].author}
          aria-label={t("authorTitle")}
          title={t("authorTitle")}
        >
          <UserRound size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.buttonLabel}>{t("authorLink")}</span>
        </a>
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
          <Globe size={16} strokeWidth={1.75} aria-hidden="true" />
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
