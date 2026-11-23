/** The prose of the generation and price pages (ENTSO-E, Faza 17-10), per language. */
import type { CountryCode } from "../domain";
import type { Lang } from "../state/url";

export interface EnergyCopy {
  generation: {
    title: string;
    description: string;
    heading: string;
    lead: (year: string) => string;
    linkText: string;
    columns: {
      country: string;
      year: string;
      total: string;
      renewable: string;
      load: string;
      largest: string;
      /** the generation-by-source table: one row per source */
      source: string;
      share: string;
    };
    countryTitle: (inCountry: string, from: string, to: string) => string;
    countryDescription: (
      country: string,
      from: string,
      year: string,
      total: string,
      renewable: string,
    ) => string;
    countryHeading: (inCountry: string) => string;
    countryLead: (
      country: string,
      year: string,
      total: string,
      renewable: string,
      mix: string,
      load: string,
    ) => string;
    yearsHeading: string;
    lastYearHeading: (year: string) => string;
    incomplete: string;
    note: string;
    /** "in Croatia" / "u Hrvatskoj"; Croatian needs the locative */
    inCountry: Record<CountryCode, string>;
  };
  prices: {
    title: string;
    description: string;
    heading: (date: string) => string;
    lead: (
      date: string,
      country: string,
      average: string,
      low: string,
      lowHour: string,
      high: string,
      highHour: string,
    ) => string;
    tomorrowLead: (date: string, average: string) => string;
    summaryHeading: string;
    hoursHeading: (date: string) => string;
    columns: {
      country: string;
      zone: string;
      average: string;
      low: string;
      high: string;
      tomorrow: string;
      hour: string;
    };
    note: string;
    linkText: string;
  };
}

const hr: EnergyCopy = {
  generation: {
    title: "Proizvodnja struje po zemljama i izvorima: Hrvatska i regija",
    description:
      "Koliko struje proizvode Hrvatska, Slovenija, Mađarska, Srbija, BiH, Crna Gora, Italija i Austrija i iz kojih izvora: godišnji zbrojevi i udio obnovljivih izvora prema ENTSO-E Transparency platformi.",
    heading: "Proizvodnja struje po zemljama i izvorima",
    lead: (year) =>
      `Zadnja potpuna godina u podacima ENTSO-E Transparency platforme: ${year}. Proizvodnja je zbroj prijavljene proizvodnje po izvoru; potrošnja je ukupno opterećenje sustava.`,
    linkText: "Proizvodnja struje po zemljama",
    columns: {
      country: "Zemlja",
      year: "Godina",
      total: "Proizvodnja",
      renewable: "Obnovljivi izvori",
      load: "Potrošnja",
      largest: "Najveći izvor",
      source: "Izvor",
      share: "Udio",
    },
    countryTitle: (inCountry, from, to) => `Proizvodnja struje ${inCountry} po izvorima (${from}.–${to}.)`,
    countryDescription: (country, from, year, total, renewable) =>
      `${country}: proizvodnja struje po izvorima od ${from}. U ${year}. ukupno ${total}, obnovljivi izvori ${renewable}. Podaci ENTSO-E Transparency platforme, po godinama i izvorima.`,
    countryHeading: (inCountry) => `Proizvodnja struje ${inCountry}`,
    countryLead: (country, year, total, renewable, mix, load) =>
      `${country} je u ${year}. proizvela ${total} struje; obnovljivi izvori dali su ${renewable}${mix ? ` (${mix})` : ""}.${load ? ` Potrošnja (ukupno opterećenje sustava) bila je ${load}.` : ""}`,
    yearsHeading: "Po godinama",
    lastYearHeading: (year) => `Po izvorima, ${year}.`,
    incomplete: "* nepotpuna godina: platforma nije prijavila sve dane",
    note: "Izvor: ENTSO-E Transparency Platform (stvarna proizvodnja po vrsti izvora, ukupno opterećenje). Dan bez podatka nije nula, nego ga nema; nepotpune godine su označene. Obnovljivi izvori: hidro, vjetar, sunce, biomasa, geotermalna; reverzibilne hidroelektrane nisu uračunate jer troše struju koju zatim vraćaju.",
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
  },
  prices: {
    title: "Cijena struje danas i sutra: burza, Hrvatska i regija",
    description:
      "Satne cijene struje na burzi dan-unaprijed za danas i sutra: Hrvatska (CROPEX), Slovenija, Mađarska, Srbija, Austrija i sjeverna Italija, s prosjekom, najnižom i najvišom cijenom dana.",
    heading: (date) => `Cijena struje na burzi, ${date}`,
    lead: (date, country, average, low, lowHour, high, highHour) =>
      `Cijena struje na burzi dan-unaprijed za ${date}, ${country}: prosječno ${average} €/MWh, najniža ${low} €/MWh (${lowHour}), najviša ${high} €/MWh (${highHour}).`,
    tomorrowLead: (date, average) => `Za ${date} prosjek je ${average} €/MWh.`,
    summaryHeading: "Po zemljama",
    hoursHeading: (date) => `Po satu, ${date} (€/MWh)`,
    columns: {
      country: "Zemlja",
      zone: "Zona",
      average: "Prosjek",
      low: "Najniža",
      high: "Najviša",
      tomorrow: "Sutra, prosjek",
      hour: "Sat",
    },
    note: "Izvor: ENTSO-E Transparency Platform, cijene dan-unaprijed po zoni trgovanja u €/MWh, po lokalnom satu. Cijene za sutra objavljuju se oko podneva. BiH i Crna Gora nemaju burzu. Ovo je veleprodajna cijena, ne cijena na računu kućanstva.",
    linkText: "Cijena struje danas",
  },
};

const en: EnergyCopy = {
  generation: {
    title: "Electricity generation by country and source: the region",
    description:
      "How much electricity Croatia, Slovenia, Hungary, Serbia, Bosnia and Herzegovina, Montenegro, Italy and Austria generate and from which sources: yearly totals and the renewable share, from the ENTSO-E Transparency Platform.",
    heading: "Electricity generation by country and source",
    lead: (year) =>
      `Latest complete year in the ENTSO-E Transparency Platform data: ${year}. Generation is the sum of reported generation per source; consumption is the total system load.`,
    linkText: "Electricity generation by country",
    columns: {
      country: "Country",
      year: "Year",
      total: "Generation",
      renewable: "Renewables",
      load: "Consumption",
      largest: "Largest source",
      source: "Source",
      share: "Share",
    },
    countryTitle: (inCountry, from, to) => `Electricity generation ${inCountry} by source (${from}–${to})`,
    countryDescription: (country, from, year, total, renewable) =>
      `${country}: electricity generation by source since ${from}. In ${year}, ${total} in total, renewables ${renewable}. ENTSO-E Transparency Platform data by year and source.`,
    countryHeading: (inCountry) => `Electricity generation ${inCountry}`,
    countryLead: (country, year, total, renewable, mix, load) =>
      `In ${year}, ${country} generated ${total} of electricity; renewables provided ${renewable}${mix ? ` (${mix})` : ""}.${load ? ` Consumption (total system load) was ${load}.` : ""}`,
    yearsHeading: "By year",
    lastYearHeading: (year) => `By source, ${year}`,
    incomplete: "* incomplete year: the platform did not report every day",
    note: "Source: ENTSO-E Transparency Platform (actual generation per production type, total load). A day without data is missing, not zero; incomplete years are marked. Renewables: hydro, wind, solar, biomass, geothermal; pumped storage is left out because it returns electricity it consumed.",
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
  },
  prices: {
    title: "Electricity prices today and tomorrow: Croatia and region",
    description:
      "Hourly day-ahead electricity prices for today and tomorrow: Croatia (CROPEX), Slovenia, Hungary, Serbia, Austria and northern Italy, with the day's average, lowest and highest price.",
    heading: (date) => `Electricity prices, ${date}`,
    lead: (date, country, average, low, lowHour, high, highHour) =>
      `Day-ahead electricity price for ${date}, ${country}: ${average} €/MWh on average, lowest ${low} €/MWh (${lowHour}), highest ${high} €/MWh (${highHour}).`,
    tomorrowLead: (date, average) => `For ${date} the average is ${average} €/MWh.`,
    summaryHeading: "By country",
    hoursHeading: (date) => `By hour, ${date} (€/MWh)`,
    columns: {
      country: "Country",
      zone: "Zone",
      average: "Average",
      low: "Lowest",
      high: "Highest",
      tomorrow: "Tomorrow, average",
      hour: "Hour",
    },
    note: "Source: ENTSO-E Transparency Platform, day-ahead prices per bidding zone in €/MWh, by local hour. Tomorrow's prices are published around noon. Bosnia and Herzegovina and Montenegro have no power exchange. This is the wholesale price, not a household tariff.",
    linkText: "Electricity prices today",
  },
};

export const ENERGY_COPY: Record<Lang, EnergyCopy> = { hr, en };
