/**
 * What makes an asset page worth reading beyond its name (Faza 17-11): status, operator, year, voltages and
 * sources from the complete record; its rank among the country's plants of the same technology and its share
 * of the country's operating capacity (a sentence assistants can cite); the nearest assets with a page; and
 * links to Wikidata and Wikipedia. Pure: the context is computed once per release.
 */
import { distanceM } from "../data/geo";
import type { SearchHit } from "../data/search";
import { summarize } from "../data/stats";
import { DATA_SOURCES, isOneOf, SCOPE_COUNTRIES, type CountryCode, type Technology } from "../domain";
import { createI18n } from "../i18n";
import type { Lang } from "../state/url";
import { COPY } from "./copy";
import { assetSlug, PATHS, type SiteData } from "./site";
import { escapeHtml as e } from "./markup";
import { wikidataUrl, wikipediaUrl, type AssetRecord } from "./records";

/** Nearest assets listed on a page, and how far away they may be. */
export const NEARBY = 5;
export const NEARBY_MAX_M = 50_000;
/** Ranks are worth a sentence up to here. */
export const RANK_LIMIT = 10;

export interface AssetContext {
  /** capacities (MW, largest first) of plants with a capacity, per country and technology */
  capacities: Map<string, number[]>;
  /** every asset that has a page, for the "nearby" list */
  paged: SearchHit[];
  records: ReadonlyMap<string, AssetRecord>;
  operatingMw: Map<CountryCode, number>;
  /** the full records are loaded, so rankings count operating plants only (Faza 31) */
  operatingOnly: boolean;
}

const rankKey = (country: CountryCode, technology: Technology): string => `${country}|${technology}`;

export function assetContext(site: SiteData, hits: SearchHit[], paged: SearchHit[]): AssetContext {
  const records = site.records ?? new Map<string, AssetRecord>();
  // with the records, a planned or closed plant is never ranked against the ones that run
  const operatingOnly = records.size > 0;
  const capacities = new Map<string, number[]>();
  for (const hit of hits) {
    if (hit.kind !== "plant" || hit.capacityMw === null || !hit.country) continue;
    if (operatingOnly && records.get(hit.id)?.status !== "operating") continue;
    const key = rankKey(hit.country, hit.technology);
    capacities.set(key, [...(capacities.get(key) ?? []), hit.capacityMw]);
  }
  for (const list of capacities.values()) list.sort((a, b) => b - a);
  const operatingMw = new Map<CountryCode, number>(
    SCOPE_COUNTRIES.map((code) => [code, summarize(site.stats, code, SCOPE_COUNTRIES).operatingMw]),
  );
  return { capacities, paged, records, operatingMw, operatingOnly };
}

/** 1 for the largest; ties share the better rank. */
export function rankOf(context: AssetContext, hit: SearchHit): { rank: number; of: number } | null {
  if (hit.kind !== "plant" || hit.capacityMw === null || !hit.country) return null;
  if (context.operatingOnly && context.records.get(hit.id)?.status !== "operating") return null;
  const list = context.capacities.get(rankKey(hit.country, hit.technology)) ?? [];
  const capacity = hit.capacityMw;
  return { rank: list.filter((value) => value > capacity).length + 1, of: list.length };
}

/** The nearest assets with a page of their own, nearest first, within NEARBY_MAX_M. */
export function nearby(context: AssetContext, hit: SearchHit): { hit: SearchHit; metres: number }[] {
  return context.paged
    .filter((other) => other.id !== hit.id)
    .map((other) => ({ hit: other, metres: distanceM(hit.lat, hit.lon, other.lat, other.lon) }))
    .filter((item) => item.metres <= NEARBY_MAX_M)
    .sort((a, b) => a.metres - b.metres || a.hit.name.localeCompare(b.hit.name, "hr"))
    .slice(0, NEARBY);
}

const ordinalEn = (n: number): string => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};

export interface AssetExtras {
  facts: [string, string][];
  /** citable sentences for the lead, already escaped */
  lead: string;
  links: string[];
  sameAs: string[];
  nearby: { heading: string; html: string } | null;
}

export function assetExtras(
  context: AssetContext,
  lang: Lang,
  hit: SearchHit,
  kindLabel: string,
): AssetExtras {
  const copy = COPY[lang];
  const labels = copy.asset.more;
  const i18n = createI18n(lang);
  const record = context.records.get(hit.id);
  const facts: [string, string][] = [];
  if (record?.status) facts.push([labels.status, e(i18n.t(`status_${record.status}`))]);
  if (record?.operator) facts.push([labels.operator, e(record.operator)]);
  if (record?.commissioningYear) facts.push([labels.year, String(record.commissioningYear)]);
  if (record && record.voltagesKv.length > 1)
    facts.push([
      labels.voltages,
      e(`${record.voltagesKv.map((kv) => i18n.number(kv)).join(" / ")} ${i18n.t("unitKv")}`),
    ]);
  if (record && record.sources.length > 0) {
    const sources = record.sources.map((s) => {
      const name = e(isOneOf(DATA_SOURCES, s.source) ? i18n.t(`source_${s.source}`) : s.source);
      return `${s.url ? `<a href="${e(s.url)}" rel="noopener">${name}</a>` : name} (${e(s.license)})`;
    });
    facts.push([labels.sources, [...new Set(sources)].join(", ")]);
  }

  const sentences: string[] = [];
  const rank = rankOf(context, hit);
  if (rank && rank.rank <= RANK_LIMIT && hit.kind === "plant" && hit.country) {
    const ordinal = lang === "hr" ? `${rank.rank}.` : ordinalEn(rank.rank);
    // Croatian agrees the adjective: "najveći baterijski spremnik", "najveća hidroelektrana"
    const masculine = hit.technology === "battery";
    sentences.push(
      labels.rank(
        rank.rank,
        ordinal,
        kindLabel,
        copy.hub.inCountry[hit.country],
        i18n.number(rank.of),
        masculine,
        context.operatingOnly,
      ),
    );
  }
  const operating = hit.country ? context.operatingMw.get(hit.country) : undefined;
  if (
    hit.kind === "plant" &&
    hit.capacityMw !== null &&
    record?.status === "operating" &&
    operating &&
    hit.country
  ) {
    const share = hit.capacityMw / operating;
    if (share >= 0.001 && share <= 1)
      sentences.push(labels.share(i18n.percent(share), copy.hub.inCountry[hit.country]));
  }

  const links: string[] = [];
  const sameAs: string[] = [];
  if (record?.wikidata) {
    const url = wikidataUrl(record.wikidata);
    links.push(`<a href="${e(url)}" rel="noopener">Wikidata: ${e(record.wikidata)}</a>`);
    sameAs.push(url);
  }
  if (record?.wikipedia) {
    const url = wikipediaUrl(record.wikipedia);
    if (url) {
      links.push(
        `<a href="${e(url)}" rel="noopener">Wikipedia (${e(record.wikipedia.split(":")[0] ?? "")})</a>`,
      );
      sameAs.push(url);
    }
  }

  const close = nearby(context, hit);
  const kind = (other: SearchHit): string => i18n.t(`kind_${other.kind}`).toLowerCase();
  return {
    facts,
    lead: sentences.map((sentence) => `<p>${e(sentence)}</p>`).join(""),
    links,
    sameAs,
    nearby:
      close.length > 0
        ? {
            heading: labels.nearby,
            html: `<ul>${close
              .map(
                ({ hit: other, metres }) =>
                  `<li><a href="${PATHS[lang].asset(assetSlug(other.id))}">${e(other.name)}</a> (${e(kind(other))}, ${e(i18n.number(metres / 1000, 1))} km)</li>`,
              )
              .join("")}</ul>`,
          }
        : null,
  };
}
