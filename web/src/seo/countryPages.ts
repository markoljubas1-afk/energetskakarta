/**
 * Country pages, their topic hubs and the largest plants (Faza 26 split from pages.ts).
 */
import { type SearchHit, toHit } from "../data/search";
import { summarize } from "../data/stats";
import { type CountryCode, SCOPE_COUNTRIES } from "../domain";
import { createI18n, type I18n } from "../i18n";
import type { Lang } from "../state/url";
import { hubKeyOf, pageWorthy } from "./assetPages";
import { COPY, type HubKey } from "./copy";
import { counted, definitions, e, type Forms, linkedTable, list, table } from "./markup";
import {
  CHART_COPY,
  keyFigures,
  mixBar,
  rankBars,
  sourceBars,
  splitUnit,
  tableBehind,
  type KeyFigure,
} from "./charts";
import { API_PATHS } from "./paths";
import {
  absolute,
  assetSlug,
  home,
  HUB_KEYS,
  HUB_ROWS,
  LARGEST_ROWS,
  mapLink,
  other,
  PATHS,
  publisher,
  type SiteData,
  type StaticPage,
} from "./site";
import { solarCapitaSentence, transitionLinks } from "./transition";
import { gasLinks } from "./gasPages";
import { energyLinks } from "./energyPages";
import { DATASET_LICENSE } from "./license";

const COUNTRY_FIGURES = {
  hr: {
    operating: "Snaga u pogonu",
    lines: "Dalekovodi u pogonu",
    plants: "Elektrane u pogonu",
    substations: "Trafostanice",
    floor: "zbroj upisanog u izvorima",
    planned: "u izgradnji i planirano",
    plantForms: ["elektrana", "elektrane", "elektrana"] as Forms,
  },
  en: {
    operating: "Operating capacity",
    lines: "Lines in operation",
    plants: "Plants in operation",
    substations: "Substations",
    floor: "the sum of what the sources list",
    planned: "under construction and planned",
    plantForms: ["plant", "plants", "plants"] as Forms,
  },
} as const;

export function countryPage(site: SiteData, lang: Lang, code: CountryCode, hubs: CountryHubs): StaticPage {
  const copy = COPY[lang];
  const i18n = createI18n(lang);
  const name = i18n.country(code);
  const summary = summarize(site.stats, code, SCOPE_COUNTRIES);
  // the sentence pairs the count with the operating capacity, so it counts operating plants only (Faza 31)
  const plantCount = summary.technologies.reduce((sum, row) => sum + row.operatingPlants, 0);
  const plants = i18n.number(plantCount);
  const totalKm = summary.lineKm.reduce((sum, row) => sum + row.km, 0);
  const operating = i18n.power(summary.operatingMw);
  const labels = copy.labels;
  const path = PATHS[lang].country(code.toLowerCase());
  const words = COUNTRY_FIGURES[lang];
  const chartWords = CHART_COPY[lang];
  // Faza 54-3: the page's own figures as tiles, the tables as charts with the tables behind a click
  const [operatingValue, operatingUnit] = splitUnit(operating);
  const [kmValue, kmUnit] = splitUnit(i18n.km(totalKm));
  const figures = keyFigures(
    [
      { label: words.operating, value: operatingValue, unit: operatingUnit, note: words.floor },
      { label: words.lines, value: kmValue, unit: kmUnit },
      { label: words.plants, value: plants, unit: "" },
      { label: words.substations, value: i18n.number(summary.substations), unit: "" },
    ],
    chartWords.figures,
  );
  const techRows = summary.technologies.filter((row) => row.operatingMw > 0 || row.pipelineMw > 0);
  const capacityChart =
    summary.operatingMw > 0
      ? mixBar(techRows.map((row) => ({ tech: row.technology, value: row.operatingMw }))) +
        sourceBars(
          techRows.map((row) => ({
            tech: row.technology,
            name: i18n.technology(row.technology),
            amount:
              row.operatingMw === 0 && row.operatingPlants > 0
                ? labels.notStated
                : i18n.power(row.operatingMw),
            share: row.operatingMw > 0 ? i18n.percent(row.operatingMw / summary.operatingMw) : "",
            value: row.operatingMw,
            before: row.pipelineMw,
            change: counted(lang, row.plants, words.plantForms),
          })),
          { now: labels.operating, before: words.planned },
        )
      : "";
  // a chart with its table behind a click, or the table alone when there is nothing to draw
  const behind = (chart: string, tableHtml: string): string =>
    chart ? chart + tableBehind(chartWords.table, tableHtml) : tableHtml;
  const linesChart =
    totalKm > 0
      ? rankBars(
          summary.lineKm.map((row) => ({
            name: e(i18n.voltage(row.voltage)),
            value: row.km / totalKm,
            text: i18n.km(row.km),
            detail: i18n.percent(row.km / totalKm),
          })),
        )
      : "";
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].country(code.toLowerCase()),
    title: copy.country.title(name),
    description: copy.country.description(name, operating),
    heading: copy.country.heading(name),
    lead:
      `<p>${e(copy.country.intro(name, operating, plants, i18n.km(totalKm)))}</p>` +
      solarCapitaSentence(site, lang, code),
    figures,
    sections: [
      {
        heading: copy.country.capacityHeading,
        // a country the stats do not cover yet: a sentence, not a table of headers alone (Faza 58-A)
        html:
          summary.technologies.length === 0
            ? `<p>${e(copy.country.noPlants)}</p>`
            : behind(
                capacityChart,
                table(
                  [labels.technology, labels.operating, labels.pipeline, labels.plants],
                  summary.technologies.map((row) => [
                    i18n.technology(row.technology),
                    // plants are there but none has a figure in the sources: "0 MW" would read as "no wind power"
                    row.operatingMw === 0 && row.operatingPlants > 0
                      ? labels.notStated
                      : i18n.power(row.operatingMw),
                    i18n.power(row.pipelineMw),
                    i18n.number(row.plants),
                  ]),
                ),
              ),
      },
      {
        heading: copy.country.linesHeading,
        html:
          (summary.lineKm.length === 0
            ? `<p>${e(copy.country.noLines)}</p>`
            : behind(
                linesChart,
                table(
                  [labels.voltage, labels.km],
                  summary.lineKm.map((row) => [i18n.voltage(row.voltage), i18n.km(row.km)]),
                ),
              )) +
          definitions([
            [labels.substations, e(i18n.number(summary.substations))],
            [labels.datacenters, e(i18n.number(summary.datacenters.count))],
          ]),
      },
      {
        heading: copy.nav.map,
        html: `<p><a href="${e(mapLink(lang, { c: code }))}">${e(copy.country.openMap)}</a></p>`,
      },
      ...([
        ...energyLinks(site, lang, code),
        ...(code === "HR" ? [...transitionLinks(site, lang), ...gasLinks(site, lang)] : []),
      ].length > 0
        ? [
            {
              heading: copy.country.energyHeading,
              html: list([
                ...energyLinks(site, lang, code),
                ...(code === "HR" ? [...transitionLinks(site, lang), ...gasLinks(site, lang)] : []),
              ]),
            },
          ]
        : []),
      ...(hubs.size > 0
        ? [
            {
              heading: copy.hub.sectionHeading,
              html: list(
                [...hubs].map(
                  ([key, hits]) =>
                    `<a href="${PATHS[lang].hub(code.toLowerCase(), key)}">${e(copy.hub.plural[key])}</a> (${e(i18n.number(hits.length))})`,
                ),
              ),
            },
          ]
        : []),
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: copy.country.title(name),
        description: copy.country.description(name, operating),
        inLanguage: lang,
        ...DATASET_LICENSE,
        isAccessibleForFree: true,
        dateModified: site.current.createdAt,
        creator: publisher(site, i18n),
        spatialCoverage: { "@type": "Place", name },
        distribution: [
          {
            "@type": "DataDownload",
            encodingFormat: "application/json",
            contentUrl:
              absolute(site, API_PATHS.country(code.toLowerCase())) ?? API_PATHS.country(code.toLowerCase()),
          },
        ],
        ...(absolute(site, path) ? { url: absolute(site, path) } : {}),
      },
    ],
    lastModified: site.current.createdAt,
    breadcrumbs: [home(lang)],
    apiPath: API_PATHS.country(code.toLowerCase()),
  };
}

// ---------------------------------------------------------------- topic pages

type CountryHubs = Map<HubKey, SearchHit[]>;

/** Every asset of the search index grouped by country and topic, in HUB_KEYS order; empty topics left out. */
export function groupHubs(site: SiteData): Map<CountryCode, CountryHubs> {
  const grouped = new Map<CountryCode, Map<HubKey, SearchHit[]>>();
  for (const hit of site.index.rows.map(toHit)) {
    const key = hubKeyOf(hit);
    if (!key || !hit.country) continue;
    const byKey = grouped.get(hit.country) ?? new Map<HubKey, SearchHit[]>();
    grouped.set(hit.country, byKey);
    byKey.set(key, [...(byKey.get(key) ?? []), hit]);
  }
  const ordered = new Map<CountryCode, CountryHubs>();
  for (const code of SCOPE_COUNTRIES) {
    const byKey = grouped.get(code);
    if (!byKey) continue;
    const sorted: CountryHubs = new Map();
    for (const key of HUB_KEYS) {
      const hits = byKey.get(key);
      if (hits && hits.length > 0) sorted.set(key, [...hits].sort(byWeight));
    }
    ordered.set(code, sorted);
  }
  return ordered;
}

/** Largest first: capacity for plants and data centres, voltage for substations; then by name. */
function weight(hit: SearchHit): number {
  if (hit.kind === "plant") return hit.capacityMw ?? -1;
  if (hit.kind === "substation") return hit.maxVoltageKv ?? -1;
  if (hit.kind === "datacenter") return hit.powerMw ?? -1;
  return -1;
}

function byWeight(a: SearchHit, b: SearchHit): number {
  return weight(b) - weight(a) || a.name.localeCompare(b.name, "hr");
}

/** A name cell: linked to the asset's own page when it has one, plain text otherwise. */
function nameCell(hit: SearchHit, lang: Lang): string {
  return pageWorthy(hit)
    ? `<a href="${PATHS[lang].asset(assetSlug(hit.id))}">${e(hit.name)}</a>`
    : e(hit.name);
}

function hubRows(
  hits: SearchHit[],
  key: HubKey,
  lang: Lang,
  i18n: I18n,
): { head: string[]; rows: [string, ...string[]][] } {
  const c = COPY[lang].hub.columns;
  const kv = (value: number | null): string =>
    value === null ? "" : `${i18n.number(value)} ${i18n.t("unitKv")}`;
  const power = (value: number | null): string => (value === null ? "" : i18n.power(value));
  if (key === "substations")
    return {
      head: [c.name, c.voltage],
      rows: hits.map((hit) => [nameCell(hit, lang), hit.kind === "substation" ? kv(hit.maxVoltageKv) : ""]),
    };
  if (key === "extraction")
    return {
      head: [c.name, c.kind, c.substance],
      rows: hits.map((hit) =>
        hit.kind === "extraction"
          ? [
              nameCell(hit, lang),
              i18n.t(`extraction_${hit.extractionKind}`),
              i18n.t(`substance_${hit.substance}`),
            ]
          : [nameCell(hit, lang), "", ""],
      ),
    };
  return {
    head: [c.name, c.capacity],
    rows: hits.map((hit) => [
      nameCell(hit, lang),
      hit.kind === "plant" ? power(hit.capacityMw) : hit.kind === "datacenter" ? power(hit.powerMw) : "",
    ]),
  };
}

/** How many a power is shown for: the ten largest, as bars against the largest of all (D4). */
const RANKED = 10;

/** A topic page's power: a plant's capacity, a data centre's power; nothing for the rest. */
function powerOf(hit: SearchHit): number | null {
  return hit.kind === "plant" ? hit.capacityMw : hit.kind === "datacenter" ? hit.powerMw : null;
}

/**
 * The top of a topic page (D4): the count, and where there is power to add up, the total and the largest as
 * tiles, and the ten largest as bars over the full list.
 */
function hubFigures(
  hits: readonly SearchHit[],
  lang: Lang,
  i18n: I18n,
): { figures: string; ranking: string } {
  const words = COPY[lang].hub.figures;
  const withPower = hits
    .map((hit) => ({ hit, mw: powerOf(hit) ?? 0 }))
    .filter((row) => row.mw > 0)
    .sort((a, b) => b.mw - a.mw);
  const total = withPower.reduce((sum, row) => sum + row.mw, 0);
  const [largest] = withPower;
  const tiles: KeyFigure[] = [{ label: words.count, value: i18n.number(hits.length), unit: "" }];
  if (largest) {
    const [value, unit] = splitUnit(i18n.power(total));
    tiles.push({ label: words.total, value, unit });
    const [big, bigUnit] = splitUnit(i18n.power(largest.mw));
    tiles.push({ label: words.largest, value: big, unit: bigUnit, note: largest.hit.name });
  }
  const ranked = withPower.slice(0, RANKED);
  const ranking =
    largest && ranked.length >= 2
      ? rankBars(
          ranked.map((row) => ({
            name: nameCell(row.hit, lang),
            value: row.mw / largest.mw,
            text: i18n.power(row.mw),
            detail: "",
          })),
        )
      : "";
  return { figures: keyFigures(tiles, CHART_COPY[lang].figures), ranking };
}

export function hubPage(
  site: SiteData,
  lang: Lang,
  code: CountryCode,
  key: HubKey,
  hits: SearchHit[],
): StaticPage {
  const copy = COPY[lang];
  const i18n = createI18n(lang);
  const country = i18n.country(code);
  const plural = copy.hub.plural[key];
  const where = copy.hub.inCountry[code];
  const isPlants = key !== "substations" && key !== "datacenters" && key !== "extraction";
  const totalMw = isPlants
    ? hits.reduce((sum, hit) => sum + (hit.kind === "plant" ? (hit.capacityMw ?? 0) : 0), 0)
    : null;
  const total = totalMw !== null && totalMw > 0 ? i18n.power(totalMw) : null;
  const count = i18n.number(hits.length);
  const shown = hits.slice(0, HUB_ROWS);
  const { head, rows } = hubRows(shown, key, lang, i18n);
  const { figures, ranking } = hubFigures(hits, lang, i18n);
  const path = PATHS[lang].hub(code.toLowerCase(), key);
  const title = copy.hub.title(plural, where);
  const description = copy.hub.description(plural, where, count, total);
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].hub(code.toLowerCase(), key),
    title,
    description,
    heading: `${plural} ${where}`,
    lead: `<p>${e(copy.hub.lead(count, total))}</p>`,
    figures,
    sections: [
      {
        heading: plural,
        html:
          ranking +
          linkedTable(head, rows) +
          (hits.length > shown.length
            ? `<p>${e(copy.hub.truncated(i18n.number(shown.length), count))}</p>`
            : ""),
      },
      {
        heading: copy.nav.map,
        html: list([
          `<a href="${e(mapLink(lang, { c: code }))}">${e(copy.country.openMap)}</a>`,
          `<a href="${PATHS[lang].country(code.toLowerCase())}">${e(copy.asset.countryOverview)}: ${e(country)}</a>`,
        ]),
      },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: title,
        description,
        numberOfItems: hits.length,
        itemListOrder: "https://schema.org/ItemListOrderDescending",
        itemListElement: shown.slice(0, 100).map((hit, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: hit.name,
          ...(pageWorthy(hit) && absolute(site, PATHS[lang].asset(assetSlug(hit.id)))
            ? { url: absolute(site, PATHS[lang].asset(assetSlug(hit.id))) }
            : {}),
        })),
      },
    ],
    lastModified: site.current.createdAt,
    breadcrumbs: [home(lang), { name: country, path: PATHS[lang].country(code.toLowerCase()) }],
  };
}

export function largestPage(site: SiteData, lang: Lang): StaticPage {
  const copy = COPY[lang];
  const i18n = createI18n(lang);
  const plants = site.index.rows
    .map(toHit)
    .filter((hit) => hit.kind === "plant" && hit.capacityMw !== null && hit.country !== null)
    .sort(byWeight)
    .slice(0, LARGEST_ROWS);
  const c = copy.hub.columns;
  const rows = plants.map((hit): [string, ...string[]] => [
    nameCell(hit, lang),
    hit.kind === "plant" ? i18n.technology(hit.technology) : "",
    hit.kind === "plant" && hit.capacityMw !== null ? i18n.power(hit.capacityMw) : "",
    hit.country ? i18n.country(hit.country) : "",
  ]);
  const path = PATHS[lang].largest;
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].largest,
    title: copy.largest.title,
    description: copy.largest.description,
    heading: copy.largest.heading,
    lead: `<p>${e(copy.largest.lead(i18n.number(plants.length)))}</p>`,
    sections: [
      {
        heading: copy.largest.heading,
        html: linkedTable([c.name, copy.labels.technology, c.capacity, c.country], rows),
      },
      {
        heading: copy.nav.countries,
        html: list(
          SCOPE_COUNTRIES.map(
            (code) => `<a href="${PATHS[lang].country(code.toLowerCase())}">${e(i18n.country(code))}</a>`,
          ),
        ),
      },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: copy.largest.title,
        description: copy.largest.description,
        numberOfItems: plants.length,
        itemListOrder: "https://schema.org/ItemListOrderDescending",
        itemListElement: plants.map((hit, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: hit.name,
          ...(absolute(site, PATHS[lang].asset(assetSlug(hit.id)))
            ? { url: absolute(site, PATHS[lang].asset(assetSlug(hit.id))) }
            : {}),
        })),
      },
    ],
    lastModified: site.current.createdAt,
    breadcrumbs: [home(lang)],
  };
}
