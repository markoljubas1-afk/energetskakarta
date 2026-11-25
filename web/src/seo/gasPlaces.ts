/**
 * Two places of Croatia's gas system with a page of their own (Faza 47-8): the LNG terminal on Krk and the
 * Okoli storage. A question about one of them ("how full is Okoli", "how much does the Krk terminal send
 * out") deserves an address, not a paragraph in the middle of another page.
 *
 * The daily figures are the ones the map and the gas page show (ENTSOG for the terminal's send-out, GIE
 * AGSI for the storage). What the places are is said in the learning page's own sentences, with that
 * page's sources: one wording of a fact, in one place. A page exists only while its figures do.
 */
import { balances, type Balance, type FlowRow, type GasFlows } from "../data/gasFlows";
import { readings, type GasStorage, type Reading } from "../data/gasStorage";
import { createI18n } from "../i18n";
import { gwh } from "../share/gasFlowCard";
import { LANGS, type Lang } from "../state/url";
import { SOURCE_TERMS } from "./license";
import { LEARN_COPY } from "./learnPages";
import { e, list, table } from "./markup";
import { ogImage } from "./ogImages";
import { home, mapLink, other, PATHS, publisher, type Crumb, type SiteData, type StaticPage } from "./site";

const HOME = "HR";
const DAYS_SHOWN = 14;

interface PlaceCopy {
  /** the gas page, as the step before these pages in the trail */
  hub: string;
  terminal: {
    title: string;
    description: string;
    heading: string;
    sent: (date: string, value: string, share: string, total: string) => string;
    perDay: { heading: string; columns: [string, string, string] };
    what: string;
    map: string;
    mapLink: string;
  };
  storage: {
    title: (name: string) => string;
    description: string;
    heading: (name: string) => string;
    full: (name: string, date: string, full: string, twh: string | null, capacity: string | null) => string;
    estimated: string;
    moving: {
      injecting: (value: string) => string;
      withdrawing: (value: string) => string;
      steady: string;
    };
    perDay: { heading: string; columns: [string, string] };
    what: string;
    map: string;
    mapLink: string;
    source: string;
  };
  sources: string;
  provisional: string;
  back: string;
}

const COPY: Record<Lang, PlaceCopy> = {
  hr: {
    hub: "Plin u Hrvatskoj",
    terminal: {
      title: "LNG terminal Krk: koliko plina šalje u sustav",
      description:
        "Koliko je plina LNG terminal na Krku (Omišalj) poslao u hrvatski transportni sustav po plinskom danu i koliki je to dio ulaza, uz osnovne podatke o terminalu.",
      heading: "LNG terminal na Krku",
      sent: (date, value, share, total) =>
        `Plinskog dana ${date} LNG terminal na Krku poslao je u hrvatski transportni sustav ${value} GWh plina, ${share} % svega što je taj dan ušlo u sustav (${total} GWh).`,
      perDay: {
        heading: "Koliko plina LNG terminal na Krku šalje po danu?",
        columns: ["Plinski dan", "S terminala (GWh)", "Udio u ulazu"],
      },
      what: "Što je LNG terminal na Krku?",
      map: "Gdje je terminal na karti?",
      mapLink: "LNG terminal u Omišlju i plinovod koji od njega vodi",
    },
    storage: {
      title: (name) => `Skladište plina Okoli (${name}): koliko je puno`,
      description:
        "Popunjenost podzemnog skladišta plina Okoli po plinskom danu, koliko plina drži i puni li se ili prazni, prema podacima operatora na platformi GIE AGSI.",
      heading: (name) => `Skladište plina Okoli (${name})`,
      full: (name, date, full, twh, capacity) =>
        `Skladište plina ${name} bilo je plinskog dana ${date} puno ${full} %${twh ? `: u njemu je bilo ${twh} TWh plina${capacity ? ` od ${capacity} TWh koliko stane` : ""}` : ""}.`,
      estimated: "Taj je podatak procjena platforme, ne potvrđena brojka operatora.",
      moving: {
        injecting: (value) => `Tog se dana punilo: utisnuto je ${value} GWh.`,
        withdrawing: (value) => `Tog se dana praznilo: povučeno je ${value} GWh.`,
        steady: "Tog dana nije se ni punilo ni praznilo.",
      },
      perDay: {
        heading: "Kako se popunjenost skladišta Okoli mijenjala zadnjih dana?",
        columns: ["Plinski dan", "Popunjenost"],
      },
      what: "Što je skladište plina Okoli?",
      map: "Gdje je skladište na karti?",
      mapLink: "Skladište Okoli na karti, s plinovodima",
      source:
        "Izvor dnevnih podataka: GIE AGSI (Gas Infrastructure Europe), kojem podatke javljaju operatori skladišta.",
    },
    sources: "Izvori",
    provisional: "Podaci operatora za taj dan još su privremeni.",
    back: "Plin u Hrvatskoj: dnevna slika cijelog sustava",
  },
  en: {
    hub: "Gas in Croatia",
    terminal: {
      title: "Krk LNG terminal: how much gas it sends out",
      description:
        "How much gas the LNG terminal on Krk (Omišalj) sent into Croatia's transmission system on each gas day and what share of the inflow that is, with the terminal's basic facts.",
      heading: "The LNG terminal on Krk",
      sent: (date, value, share, total) =>
        `On the gas day of ${date} the LNG terminal on Krk sent ${value} GWh of gas into Croatia's transmission system, ${share}% of everything that entered the system that day (${total} GWh).`,
      perDay: {
        heading: "How much gas does the Krk LNG terminal send out per day?",
        columns: ["Gas day", "From the terminal (GWh)", "Share of inflow"],
      },
      what: "What is the LNG terminal on Krk?",
      map: "Where is the terminal on the map?",
      mapLink: "The LNG terminal at Omišalj and the pipeline that leads from it",
    },
    storage: {
      title: (name) => `Okoli gas storage (${name}): how full it is`,
      description:
        "The fill of the Okoli underground gas storage on each gas day, how much gas it holds and whether it is being filled or emptied, as its operator reports to GIE AGSI.",
      heading: (name) => `Okoli gas storage (${name})`,
      full: (name, date, full, twh, capacity) =>
        `The ${name} gas storage was ${full}% full on the gas day of ${date}${twh ? `: it held ${twh} TWh of gas${capacity ? ` of the ${capacity} TWh it can hold` : ""}` : ""}.`,
      estimated: "That figure is the platform's estimate, not the operator's confirmed one.",
      moving: {
        injecting: (value) => `It was being filled that day: ${value} GWh was injected.`,
        withdrawing: (value) => `It was being emptied that day: ${value} GWh was withdrawn.`,
        steady: "It was neither filled nor emptied that day.",
      },
      perDay: {
        heading: "How has the fill of the Okoli storage changed over the last days?",
        columns: ["Gas day", "Fill"],
      },
      what: "What is the Okoli gas storage?",
      map: "Where is the storage on the map?",
      mapLink: "The Okoli storage on the map, with the pipelines",
      source:
        "Source of the daily figures: GIE AGSI (Gas Infrastructure Europe), to which the storage operators report.",
    },
    sources: "Sources",
    provisional: "The operator's figures for that day are still provisional.",
    back: "Gas in Croatia: the day's picture of the whole system",
  },
};

interface PlacePaths {
  terminal: string;
  storage: string;
}

export const GAS_PLACE_PATHS: Record<Lang, PlacePaths> = {
  hr: { terminal: "/plin/lng-terminal-krk/", storage: "/plin/skladiste-plina-okoli/" },
  en: { terminal: "/en/gas/krk-lng-terminal/", storage: "/en/gas/okoli-gas-storage/" },
};

const trail = (lang: Lang): Crumb[] => [home(lang), { name: COPY[lang].hub, path: PATHS[lang].gas }];

const sourcesHtml = (lang: Lang, which: readonly [string, string][]): string =>
  `<p>${e(COPY[lang].sources)}: ${which.map(([name, url]) => `<a href="${e(url)}">${e(name)}</a>`).join("; ")}.</p>`;

const faqLd = (lang: Lang, faq: [string, string][]): Record<string, unknown> => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  inLanguage: lang,
  mainEntity: faq.map(([question, answer]) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: { "@type": "Answer", text: answer },
  })),
});

/** The terminal's entry on a day; undefined when that day's balance has no LNG entry. */
const terminalRow = (day: Balance): FlowRow | undefined => day.entries.find((row) => row.kind === "LNG");

function terminalPage(site: SiteData, flows: GasFlows, lang: Lang): StaticPage | null {
  const days = balances(flows, HOME);
  const day = days.at(-1);
  const row = day ? terminalRow(day) : undefined;
  if (!day || !row) return null;
  const copy = COPY[lang].terminal;
  const i18n = createI18n(lang);
  const share = (each: FlowRow): string => i18n.number(Math.round(each.share * 100));
  const sent =
    copy.sent(i18n.date(day.day), gwh(row.kwh, i18n), share(row), gwh(day.enteredKwh, i18n)) +
    (day.provisional ? ` ${COPY[lang].provisional}` : "");
  const what = LEARN_COPY[lang].gasPath[1] ?? "";
  const path = GAS_PLACE_PATHS[lang].terminal;
  return {
    path,
    lang,
    alternatePath: GAS_PLACE_PATHS[other(lang)].terminal,
    title: copy.title,
    description: copy.description,
    heading: copy.heading,
    lead: `<p>${e(sent)}</p>`,
    sections: [
      {
        heading: copy.perDay.heading,
        html:
          `<p>${e(sent)}</p>` +
          table(
            [...copy.perDay.columns],
            days
              .slice(-DAYS_SHOWN)
              .reverse()
              .flatMap((each) => {
                const found = terminalRow(each);
                return found ? [[i18n.date(each.day), gwh(found.kwh, i18n), `${share(found)} %`]] : [];
              }),
          ),
      },
      { heading: copy.what, html: `<p>${e(what)}</p>` + sourcesHtml(lang, LEARN_COPY[lang].gasPathSources) },
      {
        heading: copy.map,
        html: list([
          `<a href="${e(mapLink(lang, { l: "gas,pipelines", v: "45.2,14.55,11" }))}">${e(copy.mapLink)}</a>`,
          `<a href="${e(PATHS[lang].gas)}">${e(COPY[lang].back)}</a>`,
        ]),
      },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: copy.title,
        description: copy.description,
        inLanguage: lang,
        isAccessibleForFree: true,
        temporalCoverage: day.day,
        dateModified: flows.generatedAt,
        spatialCoverage: { "@type": "Place", name: copy.heading },
        isBasedOn: [flows.sourceUrl],
        license: SOURCE_TERMS.entsog,
        publisher: publisher(site, i18n),
        ...(site.siteUrl ? { url: site.siteUrl + path } : {}),
      },
      faqLd(lang, [
        [copy.perDay.heading, sent],
        [copy.what, what],
      ]),
    ],
    lastModified: flows.generatedAt,
    image: ogImage("gas", lang),
    breadcrumbs: trail(lang),
  };
}

function storagePage(site: SiteData, storage: GasStorage, reading: Reading, lang: Lang): StaticPage {
  const copy = COPY[lang].storage;
  const i18n = createI18n(lang);
  const { facility } = reading;
  const full =
    copy.full(
      facility.name,
      i18n.date(reading.day),
      i18n.number(reading.full, 1),
      reading.inStorageTwh === null ? null : i18n.number(reading.inStorageTwh, 2),
      facility.workingGasTwh === null ? null : i18n.number(facility.workingGasTwh, 2),
    ) + (reading.estimated ? ` ${copy.estimated}` : "");
  const moving =
    reading.direction === "injecting" && reading.injection !== null
      ? copy.moving.injecting(i18n.number(reading.injection, 1))
      : reading.direction === "withdrawing" && reading.withdrawal !== null
        ? copy.moving.withdrawing(i18n.number(reading.withdrawal, 1))
        : reading.direction === "steady"
          ? copy.moving.steady
          : "";
  const answer = [full, moving].filter(Boolean).join(" ");
  // the learning page's two sentences about the storage: what it holds, and how it is filled and emptied
  const what = [LEARN_COPY[lang].gas[3], LEARN_COPY[lang].gasPath[3]].filter(Boolean).join(" ");
  const place =
    facility.lon !== null && facility.lat !== null
      ? { l: "gas,pipelines", v: `${facility.lat.toFixed(2)},${facility.lon.toFixed(2)},10` }
      : { l: "gas,pipelines" };
  const path = GAS_PLACE_PATHS[lang].storage;
  return {
    path,
    lang,
    alternatePath: GAS_PLACE_PATHS[other(lang)].storage,
    title: copy.title(facility.name),
    description: copy.description,
    heading: copy.heading(facility.name),
    lead: `<p>${e(answer)}</p>`,
    sections: [
      {
        heading: copy.perDay.heading,
        html:
          `<p>${e(answer)}</p>` +
          table(
            [...copy.perDay.columns],
            reading.history
              .slice(-DAYS_SHOWN)
              .reverse()
              .map((each) => [i18n.date(each.day), `${i18n.number(each.full, 1)} %`]),
          ) +
          `<p>${e(copy.source)}</p>`,
      },
      {
        heading: copy.what,
        html:
          `<p>${e(what)}</p>` +
          sourcesHtml(lang, [...LEARN_COPY[lang].gasSources, ...LEARN_COPY[lang].gasPathSources]),
      },
      {
        heading: copy.map,
        html: list([
          `<a href="${e(mapLink(lang, place))}">${e(copy.mapLink)}</a>`,
          `<a href="${e(PATHS[lang].gas)}">${e(COPY[lang].back)}</a>`,
        ]),
      },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: copy.title(facility.name),
        description: copy.description,
        inLanguage: lang,
        isAccessibleForFree: true,
        temporalCoverage: reading.day,
        dateModified: storage.generatedAt,
        spatialCoverage: { "@type": "Place", name: copy.heading(facility.name) },
        isBasedOn: [storage.sourceUrl],
        license: SOURCE_TERMS.gieAgsi,
        publisher: publisher(site, i18n),
        ...(site.siteUrl ? { url: site.siteUrl + path } : {}),
      },
      faqLd(lang, [
        [copy.perDay.heading, answer],
        [copy.what, what],
      ]),
    ],
    lastModified: storage.generatedAt,
    image: ogImage("gas", lang),
    breadcrumbs: trail(lang),
  };
}

/** Croatia's storage reading: the pages are about one facility, so only when there is exactly one. */
function croatianStorage(storage: GasStorage): Reading | null {
  const found = readings(storage, HOME).filter((reading) => reading.facility.country === HOME);
  return found.length === 1 ? (found[0] ?? null) : null;
}

export function gasPlacePages(site: SiteData): StaticPage[] {
  const pages: StaticPage[] = [];
  for (const lang of LANGS) {
    const terminal = site.gasFlows ? terminalPage(site, site.gasFlows, lang) : null;
    if (terminal) pages.push(terminal);
    const reading = site.gasStorage ? croatianStorage(site.gasStorage) : null;
    // the pages hang under the gas page: without it they would lead back to nothing
    if (site.gasStorage && reading && site.gasFlows && balances(site.gasFlows, HOME).length > 0) {
      pages.push(storagePage(site, site.gasStorage, reading, lang));
    }
  }
  return pages;
}

/** Links to the pages that exist, for the gas page's list. */
export function gasPlaceLinks(site: SiteData, lang: Lang): string[] {
  return gasPlacePages(site)
    .filter((page) => page.lang === lang)
    .map((page) => `<a href="${e(page.path)}">${e(page.heading)}</a>`);
}
