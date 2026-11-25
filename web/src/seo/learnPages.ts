/**
 * The learning corner (Faza 35-1): how electricity gets from a plant to a socket, the words the map uses,
 * and links that open the map on what each paragraph describes. Written for someone who has never looked
 * at a grid map; nothing here depends on a data release except the date in the footer.
 */
import { ArrowLeftRight, Factory, Flame, Image, Map as MapIcon, Route, Sun, Zap } from "lucide-react";

import type { Technology } from "../domain";
import { createI18n } from "../i18n";
import { SOLAR_PICTURE } from "../share/solarCapitaCard";
import { TIME_MACHINE_START, type Lang } from "../state/url";
import type { StoryKey } from "../stories/keys";
import { STORIES, STORY_KEYS } from "../stories/stories";
import { callout, doors, e, glossary, list, steps, type Door } from "./markup";
import { homeDoor, icon } from "./pageDoors";
import { home, mapLink, other, PATHS, publisher, type SiteData, type StaticPage } from "./site";
import { topPlantsSection } from "./topPlants";

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
  /** the call-out that sends a reader with a roof of their own to the exact calculation */
  roof: string;
  roofAction: string;
  /**
   * Natural gas (Faza 44-1). Every figure is from a document named in `gasSources`; the year the
   * figures are of is written in the sentence, and a test holds the two languages to the same figures.
   */
  gasHeading: string;
  gas: string[];
  gasSourcesLabel: string;
  /** the document with what it is cited for, and its address */
  gasSources: [string, string][];
  /** the two cards under the text: the gas layer of the map, and the storage picture to share */
  gasMap: [string, string];
  gasPicture: [string, string];
  /** the picture of solar electricity per inhabitant, under the solar sentences (Faza 46) */
  solarPicture: [string, string];
  /**
   * The path of gas from the well to the stove (Faza 45-2): six stations, each a sentence or two whose
   * figures and names are from the documents in `gasPathSources` (HERA's report for 2024, and the pages of
   * INA, LNG Hrvatska and Plinacro as read on 2026-11-19).
   */
  gasPathHeading: string;
  gasPath: string[];
  gasPathSources: [string, string][];
  /** the two cards under it: the wells of Podravina and the northern Adriatic, on the map */
  gasPathWells: [string, string];
  gasPathSea: [string, string];
  /** what a story card does */
  storyStart: string;
  timingHeading: string;
  /** the live box: its words, with `{slot}` where the script writes a figure (widgets/learnLive.ts) */
  now: {
    title: string;
    share: string;
    /** the source that generated the most in that hour, under the renewable share */
    top: string;
    /** how each source is named inside that sentence */
    sources: Record<Technology, string>;
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
  /** questions and answers shown on the page, and the same ones as FAQPage structured data */
  faqHeading: string;
  faq: [string, string][];
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
    solarHeading: "Sunčana energija u šest rečenica",
    solar: [
      "Sunčani panel pretvara svjetlost izravno u struju. Njegova snaga piše se u kilovatima „u vrhu” (kWp): toliko daje pod punim suncem, okomito na zrake, pri 25 °C.",
      "Koliko struje to znači u godini, ovisi o mjestu. U našoj regiji jedan kWp daje otprilike između 1000 i 1600 kWh godišnje: najmanje u Alpama, najviše na jugu Italije; u Zagrebu oko 1250, u Dalmaciji oko 1450.",
      "Kućanstvo u Hrvatskoj troši reda veličine 3000 do 4000 kWh struje godišnje, pa bi mu za godišnju količinu trebalo otprilike 3 kWp panela, to jest sedam do osam današnjih panela na krovu.",
      "Sunce daje najviše ljeti i oko podneva, a troši se najviše zimi i navečer. Zato sunčana energija treba mrežu, hidroelektrane i baterije koje premošćuju razliku.",
      "Kućna baterija (najčešće kapaciteta 5 do 10 kWh) radi kao vlastiti spremnik: sprema podnevni višak sunca da biste ga trošili navečer. Zimi i dalje trebate sigurnost javne mreže, jer ni velika kućna baterija ne može sačuvati ljetno sunce za siječanj.",
      "Brojke na karti su dugogodišnji prosjek modela Global Solar Atlasa. Za konkretan krov ili zemljište treba proračun koji uzima u obzir nagib, orijentaciju i zasjenjenje; besplatan je, na primjer, europski PVGIS.",
    ],
    roof: "Imate krov? Otvorite sunčani sloj, kliknite na svoje mjesto i pomaknite klizač na svoju godišnju potrošnju: karta kaže koliko panela treba.",
    roofAction: "Izračunaj na karti",
    gasHeading: "Prirodni plin u šest rečenica",
    gas: [
      "Prirodni plin je većinom metan. Plinomjer broji kubične metre, ali se plin naplaćuje po energiji, u kilovatsatima: kubični metar daje otprilike 10 kWh topline. Točna vrijednost ovisi o sastavu plina i piše na svakom računu (gornja ogrjevna vrijednost, od 1. listopada 2022.).",
      "U hrvatski transportni sustav ušlo je 2024. godine 38,8 TWh plina: 69 % s terminala za ukapljeni plin (LNG) na Krku, 16 % iz domaćih polja, 12 % iz skladišta i 2,5 % plinovodima iz Slovenije i Mađarske (točke Rogatec i Dravaszerdahely).",
      "Ulaz nije isto što i potrošnja: četvrtina tog plina otišla je dalje preko granice, a desetina u skladište. Kupcima u Hrvatskoj isporučeno je 24,6 TWh, od toga kućanstvima 6,2 TWh.",
      "Plin se sprema pod zemlju za zimu. Hrvatska ima jedno skladište, Okoli: u pravilu se puni od travnja do rujna, a prazni od listopada do ožujka, i u njega stane 4,8 TWh. Pravilo EU-a traži da skladišta jednom između 1. listopada i 1. prosinca budu 90 % puna.",
      "Plinske elektrane rade više kad nema dovoljno vode, sunca i vjetra. Po kilovatsatu struje ispuštaju oko 40 % manje stakleničkih plinova nego elektrane na ugljen (490 prema 820 grama CO₂, prema IPCC-u). Ali i sam metan je staklenički plin, kroz sto godina 28 puta jači od CO₂, pa svako curenje iz bušotina i cijevi smanjuje tu prednost.",
      "Istim cijevima može teći i biometan, plin iz otpada i gnoja: države EU-a prijavile su planove za 26 milijardi kubičnih metara godišnje do 2030. Hoće li i koliko plinovoda jednom nositi vodik, danas je plan, a ne činjenica.",
    ],
    gasSourcesLabel: "Izvori",
    gasSources: [
      [
        "HERA, Godišnje izvješće za 2024. (ulazi i izlazi transportnog sustava, isporuka kupcima, skladište Okoli, obračun u kWh)",
        "https://sabor.hr/sites/default/files/uploads/sabor/2025-06-30/144704/GODISNJE_IZVJESCE_HERA_2024.pdf",
      ],
      [
        "Uredba (EU) 2022/1032 s izmjenom iz 2025. (punjenje skladišta)",
        "https://eur-lex.europa.eu/eli/reg/2022/1032/oj",
      ],
      [
        "IPCC, Peto izvješće o procjeni (emisije po kilovatsatu, metan)",
        "https://www.ipcc.ch/assessment-report/ar5/",
      ],
      [
        "Europska komisija: biometan",
        "https://energy.ec.europa.eu/topics/renewable-energy/bioenergy/biomethane_en",
      ],
    ],
    gasMap: ["Plin na karti", "skladišta i koliko su puna, proizvodnja plina po zemljama, cjevovodi"],
    gasPicture: [
      "Slika za dijeljenje: zalihe plina",
      "popunjenost, količina i promjena u sedam dana, s navedenim izvorom (GIE AGSI)",
    ],
    solarPicture: [
      "Slika za dijeljenje: sunčana struja po stanovniku",
      "koliko kilovatsati sunčane struje dolazi na jednog stanovnika, po zemljama regije (izračun iz podataka Eurostata)",
    ],
    gasPathHeading: "Put plina: od bušotine do štednjaka",
    gasPath: [
      "Gdje se crpi. Plin se u Hrvatskoj crpi iz polja u Podravini (INA-ina polja Molve, Kalinovac i Ferdinandovac) i s platformi u sjevernom Jadranu (polja Sjeverni Jadran, Marica i Izabela). Domaća polja dala su 2024. oko 6,2 TWh, 16 % svega što je ušlo u transportni sustav.",
      "Gdje stiže brodom. Ukapljeni plin (LNG) dolazi brodovima na terminal u Omišlju na Krku, koji radi od 1. siječnja 2021. Na usidrenom brodu „LNG Croatia” tekućina se ponovno pretvara u plin (uplinjava) i šalje u cijevi. Godine 2024. stiglo je 28 brodova iz 5 zemalja, a od studenoga 2025. terminal može primiti 6,1 milijardu kubičnih metara godišnje.",
      "Gdje se tlači. Plin kroz cijevi ne teče sam, gura ga tlak. Transportni plinovodi rade na 50, 75 i 100 bara, a jedina kompresorska stanica u sustavu, u Velikoj Ludini (u radu od prosinca 2019., snage 4,5 MW), omogućuje da plin ide iz Hrvatske u Mađarsku i iz 50-barskog dijela sustava u 75-barski.",
      "Gdje se čuva. Što ljeti nije potrošeno, utiskuje se bušotinama u podzemno ležište Okoli, a zimi se iz njega povlači. Najviše što je skladište 2024. dalo u jednom satu bilo je 2.149 MWh.",
      "Gdje se spušta tlak. Prije nego što uđe u naselja, plin prolazi kroz jednu od 153 mjerno-redukcijske stanice: ondje mu se spušta tlak i mjeri količina. Prirodni plin nema miris, pa mu se zbog sigurnosti dodaje miris po kojem ga prepoznajemo, obično odmah nakon izlaza iz transportnog sustava.",
      "Gdje završava. Do kuća i tvrtki plin nosi 20.049 km distribucijskih plinovoda, kojima upravlja 27 operatora. Veliki kupci, njih 21, priključeni su izravno na transportni sustav, a dio plina odlazi preko granice, u Sloveniju i Mađarsku.",
    ],
    gasPathSources: [
      [
        "HERA, Godišnje izvješće za 2024. (proizvodnja, brodovi, skladište, tlakovi, distribucija)",
        "https://sabor.hr/sites/default/files/uploads/sabor/2025-06-30/144704/GODISNJE_IZVJESCE_HERA_2024.pdf",
      ],
      [
        "INA: polja u Podravini",
        "https://www.ina.hr/announcement/ina-prijavila-komercijalno-otkrice-plina-u-podravini/",
      ],
      [
        "INA: polja u Jadranu",
        "https://www.ina.hr/announcement/ina-osigurala-novu-proizvodnju-plina-iz-jadrana/",
      ],
      [
        "LNG Hrvatska: početak rada",
        "https://lng.hr/en/2021/09/08/1000000000-m3-of-natural-gas-delivered-to-the-croatian-transport-system/",
      ],
      ["LNG Hrvatska: povećani kapacitet", "https://lng.hr/en/2025/11/10/completion-of-probationary-period/"],
      ["Plinacro: kompresorska stanica", "https://www.plinacro.hr/default.aspx?id=902"],
      ["Plinacro: opis transportnog sustava", "https://www.plinacro.hr/default.aspx?id=162"],
      ["Plinacro: sigurnosne mjere (miris plina)", "https://www.plinacro.hr/default.aspx?id=164"],
    ],
    gasPathWells: [
      "Bušotine u Podravini",
      "polja oko Molva na karti: svaka točka je jedna bušotina iz OpenStreetMapa",
    ],
    gasPathSea: ["Sjeverni Jadran", "platforma i podmorski cjevovodi prema Puli i Italiji"],
    storyStart: "Pokreni priču",
    now: {
      title: "Upravo sada u Hrvatskoj",
      share: "{share} % proizvodnje je iz obnovljivih izvora",
      top: "Najveći izvor u tom satu: {source}, {topShare} % proizvodnje.",
      sources: {
        hydro: "hidroelektrane",
        pumped_storage: "reverzibilne hidroelektrane",
        solar: "sunčane elektrane",
        wind: "vjetroelektrane",
        nuclear: "nuklearne elektrane",
        gas: "plinske elektrane",
        coal: "elektrane na ugljen",
        lignite: "elektrane na lignit",
        oil: "elektrane na loživo ulje",
        biomass: "elektrane na biomasu",
        geothermal: "geotermalne elektrane",
        battery: "baterijski spremnici",
        other: "ostale elektrane",
      },
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
    faqHeading: "Česta pitanja",
    faq: [
      [
        "Koja je razlika između snage (MW) i energije (MWh)?",
        "Snaga kaže koliko elektrana može dati u jednom trenutku, a energija koliko je proizvedeno ili potrošeno kroz neko vrijeme. Elektrana od 100 MW koja jedan sat radi punom snagom proizvede 100 MWh.",
      ],
      [
        "Odakle dolazi struja koju trošim?",
        "U mreži se struja iz svih elektrana i iz uvoza miješa, pa se ne može reći iz koje je elektrane struja u pojedinoj utičnici. Može se reći od čega je bila struja u mreži u nekom satu: to karta pokazuje u sloju uživo.",
      ],
      [
        "Što znači udio obnovljivih izvora na karti?",
        "To je udio hidroelektrana, vjetroelektrana, sunčanih elektrana, elektrana na biomasu i geotermalnih elektrana u onome što su elektrane jedne zemlje proizvele u jednom satu. Uvoz se ne broji, a reverzibilne hidroelektrane i nuklearne elektrane ne ubrajaju se u obnovljive izvore.",
      ],
      [
        "Zašto je cijena struje na burzi ponekad nula ili negativna?",
        "Kad elektrane u nekom satu nude više struje nego što se troši, a proizvodnja se ne može brzo smanjiti ni pohraniti, cijena na burzi za dan unaprijed padne na nulu ili ispod nje. To je veleprodajna cijena; cijena za kućanstva ugovara se drukčije.",
      ],
      [
        "Odakle su podaci i koliko su svježi?",
        "Elektrane, vodovi i trafostanice dolaze iz OpenStreetMapa i Global Energy Monitora. Proizvodnja, tokovi preko granica i cijene dolaze s platforme ENTSO-E Transparency, s nekoliko sati zakašnjenja. Stanje skladišta plina dolazi iz GIE AGSI, dan ili dva nakon plinskog dana. Uz svaki podatak stoje izvor i datum.",
      ],
      [
        "Odakle Hrvatskoj dolazi plin?",
        "U hrvatski transportni sustav ušlo je 2024. godine 38,8 TWh plina: 69 % s terminala za ukapljeni plin (LNG) na Krku, 16 % iz domaćih polja, 12 % iz skladišta i 2,5 % plinovodima iz Slovenije i Mađarske.",
      ],
      [
        "Koliko plina troši Hrvatska?",
        "Kupcima u Hrvatskoj isporučeno je 2024. godine 24,6 TWh plina, od toga kućanstvima 6,2 TWh. Ulaz u sustav bio je veći, 38,8 TWh, jer je četvrtina plina otišla dalje preko granice, a desetina u skladište.",
      ],
    ],
    termsHeading: "Pojmovnik",
    terms: [
      [
        "Ugljični otisak struje (g CO₂/kWh)",
        "Koliko grama CO₂ nastane po proizvedenom kilovatsatu. Na karti je to izračun, nije mjerenje: proizvodnja po izvoru u jednom satu (ENTSO-E) puta faktori IPCC-a za cijeli životni vijek elektrane (ugljen 820, plin 490, biomasa 230, sunce 48, voda 24, nuklearna 12, vjetar 11). IPCC ima jednu brojku za sav ugljen, pa je otisak zemalja koje lože lignit vjerojatno podcijenjen. Uvoz nije uračunat.",
      ],
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
    solarHeading: "Solar energy in six sentences",
    solar: [
      "A solar panel turns light straight into electricity. Its power is stated in kilowatts “peak” (kWp): what it gives in full sun, square to the rays, at 25 °C.",
      "How much electricity that means in a year depends on the place. In our region one kWp gives roughly between 1,000 and 1,600 kWh a year: least in the Alps, most in the south of Italy; about 1,250 in Zagreb, about 1,450 in Dalmatia.",
      "A household in Croatia uses in the order of 3,000 to 4,000 kWh of electricity a year, so a year's worth would take about 3 kWp of panels, that is seven or eight of today's panels on a roof.",
      "The sun gives the most in summer and around noon, while the most is used in winter and in the evening. That is why solar energy needs the grid, hydro plants and batteries to bridge the difference.",
      "A home battery (most often 5 to 10 kWh) works as a store of your own: it keeps the midday surplus of sun for you to use in the evening. In winter you still need the security of the public grid, because even a large home battery cannot keep summer sun for January.",
      "The figures on the map are the long-term average of the Global Solar Atlas's model. A particular roof or plot needs a calculation that takes tilt, orientation and shading into account; the European PVGIS, for one, is free.",
    ],
    roof: "Have a roof? Open the solar layer, click your own place and move the slider to your yearly consumption: the map says how many panels it takes.",
    roofAction: "Calculate on the map",
    gasHeading: "Natural gas in six sentences",
    gas: [
      "Natural gas is mostly methane. A gas meter counts cubic metres, but gas is billed by its energy, in kilowatt-hours: a cubic metre gives roughly 10 kWh of heat. The exact value depends on what the gas is made of and is written on every bill (the gross calorific value, since 1 October 2022).",
      "In 2024, 38.8 TWh of gas entered Croatia's transmission system: 69% from the liquefied gas (LNG) terminal on the island of Krk, 16% from the country's own fields, 12% from storage and 2.5% through the pipelines from Slovenia and Hungary (the points Rogatec and Drávaszerdahely).",
      "What enters is not what is used: a quarter of that gas went on across the border, and a tenth into storage. Customers in Croatia were delivered 24.6 TWh, households 6.2 TWh of it.",
      "Gas is kept underground for the winter. Croatia has one storage facility, Okoli: as a rule it is filled from April to September and emptied from October to March, and it holds 4.8 TWh. An EU rule asks that at some point between 1 October and 1 December storage be 90% full.",
      "Gas-fired plants work harder when there is not enough water, sun and wind. Per kilowatt-hour of electricity they emit about 40% less greenhouse gas than coal plants (490 against 820 grams of CO₂, according to the IPCC). But methane is a greenhouse gas itself, 28 times stronger than CO₂ over a hundred years, so every leak from wells and pipes eats into that advantage.",
      "The same pipes can carry biomethane, gas made from waste and manure: EU countries have reported plans for 26 billion cubic metres a year by 2030. Whether, and how many, pipelines will one day carry hydrogen is a plan today, not a fact.",
    ],
    gasSourcesLabel: "Sources",
    gasSources: [
      [
        "HERA, Annual Report for 2024, in Croatian (entries and exits of the transmission system, deliveries to customers, the Okoli storage, billing in kWh)",
        "https://sabor.hr/sites/default/files/uploads/sabor/2025-06-30/144704/GODISNJE_IZVJESCE_HERA_2024.pdf",
      ],
      [
        "Regulation (EU) 2022/1032 as amended in 2025 (filling of storage)",
        "https://eur-lex.europa.eu/eli/reg/2022/1032/oj",
      ],
      [
        "IPCC, Fifth Assessment Report (emissions per kilowatt-hour, methane)",
        "https://www.ipcc.ch/assessment-report/ar5/",
      ],
      [
        "European Commission: biomethane",
        "https://energy.ec.europa.eu/topics/renewable-energy/bioenergy/biomethane_en",
      ],
    ],
    gasMap: ["Gas on the map", "storage and how full it is, gas production by country, pipelines"],
    gasPicture: [
      "Picture to share: gas in storage",
      "the fill, the amount and the change over seven days, with the source named (GIE AGSI)",
    ],
    solarPicture: [
      "Picture to share: solar electricity per inhabitant",
      "how many kilowatt-hours of solar electricity there are per inhabitant, by country of the region (calculated from Eurostat data)",
    ],
    gasPathHeading: "The path of gas: from the well to the stove",
    gasPath: [
      "Where it is produced. Croatia's gas comes from fields in Podravina (INA's fields Molve, Kalinovac and Ferdinandovac) and from platforms in the northern Adriatic (the fields Sjeverni Jadran, Marica and Izabela). In 2024 the country's own fields gave about 6.2 TWh, 16% of everything that entered the transmission system.",
      "Where it arrives by ship. Liquefied gas (LNG) comes by ship to the terminal at Omišalj on the island of Krk, in operation since 1 January 2021. On the moored ship LNG Croatia the liquid is turned back into gas (regasified) and sent into the pipes. In 2024, 28 ships arrived from 5 countries, and since November 2025 the terminal can take 6.1 billion cubic metres a year.",
      "Where it is compressed. Gas does not flow through pipes by itself; pressure pushes it. The transmission pipelines work at 50, 75 and 100 bar, and the system's only compressor station, at Velika Ludina (in operation since December 2019, 4.5 MW), lets gas go from Croatia to Hungary and from the 50-bar part of the system into the 75-bar part.",
      "Where it is kept. What is not used in summer is injected through wells into the underground reservoir Okoli, and withdrawn from it in winter. The most the storage gave in one hour of 2024 was 2,149 MWh.",
      "Where the pressure is lowered. Before it enters a town, gas passes one of 153 measuring and reduction stations, where its pressure is lowered and its quantity measured. Natural gas has no smell, so for safety the smell we know it by is added, usually right after it leaves the transmission system.",
      "Where it ends. Homes and businesses are reached by 20,049 km of distribution pipelines, run by 27 operators. The large customers, 21 of them, are connected to the transmission system directly, and part of the gas goes on across the border, to Slovenia and Hungary.",
    ],
    gasPathSources: [
      [
        "HERA, Annual Report for 2024 (production, ships, storage, pressures, distribution; in Croatian)",
        "https://sabor.hr/sites/default/files/uploads/sabor/2025-06-30/144704/GODISNJE_IZVJESCE_HERA_2024.pdf",
      ],
      [
        "INA: fields in Podravina (in Croatian)",
        "https://www.ina.hr/announcement/ina-prijavila-komercijalno-otkrice-plina-u-podravini/",
      ],
      [
        "INA: fields in the Adriatic (in Croatian)",
        "https://www.ina.hr/announcement/ina-osigurala-novu-proizvodnju-plina-iz-jadrana/",
      ],
      [
        "LNG Croatia: start of operation",
        "https://lng.hr/en/2021/09/08/1000000000-m3-of-natural-gas-delivered-to-the-croatian-transport-system/",
      ],
      ["LNG Croatia: the larger capacity", "https://lng.hr/en/2025/11/10/completion-of-probationary-period/"],
      ["Plinacro: the compressor station (in Croatian)", "https://www.plinacro.hr/default.aspx?id=902"],
      ["Plinacro: the transmission system (in Croatian)", "https://www.plinacro.hr/default.aspx?id=162"],
      ["Plinacro: safety (the smell of gas; in Croatian)", "https://www.plinacro.hr/default.aspx?id=164"],
    ],
    gasPathWells: [
      "Wells in Podravina",
      "the fields around Molve on the map: each dot is one well from OpenStreetMap",
    ],
    gasPathSea: ["Northern Adriatic", "a platform and the subsea pipelines towards Pula and Italy"],
    storyStart: "Start the story",
    now: {
      title: "Right now in Croatia",
      share: "{share}% of generation is from renewable sources",
      top: "The largest source in that hour: {source}, {topShare}% of generation.",
      sources: {
        hydro: "hydropower",
        pumped_storage: "pumped storage",
        solar: "solar",
        wind: "wind",
        nuclear: "nuclear",
        gas: "natural gas",
        coal: "coal",
        lignite: "lignite",
        oil: "fuel oil",
        biomass: "biomass",
        geothermal: "geothermal",
        battery: "battery storage",
        other: "other plants",
      },
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
    faqHeading: "Frequently asked questions",
    faq: [
      [
        "What is the difference between capacity (MW) and energy (MWh)?",
        "Capacity says how much a plant can deliver at one moment; energy says how much was generated or used over a time. A 100 MW plant running at full capacity for one hour generates 100 MWh.",
      ],
      [
        "Where does the electricity I use come from?",
        "In the grid the electricity of every plant and of imports mixes, so nobody can say which plant the electricity in one socket came from. What can be said is what the grid's electricity was made of in an hour: the map shows that in its live layer.",
      ],
      [
        "What does the renewable share on the map mean?",
        "It is the share of hydropower, wind, solar, biomass and geothermal plants in what one country's plants generated in one hour. Imports are not counted, and pumped storage and nuclear plants are not counted as renewable.",
      ],
      [
        "Why is the exchange price of electricity sometimes zero or negative?",
        "When plants offer more electricity in an hour than is used, and generation can neither be cut quickly nor stored, the day-ahead exchange price falls to zero or below. That is a wholesale price; household prices are agreed differently.",
      ],
      [
        "Where do the data come from, and how fresh are they?",
        "Plants, lines and substations come from OpenStreetMap and the Global Energy Monitor. Generation, cross-border flows and prices come from the ENTSO-E Transparency Platform, a few hours late. Gas in storage comes from GIE AGSI, a day or two after the gas day. Every figure carries its source and date.",
      ],
      [
        "Where does Croatia's gas come from?",
        "In 2024, 38.8 TWh of gas entered Croatia's transmission system: 69% from the liquefied gas (LNG) terminal on the island of Krk, 16% from the country's own fields, 12% from storage and 2.5% through the pipelines from Slovenia and Hungary.",
      ],
      [
        "How much gas does Croatia use?",
        "Customers in Croatia were delivered 24.6 TWh of gas in 2024, households 6.2 TWh of it. More entered the system, 38.8 TWh, because a quarter of the gas went on across the border and a tenth into storage.",
      ],
    ],
    termsHeading: "Glossary",
    terms: [
      [
        "Carbon footprint of electricity (g CO₂/kWh)",
        "How many grams of CO₂ arise per kilowatt-hour generated. On the map it is a calculation, not a measurement: an hour's generation by source (ENTSO-E) times the IPCC's life-cycle factors (coal 820, gas 490, biomass 230, solar 48, hydro 24, nuclear 12, wind 11). The IPCC has one figure for all coal, so the footprint of countries that burn lignite is probably understated. Imports are not counted.",
      ],
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

const STORY_ICONS: Record<StoryKey, string> = {
  "put-struje": icon(Route),
  kilovatsat: icon(Zap),
  sunce: icon(Sun),
  "odakle-struja": icon(Factory),
  granice: icon(ArrowLeftRight),
};
const MAP_ICON = icon(MapIcon);
const SUN_ICON = icon(Sun, 22);
const GAS_ICON = icon(Flame);
const PICTURE_ICON = icon(Image);

/** The gas layer with the pipelines under it, and the dialog opened on the picture of the storage. */
const GAS_MAP_PARAMS = { l: "lines,pipelines,gas" };
const GAS_PICTURE_PARAMS = { pic: "gas" };
/** Where the path of gas starts: the wells around Molve, and the platform off Istria with its pipelines. */
const WELLS_PARAMS = { l: "extraction", v: "46.09,17.06,11" };
const SEA_PARAMS = { l: "extraction,pipelines", v: "44.75,13.3,9" };

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
    // the names travel with the page: the script only picks the one of the hour's largest source
    `<div data-part="top" data-sources="${e(JSON.stringify(now.sources))}" hidden>${slots(now.top)}</div>`,
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
  const top = topPlantsSection(site, lang);
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
        html: steps(copy.journey.map(e)),
      },
      { heading: copy.unitsHeading, html: list(copy.units.map(e), "facts") },
      {
        heading: copy.solarHeading,
        html: `${list(copy.solar.map(e), "facts")}${callout(copy.roof, { href: mapLink(lang, { l: "lines,solar" }), label: copy.roofAction }, SUN_ICON)}${doors(
          [
            homeDoor(lang),
            ...(site.solarCapita
              ? [
                  {
                    href: mapLink(lang, { pic: SOLAR_PICTURE }),
                    title: copy.solarPicture[0],
                    text: copy.solarPicture[1],
                    icon: PICTURE_ICON,
                  },
                ]
              : []),
          ],
        )}`,
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
      {
        heading: copy.gasHeading,
        html: `${list(copy.gas.map(e), "facts")}<p>${e(copy.gasSourcesLabel)}: ${copy.gasSources
          .map(([name, url]) => `<a href="${e(url)}" rel="noopener">${e(name)}</a>`)
          .join("; ")}.</p>${doors([
          {
            href: mapLink(lang, GAS_MAP_PARAMS),
            title: copy.gasMap[0],
            text: copy.gasMap[1],
            icon: GAS_ICON,
          },
          {
            href: mapLink(lang, GAS_PICTURE_PARAMS),
            title: copy.gasPicture[0],
            text: copy.gasPicture[1],
            icon: PICTURE_ICON,
          },
        ])}`,
      },
      {
        heading: copy.gasPathHeading,
        html: `${list(copy.gasPath.map(e), "facts")}<p>${e(copy.gasSourcesLabel)}: ${copy.gasPathSources
          .map(([name, url]) => `<a href="${e(url)}" rel="noopener">${e(name)}</a>`)
          .join("; ")}.</p>${doors([
          {
            href: mapLink(lang, WELLS_PARAMS),
            title: copy.gasPathWells[0],
            text: copy.gasPathWells[1],
            icon: MAP_ICON,
          },
          {
            href: mapLink(lang, SEA_PARAMS),
            title: copy.gasPathSea[0],
            text: copy.gasPathSea[1],
            icon: MAP_ICON,
          },
        ])}`,
      },
      // the ten largest plants of Croatia, when the release knows which plants are in operation
      ...(top ? [top] : []),
      { heading: copy.termsHeading, html: glossary(copy.terms) },
      { heading: copy.faqHeading, html: glossary(copy.faq) },
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
      // the questions of the page's own section, word for word: structured data never says more than the page
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        inLanguage: lang,
        mainEntity: copy.faq.map(([question, answer]) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      },
      // the page as a text with a date, next to its glossary and questions
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: copy.title,
        description: copy.description,
        inLanguage: lang,
        dateModified: site.current.createdAt,
        isAccessibleForFree: true,
        publisher: publisher(site, createI18n(lang)),
        ...(site.siteUrl ? { url: site.siteUrl + PATHS[lang].learn } : {}),
      },
    ],
    lastModified: site.current.createdAt,
    breadcrumbs: [home(lang)],
  };
}
