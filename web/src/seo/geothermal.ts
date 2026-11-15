/**
 * The geothermal page (Faza 21-6): what runs today, what is being prepared, cities with confirmed potential,
 * how the heat-flow potential is made and how a heat cascade works, all from `geothermal/current.json`.
 * No data, no page.
 */
import { CASCADE, PHASES, totals, type Geothermal, type GeoSite, type Phase } from "../data/geothermal";
import { createI18n } from "../i18n";
import { LANGS, type Lang } from "../state/url";
import { homeCrumb, PATHS, publisher, type SiteData, type StaticPage } from "./site";
import { counted, escapeHtml as e, list, type Forms } from "./markup";

const other = (lang: Lang): Lang => (lang === "hr" ? "en" : "hr");

const COPY = {
  hr: {
    title: "Geotermalna energija u Hrvatskoj: elektrane, toplina i potencijal",
    description:
      "Što od geotermalne energije u Hrvatskoj radi danas, koji se projekti pripremaju, gdje je potvrđen potencijal za grijanje gradova i kako izgleda toplinski tok iz podzemlja, iz otvorenih izvora.",
    heading: "Geotermalna energija u Hrvatskoj",
    linkText: "Geotermalna energija: elektrane, toplina i potencijal",
    today: (mw: string, heat: string) => `U pogonu: ${mw} geotermalne struje i ${heat}.`,
    coming: (mw: string) => `U pripremi su elektrane od ukupno ${mw}.`,
    confirmed: (cities: string) => `Potencijal za grijanje potvrđen je u ${cities}.`,
    heatSites: [
      "lokacija koja koristi geotermalnu toplinu",
      "lokacije koje koriste geotermalnu toplinu",
      "lokacija koje koriste geotermalnu toplinu",
    ] as Forms,
    cities: ["gradu", "grada", "gradova"] as Forms,
    phase: {
      operating: "U pogonu",
      project: "Projekti",
      potential_confirmed: "Potvrđen potencijal za grijanje",
      exploration: "Istraživanje",
      local_project: "Lokalni projekti",
    } satisfies Record<Phase, string>,
    potentialHeading: "Potencijal: toplinski tok",
    potential: (points: string, radius: string) =>
      `Karta potencijala pokazuje toplinski tok iz podzemlja (mW/m²), izračunat na mreži od 0,1° iz ${points} mjerenja u regiji, samo unutar ${radius} km od mjerenja. Topliji je Panonski dio na sjeveru i istoku. Karta je orijentacijska i ne zamjenjuje istražne radove.`,
    cascadeHeading: "Kako se toplina koristi: kaskada",
    cascadeIntro:
      "Topla voda iz bušotine prolazi korisnike od najtoplijeg prema najhladnijem, a ohlađena se vraća u podzemlje:",
    steps: {
      well: "bušotina (dubina i temperatura ovise o lokaciji)",
      electricity: "proizvodnja struje",
      heating: "grijanje grada (toplinarstvo)",
      greenhouses: "staklenici",
      spa: "toplice i bazeni",
      return: "vraćanje ohlađene vode u podzemlje",
    },
    sourcesHeading: "Izvori",
    // a Croatian date already ends in a full stop ("15. studenoga 2026.")
    reviewed: (date: string) =>
      `Popis lokacija provjeren: ${date}${date.endsWith(".") ? "" : "."} Svaka lokacija ima vlastiti izvor.`,
    mapLink: "Otvori sloj na karti",
  },
  en: {
    title: "Geothermal energy in Croatia: power plants, heat and potential",
    description:
      "What geothermal energy in Croatia delivers today, which projects are being prepared, where potential for district heating is confirmed and what heat flow from below ground looks like, from open sources.",
    heading: "Geothermal energy in Croatia",
    linkText: "Geothermal energy: power plants, heat and potential",
    today: (mw: string, heat: string) => `In operation: ${mw} of geothermal electricity and ${heat}.`,
    coming: (mw: string) => `Power plants totalling ${mw} are being prepared.`,
    confirmed: (cities: string) => `Potential for district heating is confirmed in ${cities}.`,
    heatSites: [
      "site using geothermal heat",
      "sites using geothermal heat",
      "sites using geothermal heat",
    ] as Forms,
    cities: ["city", "cities", "cities"] as Forms,
    phase: {
      operating: "In operation",
      project: "Projects",
      potential_confirmed: "Potential for heating confirmed",
      exploration: "Exploration",
      local_project: "Local projects",
    } satisfies Record<Phase, string>,
    potentialHeading: "Potential: heat flow",
    potential: (points: string, radius: string) =>
      `The potential map shows heat flow from below ground (mW/m²) on a 0.1° grid from ${points} measurements in the region, only within ${radius} km of a measurement. The Pannonian north and east is warmer. The map is for orientation and no substitute for exploration.`,
    cascadeHeading: "How the heat is used: the cascade",
    cascadeIntro:
      "Hot water from the well passes its users from the hottest to the coolest, and the cooled water goes back into the ground:",
    steps: {
      well: "the well (depth and temperature depend on the site)",
      electricity: "electricity generation",
      heating: "district heating",
      greenhouses: "greenhouses",
      spa: "spas and pools",
      return: "the cooled water returns underground",
    },
    sourcesHeading: "Sources",
    reviewed: (date: string) => `Site list reviewed: ${date}. Every site has its own source.`,
    mapLink: "Open the layer on the map",
  },
};

export const hasGeothermal = (site: SiteData): boolean => (site.geothermal?.sites.length ?? 0) > 0;

export const geothermalLinks = (site: SiteData, lang: Lang): string[] =>
  hasGeothermal(site) ? [`<a href="${PATHS[lang].geothermal}">${e(COPY[lang].linkText)}</a>`] : [];

/** A source link labelled with its host ("tportal.hr"); the schema guarantees a URL. */
const sourceLink = (url: string): string =>
  `<a href="${e(url)}" rel="noopener">${e(new URL(url).hostname.replace(/^www\./, ""))}</a>`;

function siteLine(site: GeoSite, lang: Lang): string {
  const i18n = createI18n(lang);
  const parts = [site.place];
  if (site.electricMw) parts.push(`${i18n.number(site.electricMw, 1)} MW`);
  if (site.temperatureC) parts.push(`≈ ${site.temperatureC} °C`);
  const note = lang === "hr" ? site.noteHr : site.noteEn;
  const sources = site.sources.map(sourceLink).join(", ");
  return `<strong>${e(site.name)}</strong> (${e(parts.join(", "))})${note ? `: ${e(note)}` : ""} (${sources})`;
}

function page(site: SiteData, doc: Geothermal, lang: Lang): StaticPage {
  const copy = COPY[lang];
  const i18n = createI18n(lang);
  const sum = totals(doc);
  const mw = (value: number): string => `${i18n.number(value, 1)} MW`;
  const sections: StaticPage["sections"] = PHASES.flatMap((phase) => {
    const sites = doc.sites.filter((s) => s.status === phase);
    return sites.length > 0
      ? [{ heading: copy.phase[phase], html: list(sites.map((s) => siteLine(s, lang))) }]
      : [];
  });
  if (doc.heatFlow) {
    sections.push({
      heading: copy.potentialHeading,
      html: `<p>${e(copy.potential(i18n.number(doc.heatFlow.points), i18n.number(doc.heatFlow.radiusKm)))}</p>`,
    });
  }
  sections.push({
    heading: copy.cascadeHeading,
    html: `<p>${e(copy.cascadeIntro)}</p>${list(CASCADE.map((step) => e(step.range ? `${copy.steps[step.use]} (${step.range})` : copy.steps[step.use])))}`,
  });
  const sources = [...new Set(doc.sites.flatMap((s) => s.sources))];
  sections.push({
    heading: copy.sourcesHeading,
    html:
      list([
        ...(doc.heatFlow
          ? [
              `<a href="${e(doc.heatFlow.url)}" rel="noopener">${e(doc.heatFlow.source)}</a> (${e(doc.heatFlow.license)})`,
            ]
          : []),
        ...sources.map(sourceLink),
        `<a href="${lang === "hr" ? "/" : "/en/"}?l=lines,substations,plants,geothermal">${e(copy.mapLink)}</a>`,
      ]) + `<p>${e(copy.reviewed(i18n.date(doc.sitesReviewed)))}</p>`,
  });
  const lead = [
    copy.today(mw(sum.operatingMw), counted(lang, sum.heatSites, copy.heatSites)),
    ...(sum.plannedMw > 0 ? [copy.coming(mw(sum.plannedMw))] : []),
    ...(sum.confirmed > 0 ? [copy.confirmed(counted(lang, sum.confirmed, copy.cities))] : []),
  ]
    .map((sentence) => `<p>${e(sentence)}</p>`)
    .join("");
  const path = PATHS[lang].geothermal;
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].geothermal,
    title: copy.title,
    description: copy.description,
    heading: copy.heading,
    lead,
    sections,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: copy.title,
        description: copy.description,
        inLanguage: lang,
        isAccessibleForFree: true,
        spatialCoverage: { "@type": "Country", name: i18n.country("HR") },
        variableMeasured: [
          { "@type": "PropertyValue", name: "geothermal electric capacity", unitText: "MW" },
          { "@type": "PropertyValue", name: "heat flow", unitText: "mW/m2" },
        ],
        isBasedOn: [...(doc.heatFlow ? [doc.heatFlow.url] : []), ...sources],
        publisher: publisher(site, i18n),
        ...(site.siteUrl ? { url: site.siteUrl + path } : {}),
      },
    ],
    lastModified: doc.generatedAt,
    breadcrumbs: [homeCrumb(lang)],
  };
}

export function geothermalPages(site: SiteData): StaticPage[] {
  const doc = site.geothermal;
  if (!doc || doc.sites.length === 0) return [];
  return LANGS.map((lang) => page(site, doc, lang));
}
