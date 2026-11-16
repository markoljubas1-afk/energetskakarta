/**
 * How to cite a chart or a page of the map (Faza 23-3): APA 7, a line for a newsroom ("Izvor: …") and BibTeX,
 * in Croatian or English. Pure, so the static pages (prerender, Node) and the charts (browser) say the same.
 */
import type { Lang } from "../state/url";

export interface CiteInput {
  lang: Lang;
  /** the site's name in that language ("GridAtlas") */
  site: string;
  /** what is cited: a chart ("Proizvodnja po izvoru i potrošnja: Hrvatska, mjesečno") or a page's title */
  title: string;
  url: string;
  /** where the numbers come from, e.g. ["ENTSO-E Transparency Platform"]; may be empty */
  sources: readonly string[];
  /** when the data were last updated (ISO date or date-time), if known */
  dataDate: string | null;
  /** when the reader looked; the static pages, built ahead of time, cite without it */
  accessed: Date | null;
}

export interface Citations {
  apa: string;
  /** one line to put under a published chart or quote */
  text: string;
  bibtex: string;
}

/** APA is American: its English dates read "November 15, 2026". */
const LOCALE: Record<Lang, string> = { hr: "hr-HR", en: "en-US" };

const COPY = {
  hr: {
    dataSet: "Skup podataka",
    noDate: "b. d.",
    retrieved: (date: string, url: string) => `Preuzeto ${date} s ${url}`,
    source: "Izvor",
    basedOn: "prema podacima",
    asOf: "stanje",
    accessedNote: "pristupljeno",
    dataNote: "podaci",
  },
  en: {
    dataSet: "Data set",
    noDate: "n.d.",
    retrieved: (date: string, url: string) => `Retrieved ${date}, from ${url}`,
    source: "Source",
    basedOn: "based on data from",
    asOf: "as of",
    accessedNote: "accessed",
    dataNote: "data",
  },
} as const;

/** A date in the reader's language: "15. studenoga 2026." / "November 15, 2026"; parts as APA wants them. */
function dateParts(lang: Lang, date: Date): { full: string; dayMonth: string; year: number } {
  const zone = { timeZone: "Europe/Zagreb" } as const;
  return {
    full: new Intl.DateTimeFormat(LOCALE[lang], {
      ...zone,
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date),
    dayMonth: new Intl.DateTimeFormat(LOCALE[lang], { ...zone, day: "numeric", month: "long" }).format(date),
    year: Number(new Intl.DateTimeFormat("en", { ...zone, year: "numeric" }).format(date)),
  };
}

/** The host for a reader ("gridatlas.eu"); a relative address stays as it is. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url; // a path (no site address configured): nothing better to show
  }
}

/** TeX's special characters in a BibTeX value; the URL goes inside \url{} and is left alone. */
const tex = (value: string): string =>
  value.replace(/[\\{}&%$#_^~]/g, (c) => (c === "\\" ? "\\textbackslash{}" : `\\${c}`));

const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

export function citations(input: CiteInput): Citations {
  const { lang, site, title, url, sources, dataDate, accessed } = input;
  const copy = COPY[lang];
  const data = dataDate ? dateParts(lang, new Date(dataDate)) : null;
  const seen = accessed ? dateParts(lang, accessed) : null;
  const year = data?.year ?? seen?.year ?? null;

  // APA 7, group author, a changing data set: the date of the data, and the date it was retrieved
  const when = data ? `${String(data.year)}, ${data.dayMonth}` : year === null ? copy.noDate : String(year);
  // no full stop after the URL, as APA asks
  const apa = [
    `${sentence(site)} (${when}).`,
    sentence(`${title} [${copy.dataSet}]`),
    seen ? copy.retrieved(seen.full, url) : url,
  ].join(" ");

  const parts = [`${copy.source}: ${site} (${hostOf(url)})`];
  if (sources.length > 0) parts.push(`${copy.basedOn} ${sources.join(", ")}`);
  const text = sentence(parts.join(", ") + (data ? `; ${copy.asOf} ${data.full}` : ""));

  const notes = [
    ...(sources.length > 0 ? [`${copy.dataNote}: ${sources.join(", ")}`] : []),
    ...(data ? [`${copy.asOf} ${data.full}`] : []),
    ...(accessed ? [`${copy.accessedNote} ${accessed.toISOString().slice(0, 10)}`] : []),
  ];
  const fields = [
    `  author = {{${tex(site)}}}`,
    `  title = {${tex(title)}}`,
    ...(year ? [`  year = {${String(year)}}`] : []),
    `  howpublished = {\\url{${url}}}`,
    ...(notes.length > 0 ? [`  note = {${tex(notes.join("; "))}}`] : []),
  ];
  const key = `energetskakarta${year ? String(year) : ""}`;
  const bibtex = `@misc{${key},\n${fields.join(",\n")}\n}`;

  return { apa, text, bibtex };
}
