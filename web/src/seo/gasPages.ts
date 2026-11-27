/**
 * The gas page (Faza 47-1): Croatia's gas day as text a search engine and an answer engine can read.
 * Until now the daily flows, the deliveries and the storage lived only inside the map, behind "?l=gas".
 *
 * Every figure is the one the map shows: the transmission operator's report to ENTSOG for the last gas
 * day every point reported (data/gasFlows.ts), and the storage operators' report to GIE AGSI
 * (data/gasStorage.ts). Each section opens with a sentence that stands on its own (a figure, its day and
 * its source), and the same sentences are the page's FAQ structured data, word for word. Without a
 * balance for Croatia there is no page.
 */
import {
  balance,
  balances,
  borderFlows,
  latestBorderDay,
  type Balance,
  type GasFlows,
} from "../data/gasFlows";
import { readings, type GasStorage, type Reading } from "../data/gasStorage";
import { createI18n, type I18n } from "../i18n";
import { flowName, gwh } from "../share/gasFlowCard";
import { LANGS, type Lang } from "../state/url";
import { SOURCE_TERMS } from "./license";
import { gasPlaceLinks } from "./gasPlaces";
import { e, list, table } from "./markup";
import { CHART_COPY, keyFigures, rankBars, roundUp, tableBehind, valueColumns } from "./charts";
import { ogImage } from "./ogImages";
import {
  croatiaCrumb,
  home,
  mapLink,
  other,
  PATHS,
  publisher,
  type Section,
  type SiteData,
  type StaticPage,
} from "./site";

const HOME = "HR";
/** the gas days in the table of deliveries */
const DAYS_SHOWN = 14;

interface GasCopy {
  title: string;
  description: string;
  heading: string;
  provisional: string;
  entered: (date: string, total: string, first: string, firstGwh: string, share: string) => string;
  delivered: (date: string, value: string) => string;
  usual: (value: string, change: string) => string;
  stored: (name: string, date: string, full: string, twh: string | null) => string;
  estimated: string;
  whereFrom: { heading: string; columns: [string, string, string] };
  whereTo: { heading: string; answer: (date: string, total: string) => string };
  borders: {
    heading: string;
    answer: (date: string, label: string, value: string, way: string) => string;
    columns: [string, string, string, string];
    note: string;
  };
  perDay: { heading: string; columns: [string, string, string]; note: string };
  storage: { heading: string; none: string; columns: [string, string, string, string]; note: string };
  onMap: { heading: string; intro: string; links: [string, Record<string, string>][] };
  more: { heading: string; learn: string; pictures: [string, string][] };
  method: { heading: string; items: string[] };
  variables: string[];
}

export const GAS_COPY: Record<Lang, GasCopy> = {
  hr: {
    title: "Plin u Hrvatskoj: dnevni ulaz, isporuka i skladište",
    description:
      "Plin u Hrvatskoj po danu: ulaz s LNG terminala na Krku, iz domaćih polja i skladišta, isporuka kupcima i popunjenost skladišta Okoli.",
    heading: "Plin u Hrvatskoj: dnevna slika",
    provisional: "Podaci operatora za taj dan još su privremeni.",
    entered: (date, total, first, firstGwh, share) =>
      `Plinskog dana ${date} u hrvatski transportni sustav ušlo je ${total} GWh plina, a najviše na ulazu „${first}”: ${firstGwh} GWh (${share} %).`,
    delivered: (date, value) =>
      `Kupcima i distribuciji u Hrvatskoj isporučeno je plinskog dana ${date} ukupno ${value} GWh plina.`,
    usual: (value, change) =>
      `Prosjek prethodnih sedam plinskih dana bio je ${value} GWh, pa je to ${change}.`,
    stored: (name, date, full, twh) =>
      `Skladište plina ${name} bilo je plinskog dana ${date} puno ${full} %${twh ? ` (${twh} TWh plina)` : ""}.`,
    estimated: "Taj je podatak procjena platforme, ne potvrđena brojka operatora.",
    whereFrom: { heading: "Odakle Hrvatskoj dolazi plin?", columns: ["Ulaz", "GWh", "Udio"] },
    whereTo: {
      heading: "Kamo plin odlazi iz sustava?",
      answer: (date, total) =>
        `Plinskog dana ${date} iz hrvatskog transportnog sustava izašlo je ${total} GWh plina: kupcima u zemlji, preko granice i u skladište.`,
    },
    borders: {
      heading: "Koliko plina prelazi granice u regiji?",
      answer: (date, label, value, way) =>
        `Plinskog dana ${date} najviše je plina preko granice prešlo na točki ${label}: ${value} GWh (${way}).`,
      columns: ["Granična točka", "Smjer", "GWh", "Prijavljuje"],
      note: "Neto tok je ulaz manje izlaz na točki, kako ga ENTSOG-u javlja operator jedne strane granice (jedne, da se ništa ne broji dvaput). Podaci su isprva privremeni. Srbija i Bosna i Hercegovina na platformi ne javljaju tokove, pa granicu sa Srbijom pokazuje mađarski operator, a Zvornik (Srbija – BiH) nije prikazan.",
    },
    perDay: {
      heading: "Koliko se plina isporuči kupcima u Hrvatskoj po danu?",
      columns: ["Plinski dan", "Isporučeno kupcima (GWh)", "Ušlo u sustav (GWh)"],
      note: "Isporuka kupcima je izlaz iz transportnog sustava prema krajnjim kupcima i distribuciji. To nije izmjerena potrošnja kućanstava: dio plina ostaje u cijevima distribucije.",
    },
    storage: {
      heading: "Koliko je puno skladište plina Okoli?",
      none: "Za hrvatsko skladište trenutačno nema podatka o popunjenosti.",
      columns: ["Skladište", "Zemlja", "Popunjenost", "Plinski dan"],
      note: "Popunjenost je udio radnog volumena skladišta. Izvor: GIE AGSI (Gas Infrastructure Europe), kojem podatke javljaju operatori skladišta.",
    },
    onMap: {
      heading: "Gdje su LNG terminal, plinovodi i bušotine na karti?",
      intro: "Svaka poveznica otvara kartu baš na tome:",
      links: [
        [
          "Plinski sustav Hrvatske: ulazne točke, skladište i plinovodi",
          { l: "gas,pipelines", v: "45.3,16.2,7" },
        ],
        ["LNG terminal na Krku (Omišalj)", { l: "gas,pipelines", v: "45.2,14.55,11" }],
        ["Bušotine u Podravini", { l: "extraction", v: "46.09,17.06,11" }],
        ["Plinska polja i platforme sjevernog Jadrana", { l: "extraction,pipelines", v: "44.75,13.3,9" }],
      ],
    },
    more: {
      heading: "Više o plinu",
      learn: "Put plina: od bušotine do štednjaka (Edukacija)",
      pictures: [
        ["Slika za dijeljenje: odakle je plin ušao", "gasflow"],
        ["Slika za dijeljenje: plin isporučen kupcima", "gasuse"],
        ["Slika za dijeljenje: zalihe plina", "gas"],
      ],
    },
    method: {
      heading: "Što ove brojke jesu, a što nisu?",
      items: [
        "Tokovi su fizički tokovi po točkama koje operator transportnog sustava (Plinacro) javlja platformi ENTSOG Transparency Platform, u kWh po plinskom danu. Plinski dan traje od 6 sati ujutro do 6 sati sljedećeg jutra.",
        "Prikazan je zadnji plinski dan za koji su javile sve točke sustava. Podaci su isprva privremeni, a operator ih kasnije potvrđuje.",
        "Ulaz u sustav nije potrošnja: dio plina koji uđe izađe preko granice ili u skladište. Brojke ne govore ni čiji je plin komu otišao.",
        "Popunjenost skladišta dolazi s platforme GIE AGSI. Stranica se obnavlja svaki dan nakon objave podataka.",
      ],
    },
    variables: [
      "ulaz plina u transportni sustav po točkama",
      "plin isporučen kupcima",
      "popunjenost skladišta plina",
    ],
  },
  en: {
    title: "Gas in Croatia: daily inflow, deliveries and storage",
    description:
      "Daily gas figures for Croatia: inflow from the Krk LNG terminal, domestic fields and storage, deliveries to customers, and how full the Okoli storage is.",
    heading: "Gas in Croatia: the day's picture",
    provisional: "The operator's figures for that day are still provisional.",
    entered: (date, total, first, firstGwh, share) =>
      `On the gas day of ${date}, ${total} GWh of gas entered Croatia's transmission system, most of it at the entry "${first}": ${firstGwh} GWh (${share}%).`,
    delivered: (date, value) =>
      `On the gas day of ${date}, ${value} GWh of gas was delivered to customers and distribution in Croatia.`,
    usual: (value, change) =>
      `The average of the seven gas days before was ${value} GWh, so that is ${change}.`,
    stored: (name, date, full, twh) =>
      `The ${name} gas storage was ${full}% full on the gas day of ${date}${twh ? ` (${twh} TWh of gas)` : ""}.`,
    estimated: "That figure is the platform's estimate, not the operator's confirmed one.",
    whereFrom: { heading: "Where does Croatia's gas come from?", columns: ["Entry", "GWh", "Share"] },
    whereTo: {
      heading: "Where does the gas go?",
      answer: (date, total) =>
        `On the gas day of ${date}, ${total} GWh of gas left Croatia's transmission system: to customers in the country, across the border and into storage.`,
    },
    borders: {
      heading: "How much gas crosses the borders of the region?",
      answer: (date, label, value, way) =>
        `On the gas day of ${date}, the most gas crossed a border at ${label}: ${value} GWh (${way}).`,
      columns: ["Border point", "Direction", "GWh", "Reported by"],
      note: "The net flow is what entered less what left at the point, as the operator of one side of the border reports it to ENTSOG (one side, so that nothing is counted twice). The figures are provisional at first. Serbia and Bosnia and Herzegovina report no flows on the platform, so the border with Serbia is shown from the Hungarian operator, and Zvornik (Serbia – Bosnia and Herzegovina) is not shown.",
    },
    perDay: {
      heading: "How much gas is delivered to customers in Croatia per day?",
      columns: ["Gas day", "Delivered to customers (GWh)", "Entered the system (GWh)"],
      note: "Deliveries are the transmission system's exit to final customers and distribution. They are not the metered consumption of households: some gas stays in the distribution pipes.",
    },
    storage: {
      heading: "How full is the Okoli gas storage?",
      none: "There is currently no fill figure for Croatia's storage.",
      columns: ["Storage", "Country", "Fill", "Gas day"],
      note: "The fill is the share of the storage's working volume. Source: GIE AGSI (Gas Infrastructure Europe), to which the storage operators report.",
    },
    onMap: {
      heading: "Where are the LNG terminal, the pipelines and the wells on the map?",
      intro: "Each link opens the map right there:",
      links: [
        [
          "Croatia's gas system: entry points, storage and pipelines",
          { l: "gas,pipelines", v: "45.3,16.2,7" },
        ],
        ["The LNG terminal on Krk (Omišalj)", { l: "gas,pipelines", v: "45.2,14.55,11" }],
        ["Wells in Podravina", { l: "extraction", v: "46.09,17.06,11" }],
        [
          "Gas fields and platforms of the northern Adriatic",
          { l: "extraction,pipelines", v: "44.75,13.3,9" },
        ],
      ],
    },
    more: {
      heading: "More about gas",
      learn: "The path of gas: from the well to the stove (Learn)",
      pictures: [
        ["Picture to share: where the gas came in", "gasflow"],
        ["Picture to share: gas delivered to customers", "gasuse"],
        ["Picture to share: gas in storage", "gas"],
      ],
    },
    method: {
      heading: "What are these figures, and what are they not?",
      items: [
        "The flows are physical flows at the points the transmission system operator (Plinacro) reports to the ENTSOG Transparency Platform, in kWh per gas day. A gas day runs from 6 in the morning to 6 the next morning.",
        "The day shown is the latest gas day every point of the system has reported. The figures are provisional at first and confirmed by the operator later.",
        "Inflow is not consumption: part of the gas that enters leaves across the border or into storage. Nor do the figures say whose gas went to whom.",
        "The storage fill comes from the GIE AGSI platform. The page is rebuilt every day after the data is published.",
      ],
    },
    variables: [
      "gas entering the transmission system by point",
      "gas delivered to customers",
      "gas storage fill",
    ],
  },
};

/** The tiles under the lead (Faza 54-3). */
const GAS_FIGURES = {
  hr: {
    entered: "Ušlo u sustav",
    delivered: "Isporučeno kupcima",
    usual: "prema prosjeku 7 dana",
    stored: (name: string) => `Skladište ${name}`,
  },
  en: {
    entered: "Entered the system",
    delivered: "Delivered to customers",
    usual: "vs the 7-day average",
    stored: (name: string) => `${name} storage`,
  },
} as const;

/** A gas day under its column: "23. 11." in Croatian, "23/11" in English. */
const shortDay = (day: string, lang: Lang): string => {
  const date = String(Number(day.slice(8, 10)));
  const month = String(Number(day.slice(5, 7)));
  return lang === "hr" ? `${date}. ${month}.` : `${date}/${month}`;
};

/** Whether the build has what the page is about: Croatia's balance for a gas day. */
export function hasGasPage(site: SiteData): boolean {
  return Boolean(site.gasFlows && balance(site.gasFlows, HOME));
}

/** A change against the usual, in the reader's words: "13 % manje od prosjeka". */
function against(change: number, lang: Lang, i18n: I18n): string {
  const rounded = Math.round(change);
  if (rounded === 0) return lang === "hr" ? "jednako prosjeku" : "the same as the average";
  const size = i18n.number(Math.abs(rounded));
  if (lang === "hr") return `${size} % ${rounded > 0 ? "više" : "manje"} od prosjeka`;
  return `${size}% ${rounded > 0 ? "more" : "less"} than the average`;
}

interface Answers {
  entered: string;
  left: string;
  delivered: string | null;
  stored: string | null;
}

function answers(day: Balance, croatian: Reading[], lang: Lang, i18n: I18n): Answers {
  const copy = GAS_COPY[lang];
  const date = i18n.date(day.day);
  const first = day.entries[0];
  const entered = first
    ? copy.entered(
        date,
        gwh(day.enteredKwh, i18n),
        flowName(first, i18n),
        gwh(first.kwh, i18n),
        i18n.number(Math.round(first.share * 100)),
      )
    : "";
  let delivered: string | null = null;
  if (day.consumersKwh !== null) {
    delivered = copy.delivered(date, gwh(day.consumersKwh, i18n));
    if (day.usualConsumersKwh !== null && day.usualConsumersKwh > 0) {
      const change = (day.consumersKwh / day.usualConsumersKwh - 1) * 100;
      delivered += ` ${copy.usual(gwh(day.usualConsumersKwh, i18n), against(change, lang, i18n))}`;
    }
  }
  const stored =
    croatian.length > 0
      ? croatian
          .map(
            (reading) =>
              copy.stored(
                reading.facility.name,
                i18n.date(reading.day),
                i18n.number(reading.full, 1),
                reading.inStorageTwh === null ? null : i18n.number(reading.inStorageTwh, 2),
              ) + (reading.estimated ? ` ${copy.estimated}` : ""),
          )
          .join(" ")
      : null;
  return { entered, left: copy.whereTo.answer(date, gwh(day.leftKwh, i18n)), delivered, stored };
}

function gasPage(site: SiteData, flows: GasFlows, storage: GasStorage | null, lang: Lang): StaticPage | null {
  const day = balance(flows, HOME);
  if (!day) return null;
  const copy = GAS_COPY[lang];
  const i18n = createI18n(lang);
  const all = storage ? readings(storage, HOME) : [];
  const said = answers(
    day,
    all.filter((reading) => reading.facility.country === HOME),
    lang,
    i18n,
  );
  const rows = (side: Balance["entries"]): string[][] =>
    side.map((row) => [
      flowName(row, i18n),
      gwh(row.kwh, i18n),
      `${i18n.number(Math.round(row.share * 100))} %`,
    ]);
  const note = day.provisional ? ` ${copy.provisional}` : "";
  const chartWords = CHART_COPY[lang];
  const figureWords = GAS_FIGURES[lang];
  // Faza 54-3: a side of the balance as bars of its shares, with the table behind a click
  const shares = (side: Balance["entries"]): string =>
    rankBars(
      side.map((row) => ({
        name: e(flowName(row, i18n)),
        value: row.share,
        text: `${gwh(row.kwh, i18n)} GWh`,
        detail: `${i18n.number(Math.round(row.share * 100))} %`,
      })),
    ) + tableBehind(chartWords.table, table([...copy.whereFrom.columns], rows(side)));
  const sections: Section[] = [
    {
      heading: copy.whereFrom.heading,
      html: `<p>${e(said.entered + note)}</p>` + shares(day.entries),
    },
    {
      heading: copy.whereTo.heading,
      html: `<p>${e(said.left)}</p>` + shares(day.exits),
    },
  ];
  // the tiles: what entered, what customers got against their usual week, how full Okoli is
  const okoli = all.find((reading) => reading.facility.country === HOME);
  const usual =
    day.consumersKwh !== null && day.usualConsumersKwh !== null && day.usualConsumersKwh > 0
      ? day.consumersKwh / day.usualConsumersKwh - 1
      : null;
  const figures = keyFigures(
    [
      { label: figureWords.entered, value: gwh(day.enteredKwh, i18n), unit: "GWh", note: i18n.date(day.day) },
      ...(day.consumersKwh === null
        ? []
        : [
            {
              label: figureWords.delivered,
              value: gwh(day.consumersKwh, i18n),
              unit: "GWh",
              ...(usual === null
                ? {}
                : {
                    change: {
                      value: usual,
                      text: i18n.percent(Math.abs(usual)),
                      against: figureWords.usual,
                      rise: "neutral" as const,
                    },
                  }),
            },
          ]),
      ...(okoli
        ? [
            {
              label: figureWords.stored(okoli.facility.name),
              value: i18n.number(okoli.full, 1),
              unit: "%",
              note: i18n.date(okoli.day),
            },
          ]
        : []),
    ],
    chartWords.figures,
  );
  const faq: [string, string][] = [
    [copy.whereFrom.heading, said.entered],
    [copy.whereTo.heading, said.left],
  ];
  // the borders on the page's own gas day, or on the latest day they have figures for
  const borderDay = borderFlows(flows, day.day).length > 0 ? day.day : latestBorderDay(flows);
  const across = borderDay === null ? [] : borderFlows(flows, borderDay);
  const [largest] = across;
  if (borderDay !== null && largest) {
    // a border through which nothing went has no direction to give
    const way = (flow: (typeof across)[number]): string =>
      flow.kwh > 0 ? `${i18n.country(flow.from)} → ${i18n.country(flow.to)}` : i18n.t("gasFlowPointIdle");
    const top = largest.kwh > 0 ? largest.kwh : 1;
    const sentence = copy.borders.answer(
      i18n.date(borderDay),
      largest.border.label,
      gwh(largest.kwh, i18n),
      way(largest),
    );
    sections.push({
      heading: copy.borders.heading,
      html:
        `<p>${e(sentence)}</p>` +
        rankBars(
          across.map((flow) => ({
            name: e(flow.border.label),
            value: flow.kwh / top,
            text: `${gwh(flow.kwh, i18n)} GWh`,
            detail: way(flow),
            own: flow.border.country === HOME || flow.border.neighbour === HOME,
          })),
        ) +
        tableBehind(
          chartWords.table,
          table(
            [...copy.borders.columns],
            across.map((flow) => [flow.border.label, way(flow), gwh(flow.kwh, i18n), flow.border.operator]),
          ),
        ) +
        `<p>${e(copy.borders.note)}</p>`,
    });
    faq.push([copy.borders.heading, sentence]);
  }
  if (said.delivered !== null) {
    const days = balances(flows, HOME)
      .filter((each) => each.consumersKwh !== null)
      .slice(-DAYS_SHOWN)
      .reverse();
    // the days as columns, oldest first, the page's own day marked; the axis tops at a round number of GWh
    const oldestFirst = [...days].reverse();
    const top = roundUp(Math.max(...oldestFirst.map((each) => (each.consumersKwh ?? 0) / 1e6)));
    const perDay = valueColumns(
      oldestFirst.map((each, index) => ({
        label: index % 2 === (oldestFirst.length - 1) % 2 ? shortDay(each.day, lang) : "",
        minor: (oldestFirst.length - 1 - index) % 4 !== 0,
        value: each.consumersKwh === null ? null : each.consumersKwh / 1e6,
        ...(index === oldestFirst.length - 1 ? { mark: "now" as const } : {}),
      })),
      top,
      [`${i18n.number(top)} GWh`, i18n.number(top / 2), "0"],
      "",
      "neutral",
    );
    sections.push({
      heading: copy.perDay.heading,
      html:
        `<p>${e(said.delivered)}</p>` +
        perDay +
        tableBehind(
          chartWords.table,
          table(
            [...copy.perDay.columns],
            days.map((each) => [
              i18n.date(each.day),
              gwh(each.consumersKwh ?? 0, i18n),
              gwh(each.enteredKwh, i18n),
            ]),
          ),
        ) +
        `<p>${e(copy.perDay.note)}</p>`,
    });
    faq.push([copy.perDay.heading, said.delivered]);
  }
  if (storage) {
    sections.push({
      heading: copy.storage.heading,
      html:
        `<p>${e(said.stored ?? copy.storage.none)}</p>` +
        (all.length > 0
          ? rankBars(
              all.map((reading) => ({
                name: e(reading.facility.name),
                value: reading.full / 100,
                text: `${i18n.number(reading.full, 1)} %`,
                detail: `${i18n.country(reading.facility.country)} · ${i18n.date(reading.day)}`,
                own: reading.facility.country === HOME,
              })),
            ) +
            tableBehind(
              chartWords.table,
              table(
                [...copy.storage.columns],
                all.map((reading) => [
                  reading.facility.name,
                  i18n.country(reading.facility.country),
                  `${i18n.number(reading.full, 1)} %`,
                  i18n.date(reading.day),
                ]),
              ),
            )
          : "") +
        `<p>${e(copy.storage.note)}</p>`,
    });
    if (said.stored !== null) faq.push([copy.storage.heading, said.stored]);
  }
  sections.push(
    {
      heading: copy.onMap.heading,
      html:
        `<p>${e(copy.onMap.intro)}</p>` +
        list(
          copy.onMap.links.map(([text, params]) => `<a href="${e(mapLink(lang, params))}">${e(text)}</a>`),
        ),
    },
    {
      heading: copy.more.heading,
      html: list([
        ...gasPlaceLinks(site, lang),
        `<a href="${e(PATHS[lang].learn)}">${e(copy.more.learn)}</a>`,
        ...copy.more.pictures.map(([text, pic]) => `<a href="${e(mapLink(lang, { pic }))}">${e(text)}</a>`),
      ]),
    },
    { heading: copy.method.heading, html: list(copy.method.items.map((item) => e(item))) },
  );
  const path = PATHS[lang].gas;
  const sources = [flows.sourceUrl, ...(storage ? [storage.sourceUrl] : [])];
  return {
    path,
    lang,
    alternatePath: PATHS[other(lang)].gas,
    title: copy.title,
    description: copy.description,
    heading: copy.heading,
    lead: `<p>${e([said.entered, said.delivered, said.stored].filter(Boolean).join(" ") + note)}</p>`,
    figures,
    sections,
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
        spatialCoverage: { "@type": "Place", name: i18n.country(HOME) },
        variableMeasured: copy.variables.map((name) => ({ "@type": "PropertyValue", name })),
        isBasedOn: sources,
        license: [SOURCE_TERMS.entsog, ...(storage ? [SOURCE_TERMS.gieAgsi] : [])],
        publisher: publisher(site, i18n),
        ...(site.siteUrl ? { url: site.siteUrl + path } : {}),
      },
      // the opening sentence of each section, word for word: structured data never says more than the page
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        inLanguage: lang,
        mainEntity: faq.map(([question, answer]) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      },
    ],
    image: ogImage("gas", lang),
    lastModified: flows.generatedAt,
    breadcrumbs: [home(lang), croatiaCrumb(lang)],
  };
}

export function gasPages(site: SiteData): StaticPage[] {
  const flows = site.gasFlows;
  if (!flows) return [];
  return LANGS.flatMap((lang) => {
    const page = gasPage(site, flows, site.gasStorage ?? null, lang);
    return page ? [page] : [];
  });
}

/** A link to the gas page for other pages' lists; nothing when the page does not exist. */
export const gasLinks = (site: SiteData, lang: Lang): string[] =>
  hasGasPage(site) ? [`<a href="${e(PATHS[lang].gas)}">${e(GAS_COPY[lang].heading)}</a>`] : [];
