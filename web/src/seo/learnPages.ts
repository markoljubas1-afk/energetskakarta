/**
 * The learning corner (Faza 35-1): how electricity gets from a plant to a socket, the words the map uses,
 * and links that open the map on what each paragraph describes. Written for someone who has never looked
 * at a grid map; nothing here depends on a data release except the date in the footer.
 */
import { ArrowLeftRight, Factory, Map as MapIcon, Route, Sun, Zap, type LucideIcon } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TIME_MACHINE_START, type Lang } from "../state/url";
import type { StoryKey } from "../stories/keys";
import { STORIES, STORY_KEYS } from "../stories/stories";
import { callout, doors, e, glossary, list, type Door } from "./markup";
import { home, mapLink, other, PATHS, type SiteData, type StaticPage } from "./site";

interface LearnCopy {
  title: string;
  description: string;
  lead: string[];
  journeyHeading: string;
  journey: string[];
  unitsHeading: string;
  units: string[];
  solarHeading: string;
  solar: string[];
  solarTry: string;
  solarTryNote: string;
  /** the call-out that sends a reader with a roof of their own to the exact calculation */
  roof: string;
  roofAction: string;
  /** what a story card does */
  storyStart: string;
  timingHeading: string;
  /** the live box: its words, with `{slot}` where the script writes a figure (widgets/learnLive.ts) */
  now: {
    title: string;
    share: string;
    price: string;
    free: string;
    stale: string;
    times: string;
    part: string;
    source: string;
  };
  /** why a wholesale price can fall below zero, and the link that opens the prices on the map */
  priceHeading: string;
  price: string[];
  priceTry: [string, string];
  timing: string[];
  termsHeading: string;
  /** term, explanation */
  terms: [string, string][];
  storiesHeading: string;
  storiesIntro: string;
  tryHeading: string;
  /** the time machine's link: text and what it shows; offered when the build has a timeline */
  timeTry: [string, string];
  tryIntro: string;
  /** link text, what the reader will see, the map's address parameters */
  tries: [string, string, Record<string, string>][];
}

export const LEARN_COPY: Record<Lang, LearnCopy> = {
  hr: {
    title: "Edukacijski kutak: kako radi elektroenergetski sustav",
    description:
      "Kako struja putuje od elektrane do utičnice, što znače MW, MWh i kV, što su dalekovod, trafostanica i interkonektor, i kako sve to pronaći na GridAtlasu.",
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
    solarHeading: "Sunčana energija u pet rečenica",
    solar: [
      "Sunčani panel pretvara svjetlost izravno u struju. Njegova snaga piše se u kilovatima „u vrhu” (kWp): toliko daje pod punim suncem, okomito na zrake, pri 25 °C.",
      "Koliko struje to znači u godini, ovisi o mjestu. U našoj regiji jedan kWp daje otprilike između 1000 i 1600 kWh godišnje: najmanje u Alpama, najviše na jugu Italije; u Zagrebu oko 1250, u Dalmaciji oko 1450.",
      "Kućanstvo u Hrvatskoj troši reda veličine 3000 do 4000 kWh struje godišnje, pa bi mu za godišnju količinu trebalo otprilike 3 kWp panela, to jest sedam do osam današnjih panela na krovu.",
      "Sunce daje najviše ljeti i oko podneva, a troši se najviše zimi i navečer. Zato sunčana energija treba mrežu, hidroelektrane i baterije koje premošćuju razliku.",
      "Brojke na karti su dugogodišnji prosjek modela Global Solar Atlasa. Za konkretan krov ili zemljište treba proračun koji uzima u obzir nagib, orijentaciju i zasjenjenje; besplatan je, na primjer, europski PVGIS.",
    ],
    solarTry: "Sunčani potencijal na karti",
    solarTryNote: "kliknite na svoje mjesto i pročitajte očekivanu godišnju proizvodnju",
    roof: "Imate krov? Besplatni europski kalkulator PVGIS računa koliko bi baš on dao, uz nagib, orijentaciju i zasjenjenje.",
    roofAction: "Izračunaj za moj krov",
    storyStart: "Pokreni priču",
    now: {
      title: "Upravo sada u Hrvatskoj",
      share: "{share} % proizvodnje je iz obnovljivih izvora",
      price: "Cijena na burzi (dan unaprijed): {price} €/MWh",
      free: "Cijena je nula ili niža: tko sada uzme struju na burzi, ne plaća je.",
      stale: "Podatak je stariji od četiri sata, pa ne govori o ovom trenutku.",
      times:
        "Obnovljivi izvori daju {mw} MW: {times} puta više nego što sva kućanstva u zemlji troše u prosjeku ({average} MW, {year}.).",
      part: "Obnovljivi izvori daju {mw} MW: {percent} % onoga što sva kućanstva u zemlji troše u prosjeku ({average} MW, {year}.).",
      source:
        "Sat podatka: {hour}. Izvori: ENTSO-E (proizvodnja i cijena), Eurostat (potrošnja kućanstava). Udio je u domaćoj proizvodnji, bez uvoza; cijena je veleprodajna.",
    },
    priceHeading: "Zašto struja ponekad ima negativnu cijenu",
    price: [
      "Struja se na burzi prodaje dan unaprijed, za svaki sat posebno. Proizvođači nude koliko mogu dati i po kojoj cijeni, kupci koliko trebaju, i za svaki sat nastane jedna cijena na kojoj se ponuda i potražnja susretnu.",
      "Kad jako sja sunce ili puše vjetar, a troši se malo (sunčana nedjelja u proljeće), struje se nudi više nego što itko treba. Dio elektrana se ne može ili ne isplati ugasiti na nekoliko sati: nuklearka, toplana koja usput grije grad, protočna hidroelektrana kojoj voda ionako teče. One radije plate da ih netko riješi struje nego da stanu, i cijena padne na nulu ili ispod nje.",
      "Negativna cijena znači da prodavač plaća kupcu. To je veleprodajna cijena među tvrtkama: kućanstvo s običnom tarifom plaća isto u svakom satu i njegov račun ne postaje negativan. Korist imaju oni koji mogu birati kada troše ili spremati struju: reverzibilne hidroelektrane, baterije, punionice, industrija.",
      "Takvi sati su znak da sustavu treba više fleksibilnosti: spremnika, potrošnje koja se može pomaknuti i vodova prema susjedima koji u tom trenutku trebaju struju.",
    ],
    priceTry: [
      "Cijene po satu na karti",
      "boja zemlje je cijena; sati s cijenom nula ili nižom posebno su označeni",
    ],
    timingHeading: "Zašto je važno kada trošiš",
    timing: [
      "Struja se proizvodi u istom trenutku u kojem se troši. Kad usred sunčanog ili vjetrovitog dana uključite perilicu, veći dio te struje dolazi iz sunca i vjetra; u zimsku večer, kad svi kuhaju i griju se, više rade elektrane na plin i ugljen.",
      "Na karti, uz datum podataka, stoji točka u boji i postotak: udio obnovljivih izvora u onome što elektrane te zemlje proizvode ovaj sat. Zeleno je od 65 %, žuto od 35 %, ispod toga crveno.",
      "To je udio u domaćoj proizvodnji, prema podacima ENTSO-E-a. Ne govori o uvozu ni o cijeni koju plaća kućanstvo, pa je putokaz, a ne račun. Podatak stiže sat do dva nakon samog sata; ako je stariji od četiri sata, točka je siva.",
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
    timeTry: [
      "Vremeplov",
      "kako su elektrane u regiji građene i gašene kroz godine; pomičite godinu i gledajte kartu",
    ],
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
      "How electricity gets from a plant to a socket, what MW, MWh and kV mean, what a transmission line, a substation and an interconnector are, and how to find them all on GridAtlas.",
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
    solarHeading: "Solar energy in five sentences",
    solar: [
      "A solar panel turns light straight into electricity. Its power is stated in kilowatts “peak” (kWp): what it gives in full sun, square to the rays, at 25 °C.",
      "How much electricity that means in a year depends on the place. In our region one kWp gives roughly between 1,000 and 1,600 kWh a year: least in the Alps, most in the south of Italy; about 1,250 in Zagreb, about 1,450 in Dalmatia.",
      "A household in Croatia uses in the order of 3,000 to 4,000 kWh of electricity a year, so a year's worth would take about 3 kWp of panels, that is seven or eight of today's panels on a roof.",
      "The sun gives the most in summer and around noon, while the most is used in winter and in the evening. That is why solar energy needs the grid, hydro plants and batteries to bridge the difference.",
      "The figures on the map are the long-term average of the Global Solar Atlas's model. A particular roof or plot needs a calculation that takes tilt, orientation and shading into account; the European PVGIS, for one, is free.",
    ],
    solarTry: "Solar potential on the map",
    solarTryNote: "click your own place and read the expected yearly output",
    roof: "Have a roof? The free European calculator PVGIS works out what that very roof would give, with its tilt, orientation and shading.",
    roofAction: "Calculate for my roof",
    storyStart: "Start the story",
    now: {
      title: "Right now in Croatia",
      share: "{share}% of generation is from renewable sources",
      price: "Exchange price (day-ahead): {price} €/MWh",
      free: "The price is zero or below: whoever takes electricity on the exchange now does not pay for it.",
      stale: "The figure is more than four hours old, so it says nothing about this moment.",
      times:
        "Renewable sources give {mw} MW: {times} times what all the country's households use on average ({average} MW, {year}).",
      part: "Renewable sources give {mw} MW: {percent}% of what all the country's households use on average ({average} MW, {year}).",
      source:
        "Hour of the figure: {hour}. Sources: ENTSO-E (generation and price), Eurostat (household consumption). The share is of domestic generation, without imports; the price is wholesale.",
    },
    priceHeading: "Why electricity sometimes has a negative price",
    price: [
      "Electricity is sold on the exchange a day ahead, hour by hour. Generators offer what they can deliver and at what price, buyers what they need, and each hour gets one price at which supply and demand meet.",
      "When the sun shines hard or the wind blows while little is used (a sunny Sunday in spring), more electricity is on offer than anyone needs. Some plants cannot be switched off for a few hours, or it does not pay to: a nuclear plant, a plant that heats a town as it generates, a run-of-river hydro plant whose water flows anyway. They would rather pay to be rid of their electricity than stop, and the price falls to zero or below.",
      "A negative price means the seller pays the buyer. It is a wholesale price between companies: a household on an ordinary tariff pays the same in every hour and its bill does not turn negative. Those who can choose when to use electricity, or store it, gain: pumped-storage plants, batteries, charging stations, industry.",
      "Such hours are a sign that the system needs more flexibility: storage, demand that can be moved, and lines to neighbours who need electricity at that moment.",
    ],
    priceTry: [
      "Hourly prices on the map",
      "a country's colour is its price; hours with a price of zero or below are marked",
    ],
    timingHeading: "Why it matters when you use it",
    timing: [
      "Electricity is generated at the very moment it is used. When you start the washing machine in the middle of a sunny or windy day, more of that electricity comes from sun and wind; on a winter evening, when everyone is cooking and heating, gas and coal plants work harder.",
      "On the map, next to the date of the data, there is a coloured dot and a percentage: the share of renewable sources in what that country's plants are generating this hour. Green from 65 %, amber from 35 %, red below that.",
      "It is the share of domestic generation, from ENTSO-E's figures. It says nothing about imports or about the price a household pays, so it is a signpost, not a bill. The figure arrives an hour or two after the hour itself; when it is more than four hours old the dot is grey.",
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
    timeTry: [
      "Time machine",
      "how the region's power plants were built and closed over the years; move the year and watch the map",
    ],
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

/** Decoration before a card's title: the same icon family as the map's header, inline. */
const icon = (Icon: LucideIcon, size = 18): string =>
  renderToStaticMarkup(createElement(Icon, { size, strokeWidth: 1.75, "aria-hidden": true }));
const STORY_ICONS: Record<StoryKey, string> = {
  "put-struje": icon(Route),
  kilovatsat: icon(Zap),
  sunce: icon(Sun),
  "odakle-struja": icon(Factory),
  granice: icon(ArrowLeftRight),
};
const MAP_ICON = icon(MapIcon);
const SUN_ICON = icon(Sun, 22);
/** The European Commission's free calculator for a particular roof (the same link the map's solar bar gives). */
const PVGIS_URL = "https://re.jrc.ec.europa.eu/pvg_tools/en/";

/** The words of a sentence with each `{slot}` turned into an element the script writes a figure into. */
const slots = (text: string): string => e(text).replace(/\{(\w+)\}/g, '<b data-v="$1"></b>');

/**
 * The live box (widgets/learnLive.ts): hidden until the script has figures for it. Only `div` and `span`
 * inside, so the page's Markdown copy, which reads paragraphs and lists, does not pick up empty sentences.
 */
function liveNow(now: LearnCopy["now"], dataBaseUrl: string, lang: Lang): string {
  return [
    `<div class="now" data-live-now data-base="${e(dataBaseUrl)}" data-country="HR" data-lang="${lang}" hidden>`,
    `<div class="now-title">${e(now.title)}</div>`,
    `<div class="now-share"><i></i><span>${slots(now.share)}</span></div>`,
    `<div data-part="stale" hidden>${e(now.stale)}</div>`,
    `<div class="now-price" data-part="price" hidden><span>${slots(now.price)}</span> <em>${e(now.free)}</em></div>`,
    `<div data-part="times" hidden>${slots(now.times)}</div>`,
    `<div data-part="share" hidden>${slots(now.part)}</div>`,
    `<div class="now-source">${slots(now.source)}</div>`,
    `</div><script type="module" src="/learn-live.js"></script>`,
  ].join("");
}

export function learnPage(site: SiteData, lang: Lang): StaticPage {
  const copy = LEARN_COPY[lang];
  const stories = STORY_KEYS.filter(
    (key) => STORIES[key].route === undefined || site.current.routes !== undefined,
  ).map((key): Door => ({
    href: mapLink(lang, { story: key }),
    title: STORIES[key].title[lang],
    text: STORIES[key].summary[lang],
    icon: STORY_ICONS[key],
    action: copy.storyStart,
  }));
  const tries = [
    ...copy.tries,
    ...(site.current.timeline !== undefined
      ? [
          [
            ...copy.timeTry,
            { l: "lines,plants", y: String(TIME_MACHINE_START) },
          ] as LearnCopy["tries"][number],
        ]
      : []),
  ].map(([title, text, params]): Door => ({ href: mapLink(lang, params), title, text, icon: MAP_ICON }));
  return {
    path: PATHS[lang].learn,
    lang,
    alternatePath: PATHS[other(lang)].learn,
    title: copy.title,
    description: copy.description,
    heading: copy.title,
    lead: copy.lead.map((p) => `<p>${e(p)}</p>`).join(""),
    sections: [
      { heading: copy.storiesHeading, html: `<p>${e(copy.storiesIntro)}</p>${doors(stories)}` },
      {
        heading: copy.journeyHeading,
        html: `<ol>${copy.journey.map((step) => `<li>${e(step)}</li>`).join("")}</ol>`,
      },
      { heading: copy.unitsHeading, html: list(copy.units.map(e)) },
      {
        heading: copy.solarHeading,
        html: `${list(copy.solar.map(e))}${doors([{ href: mapLink(lang, { l: "lines,solar" }), title: copy.solarTry, text: copy.solarTryNote, icon: MAP_ICON }])}${callout(copy.roof, { href: PVGIS_URL, label: copy.roofAction }, SUN_ICON)}`,
      },
      {
        heading: copy.timingHeading,
        html: `${copy.timing.map((p) => `<p>${e(p)}</p>`).join("")}${liveNow(copy.now, site.dataBaseUrl, lang)}`,
      },
      {
        heading: copy.priceHeading,
        html: `${copy.price.map((p) => `<p>${e(p)}</p>`).join("")}${doors([
          {
            href: mapLink(lang, { live: "1" }),
            title: copy.priceTry[0],
            text: copy.priceTry[1],
            icon: MAP_ICON,
          },
        ])}`,
      },
      { heading: copy.termsHeading, html: glossary(copy.terms) },
      { heading: copy.tryHeading, html: `<p>${e(copy.tryIntro)}</p>${doors(tries)}` },
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
