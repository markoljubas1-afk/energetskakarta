/** Words of the monthly reports (Faza 29), in both languages. */
import type { Lang } from "../state/url";

/** Croatian months in the nominative ("listopad 2026.") for titles and tables. */
const HR_MONTHS = [
  "siječanj",
  "veljača",
  "ožujak",
  "travanj",
  "svibanj",
  "lipanj",
  "srpanj",
  "kolovoz",
  "rujan",
  "listopad",
  "studeni",
  "prosinac",
];
/** …and in the locative ("u listopadu 2026.") for sentences. */
const HR_MONTHS_IN = [
  "siječnju",
  "veljači",
  "ožujku",
  "travnju",
  "svibnju",
  "lipnju",
  "srpnju",
  "kolovozu",
  "rujnu",
  "listopadu",
  "studenome",
  "prosincu",
];
const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parts(month: string): { year: string; index: number } {
  const [year = "", number = ""] = month.split("-");
  return { year, index: Number(number) - 1 };
}

/** "2026-10" → "listopad 2026." / "October 2026". */
export function monthName(lang: Lang, month: string): string {
  const { year, index } = parts(month);
  return lang === "hr" ? `${HR_MONTHS[index] ?? month} ${year}.` : `${EN_MONTHS[index] ?? month} ${year}`;
}

/** "2026-10" → "U listopadu 2026." / "In October 2026", to open a sentence. */
export function inMonth(lang: Lang, month: string): string {
  const { year, index } = parts(month);
  return lang === "hr"
    ? `U ${HR_MONTHS_IN[index] ?? month} ${year}.`
    : `In ${EN_MONTHS[index] ?? month} ${year},`;
}

interface ReportCopy {
  indexTitle: string;
  indexDescription: string;
  indexLead: string;
  indexSection: string;
  indexColumns: [string, string, string, string];
  linkText: string;
  latestLink: (name: string) => string;
  title: (name: string) => string;
  description: (name: string) => string;
  /** "U listopadu 2026. obnovljivi izvori dali su …"; `opening` is `inMonth` */
  lead: (opening: string, share: string, comparisons: string[], co2: string | null) => string;
  totals: (total: string, load: string | null) => string;
  /** the month in a few points, for a reader who wants to pass it on (Faza 40-3) */
  brief: {
    heading: string;
    main: (source: string, share: string) => string;
    /** `yearAgo`: the share in the same month a year earlier, when that month is complete */
    renewable: (share: string, yearAgo: string | null) => string;
    co2: (grams: string) => string;
    /** the country of the region with the highest renewable share that month */
    top: (country: string, share: string) => string;
    /** the day-ahead price at or below zero: `days` and `hours` are counts with their nouns */
    free: (days: string, hours: string, lowest: string) => string;
    /** a whole month without such an hour */
    neverFree: (lowest: string) => string;
    /** gas storage at the end of the month, with the same month-end a year earlier when it is known */
    storage: (full: string, day: string, yearAgo: string | null, source: string) => string;
    share: string;
  };
  comparison: (name: string, share: string) => string;
  sources: {
    heading: string;
    columns: (month: string, previous: string, yearAgo: string) => [string, string, string, string, string];
    total: string;
    renewable: string;
    share: string;
    co2: string;
    load: string;
    note: string;
  };
  region: {
    heading: (name: string) => string;
    columns: [string, string, string, string, string];
    note: string;
    missing: (names: string) => string;
  };
  hep: {
    heading: string;
    sentence: (published: string, dataDate: string, free: string, total: string) => string;
    link: string;
  };
  official: {
    heading: string;
    sentence: (year: string, share: string, target: string) => string;
  };
  method: { heading: string; items: string[] };
  nav: { heading: string; previous: (name: string) => string; next: (name: string) => string };
  variables: string[];
}

export const REPORT_COPY: Record<Lang, ReportCopy> = {
  hr: {
    indexTitle: "Mjesečni izvještaji: struja u Hrvatskoj i regiji",
    indexDescription:
      "Za svaki mjesec: proizvodnja struje po izvorima, udio obnovljivih izvora i CO₂ intenzitet u Hrvatskoj i susjednim zemljama, iz podataka ENTSO-E.",
    indexLead:
      "Po jedan izvještaj za svaki potpuni mjesec, najnoviji prvi. Svaki ima trajnu adresu i može se citirati.",
    indexSection: "Svi izvještaji",
    indexColumns: ["Mjesec", "Udio obnovljivih", "CO₂ intenzitet (g/kWh)", "Proizvodnja"],
    linkText: "Mjesečni izvještaji: struja u Hrvatskoj i regiji",
    latestLink: (name) => `Zadnji mjesečni izvještaj: ${name}`,
    title: (name) => `Struja u Hrvatskoj i regiji: ${name}`,
    description: (name) =>
      `Mjesečni izvještaj (${name}): proizvodnja struje po izvorima, udio obnovljivih izvora i CO₂ intenzitet u Hrvatskoj, usporedba s prethodnim mjesecom, istim mjesecom godinu ranije i susjednim zemljama, iz podataka ENTSO-E.`,
    lead: (opening, share, comparisons, co2) =>
      `${opening} obnovljivi izvori dali su ${share} proizvodnje struje u Hrvatskoj${comparisons.length > 0 ? ` (${comparisons.join(", ")})` : ""}${co2 ? `, uz CO₂ intenzitet od oko ${co2} g/kWh` : ""}.`,
    totals: (total, load) =>
      `Ukupna proizvodnja: ${total}${load ? `; potrošnja (opterećenje mreže): ${load}` : ""}.`,
    brief: {
      heading: "Ukratko",
      main: (source, share) => `Glavni izvor struje u Hrvatskoj: ${source} (${share} proizvodnje).`,
      renewable: (share, yearAgo) =>
        `Obnovljivi izvori dali su ${share} proizvodnje${yearAgo ? ` (isti mjesec godinu ranije: ${yearAgo})` : ""}.`,
      co2: (grams) =>
        `CO₂ intenzitet proizvodnje: oko ${grams} g/kWh (izračun iz faktora IPCC-a, ne mjerenje).`,
      top: (country, share) => `Najveći udio obnovljivih u regiji: ${country} (${share}).`,
      free: (days, hours, lowest) =>
        `Cijena struje na burzi (dan unaprijed) bila je nula ili niža ${days}, ukupno ${hours}; najniža je bila ${lowest} €/MWh. To je veleprodajna cijena; račun kućanstva je ne prati.`,
      neverFree: (lowest) =>
        `Cijena struje na burzi (dan unaprijed) nijedan sat nije pala na nulu; najniža je bila ${lowest} €/MWh.`,
      storage: (full, day, yearAgo, source) =>
        `Skladište plina u Hrvatskoj na kraju mjeseca (${day}) bilo je ${full} puno${yearAgo ? `; godinu ranije ${yearAgo}` : ""}. Izvor: ${source}.`,
      share: "Slobodno dijeljenje uz navođenje izvora: gridatlas.eu.",
    },
    comparison: (name, share) => `${name}: ${share}`,
    sources: {
      heading: "Proizvodnja po izvorima",
      columns: (month, previous, yearAgo) => ["Izvor", month, "Udio", previous, yearAgo],
      total: "Ukupno",
      renewable: "Iz obnovljivih izvora",
      share: "Udio obnovljivih",
      co2: "CO₂ intenzitet (g/kWh)",
      load: "Potrošnja (opterećenje mreže)",
      note: "Obnovljivi: hidro, vjetar, sunce, biomasa i geotermalna; reverzibilne hidroelektrane se ne broje jer vraćaju struju koju su potrošile. Mjesec bez potpunih podataka ostaje prazan.",
    },
    region: {
      heading: (name) => `Regija: ${name}`,
      columns: ["Zemlja", "Proizvodnja", "Udio obnovljivih", "CO₂ intenzitet (g/kWh)", "Najveći izvor"],
      note: "Samo zemlje s potpunim podacima za taj mjesec, po udjelu obnovljivih izvora.",
      missing: (names) => `Bez potpunih podataka: ${names}.`,
    },
    hep: {
      heading: "Slobodni kapacitet distribucijske mreže (HEP ODS)",
      sentence: (published, dataDate, free, total) =>
        `HEP ODS je ${published} objavio nove podatke (stanje ${dataDate}): slobodnog kapaciteta za priključenje ima ${free} od ${total}.`,
      link: "Kapaciteti po trafostanicama",
    },
    official: {
      heading: "Službeni godišnji udio (Eurostat)",
      sentence: (year, share, target) =>
        `Zadnji službeni udio obnovljivih izvora u bruto konačnoj potrošnji energije u Hrvatskoj (Eurostat, ${year}.): ${share}; cilj za 2030.: ${target}. Mjeri svu energiju, ne samo struju, pa se ne može usporediti s mjesečnim udjelom gore.`,
    },
    method: {
      heading: "Izvori i metodologija",
      items: [
        "Proizvodnja i potrošnja: ENTSO-E Transparency Platform (stvarna proizvodnja po izvorima i opterećenje mreže), mjesečni zbrojevi po hrvatskom vremenu.",
        "Mjesec se prikazuje kad je prijavljeno barem 98 % njegova trajanja. ENTSO-E naknadno ispravlja podatke, pa se brojke još mogu malo promijeniti.",
        "CO₂ intenzitet: emisijski faktori životnog ciklusa (IPCC AR5), kao na stranici „Zelena tranzicija”; uvoz se ne računa.",
        "Nema projekcija ni procjena: samo zbrojevi, udjeli i usporedbe.",
      ],
    },
    nav: {
      heading: "Ostali izvještaji",
      previous: (name) => `Prethodni: ${name}`,
      next: (name) => `Sljedeći: ${name}`,
    },
    variables: [
      "proizvodnja struje po izvorima",
      "udio obnovljivih izvora u proizvodnji struje",
      "CO₂ intenzitet proizvodnje struje",
      "potrošnja struje (opterećenje mreže)",
    ],
  },
  en: {
    indexTitle: "Monthly reports: electricity in Croatia and the region",
    indexDescription:
      "For every month: electricity generation by source, the renewable share and carbon intensity in Croatia and its neighbours, from ENTSO-E data.",
    indexLead:
      "One report for every complete month, newest first. Each has a permanent address and can be cited.",
    indexSection: "All reports",
    indexColumns: ["Month", "Renewable share", "Carbon intensity (g/kWh)", "Generation"],
    linkText: "Monthly reports: electricity in Croatia and the region",
    latestLink: (name) => `Latest monthly report: ${name}`,
    title: (name) => `Electricity in Croatia and the region: ${name}`,
    description: (name) =>
      `Monthly report (${name}): electricity generation by source, the renewable share and carbon intensity in Croatia, compared with the previous month, the same month a year earlier and the neighbouring countries, from ENTSO-E data.`,
    lead: (opening, share, comparisons, co2) =>
      `${opening} renewable sources provided ${share} of Croatia's electricity${comparisons.length > 0 ? ` (${comparisons.join(", ")})` : ""}${co2 ? `, with a carbon intensity of about ${co2} g/kWh` : ""}.`,
    totals: (total, load) => `Total generation: ${total}${load ? `; consumption (grid load): ${load}` : ""}.`,
    brief: {
      heading: "In brief",
      main: (source, share) => `Croatia's main source of electricity: ${source} (${share} of generation).`,
      renewable: (share, yearAgo) =>
        `Renewables gave ${share} of generation${yearAgo ? ` (the same month a year earlier: ${yearAgo})` : ""}.`,
      co2: (grams) =>
        `CO₂ intensity of generation: about ${grams} g/kWh (calculated from IPCC factors, not measured).`,
      top: (country, share) => `Highest renewable share in the region: ${country} (${share}).`,
      free: (days, hours, lowest) =>
        `The day-ahead exchange price was zero or below ${days}, ${hours} in all; the lowest was ${lowest} €/MWh. It is the wholesale price; a household bill does not follow it.`,
      neverFree: (lowest) =>
        `The day-ahead exchange price never fell to zero; the lowest hour was ${lowest} €/MWh.`,
      storage: (full, day, yearAgo, source) =>
        `Croatia's gas storage was ${full} full at the end of the month (${day})${yearAgo ? `; a year earlier ${yearAgo}` : ""}. Source: ${source}.`,
      share: "Free to share with the source named: gridatlas.eu.",
    },
    comparison: (name, share) => `${name}: ${share}`,
    sources: {
      heading: "Generation by source",
      columns: (month, previous, yearAgo) => ["Source", month, "Share", previous, yearAgo],
      total: "Total",
      renewable: "From renewable sources",
      share: "Renewable share",
      co2: "Carbon intensity (g/kWh)",
      load: "Consumption (grid load)",
      note: "Renewable: hydro, wind, solar, biomass and geothermal; pumped storage is not counted, as it returns electricity it consumed. A month without complete data stays empty.",
    },
    region: {
      heading: (name) => `The region: ${name}`,
      columns: ["Country", "Generation", "Renewable share", "Carbon intensity (g/kWh)", "Largest source"],
      note: "Only countries with complete data for the month, by renewable share.",
      missing: (names) => `Without complete data: ${names}.`,
    },
    hep: {
      heading: "Free capacity in the distribution grid (HEP ODS)",
      sentence: (published, dataDate, free, total) =>
        `On ${published}, HEP ODS published new figures (as of ${dataDate}): ${free} of ${total} have free capacity for new connections.`,
      link: "Capacity by substation",
    },
    official: {
      heading: "Official yearly share (Eurostat)",
      sentence: (year, share, target) =>
        `Croatia's latest official renewable share of gross final energy consumption (Eurostat, ${year}): ${share}; 2030 target: ${target}. It covers all energy, not only electricity, so it cannot be compared with the monthly share above.`,
    },
    method: {
      heading: "Sources and methodology",
      items: [
        "Generation and consumption: ENTSO-E Transparency Platform (actual generation by source and grid load), monthly totals in Croatian time.",
        "A month is shown once at least 98% of it has been reported. ENTSO-E corrects data afterwards, so the figures may still change slightly.",
        "Carbon intensity: lifecycle emission factors (IPCC AR5), as on the energy transition page; imports are not counted.",
        "No projections or estimates: only totals, shares and comparisons.",
      ],
    },
    nav: {
      heading: "Other reports",
      previous: (name) => `Previous: ${name}`,
      next: (name) => `Next: ${name}`,
    },
    variables: [
      "electricity generation by source",
      "renewable share of electricity generation",
      "carbon intensity of electricity generation",
      "electricity consumption (grid load)",
    ],
  },
};

/**
 * "na 6 dana" / "u 17 sati" / "on 6 days" / "17 hours": a count with its noun in the case the sentence
 * needs. Croatian: 1 (but not 11) takes the singular, 2 to 4 (but not 12 to 14) their own form, the rest
 * the genitive plural.
 */
export function countOf(lang: Lang, unit: "day" | "hour", count: number): string {
  const number = new Intl.NumberFormat(lang === "hr" ? "hr-HR" : "en-GB").format(count);
  if (lang === "en") {
    const noun = unit === "day" ? (count === 1 ? "day" : "days") : count === 1 ? "hour" : "hours";
    return unit === "day" ? `on ${number} ${noun}` : `${number} ${noun}`;
  }
  const last = count % 10;
  const teens = count % 100 >= 11 && count % 100 <= 14;
  const form = !teens && last === 1 ? 0 : !teens && last >= 2 && last <= 4 ? 1 : 2;
  // "u 1 danu", "u 2 dana", "u 5 dana"; "1 sat", "2 sata", "5 sati"
  const noun =
    unit === "day" ? (["danu", "dana", "dana"] as const)[form] : (["sat", "sata", "sati"] as const)[form];
  return unit === "day" ? `u ${number} ${noun}` : `${number} ${noun}`;
}
