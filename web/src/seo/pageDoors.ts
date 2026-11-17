/**
 * Where a static page leads (zahtjev vlasnika 2026-11-17: the pages should look like part of the map and send
 * the reader on to it). Each door is a card under the page's lead: what it opens and what will be seen there.
 * The words live here, next to the links they describe, in both languages.
 */
import { Building2, GraduationCap, Map as MapIcon, Rss, Sun, Zap, type LucideIcon } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Lang } from "../state/url";
import type { Door } from "./markup";
import { mapLink, PATHS } from "./site";

/** Decoration before a card's title: the same icon family as the map's header, inline. */
export const icon = (Icon: LucideIcon, size = 18): string =>
  renderToStaticMarkup(createElement(Icon, { size, strokeWidth: 1.75, "aria-hidden": true }));

const ICONS = {
  map: icon(MapIcon),
  learn: icon(GraduationCap),
  cities: icon(Building2),
  capacity: icon(Zap),
  sun: icon(Sun),
  feed: icon(Rss),
};

type Words = Record<Lang, [title: string, text: string]>;
const door = (words: Words, lang: Lang, href: string, picture: string): Door => ({
  href,
  title: words[lang][0],
  text: words[lang][1],
  icon: picture,
});

export const mapDoor = (lang: Lang): Door =>
  door(
    {
      hr: ["Otvori kartu", "elektrane, mreža, tokovi i cijene po satu, za osam zemalja"],
      en: ["Open the map", "plants, the grid, hourly flows and prices, for eight countries"],
    },
    lang,
    mapLink(lang, {}),
    ICONS.map,
  );

export const learnDoor = (lang: Lang): Door =>
  door(
    {
      hr: ["Edukacija", "kako elektroenergetski sustav radi, u nekoliko minuta i s vođenim pričama"],
      en: ["Learn", "how the power system works, in a few minutes and with guided stories"],
    },
    lang,
    PATHS[lang].learn,
    ICONS.learn,
  );

export const citiesDoor = (lang: Lang): Door =>
  door(
    {
      hr: ["Gradovi na karti", "krug po gradu: potrošnja struje kako su je gradovi sami prijavili"],
      en: ["Cities on the map", "a disc per city: electricity use as the cities reported it themselves"],
    },
    lang,
    mapLink(lang, { l: "lines,cities" }),
    ICONS.cities,
  );

export const capacityDoor = (lang: Lang): Door =>
  door(
    {
      hr: ["Slobodni kapacitet na karti", "trafostanice HEP ODS-a u boji: zeleno ima mjesta, crveno nema"],
      en: ["Free capacity on the map", "HEP ODS substations by colour: green has room, red has none"],
    },
    lang,
    mapLink(lang, { l: "lines,capacity" }),
    ICONS.capacity,
  );

export const solarDoor = (lang: Lang): Door =>
  door(
    {
      hr: [
        "Sunce i najbliža trafostanica",
        "kliknite mjesto: prinos, koliko panela treba i gdje je priključak",
      ],
      en: [
        "The sun and the nearest substation",
        "click a place: its yield, the panels it takes and where to connect",
      ],
    },
    lang,
    mapLink(lang, { l: "lines,solar" }),
    ICONS.sun,
  );

/** The open JSON of one country, as a first address to try; the path is the site's own. */
export const countryJsonDoor = (lang: Lang): Door =>
  door(
    {
      hr: [
        "Isprobaj: Hrvatska kao JSON",
        "snaga po tehnologiji, najveće elektrane i izvori, u jednom odgovoru",
      ],
      en: [
        "Try it: Croatia as JSON",
        "capacity by technology, the largest plants and the sources, in one answer",
      ],
    },
    lang,
    "/api/zemlja/hr.json",
    ICONS.feed,
  );
