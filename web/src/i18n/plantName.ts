/**
 * A plant's name in the page's language (plan: "Imena elektrana na hrvatskom"). About 2200 plants known only to
 * Global Energy Monitor carry an English name made of the plant's own name and a description of its kind:
 * "Senj II hydroelectric plant", "Apelovac solar farm". On the Croatian page the description becomes the kind
 * in Croatian, in front, as Croatian names go: "Hidroelektrana Senj II". The plant's own name is never touched,
 * and the kind comes from the record's technology, not from the English words. A name without such a
 * description is left as it is, and so is every name on the English page.
 */
import type { Technology } from "../domain";
import type { Lang } from "../state/url";

/** The kind of plant as the start of a Croatian name. */
const KIND_HR: Record<Technology, string> = {
  hydro: "Hidroelektrana",
  pumped_storage: "Reverzibilna hidroelektrana",
  solar: "Sunčana elektrana",
  wind: "Vjetroelektrana",
  nuclear: "Nuklearna elektrana",
  gas: "Plinska elektrana",
  coal: "Elektrana na ugljen",
  lignite: "Elektrana na lignit",
  oil: "Elektrana na naftu",
  biomass: "Elektrana na biomasu",
  geothermal: "Geotermalna elektrana",
  battery: "Baterijski spremnik",
  other: "Elektrana",
};

/** English words before the description that say what the technology already says: dropped. */
const REDUNDANT =
  "pumped[- ]storage|onshore|gas|coal|lignite|oil|nuclear|biomass|geothermal|thermal|chp|combined[- ]cycle|ccgt|run[- ]of[- ]river|hydro";
/** English words before the description that say something the technology does not: said in Croatian. */
const SAID: Record<string, string> = { floating: "Plutajuća", offshore: "Pučinska" };

const DESCRIPTION = new RegExp(
  String.raw`^(.+?)((?:\s+(?:${REDUNDANT}|floating|offshore))*)\s+(?:hydroelectric plant|hydro ?power plant|power plant|power station|solar farm|solar plant|solar park|pv plant|wind farm|wind park)(\s+(?:[IVX]+|\d+))?$`,
  "i",
);

export function plantName(name: string, technology: Technology, lang: Lang): string {
  if (lang !== "hr") return name;
  const match = DESCRIPTION.exec(name.trim());
  if (!match) return name;
  const [, own = "", before = "", number = ""] = match;
  const said = before
    .trim()
    .split(/\s+/)
    .map((word) => SAID[word.toLowerCase()])
    .filter((word): word is string => word !== undefined);
  const kind = KIND_HR[technology];
  const start = said.length > 0 ? `${said.join(" ")} ${kind.charAt(0).toLowerCase()}${kind.slice(1)}` : kind;
  return `${start} ${own.trim()}${number}`;
}
