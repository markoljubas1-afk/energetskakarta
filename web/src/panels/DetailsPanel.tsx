import {
  Building2,
  Cable,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Factory,
  Flame,
  Fuel,
  Pickaxe,
  Plug,
  Server,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { osmUrl, SECTORS } from "../domain";
import { useI18n, type I18n } from "../i18n";
import { latest } from "../data/gas";
import type { Photo } from "../data/images";
import type { NowMix } from "../data/greenShare";
import type { Around } from "../data/nearby";
import { polyline, sparkline } from "./sparkline";
import { expansionNote, type CitySelection, type GasSelection, type Selection } from "../map/selection";
import styles from "./DetailsPanel.module.css";

/** EMODnet reports pipe sizes in inches (the trade's nominal sizes); readers here think in millimetres. */
const MM_PER_INCH = 25.4;

interface Props {
  id: string;
  /** null while the map has not delivered the asset's properties yet */
  selection: Selection | null;
  onClose: () => void;
  /** the asset's photograph, when the data has one (data/images.ts) */
  photo?: Photo | null;
  /** a plant's nearest substation and the lines ending there, lit on the map (data/nearby.ts) */
  around?: Around | null;
  /** a charging station: what its country's plants are generating right now (data/greenShare.ts) */
  mix?: NowMix | null;
  /** the map settled and could not find the selected object, even after flying to it (Faza 56, 4.4a) */
  notFound?: boolean;
}

const percent = (share: number): number => Math.round(share * 100);

/** The largest sources are named; the rest are added up. */
const MIX_NAMED = 3;

const ENTSOG_URL = "https://transparency.entsog.eu/";

const ICONS = {
  line: Cable,
  cable: Cable,
  substation: Zap,
  plant: Factory,
  pipeline: Fuel,
  datacenter: Server,
  charger: Plug,
  extraction: Pickaxe,
  city: Building2,
  gas: Flame,
} as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const CHART = { width: 300, height: 72, padY: 10 };

/**
 * The days as a line: scaled between the smallest and largest day so the difference is visible, with
 * both ends labelled so nobody reads the scale as starting at zero. A day without a figure breaks the
 * line and leaves a hollow mark on the baseline. The table below carries the same figures for readers.
 */
function GasChart({
  gas,
  day,
  perDay,
  noFigure,
}: {
  gas: GasSelection;
  day: (iso: string) => string;
  perDay: (kwh: number) => string;
  noFigure: string;
}) {
  const chart = sparkline(gas.kwhPerDay, CHART);
  const label = (index: number, kwh: number): string => `${day(gas.days[index] ?? "")}: ${perDay(kwh)}`;
  const first = gas.days[0] ?? "";
  const last = gas.days[gas.days.length - 1] ?? "";
  return (
    <figure className={styles.chart} data-gas-chart={chart.points.length}>
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-label={`${day(first)} – ${day(last)}`}
      >
        {chart.runs.map((run) =>
          run.length === 1 ? (
            <circle key={run[0]?.index} cx={run[0]?.x} cy={run[0]?.y} r={2.2} className={styles.chartDot} />
          ) : (
            <polyline key={run[0]?.index} points={polyline(run)} className={styles.chartLine} fill="none" />
          ),
        )}
        {chart.gaps.map((x) => (
          <circle key={x} cx={x} cy={CHART.height - 3} r={2.5} className={styles.chartGap}>
            <title>{noFigure}</title>
          </circle>
        ))}
        {chart.max && chart.min && chart.max.index !== chart.min.index && (
          <>
            <circle cx={chart.max.x} cy={chart.max.y} r={3.2} className={styles.chartMark} />
            <text
              x={chart.max.x}
              y={chart.max.y - 5}
              textAnchor={anchor(chart.max.x, CHART.width)}
              className={styles.chartLabel}
            >
              {label(chart.max.index, chart.max.value)}
            </text>
            <circle cx={chart.min.x} cy={chart.min.y} r={3.2} className={styles.chartMark} />
            <text
              x={chart.min.x}
              y={chart.min.y + 12}
              textAnchor={anchor(chart.min.x, CHART.width)}
              className={styles.chartLabel}
            >
              {label(chart.min.index, chart.min.value)}
            </text>
          </>
        )}
      </svg>
      <figcaption className={styles.chartAxis}>
        <span>{day(first)}</span>
        <span>{day(last)}</span>
      </figcaption>
    </figure>
  );
}

/** Keep a label inside the drawing: start it at the left edge, end it at the right, centre elsewhere. */
function anchor(x: number, width: number): "start" | "middle" | "end" {
  if (x < width * 0.25) return "start";
  if (x > width * 0.75) return "end";
  return "middle";
}

/** A country's gas production: the latest gas day as the headline, every day as a bar (a missing day
 * is an empty track, never a zero bar), and the points the platform sums it from. */
function GasDetails({ gas, i18n }: { gas: GasSelection; i18n: I18n }) {
  const { t } = i18n;
  // always GWh with one decimal, so a column of days lines up and 12,0 and 12,4 read as neighbours
  const perDay = (kwh: number): string =>
    `${i18n.number(kwh / 1_000_000, 1)} ${t("unitGwh")}/${t("unitDay")}`;
  const last = latest(gas.kwhPerDay);
  const largest = Math.max(1, ...gas.kwhPerDay.filter((v): v is number => v !== null));
  const reported = gas.kwhPerDay.filter((v) => v !== null).length;
  const day = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.locale, { day: "numeric", month: "short" }).format(
      new Date(`${iso}T12:00:00Z`),
    );
  return (
    <>
      <dl className={styles.rows}>
        <Row label={t("detailsGasLatest")}>
          {last ? (
            <>
              {perDay(last.kwh)}{" "}
              <span className={styles.muted}>({i18n.date(gas.days[last.index] ?? "")})</span>
            </>
          ) : (
            t("unknown")
          )}
        </Row>
        <Row label={t("detailsGasDays")}>{t("detailsGasReported", { reported, days: gas.days.length })}</Row>
        <Row label={t("detailsCountry")}>{i18n.country(gas.country)}</Row>
      </dl>
      <h3 className={styles.subheading}>{t("detailsGasByDay")}</h3>
      <GasChart gas={gas} day={day} perDay={perDay} noFigure={t("detailsGasNoFigure")} />
      <details className={styles.dayTable}>
        <summary>{t("detailsGasAllDays")}</summary>
        <ul className={styles.bars} aria-label={t("detailsGasByDay")}>
          {gas.days.map((iso, index) => {
            const kwh = gas.kwhPerDay[index] ?? null;
            return (
              <li key={iso}>
                <span className={styles.barLabel}>{day(iso)}</span>
                <span className={styles.barValue}>
                  {kwh === null ? t("detailsGasNoFigure") : perDay(kwh)}
                </span>
                <span className={styles.barTrack} aria-hidden="true">
                  {kwh !== null && (
                    <span className={styles.barFill} style={{ width: `${(100 * kwh) / largest}%` }} />
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </details>
      {gas.points.length > 0 && (
        <Row label={t("detailsGasPoints")}>
          {gas.points.map((point) => `${point.label} (${point.operator})`).join("; ")}
        </Row>
      )}
      <p className={styles.muted}>{t("detailsGasNote")}</p>
      {gas.generatedAt && (
        <p className={styles.muted}>{t("detailsGasGenerated", { time: i18n.dateTime(gas.generatedAt) })}</p>
      )}
    </>
  );
}

/** A city's inventory: the headline figures, then electricity by purpose as bars, largest first. */
function CityDetails({ city, i18n }: { city: CitySelection; i18n: I18n }) {
  const { t } = i18n;
  const mwh = (value: number): string => `${i18n.number(value)} ${t("unitMwhYear")}`;
  const rows = SECTORS.flatMap((sector) => {
    const energy = city.sectors[sector];
    return energy ? [{ sector, ...energy }] : [];
  }).sort((a, b) => b.electricityMwh - a.electricityMwh);
  const largest = Math.max(1, ...rows.map((row) => row.electricityMwh));
  const change =
    city.baselineYear !== null && city.baselineElectricityMwh !== null && city.baselineElectricityMwh > 0
      ? (city.electricityMwh - city.baselineElectricityMwh) / city.baselineElectricityMwh
      : null;
  return (
    <>
      <dl className={styles.rows}>
        <Row label={t("detailsInventoryYear")}>
          {city.inventoryYear}{" "}
          <span className={styles.muted}>
            ({t(city.baseline ? "detailsInventoryBaseline" : "detailsInventoryMonitoring")})
          </span>
        </Row>
        {city.population !== null && <Row label={t("detailsPopulation")}>{i18n.number(city.population)}</Row>}
        <Row label={t("detailsElectricity")}>{mwh(city.electricityMwh)}</Row>
        <Row label={t("detailsAllCarriers")}>{mwh(city.totalMwh)}</Row>
        <Row label={t("detailsCountry")}>{i18n.country(city.country)}</Row>
      </dl>
      {change !== null && city.baselineYear !== null && (
        <p className={styles.muted} data-change={change < 0 ? "down" : "up"}>
          {t("detailsSinceBaseline", {
            year: city.baselineYear,
            change: `${change > 0 ? "+" : ""}${i18n.percent(change)}`,
          })}
        </p>
      )}
      <h3 className={styles.subheading}>{t("detailsBySector")}</h3>
      <ul className={styles.bars} aria-label={t("detailsBySector")}>
        {rows.map((row) => (
          <li key={row.sector}>
            <span className={styles.barLabel}>{t(`sector_${row.sector}`)}</span>
            <span className={styles.barValue}>{mwh(row.electricityMwh)}</span>
            <span className={styles.barTrack} aria-hidden="true">
              <span
                className={styles.barFill}
                style={{ width: `${(100 * row.electricityMwh) / largest}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.muted}>{t("detailsCityNote")}</p>
    </>
  );
}

export function DetailsPanel({
  id,
  selection,
  onClose,
  photo = null,
  around = null,
  mix = null,
  notFound = false,
}: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  // Folded down to its title, the card gives the map back (on a phone it covers half of it). Kept per
  // object: choosing another one opens the card again.
  const [foldedFor, setFoldedFor] = useState<string | null>(null);
  const folded = foldedFor === id;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Escape inside a text field belongs to that field (e.g. closing the search list)
      if (event.key !== "Escape" || event.target instanceof HTMLInputElement) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keyboard and screen reader users land on the card that just opened, and go back where they were when it
  // closes (Faza 56, 4.4b). A new object moves the focus again but keeps the place to go back to.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const before = document.activeElement;
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    };
  }, [id]);

  const kv = (values: number[]): string =>
    values.length > 0 ? `${values.map((v) => i18n.number(v, 1)).join(" / ")} ${t("unitKv")}` : t("unknown");
  const link = osmUrl(id);

  // until the map finds the object: loading, then (useMissingSelection) either its details or "not found"
  let title: string = notFound ? t("detailsNotFound") : t("detailsLoading");
  let body: ReactNode = (
    <p className={styles.muted}>{notFound ? t("detailsNotLoaded") : t("detailsLocating")}</p>
  );
  let Icon: typeof Cable | null = null;
  let kind: string | null = null;

  if (selection?.kind === "city") {
    Icon = ICONS.city;
    kind = t("kind_city");
    title = selection.name;
    body = <CityDetails city={selection} i18n={i18n} />;
  } else if (selection?.kind === "gas") {
    Icon = ICONS.gas;
    kind = t("kind_gas");
    title = i18n.country(selection.country);
    body = <GasDetails gas={selection} i18n={i18n} />;
  } else if (selection) {
    Icon = ICONS[selection.kind];
    kind = t(`kind_${selection.kind}`);
    const status = (
      <span className={styles.status} data-status={selection.status}>
        {t(`status_${selection.status}`)}
      </span>
    );
    if (selection.kind === "plant") {
      const note = expansionNote(selection, t);
      const name = selection.name ?? t("detailsUnnamed");
      title = note ? `${name} (${note})` : name;
      body = (
        <dl className={styles.rows}>
          <Row label={t("detailsStatus")}>
            {status}
            {note && <span className={styles.aside}>{t("expansionAbout")}</span>}
          </Row>
          <Row label={t("detailsTechnology")}>{i18n.technology(selection.technology)}</Row>
          <Row label={t("detailsCapacity")}>
            {selection.capacityMw !== null ? i18n.power(selection.capacityMw) : t("unknown")}
          </Row>
          {selection.commissioningYear !== null && (
            <Row label={t("detailsCommissioned")}>{selection.commissioningYear}</Row>
          )}
          <Row label={t("detailsOperator")}>{selection.operator ?? t("unknown")}</Row>
          <Row label={t("detailsCountry")}>{i18n.country(selection.country)}</Row>
          {around && (
            <Row label={t("detailsAround")}>
              {t("detailsAroundValue", {
                distance: `${i18n.number(around.metres, 0)} m`,
                lines: around.lines.length,
              })}
              <span className={styles.aside}>{t("detailsAroundNote")}</span>
            </Row>
          )}
        </dl>
      );
    } else if (selection.kind === "charger") {
      title = selection.name ?? t("kind_charger");
      body = (
        <dl className={styles.rows}>
          <Row label={t("detailsStatus")}>{status}</Row>
          {selection.points !== null && <Row label={t("detailsPoints")}>{selection.points}</Row>}
          {selection.maxKw !== null && (
            <Row label={t("detailsMaxKw")}>
              {t("detailsMaxKwValue", { kw: i18n.number(selection.maxKw, 1) })}
            </Row>
          )}
          <Row label={t("detailsOperator")}>{selection.operator ?? t("unknown")}</Row>
          <Row label={t("detailsCountry")}>{i18n.country(selection.country)}</Row>
          {mix && mix.parts.length > 0 && (
            <Row label={t("chargerMix")}>
              {[
                ...mix.parts
                  .slice(0, MIX_NAMED)
                  .map((part) => `${i18n.technology(part.technology)} ${percent(part.share)} %`),
                ...(mix.parts.length > MIX_NAMED
                  ? [
                      `${t("chargerMixRest")} ${percent(
                        mix.parts.slice(MIX_NAMED).reduce((sum, part) => sum + part.share, 0),
                      )} %`,
                    ]
                  : []),
              ].join(", ")}
              <span className={styles.aside}>
                {t("chargerMixNote", {
                  country: i18n.country(selection.country),
                  share: percent(mix.green.share),
                  hour: new Intl.DateTimeFormat(i18n.locale, { hour: "2-digit", minute: "2-digit" }).format(
                    new Date(mix.green.hour),
                  ),
                })}
              </span>
            </Row>
          )}
        </dl>
      );
    } else if (selection.kind === "extraction") {
      title = selection.name ?? t(`extraction_${selection.extractionKind}`);
      body = (
        <>
          <dl className={styles.rows}>
            <Row label={t("detailsTechnology")}>{t(`extraction_${selection.extractionKind}`)}</Row>
            <Row label={t("detailsSubstance")}>{t(`substance_${selection.substance}`)}</Row>
            <Row label={t("detailsStatus")}>{status}</Row>
            <Row label={t("detailsOperator")}>{selection.operator ?? t("unknown")}</Row>
            <Row label={t("detailsCountry")}>{i18n.country(selection.country)}</Row>
          </dl>
          <p className={styles.muted}>{t("detailsExtractionNote")}</p>
        </>
      );
    } else if (selection.kind === "datacenter") {
      title = selection.name ?? t("detailsUnnamed");
      body = (
        <dl className={styles.rows}>
          <Row label={t("detailsStatus")}>{status}</Row>
          <Row label={t("detailsPower")}>
            {selection.powerMw !== null ? i18n.power(selection.powerMw) : t("detailsPowerUnpublished")}
          </Row>
          {selection.commissioningYear !== null && (
            <Row label={t("detailsCommissioned")}>{selection.commissioningYear}</Row>
          )}
          <Row label={t("detailsOperator")}>{selection.operator ?? t("unknown")}</Row>
          <Row label={t("detailsCountry")}>{i18n.country(selection.country)}</Row>
        </dl>
      );
    } else if (selection.kind === "pipeline") {
      title = selection.name ?? t("detailsUnnamed");
      body = (
        <dl className={styles.rows}>
          <Row label={t("detailsStatus")}>{status}</Row>
          <Row label={t("detailsMedium")}>{t(`medium_${selection.medium}`)}</Row>
          {selection.diameterIn !== null && (
            <Row
              label={t("detailsDiameter")}
            >{`${i18n.number(selection.diameterIn * MM_PER_INCH, 0)} ${t("unitMm")} (${i18n.number(selection.diameterIn, 1)} ${t("unitInch")})`}</Row>
          )}
          {selection.lengthKm !== null && <Row label={t("detailsLength")}>{i18n.km(selection.lengthKm)}</Row>}
          {selection.commissioningYear !== null && (
            <Row label={t("detailsCommissioned")}>{selection.commissioningYear}</Row>
          )}
          <Row label={t("detailsOperator")}>{selection.operator ?? t("unknown")}</Row>
          <Row label={t("detailsCountries")}>
            {selection.countries.map((code) => i18n.country(code)).join(", ")}
          </Row>
        </dl>
      );
    } else if (selection.kind === "substation") {
      title = selection.name ?? t("detailsUnnamed");
      body = (
        <dl className={styles.rows}>
          <Row label={t("detailsStatus")}>{status}</Row>
          <Row label={t("detailsVoltage")}>{kv(selection.voltagesKv)}</Row>
          <Row label={t("detailsOperator")}>{selection.operator ?? t("unknown")}</Row>
          <Row label={t("detailsCountry")}>{i18n.country(selection.country)}</Row>
        </dl>
      );
    } else {
      title = selection.maxVoltageKv !== null ? `${kind}, ${kv([selection.maxVoltageKv])}` : kind;
      body = (
        <>
          {(selection.isInterconnector || selection.isHvdc) && (
            <p className={styles.badges}>
              {selection.isInterconnector && (
                <span className={styles.badge}>{t("detailsInterconnector")}</span>
              )}
              {selection.isHvdc && <span className={styles.badge}>{t("detailsHvdc")}</span>}
            </p>
          )}
          <dl className={styles.rows}>
            <Row label={t("detailsStatus")}>{status}</Row>
            <Row label={t("detailsVoltage")}>{kv(selection.voltagesKv)}</Row>
            {selection.circuits !== null && <Row label={t("detailsCircuits")}>{selection.circuits}</Row>}
            <Row label={t("detailsOperator")}>{selection.operator ?? t("unknown")}</Row>
            <Row label={t("detailsCountries")}>
              {selection.countries.map((code) => i18n.country(code)).join(", ")}
            </Row>
          </dl>
        </>
      );
    }
  }

  return (
    <div className={styles.panel} {...(folded ? { "data-folded": "" } : {})}>
      <div className={styles.head}>
        {Icon && (
          <span className={styles.icon} aria-hidden="true">
            <Icon size={18} strokeWidth={1.75} />
          </span>
        )}
        <div className={styles.titles}>
          {kind && <p className={styles.kind}>{kind}</p>}
          <h2 ref={headingRef} tabIndex={-1} aria-live="polite">
            {title}
          </h2>
        </div>
        <button
          type="button"
          className={styles.close}
          aria-expanded={!folded}
          aria-label={t(folded ? "cardUnfold" : "cardFold")}
          onClick={() => {
            setFoldedFor(folded ? null : id);
          }}
        >
          {folded ? <ChevronUp size={18} strokeWidth={1.75} /> : <ChevronDown size={18} strokeWidth={1.75} />}
        </button>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t("detailsClose")}>
          <X size={18} strokeWidth={1.75} />
        </button>
      </div>
      {photo && (
        <figure className={styles.photo}>
          {/* the copy is in our bucket: showing it does not send the reader's browser to Wikimedia */}
          <img
            src={photo.url}
            alt=""
            width={photo.width}
            height={photo.height}
            loading="lazy"
            decoding="async"
          />
          <figcaption>
            {t("photoCredit", { author: photo.author || t("unknown") })}{" "}
            {photo.licenseUrl ? (
              <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">
                {photo.license}
              </a>
            ) : (
              photo.license
            )}
            {" · "}
            <a href={photo.page} target="_blank" rel="noopener noreferrer">
              Wikimedia Commons
            </a>
          </figcaption>
        </figure>
      )}
      {body}
      <p className={styles.source}>
        {selection && t("detailsSource", { sources: i18n.sources(selection.sources) })}
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer">
            {t("detailsEditOsm")}
            <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
          </a>
        )}
        {selection?.kind === "datacenter" && selection.sourceUrl && (
          <a href={selection.sourceUrl} target="_blank" rel="noopener noreferrer">
            {t("detailsPublishedSource")}
            <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
          </a>
        )}
        {selection?.kind === "gas" && (
          <a href={ENTSOG_URL} target="_blank" rel="noopener noreferrer">
            {t("detailsPublishedSource")}
            <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
          </a>
        )}
        {selection?.kind !== "city" && selection?.kind !== "gas" && selection?.gemUrl && (
          <a href={selection.gemUrl} target="_blank" rel="noopener noreferrer">
            {t("detailsGem")}
            <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
          </a>
        )}
      </p>
    </div>
  );
}
