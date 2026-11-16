import { X } from "lucide-react";

import type { AsyncState } from "../app/useAsync";
import {
  activeSteps,
  CASCADE,
  PHASES,
  totals,
  type GeoSite,
  type GeothermalLoad,
  type Phase,
} from "../data/geothermal";
import { useI18n } from "../i18n";
import { PALETTES, type Theme } from "../map/palette";
import { ChartShare } from "../share/ChartShare";
import { geothermalTable } from "../share/tables";
import styles from "./GeothermalBar.module.css";

interface Props {
  data: AsyncState<GeothermalLoad> | null;
  theme: Theme;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onRetry: () => void;
  /** switches the layer off: the bar has its own way out, like the capacity bar */
  onClose?: () => void;
}

const STEP_X = [20, 92, 164, 236, 308, 380];

/**
 * The heat cascade (Faza 21): hot water from the well passes its users from the hottest to the coolest and
 * goes back into the ground. The steps this site really uses are drawn strong, the others faint; the moving
 * drops carry meaning (heat travelling), and stand still when the visitor asked for reduced motion.
 */
function Cascade({ site }: { site: GeoSite }) {
  const { t } = useI18n();
  const active = activeSteps(site);
  const path = `M${STEP_X[0]},40 ${STEP_X.slice(1)
    .map((x) => `L${x},40`)
    .join(" ")}`;
  return (
    <figure className={styles.cascade}>
      <svg viewBox="0 0 400 96" role="img" aria-label={t("geoCascadeLabel", { name: site.name })}>
        <defs>
          <linearGradient id="geo-heat" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#D43D22" />
            <stop offset="0.6" stopColor="#E0A23B" />
            <stop offset="1" stopColor="#3D7FB8" />
          </linearGradient>
        </defs>
        <path
          d={path}
          stroke="url(#geo-heat)"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
          opacity="0.85"
        />
        {[0, 1, 2].map((i) => (
          <circle key={i} className={styles.drop} r="4">
            <animateMotion dur="4.5s" begin={`${i * 1.5}s`} repeatCount="indefinite" path={path} />
          </circle>
        ))}
        {CASCADE.map((step, i) => {
          const on = active.has(step.use);
          const x = STEP_X[i] ?? 0;
          const range = step.use === "well" && site.temperatureC ? `≈ ${site.temperatureC} °C` : step.range;
          return (
            <g key={step.use} className={on ? styles.stepOn : styles.stepOff}>
              <circle cx={x} cy={40} r={9} />
              <text x={x} y={20} textAnchor="middle">
                {t(`geoStep_${step.use}`)}
              </text>
              {range && (
                <text x={x} y={68} textAnchor="middle" className={styles.range}>
                  {range}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption>{t("geoCascadeNote")}</figcaption>
    </figure>
  );
}

/** The geothermal layer's bar: headline figures, the potential's legend, the sites and a site's cascade. */
export function GeothermalBar({ data, theme, selected, onSelect, onRetry, onClose }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const close = onClose && (
    <button type="button" className={styles.close} onClick={onClose} aria-label={t("geoClose")}>
      <X size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
  if (!data || data.status === "loading") {
    return (
      <section className={styles.bar} aria-label={t("layer_geothermal")}>
        {close}
        <p className={styles.muted} role="status">
          {t("loadingData")}
        </p>
      </section>
    );
  }
  if (data.status === "error" || data.value.kind === "none") {
    return (
      <section className={styles.bar} aria-label={t("layer_geothermal")}>
        {close}
        <p className={styles.muted} role="alert">
          {data.status === "error" ? t("geoFailed") : t("geoNone")}{" "}
          {data.status === "error" && (
            <button type="button" className={styles.link} onClick={onRetry}>
              {t("retry")}
            </button>
          )}
        </p>
      </section>
    );
  }
  const doc = data.value.geothermal;
  // site capacities are small and exact ("16,5 MW"): one decimal instead of power()'s rounding
  const mw = (value: number): string => `${i18n.number(value, 1)} MW`;
  const sum = totals(doc);
  const palette = PALETTES[theme];
  const site = doc.sites.find((candidate) => candidate.id === selected) ?? null;
  const byPhase = (phase: Phase): GeoSite[] => doc.sites.filter((candidate) => candidate.status === phase);
  const stops = palette.heatFlow.stops;
  const [lo, hi] = [stops[0]?.[0] ?? 40, stops[stops.length - 1]?.[0] ?? 120];
  const gradient = `linear-gradient(90deg, ${stops.map(([q, color]) => `${color} ${(((q - lo) / (hi - lo)) * 100).toFixed(0)}%`).join(", ")})`;

  return (
    <section className={styles.bar} aria-label={t("layer_geothermal")}>
      <div className={styles.head}>
        <h2>{t("geoTitle")}</h2>
        <ChartShare
          title={t("geoTitle")}
          subtitle={i18n.country("HR")}
          sources={[...(doc.heatFlow ? [doc.heatFlow.source] : []), t("shareSitesSource")]}
          dataDate={doc.generatedAt}
          sourceLine={t("chartSourceLine", {
            source: [...(doc.heatFlow ? [doc.heatFlow.source] : []), t("shareSitesSource")].join(", "),
            date: i18n.date(doc.generatedAt),
            site: window.location.host,
          })}
          table={() =>
            geothermalTable(doc, {
              site: t("csvSite"),
              place: t("csvPlace"),
              phase: t("csvPhase"),
              electric: t("csvElectric"),
              thermal: t("csvThermal"),
              temperature: t("csvTemperature"),
              uses: t("csvUses"),
              sources: t("csvSources"),
              phaseName: (phase) => t(`geoPhase_${phase}`),
            })
          }
          placement="above"
        />
        {close}
      </div>
      <dl className={styles.figures}>
        <div>
          <dt>{t("geoToday")}</dt>
          <dd>
            {t("geoTodayValue", {
              mw: mw(sum.operatingMw),
              heat: i18n.plural("geoHeatSites", sum.heatSites),
            })}
          </dd>
        </div>
        <div>
          <dt>{t("geoComing")}</dt>
          <dd>{t("geoComingValue", { mw: mw(sum.plannedMw) })}</dd>
        </div>
        <div>
          <dt>{t("geoCities")}</dt>
          <dd>
            {t("geoCitiesValue", {
              confirmed: i18n.number(sum.confirmed),
              developing: i18n.number(sum.developing),
            })}
          </dd>
        </div>
      </dl>
      {doc.heatFlow && (
        <div className={styles.scale}>
          <span className={styles.muted}>{t("geoPotential")}</span>
          <span className={styles.scaleBar} style={{ background: gradient }} aria-hidden="true" />
          <span className={styles.scaleTicks} aria-hidden="true">
            <span>{lo}</span>
            <span>{hi}+ mW/m²</span>
          </span>
          <span className={styles.muted}>
            {t("geoPotentialNote", { points: i18n.number(doc.heatFlow.points) })}{" "}
            <a href={doc.heatFlow.url} target="_blank" rel="noopener">
              {doc.heatFlow.source}
            </a>{" "}
            ({doc.heatFlow.license.replaceAll("-", " ")})
          </span>
        </div>
      )}
      <div className={styles.sites}>
        {PHASES.map((phase) => {
          const list = byPhase(phase);
          if (list.length === 0) return null;
          return (
            <div key={phase} className={styles.phase}>
              <span className={styles.phaseLabel}>
                <i style={{ background: palette.geoPhase[phase] }} aria-hidden="true" />
                {t(`geoPhase_${phase}`)}
              </span>
              <span className={styles.chips}>
                {list.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    aria-pressed={candidate.id === selected}
                    onClick={() => {
                      onSelect(candidate.id === selected ? null : candidate.id);
                    }}
                  >
                    {candidate.name}
                    {candidate.electricMw ? ` · ${mw(candidate.electricMw)}` : ""}
                  </button>
                ))}
              </span>
            </div>
          );
        })}
      </div>
      {site ? (
        <div className={styles.site}>
          <div className={styles.siteHead}>
            <h3>{site.name}</h3>
            <button
              type="button"
              className={styles.close}
              onClick={() => onSelect(null)}
              aria-label={t("geoCloseSite")}
            >
              <X size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <p className={styles.muted}>
            {site.place} · {t(`geoPhase_${site.status}`)}
            {site.electricMw ? ` · ${mw(site.electricMw)}` : ""}
          </p>
          {(i18n.lang === "hr" ? site.noteHr : site.noteEn) && (
            <p className={styles.muted}>{i18n.lang === "hr" ? site.noteHr : site.noteEn}</p>
          )}
          <Cascade site={site} />
          <p className={styles.sources}>
            {t("geoSources")}{" "}
            {site.sources.map((url, i) => (
              <span key={url}>
                {i > 0 && ", "}
                <a href={url} target="_blank" rel="noopener">
                  {new URL(url).hostname.replace(/^www\./, "")}
                </a>
              </span>
            ))}
          </p>
        </div>
      ) : (
        <p className={styles.muted}>{t("geoPick")}</p>
      )}
      <p className={styles.note}>{t("geoReviewed", { date: i18n.date(doc.sitesReviewed) })}</p>
    </section>
  );
}
