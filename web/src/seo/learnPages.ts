/**
 * The learning corner (Faza 35-1): how electricity gets from a plant to a socket, the words the map uses,
 * and links that open the map on what each paragraph describes. Written for someone who has never looked
 * at a grid map; nothing here depends on a data release except the date in the footer.
 */
import type { Lang } from "../state/url";
import { STORIES, STORY_KEYS } from "../stories/stories";
import { definitions, e, list } from "./markup";
import { home, mapLink, other, PATHS, type SiteData, type StaticPage } from "./site";

interface LearnCopy {
  title: string;
  description: string;
  lead: string[];
  journeyHeading: string;
  journey: string[];
  unitsHeading: string;
  units: string[];
  termsHeading: string;
  /** term, explanation */
  terms: [string, string][];
  storiesHeading: string;
  storiesIntro: string;
  tryHeading: string;
  tryIntro: string;
  /** link text, what the reader will see, the map's address parameters */
  tries: [string, string, Record<string, string>][];
}

export const LEARN_COPY: Record<Lang, LearnCopy> = {
  hr: {
    title: "Edukacijski kutak: kako radi elektroenergetski sustav",
    description:
      "Kako struja putuje od elektrane do utičnice, što znače MW, MWh i kV, što su dalekovod, trafostanica i interkonektor, i kako sve to pronaći na Regionalnoj energetskoj karti.",
    lead: [
      "Struja se ne može spremiti u skladište kao roba: u svakom trenutku mora se proizvesti točno onoliko koliko se troši. Zato je elektroenergetski sustav jedan veliki, stalno uravnoteženi stroj koji se proteže preko cijelog kontinenta.",
      "Ovdje su u nekoliko minuta čitanja objašnjeni njegovi glavni dijelovi i riječi koje karta koristi. Uz svako objašnjenje je poveznica koja otvara kartu baš na tome.",
    ],
    journeyHeading: "Put struje u četiri koraka",
    journey: [
      "Proizvodnja. Elektrana pretvara neku drugu energiju u električnu: pad vode, toplinu izgaranja ili nuklearne reakcije, vjetar ili sunčevu svjetlost.",
      "Prijenos. Uz elektranu se napon podiže na 110, 220 ili 400 kilovolta i struja kreće dalekovodima. Visoki napon služi tome da se na velikim udaljenostima izgubi što manje energije.",
      "Pretvorba. U trafostanicama se napon postupno spušta, a vodovi se spajaju u mrežu, tako da struja do istog mjesta može doći s više strana.",
      "Distribucija. Vodovi nižeg napona (35, 20 i 10 kilovolta, na kraju 0,4) dovode struju do naselja, tvrtki i kućanstava.",
    ],
    unitsHeading: "Snaga i energija: MW nije MWh",
    units: [
      "Snaga (megavat, MW) kaže koliko elektrana može proizvoditi u jednom trenutku. To je kao brzina automobila.",
      "Energija (megavatsat, MWh) kaže koliko je proizvedeno ili potrošeno kroz neko vrijeme. To je kao prijeđeni put.",
      "Primjer: elektrana od 100 MW koja deset sati radi punom snagom proizvede 1000 MWh.",
      "Na karti uz elektranu piše instalirana snaga, a na stranici „Proizvodnja kroz vrijeme” energija po satima, danima i mjesecima.",
    ],
    termsHeading: "Pojmovnik",
    terms: [
      [
        "Instalirana snaga",
        "Najveća snaga za koju je elektrana izgrađena. Stvarna proizvodnja je gotovo uvijek manja: sunce ne sija noću, vjetar ne puše stalno, a hidroelektrana ovisi o dotoku vode.",
      ],
      [
        "Napon (kV)",
        "„Tlak” koji gura struju kroz vod, u kilovoltima. Za istu snagu viši napon znači manju struju, a time i manje gubitke u vodu. Zato se na daljinu prenosi na 400 i 220 kV.",
      ],
      ["Dalekovod", "Nadzemni vod visokog napona na stupovima. Na karti je boja voda njegov napon."],
      [
        "Prijenosna mreža",
        "Vodovi od 110 kV naviše koji povezuju elektrane, velike trafostanice i susjedne zemlje. U Hrvatskoj je vodi Hrvatski operator prijenosnog sustava (HOPS).",
      ],
      [
        "Distribucijska mreža",
        "Vodovi nižeg napona koji struju dovode do krajnjih korisnika. U Hrvatskoj je vodi HEP Operator distribucijskog sustava (HEP ODS).",
      ],
      [
        "Trafostanica",
        "Mjesto gdje se napon podiže ili spušta i gdje se vodovi spajaju i prekapčaju. Čvorišta mreže.",
      ],
      [
        "Interkonektor",
        "Vod koji prelazi državnu granicu i spaja dva sustava. Preko njih zemlje jedna drugoj prodaju struju i pomažu si kad nekome ponestane.",
      ],
      [
        "Operator prijenosnog sustava",
        "Tvrtka koja vodi prijenosnu mrežu i iz sekunde u sekundu usklađuje proizvodnju s potrošnjom.",
      ],
      [
        "Frekvencija (50 Hz)",
        "Znak ravnoteže sustava: kad se troši više nego što se proizvodi, frekvencija pada, i obrnuto. Kontinentalna Europa radi kao jedan sinkroni sustav na 50 herca.",
      ],
      [
        "Reverzibilna hidroelektrana",
        "Hidroelektrana koja, kad je struje viška, pumpa vodu u gornje jezero, a kad je manjka, tu vodu pušta kroz turbine. Najveća „baterija” koju sustav danas ima.",
      ],
      [
        "Obnovljivi izvori",
        "Izvori koji se sami obnavljaju: voda, sunce, vjetar, biomasa i toplina Zemlje (geotermalna energija).",
      ],
      [
        "Cijena dan unaprijed",
        "Cijena struje postignuta na burzi za svaki sat sljedećeg dana, u eurima po megavatsatu. Mijenja se iz sata u sat, ovisno o potrošnji, vjetru, suncu i dotoku vode.",
      ],
      [
        "Slobodni kapacitet mreže",
        "Koliko se nove snage još može priključiti na pojedinu trafostanicu, prema podacima operatora distribucijskog sustava. Važno svakome tko planira elektranu.",
      ],
    ],
    storiesHeading: "Vođene priče na karti",
    storiesIntro:
      "Priča vas vodi kroz kartu korak po korak: karta se sama pomiče i pokazuje ono o čemu čitate. Traje minutu ili dvije i možete je prekinuti kad god želite.",
    tryHeading: "Isprobajte na karti",
    tryIntro: "Svaka poveznica otvara kartu s uključenim upravo onim o čemu je riječ:",
    tries: [
      [
        "Prijenosna mreža i trafostanice",
        "vodovi obojeni po naponu i čvorišta u kojima se spajaju",
        { l: "lines,substations" },
      ],
      ["Elektrane", "boja je tehnologija, veličina kruga snaga", { l: "lines,plants" }],
      [
        "Tokovi preko granica i cijene, uživo",
        "kamo struja upravo teče i koliko stoji u kojoj zemlji",
        { live: "1" },
      ],
      [
        "Slobodni kapacitet mreže",
        "trafostanice HEP ODS-a: zeleno ima mjesta, crveno nema",
        { l: "lines,capacity" },
      ],
      ["Punionice za električna vozila", "koliko ih je na kojem području", { l: "lines,chargers" }],
    ],
  },
  en: {
    title: "Learning corner: how the power system works",
    description:
      "How electricity gets from a plant to a socket, what MW, MWh and kV mean, what a transmission line, a substation and an interconnector are, and how to find them all on the Regional Energy Map.",
    lead: [
      "Electricity cannot be kept in a warehouse like goods: at every moment exactly as much has to be generated as is being used. That makes the power system one large, constantly balanced machine that spans a whole continent.",
      "A few minutes of reading here explain its main parts and the words the map uses. Each explanation comes with a link that opens the map on exactly that.",
    ],
    journeyHeading: "The journey of electricity in four steps",
    journey: [
      "Generation. A power plant turns some other energy into electricity: falling water, the heat of combustion or of a nuclear reaction, wind or sunlight.",
      "Transmission. At the plant the voltage is raised to 110, 220 or 400 kilovolts and the electricity sets off along transmission lines. High voltage keeps the losses small over long distances.",
      "Transformation. In substations the voltage is lowered step by step and the lines are joined into a network, so electricity can reach the same place from several sides.",
      "Distribution. Lower-voltage lines (35, 20 and 10 kilovolts, and finally 0.4) bring electricity to towns, businesses and homes.",
    ],
    unitsHeading: "Power and energy: a MW is not a MWh",
    units: [
      "Power (megawatt, MW) says how much a plant can generate at one moment. It is like the speed of a car.",
      "Energy (megawatt-hour, MWh) says how much was generated or used over some time. It is like the distance travelled.",
      "An example: a 100 MW plant running at full power for ten hours generates 1,000 MWh.",
      "On the map a plant carries its installed power; the “Generation over time” page shows energy by hour, day and month.",
    ],
    termsHeading: "Glossary",
    terms: [
      [
        "Installed capacity",
        "The greatest power a plant is built for. What it actually generates is almost always less: the sun does not shine at night, the wind does not always blow, and a hydro plant depends on how much water arrives.",
      ],
      [
        "Voltage (kV)",
        "The “pressure” that pushes electricity through a line, in kilovolts. For the same power a higher voltage means a smaller current and so smaller losses in the line. That is why long distances are covered at 400 and 220 kV.",
      ],
      [
        "Transmission line",
        "An overhead high-voltage line on towers. On the map a line's colour is its voltage.",
      ],
      [
        "Transmission grid",
        "Lines of 110 kV and above that connect plants, large substations and neighbouring countries. In Croatia it is run by the Croatian Transmission System Operator (HOPS).",
      ],
      [
        "Distribution grid",
        "Lower-voltage lines that bring electricity to end users. In Croatia it is run by HEP Distribution System Operator (HEP ODS).",
      ],
      [
        "Substation",
        "A place where the voltage is raised or lowered and where lines are joined and switched. The nodes of the grid.",
      ],
      [
        "Interconnector",
        "A line that crosses a national border and joins two systems. Through them countries sell electricity to each other and help out when one runs short.",
      ],
      [
        "Transmission system operator",
        "The company that runs the transmission grid and matches generation to demand from second to second.",
      ],
      [
        "Frequency (50 Hz)",
        "The sign of the system's balance: when more is used than generated the frequency falls, and the other way round. Continental Europe runs as one synchronous system at 50 hertz.",
      ],
      [
        "Pumped-storage hydro plant",
        "A hydro plant that pumps water to an upper reservoir when there is too much electricity and lets it back through the turbines when there is too little. The largest “battery” the system has today.",
      ],
      [
        "Renewable sources",
        "Sources that renew themselves: water, sun, wind, biomass and the heat of the Earth (geothermal energy).",
      ],
      [
        "Day-ahead price",
        "The price of electricity reached on the exchange for each hour of the next day, in euros per megawatt-hour. It changes from hour to hour with demand, wind, sun and water.",
      ],
      [
        "Free grid capacity",
        "How much new power can still be connected at a given substation, according to the distribution system operator. It matters to anyone planning a plant.",
      ],
    ],
    storiesHeading: "Guided stories on the map",
    storiesIntro:
      "A story takes you through the map step by step: the map moves by itself and shows what you are reading about. It takes a minute or two and you can stop whenever you like.",
    tryHeading: "Try it on the map",
    tryIntro: "Each link opens the map with exactly what it describes switched on:",
    tries: [
      [
        "The transmission grid and substations",
        "lines coloured by voltage and the nodes where they meet",
        { l: "lines,substations" },
      ],
      ["Power plants", "colour is the technology, the size of the disc the power", { l: "lines,plants" }],
      [
        "Cross-border flows and prices, live",
        "where electricity is flowing right now and what it costs in each country",
        { live: "1" },
      ],
      ["Free grid capacity", "HEP ODS substations: green has room, red has none", { l: "lines,capacity" }],
      ["Electric vehicle charging stations", "how many there are in each area", { l: "lines,chargers" }],
    ],
  },
};

export function learnPage(site: SiteData, lang: Lang): StaticPage {
  const copy = LEARN_COPY[lang];
  const stories = STORY_KEYS.filter(
    (key) => STORIES[key].route === undefined || site.current.routes !== undefined,
  ).map(
    (key) =>
      `<a href="${e(mapLink(lang, { story: key }))}">${e(STORIES[key].title[lang])}</a>: ${e(STORIES[key].summary[lang])}`,
  );
  const tries = copy.tries.map(
    ([text, what, params]) => `<a href="${e(mapLink(lang, params))}">${e(text)}</a>: ${e(what)}`,
  );
  return {
    path: PATHS[lang].learn,
    lang,
    alternatePath: PATHS[other(lang)].learn,
    title: copy.title,
    description: copy.description,
    heading: copy.title,
    lead: copy.lead.map((p) => `<p>${e(p)}</p>`).join(""),
    sections: [
      { heading: copy.storiesHeading, html: `<p>${e(copy.storiesIntro)}</p>${list(stories)}` },
      {
        heading: copy.journeyHeading,
        html: `<ol>${copy.journey.map((step) => `<li>${e(step)}</li>`).join("")}</ol>`,
      },
      { heading: copy.unitsHeading, html: list(copy.units.map(e)) },
      { heading: copy.termsHeading, html: definitions(copy.terms.map(([term, text]) => [term, e(text)])) },
      { heading: copy.tryHeading, html: `<p>${e(copy.tryIntro)}</p>${list(tries)}` },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "DefinedTermSet",
        name: copy.termsHeading,
        inLanguage: lang,
        hasDefinedTerm: copy.terms.map(([term, text]) => ({
          "@type": "DefinedTerm",
          name: term,
          description: text,
        })),
      },
    ],
    lastModified: site.current.createdAt,
    breadcrumbs: [home(lang)],
  };
}
