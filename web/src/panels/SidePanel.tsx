import { ChartColumn, SlidersHorizontal, Sparkles } from "lucide-react";
import { useId, type KeyboardEvent } from "react";

import { useI18n } from "../i18n";
import type { Theme } from "../map/palette";
import { PANELS, type AppState, type Panel } from "../state/url";
import { ChangesPanel, type Locate } from "./ChangesPanel";
import type { LayerKey } from "../domain";
import { FiltersPanel } from "./FiltersPanel";
import { OverviewPanel } from "./OverviewPanel";
import styles from "./SidePanel.module.css";

interface Props {
  state: AppState;
  setState: (update: (state: AppState) => AppState) => void;
  statsUrl: string;
  /** The change report; builds published before it existed have none, and then there is no tab. */
  diffUrl: string | null;
  onLocate: (target: Locate) => void;
  theme: Theme;
  /** whether this data release has a timeline for the time machine (Faza 18-3) */
  timeMachine?: boolean;
  /** layers that are on but have nothing on screen right now */
  emptyLayers?: ReadonlySet<LayerKey>;
}

const ICONS = { filters: SlidersHorizontal, overview: ChartColumn, changes: Sparkles } as const;
const LABELS = { filters: "tabFilters", overview: "tabOverview", changes: "tabChanges" } as const;

/** WAI-ARIA tabs: arrow keys move between tabs, the active tab is remembered in the URL. */
const NO_LAYERS: ReadonlySet<LayerKey> = new Set();

export function SidePanel({
  state,
  setState,
  statsUrl,
  diffUrl,
  onLocate,
  theme,
  timeMachine = false,
  emptyLayers = NO_LAYERS,
}: Props) {
  const { t } = useI18n();
  const id = useId();
  const panels = PANELS.filter((panel) => panel !== "changes" || diffUrl !== null);
  // a link may ask for a tab this build cannot show
  const current: Panel = panels.includes(state.panel) ? state.panel : "filters";
  const select = (panel: Panel): void => {
    setState((s) => ({ ...s, panel }));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = panels.indexOf(current);
    const next = panels[(index + (event.key === "ArrowRight" ? 1 : panels.length - 1)) % panels.length];
    if (!next) return;
    select(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };

  return (
    <div className={styles.panel}>
      <div role="tablist" aria-label={t("panelLabel")} className={styles.tabs}>
        {panels.map((panel) => {
          const Icon = ICONS[panel];
          const active = current === panel;
          return (
            <button
              key={panel}
              id={`${id}-tab-${panel}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${id}-panel-${panel}`}
              tabIndex={active ? 0 : -1}
              className={styles.tab}
              onClick={() => {
                select(panel);
              }}
              onKeyDown={onKeyDown}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              {t(LABELS[panel])}
            </button>
          );
        })}
      </div>
      <div
        id={`${id}-panel-${current}`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${current}`}
        className={styles.body}
      >
        {current === "filters" && (
          <FiltersPanel
            state={state}
            setState={setState}
            theme={theme}
            timeMachine={timeMachine}
            emptyLayers={emptyLayers}
          />
        )}
        {current === "overview" && (
          <OverviewPanel statsUrl={statsUrl} countries={state.countries} theme={theme} />
        )}
        {current === "changes" && diffUrl !== null && <ChangesPanel diffUrl={diffUrl} onLocate={onLocate} />}
      </div>
    </div>
  );
}
