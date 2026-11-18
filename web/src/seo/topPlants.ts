/**
 * "The ten largest power plants in Croatia" for the learning corner (Faza 41-5): the plants in operation
 * with the largest recorded capacity, with the largest solar and wind plant beside them for scale.
 *
 * The list goes by installed capacity because that is what the sources record for every plant; what a
 * single plant generated is not in this site's data, so it is neither shown nor estimated. A plant counts
 * as in operation only when its record says so; without the records there is no list.
 */
import { toHit, type SearchHit } from "../data/search";
import type { Technology } from "../domain";
import { createI18n } from "../i18n";
import type { Lang } from "../state/url";
import { pageWorthy } from "./assetPages";
import { e, linkedTable, list } from "./markup";
import { assetSlug, mapLink, PATHS, type Section, type SiteData } from "./site";

export const TOP_PLANTS = 10;
const COUNTRY = "HR";

type Plant = Extract<SearchHit, { kind: "plant" }> & { capacityMw: number };

interface Copy {
  heading: string;
  intro: (count: string, total: string) => string;
  columns: [string, string, string, string];
  unknownYear: string;
  /** what stands before the plant's name: "Najveća sunčana elektrana u pogonu" */
  scale: (kind: string) => string;
  ratio: (largest: string, times: string, kind: string) => string;
  note: string;
  map: string;
  region: string;
}

const COPY: Record<Lang, Copy> = {
  hr: {
    heading: "Deset najvećih elektrana u Hrvatskoj",
    intro: (count, total) =>
      `${count} elektrana u pogonu s najvećom zabilježenom snagom; zajedno imaju ${total}.`,
    columns: ["Elektrana", "Vrsta", "Snaga", "U pogonu od"],
    unknownYear: "—",
    scale: (kind) => `Najveća ${kind} u pogonu`,
    ratio: (largest, times, kind) =>
      `Najveća elektrana na popisu (${largest}) ima ${times} puta veću snagu od najveće ${kind}.`,
    note: "Popis ide po instaliranoj snazi, jer je ona zabilježena za svaku elektranu. Snaga nije proizvodnja: koliko je pojedina elektrana proizvela struje ova stranica nema, pa to ne prikazuje i ne procjenjuje.",
    map: "Elektrane u Hrvatskoj na karti",
    region: "Sto najvećih elektrana u regiji",
  },
  en: {
    heading: "The ten largest power plants in Croatia",
    intro: (count, total) =>
      `The ${count} plants in operation with the largest recorded capacity; together they have ${total}.`,
    columns: ["Plant", "Type", "Capacity", "In operation since"],
    unknownYear: "—",
    scale: (kind) => `The largest ${kind} in operation`,
    ratio: (largest, times, kind) =>
      `The largest plant on the list (${largest}) has ${times} times the capacity of the largest ${kind}.`,
    note: "The list goes by installed capacity, which is recorded for every plant. Capacity is not generation: this site does not have what a single plant generated, so it neither shows nor estimates it.",
    map: "Power plants in Croatia on the map",
    region: "The hundred largest plants of the region",
  },
};

/** How the two technologies are named inside a sentence. */
const KINDS: Record<Lang, Record<"solar" | "wind", { subject: string; genitive: string }>> = {
  hr: {
    solar: { subject: "sunčana elektrana", genitive: "sunčane elektrane" },
    wind: { subject: "vjetroelektrana", genitive: "vjetroelektrane" },
  },
  en: {
    solar: { subject: "solar plant", genitive: "solar plant" },
    wind: { subject: "wind farm", genitive: "wind farm" },
  },
};

/** Croatia's plants in operation with a recorded capacity, largest first; ties by name. */
export function operatingPlants(site: SiteData): Plant[] {
  const records = site.records;
  if (!records) return [];
  return site.index.rows
    .map(toHit)
    .filter(
      (hit): hit is Plant =>
        hit.kind === "plant" &&
        hit.country === COUNTRY &&
        hit.capacityMw !== null &&
        hit.capacityMw > 0 &&
        records.get(hit.id)?.status === "operating",
    )
    .sort((a, b) => b.capacityMw - a.capacityMw || a.name.localeCompare(b.name, "hr"));
}

const nameCell = (hit: Plant, lang: Lang): string =>
  pageWorthy(hit) ? `<a href="${PATHS[lang].asset(assetSlug(hit.id))}">${e(hit.name)}</a>` : e(hit.name);

/** The section, or null when the release has no plant in operation to list. */
export function topPlantsSection(site: SiteData, lang: Lang): Section | null {
  const plants = operatingPlants(site);
  const top = plants.slice(0, TOP_PLANTS);
  const [largest] = top;
  if (!largest) return null;
  const copy = COPY[lang];
  const i18n = createI18n(lang);
  const rows = top.map((hit): [string, ...string[]] => [
    nameCell(hit, lang),
    i18n.technology(hit.technology),
    i18n.power(hit.capacityMw),
    String(site.records?.get(hit.id)?.commissioningYear ?? copy.unknownYear),
  ]);
  const total = top.reduce((sum, hit) => sum + hit.capacityMw, 0);
  const scale: string[] = [];
  for (const technology of ["solar", "wind"] satisfies Technology[]) {
    const first = plants.find((hit) => hit.technology === technology);
    if (!first) continue;
    const kind = KINDS[lang][technology];
    let line = `${e(copy.scale(kind.subject))}: ${nameCell(first, lang)}, ${e(i18n.power(first.capacityMw))}.`;
    // a comparison only where it says something: the largest plant is of another kind and clearly larger
    if (first.id !== largest.id && largest.capacityMw / first.capacityMw >= 1.5) {
      const times = i18n.number(largest.capacityMw / first.capacityMw, 1);
      line += ` ${e(copy.ratio(largest.name, times, kind.genitive))}`;
    }
    scale.push(line);
  }
  return {
    heading: copy.heading,
    html: [
      `<p>${e(copy.intro(i18n.number(top.length), i18n.power(total)))}</p>`,
      linkedTable(copy.columns, rows),
      scale.length > 0 ? list(scale) : "",
      `<p>${e(copy.note)}</p>`,
      list([
        `<a href="${e(mapLink(lang, { c: COUNTRY, l: "plants" }))}">${e(copy.map)}</a>`,
        `<a href="${PATHS[lang].largest}">${e(copy.region)}</a>`,
      ]),
    ].join(""),
  };
}
