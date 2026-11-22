/**
 * The "Usporedbe" page (Faza 49): the visitor picks a country, a month, two years or a period, and gets
 * the comparison as a chart and a table, each with the share menu every chart of the site has (a link that
 * opens the same comparison, a picture, the numbers as CSV, a citation). The figures are the monthly
 * reports' own (compare.ts); the monthly reports link here, and this page links back to them.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";

import { useAsync } from "../app/useAsync";
import { assetUrl, DataError } from "../data/current";
import { ALL, EnergyPointerSchema, PeriodsSchema, type EnergyPointer, type Periods } from "../data/energy";
import { PRICE_MONTHS_KEY, PriceMonthsSchema, type PriceMonths } from "../data/priceMonths";
import { isOneOf, type Technology } from "../domain";
import { useI18n, type I18n } from "../i18n";
import { PALETTES, type Theme } from "../map/palette";
import { ChartShare } from "../share/ChartShare";
import type { Table } from "../share/csv";
import { PATHS } from "../seo/pages";
import { REPORTS_FROM } from "../seo/report";
import { mapLink } from "../seo/site";
import { ENERGY_AREAS, ENERGY_UNITS, type AppState, type CompareState, type EnergyUnit } from "../state/url";
import styles from "../energy/EnergyView.module.css";
import {
  areaRows,
  change,
  countriesSide,
  countryPeriods,
  monthAcrossYears,
  resolveChoice,
  rowIntensity,
  sameChoice,
  yearAgainstYear,
  yearsOf,
  type PeriodRow,
} from "./compare";
import own from "./CompareView.module.css";

let chartsModule: Promise<typeof import("../energy/charts")> | null = null;
const loadCharts = (): Promise<typeof import("../energy/charts")> =>
  (chartsModule ??= import("../energy/charts"));
const Stacked = lazy(() => loadCharts().then((m) => ({ default: m.StackedChart })));

const SOURCE = "ENTSO-E Transparency Platform";

interface Props {
  dataBaseUrl: URL;
  compare: CompareState;
  setState: (update: (state: AppState) => AppState) => void;
  theme: Theme;
}

type Loaded =
  { kind: "none" } | { kind: "ready"; pointer: EnergyPointer; periods: Periods; prices: PriceMonths | null };

async function fetchParsed<T>(
  url: string,
  parse: (value: unknown) => T,
  signal: AbortSignal,
): Promise<T | null> {
  const response = await fetch(url, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new DataError(`${url} returned HTTP ${String(response.status)}`);
  return parse(await response.json());
}

async function load(base: URL, signal: AbortSignal): Promise<Loaded> {
  const fresh = `?t=${String(Math.floor(Date.now() / 60_000))}`;
  const pointer = await fetchParsed(
    `${assetUrl(base, "energy/current.json")}${fresh}`,
    (value) => EnergyPointerSchema.parse(value),
    signal,
  );
  if (!pointer) return { kind: "none" };
  const [periods, prices] = await Promise.all([
    fetchParsed(assetUrl(base, pointer.periods.key), (value) => PeriodsSchema.parse(value), signal),
    // the prices are a column of the countries card; without them the card simply has no such column
    fetchParsed(
      `${assetUrl(base, PRICE_MONTHS_KEY)}${fresh}`,
      (value) => PriceMonthsSchema.parse(value),
      signal,
    ),
  ]);
  if (!periods) throw new DataError("the energy pointer names a periods file that is not there");
  return { kind: "ready", pointer, periods, prices };
}

/** "listopad" / "October" */
function monthNames(i18n: I18n): string[] {
  const format = new Intl.DateTimeFormat(i18n.locale, { month: "long", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, i) => format.format(new Date(Date.UTC(2024, i, 15))));
}

/** Up to this many months left out, the sentence names those instead of the eleven kept. */
const FEW_LEFT_OUT = 3;

/**
 * The months compared, in words: nothing for the whole year, a span ("siječanj–listopad"), the few left out
 * ("but" holds "ožujak"), or a list ("siječanj, ožujak i lipanj").
 */
export function monthSpan(
  months: readonly number[],
  names: readonly string[],
  and: string,
): { kind: "all" | "span" | "but" | "list"; text: string } {
  const name = (month: number): string => names[month - 1] ?? String(month);
  const list = (items: readonly number[]): string =>
    items.length === 1
      ? name(items[0] ?? 0)
      : `${items.slice(0, -1).map(name).join(", ")} ${and} ${name(items.at(-1) ?? 0)}`;
  if (months.length === 12) return { kind: "all", text: "" };
  const first = months[0];
  const last = months.at(-1);
  if (first === undefined || last === undefined) return { kind: "list", text: "" };
  if (last - first + 1 === months.length) {
    return { kind: "span", text: months.length === 1 ? name(first) : `${name(first)}–${name(last)}` };
  }
  const missing = Array.from({ length: 12 }, (_, i) => i + 1).filter((month) => !months.includes(month));
  if (missing.length <= FEW_LEFT_OUT) return { kind: "but", text: list(missing) };
  return { kind: "list", text: list(months) };
}

export function CompareView({ dataBaseUrl, compare, setState, theme }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const [loaded, retry] = useAsync(`compare:${dataBaseUrl.href}`, (signal) => load(dataBaseUrl, signal));
  const update = (patch: Partial<CompareState>): void => {
    setState((s) => ({ ...s, compare: { ...s.compare, ...patch } }));
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
    body = <Content {...loaded.value} compare={compare} update={update} theme={theme} />;
  }

  return (
    <div className={styles.view} data-compare>
      <header className={styles.header}>
        <h2>{t("compareTitle")}</h2>
        <p className={styles.intro}>{t("compareIntro")}</p>
        <p className={own.links}>
          <a href={PATHS[i18n.lang].reports}>{t("compareReportsLink")}</a>
          <a href={mapLink(i18n.lang, { p: "energy" })}>{t("compareEnergyLink")}</a>
        </p>
      </header>
      {body}
    </div>
  );
}

interface Kit {
  dataDate: string;
  sourceLine: string;
  ink: string;
  grid: string;
  colors: Record<Technology, string>;
  names: string[];
}

function Content(props: {
  pointer: EnergyPointer;
  periods: Periods;
  prices: PriceMonths | null;
  compare: CompareState;
  update: (patch: Partial<CompareState>) => void;
  theme: Theme;
}) {
  const { pointer, periods, prices, compare, update, theme } = props;
  const i18n = useI18n();
  const { t } = i18n;
  const kit: Kit = {
    dataDate: pointer.updatedAt,
    sourceLine: t("chartSourceLine", {
      source: SOURCE,
      date: i18n.date(pointer.updatedAt),
      site: window.location.host,
    }),
    ink: theme === "dark" ? "#E4E8EC" : "#1E262E",
    grid: theme === "dark" ? "rgba(163,174,184,0.18)" : "rgba(94,106,117,0.16)",
    colors: PALETTES[theme].technology,
    names: monthNames(i18n),
  };
  const available = ENERGY_AREAS.filter((a) => a === ALL || a in periods.countries);
  const area = available.includes(compare.area) ? compare.area : (available[0] ?? ALL);
  const areaName = area === ALL ? t("energyRegion") : i18n.country(area);
  const monthRows = areaRows(periods, area, "month") ?? [];
  const options = countryPeriods(periods, compare.unit);
  const shown = resolveChoice(compare, monthRows, options);
  // what is shown goes into the address (replaced, not added to the history), so the link a card shares
  // and the citation it gives hold the figures on screen, not "the latest" of whenever they are opened
  useEffect(() => {
    if (!sameChoice(shown, compare)) update(shown);
  });

  return (
    <>
      <div className={styles.controls}>
        <label className={styles.select}>
          <span>{t("energyArea")}</span>
          <select
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
      </div>
      <p className={styles.muted}>{t("energySource", { date: i18n.date(pointer.updatedAt) })}</p>
      <MonthCard rows={monthRows} month={shown.month ?? 1} update={update} areaName={areaName} kit={kit} />
      <YearsCard rows={monthRows} chosen={shown.years} update={update} areaName={areaName} kit={kit} />
      <CountriesCard
        periods={periods}
        prices={prices}
        unit={compare.unit}
        options={options}
        period={shown.period}
        update={update}
        kit={kit}
      />
    </>
  );
}

/** A card with the site's share menu; its link is the page's own address, which holds every choice. */
function Card(props: {
  id: string;
  title: string;
  subtitle: string;
  controls: ReactNode;
  table: () => Table;
  kit: Kit;
  children: ReactNode;
}) {
  const { id, title, subtitle, controls, table, kit, children } = props;
  const ref = useRef<HTMLElement>(null);
  return (
    <section id={id} ref={ref} className={styles.card} aria-label={title}>
      <div className={styles.cardHead}>
        <h3>{title}</h3>
        <div className={styles.cardActions}>
          <ChartShare
            title={title}
            subtitle={subtitle}
            anchor={id}
            sources={[SOURCE]}
            dataDate={kit.dataDate}
            sourceLine={kit.sourceLine}
            table={table}
            canvas={() => ref.current?.querySelector("canvas") ?? null}
          />
        </div>
      </div>
      <div className={own.controls}>{controls}</div>
      {children}
      <p className={styles.cardSource}>{kit.sourceLine}</p>
    </section>
  );
}

const techsOf = (rows: readonly PeriodRow[]): Technology[] => {
  const totals = new Map<Technology, number>();
  for (const row of rows) {
    for (const [tech, value] of Object.entries(row.byTech) as [Technology, number][]) {
      totals.set(tech, (totals.get(tech) ?? 0) + value);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([tech]) => tech);
};

function Chart(props: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className={styles.chart}>
      <Suspense fallback={<p className={styles.muted}>{t("loadingData")}</p>}>{props.children}</Suspense>
    </div>
  );
}

// ---------------------------------------------------------------- one month across the years

function MonthCard(props: {
  rows: PeriodRow[];
  month: number;
  update: (patch: Partial<CompareState>) => void;
  areaName: string;
  kit: Kit;
}) {
  const { rows, month, update, areaName, kit } = props;
  const i18n = useI18n();
  const { t } = i18n;
  const years = monthAcrossYears(rows, month);
  const techs = techsOf(years);
  const monthName = kit.names[month - 1] ?? "";
  const table = (): Table => ({
    header: [
      t("energyPeriod"),
      ...techs.map((tech) => i18n.technology(tech)),
      t("energyTotal"),
      t("compareRenewable"),
      t("energyComplete"),
    ],
    rows: years.map((row) => [
      row.period,
      ...techs.map((tech) => row.byTech[tech] ?? null),
      row.total,
      row.share,
      row.coverage,
    ]),
  });
  return (
    <Card
      id="month"
      title={t("compareMonthTitle")}
      subtitle={`${monthName} · ${areaName}`}
      table={table}
      kit={kit}
      controls={
        <label className={styles.select}>
          <span>{t("compareMonth")}</span>
          <select
            value={month}
            onChange={(event) => {
              update({ month: Number(event.target.value) });
            }}
          >
            {kit.names.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {years.length === 0 ? (
        <p className={styles.muted}>{t("compareMonthEmpty")}</p>
      ) : (
        <>
          <Chart>
            <Stacked
              labels={years.map((row) => row.period.slice(0, 4))}
              bars={techs.map((tech) => ({
                label: i18n.technology(tech),
                color: kit.colors[tech],
                values: years.map((row) => row.byTech[tech] ?? null),
              }))}
              line={{ label: t("energyLoad"), color: kit.ink, values: years.map((row) => row.load) }}
              coverage={years.map((row) => (row.complete ? 1 : row.coverage))}
              note={(index) => {
                const row = years[index];
                if (!row) return null;
                const share =
                  row.share === null ? "" : t("compareRenewableIs", { share: i18n.percent(row.share) });
                return row.complete
                  ? share
                  : `${share}\n${t("energyIncomplete", { share: i18n.number(row.coverage * 100) })}`;
              }}
              description={t("compareMonthDescription", { month: monthName, area: areaName })}
              format={i18n.energy}
              ink={kit.ink}
              grid={kit.grid}
            />
          </Chart>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("energyPeriod")}</th>
                  <th scope="col">{t("energyTotal")}</th>
                  <th scope="col">{t("compareRenewable")}</th>
                  <th scope="col">{t("compareCo2")}</th>
                </tr>
              </thead>
              <tbody>
                {[...years].reverse().map((row) => (
                  <tr key={row.period} data-incomplete={!row.complete || undefined}>
                    <th scope="row">
                      {row.period.slice(0, 4)}
                      {!row.complete && <span className={own.flag}> {t("compareIncomplete")}</span>}
                    </th>
                    <td>{row.total === null ? t("energyNoValue") : i18n.energy(row.total)}</td>
                    <td>{row.share === null ? t("energyNoValue") : i18n.percent(row.share)}</td>
                    <td>{co2Text(row, i18n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

/** g CO₂/kWh, calculated as the reports calculate it (seo/report.ts `rowIntensity`). */
function co2Text(row: PeriodRow, i18n: I18n): string {
  const value = rowIntensity(row);
  return value === null ? i18n.t("energyNoValue") : i18n.number(Math.round(value));
}

// ---------------------------------------------------------------- one year against another

function YearsCard(props: {
  rows: PeriodRow[];
  chosen: readonly [string, string] | null;
  update: (patch: Partial<CompareState>) => void;
  areaName: string;
  kit: Kit;
}) {
  const { rows, chosen, update, areaName, kit } = props;
  const i18n = useI18n();
  const { t } = i18n;
  const years = yearsOf(rows);
  const pair = chosen ? yearAgainstYear(rows, chosen[0], chosen[1]) : null;
  const span = pair ? monthSpan(pair.months, kit.names, t("compareAnd")) : null;
  const spanText =
    span === null || span.kind === "all"
      ? ""
      : span.kind === "but"
        ? t("compareAllBut", { months: span.text })
        : span.text;
  const signed = (value: number, text: string): string =>
    value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
  const changeText = (a: number, b: number): string => {
    const share = change(a, b);
    return share === null ? t("energyNoValue") : signed(share, i18n.percent(Math.abs(share)));
  };
  const table = (): Table => ({
    header: [
      t("energyCompareSource"),
      chosen?.[0] ?? "",
      chosen?.[1] ?? "",
      t("compareChange"),
      t("compareChangeShare"),
    ],
    rows: pair
      ? [
          ...pair.rows.map((row) => [
            i18n.technology(row.tech),
            row.a,
            row.b,
            row.b - row.a,
            change(row.a, row.b),
          ]),
          [
            t("energyTotal"),
            pair.total.a,
            pair.total.b,
            pair.total.b - pair.total.a,
            change(pair.total.a, pair.total.b),
          ],
        ]
      : [],
  });
  const pick = (index: 0 | 1) => (
    <label className={styles.select}>
      <span>{t(index === 0 ? "compareYearA" : "compareYearB")}</span>
      <select
        value={chosen?.[index] ?? ""}
        onChange={(event) => {
          if (!chosen) return;
          const next: [string, string] = [chosen[0], chosen[1]];
          next[index] = event.target.value;
          // the same year twice compares nothing: the other one steps aside
          if (next[0] === next[1]) next[1 - index] = chosen[index];
          update({ years: [next[0], next[1]] });
        }}
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Card
      id="years"
      title={t("compareYearsTitle")}
      subtitle={
        chosen ? `${chosen[0]} – ${chosen[1]}${spanText ? ` (${spanText})` : ""} · ${areaName}` : areaName
      }
      table={table}
      kit={kit}
      controls={
        years.length >= 2 ? (
          <>
            {pick(0)}
            {pick(1)}
          </>
        ) : null
      }
    >
      {!pair || !chosen ? (
        <p className={styles.muted}>{t(years.length < 2 ? "compareYearsFew" : "compareYearsEmpty")}</p>
      ) : (
        <>
          <p className={own.note}>
            {spanText ? t("compareYearsMonths", { months: spanText }) : t("compareYearsAll")}
          </p>
          <Chart>
            <Stacked
              labels={[chosen[0], chosen[1]]}
              bars={pair.rows.map((row) => ({
                label: i18n.technology(row.tech),
                color: kit.colors[row.tech],
                values: [row.a, row.b],
              }))}
              line={{
                label: t("compareRenewableEnergy"),
                color: kit.ink,
                values: [pair.renewable.a, pair.renewable.b],
              }}
              coverage={[1, 1]}
              note={() => null}
              description={t("compareYearsDescription", { a: chosen[0], b: chosen[1], area: areaName })}
              format={i18n.energy}
              ink={kit.ink}
              grid={kit.grid}
            />
          </Chart>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("energyCompareSource")}</th>
                  <th scope="col">{chosen[0]}</th>
                  <th scope="col">{chosen[1]}</th>
                  <th scope="col">{t("compareChange")}</th>
                </tr>
              </thead>
              <tbody>
                {pair.rows.map((row) => (
                  <tr key={row.tech}>
                    <th scope="row">{i18n.technology(row.tech)}</th>
                    <td>{i18n.energy(row.a)}</td>
                    <td>{i18n.energy(row.b)}</td>
                    <td>{changeText(row.a, row.b)}</td>
                  </tr>
                ))}
                <tr className={own.total}>
                  <th scope="row">{t("energyTotal")}</th>
                  <td>{i18n.energy(pair.total.a)}</td>
                  <td>{i18n.energy(pair.total.b)}</td>
                  <td>{changeText(pair.total.a, pair.total.b)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- the countries side by side

function CountriesCard(props: {
  periods: Periods;
  prices: PriceMonths | null;
  unit: EnergyUnit;
  options: string[];
  period: string | null;
  update: (patch: Partial<CompareState>) => void;
  kit: Kit;
}) {
  const { periods, prices, unit, options, period, update, kit } = props;
  const i18n = useI18n();
  const { t, lang } = i18n;
  const rows = useMemo(
    () => (period ? countriesSide(periods, unit, period, prices) : []),
    [periods, unit, period, prices],
  );
  const techs = techsOf(rows.map((each) => each.row));
  const withPrice = rows.some((each) => each.price !== null);
  const periodName = period ? (unit === "month" ? i18n.period(period) : period) : "";
  const percentOf = (value: number | undefined, total: number | null): number | null =>
    value === undefined || total === null || total <= 0 ? null : (value / total) * 100;
  const table = (): Table => ({
    header: [
      t("energyArea"),
      t("energyTotal"),
      t("compareRenewable"),
      t("compareCo2"),
      ...(withPrice ? [t("comparePrice")] : []),
      ...techs.map((tech) => i18n.technology(tech)),
    ],
    rows: rows.map((each) => [
      i18n.country(each.code),
      each.row.total,
      each.row.share,
      each.intensity === null ? null : Math.round(each.intensity),
      ...(withPrice ? [each.price] : []),
      ...techs.map((tech) => each.row.byTech[tech] ?? null),
    ]),
  });
  const reportable = unit === "month" && period !== null && period >= REPORTS_FROM;
  return (
    <Card
      id="countries"
      title={t("compareCountriesTitle")}
      subtitle={periodName}
      table={table}
      kit={kit}
      controls={
        <>
          <div className={styles.segmented} role="group" aria-label={t("energyUnit")}>
            {ENERGY_UNITS.map((value: EnergyUnit) => (
              <button
                key={value}
                type="button"
                aria-pressed={unit === value}
                onClick={() => {
                  update({ unit: value, period: null });
                }}
              >
                {t(value === "month" ? "compareUnitMonth" : "compareUnitYear")}
              </button>
            ))}
          </div>
          {options.length > 0 && (
            <label className={styles.select}>
              <span>{t("energyPeriod")}</span>
              <select
                value={period ?? ""}
                onChange={(event) => {
                  update({ period: event.target.value });
                }}
              >
                {options.map((value) => (
                  <option key={value} value={value}>
                    {unit === "month" ? i18n.period(value) : value}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      }
    >
      {rows.length === 0 || period === null ? (
        <p className={styles.muted}>{t("compareCountriesEmpty")}</p>
      ) : (
        <>
          <Chart>
            <Stacked
              labels={rows.map((each) => i18n.country(each.code))}
              bars={techs.map((tech) => ({
                label: i18n.technology(tech),
                color: kit.colors[tech],
                values: rows.map((each) => percentOf(each.row.byTech[tech], each.row.total)),
              }))}
              line={{
                label: t("compareRenewable"),
                color: kit.ink,
                values: rows.map((each) => (each.row.share === null ? null : each.row.share * 100)),
              }}
              coverage={rows.map(() => 1)}
              note={(index) => {
                const each = rows[index];
                return each?.row.total ? `${t("energyTotal")}: ${i18n.energy(each.row.total)}` : null;
              }}
              description={t("compareCountriesDescription", { period: periodName })}
              format={(value) => `${i18n.number(value)} %`}
              ink={kit.ink}
              grid={kit.grid}
            />
          </Chart>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("energyArea")}</th>
                  <th scope="col">{t("energyTotal")}</th>
                  <th scope="col">{t("compareRenewable")}</th>
                  <th scope="col">{t("compareCo2")}</th>
                  {withPrice && <th scope="col">{t("comparePrice")}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((each) => (
                  <tr key={each.code}>
                    <th scope="row">{i18n.country(each.code)}</th>
                    <td>{each.row.total === null ? t("energyNoValue") : i18n.energy(each.row.total)}</td>
                    <td>{each.row.share === null ? t("energyNoValue") : i18n.percent(each.row.share)}</td>
                    <td>
                      {each.intensity === null ? t("energyNoValue") : i18n.number(Math.round(each.intensity))}
                    </td>
                    {withPrice && (
                      <td>{each.price === null ? t("energyNoValue") : i18n.number(each.price, 1)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={own.note}>
            {t("compareCo2Note")} {withPrice ? t("comparePriceNote") : ""}
          </p>
          {unit === "month" && (
            <p className={own.links}>
              {reportable && (
                <a href={PATHS[lang].report(period)}>{t("compareReport", { month: periodName })}</a>
              )}
              <a href={mapLink(lang, { pic: period })}>{t("compareMonthPicture")}</a>
            </p>
          )}
        </>
      )}
    </Card>
  );
}
