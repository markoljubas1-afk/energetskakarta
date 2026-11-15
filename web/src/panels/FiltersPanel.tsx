import {
  ArrowLeftRight,
  Building2,
  Cable,
  Factory,
  Flame,
  Fuel,
  Gauge,
  History,
  Info,
  Pickaxe,
  Plug,
  RotateCcw,
  Server,
  ThermometerSun,
  Spline,
  Zap,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { SCOPE_COUNTRIES, STATUSES, TECHNOLOGIES, VOLTAGE_CLASSES, type LayerKey } from "../domain";
import { useI18n } from "../i18n";
import { PALETTES, type Theme } from "../map/palette";
import { defaultState, MIN_MW_STEPS, serializeState, type AppState } from "../state/url";
import styles from "./FiltersPanel.module.css";

interface Props {
  state: AppState;
  setState: (update: (state: AppState) => AppState) => void;
  theme: Theme;
  /** whether this data release has a timeline for the time machine */
  timeMachine?: boolean;
}

export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Filters only; view, selection, language and panel are left as they are. */
export function resetFilters(state: AppState): AppState {
  const defaults = defaultState(state.lang);
  return {
    ...state,
    layers: defaults.layers,
    statuses: defaults.statuses,
    technologies: defaults.technologies,
    voltages: defaults.voltages,
    minMw: defaults.minMw,
    countries: defaults.countries,
    year: defaults.year,
  };
}

/**
 * The layer list in three groups, so a reader finds "the grid", "what makes and uses energy" and "live"
 * without reading ten rows. Every LayerKey appears exactly once (layers.test.ts checks).
 */
export const LAYER_GROUPS: readonly { key: "grid" | "energy"; layers: readonly LayerKey[] }[] = [
  { key: "grid", layers: ["lines", "substations", "capacity", "pipelines", "distribution"] },
  {
    key: "energy",
    layers: ["plants", "geothermal", "extraction", "gas", "cities", "datacenters", "chargers"],
  },
];

/** Layers whose coverage or meaning needs a sentence; shown under the row on request, or when switched on. */
const LAYER_NOTES: Partial<
  Record<
    LayerKey,
    | "layer_datacenters_note"
    | "layer_cities_note"
    | "layer_distribution_note"
    | "layer_chargers_note"
    | "layer_extraction_note"
    | "layer_gas_note"
    | "layer_geothermal_note"
    | "layer_capacity_note"
  >
> = {
  datacenters: "layer_datacenters_note",
  cities: "layer_cities_note",
  distribution: "layer_distribution_note",
  chargers: "layer_chargers_note",
  extraction: "layer_extraction_note",
  gas: "layer_gas_note",
  geothermal: "layer_geothermal_note",
  capacity: "layer_capacity_note",
};

const LAYER_ICONS: Record<LayerKey, typeof Cable> = {
  lines: Cable,
  substations: Zap,
  plants: Factory,
  pipelines: Fuel,
  datacenters: Server,
  cities: Building2,
  distribution: Spline,
  chargers: Plug,
  extraction: Pickaxe,
  gas: Flame,
  geothermal: ThermometerSun,
  capacity: Gauge,
};

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3>{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Chip({
  pressed,
  onClick,
  swatch,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  swatch?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button type="button" className={styles.chip} aria-pressed={pressed} onClick={onClick}>
      {swatch}
      {children}
    </button>
  );
}

export function FiltersPanel({ state, setState, theme, timeMachine = false }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const palette = PALETTES[theme];
  const update = (patch: (s: AppState) => Partial<AppState>): void => {
    setState((s) => ({ ...s, ...patch(s) }));
  };
  const isDefault = serializeState(resetFilters(state), state.lang) === serializeState(state, state.lang);
  const plantsOn = state.layers.has("plants");
  // notes the reader opened (or that opened themselves when the layer was switched on)
  const [openNotes, setOpenNotes] = useState<ReadonlySet<LayerKey>>(new Set());
  const toggleNote = (layer: LayerKey): void => {
    setOpenNotes((open) => toggled(open, layer));
  };
  const toggleLayer = (layer: LayerKey): void => {
    const turningOn = !state.layers.has(layer);
    update((s) => ({ layers: toggled(s.layers, layer) }));
    if (turningOn && LAYER_NOTES[layer]) setOpenNotes((open) => new Set([...open, layer]));
  };
  const layerRow = (layer: LayerKey): ReactNode => {
    const Icon = LAYER_ICONS[layer];
    const note = LAYER_NOTES[layer];
    const noteOpen = note !== undefined && openNotes.has(layer);
    return (
      <div key={layer} className={styles.layerRow}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={state.layers.has(layer)}
            onChange={() => {
              toggleLayer(layer);
            }}
          />
          <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>{t(`layer_${layer}`)}</span>
        </label>
        {note && (
          <button
            type="button"
            className={styles.noteButton}
            aria-expanded={noteOpen}
            aria-controls={`layer-note-${layer}`}
            aria-label={t("layerAbout", { layer: t(`layer_${layer}`) })}
            onClick={() => {
              toggleNote(layer);
            }}
          >
            <Info size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
        {noteOpen && (
          <p id={`layer-note-${layer}`} className={styles.layerNote}>
            {t(note)}
          </p>
        )}
      </div>
    );
  };

  const allTechnologies = state.technologies.size === TECHNOLOGIES.length;
  const technologyBulk = (
    <button
      type="button"
      className={styles.bulk}
      onClick={() => {
        update(() => ({ technologies: new Set(allTechnologies ? [] : TECHNOLOGIES) }));
      }}
    >
      {allTechnologies ? t("selectNone") : t("selectAll")}
    </button>
  );

  return (
    <div className={styles.filters}>
      <Section title={t("layers")}>
        <div className={styles.groups}>
          {LAYER_GROUPS.map((group) => (
            <div
              key={group.key}
              className={styles.stack}
              role="group"
              aria-label={t(`layerGroup_${group.key}`)}
            >
              <h4 className={styles.groupLabel}>{t(`layerGroup_${group.key}`)}</h4>
              {group.layers.map(layerRow)}
            </div>
          ))}
          <div className={styles.stack} role="group" aria-label={t("layerGroup_live")}>
            <h4 className={styles.groupLabel}>{t("layerGroup_live")}</h4>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={state.live}
                onChange={() => {
                  update((s) => ({ live: !s.live }));
                }}
              />
              <ArrowLeftRight size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>{t("layer_live")}</span>
            </label>
          </div>
        </div>
      </Section>

      <Section title={t("status")}>
        <div className={styles.chips}>
          {STATUSES.map((status) => (
            <Chip
              key={status}
              pressed={state.statuses.has(status)}
              onClick={() => {
                update((s) => ({ statuses: toggled(s.statuses, status) }));
              }}
              swatch={<span className={styles.statusSwatch} data-status={status} aria-hidden="true" />}
            >
              {t(`status_${status}`)}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title={t("voltage")}>
        <div className={styles.chips}>
          {VOLTAGE_CLASSES.map((klass) => (
            <Chip
              key={klass}
              pressed={state.voltages.has(klass)}
              onClick={() => {
                update((s) => ({ voltages: toggled(s.voltages, klass) }));
              }}
              swatch={
                <span
                  className={styles.lineSwatch}
                  style={{ background: palette.voltage[klass] }}
                  aria-hidden="true"
                />
              }
            >
              {i18n.voltage(klass)}
            </Chip>
          ))}
        </div>
      </Section>

      <fieldset className={styles.fieldset} disabled={!plantsOn}>
        <Section title={t("technology")} actions={technologyBulk}>
          <div className={styles.chips}>
            {TECHNOLOGIES.map((tech) => (
              <Chip
                key={tech}
                pressed={state.technologies.has(tech)}
                onClick={() => {
                  update((s) => ({ technologies: toggled(s.technologies, tech) }));
                }}
                swatch={
                  <span
                    className={styles.dotSwatch}
                    style={{ background: palette.technology[tech] }}
                    aria-hidden="true"
                  />
                }
              >
                {i18n.technology(tech)}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title={t("minCapacity")}>
          <select
            className={styles.select}
            aria-label={t("minCapacity")}
            value={state.minMw}
            onChange={(event) => {
              const value = Number(event.target.value);
              update(() => ({ minMw: value }));
            }}
          >
            {MIN_MW_STEPS.map((mw) => (
              <option key={mw} value={mw}>
                {mw === 0 ? t("anyCapacity") : `≥ ${i18n.power(mw)}`}
              </option>
            ))}
          </select>
        </Section>

        <Section title={t("timeMachine")}>
          <p className={styles.hint}>{timeMachine ? t("timeMachineHint") : t("timeMachineNone")}</p>
          <button
            type="button"
            className={styles.action}
            disabled={!timeMachine}
            aria-pressed={state.year !== null}
            onClick={() => {
              // opens on the current year; the bar plays from the beginning (Faza 18-3)
              update((s) => ({ year: s.year === null ? new Date().getFullYear() : null }));
            }}
          >
            <History size={15} strokeWidth={1.75} aria-hidden="true" />
            {state.year === null ? t("timeMachineOpen") : t("timeClose")}
          </button>
        </Section>
      </fieldset>

      <Section title={t("countries")}>
        <div className={styles.chips}>
          <Chip
            pressed={state.countries.size === 0}
            onClick={() => {
              update(() => ({ countries: new Set() }));
            }}
          >
            {t("allCountries")}
          </Chip>
          {SCOPE_COUNTRIES.map((code) => (
            <Chip
              key={code}
              pressed={state.countries.has(code)}
              onClick={() => {
                update((s) => ({ countries: toggled(s.countries, code) }));
              }}
            >
              {i18n.country(code)}
            </Chip>
          ))}
        </div>
      </Section>

      <button
        type="button"
        className={styles.reset}
        disabled={isDefault}
        onClick={() => {
          setState(resetFilters);
        }}
      >
        <RotateCcw size={15} strokeWidth={1.75} aria-hidden="true" />
        {t("resetFilters")}
      </button>
    </div>
  );
}
