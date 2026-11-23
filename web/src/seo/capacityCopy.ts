/** The prose of the grid-capacity pages (HEP ODS, Faza 15), per language. */
import type { Category } from "../data/hep";
import type { Lang } from "../state/url";

export interface CapacityCopy {
  title: string;
  description: string;
  heading: string;
  /** the citable line: how many substations take nothing new, now and with an upgrade */
  lead: (none: string, total: string, noneUpgraded: string, date: string, version: string) => string;
  linkText: string;
  category: Record<Category, string>;
  categoriesHeading: string;
  areasHeading: string;
  noArea: string;
  upgradeHeading: string;
  upgradeNote: string;
  trendHeading: string;
  changesHeading: (from: string, to: string) => string;
  worse: string;
  better: string;
  rootsHeading: string;
  rootsNote: string;
  sourceHeading: string;
  source: string;
  openSource: string;
  columns: {
    category: string;
    existing: string;
    upgraded: string;
    area: string;
    stations: string;
    noneShare: string;
    station: string;
    ratio: string;
    free: string;
    additional: string;
    release: string;
    feeds: string;
  };
  station: {
    title: (name: string, ratio: string) => string;
    description: (name: string, category: string, free: string) => string;
    factsHeading: string;
    feedsHeading: string;
    historyHeading: string;
    openMap: string;
    labels: {
      existing: string;
      upgraded: string;
      free: string;
      additional: string;
      existingUsers: string;
      contracted: string;
      pending: string;
      total: string;
      minConsumption: string;
      transformers: string;
      planned: string;
      area: string;
      ratio: string;
      parent: string;
      position: string;
      onMap: string;
    };
  };
  /** the section an OpenStreetMap substation page gets when a HEP substation is the same place (17-7) */
  asset: { heading: string; text: (category: string, free: string) => string; link: string };
}

const hr: CapacityCopy = {
  title: "Slobodni kapacitet za priključenje: HEP ODS po trafostanici",
  description:
    "Gdje u distribucijskoj mreži HEP ODS-a još ima mjesta za nove elektrane i baterijske spremnike: kategorija prihvata i slobodni kapacitet po trafostanici 110/x i 35/x kV, po distribucijskom području i kroz vrijeme.",
  heading: "Slobodni kapaciteti distribucijske mreže (HEP ODS)",
  lead: (none, total, noneUpgraded, date, version) =>
    `Prema podacima HEP ODS-a (stanje ${date}, verzija ${version}) u postojećoj mreži ${none} od ${total} nema mogućnosti prihvata nove proizvodnje; uz nadogradnju transformacije 110/x kV bilo bi ih ${noneUpgraded}.`,
  linkText: "Slobodni kapaciteti mreže (HEP ODS)",
  category: {
    none: "nema mogućnosti prihvata",
    A: "A: do 5 MW",
    B: "B: do 10 MW",
    C: "C: do 20 MW",
    D: "D: više od 20 MW",
  },
  categoriesHeading: "Kategorije prihvata",
  areasHeading: "Po distribucijskom području",
  noArea: "bez navedenog područja",
  upgradeHeading: "Gdje bi nadogradnja transformacije otvorila najviše",
  upgradeNote:
    "Trafostanice čija bi kategorija s nadograđenom transformacijom 110/x kV bila viša, poredane po broju kategorija i dodatnom kapacitetu.",
  trendHeading: "Kroz izdanja",
  changesHeading: (from, to) => `Promjene između ${from} i ${to}`,
  worse: "Manje mjesta",
  better: "Više mjesta",
  rootsHeading: "Trafostanice",
  rootsNote:
    "Trafostanice 110/x kV i one bez nadređene trafostanice. Trafostanice 35/x kV nalaze se na stranici trafostanice koja ih napaja.",
  sourceHeading: "Izvor i napomena",
  source:
    "Izvor: HEP ODS, kapaciteti.hep.hr, uz dopuštenje HEP ODS-a. HEP ODS nastoji informacije održavati ažurnima, ali ne može jamčiti za njihovu pravodobnost ili točnost u trenutku predaje zahtjeva za EOTRP; podaci su isključivo informativne prirode i ne jamče priključenje. Kategorija je raspon, a slobodni kapacitet trafostanice 35/x kV ograničava i trafostanica iznad nje, pa se kapaciteti ne zbrajaju.",
  openSource: "Karta HEP ODS-a: kapaciteti.hep.hr",
  columns: {
    category: "Kategorija",
    existing: "Postojeća mreža",
    upgraded: "S nadogradnjom",
    area: "Distribucijsko područje",
    stations: "Trafostanica",
    noneShare: "Bez prihvata",
    station: "Trafostanica",
    ratio: "Omjer",
    free: "Slobodno",
    additional: "Dodatno uz nadogradnju",
    release: "Izdanje",
    feeds: "Napaja",
  },
  station: {
    title: (name, ratio) => `${name}${ratio ? ` ${ratio}` : ""}: slobodni kapacitet za priključenje`,
    description: (name, category, free) =>
      `Trafostanica ${name}: ${category}${free ? `, slobodno ${free}` : ""}. Podaci HEP ODS-a o mogućnosti priključenja elektrana i baterijskih spremnika, s poviješću izdanja.`,
    factsHeading: "Podaci",
    feedsHeading: "Trafostanice koje napaja",
    historyHeading: "Kategorija kroz izdanja",
    openMap: "Prikaži mjesto na karti",
    labels: {
      existing: "Kategorija, postojeća mreža",
      upgraded: "Kategorija, s nadogradnjom TS 110/x kV",
      free: "Slobodni kapacitet",
      additional: "Dodatno uz nadogradnju",
      existingUsers: "Postojeći korisnici",
      contracted: "Korisnici s ugovorom",
      pending: "Postupci u tijeku",
      total: "Ukupna priključna snaga",
      minConsumption: "Najmanja dnevna potrošnja",
      transformers: "Transformacija (MVA)",
      planned: "Planirana transformacija (MVA)",
      area: "Distribucijsko područje",
      ratio: "Prijenosni omjer",
      parent: "Napaja je",
      position: "Položaj",
      onMap: "Na karti",
    },
  },
  asset: {
    heading: "Slobodni kapacitet za priključenje (HEP ODS)",
    text: (category, free) =>
      `Prema HEP ODS-u: ${category}${free ? `, slobodno ${free}` : ""}. Podaci su informativni i ne jamče priključenje.`,
    link: "Detalji, povijest i trafostanice koje napaja",
  },
};

const en: CapacityCopy = {
  title: "Free grid capacity for new connections: HEP ODS",
  description:
    "Where HEP ODS's distribution grid in Croatia still has room for new power plants and battery storage: acceptance category and free capacity per 110/x and 35/x kV substation, by distribution area and over time.",
  heading: "Free capacity in the distribution grid (HEP ODS)",
  lead: (none, total, noneUpgraded, date, version) =>
    `According to HEP ODS (state of ${date}, version ${version}), ${none} of ${total} in the existing network take no new generation; with upgraded 110/x kV transformers it would be ${noneUpgraded}.`,
  linkText: "Free grid capacity (HEP ODS)",
  category: {
    none: "no capacity",
    A: "A: up to 5 MW",
    B: "B: up to 10 MW",
    C: "C: up to 20 MW",
    D: "D: more than 20 MW",
  },
  categoriesHeading: "Acceptance categories",
  areasHeading: "By distribution area",
  noArea: "no area given",
  upgradeHeading: "Where an upgraded transformer would open the most",
  upgradeNote:
    "Substations whose category would be higher with an upgraded 110/x kV transformer, ordered by the number of bands gained and the additional capacity.",
  trendHeading: "Across releases",
  changesHeading: (from, to) => `Changes between ${from} and ${to}`,
  worse: "Less room",
  better: "More room",
  rootsHeading: "Substations",
  rootsNote:
    "110/x kV substations and those without a parent substation. 35/x kV substations are listed on the page of the substation that feeds them.",
  sourceHeading: "Source and disclaimer",
  source:
    "Source: HEP ODS, kapaciteti.hep.hr, reused with HEP ODS's permission. HEP ODS keeps the information as current as it can but cannot guarantee it is timely or accurate when a connection request (EOTRP) is filed; the data is for information only and guarantees no connection. A category is a band, and the free capacity of a 35/x kV substation is also limited by the substation above it, so capacities are never added up.",
  openSource: "HEP ODS's map: kapaciteti.hep.hr",
  columns: {
    category: "Category",
    existing: "Existing network",
    upgraded: "With upgrade",
    area: "Distribution area",
    stations: "Substations",
    noneShare: "No capacity",
    station: "Substation",
    ratio: "Ratio",
    free: "Free",
    additional: "Added by upgrade",
    release: "Release",
    feeds: "Feeds",
  },
  station: {
    title: (name, ratio) => `${name}${ratio ? ` ${ratio}` : ""}: free grid capacity for new connections`,
    description: (name, category, free) =>
      `Substation ${name}: ${category}${free ? `, ${free} free` : ""}. HEP ODS data on connecting power plants and battery storage, with the history of releases.`,
    factsHeading: "Figures",
    feedsHeading: "Substations it feeds",
    historyHeading: "Category across releases",
    openMap: "Show the place on the map",
    labels: {
      existing: "Category, existing network",
      upgraded: "Category, with upgraded 110/x kV transformer",
      free: "Free capacity",
      additional: "Added by the upgrade",
      existingUsers: "Existing users",
      contracted: "Users with a contract",
      pending: "Requests in progress",
      total: "Total connection capacity",
      minConsumption: "Lowest daily consumption",
      transformers: "Transformers (MVA)",
      planned: "Planned transformers (MVA)",
      area: "Distribution area",
      ratio: "Voltage ratio",
      parent: "Fed by",
      position: "Location",
      onMap: "On the map",
    },
  },
  asset: {
    heading: "Free capacity for new connections (HEP ODS)",
    text: (category, free) =>
      `According to HEP ODS: ${category}${free ? `, ${free} free` : ""}. For information only; no connection is guaranteed.`,
    link: "Details, history and the substations it feeds",
  },
};

export const CAPACITY_COPY: Record<Lang, CapacityCopy> = { hr, en };
