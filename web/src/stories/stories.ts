/**
 * Guided stories (Faza 35-2): a few steps in which the map moves by itself, switches on what the step is
 * about and lights one kind of thing, while the reader reads two sentences. A story is data, not code: each
 * step names a view, layers and at most one spotlight, and is applied through the same state the address
 * bar holds, so a step can show nothing the reader could not have set by hand.
 *
 * Steps point at places, never at single objects by id: an object can leave the data with the next build,
 * a place cannot.
 */
import type { CountryCode, LayerKey } from "../domain";
import type { Spotlight } from "../map/spotlight";
import type { AppState, Lang, View } from "../state/url";
import { STORY_KEYS, type StoryKey } from "./keys";

export { STORY_KEYS, type StoryKey };

type Text = Record<Lang, string>;

export interface StoryStep {
  view: View;
  layers: readonly LayerKey[];
  /** the live flows and prices are part of the picture */
  live?: true;
  /** only these countries; absent: the whole region */
  countries?: readonly CountryCode[];
  /** one technology or voltage lit, the rest receding */
  spotlight?: Exclude<Spotlight, null>;
  /**
   * The story's point of light in this step: waiting at the start of the route, travelling its whole
   * length, or arrived at its end. Absent: no light.
   */
  traveller?: "start" | "travel" | "end";
  /** the map tilted and turned for this step (degrees); absent: flat, north up */
  tilt?: { pitch: number; bearing: number };
  title: Text;
  text: Text;
}

export interface Story {
  key: StoryKey;
  title: Text;
  summary: Text;
  /** the route its point of light follows (data/routes.ts); the story is offered only when the data has it */
  route?: string;
  steps: readonly StoryStep[];
}

const REGION: View = { lng: 16.2, lat: 44.6, zoom: 5.2 };
const CROATIA: View = { lng: 16.4, lat: 44.5, zoom: 6.5 };
const ZAGREB_AREA: View = { lng: 16.0, lat: 45.8, zoom: 9.3 };
const KRSKO: View = { lng: 15.515, lat: 45.938, zoom: 9.5 };

export const STORIES: Record<StoryKey, Story> = {
  "put-struje": {
    key: "put-struje",
    title: { hr: "Put struje od elektrane do utičnice", en: "From the plant to the socket" },
    summary: {
      hr: "Šest kratkih koraka kroz mrežu: gdje struja nastaje, kako putuje i kako stiže do vas.",
      en: "Six short steps through the grid: where electricity is made, how it travels and how it reaches you.",
    },
    steps: [
      {
        view: REGION,
        layers: ["lines"],
        title: { hr: "Jedna mreža za cijelu regiju", en: "One grid for the whole region" },
        text: {
          hr: "Svaka crta je dalekovod. Zajedno čine mrežu koja ne staje na granicama: struja proizvedena u jednoj zemlji u istom se trenutku troši u drugoj.",
          en: "Every line is a transmission line. Together they form a grid that does not stop at borders: electricity made in one country is used in another at the same moment.",
        },
      },
      {
        view: KRSKO,
        layers: ["lines", "plants", "substations"],
        title: { hr: "Sve počinje u elektrani", en: "It all starts at a plant" },
        text: {
          hr: "Krugovi su elektrane: boja je tehnologija, a veličina snaga. Ovo je okolica Nuklearne elektrane Krško. Uz svaku veću elektranu je trafostanica u kojoj se napon podiže za put.",
          en: "The discs are power plants: colour is the technology, size the power. This is the area around the Krško nuclear plant. Next to every larger plant is a substation where the voltage is raised for the journey.",
        },
      },
      {
        view: { lng: 16.3, lat: 45.6, zoom: 7.2 },
        layers: ["lines", "substations"],
        spotlight: { kind: "voltage", value: "380+" },
        title: { hr: "Autoceste za struju", en: "Motorways for electricity" },
        text: {
          hr: "Istaknuti su vodovi od 400 kilovolta. Što je napon viši, to se manje energije izgubi putem, pa se na velike udaljenosti struja prenosi baš njima.",
          en: "The 400-kilovolt lines are lit. The higher the voltage, the less energy is lost on the way, so over long distances electricity travels along these.",
        },
      },
      {
        view: ZAGREB_AREA,
        layers: ["lines", "substations"],
        title: { hr: "Čvorišta: trafostanice", en: "The nodes: substations" },
        text: {
          hr: "Oko velikog grada vodovi se skupljaju u trafostanice. Ondje se napon spušta, a mreža je isprepletena, tako da struja ima više putova ako jedan vod ispadne.",
          en: "Around a large city the lines gather in substations. There the voltage is lowered, and the grid is meshed, so electricity has more than one way round if a line fails.",
        },
      },
      {
        view: { lng: 15.98, lat: 45.81, zoom: 11.6 },
        layers: ["lines", "substations", "distribution"],
        title: { hr: "Zadnji kilometri", en: "The last kilometres" },
        text: {
          hr: "Tanje crte su distribucijska mreža: vodovi nižeg napona koji se granaju po četvrtima i ulicama sve do kućnog priključka.",
          en: "The thinner lines are the distribution grid: lower-voltage lines that branch through districts and streets all the way to the connection of a house.",
        },
      },
      {
        view: REGION,
        layers: ["lines", "plants"],
        title: { hr: "I sve to u istom trenutku", en: "And all of it at the same moment" },
        text: {
          hr: "Struja se ne skladišti u mreži: koliko se u ovom trenutku troši, toliko se u ovom trenutku proizvodi. Zato je cijela ova slika jedan stroj koji nikad ne staje.",
          en: "Electricity is not stored in the grid: as much as is being used right now is being generated right now. That makes this whole picture one machine that never stops.",
        },
      },
    ],
  },
  kilovatsat: {
    key: "kilovatsat",
    title: { hr: "Put jednog kilovatsata", en: "The journey of one kilowatt-hour" },
    summary: {
      hr: "Točka svjetla putuje stvarnim dalekovodima od vjetra u Dalmaciji do utičnice u Zagrebu.",
      en: "A point of light travels along real transmission lines from the wind in Dalmatia to a socket in Zagreb.",
    },
    route: "dalmacija-zagreb",
    steps: [
      {
        view: { lng: 16.45, lat: 43.78, zoom: 8.4 },
        layers: ["lines", "plants"],
        spotlight: { kind: "technology", value: "wind" },
        title: { hr: "Ovdje hvatamo vjetar", en: "Here we catch the wind" },
        text: {
          hr: "Istaknute su vjetroelektrane u zaleđu Dalmacije. Kad puše, proizvode struju, ali potrošači su daleko: do Zagreba je oko 250 kilometara zračne linije.",
          en: "The wind farms of the Dalmatian hinterland are lit. When it blows they generate electricity, but the users are far away: Zagreb is about 250 kilometres off as the crow flies.",
        },
      },
      {
        view: { lng: 16.501, lat: 43.602, zoom: 10.2 },
        layers: ["lines", "substations"],
        traveller: "start",
        title: { hr: "Priprema za put", en: "Getting ready for the road" },
        text: {
          hr: "Uz elektranu se napon diže na 110 ili 220 kilovolta, a u velikoj trafostanici Konjsko kraj Splita na 400. Što je napon viši, manje se energije izgubi na dugom putu.",
          en: "At the plant the voltage is raised to 110 or 220 kilovolts, and at the large Konjsko substation near Split to 400. The higher the voltage, the less energy is lost on a long way.",
        },
      },
      {
        // seen from the south-east, looking along the route towards Zagreb
        view: { lng: 15.45, lat: 44.85, zoom: 7.1 },
        tilt: { pitch: 48, bearing: -28 },
        layers: ["lines"],
        spotlight: { kind: "voltage", value: "380+" },
        traveller: "travel",
        title: { hr: "Energetska autocesta", en: "The energy motorway" },
        text: {
          hr: "Točka ide stvarnim vodovima od 400 kilovolta: od Konjskog preko Velebita i Meline kod Rijeke do Tumbra kraj Zagreba, oko četiristo kilometara. Tom mrežom upravlja HOPS.",
          en: "The point follows real 400-kilovolt lines: from Konjsko over Velebit and Melina near Rijeka to Tumbri near Zagreb, about four hundred kilometres. HOPS runs this grid.",
        },
      },
      {
        view: { lng: 15.868, lat: 45.681, zoom: 10.2 },
        layers: ["lines", "substations"],
        traveller: "end",
        title: { hr: "Silazak s autoceste", en: "Leaving the motorway" },
        text: {
          hr: "U trafostanici Tumbri napon se spušta s 400 na 110 kilovolta. Odavde vodovi nižeg napona kreću prema gradu i njegovim trafostanicama.",
          en: "At the Tumbri substation the voltage is lowered from 400 to 110 kilovolts. From here lower-voltage lines set off towards the city and its substations.",
        },
      },
      {
        view: { lng: 15.98, lat: 45.81, zoom: 11.6 },
        layers: ["lines", "substations", "distribution"],
        title: { hr: "Do utičnice, uz jednu ispravku", en: "To the socket, with one correction" },
        text: {
          hr: "Distribucijska mreža spušta napon do 230 volti u utičnici. I ispravka: struja ne putuje kao paket. Kilovatsat koji Zagreb troši netko u mreži proizvodi u istom trenutku; točka je bila slika, ne fizika.",
          en: "The distribution grid lowers the voltage to 230 volts at the socket. And a correction: electricity does not travel as a parcel. The kilowatt-hour Zagreb uses is generated somewhere in the grid at the same moment; the point was a picture, not physics.",
        },
      },
    ],
  },
  "odakle-struja": {
    key: "odakle-struja",
    title: { hr: "Odakle struja u Hrvatskoj", en: "Where Croatia's electricity comes from" },
    summary: {
      hr: "Voda, vjetar, sunce, pola jedne nuklearke i susjedi: izvori hrvatske struje, jedan po jedan.",
      en: "Water, wind, sun, half of a nuclear plant and the neighbours: the sources of Croatia's electricity, one by one.",
    },
    steps: [
      {
        view: CROATIA,
        layers: ["lines", "plants"],
        countries: ["HR"],
        title: { hr: "Elektrane u Hrvatskoj", en: "The plants in Croatia" },
        text: {
          hr: "Ovo su sve elektrane u Hrvatskoj koje otvoreni izvori poznaju. Boje u legendi kažu koja je koje vrste.",
          en: "These are all the plants in Croatia that open sources know of. The colours in the legend say which is which kind.",
        },
      },
      {
        view: CROATIA,
        layers: ["lines", "plants"],
        countries: ["HR"],
        spotlight: { kind: "technology", value: "hydro" },
        title: { hr: "Voda", en: "Water" },
        text: {
          hr: "Hidroelektrane su okosnica domaće proizvodnje: na Dravi na sjeveru te na rijekama i akumulacijama od Like do Dalmacije. Koliko daju, ovisi o tome koliko je godina kišna.",
          en: "Hydro plants are the backbone of domestic generation: on the Drava in the north and on rivers and reservoirs from Lika to Dalmatia. How much they give depends on how wet the year is.",
        },
      },
      {
        view: { lng: 16.4, lat: 43.9, zoom: 7.6 },
        layers: ["lines", "plants"],
        countries: ["HR"],
        spotlight: { kind: "technology", value: "wind" },
        title: { hr: "Vjetar", en: "Wind" },
        text: {
          hr: "Vjetroelektrane stoje ondje gdje puše: na grebenima dalmatinskog zaleđa i Like, uz vodove koji njihovu struju odvode prema gradovima.",
          en: "Wind farms stand where it blows: on the ridges of the Dalmatian hinterland and Lika, next to the lines that carry their electricity towards the cities.",
        },
      },
      {
        view: CROATIA,
        layers: ["lines", "plants"],
        countries: ["HR"],
        spotlight: { kind: "technology", value: "solar" },
        title: { hr: "Sunce", en: "Sun" },
        text: {
          hr: "Sunčane elektrane su najmlađe i najbrže rastu. Na karti su one veće, samostalne; krovne elektrane na kućama otvoreni izvori uglavnom ne bilježe.",
          en: "Solar plants are the youngest and grow the fastest. The map has the larger, stand-alone ones; rooftop systems on houses are mostly not recorded by open sources.",
        },
      },
      {
        view: KRSKO,
        layers: ["lines", "plants"],
        spotlight: { kind: "technology", value: "nuclear" },
        title: { hr: "Pola nuklearke preko granice", en: "Half of a nuclear plant across the border" },
        text: {
          hr: "Nuklearna elektrana Krško je u Sloveniji, ali je napola u hrvatskom vlasništvu, pa polovica njezine proizvodnje pripada Hrvatskoj.",
          en: "The Krško nuclear plant is in Slovenia, but it is half Croatian-owned, so half of what it generates belongs to Croatia.",
        },
      },
      {
        view: REGION,
        layers: ["lines"],
        live: true,
        title: { hr: "A ostatak: susjedi", en: "And the rest: the neighbours" },
        text: {
          hr: "Što domaće elektrane u nekom satu ne pokriju, dolazi preko granica, a kad je viška, odlazi. Strelice pokazuju kamo struja teče upravo sada.",
          en: "What domestic plants do not cover in a given hour arrives across the borders, and when there is a surplus it leaves. The arrows show where electricity is flowing right now.",
        },
      },
    ],
  },
  granice: {
    key: "granice",
    title: { hr: "Zašto su granice važne", en: "Why borders matter" },
    summary: {
      hr: "Kako su zemlje spojene, kamo struja teče i zašto u svakoj stoji drukčije.",
      en: "How countries are joined, where electricity flows and why it costs something different in each.",
    },
    steps: [
      {
        view: REGION,
        layers: ["lines"],
        spotlight: { kind: "voltage", value: "380+" },
        title: { hr: "Sustav bez granica", en: "A system without borders" },
        text: {
          hr: "Vodovi najvišeg napona prelaze granice kao da ih nema. Kontinentalna Europa radi kao jedan sustav na istoj frekvenciji od 50 herca.",
          en: "The highest-voltage lines cross borders as if they were not there. Continental Europe runs as one system at the same frequency of 50 hertz.",
        },
      },
      {
        view: { lng: 16.6, lat: 46.1, zoom: 7.3 },
        layers: ["lines", "substations"],
        spotlight: { kind: "voltage", value: "380+" },
        title: { hr: "Prijelazi: interkonektori", en: "The crossings: interconnectors" },
        text: {
          hr: "Vod koji spaja dvije zemlje zove se interkonektor. Ovdje se na malom prostoru susreću mreže Hrvatske, Slovenije i Mađarske.",
          en: "A line that joins two countries is called an interconnector. Here the grids of Croatia, Slovenia and Hungary meet within a small area.",
        },
      },
      {
        view: { lng: 16.3, lat: 42.6, zoom: 6.4 },
        layers: ["lines"],
        title: { hr: "I ispod mora", en: "Under the sea as well" },
        text: {
          hr: "Granica može biti i more. Podmorski kabel ispod Jadrana spaja Italiju i Crnu Goru, pa struja s Balkana može izravno do talijanskog tržišta i natrag.",
          en: "A border can be the sea. A submarine cable under the Adriatic joins Italy and Montenegro, so electricity from the Balkans can go straight to the Italian market and back.",
        },
      },
      {
        view: REGION,
        layers: ["lines"],
        live: true,
        title: { hr: "Kamo teče i koliko stoji", en: "Where it flows and what it costs" },
        text: {
          hr: "Strelice su tokovi preko granica u ovom satu, a boja zemlje cijena na burzi. Struja teče onamo gdje je skuplja, sve dok vodovi na granici imaju mjesta.",
          en: "The arrows are the flows across borders in this hour, and a country's colour is its price on the exchange. Electricity flows to where it is dearer, for as long as the lines at the border have room.",
        },
      },
      {
        view: REGION,
        layers: ["lines", "plants"],
        title: { hr: "Zato se isplati biti spojen", en: "Why being connected pays" },
        text: {
          hr: "Kad jednoj zemlji stane velika elektrana ili presuši voda, ostale je pokriju u istom trenutku. Što je više prijelaza, to je sustav sigurniji, a cijene ujednačenije.",
          en: "When a large plant stops in one country, or the water runs low, the others cover for it at the same moment. The more crossings there are, the safer the system and the more even the prices.",
        },
      },
    ],
  },
};

export function isStoryKey(raw: string | null): raw is StoryKey {
  return (STORY_KEYS as readonly string[]).includes(raw ?? "");
}

/**
 * The state a step shows: its layers, countries and live layer; nothing selected, the time machine off and
 * the map page in front. Everything else (language, theme, filters by status and voltage) stays the
 * reader's own.
 */
export function applyStep(state: AppState, step: StoryStep): AppState {
  return {
    ...state,
    page: "map",
    layers: new Set(step.layers),
    countries: new Set(step.countries ?? []),
    live: step.live === true,
    liveHour: null,
    selected: null,
    year: null,
  };
}

/** What a story changes and must give back when it ends. */
export type Before = Pick<AppState, "layers" | "countries" | "live" | "liveHour" | "year" | "view">;

export function remember(state: AppState): Before {
  const { layers, countries, live, liveHour, year, view } = state;
  return { layers, countries, live, liveHour, year, view };
}

/** The map as it was before the story, with the story gone from the address. */
export function leave(state: AppState, before: Before | null): AppState {
  return { ...state, ...(before ?? {}), story: null };
}

/** Whether `state` still holds exactly what was remembered (the sets and the view by identity). */
export function sameBefore(before: Before, state: AppState): boolean {
  return (
    before.layers === state.layers &&
    before.countries === state.countries &&
    before.live === state.live &&
    before.liveHour === state.liveHour &&
    before.year === state.year &&
    before.view === state.view
  );
}
