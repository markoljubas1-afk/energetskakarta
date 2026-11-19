/** Words of the energy transition page (Faza 20-3, the official share Faza 28), in both languages. */
import type { Lang } from "../state/url";
import type { Forms } from "./markup";

interface TransitionCopy {
  title: string;
  description: string;
  /** the description when the page has Eurostat's official share */
  descriptionOfficial: string;
  heading: string;
  linkText: string;
  leadShare: (year: string, share: string, prevYear: string, prevShare: string) => string;
  leadShareOnly: (year: string, share: string) => string;
  leadCapacity: (year: string, mw: string) => string;
  leadCo2: (month: string, value: string) => string;
  leadOfficial: (year: string, share: string, target: string) => string;
  official: {
    heading: string;
    sentence: (year: string, share: string, eu: string | null) => string;
    gap: (target: string, gap: string) => string;
    reached: (target: string) => string;
    /** "postotni bod" in the right form for the gap */
    points: Forms;
    columns: [string, string, string, string, string];
    flags: (list: string) => string;
    /** Eurostat's flags in words; Eurostat's own English words come with the data */
    flagWords: Record<string, string>;
    electricity: string;
    source: string;
    updated: (date: string) => string;
  };
  compare: {
    heading: (year: string) => string;
    columns: [string, string, string, string, string];
    eu: string;
    earlier: (year: string) => string;
    note: (year: string) => string;
    missing: (names: string) => string;
  };
  share: { heading: string; note: string; columns: [string, string, string, string] };
  /** solar electricity per inhabitant, a calculation from two of Eurostat's figures (Faza 46) */
  solarCapita: {
    heading: string;
    sentence: (year: string, gwh: string, kwh: string, place: string, of: string) => string;
    behind: (first: string, kwh: string, times: string) => string;
    first: string;
    before: (year: string, kwh: string) => string;
    columns: [string, string, string, string];
    note: (year: string) => string;
    picture: string;
  };
  co2: { heading: string; note: string; columns: [string, string] };
  capacity: {
    heading: string;
    note: (undated: string) => string;
    columns: [string, string, string, string, string, string];
  };
  pipeline: {
    heading: string;
    sentence: (mw: string, renewable: string) => string;
    columns: [string, string, string];
  };
  closed: {
    heading: string;
    item: (name: string, from: number, to: number, mw: string) => string;
    none: string;
  };
  grid: { heading: string; sentence: (free: string, total: string, date: string) => string; link: string };
  geothermalHeading: string;
  target: { heading: string; text: string; measured: string };
  method: { heading: string; items: string[]; official: string };
  variables: string[];
  variableOfficial: string;
}

export const TRANSITION_COPY: Record<Lang, TransitionCopy> = {
  hr: {
    title: "Zelena tranzicija u Hrvatskoj: pokazatelji",
    description:
      "Udio obnovljivih izvora u proizvodnji struje, CO₂ intenzitet, instalirana snaga obnovljivih izvora, što se gradi i što se gasi te slobodni kapacitet mreže u Hrvatskoj, iz otvorenih podataka.",
    descriptionOfficial:
      "Službeni udio obnovljivih izvora prema Eurostatu i cilj za 2030., udio u proizvodnji struje, CO₂ intenzitet, instalirana snaga obnovljivih izvora, što se gradi i što se gasi te slobodni kapacitet mreže u Hrvatskoj, iz otvorenih podataka.",
    heading: "Zelena tranzicija u Hrvatskoj",
    linkText: "Zelena tranzicija: pokazatelji za Hrvatsku",
    leadShare: (year, share, prevYear, prevShare) =>
      `U ${year}. obnovljivi izvori dali su ${share} proizvodnje struje u Hrvatskoj (${prevYear}.: ${prevShare}).`,
    leadShareOnly: (year, share) =>
      `U ${year}. obnovljivi izvori dali su ${share} proizvodnje struje u Hrvatskoj.`,
    leadCapacity: (year, mw) => `Instalirana snaga obnovljivih izvora u ${year}.: ${mw}.`,
    leadCo2: (month, value) => `CO₂ intenzitet proizvodnje struje (${month}): oko ${value} g/kWh.`,
    leadOfficial: (year, share, target) =>
      `Prema Eurostatu, obnovljivi izvori činili su ${share} bruto konačne potrošnje energije u Hrvatskoj u ${year}. (cilj za 2030.: ${target}).`,
    official: {
      heading: "Službeni udio obnovljivih izvora (Eurostat)",
      sentence: (year, share, eu) =>
        `U ${year}. obnovljivi izvori činili su ${share} bruto konačne potrošnje energije u Hrvatskoj${eu ? ` (EU-27: ${eu})` : ""}.`,
      gap: (target, gap) => `Do cilja od ${target} za 2030. nedostaje ${gap}.`,
      reached: (target) => `Cilj od ${target} za 2030. je dosegnut.`,
      points: ["postotni bod", "postotna boda", "postotnih bodova"],
      columns: ["Godina", "Ukupno", "Struja", "Grijanje i hlađenje", "Promet"],
      flags: (list) => `Oznake Eurostata: ${list}.`,
      flagWords: {
        b: "prekid vremenske serije",
        c: "povjerljivo",
        d: "drukčija definicija",
        e: "procjena",
        f: "prognoza",
        n: "nije značajno",
        p: "privremeno",
        r: "revidirano",
        s: "procjena Eurostata",
        u: "manja pouzdanost",
        z: "nije primjenjivo",
      },
      electricity:
        "„Struja” je udio prema pravilima Direktive o obnovljivoj energiji: proizvodnja hidroelektrana i vjetroelektrana svodi se na prosječnu godinu, a obnovljiva struja dijeli se s bruto konačnom potrošnjom struje. Zato se razlikuje od udjela obnovljivih izvora u proizvodnji struje na ovoj stranici, koji broji stvarnu proizvodnju svake godine.",
      source: "Izvor:",
      updated: (date) => `, Eurostat ažurirao ${date}`,
    },
    compare: {
      heading: (year) => `Usporedba sa susjedima i EU-om (${year}.)`,
      columns: ["Zemlja", "Ukupno", "Struja", "Grijanje i hlađenje", "Promet"],
      eu: "EU-27",
      earlier: (year) => `${year}.`,
      note: (year) =>
        `Srbija, Bosna i Hercegovina i Crna Gora nisu u EU-u, nego u Energetskoj zajednici; Eurostat objavljuje i njihove udjele, katkad godinu kasnije. Gdje za ${year}. nema podatka, u zagradi je godina zadnjeg podatka.`,
      missing: (names) => `Zemlje bez Eurostatovih udjela: ${names}.`,
    },
    share: {
      heading: "Udio obnovljivih izvora u proizvodnji struje",
      note: "Obnovljivi: hidro, vjetar, sunce, biomasa i geotermalna. Reverzibilne hidroelektrane se ne broje jer vraćaju struju koju su potrošile. Samo potpune godine.",
      columns: ["Godina", "Proizvodnja", "Iz obnovljivih", "Udio"],
    },
    solarCapita: {
      heading: "Sunčana struja po stanovniku",
      sentence: (year, gwh, kwh, place, of) =>
        `Fotonaponske elektrane u Hrvatskoj proizvele su ${year}. godine ${gwh} GWh struje, što je ${kwh} kWh po stanovniku: ${place}. mjesto među ${of} zemalja regije.`,
      behind: (first, kwh, times) => `Prva je ${first} s ${kwh} kWh po stanovniku, ${times} puta više.`,
      first: "To je najviše u regiji.",
      before: (year, kwh) => `Godine ${year}. bilo je ${kwh} kWh po stanovniku.`,
      columns: ["Zemlja", "kWh po stanovniku", "Proizvodnja (GWh)", "Stanovnika (prosjek godine)"],
      note: (year) =>
        `Izračun GridAtlasa, a ne brojka koju Eurostat objavljuje: bruto proizvodnja fotonaponskih elektrana podijeljena s prosječnim brojem stanovnika iste godine. Zemlje se uspoređuju u zadnjoj godini za koju sve imaju oba podatka (${year}.).`,
      picture: "Slika za dijeljenje: sunčana struja po stanovniku",
    },
    co2: {
      heading: "CO₂ intenzitet proizvodnje struje",
      note: "Grami CO₂ ekvivalenta po kWh proizvedene struje, u cijelom životnom ciklusu elektrane. Samo potpuni mjeseci. Uvoz se ovdje ne računa.",
      columns: ["Mjesec", "g CO₂/kWh"],
    },
    capacity: {
      heading: "Instalirana snaga obnovljivih izvora kroz godine",
      note: (undated) =>
        `Elektrane u pogonu, od godine prve jedinice. Bez godine puštanja u pogon (nisu u tablici): ${undated}.`,
      columns: ["Godina", "Hidro", "Vjetar", "Sunce", "Ostali obnovljivi", "Ukupno"],
    },
    pipeline: {
      heading: "Što se gradi i planira",
      sentence: (mw, renewable) =>
        `U izgradnji i planirano u Hrvatskoj: ${mw}, od toga ${renewable} iz obnovljivih izvora.`,
      columns: ["Izvor", "U pogonu", "U izgradnji i planirano"],
    },
    closed: {
      heading: "Zatvorene fosilne elektrane",
      item: (name, from, to, mw) => `${name}: ${from}.–${to}., ${mw}`,
      none: "U podacima nema zatvorenih fosilnih elektrana s godinom zatvaranja.",
    },
    grid: {
      heading: "Slobodni kapacitet distribucijske mreže",
      sentence: (free, total, date) =>
        `Prema HEP ODS-u (${date}) slobodnog kapaciteta za priključenje ima ${free} od ${total}.`,
      link: "Kapaciteti po trafostanicama",
    },
    geothermalHeading: "Geotermalna energija",
    target: {
      heading: "Cilj za 2030.",
      text: "Ažurirani Integrirani nacionalni energetski i klimatski plan (NECP) postavlja cilj od 42,5 % obnovljivih izvora u bruto konačnoj potrošnji energije 2030. Taj cilj obuhvaća svu energiju (struju, grijanje i hlađenje te promet), pa ga pokazatelji za struju na ovoj stranici ne mjere izravno; službenu vrijednost objavljuje Eurostat.",
      measured:
        "Ažurirani Integrirani nacionalni energetski i klimatski plan (NECP) postavlja cilj od 42,5 % obnovljivih izvora u bruto konačnoj potrošnji energije 2030. Taj cilj obuhvaća svu energiju (struju, grijanje i hlađenje te promet) i mjeri se službenim udjelom Eurostata (gore), ne udjelom u proizvodnji struje.",
    },
    method: {
      heading: "Metodologija i ograničenja",
      items: [
        "Proizvodnja po izvorima: ENTSO-E Transparency Platform (stvarna proizvodnja), zbrojevi po godinama i mjesecima.",
        "CO₂ intenzitet: emisijski faktori životnog ciklusa (IPCC AR5 WGIII, Annex III, medijani): ugljen 820, plin 490, biomasa 230, sunce 48, geotermalna 38, hidro 24, nuklearna 12, vjetar 11 g/kWh. Lignit se računa kao ugljen (stvarna vrijednost je viša), a nafta (650) i neraspoređeno (700) su pretpostavke. Skladištenje se ne broji.",
        "Instalirana snaga i zatvorene elektrane: OpenStreetMap i Global Energy Monitor; elektrana proširena kasnije broji se cijelom snagom od prve jedinice.",
        "U izgradnji i planirano: statusi iz OpenStreetMapa i Global Energy Monitora u ovom izdanju podataka.",
        "Slobodni kapacitet: HEP ODS (kapaciteti.hep.hr), uz dopuštenje, samo informativno.",
        "Sve brojke su iz otvorenih podataka i mogu se provjeriti; izvori i licence su na stranici „O karti”.",
      ],
      official:
        "Službeni udio obnovljivih izvora: Eurostat, skup podataka nrg_ind_ren (SHARES, pravila Direktive o obnovljivoj energiji), licenca CC BY 4.0; provjerava se jednom mjesečno. Vrijednosti s oznakom p (privremeno) ili e (procjena) još se mogu promijeniti.",
    },
    variables: [
      "udio obnovljivih izvora u proizvodnji struje",
      "CO₂ intenzitet proizvodnje struje",
      "instalirana snaga obnovljivih izvora",
      "snaga u izgradnji i planirana",
      "slobodni kapacitet mreže",
    ],
    variableOfficial: "udio obnovljivih izvora u bruto konačnoj potrošnji energije (Eurostat)",
  },
  en: {
    title: "Croatia's energy transition: indicators",
    description:
      "Renewable share of electricity generation, carbon intensity, installed renewable capacity, what is being built and closed, and free grid capacity in Croatia, from open data.",
    descriptionOfficial:
      "The official renewable share (Eurostat) against the 2030 target, renewable share of electricity generation, carbon intensity, installed renewable capacity, what is being built and closed, and free grid capacity in Croatia, from open data.",
    heading: "Croatia's energy transition",
    linkText: "Energy transition: indicators for Croatia",
    leadShare: (year, share, prevYear, prevShare) =>
      `In ${year}, renewable sources made ${share} of Croatia's electricity (${prevYear}: ${prevShare}).`,
    leadShareOnly: (year, share) => `In ${year}, renewable sources made ${share} of Croatia's electricity.`,
    leadCapacity: (year, mw) => `Installed renewable capacity in ${year}: ${mw}.`,
    leadCo2: (month, value) => `Carbon intensity of electricity generation (${month}): about ${value} g/kWh.`,
    leadOfficial: (year, share, target) =>
      `According to Eurostat, renewable sources made up ${share} of Croatia's gross final energy consumption in ${year} (2030 target: ${target}).`,
    official: {
      heading: "Official renewable share (Eurostat)",
      sentence: (year, share, eu) =>
        `In ${year}, renewable sources made up ${share} of Croatia's gross final energy consumption${eu ? ` (EU-27: ${eu})` : ""}.`,
      gap: (target, gap) => `That is ${gap} short of the 2030 target of ${target}.`,
      reached: (target) => `The 2030 target of ${target} has been reached.`,
      points: ["percentage point", "percentage points", "percentage points"],
      columns: ["Year", "Overall", "Electricity", "Heating and cooling", "Transport"],
      flags: (list) => `Eurostat's flags: ${list}.`,
      flagWords: {
        b: "break in time series",
        c: "confidential",
        d: "definition differs",
        e: "estimated",
        f: "forecast",
        n: "not significant",
        p: "provisional",
        r: "revised",
        s: "Eurostat estimate",
        u: "low reliability",
        z: "not applicable",
      },
      electricity:
        "“Electricity” is the share under the Renewable Energy Directive's rules: hydro and wind generation is normalised to an average year, and renewable electricity is divided by gross final electricity consumption. That is why it differs from the renewable share of generation on this page, which counts each year's actual generation.",
      source: "Source:",
      updated: (date) => `, updated by Eurostat on ${date}`,
    },
    compare: {
      heading: (year) => `Compared with the neighbours and the EU (${year})`,
      columns: ["Country", "Overall", "Electricity", "Heating and cooling", "Transport"],
      eu: "EU-27",
      earlier: (year) => year,
      note: (year) =>
        `Serbia, Bosnia and Herzegovina and Montenegro are not in the EU but in the Energy Community; Eurostat publishes their shares too, sometimes a year later. Where ${year} has no value, the year of the latest value is in brackets.`,
      missing: (names) => `Countries without Eurostat shares: ${names}.`,
    },
    share: {
      heading: "Renewable share of electricity generation",
      note: "Renewable: hydro, wind, solar, biomass and geothermal. Pumped storage is not counted, as it returns electricity it consumed. Complete years only.",
      columns: ["Year", "Generation", "From renewables", "Share"],
    },
    solarCapita: {
      heading: "Solar electricity per inhabitant",
      sentence: (year, gwh, kwh, place, of) =>
        `Photovoltaic plants in Croatia generated ${gwh} GWh of electricity in ${year}, which is ${kwh} kWh per inhabitant: place ${place} among the ${of} countries of the region.`,
      behind: (first, kwh, times) =>
        `${first} is first with ${kwh} kWh per inhabitant, ${times} times as much.`,
      first: "That is the most in the region.",
      before: (year, kwh) => `In ${year} it was ${kwh} kWh per inhabitant.`,
      columns: ["Country", "kWh per inhabitant", "Generation (GWh)", "Inhabitants (year's average)"],
      note: (year) =>
        `Calculated by GridAtlas, not a figure Eurostat publishes: the gross electricity production of photovoltaic plants divided by the average population of the same year. The countries are compared in the latest year all of them have both figures for (${year}).`,
      picture: "Picture to share: solar electricity per inhabitant",
    },
    co2: {
      heading: "Carbon intensity of electricity generation",
      note: "Grams of CO₂ equivalent per kWh generated, over the plant's whole life cycle. Complete months only. Imports are not counted here.",
      columns: ["Month", "g CO₂/kWh"],
    },
    capacity: {
      heading: "Installed renewable capacity over the years",
      note: (undated) =>
        `Plants in operation, from the year of their first unit. Without a commissioning year (not in the table): ${undated}.`,
      columns: ["Year", "Hydro", "Wind", "Solar", "Other renewables", "Total"],
    },
    pipeline: {
      heading: "What is being built and planned",
      sentence: (mw, renewable) =>
        `Under construction and planned in Croatia: ${mw}, of which ${renewable} renewable.`,
      columns: ["Source", "In operation", "Under construction and planned"],
    },
    closed: {
      heading: "Closed fossil power plants",
      item: (name, from, to, mw) => `${name}: ${from}–${to}, ${mw}`,
      none: "The data has no closed fossil power plants with a closing year.",
    },
    grid: {
      heading: "Free capacity in the distribution grid",
      sentence: (free, total, date) =>
        `According to HEP ODS (${date}), ${free} of ${total} have free capacity for new connections.`,
      link: "Capacity by substation",
    },
    geothermalHeading: "Geothermal energy",
    target: {
      heading: "The 2030 target",
      text: "Croatia's updated National Energy and Climate Plan (NECP) sets a target of 42.5% renewable energy in gross final energy consumption by 2030. The target covers all energy (electricity, heating and cooling, and transport), so the electricity indicators on this page do not measure it directly; Eurostat publishes the official value.",
      measured:
        "Croatia's updated National Energy and Climate Plan (NECP) sets a target of 42.5% renewable energy in gross final energy consumption by 2030. The target covers all energy (electricity, heating and cooling, and transport) and is measured by Eurostat's official share (above), not by the share of electricity generation.",
    },
    method: {
      heading: "Methodology and limitations",
      items: [
        "Generation by source: ENTSO-E Transparency Platform (actual generation), totals by year and month.",
        "Carbon intensity: lifecycle emission factors (IPCC AR5 WGIII, Annex III, medians): coal 820, gas 490, biomass 230, solar 48, geothermal 38, hydro 24, nuclear 12, wind 11 g/kWh. Lignite is counted as coal (its real figure is higher); oil (650) and unclassified (700) are assumptions. Storage is not counted.",
        "Installed capacity and closed plants: OpenStreetMap and Global Energy Monitor; a plant extended later counts at its full capacity from its first unit.",
        "Under construction and planned: statuses from OpenStreetMap and Global Energy Monitor in this data release.",
        "Free capacity: HEP ODS (kapaciteti.hep.hr), with permission, for information only.",
        "Every figure comes from open data and can be checked; sources and licences are on the About page.",
      ],
      official:
        "Official renewable share: Eurostat, dataset nrg_ind_ren (SHARES, the Renewable Energy Directive's rules), licence CC BY 4.0; checked once a month. Values flagged p (provisional) or e (estimated) may still change.",
    },
    variables: [
      "renewable share of electricity generation",
      "carbon intensity of electricity generation",
      "installed renewable capacity",
      "capacity under construction and planned",
      "free grid capacity",
    ],
    variableOfficial: "renewable share of gross final energy consumption (Eurostat)",
  },
};
