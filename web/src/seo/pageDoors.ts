/**
 * Where a static page leads (zahtjev vlasnika 2026-11-17: the pages should look like part of the map and send
 * the reader on to it). Each door is a card under the page's lead: what it opens and what will be seen there.
 * The words live here, next to the links they describe, in both languages.
 */
import {
  Building2,
  GraduationCap,
  House,
  Map as MapIcon,
  Rss,
  Sun,
  Zap,
  type LucideIcon,
} from "lucide-react";
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
  house: icon(House),
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

/** The zoom the map opens at for the house: the town and its surroundings, with the sun's colours readable. */
const HOME_ZOOM = 10;

/**
 * The map's address that opens the solar layer's reading on a place, with the roof calculator and the house
 * under it (panels/HomeFlow.tsx): the view goes to the place and `sun` says where the reading is taken.
 */
export function homeLink(lang: Lang, place: { lat: number; lng: number }): string {
  const at = `${place.lat.toFixed(4)},${place.lng.toFixed(4)}`;
  return mapLink(lang, { l: "lines,solar", v: `${at},${String(HOME_ZOOM)}`, sun: at });
}

/** The place the house's door opens on: a door needs one, and Zagreb is the example the learning corner uses. */
const HOME_EXAMPLE = { lat: 45.815, lng: 15.9819 };

export const homeDoor = (lang: Lang): Door =>
  door(
    {
      hr: [
        "Kuća s panelima: kamo ide struja",
        "primjer za Zagreb, sat po sat: što daju paneli, što troši kuća, što ide u mrežu ili u bateriju",
      ],
      en: [
        "A house with panels: where the electricity goes",
        "an example for Zagreb, hour by hour: what the panels give, what the house uses, what goes to the grid or a battery",
      ],
    },
    lang,
    homeLink(lang, HOME_EXAMPLE),
    ICONS.house,
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
