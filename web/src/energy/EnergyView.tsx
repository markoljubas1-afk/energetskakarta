import { ExternalLink } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { loadChunk } from "../app/chunks";
import { useAsync } from "../app/useAsync";
import { assetUrl, DataError, fetchJson } from "../data/current";
import {
  ALL,
  compareYears,
  EnergyPointerSchema,
  PeriodsSchema,
  rangeDays,
  rangeTotals,
  series,
  technologiesOf,
  YearFileSchema,
  yearsInRange,
  type EnergyPointer,
  type EnergySeries,
  type Periods,
} from "../data/energy";
import { RENEWABLE } from "../data/greenShare";
import { KRSKO_HOST, KRSKO_PARTNER, krskoHalfOfPeriod, krskoHalfOfRange, krskoNote } from "../data/krsko";
import { isOneOf, type Technology } from "../domain";
import { useI18n, type I18n } from "../i18n";
import { PALETTES, type Theme } from "../map/palette";
import { ChartShare, chartLink } from "../share/ChartShare";
import type { Table } from "../share/csv";
import { ENERGY_AREAS, ENERGY_CHARTS, type AppState, type EnergyChart, type EnergyState } from "../state/url";
import { compareTable, mixTable, rangeTable, ringTable, type CsvLabels, type KrskoRow } from "./csv";
import styles from "./EnergyView.module.css";
import { RingChart } from "./RingChart";

// One shared import for both charts: a single request, and a single module instance.
let chartsModule: Promise<typeof import("./charts")> | null = null;
const loadCharts = (): Promise<typeof import("./charts")> =>
  (chartsModule ??= loadChunk(() => import("./charts")));
const Charts = {
  Stacked: lazy(() => loadCharts().then((m) => ({ default: m.StackedChart }))),
  Lines: lazy(() => loadCharts().then((m) => ({ default: m.LinesChart }))),
};

const YEAR_COLORS = ["#8A949E", "#6E9FCC", "#62A89E", "#D09A25", "#B8403A", "#7E63AE"];
const SOURCE = "ENTSO-E Transparency Platform";

interface Props {
  dataBaseUrl: URL;
  energy: EnergyState;
  setState: (update: (state: AppState) => AppState) => void;
  theme: Theme;
  /** embedded in another page: no sharing, and with `energy.chart` that one card alone (Faza 23-5) */
  embed?: boolean;
}

/** What every card needs to be passed on (Faza 23): the data's date, the source line, the CSV labels. */
interface ShareKit {
  embedded: boolean;
  dataDate: string;
  sourceLine: string;
  labels: CsvLabels;
}

type Loaded = { kind: "none" } | { kind: "ready"; pointer: EnergyPointer; periods: Periods };

async function loadEnergy(base: URL, signal: AbortSignal): Promise<Loaded> {
  const pointerUrl = `${assetUrl(base, "energy/current.json")}?t=${Math.floor(Date.now() / 60_000)}`;
  const probe = await fetch(pointerUrl, { signal });
  if (probe.status === 404) return { kind: "none" };
  if (!probe.ok) throw new DataError(`energy pointer returned HTTP ${probe.status}`);
  const pointer = EnergyPointerSchema.parse(await probe.json());
  const periods = await fetchJson(assetUrl(base, pointer.periods.key), PeriodsSchema, signal);
  return { kind: "ready", pointer, periods };
}

function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={props.value === option.value}
          onClick={() => {
            props.onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface CardShare {
  kit: ShareKit;
  subtitle: string;
  table: () => Table;
}

/**
 * A card of the page: its id is where its link opens; its own source line travels with a screenshot of the
 * card alone; its share menu knows its title, what it shows, its rows and its chart (Faza 23).
 */
function Card(props: {
  id: EnergyChart;
  title: string;
  actions?: ReactNode;
  share: CardShare;
  children: ReactNode;
}) {
  const { id, title, actions, share, children } = props;
  const ref = useRef<HTMLElement>(null);
  const canvas = (): HTMLCanvasElement | null => ref.current?.querySelector("canvas") ?? null;
  return (
    <section id={id} ref={ref} className={styles.card} aria-label={title}>
      <div className={styles.cardHead}>
        <h3>{title}</h3>
        <div className={styles.cardActions}>
          {actions}
          {!share.kit.embedded && (
            <ChartShare
              title={title}
              subtitle={share.subtitle}
              anchor={id}
              sources={[SOURCE]}
              dataDate={share.kit.dataDate}
              sourceLine={share.kit.sourceLine}
              table={share.table}
              canvas={canvas}
              embed={id}
            />
          )}
        </div>
      </div>
      {children}
      <p className={styles.cardSource}>{share.kit.sourceLine}</p>
    </section>
  );
}

export function EnergyView({ dataBaseUrl, energy, setState, theme, embed = false }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const [loaded, retry] = useAsync(`energy:${dataBaseUrl.href}`, (signal) => loadEnergy(dataBaseUrl, signal));
  const update = (patch: Partial<EnergyState>): void => {
    setState((s) => ({ ...s, energy: { ...s.energy, ...patch } }));
  };

  let body: ReactNode;
  if (!loaded || loaded.status === "loading") {
    body = (
      <p className={styles.muted} role="status">
        {t("loadingData")}
      </p>
    );
  } else if (loaded.status === "error") {
    body = (
      <p className={styles.muted} role="alert">
        {t("energyFailed")}{" "}
        <button type="button" className={styles.link} onClick={retry}>
          {t("retry")}
        </button>
      </p>
    );
  } else if (loaded.value.kind === "none") {
    body = <p className={styles.empty}>{t("energyNoData")}</p>;
  } else {
    body = (
      <Content
        dataBaseUrl={dataBaseUrl}
        pointer={loaded.value.pointer}
        periods={loaded.value.periods}
        energy={energy}
        update={update}
        theme={theme}
        embedded={embed}
      />
    );
  }
  // an embedded single card is the chart and its source only
  const alone = embed && energy.chart !== null;

  return (
    <div className={styles.view} data-alone={alone || undefined}>
      {!alone && (
        <header className={styles.header}>
          <h2>{t("energyTitle")}</h2>
          <p className={styles.intro}>{t("energyIntro")}</p>
        </header>
      )}
      {body}
      {embed && (
        <a
          className={styles.openFull}
          href={chartLink(window.location.href, energy.chart ?? "")}
          target="_blank"
          rel="noopener"
          data-embed-link
        >
          {t("chartOpenFull")}
          <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

interface ContentProps {
  dataBaseUrl: URL;
  pointer: EnergyPointer;
  periods: Periods;
  energy: EnergyState;
  update: (patch: Partial<EnergyState>) => void;
  theme: Theme;
  embedded: boolean;
}

function Content({ dataBaseUrl, pointer, periods, energy, update, theme, embedded }: ContentProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const kit: ShareKit = {
    embedded,
    dataDate: pointer.updatedAt,
    sourceLine: t("chartSourceLine", {
      source: SOURCE,
      date: i18n.date(pointer.updatedAt),
      site: window.location.host,
    }),
    labels: {
      period: t("energyPeriod"),
      load: t("energyLoad"),
      complete: t("energyComplete"),
      year: t("csvYear"),
      source: t("energyCompareSource"),
      shareOfGeneration: t("energyShareOfGeneration"),
      shareOfLoad: t("energyShareOfLoad"),
      total: t("energyTotal"),
      pumping: t("energyPumping"),
      months: i18n.months,
      technology: (tech) => i18n.technology(tech),
    },
  };
  const only = embedded ? energy.chart : null;
  const shows = (chart: EnergyChart): boolean => only === null || only === chart;
  // a link to a card opens the page at it, once the data (and so the card) is there
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (ENERGY_CHARTS.some((chart) => chart === id))
      document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);
  const palette = PALETTES[theme];
  const available = ENERGY_AREAS.filter((a) => a === ALL || a in periods.countries);
  const area = available.includes(energy.area) ? energy.area : ALL;
  const areaName = area === ALL ? t("energyRegion") : i18n.country(area);
  const data = useMemo(() => series(periods, area, energy.unit), [periods, area, energy.unit]);
  const monthly = useMemo(() => series(periods, area, "month"), [periods, area]);
  const techs = technologiesOf(data);
  const ink = theme === "dark" ? "#E4E8EC" : "#1E262E";
  const grid = theme === "dark" ? "rgba(163,174,184,0.18)" : "rgba(94,106,117,0.16)";

  return (
    <>
      {only === null && (
        <div className={styles.controls}>
          <label className={styles.select}>
            <span>{t("energyArea")}</span>
            <select
              name="energy-area"
              value={area}
              onChange={(event) => {
                const value = event.target.value;
                if (isOneOf(ENERGY_AREAS, value)) update({ area: value });
              }}
            >
              {available.map((code) => (
                <option key={code} value={code}>
                  {code === ALL ? t("energyRegion") : i18n.country(code)}
                </option>
              ))}
            </select>
          </label>
          <Segmented
            label={t("energyUnit")}
            value={energy.unit}
            options={[
              { value: "month", label: t("energyMonthly") },
              { value: "year", label: t("energyYearly") },
            ]}
            onChange={(unit) => {
              update({ unit });
            }}
          />
          <Segmented
            label={t("energyShow")}
            value={energy.show}
            options={[
              { value: "chart", label: t("energyChart") },
              { value: "table", label: t("energyTable") },
            ]}
            onChange={(show) => {
              update({ show });
            }}
          />
        </div>
      )}
      {only === null && (
        <p className={styles.muted}>
          {t("energySource", { date: i18n.date(pointer.updatedAt) })}{" "}
          {area === ALL &&
            t("energyCountries", { list: data.countries.map((c) => i18n.country(c)).join(", ") })}
        </p>
      )}

      {shows("mix") && (
        <Card
          id="mix"
          title={t("energyMixTitle")}
          share={{
            kit,
            subtitle: `${areaName} · ${energy.unit === "month" ? t("energyMonthly") : t("energyYearly")}`,
            table: () => mixTable(data, techs, kit.labels),
          }}
        >
          {energy.show === "chart" ? (
            <div className={styles.chart}>
              <Suspense fallback={<p className={styles.muted}>{t("loadingData")}</p>}>
                <Charts.Stacked
                  labels={data.periods.map(i18n.period)}
                  bars={techs.map((tech) => ({
                    label: i18n.technology(tech),
                    color: palette.technology[tech],
                    values: data.generation[tech] ?? [],
                  }))}
                  line={{ label: t("energyLoad"), color: ink, values: data.load }}
                  coverage={data.coverage}
                  note={(index) => {
                    const share = data.coverage[index] ?? 0;
                    return share < 1 ? t("energyIncomplete", { share: i18n.number(share * 100) }) : null;
                  }}
                  description={t("energyMixDescription", {
                    area: areaName,
                    unit: energy.unit === "month" ? t("energyMonthly") : t("energyYearly"),
                  })}
                  format={i18n.energy}
                  ink={ink}
                  grid={grid}
                />
              </Suspense>
            </div>
          ) : (
            <MixTable data={data} techs={techs} />
          )}
        </Card>
      )}

      {shows("ring") && (
        <SourceRing
          data={data}
          techs={techs}
          area={area}
          krskoOf={(period) => krskoHalfOfPeriod(periods, energy.unit, period)}
          areaName={areaName}
          energy={energy}
          palette={palette}
          theme={theme}
          kit={kit}
          ink={ink}
          grid={grid}
        />
      )}

      {shows("compare") && (
        <YearComparison
          monthly={monthly}
          energy={energy}
          update={update}
          areaName={areaName}
          ink={ink}
          grid={grid}
          kit={kit}
        />
      )}

      {shows("range") && (
        <RangeTotals
          dataBaseUrl={dataBaseUrl}
          pointer={pointer}
          area={area}
          areaName={areaName}
          codes={data.countries}
          energy={energy}
          update={update}
          palette={palette}
          kit={kit}
        />
      )}
    </>
  );
}

/** A period counts as reported in full from here (the pipeline writes 1.0 for a complete one). */
const COMPLETE = 0.999;

export interface RingPeriod {
  period: string;
  coverage: number;
  /** what was generated, largest first; sources that generated nothing are left out */
  parts: { tech: Technology; mwh: number; share: number }[];
  total: number;
  renewableShare: number;
  load: number | null;
}

/** The sources of one period of a series; null when nothing was generated in it. */
export function ringPeriod(
  data: EnergySeries,
  techs: readonly Technology[],
  index: number,
): RingPeriod | null {
  const period = data.periods[index];
  if (period === undefined) return null;
  const amounts = techs.flatMap((tech) => {
    const mwh = data.generation[tech]?.[index];
    return mwh !== null && mwh !== undefined && mwh > 0 ? [{ tech, mwh }] : [];
  });
  const total = amounts.reduce((sum, part) => sum + part.mwh, 0);
  if (!(total > 0)) return null;
  const renewable = amounts
    .filter((part) => RENEWABLE.includes(part.tech))
    .reduce((sum, part) => sum + part.mwh, 0);
  const loadKnown = (data.loadCoverage[index] ?? 0) >= COMPLETE;
  return {
    period,
    coverage: data.coverage[index] ?? 0,
    parts: amounts.map((part) => ({ ...part, share: part.mwh / total })).sort((a, b) => b.mwh - a.mwh),
    total,
    renewableShare: renewable / total,
    load: loadKnown ? (data.load[index] ?? null) : null,
  };
}

/** Croatia's half of Krško, for Croatia or Slovenia alone (data/krsko.ts); nothing otherwise. */
function KrskoNote({ area, mwh, load }: { area: string; mwh: number | null; load: number | null }) {
  const i18n = useI18n();
  const note = krskoNote(
    i18n,
    area,
    mwh === null ? null : i18n.energy(mwh),
    mwh === null || !load ? null : i18n.percent(mwh / load),
  );
  return note === null ? null : <p className={styles.muted}>{note}</p>;
}

/** The same as a row of the range's table: not in its total for Croatia, inside it for Slovenia. */
function krskoRow(area: string, mwh: number | null, t: I18n["t"]): KrskoRow | null {
  if (mwh === null) return null;
  if (area === KRSKO_PARTNER) return { label: t("energyKrskoRowHr"), mwh };
  if (area === KRSKO_HOST) return { label: t("energyKrskoRowSi"), mwh };
  return null;
}

/** The groups of sources beside the ring (Faza 55-1); together they are all of generation. */
export const SOURCE_GROUPS = ["renewable", "fossil", "nuclear", "other"] as const;
export type SourceGroup = (typeof SOURCE_GROUPS)[number];
const FOSSIL: readonly Technology[] = ["gas", "coal", "lignite", "oil"];

export const groupOf = (tech: Technology): SourceGroup =>
  RENEWABLE.includes(tech)
    ? "renewable"
    : FOSSIL.includes(tech)
      ? "fossil"
      : tech === "nuclear"
        ? "nuclear"
        : "other";

/** How many periods the groups chart shows, ending with the ring's own. */
export const GROUP_PERIODS = 12;

export interface GroupShares {
  periods: string[];
  coverage: number[];
  /** per group, its percentage of each period's generation; null for a period with no generation */
  shares: Record<SourceGroup, (number | null)[]>;
}

/** The share of each group in the `count` periods up to `endIndex` of a series, oldest first. */
export function groupShares(
  data: EnergySeries,
  techs: readonly Technology[],
  endIndex: number,
  count = GROUP_PERIODS,
): GroupShares {
  const from = Math.max(0, endIndex - count + 1);
  const indices = Array.from({ length: endIndex - from + 1 }, (_, i) => from + i);
  const shares = Object.fromEntries(SOURCE_GROUPS.map((group) => [group, [] as (number | null)[]])) as Record<
    SourceGroup,
    (number | null)[]
  >;
  for (const index of indices) {
    const sums: Record<SourceGroup, number> = { renewable: 0, fossil: 0, nuclear: 0, other: 0 };
    for (const tech of techs) {
      const mwh = data.generation[tech]?.[index];
      if (mwh != null && mwh > 0) sums[groupOf(tech)] += mwh;
    }
    const total = SOURCE_GROUPS.reduce((sum, group) => sum + sums[group], 0);
    for (const group of SOURCE_GROUPS) shares[group].push(total > 0 ? (sums[group] / total) * 100 : null);
  }
  return {
    periods: indices.map((index) => data.periods[index] ?? ""),
    coverage: indices.map((index) => data.coverage[index] ?? 0),
    shares,
  };
}

/**
 * The share of each source in one month or year, as a ring (Faza 41-2). It opens on the latest period that
 * was reported in full; an incomplete one can be chosen and says that it is incomplete. Beside it (Faza 55-1),
 * the renewable, fossil and nuclear shares of the twelve periods up to the chosen one.
 */
function SourceRing(props: {
  data: EnergySeries;
  techs: Technology[];
  area: string;
  /** Croatia's half of Krško in a period of the series (data/krsko.ts) */
  krskoOf: (period: string) => number | null;
  areaName: string;
  energy: EnergyState;
  palette: (typeof PALETTES)[Theme];
  theme: Theme;
  kit: ShareKit;
  ink: string;
  grid: string;
}) {
  const { data, techs, area, krskoOf, areaName, energy, palette, theme, kit, ink, grid } = props;
  const i18n = useI18n();
  const { t } = i18n;
  const [chosen, setChosen] = useState<string | null>(null);
  const available = data.periods
    .map((_, index) => ringPeriod(data, techs, index))
    .filter((each): each is RingPeriod => each !== null)
    .reverse();
  const shown =
    available.find((each) => each.period === chosen) ??
    available.find((each) => each.coverage >= COMPLETE) ??
    available[0];
  const title = t("energyRingTitle");
  if (!shown) {
    return (
      <Card
        id="ring"
        title={title}
        share={{ kit, subtitle: areaName, table: () => ({ header: [], rows: [] }) }}
      >
        <p className={styles.muted}>{t("energyNoData")}</p>
      </Card>
    );
  }
  const rows = shown.parts.map((part) => ({
    label: i18n.technology(part.tech),
    colour: palette.technology[part.tech],
    share: part.share,
    percent: i18n.percent(part.share),
    amount: i18n.energy(part.mwh),
  }));
  const periodName = i18n.period(shown.period);
  return (
    <Card
      id="ring"
      title={title}
      actions={
        <label className={styles.inlineSelect}>
          <span>{t("energyPeriod")}</span>
          <select
            name="energy-ring-period"
            value={shown.period}
            onChange={(event) => {
              setChosen(event.target.value);
            }}
          >
            {available.map((each) => (
              <option key={each.period} value={each.period}>
                {i18n.period(each.period)}
              </option>
            ))}
          </select>
        </label>
      }
      share={{
        kit,
        subtitle: `${areaName} · ${periodName}`,
        table: () => ringTable(shown, kit.labels),
      }}
    >
      {energy.show === "chart" ? (
        <div className={styles.ringSplit}>
          <RingChart
            rows={rows}
            centre={{ value: i18n.percent(shown.renewableShare), label: t("sourcesRenewable") }}
            description={t("energyRingDescription", {
              area: areaName,
              period: periodName,
              list: rows.map((row) => `${row.label} ${row.percent}`).join(", "),
            })}
            theme={theme}
          />
          <GroupsChart
            data={data}
            techs={techs}
            endIndex={data.periods.indexOf(shown.period)}
            areaName={areaName}
            periodName={periodName}
            palette={palette}
            ink={ink}
            grid={grid}
          />
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("energyCompareSource")}</th>
                <th scope="col">MWh</th>
                <th scope="col">{t("energyShareOfGeneration")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.parts.map((part) => (
                <tr key={part.tech}>
                  <th scope="row">
                    <span
                      className={styles.dot}
                      style={{ background: palette.technology[part.tech] }}
                      aria-hidden="true"
                    />
                    {i18n.technology(part.tech)}
                  </th>
                  <td>{i18n.energy(part.mwh)}</td>
                  <td>{i18n.percent(part.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.muted}>
        {t("energyRingTotals", { total: i18n.energy(shown.total) })}
        {shown.load !== null && ` ${t("energyRingLoad", { load: i18n.energy(shown.load) })}`}
        {shown.coverage < COMPLETE &&
          ` ${t("energyIncomplete", { share: i18n.number(shown.coverage * 100) })}.`}
      </p>
      <KrskoNote area={area} mwh={krskoOf(shown.period)} load={shown.load} />
    </Card>
  );
}

/** The colour of each group: a source of the group in the map's palette, so one colour keeps one meaning. */
const GROUP_COLOUR: Record<SourceGroup, Technology> = {
  renewable: "biomass",
  fossil: "gas",
  nuclear: "nuclear",
  other: "other",
};
const GROUP_LABEL = {
  renewable: "energyGroupRenewable",
  fossil: "energyGroupFossil",
  nuclear: "energyGroupNuclear",
  other: "energyGroupOther",
} as const;

/** 100 % columns of the groups for the periods up to the ring's; a group with nothing in them is left out. */
function GroupsChart(props: {
  data: EnergySeries;
  techs: Technology[];
  endIndex: number;
  areaName: string;
  periodName: string;
  palette: (typeof PALETTES)[Theme];
  ink: string;
  grid: string;
}) {
  const { data, techs, endIndex, areaName, periodName, palette, ink, grid } = props;
  const i18n = useI18n();
  const { t } = i18n;
  const groups = useMemo(() => groupShares(data, techs, endIndex), [data, techs, endIndex]);
  if (endIndex < 0 || groups.periods.length === 0) return null;
  const count = String(groups.periods.length);
  const present = SOURCE_GROUPS.filter((group) => groups.shares[group].some((value) => (value ?? 0) > 0));
  return (
    <div className={styles.groups}>
      <h3 className={styles.groupsHeading}>{t("energyGroupsHeading", { count })}</h3>
      <div className={styles.groupsChart}>
        <Suspense fallback={<p className={styles.muted}>{t("loadingData")}</p>}>
          <Charts.Stacked
            labels={groups.periods.map(i18n.period)}
            bars={present.map((group) => ({
              label: t(GROUP_LABEL[group]),
              color: palette.technology[GROUP_COLOUR[group]],
              values: groups.shares[group],
            }))}
            coverage={groups.coverage}
            note={(index) => {
              const share = groups.coverage[index] ?? 0;
              return share < 1 ? t("energyIncomplete", { share: i18n.number(share * 100) }) : null;
            }}
            max={100}
            format={(value) => `${i18n.number(value)} %`}
            description={t("energyGroupsDescription", { area: areaName, count, period: periodName })}
            ink={ink}
            grid={grid}
          />
        </Suspense>
      </div>
    </div>
  );
}

function MixTable({ data, techs }: { data: EnergySeries; techs: Technology[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  const cell = (value: number | null | undefined): string =>
    value === null || value === undefined ? t("energyNoValue") : i18n.energy(value);
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t("energyPeriod")}</th>
            {techs.map((tech) => (
              <th key={tech} scope="col">
                {i18n.technology(tech)}
              </th>
            ))}
            <th scope="col">{t("energyLoad")}</th>
            <th scope="col">{t("energyComplete")}</th>
          </tr>
        </thead>
        <tbody>
          {data.periods.map((period, i) => {
            const coverage = data.coverage[i] ?? 0;
            return (
              <tr key={period} data-incomplete={coverage < 1 || undefined}>
                <th scope="row">{i18n.period(period)}</th>
                {techs.map((tech) => (
                  <td key={tech}>{cell(data.generation[tech]?.[i])}</td>
                ))}
                <td>{cell(data.load[i])}</td>
                <td>{i18n.percent(coverage)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function YearComparison(props: {
  monthly: EnergySeries;
  energy: EnergyState;
  update: (patch: Partial<EnergyState>) => void;
  areaName: string;
  ink: string;
  grid: string;
  kit: ShareKit;
}) {
  const { monthly, energy, update, areaName, ink, grid, kit } = props;
  const i18n = useI18n();
  const { t } = i18n;
  const techs = technologiesOf(monthly);
  const tech = techs.includes(energy.tech) ? energy.tech : techs[0];
  const lines = tech ? compareYears(monthly, tech) : [];
  const picker = (
    <label className={styles.select}>
      <span>{t("energyCompareSource")}</span>
      <select
        name="energy-source"
        value={tech ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          const next = techs.find((candidate) => candidate === value);
          if (next) update({ tech: next });
        }}
      >
        {techs.map((candidate) => (
          <option key={candidate} value={candidate}>
            {i18n.technology(candidate)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Card
      id="compare"
      title={t("energyCompareTitle")}
      actions={picker}
      share={{
        kit,
        subtitle: tech ? `${i18n.technology(tech)} · ${areaName}` : areaName,
        table: () => compareTable(lines, kit.labels),
      }}
    >
      {!tech || lines.length === 0 ? (
        <p className={styles.muted}>{t("energyCompareEmpty")}</p>
      ) : energy.show === "chart" ? (
        <div className={styles.chart}>
          <Suspense fallback={<p className={styles.muted}>{t("loadingData")}</p>}>
            <Charts.Lines
              labels={i18n.months}
              lines={lines.map((line, index) => ({
                label: line.year,
                color: YEAR_COLORS[(YEAR_COLORS.length - lines.length + index) % YEAR_COLORS.length] ?? ink,
                values: line.values,
              }))}
              description={t("energyCompareDescription", { tech: i18n.technology(tech), area: areaName })}
              format={i18n.energy}
              ink={ink}
              grid={grid}
            />
          </Suspense>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("energyPeriod")}</th>
                {i18n.months.map((month) => (
                  <th key={month} scope="col">
                    {month}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.year}>
                  <th scope="row">{line.year}</th>
                  {line.values.map((value, month) => (
                    <td key={month} data-incomplete={(line.coverage[month] ?? 0) < 1 || undefined}>
                      {value === null ? t("energyNoValue") : i18n.energy(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RangeTotals(props: {
  dataBaseUrl: URL;
  pointer: EnergyPointer;
  area: string;
  areaName: string;
  codes: string[];
  energy: EnergyState;
  update: (patch: Partial<EnergyState>) => void;
  palette: (typeof PALETTES)[Theme];
  kit: ShareKit;
}) {
  const { dataBaseUrl, pointer, area, areaName, codes, energy, update, palette, kit } = props;
  const i18n = useI18n();
  const { t } = i18n;
  const years = Object.keys(pointer.years).sort();
  const lastYear = years.at(-1) ?? "";
  const [draft, setDraft] = useState(
    () => energy.range ?? { from: `${lastYear}-06-01`, to: `${lastYear}-08-31` },
  );
  const days = rangeDays(draft.from, draft.to);
  const range = energy.range;
  const wanted = range ? yearsInRange(range.from, range.to).filter((y) => String(y) in pointer.years) : [];
  const [files] = useAsync(range ? `range:${wanted.join(",")}` : null, (signal) =>
    Promise.all(
      wanted.map((year) => {
        const entry = pointer.years[String(year)];
        if (!entry) throw new DataError(`no published data for ${year}`);
        return fetchJson(assetUrl(dataBaseUrl, entry.key), YearFileSchema, signal);
      }),
    ),
  );

  let result: ReactNode = <p className={styles.muted}>{t("energyRangeHint")}</p>;
  // the rows the table shows; until a period is calculated there are none
  let rows: Table = { header: [], rows: [] };
  if (range && files?.status === "error") {
    result = (
      <p className={styles.muted} role="alert">
        {t("energyFailed")}
      </p>
    );
  } else if (range && files?.status === "ready") {
    const totals = rangeTotals(files.value, area, codes, range.from, range.to);
    const krsko = krskoHalfOfRange(files.value, range.from, range.to);
    rows = rangeTable(totals, kit.labels, krskoRow(area, krsko, t));
    if (totals.coveredDays === 0 && totals.total === 0) {
      result = <p className={styles.muted}>{t("energyRangeEmpty")}</p>;
    } else {
      result = (
        <>
          <p className={styles.muted} role="status">
            {t("energyCoverage", { covered: totals.coveredDays, total: totals.days })}
            {totals.load === null && ` ${t("energyLoadUnknown")}`}
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("energyCompareSource")}</th>
                  <th scope="col">MWh</th>
                  <th scope="col">{t("energyShareOfGeneration")}</th>
                  <th scope="col">{t("energyShareOfLoad")}</th>
                </tr>
              </thead>
              <tbody>
                {totals.generation.map((row) => (
                  <tr key={row.tech}>
                    <th scope="row">
                      <span
                        className={styles.dot}
                        style={{ background: palette.technology[row.tech] }}
                        aria-hidden="true"
                      />
                      {i18n.technology(row.tech)}
                    </th>
                    <td>{i18n.energy(row.mwh)}</td>
                    <td>{totals.total > 0 ? i18n.percent(row.mwh / totals.total) : "—"}</td>
                    <td>{totals.load ? i18n.percent(row.mwh / totals.load) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{t("energyTotal")}</th>
                  <td>{i18n.energy(totals.total)}</td>
                  <td>{i18n.percent(1)}</td>
                  <td>{totals.load ? i18n.percent(totals.total / totals.load) : "—"}</td>
                </tr>
                <tr>
                  <th scope="row">{t("energyLoad")}</th>
                  <td>{totals.load === null ? "—" : i18n.energy(totals.load)}</td>
                  <td />
                  <td />
                </tr>
                {totals.pumping > 0 && (
                  <tr>
                    <th scope="row">{t("energyPumping")}</th>
                    <td>{i18n.energy(totals.pumping)}</td>
                    <td />
                    <td />
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
          <KrskoNote area={area} mwh={krsko} load={totals.load} />
        </>
      );
    }
  } else if (range) {
    result = (
      <p className={styles.muted} role="status">
        {t("loadingData")}
      </p>
    );
  }

  return (
    <Card
      id="range"
      title={t("energyRangeTitle")}
      share={{
        kit,
        subtitle: range ? `${areaName} · ${i18n.date(range.from)} – ${i18n.date(range.to)}` : areaName,
        table: () => rows,
      }}
    >
      <form
        className={styles.rangeForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (days !== null) update({ range: draft });
        }}
      >
        <label className={styles.select}>
          <span>{t("energyFrom")}</span>
          <input
            name="energy-from"
            type="date"
            value={draft.from}
            min={`${years[0] ?? ""}-01-01`}
            max={`${lastYear}-12-31`}
            onChange={(event) => {
              setDraft((d) => ({ ...d, from: event.target.value }));
            }}
          />
        </label>
        <label className={styles.select}>
          <span>{t("energyTo")}</span>
          <input
            name="energy-to"
            type="date"
            value={draft.to}
            min={`${years[0] ?? ""}-01-01`}
            max={`${lastYear}-12-31`}
            onChange={(event) => {
              setDraft((d) => ({ ...d, to: event.target.value }));
            }}
          />
        </label>
        <button type="submit" className={styles.button} disabled={days === null}>
          {t("energyCalculate")}
        </button>
      </form>
      {days === null && <p className={styles.warning}>{t("energyRangeInvalid")}</p>}
      {result}
    </Card>
  );
}
