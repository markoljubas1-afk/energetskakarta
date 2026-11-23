/**
 * The prose of the static pages, per language. It lives here rather than in the i18n dictionary
 * because these are paragraphs and question–answer pairs, not labels.
 */
import type { CountryCode, Technology } from "../domain";
import type { Lang } from "../state/url";

/** A topic page per country: one per plant technology, plus substations, data centres and extraction sites. */
/** The author's public contact and KEKS Pay tag, shown at their request (2026-11-16). */
/**
 * "HE Velika: hidroelektrana 276 MW, Hrvatska"; a name that already says what it is keeps the title from
 * saying it twice ("Hidroelektrana Zakučac: 538 MW, Hrvatska", Faza 51-4).
 */
export function assetTitle(name: string, kind: string, figure: string, country: string): string {
  const said = kind !== "" && name.toLocaleLowerCase().includes(kind.toLocaleLowerCase());
  const what = [said ? "" : kind, figure].filter(Boolean).join(" ");
  return `${name}${what ? `: ${what}` : ""}${country ? `, ${country}` : ""}`;
}

export const AUTHOR = { email: "marko.ljubas1@gmail.com", keksTag: "#markol363" } as const;

export type HubKey = Technology | "substations" | "datacenters" | "extraction";

export interface Faq {
  question: string;
  answer: string;
}

export interface Copy {
  /** appears in <title> and og:title of the home and about pages */
  siteTitle: string;
  siteDescription: string;
  /** the home page's description in search results: 155 characters at most */
  metaDescription: string;
  /** schema.org Dataset keywords and measured variables */
  keywords: string[];
  variables: string[];
  about: {
    title: string;
    intro: string[];
    whatHeading: string;
    what: string[];
    /** who the map is for, how to read it, how it is made, what it is not, and where to correct a mistake */
    purposeHeading: string;
    purpose: string[];
    readingHeading: string;
    reading: string[];
    methodHeading: string;
    method: string[];
    limitsHeading: string;
    limits: string[];
    fixHeading: string;
    fix: string;
    authorHeading: string;
    authorSupportHeading: string;
    author: string[];
    authorContact: string;
    authorQrAlt: string;
    authorKeksTag: string;
    sourcesHeading: string;
    updatesHeading: string;
    updates: string;
    downloadsHeading: string;
    downloadsNote: string;
    faqHeading: string;
    faq: Faq[];
    /** shown only when the support page is on (Faza 24) */
    supportHeading: string;
    support: string;
  };
  country: {
    /** "{country}: elektrane, dalekovodi i trafostanice" */
    title: (country: string) => string;
    description: (country: string, operatingMw: string) => string;
    heading: (country: string) => string;
    intro: (country: string, operatingMw: string, plants: string, lineKm: string) => string;
    capacityHeading: string;
    linesHeading: string;
    openMap: string;
    /** the section linking the country's generation page and the price page (17-10) */
    energyHeading: string;
  };
  asset: {
    /** detail and country may be empty: the sentence must still read well */
    description: (kind: string, name: string, detail: string, country: string) => string;
    /** "HE X: hidroelektrana 120 MW, Hrvatska"; figure and country may be empty */
    title: (name: string, kind: string, figure: string, country: string) => string;
    /** a city page is about consumption by purpose, and its title says so */
    cityTitle: (name: string, country: string) => string;
    /** lower-case singular for titles: a plant by its technology, the other kinds as they are */
    plant: Record<Technology, string>;
    substation: string;
    datacenter: string;
    /** links from an asset to the topic page it belongs to and to its country */
    allOfKind: string;
    countryOverview: string;
    /** what the complete record adds (Faza 17-11) */
    more: {
      status: string;
      operator: string;
      year: string;
      voltages: string;
      sources: string;
      nearby: string;
      /** `operating`: the ranking counts operating plants only (when the full records are loaded) */
      rank: (
        rank: number,
        ordinal: string,
        kind: string,
        inCountry: string,
        of: string,
        masculine: boolean,
        operating: boolean,
      ) => string;
      share: (percent: string, inCountry: string) => string;
    };
    openMap: string;
    /** on a city's page: the house with panels, opened on that city */
    homeHere: string;
    onOsm: string;
    coordinates: string;
    sources: string;
  };
  cities: {
    title: string;
    description: string;
    heading: string;
    intro: string[];
    columns: {
      city: string;
      country: string;
      year: string;
      population: string;
      electricity: string;
      lighting: string;
      transport: string;
    };
    perCapita: string;
    note: string;
    /** heading of the sector table on a city page */
    sectorsHeading: string;
    sectorColumns: { sector: string; electricity: string; share: string };
  };
  api: {
    title: string;
    description: string;
    heading: string;
    intro: string[];
    endpointsHeading: string;
    endpoints: { index: string; country: string; asset: string; cities: string; feed: string };
    exampleHeading: string;
    rulesHeading: string;
    rules: string[];
  };
  hub: {
    plural: Record<HubKey, string>;
    /** "u Hrvatskoj" / "in Croatia": Croatian needs the locative, so it is spelled out per country */
    inCountry: Record<CountryCode, string>;
    title: (plural: string, where: string) => string;
    description: (plural: string, where: string, count: string, total: string | null) => string;
    /** the citable line on top of the list; total is the summed capacity, when the kind has one */
    lead: (count: string, total: string | null) => string;
    truncated: (shown: string, total: string) => string;
    /** the section of the country page that links its topic pages */
    sectionHeading: string;
    columns: {
      name: string;
      capacity: string;
      voltage: string;
      kind: string;
      substance: string;
      country: string;
    };
  };
  largest: {
    title: string;
    description: string;
    heading: string;
    lead: (count: string) => string;
    linkText: string;
  };
  home: {
    countriesHeading: string;
    columns: { country: string; operating: string; plants: string };
    more: string;
    /** the paragraph under the title of the home page for readers without JavaScript (English: on /en/) */
    intro: string;
    /** og:description of the home page */
    shareDescription: string;
  };
  notFound: { title: string; heading: string; text: string; textOther: string; linksHeading: string };
  breadcrumbHome: string;
  nav: {
    map: string;
    about: string;
    learn: string;
    reports: string;
    author: string;
    countries: string;
    cities: string;
    api: string;
    otherLang: string;
  };
  footer: string;
  labels: {
    technology: string;
    operating: string;
    /** in place of a power figure when the sources state none for any plant of that kind */
    notStated: string;
    pipeline: string;
    plants: string;
    voltage: string;
    km: string;
    substations: string;
    datacenters: string;
    status: string;
    capacity: string;
    power: string;
    country: string;
    kind: string;
    substance: string;
  };
}

const hr: Copy = {
  siteTitle: "GridAtlas",
  keywords: [
    "elektrane",
    "dalekovodi",
    "trafostanice",
    "elektroenergetska mreža",
    "obnovljivi izvori",
    "otvoreni podaci",
    "Hrvatska",
    "jugoistočna Europa",
  ],
  variables: ["instalirana snaga (MW)", "napon (kV)", "duljina vodova (km)", "status objekta"],
  metaDescription:
    "Otvorena karta elektrana, dalekovoda, trafostanica i plinovoda Hrvatske i još sedam zemalja regije, s podacima uživo. Besplatno, pod otvorenom licencom.",
  siteDescription:
    "Otvorena karta elektrana, dalekovoda, trafostanica, cjevovoda i podatkovnih centara Hrvatske, Slovenije, Mađarske, Srbije, BiH, Crne Gore, Italije i Austrije. Podaci OpenStreetMap, Global Energy Monitor i ENTSO-E, tjedno ažurirani, za preuzimanje pod otvorenom licencom.",
  about: {
    title: "O karti: izvori, licence i način rada",
    intro: [
      "GridAtlas je regionalna energetska karta: otvoren i besplatan prikaz elektroenergetske infrastrukture Hrvatske i šire regije (Slovenije, Mađarske, Srbije, Bosne i Hercegovine, Crne Gore, Italije i Austrije).",
      "Prikazuje elektrane po tehnologiji i snazi, dalekovode i kabele po naponu, trafostanice, plinovode i naftovode, vjetroelektrane na Jadranu, podatkovne centre, punionice za električna vozila, naftne i plinske bušotine, platforme i rudnike, dnevnu proizvodnju plina po zemlji te satne tokove struje preko granica i cijene na dan-unaprijed tržištima.",
    ],
    whatHeading: "Koje podatke karta sadrži",
    what: [
      "Elektrane: tehnologija, instalirana snaga, status (u pogonu, u izgradnji, planirano), operator i godina puštanja u rad, gdje je poznata.",
      "Dalekovodi i kabeli: napon, broj strujnih krugova, istosmjerni (HVDC) i prekogranični vodovi; zasebno i distribucijska mreža srednjeg i niskog napona.",
      "Trafostanice s najvišim naponom, cjevovodi (plin, nafta) i planirane vjetroelektrane na moru, podatkovni centri s objavljenom snagom, punionice s brojem mjesta, crpilišta i rudnici prema sirovini (samo lokacija, bez proizvodnje).",
      "Uživo: satni neto tokovi između zemalja i cijene struje po satu, te proizvodnja i potrošnja po mjesecima i godinama.",
    ],
    purposeHeading: "Čemu karta služi",
    purpose: [
      "Tko planira elektranu ili veći priključak vidi gdje su dalekovodi i trafostanice te, za Hrvatsku, koliko slobodnog kapaciteta objavljuje HEP ODS.",
      "Novinari, studenti i istraživači dobivaju brojke s izvorom i datumom, koje se mogu citirati, preuzeti i provjeriti.",
      "Svi ostali mogu vidjeti odakle dolazi struja: što je izgrađeno, gdje i kada, i što se u mreži događa ovaj sat.",
    ],
    readingHeading: "Kako čitati kartu",
    reading: [
      "Boja voda i trafostanice označava napon, a boja elektrane tehnologiju. Legenda je uvijek na karti.",
      "Površina kruga elektrane raste sa snagom. Puni krug je elektrana u pogonu; prazan prsten ili isprekidana crta je ono što je u izgradnji ili planirano.",
      "Karta se otvara samo s dalekovodima. Ostali slojevi uključuju se u popisu slojeva, a pretraga i poveznice sami uključe sloj onoga što otvaraju.",
      "Slobodni kapacitet: crveno znači da trafostanica prema objavi HEP ODS-a nema mogućnosti prihvata, zeleno da ima, izraženije što je kapacitet veći.",
      "Tokovi uživo su neto razmjena između dviju zemalja u jednom satu: strelica pokazuje smjer, a debljina snagu.",
      "Vremeplov pokazuje koje su elektrane radile u odabranoj godini.",
    ],
    methodHeading: "Kako karta nastaje",
    method: [
      "Jednom tjedno preuzimaju se podaci OpenStreetMapa za svih osam zemalja i iz njih se izdvajaju elektrane, vodovi, trafostanice i ostali objekti.",
      "Elektrane se uparuju s bazom Global Energy Monitor. Gdje se zapisi poklapaju, objekt nosi oba izvora; što postoji samo u jednom, ostaje označeno tim izvorom.",
      "Svaki zapis prolazi provjere. Snaga koja je nemoguća za tu vrstu elektrane ne prikazuje se, a lokacija koja ne odgovara navedenoj zemlji ispravlja se ili izostavlja. Ništa se ne procjenjuje ni ne nadopunjuje.",
      "Nova objava uspoređuje se s prethodnom. Ako provjere ne prođu ili broj objekata neobjašnjivo padne, objava se odbija i na karti ostaje zadnja ispravna.",
      "Uz svaki objekt ostaje zapisano odakle je podatak, pod kojom licencom i kada je preuzet.",
    ],
    limitsHeading: "Što karta nije",
    limits: [
      "Nije službeni registar. Podaci dolaze iz otvorenih izvora i mogu kasniti za stanjem na terenu ili biti nepotpuni.",
      "Zbroj snage je donja granica: zbraja se samo ono što je u izvorima upisano.",
      "Slobodni kapaciteti su informativni i ne jamče priključenje; mjerodavan je HEP ODS.",
      "Struja se u mreži miješa, pa karta ne tvrdi iz koje elektrane dolazi struja u pojedino mjesto.",
    ],
    authorHeading: "Tko stoji iza GridAtlasa",
    authorSupportHeading: "Podrška i kontakt",
    author: [
      "Ovo je isključivo neovisni hobi projekt. Karta je potpuno besplatna, nema oglasa, ne tražim komercijalna sponzorstva i na njoj se ne zarađuje. Sve što vidite temelji se na otvorenim izvorima podataka.",
      "Ako vam se sviđa to što radim i želite mi simbolično pomoći u pokrivanju troškova servera i daljnjeg razvoja, možete me „počastiti kavom” putem dobrovoljne donacije preko KEKS Paya. Naravno, bez ikakve obveze – projekt je i ostaje besplatan za sve.",
      "Ako ste uočili nešto što ne štima ili imate ideju što bi još vrijedilo prikazati, javite se. Svaka poruka je dobrodošla!",
    ],
    authorContact: "Kontakt: Marko Ljubas, e-mail",
    authorQrAlt: "QR kod za donaciju preko KEKS Paya",
    authorKeksTag: "KEKS tag",
    fixHeading: "Našli ste grešku?",
    fix: "Većina podataka dolazi iz OpenStreetMapa, koji svatko može urediti. Ispravak upisan ondje pojavit će se na karti nakon sljedećeg tjednog osvježavanja, i od njega imaju korist svi koji te podatke koriste.",
    sourcesHeading: "Izvori i licence",
    updatesHeading: "Koliko su podaci svježi",
    updates:
      "Podaci iz OpenStreetMapa obnavljaju se tjedno, tokovi i cijene svaki sat, mjesečna proizvodnja svaki dan. Datum zadnje obnove piše na karti, a svaka objava sadrži izvještaj o tome što je dodano, promijenjeno i uklonjeno.",
    downloadsHeading: "Preuzimanje baze",
    downloadsNote:
      "Cijela baza može se preuzeti kao NDJSON (jedan zapis po retku). Baza je pod licencom ODbL, ali sadrži i zapise TransitionZero Solar Asset Mappera (preko Global Energy Monitora) pod CC BY-NC 4.0, pa je preuzimanje u cjelini dopušteno samo za nekomercijalnu upotrebu. Uz svaki zapis stoje izvor i licenca: zapisi bez oznake CC-BY-NC-4.0 smiju se koristiti i komercijalno pod ODbL-om.",
    faqHeading: "Česta pitanja",
    supportHeading: "Podrška i partneri",
    support:
      "Karta je neovisan projekt otvorenih podataka, besplatna i bez oglasa. Kako je podržati i tko je podržava:",
    faq: [
      {
        question: "Odakle karti podaci o elektranama i dalekovodima?",
        answer:
          "Iz OpenStreetMapa (licenca ODbL), dopunjeno bazom Global Energy Monitor (CC BY 4.0) za snagu i status većih elektrana te EMODnet-om za objekte na moru. Uz svaki objekt na karti navedeni su njegovi izvori.",
      },
      {
        question: "Je li karta potpuna?",
        answer:
          "Nije, i to je vidljivo: snaga se zbraja samo gdje je upisana, a pregled po zemlji pokazuje koliko elektrana nema upisanu snagu. Pokrivenost distribucijske mreže i punionica razlikuje se po zemljama.",
      },
      {
        question: "Smijem li podatke koristiti u vlastitom projektu?",
        answer:
          "Da, za nekomercijalnu upotrebu uz navođenje izvora: baza je pod licencom ODbL, a dio solarnih zapisa (TransitionZero Solar Asset Mapper, CC BY-NC 4.0) dopušta samo nekomercijalnu upotrebu, pa to vrijedi za preuzimanje u cjelini. Licenca je navedena uz svaki zapis; zapisi bez CC BY-NC smiju se koristiti i komercijalno pod ODbL-om. Kod stranice je pod licencom MIT.",
      },
      {
        question: "Koliko često se karta ažurira?",
        answer:
          "OpenStreetMap podaci tjedno, tokovi struje i cijene svaki sat, proizvodnja po mjesecima svaki dan.",
      },
      {
        question: "Kako ispraviti grešku na karti?",
        answer:
          "Objekti iz OpenStreetMapa ispravljaju se u OpenStreetMapu; uz svaki takav objekt stoji poveznica. Ispravak se pojavi na karti nakon sljedeće tjedne obnove.",
      },
      {
        question: "Šalje li kartica „Kod mene” moju lokaciju?",
        answer:
          "Samo ako to dopustiš u pregledniku. Tada karta pošalje Open-Meteu (vremenski podaci, CC BY 4.0) koordinate zaokružene na dvije decimale, oko kilometar točnosti, samo za procjenu sunčeve energije; lokacija se ne sprema i ne šalje nikamo drugdje. Bez dopuštenja koristi se središte karte.",
      },
    ],
  },
  country: {
    title: (country) => `${country}: elektrane, dalekovodi i trafostanice`,
    description: (country, operatingMw) =>
      `Elektroenergetska infrastruktura: ${country}. ${operatingMw} u pogonu, elektrane po tehnologiji, kilometri dalekovoda po naponu, trafostanice i podatkovni centri. Otvoreni podaci, tjedno ažurirani.`,
    heading: (country) => `Energetska infrastruktura: ${country}`,
    intro: (country, operatingMw, plants, lineKm) =>
      `${country} ima ${operatingMw} instalirane snage u pogonu i ${lineKm} dalekovoda u pogonu. Elektrane u pogonu zabilježene na karti: ${plants}. Brojke su zbroj onoga što je upisano u izvorima, pa su donja granica stvarnog stanja.`,
    capacityHeading: "Instalirana snaga po tehnologiji",
    linesHeading: "Dalekovodi u pogonu po naponu",
    openMap: "Otvori na karti",
    energyHeading: "Proizvodnja struje i cijene",
  },
  asset: {
    description: (kind, name, detail, country) =>
      `${kind} ${name}${detail ? ` (${detail})` : ""}${country ? `, ${country}` : ""}. Podaci, izvori i položaj na GridAtlasu.`,
    title: (name, kind, figure, country) => assetTitle(name, kind, figure, country),
    cityTitle: (name, country) => `${name}: potrošnja struje po namjeni${country ? `, ${country}` : ""}`,
    plant: {
      hydro: "hidroelektrana",
      pumped_storage: "reverzibilna hidroelektrana",
      solar: "sunčana elektrana",
      wind: "vjetroelektrana",
      nuclear: "nuklearna elektrana",
      gas: "plinska elektrana",
      coal: "elektrana na ugljen",
      lignite: "elektrana na lignit",
      oil: "elektrana na naftu",
      biomass: "elektrana na biomasu",
      geothermal: "geotermalna elektrana",
      battery: "baterijski spremnik",
      other: "elektrana",
    },
    substation: "trafostanica",
    datacenter: "podatkovni centar",
    allOfKind: "Sve iz iste skupine",
    countryOverview: "Pregled zemlje",
    more: {
      status: "Status",
      operator: "Operator",
      year: "Godina puštanja u pogon",
      voltages: "Naponi",
      sources: "Izvori i licence",
      nearby: "U blizini",
      rank: (rank, ordinal, kind, inCountry, of, masculine, operating) => {
        const largest = masculine ? "najveći" : "najveća";
        const where = `${kind}${operating ? " u pogonu" : ""} ${inCountry} po upisanoj snazi`;
        const among = `(od ${of}${operating ? " u pogonu" : ""} s upisanom snagom)`;
        return rank === 1
          ? `${largest.charAt(0).toUpperCase()}${largest.slice(1)} ${where}${of === "1" ? "" : ` ${among}`}.`
          : `${ordinal} ${largest} ${where} ${among}.`;
      },
      share: (percent, inCountry) => `To je ${percent} snage u pogonu zabilježene ${inCountry}.`,
    },
    openMap: "Prikaži na karti",
    homeHere: "Kuća s panelima na ovom mjestu: kamo ide struja",
    onOsm: "Pogledaj ili ispravi u OpenStreetMapu",
    coordinates: "Položaj",
    sources: "Izvori",
  },
  cities: {
    title: "Registar gradova: potrošnja struje po namjeni",
    description:
      "Koliko struje troše gradovi Hrvatske i regije: javna rasvjeta, javni prijevoz, zgrade i industrija, prema inventarima koje su gradovi predali Sporazumu gradonačelnika. Otvoreni podaci JRC-a (CC BY 4.0).",
    heading: "Registar gradova: potrošnja struje po namjeni",
    intro: [
      "Gradovi koji su potpisali Sporazum gradonačelnika predaju inventar potrošnje energije po sektoru i energentu. Ovaj registar izdvaja struju: ukupno te za javnu rasvjetu i javni prijevoz, uz godinu na koju se inventar odnosi.",
      "Registar nije mjerenje uživo: svaki grad ima jednu ili nekoliko godina inventara, a grad koji nije predao inventar nije naveden. Brojke su onakve kakve ih je grad prijavio.",
    ],
    columns: {
      city: "Grad",
      country: "Zemlja",
      year: "Godina",
      population: "Stanovnika",
      electricity: "Struja ukupno (MWh/god)",
      lighting: "Javna rasvjeta (MWh/god)",
      transport: "Javni prijevoz (MWh/god)",
    },
    perCapita: "po stanovniku",
    note: "Izvor: Sporazum gradonačelnika / Zajednički istraživački centar EK (JRC), CC BY 4.0. Sektori koje grad nije prijavio ostaju prazni.",
    sectorsHeading: "Struja po namjeni",
    sectorColumns: { sector: "Namjena", electricity: "MWh/god", share: "Udio" },
  },
  api: {
    title: "Otvoreni JSON (API) i feed promjena",
    description:
      "Statične JSON datoteke po zemlji, objektu i gradu te Atom feed promjena, obnovljeni sa svakim buildom podataka. Za skripte, AI agente i ugradnju bez skidanja cijele baze.",
    heading: "Otvoreni JSON i feed promjena",
    intro: [
      "Uz svaki build podataka objavljuju se statične JSON datoteke: sažetak po zemlji, po većem objektu i registar gradova. Datoteke su bez prijave, s CORS zaglavljem, pa ih smije čitati bilo koja stranica ili skripta. Potpuni zapisi sa svom provenijencijom ostaju u NDJSON preuzimanjima na koja svaka datoteka upućuje.",
      "Atom feed nosi izvještaj o tome što je dodano, promijenjeno i uklonjeno od prošle objave, s poveznicama na kartu.",
    ],
    endpointsHeading: "Adrese",
    endpoints: {
      index: "popis svega, verzija builda, licence i preuzimanja",
      country: "sažetak zemlje: snaga po tehnologiji, km vodova, trafostanice, podatkovni centri",
      asset: "jedan objekt (elektrana ≥ 10 MW, trafostanica ≥ 220 kV, podatkovni centar, grad ≥ 50 GWh)",
      cities: "registar gradova: struja po namjeni, godina inventara, stanovnici",
      feed: "Atom feed promjena od prošle objave",
    },
    exampleHeading: "Primjer",
    rulesHeading: "Pravila",
    rules: [
      "Podaci su pod ODbL 1.0 uz navođenje izvora; dijelovi iz Global Energy Monitora CC BY 4.0, TransitionZero CC BY-NC 4.0 (zato su preuzimanja u cjelini samo za nekomercijalnu upotrebu), Sporazum gradonačelnika/JRC CC BY 4.0.",
      "Adrese su stabilne: identifikator objekta ne mijenja se između buildova (slug je izveden iz njega, ne iz imena).",
      "Datoteke su sažetak; polje summary: true to i kaže. Za potpune zapise preuzmi NDJSON iz links.fullRecords.",
      "Predmemorija je jedan sat; podaci se obnavljaju tjedno (OSM) i po objavi novih izvora.",
    ],
  },
  hub: {
    plural: {
      hydro: "Hidroelektrane",
      pumped_storage: "Reverzibilne hidroelektrane",
      solar: "Sunčane elektrane",
      wind: "Vjetroelektrane",
      nuclear: "Nuklearne elektrane",
      gas: "Plinske elektrane",
      coal: "Elektrane na ugljen",
      lignite: "Elektrane na lignit",
      oil: "Elektrane na naftu",
      biomass: "Elektrane na biomasu",
      geothermal: "Geotermalne elektrane",
      battery: "Baterijski spremnici",
      other: "Ostale elektrane",
      substations: "Trafostanice",
      datacenters: "Podatkovni centri",
      extraction: "Crpilišta i rudnici",
    },
    inCountry: {
      HR: "u Hrvatskoj",
      SI: "u Sloveniji",
      HU: "u Mađarskoj",
      RS: "u Srbiji",
      BA: "u Bosni i Hercegovini",
      ME: "u Crnoj Gori",
      IT: "u Italiji",
      AT: "u Austriji",
    },
    title: (plural, where) => `${plural} ${where}: popis, snaga i karta`,
    description: (plural, where, count, total) =>
      `${plural} ${where} na GridAtlasu: popis (ukupno ${count}${total ? `, zbroj upisane snage ${total}` : ""}), položaj i izvori. Otvoreni podaci, tjedno ažurirani.`,
    lead: (count, total) =>
      `Ukupno na karti: ${count}${total ? ` · zbroj upisane snage (svi statusi): ${total}` : ""}. Brojke su ono što je upisano u izvorima, pa su donja granica stvarnog stanja.`,
    truncated: (shown, total) => `Prikazano je ${shown} najvećih od ${total}; svi su na karti.`,
    sectionHeading: "Po vrstama objekata",
    columns: {
      name: "Naziv",
      capacity: "Snaga",
      voltage: "Najviši napon",
      kind: "Vrsta",
      substance: "Sirovina",
      country: "Zemlja",
    },
  },
  largest: {
    title: "Najveće elektrane Hrvatske i regije: popis po snazi",
    description:
      "Sto najvećih elektrana u Hrvatskoj, Sloveniji, Mađarskoj, Srbiji, BiH, Crnoj Gori, Italiji i Austriji po upisanoj snazi, s tehnologijom, zemljom i položajem na karti.",
    heading: "Najveće elektrane Hrvatske i regije",
    lead: (count) =>
      `${count} elektrana s najvećom upisanom snagom u osam zemalja karte. Snaga je ono što je upisano u izvorima (OpenStreetMap, Global Energy Monitor), za sve statuse.`,
    linkText: "Najveće elektrane u regiji",
  },
  home: {
    countriesHeading: "Zemlje na karti",
    columns: { country: "Zemlja", operating: "Snaga u pogonu", plants: "Elektrane u pogonu" },
    more: "Više",
    intro:
      "Otvorena karta elektrana, dalekovoda, trafostanica, cjevovoda, podatkovnih centara, punionica, crpilišta i rudnika Hrvatske, Slovenije, Mađarske, Srbije, Bosne i Hercegovine, Crne Gore, Italije i Austrije, sa satnim tokovima struje preko granica, cijenama, dnevnom proizvodnjom plina i stanjem skladišta plina (zimske zalihe). Karta traži JavaScript; podaci su dostupni i bez njega:",
    shareDescription:
      "Otvorena karta elektrana, dalekovoda i trafostanica Hrvatske i regije, s tokovima struje i cijenama uživo.",
  },
  notFound: {
    title: "Stranica nije pronađena (404) – GridAtlas",
    heading: "Stranica nije pronađena",
    text: "Ova adresa ne postoji ili je objekt uklonjen iz izvora podataka (npr. iz OpenStreetMapa) pri zadnjoj obnovi.",
    textOther: "This page does not exist, or the asset was removed from the source data in the last refresh.",
    linksHeading: "Nastavi ovdje",
  },
  breadcrumbHome: "Početna",
  nav: {
    map: "Karta",
    about: "O karti",
    learn: "Edukacija",
    reports: "Izvještaji",
    author: "GridAtlas",
    countries: "Zemlje",
    cities: "Gradovi",
    api: "API",
    otherLang: "English",
  },
  footer:
    "Podaci: ODbL, CC BY i dijelom CC BY-NC, uz navođenje izvora; preuzimanje u cjelini samo nekomercijalno. Kod: MIT.",
  labels: {
    technology: "Tehnologija",
    operating: "U pogonu",
    notStated: "nije upisano",
    pipeline: "U izgradnji i planirano",
    plants: "Elektrane",
    voltage: "Napon",
    km: "km",
    substations: "Trafostanice",
    datacenters: "Podatkovni centri",
    status: "Status",
    capacity: "Snaga",
    power: "Snaga",
    country: "Zemlja",
    kind: "Vrsta",
    substance: "Sirovina",
  },
};

const en: Copy = {
  siteTitle: "GridAtlas",
  keywords: [
    "power plants",
    "transmission lines",
    "substations",
    "electricity grid",
    "renewable energy",
    "open data",
    "Croatia",
    "South East Europe",
  ],
  variables: ["installed capacity (MW)", "voltage (kV)", "line length (km)", "asset status"],
  metaDescription:
    "An open map of power plants, transmission lines, substations and gas pipelines in Croatia and seven more countries of the region, with live data. Free.",
  siteDescription:
    "An open map of power plants, transmission lines, substations, pipelines and data centres in Croatia, Slovenia, Hungary, Serbia, Bosnia and Herzegovina, Montenegro, Italy and Austria. Data from OpenStreetMap, Global Energy Monitor and ENTSO-E, updated weekly, downloadable under an open licence.",
  about: {
    title: "About the map: sources, licences and how it works",
    intro: [
      "GridAtlas is a regional energy map: an open, free picture of the electricity infrastructure of Croatia and the wider region (Slovenia, Hungary, Serbia, Bosnia and Herzegovina, Montenegro, Italy and Austria).",
      "It shows power plants by technology and capacity, transmission lines and cables by voltage, substations, gas and oil pipelines, wind farms in the Adriatic, data centres, charging stations for electric vehicles, oil and gas wells, platforms and mines, daily gas production per country, how full the gas storage facilities are, and hourly cross-border electricity flows and day-ahead prices.",
    ],
    whatHeading: "What the map contains",
    what: [
      "Power plants: technology, installed capacity, status (operating, under construction, planned), operator and commissioning year where known.",
      "Lines and cables: voltage, number of circuits, HVDC and cross-border lines; the medium- and low-voltage distribution network as a separate layer.",
      "Substations with their highest voltage, pipelines (gas, oil) and planned offshore wind farms, data centres with published power, charging stations with their number of points, wells and mines by substance (location only, no production).",
      "Live: hourly net flows between countries and hourly electricity prices, plus generation and consumption by month and year.",
    ],
    purposeHeading: "What the map is for",
    purpose: [
      "Anyone planning a plant or a large connection sees where the lines and substations are and, for Croatia, how much free capacity HEP ODS publishes.",
      "Journalists, students and researchers get figures with a source and a date, which can be cited, downloaded and checked.",
      "Everyone else can see where electricity comes from: what was built, where and when, and what is happening in the grid this hour.",
    ],
    readingHeading: "How to read the map",
    reading: [
      "The colour of a line or substation is its voltage; the colour of a plant is its technology. The legend is always on the map.",
      "The area of a plant's circle grows with its capacity. A filled circle is a plant in operation; a hollow ring or a dashed line is something under construction or planned.",
      "The map opens with transmission lines only. The other layers are switched on in the layer list, and a search result or a link switches on the layer of what it opens.",
      "Free capacity: red means the substation has no room according to HEP ODS, green means it has, stronger the more room there is.",
      "Live flows are the net exchange between two countries in one hour: the arrow shows the direction, its width the power.",
      "The time machine shows which plants were running in the chosen year.",
    ],
    methodHeading: "How the map is made",
    method: [
      "Once a week the OpenStreetMap data of all eight countries is downloaded, and plants, lines, substations and the other objects are extracted from it.",
      "Plants are matched with the Global Energy Monitor database. Where records agree, the object carries both sources; what exists in only one stays marked with that source.",
      "Every record is checked. A capacity that is impossible for that kind of plant is not shown, and a location that does not fit the stated country is corrected or left out. Nothing is estimated or filled in.",
      "A new release is compared with the previous one. If the checks fail or the number of objects drops without explanation, the release is refused and the last good one stays on the map.",
      "Every object keeps a record of where its data came from, under which licence and when it was retrieved.",
    ],
    limitsHeading: "What the map is not",
    limits: [
      "It is not an official register. The data comes from open sources and may lag behind reality or be incomplete.",
      "Total capacity is a lower bound: only what the sources state is added up.",
      "Free capacities are informative and do not guarantee a connection; HEP ODS is the authority.",
      "Electricity mixes in the grid, so the map does not claim which plant supplies which place.",
    ],
    authorHeading: "Who is behind GridAtlas",
    authorSupportHeading: "Support and contact",
    author: [
      "This is purely an independent hobby project. The map is completely free, has no ads, I am not looking for commercial sponsorship and it earns nothing. Everything you see is based on open data sources.",
      "If you like what I do and would like to help a little with the cost of servers and further development, you can “buy me a coffee” with a voluntary donation through KEKS Pay. No obligation, of course – the project is and stays free for everyone.",
      "If you have spotted something that looks wrong, or have an idea for what else is worth showing, do get in touch. Every message is welcome!",
    ],
    authorContact: "Contact: Marko Ljubas, email",
    authorQrAlt: "QR code for a donation through KEKS Pay",
    authorKeksTag: "KEKS tag",
    fixHeading: "Found a mistake?",
    fix: "Most of the data comes from OpenStreetMap, which anyone can edit. A correction made there appears on the map after the next weekly refresh, and everyone who uses that data benefits from it.",
    sourcesHeading: "Sources and licences",
    updatesHeading: "How fresh the data is",
    updates:
      "OpenStreetMap data is refreshed weekly, flows and prices every hour, monthly generation every day. The date of the last refresh is shown on the map, and every release carries a report of what was added, changed and removed.",
    downloadsHeading: "Download the database",
    downloadsNote:
      "The whole database can be downloaded as NDJSON (one record per line). It is licensed under ODbL but also contains TransitionZero Solar Asset Mapper records (via Global Energy Monitor) under CC BY-NC 4.0, so the download as a whole is for non-commercial use only. Every record names its source and licence: records not marked CC-BY-NC-4.0 may be used commercially under ODbL.",
    faqHeading: "Frequently asked questions",
    supportHeading: "Support and partners",
    support:
      "The map is an independent open-data project, free and without ads. How to support it, and who does:",
    faq: [
      {
        question: "Where does the map get its data on power plants and lines?",
        answer:
          "From OpenStreetMap (ODbL), completed with Global Energy Monitor (CC BY 4.0) for the capacity and status of larger plants, and EMODnet for offshore assets. Every object on the map lists its sources.",
      },
      {
        question: "Is the map complete?",
        answer:
          "No, and it shows where it is not: capacity is summed only where it is recorded, and the country overview says how many plants have no capacity on record. Coverage of the distribution network and charging stations varies by country.",
      },
      {
        question: "Can I use the data in my own project?",
        answer:
          "Yes, for non-commercial use with attribution: the database is ODbL, and part of the solar records (TransitionZero Solar Asset Mapper, CC BY-NC 4.0) allows non-commercial use only, which therefore applies to the download as a whole. Every record states its licence; records without CC BY-NC may be used commercially under ODbL. The site's code is MIT-licensed.",
      },
      {
        question: "How often is the map updated?",
        answer:
          "OpenStreetMap data weekly, electricity flows and prices every hour, monthly generation every day.",
      },
      {
        question: "How do I fix an error on the map?",
        answer:
          "Objects from OpenStreetMap are corrected in OpenStreetMap; every such object links there. The fix appears on the map after the next weekly refresh.",
      },
      {
        question: "Does the “Near me” card send my location?",
        answer:
          "Only if you allow it in your browser. The map then sends Open-Meteo (weather data, CC BY 4.0) coordinates rounded to two decimals, about a kilometre, only to estimate solar energy; the location is not stored and is sent nowhere else. Without permission the centre of the map is used.",
      },
    ],
  },
  country: {
    title: (country) => `${country}: power plants, transmission lines and substations`,
    description: (country, operatingMw) =>
      `Electricity infrastructure of ${country}: ${operatingMw} operating, power plants by technology, kilometres of transmission lines by voltage, substations and data centres. Open data, updated weekly.`,
    heading: (country) => `Energy infrastructure: ${country}`,
    intro: (country, operatingMw, plants, lineKm) =>
      `${country} has ${operatingMw} of operating capacity and ${lineKm} of transmission lines in operation. Operating power plants recorded on the map: ${plants}. The figures sum what the sources record, so they are a lower bound.`,
    capacityHeading: "Installed capacity by technology",
    linesHeading: "Operating lines by voltage",
    openMap: "Open on the map",
    energyHeading: "Electricity generation and prices",
  },
  asset: {
    description: (kind, name, detail, country) =>
      `${kind} ${name}${detail ? ` (${detail})` : ""}${country ? `, ${country}` : ""}. Data, sources and location on GridAtlas.`,
    title: (name, kind, figure, country) => assetTitle(name, kind, figure, country),
    cityTitle: (name, country) => `${name}: electricity use by purpose${country ? `, ${country}` : ""}`,
    plant: {
      hydro: "hydropower plant",
      pumped_storage: "pumped-storage plant",
      solar: "solar power plant",
      wind: "wind farm",
      nuclear: "nuclear power plant",
      gas: "gas-fired power plant",
      coal: "coal-fired power plant",
      lignite: "lignite-fired power plant",
      oil: "oil-fired power plant",
      biomass: "biomass power plant",
      geothermal: "geothermal power plant",
      battery: "battery storage",
      other: "power plant",
    },
    substation: "substation",
    datacenter: "data centre",
    allOfKind: "All of the same kind",
    countryOverview: "Country overview",
    more: {
      status: "Status",
      operator: "Operator",
      year: "Commissioned",
      voltages: "Voltages",
      sources: "Sources and licences",
      nearby: "Nearby",
      rank: (rank, ordinal, kind, inCountry, of, _masculine, operating) => {
        const where = `${operating ? "operating " : ""}${kind} ${inCountry} by recorded capacity`;
        const among = `(of ${of}${operating ? " operating" : ""} with a recorded capacity)`;
        return rank === 1
          ? `The largest ${where}${of === "1" ? "" : ` ${among}`}.`
          : `The ${ordinal} largest ${where} ${among}.`;
      },
      share: (percent, inCountry) => `That is ${percent} of the operating capacity recorded ${inCountry}.`,
    },
    openMap: "Show on the map",
    homeHere: "A house with panels at this place: where the electricity goes",
    onOsm: "View or fix in OpenStreetMap",
    coordinates: "Location",
    sources: "Sources",
  },
  cities: {
    title: "City register: electricity consumption by purpose",
    description:
      "How much electricity the cities of Croatia and the region use: public lighting, public transport, buildings and industry, from the inventories cities submitted to the Covenant of Mayors. Open JRC data (CC BY 4.0).",
    heading: "City register: electricity consumption by purpose",
    intro: [
      "Cities that signed the Covenant of Mayors submit an inventory of energy consumption by sector and carrier. This register singles out electricity: in total and for public lighting and public transport, with the year the inventory refers to.",
      "The register is not a live meter: each city has one or a few inventory years, and a city that never submitted one is not listed. The figures are as the city reported them.",
    ],
    columns: {
      city: "City",
      country: "Country",
      year: "Year",
      population: "Population",
      electricity: "Electricity, total (MWh/yr)",
      lighting: "Public lighting (MWh/yr)",
      transport: "Public transport (MWh/yr)",
    },
    perCapita: "per capita",
    note: "Source: Covenant of Mayors / Joint Research Centre of the European Commission (JRC), CC BY 4.0. Sectors a city did not report stay empty.",
    sectorsHeading: "Electricity by purpose",
    sectorColumns: { sector: "Purpose", electricity: "MWh/yr", share: "Share" },
  },
  api: {
    title: "Open JSON (API) and change feed",
    description:
      "Static JSON files per country, asset and city plus an Atom feed of changes, refreshed with every data build. For scripts, AI agents and embeds without downloading the whole database.",
    heading: "Open JSON and change feed",
    intro: [
      "Every data build publishes static JSON files: a summary per country, per larger asset and the city register. They need no login and carry a CORS header, so any page or script may read them. The complete records with full provenance stay in the NDJSON downloads every file links to.",
      "The Atom feed carries the report of what was added, changed and removed since the previous release, with links to the map.",
    ],
    endpointsHeading: "Endpoints",
    endpoints: {
      index: "everything listed, build version, licences and downloads",
      country: "country summary: capacity by technology, line km, substations, data centres",
      asset: "one asset (plant ≥ 10 MW, substation ≥ 220 kV, data centre, city ≥ 50 GWh)",
      cities: "city register: electricity by purpose, inventory year, population",
      feed: "Atom feed of changes since the previous release",
    },
    exampleHeading: "Example",
    rulesHeading: "Rules",
    rules: [
      "Data is ODbL 1.0 with attribution; parts from Global Energy Monitor CC BY 4.0, TransitionZero CC BY-NC 4.0 (which makes the downloads non-commercial as a whole), Covenant of Mayors/JRC CC BY 4.0.",
      "Addresses are stable: an asset's identifier does not change between builds (the slug derives from it, not from the name).",
      "The files are summaries; the field summary: true says so. For complete records fetch the NDJSON in links.fullRecords.",
      "Cached for one hour; data is refreshed weekly (OSM) and whenever a source publishes.",
    ],
  },
  hub: {
    plural: {
      hydro: "Hydropower plants",
      pumped_storage: "Pumped-storage plants",
      solar: "Solar power plants",
      wind: "Wind farms",
      nuclear: "Nuclear power plants",
      gas: "Gas-fired power plants",
      coal: "Coal-fired power plants",
      lignite: "Lignite-fired power plants",
      oil: "Oil-fired power plants",
      biomass: "Biomass power plants",
      geothermal: "Geothermal power plants",
      battery: "Battery storage",
      other: "Other power plants",
      substations: "Substations",
      datacenters: "Data centres",
      extraction: "Oil and gas sites and mines",
    },
    inCountry: {
      HR: "in Croatia",
      SI: "in Slovenia",
      HU: "in Hungary",
      RS: "in Serbia",
      BA: "in Bosnia and Herzegovina",
      ME: "in Montenegro",
      IT: "in Italy",
      AT: "in Austria",
    },
    title: (plural, where) => `${plural} ${where}: list, capacity and map`,
    description: (plural, where, count, total) =>
      `${plural} ${where} on GridAtlas: the list (${count} in total${total ? `, ${total} of recorded capacity` : ""}), locations and sources. Open data, updated weekly.`,
    lead: (count, total) =>
      `On the map: ${count}${total ? ` · recorded capacity, all statuses: ${total}` : ""}. The figures are what the sources record, so they are a lower bound.`,
    truncated: (shown, total) => `Showing the ${shown} largest of ${total}; all of them are on the map.`,
    sectionHeading: "By kind of asset",
    columns: {
      name: "Name",
      capacity: "Capacity",
      voltage: "Highest voltage",
      kind: "Kind",
      substance: "Substance",
      country: "Country",
    },
  },
  largest: {
    title: "Largest power plants in Croatia and the region by capacity",
    description:
      "The hundred largest power plants in Croatia, Slovenia, Hungary, Serbia, Bosnia and Herzegovina, Montenegro, Italy and Austria by recorded capacity, with technology, country and location on the map.",
    heading: "Largest power plants in Croatia and the region",
    lead: (count) =>
      `The ${count} power plants with the largest recorded capacity in the eight countries of the map. Capacity is what the sources record (OpenStreetMap, Global Energy Monitor), for every status.`,
    linkText: "Largest power plants in the region",
  },
  home: {
    countriesHeading: "Countries on the map",
    columns: { country: "Country", operating: "Operating capacity", plants: "Operating plants" },
    more: "More",
    intro:
      "An open map of power plants, transmission lines, substations, pipelines, data centres, charging stations, oil and gas sites and mines in Croatia, Slovenia, Hungary, Serbia, Bosnia and Herzegovina, Montenegro, Italy and Austria, with hourly cross-border flows, prices, daily gas production and how full the gas storage is (the winter reserve). The map needs JavaScript; the data is available without it:",
    shareDescription:
      "An open map of power plants, transmission lines and substations in Croatia and the region, with live power flows and prices.",
  },
  notFound: {
    title: "Page not found (404) – GridAtlas",
    heading: "Page not found",
    text: "This page does not exist, or the asset was removed from the source data (for example OpenStreetMap) in the last refresh.",
    textOther: "Ova adresa ne postoji ili je objekt uklonjen iz izvora podataka pri zadnjoj obnovi.",
    linksHeading: "Continue here",
  },
  breadcrumbHome: "Home",
  nav: {
    map: "Map",
    about: "About",
    learn: "Learn",
    reports: "Reports",
    author: "GridAtlas",
    countries: "Countries",
    cities: "Cities",
    api: "API",
    otherLang: "Hrvatski",
  },
  footer:
    "Data: ODbL, CC BY and partly CC BY-NC, with attribution; downloads as a whole are non-commercial. Code: MIT.",
  labels: {
    technology: "Technology",
    operating: "Operating",
    notStated: "not stated",
    pipeline: "Under construction and planned",
    plants: "Power plants",
    voltage: "Voltage",
    km: "km",
    substations: "Substations",
    datacenters: "Data centres",
    status: "Status",
    capacity: "Capacity",
    power: "Power",
    country: "Country",
    kind: "Kind",
    substance: "Substance",
  },
};

export const COPY: Record<Lang, Copy> = { hr, en };
