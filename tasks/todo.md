# Plan: Energetska karta Hrvatske i susjednih zemalja

Status: 🟢 Sve otvorene odluke su zatvorene (2026-09-16). Pregled i popravci 2026-09-17: vidi odjeljak pri dnu. Podatke i ključeve (ENTSO-E, GEM, Cloudflare, MapTiler) korisnik dostavlja kasnije; do tada se radi ono što o njima ne ovisi.

## Cilj
Moderna, brza interaktivna karta elektroenergetske infrastrukture, građena isključivo iz primarnih otvorenih izvora
za **HR, SI, HU, RS, BA, ME, IT, AT** (Italija — morska granica; Austrija — na zahtjev, graniči sa SI, HU i IT; odluke 2026-09-16), s filtrima po statusu (u pogonu / u izgradnji / planirano),
tehnologiji, snazi i naponskoj razini, te automatskim ažuriranjem podataka.

## Opseg MVP-a
- **Elektrane:** lokacija, tehnologija, snaga (MW), status, godina, operator
- **Dalekovodi i kabeli:** po naponu (≤110, 220, 400 kV), status
- **Trafostanice / rasklopišta:** po naponu
- **Interkonektori:** prekogranični vodovi
- **Planirani projekti mreže:** TYNDP / PCI-PMI
- Izvan MVP-a (faza 2): podatkovni centri, plinovodi, tokovi snage uživo, statistike po zemlji

---

## Arhitektura (prijedlog)

```
[Izvori] → [Pipeline: preuzmi → normaliziraj → validiraj → spoji duplikate → izvezi]
        → [PMTiles datoteke na statičkom hostingu] → [Web: MapLibre GL]
```

**Zašto bez backenda i baze u MVP-u:** karta je samo za čitanje, a podaci se mijenjaju
tjedno, ne u sekundi. Statične vektorske pločice (PMTiles) su najjeftinije, najbrže i
najjednostavnije za održavanje. PostGIS + API dodajemo tek ako zatreba korisničko uređivanje
ili javni API.

| Sloj | Izbor | Razlog |
|---|---|---|
| Pipeline | Python 3.12, `osmium`, GeoPandas/DuckDB spatial, `pydantic` | Standard za geo-podatke, stroga validacija |
| Pločice | `tippecanoe` → **PMTiles** | Jedna datoteka, bez tile-servera |
| Hosting podataka | Cloudflare R2 (ili bilo koji S3 s HTTP Range) | Jeftino, CDN |
| Frontend | Vite + React + TypeScript (strict) | Jednostavno; Next.js tek ako treba SSR/SEO po stranici |
| Karta | **MapLibre GL JS** + `pmtiles` protokol | Open source, WebGL, brzo |
| Podloga | MapTiler Cloud (`dataviz`) + vlastita pričuvna podloga iz `boundaries.pmtiles` (odluka 2026-09-16, vidi Fazu 4) | Karta radi i bez MapTilera |
| Stanje | Filtri i pogled u URL-u (kao OGW) | Dijeljenje linkova |
| CI/CD | GitHub Actions | Lint, typecheck, testovi, zakazano ažuriranje |

Struktura repozitorija:
```
/pipeline   # Python ETL (sources/, normalize/, conflate/, export/)
/web        # React + MapLibre
/overrides  # ručne ispravke (YAML), verzionirane
/tasks      # todo.md, lessons.md
CLAUDE.md
```

---

## Izvori podataka

| Izvor | Što daje | Pokrivenost | Licenca | Kako |
|---|---|---|---|---|
| **OpenStreetMap** (Geofabrik izvadci) | Geometrija vodova, trafostanica, elektrana, napon | Svih 8 zemalja | ODbL | `.osm.pbf` po zemlji, `osmium tags-filter` na `power=*` |
| **Global Energy Monitor – Global Integrated Power Tracker** | Elektrane: snaga, status (uklj. planirane/u izgradnji), operator | Svih 8 | CC BY 4.0 (uz iznimke!) | Preuzimanje s GEM stranice (registracija) |
| **ENTSO-E Transparency Platform** | Instalirana snaga po proizvodnoj jedinici, proizvodnja, prekogranični tokovi | Svih 8 (članice ENTSO-E) | Uvjeti platforme | REST API, besplatan token |
| **ENTSO-E TYNDP** | Planirani prijenosni projekti i interkonektori | Regija | Provjeriti | Preuzimanje projektnih listi |
| **EU PCI/PMI lista + Energy Community** | Projekti od zajedničkog interesa (i za RS, BA, ME) | Regija | Javni dokumenti | Ručno/polu-automatski |
| **Operatori prijenosa** (HOPS, ELES, MAVIR, EMS, NOSBiH/Elektroprenos BiH, CGES, Terna, APG) | Desetogodišnji planovi razvoja mreže | Po zemlji | Provjeriti po izvoru | Ručno, kvartalno |
| **Regulatori** (HERA, AGEN-RS, MEKH, AERS, DERK, REGAGEN, ARERA, E-Control) + registri OIE projekata | Dozvole, novi projekti | Po zemlji | Provjeriti | Ručno/scraping samo gdje je dopušteno |
| **APG** (AT operator prijenosa) + **E-Control** (AT regulator) | Mrežni plan, statistike | AT | Provjeriti | Ručno/preuzimanje |
| **Terna** (IT operator prijenosa) | Podaci o sustavu, plan razvoja mreže | IT | Provjeriti | Download Center, ručno/API gdje postoji |
| **Terna Econnextion** | Geolocirani zahtjevi za priključenje OIE sa stanjem dozvola | IT | **Provjeriti uvjete prije bilo kakvog preuzimanja** | Samo ako je dopušteno |
| **EMODnet Human Activities** | Offshore vjetroelektrane, cjevovodi (Jadran); **kabeli ne** (EMODnet ih ima samo za DE, FR, NL, NO — jadranski dolaze iz OSM-a) | Cjevovodi: HR; vjetroelektrane: IT | Slobodno, bez ograničenja | WFS / zip preuzimanje |
| Open Infrastructure Map (kod, ne podaci) | Referenca za obradu OSM power tagova | — | Open source | Proučiti pristup |

Napomena za Italiju: OSM izvadak za cijelu Italiju je velik (uključuje Siciliju i Sardiniju) —
pipeline mora obrađivati zemlje odvojeno i paralelno, ne sve u jednom koraku.

---

## Proširenje: podaci kojih OpenGridWorks nema (kandidati)

OGW je statična karta infrastrukture. Naša prednost: **regionalna dubina + stanje sustava.**

| # | Sloj | Izvor | Pokrivenost | Učestalost | Napomena |
|---|---|---|---|---|---|
| A | Proizvodni miks, potrošnja, prekogranični tokovi (animirani interkonektori) | ENTSO-E API | Svih 8 | Po satu | Najjači "wow" efekt |
| B | Cijene dan-unaprijed po zoni trgovanja (IT ima više zona) | ENTSO-E API | Gdje postoji burza | Dnevno | Karta cijena po zonama |
| C | Ispadi i remonti elektrana | ENTSO-E API | Svih 8 | Po satu | Crveni status na elektrani |
| D | Punjenost akumulacija hidroelektrana | ENTSO-E API | Gdje se objavljuje | Tjedno | Bitno za HR, BA, ME, RS |
| E | CO₂ intenzitet struje | Izračun iz A + emisijskih faktora | Svih 8 | Po satu | Vlastiti izračun, bez licence treće strane |
| F | Plinska skladišta (npr. Okoli) i LNG terminali (Krk, IT terminali) | GIE AGSI+ / ALSI API (besplatni ključ) | EU dio | Dnevno | |
| G | Tokovi plina na interkonekcijama | ENTSOG Transparency | Regija | Dnevno | |
| H | Pipeline projekata: zahtjevi za priključenje | Terna Econnextion (IT), HOPS 10G plan (HR) | IT, HR | Kvartalno | Licenca IT izvora: otvoreno pitanje |
| I | Jadran: offshore vjetar, podmorski kabeli, cjevovodi | EMODnet | Jadran | Godišnje | |
| J | Potencijal sunca/vjetra + zaštićena područja (Natura 2000, CORINE) | Global Solar/Wind Atlas, EEA | Svih 8 | Rijetko | "Gdje se može graditi" |
| K | Emisije po postrojenju | EU ETS registar | Samo EU (HR, SI, HU, IT, AT) | Godišnje | RS, BA, ME nisu u ETS-u |
| L | Punionice za električna vozila | OSM / Open Charge Map | Svih 8 | Tjedno | Provjeriti licencu OCM-a |
| M | Vremenska crta razvoja mreže (klizač po godinama) | Postojeći podaci (godina puštanja u pogon) | Svih 8 | — | Značajka, ne novi izvor |
| N | **Usporedba proizvodnje po izvorima kroz mjesece i godine** | ENTSO-E (stvarna proizvodnja po tipu izvora) | Svih 8 | Dnevno dopunjavanje, povijest od 2015. | Zahtjev korisnika 2026-09-16, vidi niže |

Posljedica za arhitekturu: slojevi A–G su **podaci uživo** i ne idu u PMTiles. Rješenje bez
backenda: zakazani job svakih sat vremena piše male JSON datoteke (`/live/*.json`) na isti CDN,
a frontend ih spaja s geometrijom po stabilnom `id`-u. Backend i dalje nije potreban.

⚠️ Napomene o licencama:
- ODbL: izvedena baza mora ostati pod ODbL-om, atribucija obavezna.
- GEM: dio solarnih zapisa potječe iz TransitionZero podataka pod **CC BY-NC** → isključiti te
  zapise ako projekt bude komercijalan.
- Ne preuzimati podatke s karata bez jasne licence (npr. scraping tuđih web karata).

---

## Jedinstveni model podataka

```ts
type Status = "operating" | "construction" | "planned"; // MVP: napušteni objekti se ne uvoze
type Technology = "hydro" | "pumped_storage" | "solar" | "wind" | "gas" | "coal" | "lignite"
  | "nuclear" | "biomass" | "geothermal" | "battery" | "oil" | "other";

interface Provenance { source: string; sourceId: string; license: string; retrievedAt: string }

// Ugovor usklađen s pipelineom (Faza 1): ključevi su camelCase, id = "osm:{type}/{osmId}".
// Točke imaju jednu zemlju (`country`); vodovi imaju sve zemlje kroz koje prolaze (`countries`).
interface PowerPlant {
  id: string;
  name: string | null;
  country: "HR" | "SI" | "HU" | "RS" | "BA" | "ME" | "IT" | "AT";
  location: [lon: number, lat: number];
  technology: Technology;
  capacityMw: number | null;
  status: Status;
  commissioningYear: number | null;
  operator: string | null;
  provenance: Provenance[];
}

interface TransmissionLine {
  id: string;
  kind: "line" | "cable";
  voltagesKv: number[];        // jedinstveno, od najvišeg
  maxVoltageKv: number | null;
  circuits: number | null;
  isHvdc: boolean;
  countries: string[];         // ISO kodovi, najduži udio prvi; može uključiti zemlje izvan opsega
  isInterconnector: boolean;   // countries.length >= 2
  status: Status;
  operator: string | null;
  geometry: GeoJSON.LineString;
  provenance: Provenance[];
}

interface Substation {
  id: string; name: string | null; voltagesKv: number[]; maxVoltageKv: number | null; country: string;
  location: [number, number]; status: Status; operator: string | null;
  provenance: Provenance[];
}
```

## Spajanje duplikata (konflacija)
1. GEM je primarni izvor **atributa** elektrana (snaga, status); OSM je primarni izvor **geometrije**.
2. Par je kandidat ako: udaljenost < 2 km **i** ista tehnologija **i** sličnost imena ≥ prag.
3. Nejasni parovi idu u izvještaj za ručni pregled, ne spajaju se automatski.
4. Ručne ispravke u `overrides/*.yaml` primjenjuju se zadnje i nikad se ne gube pri ažuriranju.

---

## Zahtjev za kasnije: usporedba po mjesecima i godinama (zapisano 2026-09-16)

**Što korisnik želi:** npr. odabrati srpanj i vidjeti koliko je struje dalo sunce, a koliko hidroelektrane i nuklearne elektrane. Isto za bilo koji vremenski raspon, uz usporedbu mjeseci i godina.

**Primjeri pitanja koja stranica mora odgovoriti:**
- Srpanj 2026: koliko GWh iz sunca, hidro i nuklearnih elektrana, po zemlji i za cijelu regiju?
- Srpanj 2026 u odnosu na srpanj 2025 i 2024: rast ili pad po izvoru?
- Proizvoljan raspon (npr. 1. 6.–31. 8.): zbroj, udio u proizvodnji i udio u potrošnji.

**Napomena o značenju:** mjeri se *proizvodnja* po izvoru, ne "potrošnja iz solara" (struja se u mreži miješa). Uz proizvodnju prikazujemo ukupnu potrošnju, pa se vidi udio svakog izvora u potrošnji. To treba jasno napisati u sučelju.

**Podaci:**
- ENTSO-E Transparency: stvarna proizvodnja po tipu izvora (satno ili 15-minutno) i stvarna potrošnja; povijest od 2015.
- Italija ima više zona trgovanja: zbrajamo ih u zemlju, a zone ostaju dostupne za detalje.
- Pokrivenost i kvalitetu za BA i ME treba provjeriti. Rupe u podacima prikazujemo kao rupe, ne kao nulu.
- Krško (zajedničko HR/SI) ENTSO-E vodi pod Slovenijom; u sučelju to treba napomenuti.

**Prijedlog tehničkog rješenja (za razradu kad dođemo do toga):**
- Pipeline dnevno preuzima nove sate, a povijest se preuzima jednokratno.
- Unaprijed izračunati zbrojevi: dan, mjesec i godina po zemlji i izvoru, u malim JSON/Parquet datotekama na R2 (isti obrazac objave kao pločice).
- Proizvoljni rasponi: zbrajanje dnevnih vrijednosti u pregledniku. DuckDB-WASM samo ako to postane presporo.
- Sučelje: odabir mjeseca ili raspona, stupčasti grafikon po izvorima, usporedba godina jedna uz drugu, toplinska karta mjesec × godina.

**Ovisnosti:** ENTSO-E API token (tvoj zadatak iz Faze 0), Faza 4 (web) i Faza 6 (podaci uživo).

- [x] Razrađeno i napravljeno u Fazama 3, 3b i 3c

---

## Dizajn sustav (odobren smjer 2026-09-16)

**Smjer:** "kontrolna sala operatora mreže" — mirno, precizno, enterprise. Srednji tonovi:
ni bijelo ni crno. Jedan upečatljiv element: **karta s animiranim tokovima snage**. Sve ostalo tiho.

| Token | Svijetla (zadano) | Prigušena tamna | Uloga |
|---|---|---|---|
| `--canvas` "Beton" | `#DCDFE2` | `#2A3036` | Pozadina stranice |
| `--surface` "Porculan" | `#EEF0F1` | `#343B42` | Paneli |
| `--ink` "Grafit" | `#1E262E` | `#E4E8EC` | Tekst |
| `--muted` "Škriljevac" | `#5E6A75` | `#A3AEB8` | Sporedni tekst |
| `--accent` "Jadran" | `#1F6F8B` | `#5FB0CC` | Potrošnja, odabir, fokus |
| `--export` / `--import` | `#3E8E6A` / `#B57B25` | `#6DBF97` / `#DDA85A` | Neto izvoz / uvoz |

Boje izvora (prigušene): hidro, sunce, vjetar, plin, ugljen/lignit, nuklearna, biomasa, ostalo.

- **Tipografija:** IBM Plex Sans (tekst) + IBM Plex Sans Condensed (brojke, tabularne znamenke). Bez monospace etiketa, bez VELIKIH SLOVA u oznakama.
- **Ikone:** Lucide (inline SVG, bez vanjskog učitavanja), jedna debljina linije.
- **Raspored:** zaglavlje → traka ključnih brojki (jedan pojas, ne kartice) → karta + popis zemalja → proizvodnja vs potrošnja (24 h) + miks → neto pozicije + plin.
- **Kretanje:** samo tokovi na karti (nose značenje: smjer i jačina); poštuje `prefers-reduced-motion`.
- **Pristupačnost:** vidljiv fokus, kontrast AA, sve kontrole tipkovnicom, mobilni prikaz u jednom stupcu.

### Prototip dizajna (Faza 4a)
- [x] Plan dizajna zapisan
- [x] Interaktivni prototip s **jasno označenim demo podacima** (nije stvarno stanje sustava)
- [x] Demo model mora biti fizikalno dosljedan: neto pozicija zemlje = zbroj tokova preko granica; proizvodnja = potrošnja + neto izvoz
- [x] Automatska provjera dosljednosti modela prije objave (svih 24 sata, sve zemlje)
- [x] Pregled snimki zaslona (desktop, tamna tema, mobitel, odabrana zemlja) + test interakcija i pada CDN-a
- [ ] Povratna informacija korisnika na dizajn
- Izvan prototipa: sloj Jadran (EMODnet) — dolazi sa stvarnim podacima u Fazi 6, ne crta se izmišljen.

---

## Faze i zadaci

### Faza 0 — Postavljanje
- [x] Repozitorij, struktura mapa (`pipeline/`, `prototype/`, `web/` kasnije), README
- [x] CI za pipeline: ruff + mypy --strict + pytest (web CI dolazi s Fazom 4)
- [x] Ručni workflow `osm-build` za stvarne podatke (bez rasporeda do Faze 5)
- [x] Licenca koda: **MIT**, nositelj „Energetska karta – suradnici” (odluka korisnika 2026-09-17); podaci ostaju pod licencama izvora (ODbL)
- [ ] Registracija: ENTSO-E API token, GEM preuzimanje (radiš ti; koraci u `PRIPREMA.md` i Fazi 3)

### Faza 1 — OSM pipeline (tehnički plan, 2026-09-16)

**Tok:** `download → prefilter → extract → normalize → assign countries → dedupe → validate → write`

| Korak | Rješenje | Zašto |
|---|---|---|
| download | `httpx` stream, provjera `.md5` s Geofabrika, atomsko zapisivanje (`.part` → rename), preskoči ako se md5 nije promijenio | Nema napola skinutih datoteka; nema nepotrebnog skidanja 2 GB (Italija) |
| prefilter | `pyosmium` `BackReferenceWriter` s `KeyFilter("power", "construction:power", "proposed:power")` | Sužava Italiju s ~2 GB na nekoliko desetaka MB i zadržava čvorove potrebne za geometriju; bez vanjskog CLI alata |
| extract | `FileProcessor.with_locations().with_areas()` → linije (way), trafostanice i elektrane (node ili area → točka) | Jedan prolaz, geometrija iz OSM-a |
| normalize | Čiste funkcije: napon (`"400000;110000"`, `"400 kV"`), strujni krugovi, status po lifecycle prefiksima, tehnologija (`plant:source`, `plant:method`), snaga (`"520 MW"`, `"1,2 GW"`) | Sva "prljava" logika na jednom mjestu, 100 % pokriveno testovima |
| assign countries | Natural Earth 10m granice (javno dobro), `shapely` STRtree; linija koja dira ≥ 2 zemlje u opsegu = interkonektor | Izvadci se preklapaju na granicama, pa zemlja ne smije ovisiti o datoteci iz koje je objekt došao |
| dedupe | Ključ `osm:{type}/{id}` | Isti vod u dva izvatka postaje jedan zapis |
| validate | `pydantic` modeli + usporedba broja zapisa s prošlim buildom (pad > 10 % = greška) | Loš uvoz se ne objavljuje |
| write | GeoJSONSeq po sloju + `manifest.json` (broj zapisa, md5 izvora, vrijeme) | Ulaz za `tippecanoe` u Fazi 1b |

**Pravila filtriranja (nakon Faze 7A):** uvozi se sve, a 60 kV razdvaja dvije uloge (`osm/tags.py`, `Role`).
*Prijenos:* `power=line` i `power=cable` ≥ 60 kV, plus `power=line` bez napona (OSM ga čuva za visoki napon);
`power=substation` ≥ 60 kV ili bez napona. *Distribucija:* `power=minor_line` (bez obzira na napon), vodovi i
kabeli < 60 kV, `power=cable` bez napona, `substation=minor_distribution` i trafostanice < 60 kV.
Ne ulaze: `line=busbar`/`bay` (unutrašnjost trafostanice), pojedinačni `generator`, `power=transformer` i
napušteni objekti.

- [x] Preuzimanje Geofabrik izvadaka za 8 zemalja (URL-ovi iz službenog indeksa, ne pogađaju se)
- [x] Predfiltriranje na `power` ključeve (uključujući lifecycle prefikse)
- [x] Ekstrakcija linija, trafostanica i elektrana
- [x] Normalizacija napona, statusa, tehnologije i snage
- [x] Dodjela zemlje i detekcija interkonektora (provjereno na stvarnim granicama: MONITA → IT–ME, Ernestinovo–Pécs → HR–HU)
- [x] Validacija i usporedba s prethodnim buildom
- [x] Testovi: jedinični + end-to-end na OSM uzorku koji oponaša stvarno tagiranje (98 testova, mypy --strict čist)
- [ ] Prvo pokretanje na stvarnim izvadcima (tvoje računalo ili GitHub Actions → osm-build; sandbox nema pristup Geofabriku)
- [ ] Pregled prvog stvarnog manifesta: brojevi po slojevima, `ambiguous_capacity`, `skipped_site_relation_*`
- [ ] Faza 1c: podrška za `type=site` relacije elektrana (ako ih u regiji ima puno)

### Faza 1b — Vektorske pločice i objava na R2 (tehnički plan, 2026-09-16; zoom pravila ispravljena, vidi L-009)

**Tok:** `build (ndjson) → tile prep → tippecanoe → PMTiles provjera → upload na R2 → current.json → čišćenje starih buildova`

| Korak | Rješenje | Zašto |
|---|---|---|
| tile prep | Iz kanonskih `*.ndjson` pišemo lagane značajke: samo polja potrebna karti + atribut `minzoom` po naponu/snazi (**ne** `tippecanoe.minzoom`, vidi L-009) | Pločice ostaju male; puni podaci (s porijeklom) idu kao zaseban download |
| tippecanoe | `grid.pmtiles` (vodovi, trafostanice, elektrane; z3–z14) i `boundaries.pmtiles` (granice; z0–z8); globalni `--feature-filter` na `minzoom`, `--drop-rate=1`, bez `--drop-*` opcija | Ništa se ne gubi tiho; prevelika pločica ruši build |
| provjera | Čitanje PMTiles v3 zaglavlja (verzija, MVT, zoomovi, granice, broj pločica) | Neispravna datoteka se ne objavljuje; bez dodatnih biblioteka |
| R2 | `boto3` (S3 API), sučelje `ObjectStore` s R2 i memorijskom implementacijom | Logika objave testira se bez mreže; R2 se lako zamijeni |
| raspored ključeva | `builds/<id>/…` nepromjenjivo (`Cache-Control: immutable`), `current.json` kratko keširan i uploadan **zadnji** | Atomska zamjena verzije; CDN nikad ne miješa staru i novu verziju |
| ODbL | `lines/substations/plants.ndjson.gz` javno uz svaki build | ODbL traži da izvedena baza bude dostupna |
| čišćenje | Zadrži zadnjih 5 buildova, nikad trenutni | Kontrola troška, mogućnost povratka |

**Zoom pravila:** vodovi ≥ 380 kV od z3, ≥ 220 kV od z5, ≥ 110 kV od z7, ostalo od z8; interkonektori najkasnije od z5. Trafostanice ≥ 380 kV od z6, ≥ 220 kV od z7, ostalo od z9. Elektrane ≥ 500 MW od z3, ≥ 100 MW od z5, ≥ 10 MW od z7, ostalo od z9. Distribucija je u vlastitom arhivu (`distribution.pmtiles`, z10–z14): vodovi ≥ 30 kV od z10, ostali od z11; trafostanice ≥ 30 kV od z11, ostale od z12.

- [x] Modul `tiles`: priprema značajki, pokretanje tippecanoe, provjera PMTiles zaglavlja (sadržaj pločica potvrđen neovisnim JS čitačem)
- [x] Modul `publish`: `ObjectStore` (R2 + memorija), objava, `current.json`, čišćenje, povratak na stariji build
- [x] CLI: `energymap tiles build`, `energymap publish r2`
- [x] Testovi: stvarni tippecanoe (CI ga instalira i ne dopušta preskakanje), objava na memorijskoj pohrani, R2 zahtjevi preko botocore Stubbera (146 testova)
- [x] CI: tippecanoe u provjerama; `osm-build` gradi pločice i (opcionalno) objavljuje
- [x] `infra/`: CORS pravila za R2 i upute za postavljanje Cloudflarea
- [ ] **Tvoj dio:** bucket, javni pristup, CORS, API token, GitHub tajne (upute u `infra/README.md`)
- [ ] Prvo objavljivanje i provjera `current.json` + Range zahtjeva

### Faza 2 — GEM + konflacija (tehnički plan, 2026-09-16) — ✅ spremno, čeka pravu GEM datoteku

**Što znamo o formatu (GEM metodologija, provjereno 2026-09-16):** redovi su *blokovi* (unit/phase), ne elektrane;
stupac `Country/Area`; `GEM location ID` (L + 11 znamenki) i `GEM unit/phase ID` (G + 11 znamenki); stupac
točnosti lokacije; podstatusi za odgođeno/otkazano. **Točni nazivi svih stupaca nisu provjereni** → svi nazivi
na jednom mjestu, s alternativama, a nepoznat format ruši uvoz uz popis nađenih i nedostajućih stupaca.

| Korak | Rješenje | Zašto |
|---|---|---|
| čitanje | `.xlsx` (openpyxl, read-only, list se pronalazi po zaglavlju) ili `.csv` | GEM daje Excel; CSV za testove i ručne izvoze |
| filtar | naziv zemlje → ISO kod, pa provjera koordinata istim `CountryIndex`om kao OSM | Zemlja uvijek po položaju, kao i za OSM |
| status | operating → u pogonu; construction → u izgradnji; pre-construction/announced → planirano; shelved/cancelled/retired/mothballed → ne ulazi (broji se) | Karta prikazuje samo postojeće i realne projekte |
| tehnologija | `Type` + `Technology` + `Fuel` (npr. hydropower + pumped storage → reverzibilna; coal + lignite → lignit) | Isti rječnik kao OSM |
| agregacija | blokovi → jedan zapis po (lokacija, status); snaga se zbraja | Proširenje elektrane (planirani blok) ostaje vidljivo odvojeno |
| konflacija | kandidat: ista obitelj tehnologije, udaljenost ≤ 2 km (≤ 5 km kad je lokacija približna); ocjena = udaljenost + sličnost imena bez oznaka tipa ("HE", "TPP", "wind farm"…); pohlepno 1:1 | Jednostavno, objašnjivo, testirano |
| spojeno | id i položaj iz OSM-a; snaga, status, godina, operator iz GEM-a; oba izvora u `provenance` | Stabilni linkovi, bolji atributi |
| nejasno | slična tehnologija i blizina, ali slabo ime → `conflation.json` za pregled, **ne spaja se** | Bolje dva zapisa nego krivo spajanje |
| overrides | `overrides/conflation.yaml`: prisilno spoji / nikad ne spajaj | Ručne odluke preživljavaju svako ažuriranje |
| licenca | GEM = CC BY 4.0; zapisi s TransitionZero ID-om = CC BY-NC 4.0 (dopušteno, odluka #2) — zapisano po zapisu | Točna atribucija |
| web | pločice nose `sources` (i GEM link kad postoji); detalji i atribucija prikazuju stvarne izvore | Korisnik vidi odakle je koji podatak |

- [x] `gem/read.py`: čitanje (xlsx s naslovnim redovima i više listova, csv), mapiranje stupaca, jasne greške formata
- [x] `gem/normalize.py`: status, tehnologija, snaga (engleski format brojeva), godine, licenca; agregacija po lokaciji i statusu
- [x] `conflate.py`: kandidati, ocjena, 1:1 spajanje, izvještaj (`conflation.json`), overrides (`overrides/conflation.yaml`)
- [x] Shema: `provenance` za više izvora, s provjerom oblika id-a i dopuštenih licenci po izvoru
- [x] `build --gem PATH --overrides PATH`; GEM u manifestu (datoteka, SHA-256), `attributionSources` u `current.json`
- [x] Pločice i web: `sources`, GEM link, lokalizirana atribucija po izvorima, GEM id-jevi u linkovima
- [x] Testovi na izmišljenom uzorku (xlsx i csv), integracija, e2e; namjerno pokvarena pravila potvrdila da ih testovi hvataju
- [ ] **Kad stigne prava datoteka:** pokrenuti uvoz, uskladiti nazive stupaca, pregledati `conflation.json` za HR
- [x] **Faza 2b — GEM datoteka u automatici** (plan 2026-09-16) — napravljeno, testirano:
  - R2: `sources/gem/<sha256>-<ime>` (nepromjenjivo) + pokazivač `sources/gem/current.json` (ime, SHA-256, vrijeme), pokazivač se piše zadnji
  - `energymap sources gem-upload FILE`: prvo provjeri da se datoteka čita i ima elektrane u opsegu, tek onda upload
  - `energymap sources gem-fetch`: javni pokazivač → preuzimanje → provjera SHA-256; 404 = build bez GEM-a (zapisano), ostale greške ruše build
  - workflow `gem-upload` (ručno, polje za link iz GEM-ova e-maila): korisnik ne treba Python na računalu
  - `osm-scheduled` i `osm-build` koriste GEM kad postoji
  - čišćenje buildova nikad ne dira `sources/`
- [ ] **Pravno pitanje za kasnije:** baza se objavljuje pod ODbL-om (dopušta komercijalnu upotrebu), a sadrži i CC BY-NC zapise. Licenca je zapisana po zapisu i u `licenseNotes`, ali prije javnog lansiranja treba odlučiti izostavljaju li se ti zapisi iz preuzimanja ili se preuzimanje označava drukčije.

### Faza 3 — ENTSO-E: proizvodnja i potrošnja kroz vrijeme (tehnički plan, 2026-09-16) — ✅ jezgra gotova, čeka token

Prvi cilj je korisnikov zahtjev "usporedba po mjesecima i godinama" (odjeljak gore); podaci uživo (Faza 6)
koriste isti klijent.

**Provjereno (dokumentacija ENTSO-E + izvorni kod entsoe-py, 2026-09-16):**
- jedna adresa `https://web-api.tp.entsoe.eu/api`, token kao `securityToken`; 400 zahtjeva/min (inače 10 min zabrane, HTTP 429); najviše 1 godina po zahtjevu
- A75 (proizvodnja po tipu): `documentType=A75`, `processType=A16`, `in_Domain`; serija s `outBiddingZone_Domain` je **potrošnja** (npr. pumpanje)
- A65 (potrošnja sustava): `documentType=A65`, `processType=A16`, `outBiddingZone_Domain`
- vrijeme `periodStart/periodEnd` u UTC, `yyyyMMddHHmm`; točka = početak + (pozicija − 1) × rezolucija; `curveType A03` = vrijednost vrijedi do sljedeće točke
- EIC: HR `10YHR-HEP------M`, SI `10YSI-ELES-----O`, HU `10YHU-MAVIR----U`, RS `10YCS-SERBIATSOV`, BA `10YBA-JPCC-----D`, ME `10YCS-CG-TSO---S`, AT `10YAT-APG------L`, IT `10YIT-GRTN-----B` (+ 7 talijanskih zona)
- **Nije provjereno:** objavljuje li se A75 za Italiju kao cjelinu → prvo cijela zemlja, a ako nema podataka, zbroj zona; korišteni izvor zapisuje se u podatke

| Dio | Rješenje | Zašto |
|---|---|---|
| klijent | `httpx`, token iz okruženja (nikad u logu), ograničenje brzine, ponovni pokušaj za 429/5xx, "nema podataka" kao zaseban ishod | Pouzdano i pristojno prema API-ju |
| parser | `xml.etree` bez ovisnosti o imenskom prostoru; A01 i A03 krivulje; smjer serije | Točno čitanje svih oblika koje ENTSO-E šalje |
| energija | MW × trajanje intervala → MWh; dan po lokalnom vremenu (Europe/Zagreb, isti za svih 8 zemalja) | Mjeseci i dani kako ih ljudi razumiju |
| rupe | pokrivenost po danu (0–1); dan bez podataka je `null`, **nikad 0** | Zahtjev: rupe se prikazuju kao rupe |
| izvor istine | dnevni zbrojevi po godini (`energy/daily/<godina>.json`); mjesečni i godišnji se **izvode** iz njih | Mjesečni i dnevni prikaz se ne mogu razići |
| tehnologije | ENTSO-E B-kodovi → naš rječnik (B11 + B12 → hidro, B18 + B19 → vjetar…) | Isti nazivi i boje kao na karti |
| ažuriranje | ponovno dohvaćanje zadnjih 7 dana (ENTSO-E naknadno ispravlja podatke) + nedostajući dani; jednokratno punjenje od 2015. | Malo zahtjeva, uvijek svježe |

- [x] `entsoe/client.py`: zahtjevi, ograničenje brzine (120/min), ponovni pokušaji za 429/5xx, "nema podataka", token nikad u logovima ni porukama
- [x] `entsoe/parse.py`: A75 i A65, krivulje A01/A03, smjer, rezolucije
- [x] `entsoe/energy.py`: dnevna energija i pokrivenost (i dani od 23/25 sati), mapiranje tehnologija, izvođenje mjeseci i godina
- [x] `entsoe/store.py`: dnevne godišnje datoteke, spajanje koje čuva bolje podatke, stroga validacija; `entsoe/fetch.py` s rezervnim putem za talijanske zone
- [x] CLI `energymap energy fetch|refresh`; testovi na XML-u prema dokumentiranom obliku
- [x] **Faza 3b — objava i dnevna automatika** (plan 2026-09-16) — napravljeno i testirano, čeka token:
  - R2: `energy/daily/<godina>-<sha12>.json` i `energy/periods-<sha12>.json` (nepromjenjivo, adresirano sadržajem) + `energy/current.json` (pišem zadnji)
  - `energymap energy pull`: novi runner preuzima objavljene godine (provjera SHA-256); 404 = prazno; ostale greške ruše posao
  - `energymap energy publish r2|dir`: validira sve godine, izvodi `periods`, uploada samo promijenjeno, pa pokazivač
  - zaštita: broj pokrivenih dana po zemlji i godini ne smije pasti u odnosu na objavljeno (osim uz `--allow-drop`)
  - čišćenje: brišu se samo datoteke koje ne koristi ni trenutni ni prethodni pokazivač (povratak ostaje moguć)
  - workflowi: `energy-daily` (svaki dan, zadnjih 7 dana) i `energy-backfill` (ručno, od zadane godine); issue pri neuspjehu
- [x] **Faza 3c — web prikaz "Proizvodnja kroz vrijeme"** (plan 2026-09-16) — napravljeno; stvarni izgled provjeriti kad stignu pravi podaci:
  - novi prikaz uz kartu (računalo: široka ploča ispod karte; mobitel: puni zaslon), stanje u URL-u (`view=energy`, zemlja, mjeseci/godine, usporedba godina, raspon datuma)
  - podaci: `energy/current.json` → `periods` (mali) odmah; dnevne godišnje datoteke tek za proizvoljni raspon
  - grafikoni (Chart.js, učitava se tek kad zatreba): složeni stupci po izvoru po mjesecu + linija potrošnje; usporedba istog mjeseca kroz godine za odabrani izvor; raspon → zbrojevi i udjeli u potrošnji
  - rupe: nepotpuni mjeseci svjetliji i označeni ("podaci za 12 od 31 dana"), prazni mjeseci bez stupca, nikad 0
  - tekst u sučelju: "proizvodnja po izvoru", a udio u potrošnji kao posebna brojka (vidi napomenu o značenju)
  - pristupačnost: svaki grafikon ima tablicu s istim brojkama (prebacivanje graf/tablica)
  - testni podaci: pipeline skripta generira označene izmišljene godišnje datoteke samo za razvoj i e2e
- [ ] **Kad stigne token:** provjeriti Italiju (cijela zemlja ili zone), BA i ME pokrivenost, stvarni oblik odgovora; zatim jednokratno punjenje od 2015.
- [ ] **Tvoj dio:** registracija na transparency.entsoe.eu i e-mail na transparency@entsoe.eu s naslovom "Restful API access" (odgovor do 3 radna dana); token kao GitHub tajna `ENTSOE_TOKEN`
- [ ] Planirani prijenosni projekti (TYNDP) — nakon vremenskih serija

### Faza 4 — Web stranica (tehnički plan, 2026-09-16) — ✅ potvrđeno uz izmjenu podloge

**Cilj MVP-a:** istraživač stvarne mreže na karti. Dashboard s tokovima, cijenama i grafikonima proizvodnje iz prototipa dolazi u Fazi 6, **tek sa stvarnim ENTSO-E podacima**. U produkciji se nikad ne prikazuju izmišljene brojke.

**Tehnologija (verzije provjerene 2026-09-16):**

| Dio | Izbor | Zašto / napomena |
|---|---|---|
| Build | Vite 8 + React 19 | Brzo, standardno, statični izlaz za Pages |
| Jezik | TypeScript **6.0.x** (ne 7) | typescript-eslint 8.70 podržava TS < 6.1; bez njega nema provjera poput `no-floating-promises` |
| Karta | MapLibre GL JS 6 + `pmtiles` 4 | Otvoreni kod, WebGL, čita PMTiles izravno s R2 |
| Podloga | **MapTiler Cloud**, stilovi `dataviz` / `dataviz-dark` (odluka korisnika 2026-09-16), preko običnog MapLibrea | Ključ ograničen na naše domene; MapTiler logo mora biti vidljiv; kvota besplatnog plana oko 5 000 učitavanja mjesečno. ⚠️ Besplatni plan je samo za nekomercijalnu upotrebu (uvjeti MapTilera) i staje pri prekoračenju limita → **pričuvna podloga** iz vlastitog sloja granica u `grid.pmtiles`; karta radi i bez MapTilera |
| Grafikoni | Chart.js 4 (učitava se tek kad zatreba) | Isti kao u prototipu, mali |
| Ikone | lucide-react | Iste kao u prototipu |
| Stil | CSS moduli + tokeni iz prototipa (CSS varijable) | Dizajn sustav već postoji; bez dodatnog alata |
| Stanje | URL kao izvor istine (pogled, slojevi, filtri, odabrani objekt), validiran `zod`-om | Svaki prikaz se može podijeliti linkom |
| Kvaliteta | ESLint (typescript-eslint strictTypeChecked), Prettier, Vitest + Testing Library, Playwright | Jedinični, komponentni i e2e testovi + snimke zaslona |
| Hosting | Cloudflare Pages, deploy iz GitHub Actions (wrangler) samo kad sve provjere prođu; pregledne verzije za PR | Nema objave koda koji nije prošao provjere |

**Značajke MVP-a:**
- Karta s podlogom i slojevima: vodovi (boja po naponu, isprekidano za izgradnju/plan, istaknuti interkonektori i HVDC), trafostanice, elektrane (boja po tehnologiji, veličina po snazi)
- Uključivanje slojeva i filtri: status, tehnologija, minimalna snaga, naponske razine, zemlja
- Klik na objekt → panel s detaljima, izvorom i linkom "Uredi u OpenStreetMapu" (na mobitelu donji list)
- Pretraga po imenu (elektrane, trafostanice)
- Pregled po zemlji: instalirana snaga po tehnologiji **prema OSM-u**, jasno označeno kao nepotpuno do Faze 2 (GEM)
- Legenda, atribucija po stvarnim izvorima builda (OSM/ODbL, GEM, EMODnet, Natural Earth, MapTiler kad je uključen), linkovi na preuzimanje baze
- Svijetla i prigušena tamna tema, HR/EN (čeka odluku #4), pristupačnost WCAG 2.2 AA

**Dodaci pipelineu (Faza 4a):**
- `search.json.gz` po buildu: id, ime, sloj, zemlja, koordinate
- `stats.json` po buildu: snaga i broj elektrana po zemlji, tehnologiji i statusu; kilometri vodova po naponu
- Sloj `countries` u `grid.pmtiles` (Natural Earth, kod države i oznaka je li u opsegu): pričuvna podloga i isticanje regije
- Imena država u sučelju iz preglednika (`Intl.DisplayNames`), bez dodatnih podataka

**Otpornost i sigurnost:**
- `current.json` se validira; ako podaci nisu dostupni, stranica to jasno kaže i nudi ponovni pokušaj
- Error boundary oko karte, svakog sloja i svakog panela
- `_headers`: CSP (samo naša domena podataka i api.maptiler.com), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`
- Bez kolačića i bez praćenja u MVP-u

**Proračun performansi:** početni JS ≤ 400 KB gzip (MapLibre je najveći dio), LCP < 2,5 s na 4G, 60 fps pri pomicanju karte na srednjem mobitelu.

**Struktura:**
```
web/
  src/app/        ljuska, rute, tema, jezik
  src/map/        MapLibre, stilovi slojeva, podloga, interakcije
  src/data/       učitavanje i validacija current.json, search, stats
  src/panels/     detalji, filtri, pregled, legenda
  src/ui/         gumbi, list, ikone, tokeni
  src/i18n/       hr.ts, en.ts (tipizirani rječnici, bez biblioteke)
  e2e/            Playwright s lokalnim testnim PMTiles
  public/_headers, fonts/, sprites/
```

**Redoslijed:**
- [x] 4a: indeks pretrage (`search.json`), `stats.json`, sloj `countries` (`boundaries.pmtiles`) i objava na R2
- [x] 4b: kostur (Vite 8, TS 6.0, ESLint strictTypeChecked, Prettier, Vitest), CI `web` s Pages deployem i preglednim verzijama
- [x] 4c: karta, MapTiler/rezervna podloga, slojevi sa stilovima (validirani službenim validatorom); e2e na PMTiles iz pravog pipelinea
- [x] 4d: filtri i slojevi u URL-u, legenda (sama se sklopi dok su detalji otvoreni)
- [x] 4e: panel s detaljima, pretraga (bez dijakritika), pregled po zemlji
- [x] 4f: teme, HR/EN, ARIA (tabovi, combobox, landmarkovi), mobilna traka s listovima; JS: ljuska ~112 KB gzip, karta ~286 KB gzip naknadno
- [ ] 4f-2: izmjeriti LCP i fps na stvarnim podacima i stvarnom mobitelu (ovdje nije moguće)
- [x] 4g: 20 e2e testova (računalo + mobitel) sa snimkama, `_headers` s CSP-om
- [ ] 4g-2: prvi produkcijski deploy i provjera MapTiler stila i loga na preglednoj verziji
- [ ] **Tvoj dio:** Cloudflare Pages projekt `energetska-karta` + API token (Pages: Edit) kao GitHub tajne
- [ ] **Tvoj dio:** MapTiler račun, API ključ ograničen na `energetska-karta.pages.dev` i `localhost`, spremljen kao GitHub tajna `MAPTILER_KEY`

### Faza 5 — Automatsko ažuriranje (tehnički plan, 2026-09-16) — ✅ napravljeno, čeka prvo pokretanje

**Problem koji rješava:** na čistom GitHub runneru nema prethodnog builda, pa bi zaštita "pad > 10 % = stop" bila tiho isključena. Usporedba mora ići s onim što je **stvarno objavljeno** na R2.

**Tok (tjedno, ponedjeljak 03:00 UTC, i ručno):**
`preuzmi (keš po MD5) → build uz baseline iz objavljenog current.json → diff s objavljenom bazom → pločice → objava → izvještaj`

| Dio | Rješenje | Zašto |
|---|---|---|
| baseline | `--baseline-url`: brojevi iz javnog `current.json`; 404 = prvi build (dopušteno, zapisano); svaka druga greška ruši build | Zaštita od pada radi i na praznom runneru; nedostupan R2 nikad ne isključuje zaštitu tiho |
| diff | Usporedba po `id` s objavljenim `*.ndjson.gz`: novo, uklonjeno, promijenjeno (bez `retrievedAt`, koji se mijenja svaki put); po sloju i zemlji; do 10 primjera | Vidi se *što* se promijenilo, ne samo koliko |
| izvještaj | `diff.json` u buildu (objavljuje se uz ostalo) + Markdown u sažetku GitHub posla | Pregled bez preuzimanja artefakta; kasnije "Što je novo" na stranici |
| keš | `actions/cache` za `data/raw` | Geofabrik se ne opterećuje; MD5 provjera ionako preskače nepromijenjeno |
| neuspjeh | Automatski GitHub issue (ili komentar na postojeći otvoreni) s linkom na posao | Pad ne ostaje neprimijećen; stara verzija ostaje objavljena |
| ovisnosti | Dependabot (pip, npm, GitHub Actions), tjedno | Dugoročno održavanje bez ručnog praćenja |
| svježina | Stranica ističe podatke starije od 14 dana | Korisnik vidi ako automatika stane |

- [x] `baseline.py`: čitanje objavljenog `current.json` i slojeva (404 = prva objava; ostale greške ruše build)
- [x] `diff.py`: usporedba i Markdown izvještaj (HR)
- [x] `build --baseline-url`, naredba `energymap diff`, `diff.json` u objavi (i u `current.json`)
- [x] Workflow `osm-scheduled.yml` (raspored, keš, izvještaj, issue pri neuspjehu); `osm-build` dijeli isto zaključavanje i istu usporedbu
- [x] `dependabot.yml` (TypeScript zadržan ispod 6.1 zbog typescript-eslinta)
- [x] Web: upozorenje za podatke starije od 14 dana
- [x] Testovi za sve gore (baseline, diff, integracija, CLI, statusna traka); namjerno pokvaren kod potvrdio da ih testovi hvataju
- [ ] **Tvoj dio (kasnije):** isti R2 podaci kao za `osm-build` + varijabla `DATA_BASE_URL`; nakon prve uspješne objave varijabla `SCHEDULE_OSM=true` (raspored je isključen dok je ne postaviš)

### Faza 6 — Podaci uživo i proširenja (vidi tablicu "Proširenje")
- [x] **Faza 6A — tokovi preko granica i cijene (pipeline)** (plan 2026-09-16) — napravljeno i testirano, čeka token:
  - provjereno u entsoe-py: 14 granica unutar opsega (AT–HU, AT–IT, AT–SI, HU–HR, HU–RS, HU–SI, SI–HR, SI–IT, RS–BA, RS–HR, RS–ME, ME–BA, ME–IT, BA–HR; **HR–ME ne postoji**); A11 tok X→Y = `out_Domain` X, `in_Domain` Y; A44 s `contract_MarketAgreement.type=A01`, vrijednost `price.amount`, više serija → redni broj 1
  - prozor: jučer 00:00 do prekosutra 00:00 (lokalno), jer se cijene za sutra objavljuju oko podneva
  - neto tok po satu = tok X→Y − tok Y→X; sat se računa samo ako su oba smjera potpuna
  - cijene po zoni trgovanja (HR, SI, HU, RS, AT, talijanske zone), satni prosjek iz 15-minutnih vrijednosti; BA i ME nemaju burzu → zapisano kao "nema podataka", ne greška
  - `live/current.json` (kratki keš), zamjenjuje se samo ako ima barem neke podatke; inače ostaje zadnje dobro stanje
  - workflow svaki sat
- [x] **Faza 6B — web: tokovi i cijene na karti** (plan 2026-09-16) — napravljeno; izgled provjeriti na stvarnim podacima:
  - sloj "Tokovi i cijene" u popisu slojeva (URL `live=1`), odabrani sat u URL-u (`lt=2026-09-16T13+02`, s UTC pomakom zbog dana promjene sata; stari oblik bez pomaka i dalje radi); bez odabira: trenutni sat
  - geometrija: luk između točaka unutar zemalja (fiksne točke, kao u prototipu), smjer = smjer neto toka, debljina ∝ MW, vrh strelice kao mali trokut (GeoJSON), pa radi i na rezervnoj podlozi bez fontova
  - brojke (MW, €/MWh) kao HTML oznake na karti, ne kao tekst u stilu (rezervna podloga nema fontove)
  - GeoJSON izvor ide kroz isti `setStyle(diff)` put kao ostali slojevi
  - traka na dnu karte: klizač kroz 72 sata s oznakama jučer/danas/sutra, tablica tokova i cijena za odabrani sat, napomena o zemljama bez burze i granicama bez podataka
  - sat bez podatka: nema strelice ni broja (ne 0)
  - `live/current.json` 404 → sloj javlja "još nije objavljeno"
  - testni podaci: pipeline skripta generira označeni `live/current.json` kroz pravi `collect()` s izmišljenim izvorom
- [x] **Faza 6C — Jadran: EMODnet cjevovodi i vjetroelektrane na moru** (plan 2026-09-16) — napravljeno i testirano; stvarni podaci prvi put u GitHub Actions (`emodnet-update`):
  - **provjereno:** WFS `https://ows.emodnet-humanactivities.eu/wfs` daje GeoJSON; slojevi `emodnet:pipelines` (stupci iz dokumentiranog odgovora: name, status, medium, operator, size_in, length_m, year, from_loc, to_loc, country_co), `emodnet:windfarms` i `emodnet:windfarmspoly` (name, n_turbines, power_mw, status, start/year, dist_coast, area_sqkm; statusi su se mijenjali između verzija)
  - **nalaz:** EMODnetove stvarne trase *energetskih kabela* dolaze samo iz DE, FR, NL i NO izvora, pa Jadran nije pokriven; jadranski kabeli (MONITA, otočni) već dolaze iz OSM-a kao vodovi vrste "kabel"
  - **ograničenje:** iz razvojnog okruženja EMODnet nije dostupan (mrežni filtar), pa se stvarni podaci prvi put dohvaćaju u GitHub Actions; kod glasno javlja neočekivan oblik podataka
  - izvor se sprema kao GEM: `sources/emodnet/` na R2 (mjesečno osvježavanje, provjera prije spremanja); buildovi koriste spremljenu kopiju, pa ispad EMODneta ne ruši tjedni build
  - novi sloj `pipelines` (podmorski cjevovodi: medij, status, operator, promjer, duljina); stari buildovi bez tog sloja i dalje se mogu objaviti (povratak)
  - vjetroelektrane na moru ulaze u sloj elektrana; preskaču se ako na 5 km već postoji vjetroelektrana iz OSM-a ili GEM-a
  - licenca: EMODnet dopušta ponovnu upotrebu uz navođenje izvora → atribucija "EMODnet Human Activities"
  - web: sloj "Cjevovodi (more)" u popisu slojeva, legenda, detalji; testni podaci označeni
- [ ] Zakazani job za ostale `/live/*.json` s validacijom i "zadnje dobro stanje" logikom
- [ ] Odabrani slojevi A–M (prema odluci #5)
- [ ] Statistike po zemlji (miks proizvodnje, planirani kapacitet)
- [ ] Podatkovni centri, plinovodi

## Pregled i popravci 2026-09-17 (nakon gubitka datoteka iz projekta)

**Polazište:** najnovija kopija (ona s Fazama 6B i 6C). Sve provjere su prolazile, ali pregled snimki zaslona i
workflowa našao je greške koje testovi nisu pokrivali.

### Napravljeno (potvrđeno: "provjeri, popravi")

| # | Nalaz | Rješenje | Kako je provjereno |
|---|---|---|---|
| 1 | Računalo: statusna traka prekrivala je dno trake "Tokovi i cijene" (dva elementa, svaki sa svojim `bottom`) | Jedan donji **dok** u `App` (stupac: tokovi iznad, status ispod). Trake više ne znaju gdje stoje; položaj određuje dok | novi `e2e/layout.spec.ts`: svaki par vidljivih plutajućih elemenata se ne smije sjeći, i s otvorenom tablicom |
| 2 | Mobitel: traka tokova prekrivala je mjerilo i **atribuciju** (mora biti uvijek vidljiva) | Na mobitelu je `main` stvarni stupac: karta, traka tokova, traka s gumbom. Trake uzimaju prostor od karte, pa MapLibreove kontrole same ostaju iznad; nema mjerenja visine u JS-u ni ručnih pomaka | isti test, projekt "mobile" |
| 3 | Niski prozor (1024 × 640): otvorena legenda ulazila je u gumbe za zumiranje | Legenda ima najveću visinu i kliže unutar sebe | isti test, mali prozor |
| 4 | "Detalji prekrivaju gumbe za zumiranje" iz prvog pregleda | **Nije bila greška** (mjerenje okvira: nema presjeka; linija na snimci bila je granica iz testnih podataka). Ostaje pokriveno testom | L-032 |
| 5 | Zakazani poslovi padali bi od prvog dana (`live-hourly` 24 puta dnevno do dolaska tokena) | Raspored je izričit prekidač: `SCHEDULE_OSM` (osm-scheduled, emodnet-update) i `SCHEDULE_ENTSOE` (energy-daily, live-hourly). Ručno pokretanje nije ograničeno i bez tajni i dalje glasno pada | `pipeline/tests/test_workflow_rules.py` (namjerno uklonjen uvjet ruši test), actionlint |
| 6 | Pages deploy crven do postavljanja Cloudflarea | Ime projekta je varijabla `PAGES_PROJECT`; bez nje se deploy preskače, provjere i e2e rade uvijek | isti test |
| 7 | GitHub gasi raspored nakon 60 dana bez aktivnosti | Bez lažnih commitova: opisano u `PRIPREMA.md` (odjeljak Održavanje) i `infra/README.md`; stranica pokazuje zastarjele podatke | — |
| 8 | Nema licence koda | `LICENSE` (MIT), README, `pyproject.toml`, `package.json` | instalacija paketa prijavljuje `MIT` |
| 9 | Promjer cjevovoda samo u inčima | "305 mm (12 in)" | jedinični test |
| 10 | Neusklađenosti u ovom dokumentu (Protomaps, dvostruke stavke, tablica rasporeda) | Ispravljeno na mjestu | — |

Pravilo za mobitel koje test provodi: otvoreni donji list (detalji, filtri) smije prekriti ono ispod sebe (traku tokova,
mjerilo, atribuciju) jer ga korisnik sam otvara i zatvara; gumbi i statusna traka ostaju slobodni uvijek.

Stanje nakon popravaka: pipeline 462 testa (s tippecanoeom, ništa preskočeno), web 197 jediničnih + 62 e2e pokretanja
(računalo i mobitel; 61 prolazi, 1 namjerno preskočen jer mali prozor vrijedi samo za računalo), ruff, mypy --strict, ESLint, Prettier, actionlint, produkcijski build — sve prolazi.

### Dogovoreni opseg koji još nije napravljen (svaki traži vlastiti plan i, većinom, novi ključ)
- [ ] **Sloj F — plin (GIE AGSI+/ALSI: skladišta i LNG)**: jedini od tri odabrana sloja (odluka #5: A, F, I) bez koda.
  Treba besplatni GIE API ključ → kad krene, dodati račun u `PRIPREMA.md`.
- [ ] **Sloj A — proizvodnja i potrošnja uživo** (satni miks, neto pozicije, traka ključnih brojki iz prototipa):
  napravljeni su tokovi i cijene (6A/6B) i povijest (Faza 3), ali ne i satni miks/potrošnja.
- [ ] **Planirani projekti mreže (TYNDP / PCI-PMI)**: u opsegu MVP-a, nema koda. Do tada planirano dolazi samo iz OSM-a i GEM-a.
- [ ] **ENTSO-E kapaciteti, mjesečno**: nema ni koda ni workflowa — napraviti ili maknuti iz tablice rasporeda.
- [ ] Faza 1c (`type=site` relacije): odluka tek nakon prvog stvarnog manifesta.

### Poznato, nije dirano
- U `lessons.md` nedostaje broj L-027 (preskočen ili izgubljen s datotekama); sadržaj se ne može rekonstruirati.
- `web.yml` umeće ime grane u naredbu za deploy; pokreće se samo za grane ovog repozitorija (ne za forkove), pa je
  rizik ograničen na suradnike s pravom pisanja. Pri sljedećoj izmjeni prebaciti u `env` (L-020).

**I dalje čeka korisnika (nepromijenjeno):** GitHub repozitorij, R2, Pages, MapTiler, ENTSO-E token, GEM datoteka,
povratna informacija na dizajn, pravno pitanje ODbL + CC BY-NC prije javnog lansiranja. Nijedan stvarni podatak još
nije prošao kroz sustav — prvi `osm-build` za HR je sljedeći stvarni test.

## Faza 7 — paritet slojeva s referentnom kartom, za regiju (prijedlog 2026-09-17, čeka potvrdu)

**Zahtjev korisnika:** svi mali dalekovodi, podatkovni centri i sve ostalo što ima opengridworks.com, ali za našu regiju.

**Kako je pregledano:** njihovi uvjeti korištenja (pročitani 2026-09-17) izričito zabranjuju pregledavanje AI agentima,
preuzimanje podataka i pločica te korištenje usluge "ili znanja stečenog iz nje" za izradu proizvoda koji je oponaša.
Zato kartu **nisam otvarao ni prihvaćao uvjete**; popis slojeva složen je iz javnih članaka o njoj (Fast Company,
Digital Substation, Medium, Hacker News, Tricuatro, Substack). Pravilo za nas: gradimo isključivo iz primarnih otvorenih
izvora, ne kopiramo njihove podatke, pločice, tekstove ni izgled. (Nisam pravnik; ako projekt postane javno vidljiv
kao "regionalna verzija" te karte, vrijedi pitati pravnika.) U ovom dokumentu formulaciju "po uzoru na" treba
zamijeniti opisom vlastitog cilja.

| Sloj na referentnoj karti | Njihov izvor | Kod nas danas | Izvor za regiju | Licenca | Ocjena |
|---|---|---|---|---|---|
| Vodovi visokog i srednjeg napona | OSM (+HIFLD za SAD) | ✅ **napravljeno u 7A**: prijenos + sloj distribucije | OSM: `power=line` < 60 kV i `power=minor_line` (35/20/10 kV) | ODbL | ✅ |
| Trafostanice | OSM | ✅ **napravljeno u 7A** (i distribucijske) | OSM: `substation=minor_distribution`; `power=transformer` namjerno izostavljen | ODbL | ✅ osim stupnih transformatora |
| Elektrane po tehnologiji i snazi | OSM, GEM, EIA | ✅ OSM + GEM (čeka datoteku) | — | — | Imamo |
| Baterije | kao tehnologija elektrane | ✅ u rječniku tehnologija | — | — | Imamo |
| **Podatkovni centri** | Epoch AI, IM3/PNNL (pretežno SAD) | ❌ | OSM (`telecom=data_center`, `building=data_center`) + ručni, verzionirani popis `overrides/datacenters.yaml` iz javnih objava operatora (svaki zapis s izvorom) | ODbL; vlastiti popis | **Izvedivo**, ali nepotpuno: za regiju ne postoji otvorena cjelovita baza. Komercijalni popisi (Data Center Map, Baxtel…) nemaju otvorenu licencu → ne preuzimamo. U sučelju jasno označiti "nepotpuno" |
| Plinovodi (kopno) | HIFLD (SAD) | ❌ (imamo samo morske, EMODnet) | OSM `man_made=pipeline` + GEM Global Gas Infrastructure Tracker (trase, status, planirano) | ODbL; CC BY 4.0 | Izvedivo; GEM traži još jedno preuzimanje uz registraciju (isti postupak kao za elektrane) |
| LNG i skladišta plina | — (nemaju) | ❌ planirani sloj F | GIE AGSI+/ALSI + GEM LNG tracker | uvjeti GIE; CC BY 4.0 | Već u planu (sloj F), traži GIE ključ |
| Planirani prijenosni projekti | OurGridFuture (SAD) | ◐ samo `proposed:`/`construction:` iz OSM-a | EK: karta projekata PCI/PMI (javni ArcGIS servis) + ENTSO-E TYNDP popis | **provjeriti prije koda** | Izvedivo nakon provjere licence; već u opsegu MVP-a |
| Punionice za električna vozila | AFDC (SAD) | ❌ kandidat L | OSM `amenity=charging_station` | ODbL | Izvedivo odmah; puno točaka (IT, AT) → tek od visokog zooma |
| Rizik od poplava / vode | WRI Aqueduct | ❌ | WRI Aqueduct (CC BY 4.0) ili JRC karte opasnosti od poplava (EU) | otvoreno | Izvedivo, niži prioritet; poligoni, zaseban PMTiles |
| Podmorski telekomunikacijski kabeli | TeleGeography | ❌ | TeleGeography | CC BY-NC-SA → ne smije u ODbL preuzimanje | Mala vrijednost za Jadran; **predlažem izostaviti** |
| Optička infrastruktura, koridori (ROW), "hpoints" | nejasno / SAD | ❌ | nema otvorenog izvora za regiju | — | Izostaviti |
| Statistika instalirane snage po zemlji | vlastiti izračun | ✅ `stats.json` + Pregled | — | — | Imamo |
| Razvoj kroz godine | godina puštanja u pogon | ❌ kandidat M | GEM `commissioningYear` (OSM `start_date` je rijedak) | — | Nakon što stigne GEM |
| Globus, satelitska podloga | MapLibre, NASA | ❌ | MapLibre globus; MapTiler satelit (besplatni plan) | — | Kozmetika; za regionalnu kartu globus nema smisla |
| Stanje u URL-u, detalji na klik, pretraga | ✅ | ✅ | — | — | Imamo |
| Tokovi, cijene, povijest proizvodnje, Jadran | **nemaju** | ✅ | — | — | Naša prednost |

### Tehničke posljedice "svih malih vodova" (najveća stavka)
- `MIN_VOLTAGE_KV` prestaje biti granica uvoza i postaje granica **prikaza**: nova klasa napona "< 60 kV" + `minor_line`
  kao vrsta voda; u pločice ulaze tek od z10–z11, distribucijske trafostanice od z12.
- Pravilo iz L-009 ostaje: nema `--drop-*` opcija, prevelika pločica ruši build. Zato prije stiliziranja treba
  **izmjeriti**: broj objekata po zemlji i najveća z10–z14 pločica za Italiju i Austriju (tamo je `minor_line` masovno
  ucrtan). Brojeve ne mogu dobiti odavde (Geofabrik i taginfo nisu dostupni iz ovog okruženja), pa ih daje prvi stvarni
  build; manifest treba dobiti brojače po klasi napona.
- Ako z10 pločice budu prevelike: mali vodovi idu u **zaseban** `distribution.pmtiles` (z11–z14), koji se učitava tek
  kad je sloj uključen. Osnovna karta ostaje brza, a proračun performansi iz Faze 4 vrijedi i dalje.
- Pokrivenost srednjeg napona u OSM-u je neujednačena (dobra u AT, SI i dijelovima IT; slaba u BA, ME, RS). Sloj se zato
  zove "Distribucijski vodovi (prema OSM-u, nepotpuno)", a ne "svi vodovi". Operatori distribucije (HEP ODS i dr.) ne
  objavljuju otvorene trase.
- Web: nova boja i tanja linija za klasu "< 60 kV", filtar napona dobiva još jednu stavku, sloj je zadano **isključen**.
  Podatkovni centri su zadano uključeni (malo ih je), punionice zadano isključene.

### Predloženi redoslijed (svaki korak je zaseban, provjerljiv i objavljiv)
- [ ] **7A — mali vodovi i distribucijske trafostanice (OSM)**: uvoz, brojači u manifestu, mjerenje pločica, odluka jedan ili dva PMTiles-a, stil, filtar, e2e
- [ ] **7B — podatkovni centri**: OSM + `overrides/datacenters.yaml`, novi sloj `datacenters` (ime, operator, snaga u MW kad je javno poznata, status), oznaka nepotpunosti
- [ ] **7C — plin na kopnu**: OSM plinovodi u postojeći sloj `pipelines` (isti model kao EMODnet), zatim GEM plinski tracker kad ga preuzmeš; ide zajedno sa slojem F
- [ ] **7D — punionice (OSM)**: točke od z11, zadano isključeno
- [ ] **7E — planirani prijenosni projekti**: prvo provjera uvjeta EK servisa i TYNDP-a, tek onda kod
- [ ] **7F — razvoj kroz godine** (nakon GEM-a), rizik od poplava (po želji)
- Izostavljamo: telekomunikacijski kabeli, optika, ROW, globus.

**Ovisnosti o tebi:** za 7A, 7B i 7D ništa novo. Za 7C drugo GEM preuzimanje (Global Gas Infrastructure Tracker). Za
7B je najvrednije ako imaš vlastiti popis podatkovnih centara u regiji koji smijemo objaviti.

### Faza 7A — napravljeno (2026-09-17)

**Stanje:** pipeline 495 testova (s tippecanoeom, ništa preskočeno), web 218 jediničnih, 72 e2e pokretanja,
ruff, mypy --strict, ESLint, Prettier, actionlint, produkcijski build — sve prolazi. Snimke zaslona pregledane.

**Što se promijenilo u odnosu na plan:**
- Deklarirati izvor pločica i ostaviti ga neupotrijebljenim **nije** besplatno: MapLibre pročita zaglavlje
  arhiva čim izvor postoji (L-036). Izvor se zato dodaje tek kad se sloj crta, a e2e test broji zahtjeve.
- Pri uvođenju klase „< 60 kV" ispravio sam pravilo u TypeScriptu, a ne i isti izraz za kartu (L-035).
  Sada postoji test koji izraz izvršava i uspoređuje s funkcijom.
- `INTERACTIVE_LAYERS` je dosad vraćao ime prekidača, što je slučajno bilo isto kao ime sloja u pločici.
  Za distribuciju to više ne vrijedi, pa sada vraća ime sloja u pločici (L-038). Time je usput popravljeno
  i razrješavanje dijeljenog linka: išlo je samo po `grid.pmtiles`, a sada po svim izvorima koje stil ima.
- `power=transformer` namjerno nije uključen.

**Mjerenje koje i dalje čeka stvarne podatke:** broj objekata po zemlji i veličina z10–z11 pločica za
Italiju i Austriju. Ako pločica bude prevelika, build **pada** (dokazano u 7A-0), pa se to ne može
previdjeti; rješenje je tada podizanje zoom praga, ne tiho izbacivanje.

### Faza 7A — distribucijska mreža (mali vodovi i trafostanice) — plan 2026-09-17, potvrđeno "kreni od 7A"

**Cilj:** ono što je danas izvan uvoza (`power=minor_line`, vodovi i kabeli ispod 60 kV, trafostanice
`minor_distribution`) ući će u bazu i na kartu kao **zaseban sloj "Distribucijska mreža"**, zadano isključen,
vidljiv tek od z10. Prijenosna mreža (≥ 60 kV) ostaje netaknuta: isti slojevi, isti brojevi, isti izgled.

**Zašto zaseban PMTiles, a ne novi atribut u `grid.pmtiles`** (odluka, ne mjerenje):
1. sloj je zadano isključen, a u `grid.pmtiles` bi njegove bajtove preuzimao **svaki** posjetitelj;
2. raspon zooma mu je z10–z14, a `grid` ide od z3 — spajanje bi značilo prazne atribute na svim nižim zoomovima;
3. ako distribucija prepuni pločicu, ruši se **samo** taj build sloja, a ne i prijenosna mreža.
MapLibre ne dohvaća pločice izvora koji nema nijedan vidljiv sloj, pa isključen sloj = nula prometa. To nije
pretpostavka nego se **provjerava e2e testom** koji gleda mrežne zahtjeve (ako se pokaže suprotno, izvor se
dodaje tek pri uključivanju sloja).

| Dio | Odluka | Zašto |
|---|---|---|
| model zapisa | **bez promjene sheme**: distribucijski vod je `TransmissionLine`, trafostanica je `Substation` | isti podaci, ista polja; razlikuje ih samo uloga, a uloga određuje **u koju datoteku** zapis ide |
| uloga | `tags.py`: `line_role()` i `substation_role()` vraćaju `transmission` ili `distribution`, umjesto dosadašnjih `is_*` provjera koje su vraćale "ulazi / ne ulazi" | pravilo ostaje na jednom mjestu, a "ne ulazi" se svodi na busbar/bay |
| kabel bez napona | dosad odbačen, sad ide u distribuciju | ništa se više ne baca tiho; najniža razina pouzdanosti dobiva najniži sloj |
| `power=transformer` | **ne ulazi** u 7A | to su stupni transformatori, ogroman broj, a nisu vodovi; zaseban zadatak ako zatreba |
| datoteke | `distribution_lines.ndjson`, `distribution_substations.ndjson` uz postojeće; oba **neobavezna** sloja | stariji buildovi ih nemaju i moraju ostati objavljivi (povratak) |
| pločice | novi arhiv `distribution.pmtiles`, z10–z14, slojevi `distribution_lines` i `distribution_substations` | imena su jedinstvena među arhivima, pa priprema slojeva ostaje "jedna datoteka po sloju" |
| zoom | vod: ≥ 30 kV od z10, ostalo od z11; trafostanica: ≥ 30 kV od z11, ostalo od z12 | na z10 se vidi zemlja i smisleno je samo 35/30 kV; niže razine su gradska mjerila |
| naponska klasa | nova klasa **`<60`** u pipelineu i na webu (dosad je sve ispod 110 padalo u `60-109`) | 20 kV vod ne smije se prikazivati kao 60–109 kV |
| statistika i pretraga | **ostaju samo prijenosna mreža** | pokrivenost distribucije u OSM-u je preneujednačena; zbroj kilometara po zemlji bio bi obmana, a indeks pretrage preuzima svaki posjetitelj |
| preuzimanja | distribucijske datoteke se objavljuju uz ostale | ODbL traži dostupnost izvedene baze |
| web: ključevi | razdvajaju se dva pojma koja su dosad slučajno bila isti popis: `LAYER_KEYS` (prekidači na karti, sad i `distribution`) i `DOWNLOAD_KEYS` (datoteke za preuzimanje) | prekidač je jedan, datoteke su dvije |
| zadano stanje | `DEFAULT_LAYER_KEYS` = sve osim `distribution` | sloj je zadano isključen; stari linkovi bez `l=` dobivaju isto ponašanje |

**Rizik koji 7A prvi put stvarno izlaže: prevelika pločica.** Dokumentacija modula `tiles.py` tvrdi da prevelika
pločica ruši build, ali tippecanoe u zadanim postavkama umjesto toga **izbacuje objekte** dok pločica ne stane
(`--drop-rate=1` sprječava samo prorjeđivanje po gustoći, ne i po veličini). Dosad se to nije moglo dogoditi jer
su podaci bili rijetki; s distribucijom hoće. Zato 7A **prvo provjerava stvarno ponašanje tippecanoea na gustom
uzorku**, pa tek onda gradi sloj: ako alat tiho izbacuje objekte, build to mora prepoznati i pasti (L-009 pravilo).

- [x] 7A-0: pokus — tippecanoe 2.49 uz `--drop-rate=1` **ne** izbacuje objekte: smanjuje točnost koordinata (detail), a kad ni to nije dovoljno pada s izlaznim kodom 110 i porukom „could not make tile small enough”. Tvrdnja u `tiles.py` je točna; regresijski test je čuva
- [x] 7A-1: `tags.py`: `Role`, `line_role()`, `substation_role()`, `Kind.MINOR_LINE`; 20 novih slučajeva u testovima
- [x] 7A-2: `extract.py` (`lines_for`/`substations_for`), `build.py` (dvije nove datoteke), `publish.py` (neobavezni arhiv); `diff`/`baseline` rade bez izmjena jer idu po `LAYERS`
- [x] 7A-3: `tiles.py`: arhiv `distribution` (z10–z14), zoom pravila, prazan arhiv se preskače, `ZOOM_STEPS` provjeren testom
- [x] 7A-4: web: izvor se deklarira samo dok je sloj uključen, 4 nova sloja pod prijenosnom mrežom, klasa `<60`, legenda, HR/EN, zadano isključeno
- [x] 7A-5: e2e `distribution.spec.ts` (6 testova ×2): arhiv se ne dohvaća dok je sloj isključen, uključivanje, dijeljeni link, klik, filtar napona, preuzimanja, snimka
- [x] 7A-6: sve provjere (pipeline 495, web 218, e2e 72), snimke pregledane, `README` i ovaj plan ažurirani; `PRIPREMA.md` nepromijenjena jer nema novih ključeva

**Što ostaje otvoreno do prvih stvarnih podataka:** stvaran broj objekata po zemlji i veličina z10–z11 pločica za
Italiju i Austriju. Mjeri se prvim `osm-build`-om; ako pločice budu prevelike, rješenje je podizanje zoom praga
(z11/z12), ne tiho izbacivanje.

### Faza 7B — podatkovni centri — plan 2026-09-18

**Cilj:** novi sloj „Podatkovni centri" iz dva izvora: OpenStreetMap i **ručni popis s obaveznim izvorom po
zapisu**. Za regiju ne postoji otvorena cjelovita baza, pa sloj od prvog dana nosi oznaku nepotpunosti.

**Što se NE radi:** ne izmišljam zapise. `overrides/datacenters.yaml` ide u repozitorij **prazan**, samo sa
shemom i pravilima; izmišljeni primjeri postoje isključivo u testnim uzorcima i tamo su označeni. Zapis bez
poveznice na javni izvor ne prolazi validaciju.

| Dio | Odluka | Zašto |
|---|---|---|
| OSM oznaka | `telecom=data_center` (dokumentirana shema) + lifecycle prefiksi za planirane | jedina ustaljena oznaka; planirani centri su ovdje najzanimljiviji |
| `building=data_center` | prihvaća se **ako objekt ionako prođe predfiltar**, inače se propušta | vidi rizik ispod |
| **predfiltar** | dodaje se ključ `telecom` (+ `construction:`/`proposed:`/`planned:`) | bez toga podatkovni centri nikad ne dođu do ekstrakcije: predfiltar drži samo `power*` |
| **ime predfiltrirane datoteke** | dobiva i hash popisa ključeva | inače promjena ključeva tiho koristi stari keš i sloj ostane prazan (rod L-015) |
| ručni popis | `overrides/datacenters.yaml`: `id` (slug), `name`, `operator`, `location [lon, lat]`, `status`, `powerMw?`, `year?`, `source` (**obavezno**, https) | ručna odluka preživljava svako ažuriranje i uvijek se zna odakle je |
| id | OSM: `osm:node/…`; ručni: `dc:<slug>` | stabilni linkovi za dijeljenje |
| spajanje | ručni zapis na < 1 km od OSM zapisa **dopunjuje** OSM (ime, operator, snaga), ostalo ulazi kao nov zapis; oba izvora u `provenance` | isti obrazac kao GEM ↔ OSM, samo jednostavniji: popis je malen i ručno provjeren |
| provenance | novi izvor `manual` s licencom `manual-sourced` i `url` iz `source` | licenca po zapisu; sučelje pokazuje odakle je |
| snaga | `powerMw` je **priključna/IT snaga kad je javno objavljena**, inače prazno; nikad procjena | procjena bi izgledala kao mjerenje |
| pločice | u `grid.pmtiles`, novi sloj `datacenters`, `minzoom` 6 | malo objekata, pa nema razloga za zaseban arhiv (obrnuto od 7A) |
| statistika | broj i zbroj MW po zemlji, uz `withPower` | isti obrazac kao `withCapacity` za elektrane: vidi se koliko je zapisa uopće imalo broj |
| pretraga | ulaze (imenovani, malo ih je) | korisnik će ih tražiti po imenu |
| web | zadano **uključen**, tamna četvrtasta oznaka izvan palete tehnologija, legenda, detalji sa snagom i izvorom | malo objekata; ne smiju se miješati s elektranama |
| oznaka nepotpunosti | ispod prekidača, kao kod distribucije | „nepotpuno" mora stajati uz podatak, ne u dokumentaciji |

**Rizik (zapisan prije koda):** `building=data_center` bez `telecom` oznake proći će kroz predfiltar samo
ako objekt nosi i neki `power`/`telecom` ključ. Filtriranje po ključu `building` nije opcija: to je jedan od
najčešćih ključeva u OSM-u i predfiltar bi izgubio smisao (Italija ~2 GB). Alternativa bi bila filtar po
paru ključ-vrijednost, ali pyosmium filtri se lančaju kao I, ne kao ILI. Zato: ostaje ovako, zapisano kao
poznato ograničenje, a važni centri ulaze kroz ručni popis.

- [x] 7B-1: shema `DataCenter`, izvor `manual` s obaveznim `url`, `tags.data_center()` + testovi
- [x] 7B-2: predfiltar (ključevi `telecom*`, hash ključeva u imenu predfiltrirane datoteke), ekstrakcija iz čvorova i ploha
- [x] 7B-3: `overrides/datacenters.yaml` (prazan + shema), `datacenters.py`: čitanje, stroga validacija, spajanje na 1 km
- [x] 7B-4: build, sloj u `grid.pmtiles` (z6), `search.json`, `stats.json` (`withPower`), atribucija ručnog popisa
- [x] 7B-5: web: sloj (zadano uključen), oznaka izvan palete tehnologija, detalji sa snagom i izvorom, legenda, pretraga, HR/EN
- [x] 7B-6: e2e `datacenters.spec.ts` (6 testova ×2), sve provjere, snimke pregledane, README

### Faza 7B — napravljeno (2026-09-18)

**Stanje:** pipeline 520 testova, web 218 jediničnih, 84 e2e pokretanja, ruff, mypy --strict, ESLint,
Prettier, actionlint — sve prolazi. Snimke zaslona pregledane.

**Što se promijenilo u odnosu na plan:**
- Kanio sam podatkovne centre nacrtati kao kvadrate da se ne miješaju s elektranama. Za to trebaju
  sprite ili SDF ikone, što je previše mehanike za jedan sloj; ostale su kružnice, ali **izvan palete
  tehnologija** (tamna škriljevac boja), uz zaseban odjeljak u legendi.
- Atribucija: dodavanjem ručnog popisa redak izvora prelomio se u **dva reda** i prekrio statusnu traku
  te mjerilo na prozoru 1024×640. Uhvatio ga je test rasporeda iz 7A. Popravak nije pomicanje brojke
  nego mjerenje: `MapView` mjeri visinu MapLibreovog donjeg desnog kuta i objavljuje je kao
  `--map-chrome`, a dok i legenda se od nje odmiču. Sljedeći izvor više ne može nikoga pokriti (L-039).
- `datacenters.ndjson` se piše i kad je prazan, kao i ostali neobavezni slojevi.

**Ograničenja zapisana u README-u:** `building=data_center` bez `telecom` oznake ne ulazi; ručni popis je
prazan dok se ne dodaju zapisi s izvorom.

## Što još možemo dodati — pregled 2026-09-18

Popis je složen po tome **koliko traži od tebe**, jer to je stvarni ograničavajući faktor, a ne kod.

### A. Ništa ti ne treba (možemo odmah)

| # | Što | Izvor | Trošak | Napomena |
|---|---|---|---|---|
| A1 | ~~Punionice za EV (7D)~~ | OSM | — | ✅ napravljeno 2026-09-18 |
| A2 | ~~Pregled po zemlji: podatkovni centri~~ | `stats.json` | — | ✅ napravljeno 2026-09-18 |
| A3 | **„Što je novo"** | `diff.json` koji već objavljujemo uz svaki build | srednji | tjedni pregled promjena; nitko od sličnih karata to nema |
| A4 | **Mjerila kvalitete po zemlji** | vlastiti izračun iz naših podataka | mali | koliko % vodova ima napon, elektrana snagu…; čini nepotpunost mjerljivom |
| A5 | **Vremenska crta (klizač po godinama)** | `commissioningYear` | srednji | ima smisla tek kad stigne GEM: OSM `start_date` je rijedak |
| A6 | **Dijeljenje slike/ugradnja karte** | — | srednji | „preuzmi sliku prikaza"; korisno za medije i prezentacije |
| A7 | **Trafostanice kao plohe** | OSM (već imamo geometriju, koristimo točku) | srednji | na velikom zumu prava ograda umjesto točke |

### B. Treba samo besplatna registracija (ti otvoriš račun, dalje ide samo)

| # | Što | Izvor | Čeka se |
|---|---|---|---|
| B1 | **Plin: skladišta i LNG** (sloj F, odluka #5) | GIE AGSI+ / ALSI | ključ, odmah |
| B2 | **Plinovodi na kopnu** (7C) | GEM Global Gas Infrastructure Tracker | preuzimanje, isti postupak kao za elektrane |
| B3 | **Satni miks proizvodnje uživo** (sloj A) | ENTSO-E (token već čekamo) | ništa novo osim tokena |
| B4 | **Ispadi i remonti elektrana** | ENTSO-E A77/A80 | isti token |
| B5 | **Punjenost akumulacija** | ENTSO-E | isti token; bitno za HR, BA, ME, RS |
| B6 | **CO₂ intenzitet struje** | izračun iz miksa + emisijski faktori | isti token; faktori su javni |

### C. Treba provjeriti licencu prije koda

| # | Što | Izvor | Pitanje |
|---|---|---|---|
| C1 | **Planirani prijenosni projekti** (TYNDP, PCI/PMI) | ENTSO-E TYNDP, karta projekata EK | uvjeti ponovne upotrebe |
| C2 | **Emisije po postrojenju** | EU ETS registar | samo EU dio regije |
| C3 | **Potencijal sunca i vjetra, zaštićena područja** | Global Solar/Wind Atlas, Natura 2000 | „gdje se smije graditi"; velike datoteke |

### D. Svjesno ne radimo

- **Podmorski telekomunikacijski kabeli** (TeleGeography): licenca CC BY-NC-SA se ne slaže s našim preuzimanjem, a za Jadran je vrijednost mala.
- **Optika, koridori (ROW), „hpoints"**: za regiju nema otvorenog izvora.
- **Stupni transformatori** (`power=transformer`): ogroman broj, a nisu vodovi.
- **Globus i satelitska podloga**: za regionalnu kartu nema koristi.

**Preporuka redoslijeda:** A2 → 7D → A3 → (kad stignu ključevi) B3 → B1/B2. Time dobivamo najviše po
uloženom, a ništa ne čeka na tuđu odluku.

### Faza 7D — punionice za električna vozila — plan 2026-09-18

| Dio | Odluka | Zašto |
|---|---|---|
| izvor | OSM `amenity=charging_station` + lifecycle prefiksi | jedini otvoreni izvor koji pokriva cijelu regiju |
| **predfiltar** | **drugi prolaz** s filtrom po paru ključ-vrijednost (`TagFilter`), ne po ključu | `amenity` je jedan od najčešćih ključeva u OSM-u; filtriranje po njemu bi predfiltar učinilo besmislenim. Provjereno: pyosmium filtri se lančaju kao I, pa OR nije moguć u jednom prolazu |
| cijena | izvor se čita dvaput | mjereno u minutama po zemlji, jednom po novom izdanju izvatka; druga datoteka ostaje sitna |
| polja | ime, operator, broj mjesta (`capacity`), status | snaga se **ne** uzima: u OSM-u je razbacana po `socket:*` ključevima i prečesto nedosljedna da bi se prikazala kao broj |
| pločice | zaseban arhiv `chargers.pmtiles`, z11–z14 | isti razlog kao za distribuciju: zadano isključen sloj ne smije nikoga koštati, a ima ih desetke tisuća |
| statistika i pretraga | ne ulaze | previše zapisa, a imena su generička |
| web | zadano isključen sloj, vlastita boja izvan palete tehnologija | punionice su potrošnja, ne proizvodnja |

- [x] 7D-1: `SourceFilter` u konfiguraciji (bira po ključu ili po paru), dvoprolazni predfiltar + testovi
- [x] 7D-2: shema `ChargingStation`, `tags.charging_station()`, `parse_points()`, ekstrakcija
- [x] 7D-3: build, arhiv `chargers.pmtiles` (z11–z14), objava kao neobavezni arhiv
- [x] 7D-4: web: sloj (zadano isključen), detalji, legenda, HR/EN, e2e `chargers.spec.ts`
- [x] 7D-5: sve provjere, snimke, README

### Faza 7D i pregled po zemlji — napravljeno (2026-09-18)

**Stanje:** pipeline 533 testa, web 223 jedinična, 92 e2e pokretanja, ruff, mypy --strict, ESLint,
Prettier, actionlint — sve prolazi. Snimke pregledane.

- Predfiltar je sada **popis prolaza** (`config.SOURCE_FILTERS`), a ne jedan popis ključeva. Prolaz bira
  ili po ključu ili po točnom paru ključ-vrijednost; `SourceFilter` odbija oboje odjednom. Time je
  punionicama otvoren put bez napuhavanja predfiltriranih datoteka, a sljedeći sloj (7C) dobiva isti
  obrazac besplatno.
- Punionice su treći arhiv pločica. Isti dogovor kao za distribuciju: izvor se deklarira tek kad je sloj
  uključen, a e2e broji mrežne zahtjeve da to i dokaže.
- Pregled po zemlji sada pokazuje i podatkovne centre, uz brojku „za koliko je snaga objavljena" — jer
  zbroj MW bez tog broja izgleda potpunije nego što jest.

### Kako pogledati stanje (dodano 2026-09-18)

Prototip u `prototype/` je **nadzorna ploča**, ne karta, i namjerno je ostao na izmišljenim brojkama
iz Faze 4a; sama ploča dolazi u Fazi 6 sa stvarnim ENTSO-E podacima. Novi slojevi žive u stvarnoj
aplikaciji, koja se sada pokreće jednom naredbom, bez ijednog ključa:

```
cd web && npm install && npm run preview:local     # → http://localhost:4173/
```

Skripta izgradi testne podatke kroz pravi pipeline, izgradi aplikaciju i posluži je. Podaci su
izmišljeni i tako označeni, ali aplikacija je stvarna. Na prototip je dodana napomena koja na to
upućuje, da stranica ne ostavlja dojam da je to cijeli projekt.

## Faza 8 — „wow" efekti: od dizajna do funkcionalnosti (plan 2026-09-19, „slobodno predloži")

Tri pravila za svaki efekt, da „wow" ne postane „uf": (1) temelji se na podacima koje **već** objavljujemo
(ništa ne čeka ključ), (2) poštuje `prefers-reduced-motion` i ne troši ništa dok je isključen,
(3) ima test koji ga mjeri. Efekti su složeni tako da svaki stoji sam; redoslijed je po dojmu po
uloženom satu.

| # | Efekt | Što posjetitelj dobiva | Kako | Provjera |
|---|---|---|---|---|
| 8A | **Lebdenje: isticanje + oblačić** | prelaskom miša objekt zasvijetli, uz kursor stoji ime, vrsta i ključna brojka (kV, MW, mjesta) — bez klika | `promoteId: "id"` na izvorima + `feature-state` „hover" u izrazima širine/opacitya (stil se ne mijenja, nema ponovnog diff-a); oblačić je HTML element koji prati kursor | jedinični: izrazi prolaze validator; e2e: hover nad elektranom → oblačić s imenom, odlazak → nestaje |
| 8B | **Tokovi uživo teku** | crtice putuju po luku u smjeru toka; smjer se vidi i bez čitanja strelice | drugi sloj nad lukovima s `line-dasharray` koji rAF petlja pomiče; staje uz `prefers-reduced-motion`, kad je kartica skrivena ili sloj isključen | jedinični: slijed uzoraka je cikličan i monoton; e2e: `data-flow-animation` = running/reduced |
| 8C | **„Što je novo"** | treći tab u bočnoj ploči: što je dodano, uklonjeno i promijenjeno od prošle objave, po sloju i zemlji, s primjerima na koje se skače klikom | `diff.json` već objavljujemo; pipelineu se dodaje koordinata primjera (bez nje se na primjer ne može skočiti); `panel=changes` u URL-u; tab se ne prikazuje kad build nema `diff` | pipeline: `test_diff` (koordinata, stara polja nepromijenjena); web: shema, jedinični za sažetak, e2e: tab → primjer → karta odleti i odabere ga |
| 8D | **Podijeli** | „Kopiraj poveznicu" (URL je već stanje) i „Preuzmi sliku" — PNG trenutnog prikaza s upisanom atribucijom (ODbL to traži) | slika se čita u `render` događaju nakon `triggerRepaint` (bez `preserveDrawingBuffer`, koji stalno košta); atribucija se crta na pomoćno platno | jedinični: sastavljanje platna; e2e: klik → preuzimanje → PNG potpis; poveznica u međuspremniku |
| 8E | **Dizajn: ulazi, staklo, kostur** | ploče uklizuju i blijede, prozirno „staklo" nad kartom, kostur umjesto praznine dok pregled učitava | samo CSS (`backdrop-filter`, `@starting-style`/keyframes), sve iza `prefers-reduced-motion` | e2e raspored ostaje zelen; snimke |
| 8F | **Tipkovnica** | `/` ide u pretragu, `Esc` zatvara detalje, `?` pokazuje popis prečaca | jedan `keydown` na dokumentu koji ignorira polja za unos | jedinični: rutiranje tipki; e2e: `/` fokusira pretragu |

**Namjerno ne:** 3D zgrade/pitch (regionalna karta, nema koristi), čestice po vodovima (nemamo tokove po
vodu, samo po granici — animacija bi glumila podatak koji nemamo), zvuk.

- [x] 8A hover + oblačić
- [x] 8B animacija tokova
- [x] 8C „Što je novo" (pipeline + web)
- [x] 8D podijeli: poveznica + PNG
- [x] 8E dizajnerski sloj
- [x] 8F prečaci
- [x] sve provjere, snimke, README, sažetak

### Faza 8 — napravljeno (2026-09-19)

**Stanje:** pipeline 534 testa, web 253 jedinična, 108 e2e pokretanja (+2 preskočena, nisu Chromium),
ruff, mypy --strict, ESLint, Prettier — sve prolazi. Snimke u `pregled-faza8/`.

- **8A** `promoteId: "id"` na svim izvorima pločica; širina vodova i obrub točaka reagiraju na
  `feature-state` „hover"; oblačić je jedan HTML element koji `MapView` pomiče izvan Reacta (60 puta u
  sekundi nema ponovnog renderiranja). Karta objavljuje `data-hovered` da test može provjeriti isticanje.
- **8B** sloj `energymap-live-dashes` nad lukovima; `flowAnimation.ts` daje uzorak crtica pomaknut za
  zadani korak (28 kadrova po ciklusu od 1,1 s). Petlja **čeka** da se stil smiri (L-043).
- **8C** `diff.py` daje primjerima koordinatu (središte obuhvata geometrije; uklonjeni objekt zadržava
  mjesto gdje je bio). Fixture za web sada ima i `diff.json` (izmišljena prethodna objava, jasno
  označena u `web_fixture.py`). Web: `data/diff.ts`, `ChangesPanel`, `panel=changes`, tab samo kad
  build ima `diff`; klik na primjer uključi sloj, odleti i odabere (uklonjeni: samo odleti).
- **8D** `ShareMenu` u statusnoj traci. PNG se čita u `render` događaju nakon `triggerRepaint`, pa
  `preserveDrawingBuffer` nije uključen (to košta svaki kadar). `snapshot.ts` crta podnožje s naslovom,
  datumom i svim atribucijama; e2e otvara preuzetu datoteku i čita PNG zaglavlje.
  *Ograničenje za kasnije:* HTML oznake (brojke tokova i cijena) i legenda nisu dio slike.
- **8E** `--glass`, `--motion`, `--ease-out` u tokenima; `@starting-style` za ulaz detalja i oblačića;
  `Skeleton` u pregledu i u „Novo"; globalni `prefers-reduced-motion`.
- **8F** `shortcuts.ts` (čisto rutiranje + hook), `ShortcutsHelp` kao `<dialog>`; prečaci ne rade dok
  je modal otvoren ni dok se tipka.

**Sljedeći koraci prema objavi (tvoj dio, PRIPREMA.md):** R2 + Pages varijable i tajne u GitHubu, prvo
`osm-build` pokretanje; tada vidimo stvarne veličine pločica za IT/AT i stvarni `diff.json`.

## Faza 9 — SEO i vidljivost za tražilice i AI alate (plan 2026-09-19, čeka potvrdu)

**Problem:** stranica je aplikacija koja se crta u pregledniku (SPA). Google izvršava JavaScript, ali
AI alati (GPTBot, ClaudeBot, PerplexityBot…) i većina ostalih čitaju **samo HTML koji dobiju**. Danas
bi dobili praznu ljusku. Zato je jezgra plana: **sadržaj mora postojati kao statični HTML**, izgrađen iz
naših podataka pri svakom buildu weba.

| # | Što | Kako | Zašto |
|---|---|---|---|
| 9-1 | **Meta osnove** | `<title>`, `description`, `canonical`, Open Graph + Twitter kartice, `hreflang` hr/en, favicon set, `theme-color` | minimum bez kojeg ništa drugo ne vrijedi |
| 9-2 | **Strukturirani podaci (JSON-LD)** | `WebSite` + `Dataset` (schema.org) za cijelu bazu, s licencom (ODbL), izvorima i poveznicama na preuzimanje; `Place`/`Organization` po objektu na statičnim stranicama | Google Dataset Search i AI alati čitaju upravo to |
| 9-3 | **Statične stranice iz podataka** | skripta u web buildu (`scripts/prerender.ts`) čita `current.json`, `stats.json`, `search.json` s objavljenih podataka i generira: `/o-karti/`, `/zemlja/hr/` … (snaga po tehnologiji, km vodova, brojevi), `/objekt/<id>/` za elektrane ≥ 10 MW i trafostanice ≥ 220 kV (ime, vrsta, snaga, napon, zemlja, izvor, poveznica na kartu) | to je ono što tražilica i AI stvarno indeksiraju; karta ostaje aplikacija |
| 9-4 | **Sitemap, robots, llms.txt** | `sitemap.xml` iz iste skripte (s `lastmod` = datum builda), `robots.txt` koji **dopušta** AI crawlere (odluka, vidi dolje), `llms.txt` s opisom, licencom, poveznicama na podatke i stranice | AI alati traže `llms.txt`; sitemap je jedini pouzdan način da 10k stranica bude nađeno |
| 9-5 | **Svježina** | web build se pokreće i nakon svakog uspješnog `osm-build` (repository_dispatch), ne samo na push; `lastmod` prati build | statične stranice ne smiju zaostajati za podacima |
| 9-6 | **Provjera** | test koji izgradi stranice iz fixture podataka i provjeri: svaki HTML ima title/description/canonical/JSON-LD koji prolazi shemu; sitemap ima sve stranice; Lighthouse SEO ≥ 95 u e2e | mjerljivo, kao i sve ostalo |

**Odluke koje trebam od tebe:** (1) **domena** — canonical, sitemap i OG traže apsolutne adrese;
(2) **AI crawleri:** dopustiti sve (cilj je da nas AI alati nađu) ili samo tražilice; (3) **stranice po
objektu:** prag (≥ 10 MW / ≥ 220 kV daje ~1–2 tisuće stranica; sve elektrane bile bi ~20+ tisuća).

**Namjerno ne:** SSR framework (Next/Astro) — prerender skripta daje isto za naš slučaj bez nove
arhitekture; plaćeni SEO alati; „AI sadržaj" bez podataka.

**Odluke (2026-09-19):** AI crawleri dopušteni svi; stranice po objektu za veće objekte (≥ 10 MW,
≥ 220 kV, svi podatkovni centri); domena još nije poznata → `SITE_URL` je varijabla, bez nje build
radi ali bez canonical/sitemapa (upozorenje u logu).

### Faza 9 — napravljeno (2026-09-19)

- `web/src/seo/`: `copy.ts` (tekstovi HR/EN), `pages.ts` (modeli stranica iz `current/stats/search`),
  `html.ts` (renderer bez skripti, JSON-LD s `\u003c` escapeom), `sitemap.ts` (sitemap s `xhtml:link`
  alternativama, dijeljenje iznad 5000 URL-ova, `robots.txt`, `llms.txt`), `prerender.ts` + `entry.ts`.
- Build: `npm run build` = `tsc` + `vite build` + `vite build --ssr src/seo/entry.ts` + `node`
  (`npm run prerender`). Podaci se čitaju s `VITE_DATA_BASE_URL` (produkcija) ili `LOCAL_DATA_DIR`.
  Build bez podataka pada namjerno.
- `index.html`: naslov/opis/OG/`WebSite` JSON-LD + statični sadržaj u `#root` za čitače bez JS-a
  (React ga zamijeni). `public/og.png` 1200×630. Zaglavlje aplikacije ima poveznicu „O karti".
- `web.yml`: `workflow_run` nakon `osm-scheduled`/`osm-build`; `VITE_SITE_URL` iz `vars.SITE_URL`.
- Testovi: 13 jediničnih (`seo.test.ts`), e2e `seo.spec.ts` (6×2: stranice, JSON-LD, sitemap → svaka
  stranica vraća 200, robots, llms, bez JS-a, poveznica iz karte). L-044 zapisana.

## Faza 10 — Gradovi: potrošnja struje po namjeni (plan 2026-09-19, čeka potvrdu)

**Ideja (tvoja):** otvoreni registar koliko koji veći grad troši — javna rasvjeta, javni prijevoz,
zgrade… **Provjera izvora (2026-09-19):** jedini otvoreni izvor koji to daje **po gradu i po sektoru za
cijelu regiju** je **Sporazum gradonačelnika (Covenant of Mayors / GCoM)** — JRC objavljuje sve
inventare emisija koje su gradovi predali: potrošnja energije u **MWh/god po sektoru i energentu**
(sektori iz predloška: općinske zgrade i oprema, tercijar, stambeni, **javna rasvjeta**, industrija,
**općinski vozni park**, **javni prijevoz**, privatni i komercijalni prijevoz). Format XLSX, tri
datoteke (potpisnici s koordinatama, akcijski planovi s inventarima, izvještaji praćenja). Uvjeti:
**„European Commission reuse notice"** — ponovna upotreba dopuštena uz navođenje izvora (paper ga
opisuje kao CC-BY); pristup bez registracije. Pokrivenost: EU27 6.501 grad s inventarom (Italija
najveći dio), istočna Europa izvan EU 216; točan broj po zemlji vidi se tek iz datoteke.

**Što to jest, a što nije — da ne obećamo krivo:**
- Jest: službeno predani podaci gradova, po sektoru, s godinom inventara (bazna godina + praćenje).
- Nije: „uživo". Svaki grad ima jednu do nekoliko godina (npr. 2011 i 2019). To je **registar**, ne
  brojilo. Ni jedan otvoreni izvor ne daje potrošnju grada u stvarnom vremenu.
- Vlakovi: željeznica je nacionalna (HŽ, SŽ, MÁV…), u gradskom inventaru je samo gradski prijevoz.
  Za željeznicu nema otvorene baze; ostaje kao ručni unos s izvorom (kao podatkovni centri).
- Pokrivenost ovisi o tome je li grad potpisnik i je li predao inventar: HR i HU dobro, IT vrlo dobro,
  SI/AT/RS/BA/ME slabo. To se mora vidjeti na karti (grad bez podataka nije „nula").

| Dio | Odluka |
|---|---|
| izvor | JRC GCoM datoteke df1 (potpisnici, koordinate, NUTS3) + df2/df3 inventari (sheet 2D_1 / 3D_1) |
| pipeline | novi modul `cities/` : preuzimanje (openpyxl), filtar po zemljama regije, **zadnji inventar po gradu** + bazni, sektori normalizirani u naš popis; strogo tipizirano, testovi na malom XLSX fixtureu |
| proizvod | `cities.ndjson.gz` + sloj `cities` u `grid.pmtiles` (z5–14) + `cities.json` za registar |
| web | sloj „Gradovi" (krug ∝ √MWh), detalji s razdiobom po sektoru (traka) i godinom, filtar po sektoru; **registar** kao stranica `/gradovi/` (sortabilna tablica) — ujedno statična SEO stranica iz Faze 9 |
| atribucija | „Covenant of Mayors / JRC (EC reuse notice)" u atribuciji i uz svaki zapis |

Koraci: 10-1 izvor i shema (+licenca u README), 10-2 pipeline + testovi, 10-3 pločice i objava, 10-4 web
sloj i detalji, 10-5 registar stranica, 10-6 provjere i snimke.

**Odluka (2026-09-19): potvrđeno „kreni".**

### Faza 10 — napravljeno (2026-09-19)

- **Izvor provjeren:** JRC objavljuje šest izdanja (najnovije `2025_Sixth_release`, srpanj 2025:
  df1 1,7 MB, df2 55 MB, df3 27 MB); `copyright.txt` kaže **CC BY 4.0**. Imena datoteka su
  nepravilna (razmaci, NBSP, `_final_`), pa se datoteke traže popisom mape po prefiksu `df1_/df2_/df3_`.
- **Pipeline:** `schema.Sector/SectorEnergy/CityEnergy`; `cities/read.py` (popis izdanja,
  preuzimanje, čitanje listova po prefiksu i zaglavlju, `inspect`), `cities/normalize.py` (sektori po
  ključnim riječima, jedinice MWh/GWh, alpha-3 → alpha-2, najnoviji inventar + bazni), `cities/load.py`;
  `--cities DIR` u buildu, `energymap cities download|inspect`; sloj `cities` u `grid.pmtiles`
  (z5/7/9 po broju stanovnika), sektori kao JSON string u pločici; `cities.json` registar; pretraga;
  atribucija `com`. Testovi: 20 (`test_cities.py`), uključujući build s fixtureom i odbijanje praznog.
- **Web:** sloj (zadano isključen, prozirni diskovi ∝ √MWh), detalji s trakama po namjeni i promjenom
  od bazne godine, oblačić, pretraga, legenda, preuzimanje; statične stranice `/gradovi/` i
  `/en/cities/` (tablica po zemlji: godina, stanovnici, struja, rasvjeta, javni prijevoz) i stranica
  po gradu ≥ 50 GWh sa sektorskom tablicom. e2e `cities.spec.ts`.
- **Workflow:** korak `energymap cities download` u `osm-build` i `osm-scheduled` s
  `continue-on-error`; nestanak sloja zaustavi build kroz `check_counts` (nema tihog gubitka).
- **Rizik zapisan:** stvarni raspored listova/stupaca nije bio dostupan iz sandboxa (JRC blokiran);
  čitač pada glasno i `cities inspect` ispisuje zaglavlja. Prva prava obrada može tražiti dopunu
  konstanti u `read.py` — očekivano, testirano na fixtureu.
- **Usput popravljeno:** na mobitelu su nova zaglavlja (gumb „O karti", četvrti red atribucije s
  gradovima) skratila kartu toliko da su se mjerilo i zoom preklopili. Statusna traka je na mobitelu
  jedan red koji se pomiče, gumbi u zaglavlju samo ikone, a atribucija na uskoj karti počinje
  sklopljena iza (i) — MapLibreov vlastiti compact način, samo bez čekanja na prvi potez.

**Stanje nakon Faze 9 i 10:** pipeline 555 testova, web 270 jediničnih, 126 e2e (+2 preskočena),
ruff, mypy --strict, ESLint, Prettier, actionlint — sve prolazi. Snimke: `pregled-faza8/` (7, 8) i
`pregled-faza9-10/`.

## Faza 11 — „živa slika": što još može biti uživo (pregled 2026-09-19, odgovor na pitanje)

Cilj je da što više bude **uživo**. Ovo su izvori koji to stvarno omogućuju, složeni po tome što traže:

| # | Sloj / podatak | Izvor | Osvježavanje | Treba |
|---|---|---|---|---|
| L1 | **Miks proizvodnje po zemlji** (hidro/vjetar/sunce/plin…) | ENTSO-E Transparency | svakih 15–60 min | token (već čekamo) |
| L2 | **Potrošnja (opterećenje)** i prognoza za sutra | ENTSO-E | sat | isti token |
| L3 | **Prognoza vjetra i sunca** za dan unaprijed | ENTSO-E | dan | isti token |
| L4 | **Ispadi i remonti** elektrana i vodova (koji blok ne radi i do kada) | ENTSO-E A77/A78/A80 | sat | isti token — **na karti kao crveni prsten oko elektrane** |
| L5 | **Punjenost akumulacija** (hidro rezerve) | ENTSO-E | tjedno | isti token |
| L6 | **CO₂ intenzitet struje** (g/kWh) po zemlji | izračun iz L1 + EEA faktori | sat | ništa novo |
| L7 | **Plin: skladišta i LNG** (punjenost, tok) | GIE AGSI+/ALSI | dnevno | besplatan ključ |
| L8 | **Vrijeme za energetiku** (vjetar, sunce, temperatura) | Open-Meteo | sat | ništa (CC BY, bez ključa) — objašnjava zašto vjetar danas daje malo |
| L9 | **Cijene goriva** (benzin, dizel, plin po zemlji) | EU Weekly Oil Bulletin | tjedno | ništa |
| L10 | **Cijene struje po satu** (dan-unaprijed) | već imamo (Faza 6A) | dan | — |
| L11 | **Prekogranični kapaciteti** (koliko se smije prenijeti) | JAO / ENTSO-E | dan | isti token |

**Nije moguće uživo** (nema otvorenog izvora): potrošnja pojedinog grada, pojedine trafostanice ili
voda; status punionica u stvarnom vremenu za cijelu regiju (OpenChargeMap ima samo dio, uz ključ).

**Preporuka redoslijeda:** Faza 9 (SEO) odmah — ne ovisi ni o čemu; Faza 10 (gradovi) odmah —
izvor je otvoren; L1–L6 i L11 čim stigne ENTSO-E token (jedan token otključava sedam slojeva);
L7 uz GIE ključ; L8 i L9 bez ključa, kao dopuna nadzornoj ploči.

## Faza 9b — IndexNow (plan 2026-09-19, potvrđeno „može i to")

| Dio | Odluka |
|---|---|
| protokol | IndexNow: jedan POST na `api.indexnow.org` s popisom URL-ova (do 10 000 po zahtjevu); Bing, Yandex, Seznam, Naver i partneri preuzimaju odmah. Google ga ne koristi — za Google ostaje sitemap + Search Console |
| ključ | varijabla `INDEXNOW_KEY` u GitHubu (nije tajna: mora biti javno dostupna kao `https://<stranica>/<ključ>.txt`); build piše tu datoteku u `dist/`, prerender je ne dira |
| kada | nakon uspješnog `pages deploy` (datoteka s ključem mora biti živa prije prijave), samo za produkciju (`main`) |
| što se prijavljuje | svi URL-ovi iz `sitemap.xml` (i dijelova sitemap indeksa) — to su upravo stranice koje se mijenjaju sa svakim buildom |
| kod | `web/src/seo/indexnow.ts` (čisto: ključ, payload, dijeljenje na ≤ 10 000), `src/seo/notify.ts` (ulaz, bundlan istim `vite build --ssr`), testovi |
| neuspjeh | korak ne ruši deploy (stranica je objavljena), ali zapisuje odgovor u log |

- [x] 9b-1 modul + testovi (`indexnow.ts`, 5 testova)
- [x] 9b-2 ključ u dist, korak u `web.yml` (samo `main`, `continue-on-error`), PRIPREMA.md
- [x] 9b-3 provjere; `notify.js` provjeren protiv lokalnog stub poslužitelja (43 URL-a, HTTP 202)

## Faza 12 — doseg: ugradnja, feed, otvoreni JSON (plan 2026-09-19, potvrđeno)

| # | Dio | Odluka |
|---|---|---|
| 12A | **Ugradiva karta** | `?embed=1` u URL stanju: bez zaglavlja, bočne ploče i mobilne trake; ostaju karta, detalji, legenda (sklopljena), atribucija i statusna traka; u kutu poveznica „Otvori cijelu kartu ↗" na isti prikaz bez `embed` (to je backlink i put do cijele stranice). U meniju Podijeli: „Ugradi" s `<iframe>` kodom trenutnog prikaza i gumbom za kopiranje. CSP: `frame-ancestors 'none'` → `*` za cijelu stranicu — nema prijave ni radnji koje bi clickjacking mogao zloupotrijebiti, a ugradnja je cilj; odluka zapisana u `securityHeaders.ts`. Prečaci u ugradnji isključeni osim `Esc` (stranica domaćina ima svoje) |
| 12B | **Atom feed promjena** | `/feed.xml` (HR) i `/en/feed.xml` iz `diff.json`: jedan unos po sloju s promjenama (novo/promijenjeno/uklonjeno s primjerima i poveznicama na kartu) + sažetak builda; `<link rel="alternate" type="application/atom+xml">` na svim stranicama; navedeno u `llms.txt`. Bez `diff` nema feeda (prva objava) |
| 12C | **Otvoreni JSON** | statične datoteke iz builda: `/api/index.json` (popis, licenca, buildId), `/api/zemlja/<hr>.json` (sažetak kao na stranici zemlje), `/api/objekt/<slug>.json` (isti skup kao stranice: id, vrsta, ime, zemlja, položaj, ključna brojka, poveznice na kartu/OSM/potpuni zapis), `/api/gradovi.json` (registar kao objekti); stranica `/api/` i `/en/api/` s opisom i primjerima; `_headers`: `/api/*` dobiva `Access-Control-Allow-Origin: *` i `Cache-Control` od sat vremena. Potpuni zapisi ostaju u NDJSON preuzimanjima — API je sažetak, i tako piše |

- [x] 12A ugradnja (state, App, ShareMenu, CSP, e2e) — bez zaglavlja `.app` treba jedan grid redak
  (prvi pokušaj: prazna stranica; uhvatio e2e)
- [x] 12B feed (seo/feed.ts, prerender, link u head, testovi)
- [x] 12C API (seo/api.ts, prerender, stranica `/api/` s `WebAPI` JSON-LD, `_headers`, testovi)
- [x] provjere, snimke, README, sažetak

## Faza 13 — crpilišta nafte i plina, rudnici (pregled izvora 2026-09-19; 13A + 13D ✅ napravljeno 2026-09-19)

**Pitanje:** postoje li otvoreni podaci koji „odmah mjere koliko se vadi"? **Odgovor: ne po bušotini
ni po rudniku.** Ni jedan otvoreni izvor ne daje proizvodnju pojedinog polja ili rudnika u stvarnom
vremenu. Ono što postoji, po svježini:

| # | Što | Izvor | Svježina | Treba | Licenca |
|---|---|---|---|---|---|
| 13A | **Lokacije**: naftne/plinske bušotine, kamenolomi, rudnici, okna | OSM (`man_made=petroleum_well`, `industrial=mine`, `landuse=quarry`, `man_made=mineshaft/adit`, `resource=*`) | tjedno (naš pipeline) | ništa | ODbL |
| 13B | **Polja nafte i plina s godišnjom proizvodnjom** (mil. bbl/god, mil. m³/god, status, operator, rezerve) | GEM Global Oil & Gas Extraction Tracker (GOGET) | godišnje (ožujak 2026); javna datoteka nosi samo zadnju godinu | isti postupak kao GEM elektrane (preuzimanje uz registraciju) | isti uvjeti kao GIPT koji već koristimo (navođenje izvora); potvrditi na obrascu |
| 13C | **Rudnici ugljena s godišnjom proizvodnjom** (Mt/god, kapacitet, rezerve, metan) | GEM Global Coal Mine Tracker (GCMT) | godišnje (kolovoz 2026) | isto | isto |
| 13D | **Plin koji ovaj sat ulazi u mrežu iz domaće proizvodnje** — po ulaznoj točki (npr. hrvatska polja u Jadranu i Panoniji, talijanska proizvodna polja) | ENTSOG Transparency Platform (fizički tokovi na proizvodnim ulaznim točkama) | sat/dan | ništa (javni API) | ENTSOG uvjeti (javni podaci) |
| 13E | **Mjesečna proizvodnja po polju** — samo Italija | MASE/UNMIG „Produzione nazionale di idrocarburi" | mjesečno | ništa | provjeriti (IODL 2.0?) |
| 13F | **Mjesečna proizvodnja nafte/plina/ugljena po zemlji** | Eurostat / JODI | mjesečno | ništa | CC BY |

Ono najbliže „uživo" je **13D**: ENTSOG objavljuje satne i dnevne tokove na svakoj točki
transportnog sustava, uključujući proizvodne ulazne točke — to je koliko plina iz domaćih polja upravo
ulazi u mrežu, ali po točki, ne po bušotini. Za naftu i ugljen ničega takvog nema.

**Prijedlog, ako krećemo:** 13A + 13D odmah (bez ključa; 13A je isti obrazac kao punionice, 13D isti
kao tokovi struje), 13B/13C čim stigne GEM preuzimanje (isti obrazac kao elektrane), 13E/13F kao
dopuna stranica po zemlji. Svaki sloj s jasnom oznakom svježine („godišnje, 2024" / „sat").

**Odluka (2026-09-19, „može, radi"):** krećemo s 13A + 13D. 13B/13C čekaju GEM preuzimanje.

### 13A — OSM lokacije crpilišta i rudnika (plan)

Što OSM označava i što od toga uzimamo:

| OSM oznaka | `kind` | zadana tvar | minzoom |
|---|---|---|---|
| `man_made=offshore_platform` | `platform` | `oil_gas` (platforma je po definiciji za naftu/plin) | 6 |
| `man_made=petroleum_well` | `well` | `oil_gas` | 9 |
| `industrial=mine` (uz `landuse=industrial`) | `mine` | `unknown` | 8 |
| `man_made=mineshaft` | `shaft` | `unknown` | 10 |
| `man_made=adit` | `adit` | `unknown` | 10 |
| `landuse=quarry` | `quarry` | — **zadržava se samo** kad `resource=*` kaže ugljen/lignit/treset/uran/nafta/plin (površinski kopovi lignita u RS/BA/SI su često `landuse=quarry`); kamenolomi kamena i šljunka nisu energetski objekti i ne ulaze | 10 |

Tvar (`substance`) čitamo iz `resource=*` (više vrijednosti kroz `;`) pa `substance=*`:
oil/petroleum/crude_oil → `oil`; gas/natural_gas → `gas`; oboje → `oil_gas`; coal/hard_coal/anthracite → `coal`;
lignite/brown_coal → `lignite`; peat → `peat`; uranium → `uranium`; bilo koja druga poznata vrijednost → `other`;
bez oznake → zadana tvar iz tablice. Životni ciklus kao i drugdje: `construction:`/`proposed:`/`planned:`
prefiksi daju status, `disused:`/`abandoned:` se **ne** uzimaju (zatvoreni rudnici nisu dio karte).
**Sloj pokazuje gdje se vadi, ne koliko** — to piše u legendi i detaljima („OSM lokacija, bez podataka o proizvodnji").

Checklist:
- [x] `config.EXTRACTION_FILTER` (treći prefilter prolaz po parovima, s lifecycle prefiksima) + u `SOURCE_FILTERS`
- [x] `schema.ExtractionSite` (`kind`, `substance`, `name`, `country`, `location`; `LAYER="extraction"`) + `Substance` enum
- [x] `osm/tags.py`: `extraction_site(tags)` → `(kind, status)`, `substance(tags, kind)`, pravilo za kamenolome
- [x] `osm/extract.py`: `ExtractResult.extraction`, `_add_extraction_site`, merge/counts
- [x] `tiles.py`: sloj `extraction` u `OPTIONAL_LAYERS`, vlastita arhiva `extraction.pmtiles` (z6–14), `extraction_minzoom(kind)`, shaper `_extraction`, provjera da su svi minzoomi u `ZOOM_STEPS`
- [x] `build.py` piše `extraction.ndjson`; `diff.py` naziv sloja; `products.py` search index (`kind` = extraction, detalj = tvar)
- [x] `publish.py`: ništa posebno (download po `LAYERS`, arhiva po `tiles.json`) — provjeriti testom
- [x] fixture čvorovi u `tests/fixtures/sample.osm` (bušotina, platforma, rudnik lignita kao `landuse=quarry`, kamenolom kamena koji se odbacuje, disused okno koje se odbacuje) + testovi u `test_extract.py`, `test_tiles.py`, `test_tags.py`, `test_build.py`
- [x] `scripts/web_fixture.py` dobiva sloj automatski (isti build)
- [x] web: `domain.ts` (`LAYER_KEYS`+`extraction`, `DOWNLOAD_KEYS`, `SUBSTANCES`), `current.ts` (`tiles.extraction`), `layers.ts` (kružić po tvari, opt-in arhiva), `selection.ts`, `filters.ts`, `palette.ts`, `DetailsPanel`, `Legend`, `FiltersPanel`, `search.ts`, i18n HR/EN, SEO copy (sloj u opisu), e2e `extraction.spec.ts`

### 13D — ENTSOG proizvodne ulazne točke (plan)

API (provjereno uživo 2026-09-19, HTTP 200, bez ključa): `https://transparency.entsog.eu/api/v1/`
- `operatorpointdirections?idPointType=3&limit=-1` → sve „Aggregated production point - TP" točke;
  polja `id` (npr. `5HR-TSO-0001PRD-00197entry`), `pointKey`, `pointLabel`, `operatorKey`, `operatorLabel`,
  `directionKey`, `tSOCountry`, `hasData`. **Nemaju koordinate** (agregirano po TSO-u), pa se crtaju na
  sidrištu zemlje (`COUNTRY_ANCHORS`), ne na polju.
- `operationalData?indicator=Physical Flow&periodType=day&pointDirection=<operatorKey><pointKey><direction>&from=…&to=…&includeExemptions=0&limit=-1`
  → dnevne vrijednosti, `unit=kWh/d`, plinski dan 06:00–06:00 CET; `value` broj ili `""` kad `isNA`; HTTP 404 = prazno.

Checklist:
- [x] `gas/entsog.py`: `production_points(client, scope)`, `daily_flows(client, point, from, to)`, `collect(client, now, scope, days=14)` → dokument `{version, generatedAt, unit:"kWh/d", days, points:[{key,pointDirection,label,country,operator,values:[{day,kwh|null}]}], missing}`; `validate` (svaka zemlja iz scope-a koja ima točku, bar jedna vrijednost u zadnjih 7 dana, inače build pada); `publish_gas` u `live/gas.json`
- [x] CLI `energymap gas fetch|publish-r2|publish-dir` (isti obrazac kao `live`)
- [x] `.github/workflows/gas-daily.yml` — dnevno 07:30 UTC (nakon plinskog dana), gated `vars.SCHEDULE_GAS == 'true'`; dodati u `test_workflow_rules.py`
- [x] testovi s `httpx.MockTransport` (točke, tokovi, `isNA`, 404, nedostajuće zemlje)
- [x] web: `data/gas.ts` (zod schema), sloj `gasProduction` (default off, dohvat samo kad je uključen, kao tokovi struje), kružić po zemlji veličine prema zadnjem danu, detalji: zadnjih 14 dana kao stupci, „kWh/d → GWh/d", izvor + svježina; fixture `live/gas.json` u `web_fixture.py` **jasno označen kao sintetički testni podatak**; i18n; e2e `gas.spec.ts`
- [x] README (poglavlje 13), PRIPREMA (`SCHEDULE_GAS`), lessons (L-046)

**Napravljeno 2026-09-19 (13A + 13D):** 5 fixture objekata (bušotina, platforma na moru, rudnik, okno u
izgradnji, površinski kop lignita kao `landuse=quarry` područje) + odbačeni kamenolom i disused okno;
`extraction.pmtiles` u builda, `search.json` s imenovanim objektima; web sloj s bojom po sirovini,
detalji, legenda, pretraga, `/objekt/` stranice za platforme/rudnike/kopove, `/api/objekt/`; ENTSOG
`gas/entsog.py` (8 testova s `httpx.MockTransport`), CLI `gas fetch|publish-r2|publish-dir`,
`gas-daily.yml` + `SCHEDULE_GAS`; web sloj „Proizvodnja plina (dnevno)" po zemlji, detalji sa stupcem po
danu, sintetički `live/gas.json` u fixtureu; e2e `extraction.spec.ts` (6) i `gas.spec.ts` (5).

**Otvoreno / rizici:**
- ENTSOG: koje zemlje iz opsega uopće imaju proizvodnu točku (`idPointType=3`) vidi se tek na prvom
  ručnom `gas-daily`; `missing.countries` u dokumentu to kaže. Ako Italija ima više točaka, zbrajaju se.
- Boje po sirovini: „nafta" i „plin" namjerno jednake cjevovodima; „ugljen" tamno siva može se stopiti s
  tamnom temom — provjeriti na stvarnim podacima.
- Ploča „Slojevi" sad ima šest bilješki ispod popisa; s još slojeva bi bilješku trebalo vezati uz
  uključeni sloj (prikazati samo za uključene) — mala UX dorada za sljedeći krug.
- 13B/13C (GEM GOGET, GCMT — godišnja proizvodnja po polju/rudniku) čekaju GEM preuzimanje; 13E (MASE, IT
  mjesečno) i 13F (Eurostat/JODI po zemlji) kao dopuna stranica po zemlji.

## Faza 14 — vizualne dorade nakon pregleda snimki (2026-09-19, ✅ sve napravljeno isti dan)

Analiza snimki faza 8–13 dala je devet nalaza; radi se u tri skupine, s pregledom snimki nakon svake.

**Skupina A (brzo, odmah vidljivo)**
- [x] (3) Zajednički *selection halo* za sve točkaste slojeve: jedan `circle` sloj po izvoru (grid, chargers, extraction, gas) s `selectionFilter`, prsten u akcentu, blago pulsiranje kroz `circle-radius` iz rAF petlje samo kad `prefers-reduced-motion` nije uključen; e2e provjera `data-selected-halo`.
- [x] (4) Detalji plina: naslov je ime zemlje, natpis „Proizvodnja plina"; energija uvijek s jednom decimalom u detaljima plina (`i18n.energy` ostaje kakav jest za ostale).
- [x] (6) Placeholder pretrage: „Traži elektranu, grad, rudnik…" (HR/EN), `searchLabel` isto.

**Skupina B (pola dana, mobitel)**
- [x] (1) Slojevi u tri odjeljka (Mreža / Proizvodnja i potrošnja / Uživo); bilješka samo ispod uključenog sloja, kao redak s ikonom „i" koji se širi; e2e postojeći testovi po imenu kvačice i dalje rade.
- [x] (2) Sparkline (inline SVG, bez biblioteke) u detaljima plina: min/max označeni, praznina za neprijavljeni dan, tablica sklopljena u `<details>` „Svi dani".
- [x] (5) Datum podataka u podnaslov zaglavlja; donja traka na mobitelu ostaje s dva gumba (ikona + tekst samo na širem ekranu).

**Skupina C (uglađenost)**
- [x] (7) Kartica dobrodošlice u desnom stupcu dok ništa nije odabrano: tri ulaza (Tokovi uživo · Što je novo · Gradovi), nestaje na prvi odabir ili „Zatvori", pamti se u `localStorage`; nikad u embed načinu.
- [x] (8) Legenda prigušuje vrste kojih nema u prikazu: MapView na `idle` javlja skup `technology`/`substance` iz `queryRenderedFeatures`; legenda ih prima kao prop.
- [x] (9) Broj na plinskom disku (`symbol` sloj, samo kad podloga ima glifove): „11,7 GWh".
- [x] README (Faza 14), snimke, lessons (L-048)

**Napravljeno 2026-09-19:** sve devet točaka; unit 298, e2e cijeli skup; snimke u `pregled-faza14/`.
Ostalo za kasnije: prsten odabira za linije je i dalje statičan (pulsiranje samo za točke — namjerno,
linija koja „diše" odvlači pogled); kartica dobrodošlice na mobitelu nije prikazana (odluka, ne propust).

## Završna provjera kompletnosti (2026-09-19)

Iz raspakiranog zipa u čistom direktoriju: svježi venv (Python 3.12) → ruff/format/mypy/pytest ✅;
svježi `npm ci` → `npm run check` (298 testova) ✅; produkcijski build s prerenderom, IndexNow ključem i
`VITE_SITE_URL` → 80 statičnih datoteka, stranice i `/api/` i za crpilišta ✅; actionlint ✅; sve
`vars.*`/`secrets.*` iz workflowa dokumentirane u PRIPREMA/infra ✅; hr/en i18n 341 = 341 ključ ✅.
**Drugi krug (iz konačnog zipa):** puni e2e otkrio dva testa koji su računali na otvorenu legendu na
svježoj stranici — kartica dobrodošlice je sklapa; testovi sad otvaraju legendu kao čitatelj. Nakon
popravka ponovno iz novog zipa: pytest ✅, `npm run check` 298 ✅, **e2e 159/159 ✅** (11 min).
**Nađeno i popravljeno (prvi krug):** `web/src/data/` nedostajao u zipu i bio ignoriran u `.gitignore` (L-049);
`web/.env.example` dobio `VITE_SITE_URL`. Prvi push na GitHub bi bez toga pao.

## Faza 15 — HEP ODS: slobodni kapaciteti za priključenje + analitika (pregled 2026-11-08; potvrđeno, 15-1 do 15-4 i 15-7 ✅)

**Pitanje:** može li karta uzimati podatke s kapaciteti.hep.hr i dati analitiku.

**Što je izvor (provjereno 2026-11-08):**
- **kapaciteti.hep.hr** — interaktivna karta HEP ODS-a, objavljena 5. 10. 2026.; namijenjena investitorima u
  elektrane i baterije. Pregledano u pregledniku 2026-11-08 (Next.js aplikacija, MapLibre):
  - `GET /api/substation-data/current` → verzija podataka (`versionId: 4`, `dataDate: 2026-10-01`,
    `updatedAt: 2026-10-23`). Podaci se, dakle, objavljuju **u verzijama**, ne svaki dan; „svakodnevno" iz najave
    odnosi se na to da se stanje mijenja.
  - `GET /api/substations/with-data` → JSON (~360 kB), **488 zapisa**: oko 160 TS 110/x i 220/x kV, oko 320 TS
    35(30)/x kV i ~50 rasklopišta i pogona bez položaja. **440 ima koordinate** (GeoJSON Point). Polja:
    `fullyQualifiedName` (isti naziv kao u PDF-u, npr. „TS 110/35kV 4TS 117 JERTOVEC"), `distributionAreaId`,
    `transferCoordinator` (prijenosni omjer, npr. „35/10 kV"), `parentFullyQualifiedName` (TS 35 kV → nadređena
    TS 110 kV; 330 veza, sve razriješene), `freeCapacityKw` i `additionalFreeCapacityKw` (slobodno u kW, sada i
    nakon nadogradnje), `existingUsersPowerKw`, `contractedUsersPowerKw`, `pendingUsersPowerKw`,
    `totalConnectionPowerKw`, `dailyMinimumConsumptionKw`, `existingTransformationKva`,
    `transformationUpgradeKva`, instalirana i planirana transformacija (MVA), kategorija za postojeću i
    nadograđenu mrežu.
  - `GET /regions/regions_low.geojson` → 21 poligon distribucijskih područja (ime, id 4001–4021).
  - Nema API-ja za povijest: samo trenutna verzija. Brojke na karti (filtar: „/" 164, A 111, B 81, C 41, D 91)
    odgovaraju kategoriji **za nadograđenu mrežu**; za postojeću mrežu je „/" 211 od 488.
  - Uvjeti: stranica nema uvjeta korištenja ni licence. Prije detalja traži potvrdu napomene: podaci se
    mijenjaju, HEP ODS ne jamči pravodobnost ni točnost u trenutku predaje zahtjeva za EOTRP, podaci su
    „isključivo informativne prirode". Ta potvrda nije dana (pristanak je korisnikov).
- **Službeni PDF-ovi** „Procijenjene razine prihvata nove priključne snage" (hep.hr/ods → Pristup mreži →
  Info o mogućnostima priključenja), otprilike mjesečno od 07/2025. Nađeni: 07/2025, 11/2025, 12/2025,
  01/2026, 04/2026, 05/2026, 07/2026. Imena su nepravilna (`final07_2025`, `final 01_2026`, `final_04_2026`,
  `_v1`, `_v2`) → datoteke se traže **popisom stranice**, nikad slaganjem imena (kao JRC u Fazi 10).
  - Prilog I (proizvodnja, smjer predaje): **148 TS 110/x kV** u 21 distribucijskom području. Stupci: područje,
    naziv TS, instalirana snaga transformacije [MVA] (npr. `40+40`), ukupna priključna snaga u smjeru predaje
    [kW] (priključeni ≥ 100 kW + postupci u tijeku), kategorija prihvata „u postojeću mrežu" i „u mrežu s
    nadograđenom TS 110/x kV".
  - Prilog II (spremnici): po TS kategorija u smjeru predaje i u smjeru preuzimanja, priključna snaga postupaka
    u tijeku bez ugovora.
  - Kategorije (Tablica 1): **A ≤ 5 MW, B ≤ 10 MW, C ≤ 20 MW, D > 20 MW, „/" = nema mogućnosti prihvata**
    (HEP ODS do novih okolnosti ne obrađuje zahtjeve ≥ 100 kW).
  - Nema koordinata → TS se spaja s OSM trafostanicama.
- **Licenca:** ni karta ni PDF-ovi ne navode uvjete ponovne upotrebe. HEP ODS je u državnom vlasništvu, pa bi
  se trebali primjenjivati ZPPI (ponovna uporaba informacija) i Direktiva o otvorenim podacima, ali to HEP nije
  izrijekom potvrdio. Pravilo projekta: ne preuzimati podatke s tuđih web karata bez jasne licence (napomena
  o licencama uz tablicu izvora).

**Prijedlog (Elegant Way): jedan model, dva izvora, dopuštenje prije API-ja.**
1. **E-mail HEP ODS-u odmah** (korak 15-1): smijemo li uz atribuciju ponovno koristiti podatke iz
   `/api/substations/with-data` i poligone područja, i postoji li službeni otvoreni izvor (CSV/GeoJSON) s
   poviješću verzija. API je 30× bogatiji od PDF-a (koordinate, 35 kV razina, kW umjesto kategorija,
   hijerarhija), ali bez licence ga ne preuzimamo (pravilo projekta).
2. **Paralelno: službeni PDF-ovi** za povijest TS 110/x kV od 07/2025. Nazivi u PDF-u i u API-ju su isti
   (`fullyQualifiedName`), pa se povijest izravno veže uz trenutne zapise, bez pogađanja.
3. **Kad HEP odobri:** `hep-check` svaki dan pita `/api/substation-data/current`; nova `versionId` → preuzmi
   cijeli skup → validiraj → objavi novu snimku. Povijest od tog dana raste sama.

| Dio | Odluka |
|---|---|
| pipeline | modul `hep/`: `discover` (popis PDF-ova sa stranice), `download` (atomsko, preskače poznate), `parse` (pdfplumber; tablice po zaglavlju, nepoznat raspored pada s popisom nađenog, plus `energymap hep inspect` kao `cities inspect`), `normalize` (ime TS → ključ; `40+40` → `[40, 40]`; kW s decimalnim zarezom; kategorija `A`–`D` ili `none`) |
| validacija | pydantic `HostingCapacity`; snimka se odbija ako ima < 140 TS, nepoznatu kategoriju ili 5 % TS manje od zadnje objavljene (L-015: izvor istine je objavljena verzija, ne lokalna) |
| spajanje s kartom | uz API: položaj dolazi od HEP-a (440 od 488); poveznica na našu OSM trafostanicu po udaljenosti ≤ 500 m i naponu, nesigurno u `review` + `overrides/hep_ts.yaml`. Samo PDF: TS 110/x kV ↔ OSM po normaliziranom imenu, isti `review`. Zapis bez položaja ostaje u tablicama, ali ne na karti: položaj se nikad ne pogađa |
| proizvod | `hep/current.json` (zadnja snimka po TS: kategorije, kW, hijerarhija, id OSM trafostanice) i `hep/history.json` (kategorija i slobodni kW po TS po snimci); svaki preuzeti PDF i njegov sažetak čuvaju se na R2, jer HEP stare datoteke može ukloniti |
| automatika | workflow `hep-check` tjedno: novi PDF na popisu → parse → validacija → objava; inače ništa. Prekidač `SCHEDULE_HEP` (L-034) |
| web: sloj | „Slobodni kapacitet (HEP ODS)" u skupini Mreža, zadano isključen: krug na trafostanici u boji kategorije (nema / A / B / C / D), kategorija „s nadogradnjom TS" kao prsten; detalji: obje kategorije, MVA, priključna snaga, spremnici, traka kategorija kroz snimke, HEP-ova napomena i poveznica na kapaciteti.hep.hr |
| web: analitika | prikaz „Kapaciteti" uz „Proizvodnja kroz vrijeme" (s API-jem i u kW, po razini 110/35 kV i kroz hijerarhiju TS 110 → TS 35): (1) broj TS po kategoriji kroz snimke — glavni uvid: koliko TS više nema mjesta; (2) po distribucijskom području udio TS bez kapaciteta; (3) promjene od prošle snimke (koje TS su pale ili porasle); (4) gdje bi nadogradnja TS otvorila najviše (razlika „postojeća" ↔ „nadograđena"); (5) spremnici: predaja i preuzimanje. Svaki grafikon ima i tablicu (kao EnergyView) |
| SEO | `/kapaciteti/` i `/en/grid-capacity/` (tablice iz analitike, `Dataset` JSON-LD) + stranica po TS (148 × 2), npr. „TS Jertovec 110/35 kV: slobodni kapacitet za priključenje"; unos u feedu kad se kategorije promijene |
| atribucija | „HEP ODS, Procijenjene razine prihvata nove priključne snage (stanje DD. MM. GGGG.)" u atribuciji karte i uz svaki zapis; novi izvor `hep` u `Source`/`_SOURCE_LICENSES` s licencom `HEP-ODS-public` dok HEP ne potvrdi točniju |

**Što to nije:** kategorija nije broj MW (D je „više od 20"), pa se kategorije **ne zbrajaju** u „ukupno
slobodnih MW". Snimka je otprilike mjesečna dok ne stigne dopuštenje za dnevne podatke. Prijenosna mreža
(HOPS godišnje objavljuje „Mogućnosti priključenja na prijenosnu mrežu") je moguće proširenje 15-B.

Koraci: 15-1 e-mail HEP ODS-u (pregled API-ja ✅ 2026-11-08) ·
15-2 pipeline + testovi na isječcima pravih PDF-ova (svako poznato izdanje) · 15-3 spajanje s OSM-om +
overrides · 15-4 objava + workflow · 15-5 sloj i detalji · 15-6 analitika · 15-7 statične stranice ·
15-8 provjere i snimke.

Rizici: raspored PDF-a se može promijeniti između izdanja → čitač po zaglavlju i test na svakom izdanju;
nazivi TS se razlikuju od OSM-a („TS 110/35kV 4TS 117 JERTOVEC" ↔ „TS Jertovec") → ključ iz imena + ručni
overrides; dnevni izvor možda nikad neće biti dopušten → plan ne ovisi o njemu.

## Faza 16 — SEO 2.0: tražilice i AI pretraživanje (pregled 2026-11-08; potvrđeno, većina ✅ — vidi „napravljeno”)

**Stanje:** temelj iz Faza 9, 9b i 12 je dobar (statične stranice, JSON-LD, sitemap s hreflangom, robots koji
pušta AI crawlere, `llms.txt`, IndexNow, feed, otvoreni JSON, ugradnja). Pregled koda 2026-11-08 našao je
greške koje taj temelj potkopavaju i prostor za sadržaj koji stvarno donosi posjete. Pretraga po nazivu 2026-11-08 ne
nalazi stranicu u indeksu.

### 16-A — greške koje sada štete (P0)

| # | Nalaz (provjereno u kodu) | Popravak |
|---|---|---|
| A1 | Bez `SITE_URL` nema canonicala, sitemapa, `og:url` ni apsolutne `og:image` | postaviti varijablu (treba domena); build na `main` bez nje pada umjesto upozorenja |
| A2 | Početna (`index.html`): hreflang s relativnim adresama (Google traži apsolutne), nema canonicala (svaka podijeljena varijanta `?sel=…`, `?embed=1`, `?live=1` je duplikat početne), `og:image` relativna (Facebook, LinkedIn i X ne prikažu sliku), `WebSite` bez `url` (Google naziv stranice) | prerender upisuje apsolutne vrijednosti u `dist/index.html`; canonical na `/` pokriva i sve varijante s parametrima, uključujući ugradnju |
| A3 | Aplikacija bira jezik po pregledniku: Googlebot (engleski) iscrta početnu na engleskom dok HTML kaže `lang="hr"`; `?lang=en` vraća isti hrvatski HTML; aplikacija zamijeni opisni `<title>` kratkim „Regionalna energetska karta" | jezik iz putanje: `/` uvijek hrvatski, `/en/` engleski (prerenderirana ljuska s engleskim headom i sadržajem); stari `?lang=en` linkovi preusmjere se na `/en/?…` (`replaceState`), pa podijeljeni linkovi ostaju valjani; prijedlog jezika umjesto automatske promjene; naslov ostaje opisni. **Odluka:** mijenja dosadašnje automatsko biranje jezika |
| A4 | Nema `404.html`, pa Cloudflare Pages za svaku nepostojeću adresu vraća kartu sa statusom 200 (soft 404); stranica objekta koji nestane iz OSM-a ostaje „živa" | `404.html` (HR/EN, poveznice na zemlje i pretragu, `noindex`); aplikacija koristi samo `/` i `/en/`, pa SPA fallback ne treba |
| A5 | Stranice objekata su siročad: do njih vodi samo sitemap (stranice zemalja ne povezuju nijednu) | poveznice iz stranica zemalja i tematskih stranica (16-B); test grafa: svaka stranica dohvatljiva s početne u ≤ 3 klika |
| A6 | Opis „Podatkovni centar X (), Hrvatska" kad snaga nije poznata | opis bez praznih zagrada; test za svaku vrstu bez detalja |
| A7 | `lastmod` je datum builda za sve stranice svaki tjedan, pa ga Google prestane uzimati u obzir | `seo-manifest.json` uz stranicu (putanja → hash, lastmod); sljedeći build ga čita sa `SITE_URL` i zadržava datum stranicama čiji se sadržaj nije promijenio |

### 16-B — sadržaj koji rangira (P1)

| # | Što | Kako |
|---|---|---|
| B1 | **Bogatije stranice objekata** | prerender čita i potpune zapise (NDJSON), ne samo indeks pretrage: status, operator, godina puštanja u pogon, naponi, izvori s licencom, rang u zemlji („3. najveća hidroelektrana u Hrvatskoj"), udio u instaliranoj snazi zemlje, 5 najbližih objekata s vlastitom stranicom, poveznica na stranicu zemlje i tehnologije |
| B2 | **Wikidata i Wikipedia** | pipeline zadržava OSM oznake `wikidata` (`^Q\d+$`) i `wikipedia`; stranica dobiva `sameAs` na Wikidatu — najjači signal tražilicama i AI alatima da je to isti objekt koji već poznaju |
| B3 | **Tematske stranice** (ono što ljudi stvarno traže) | po zemlji i tehnologiji: `/zemlja/hr/hidroelektrane/`, `/zemlja/hr/vjetroelektrane/`, `/zemlja/hr/suncane-elektrane/`… (popis svih s MW, statusom, godinom, poveznicama); `/zemlja/hr/interkonektori/` (vodovi preko granice po naponu i susjedu); `/najvece-elektrane/` za regiju; sve i na engleskom |
| B4 | **Proizvodnja struje po zemlji i godini** (ENTSO-E podaci koje već skupljamo) | `/proizvodnja/hr/` (2015.–danas: ukupno, po izvoru, udio obnovljivih, potrošnja) i `/proizvodnja/hr/2025/` po mjesecima; odgovara na pitanja tipa „koliko struje Hrvatska proizvodi iz sunca". Treba aktivan ENTSO-E; bez podataka se stranice ne rade (kao feed bez diffa) |
| B5 | **Cijena struje danas** | `/cijene-struje/` i `/en/electricity-prices/`: današnje i sutrašnje satne cijene dan-unaprijed po zoni (HR i regija); dnevni deploy nakon objave aukcije (~13:00 CET). Upit s velikim prometom |
| B6 | **Kapaciteti za priključenje** | iz Faze 15 (registar; 148 TS iz PDF-a, do 440 s API-jem) |
| B7 | **Breadcrumbs** | vidljive mrvice + `BreadcrumbList` JSON-LD (Početna › Hrvatska › Hidroelektrane › HE Zakučac) |
| B8 | **Naslovi s ključnom brojkom** | „HE X: hidroelektrana 120 MW, Hrvatska" umjesto „HE X – Elektrana, Hrvatska" |

### 16-C — AI pretraživanje (P2)

| # | Što | Kako |
|---|---|---|
| C1 | robots.txt za AI pretragu | dodati `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `Perplexity-User` (pretraga i dohvat na zahtjev korisnika, ne samo trening) |
| C2 | Markdown inačice | `index.md` uz svaku stranicu + `llms-full.txt` (sažeci zemalja i najvećih objekata u jednoj datoteci); `<link rel="alternate" type="text/markdown">` |
| C3 | JSON inačica stranice | `<link rel="alternate" type="application/json">` na odgovarajući `/api/…` |
| C4 | Rečenica za citiranje | na vrhu svake stranice jedna rečenica s brojkom i datumom („Prema podacima od 8. 11. 2026., …"), jer AI alati citiraju upravo takve |
| C5 | Potpuniji `Dataset` | `creator`/`publisher` s `url`, `temporalCoverage`, `spatialCoverage` kao `Place` s `geo` okvirom, `keywords`, `variableMeasured`, `distribution` i na stranicama zemalja (`/api/zemlja/hr.json`); `Organization` sa `sameAs` (GitHub) — uvjeti za Google Dataset Search |
| C6 | Više jezika (odluka) | statične stranice i na slovenskom, mađarskom, talijanskom, njemačkom i srpskom: susjedi traže na svom jeziku („elektrarne Slovenija", „erőművek térkép"); samo statične stranice, ne sučelje karte; najveći pojedinačni dobitak dosega, ali i najveći posao |

### 16-D — izvan koda (radiš ti, jednom)

- **Google Search Console** (potvrda kroz Cloudflare DNS) i prijava sitemapa.
- **Bing Webmaster Tools** (uvoz iz Search Consolea): ChatGPT pretraga i Copilot oslanjaju se na Bingov indeks.
- `INDEXNOW_KEY` postavljen (PRIPREMA.md).
- Poveznice izvana su najjači signal: GitHub repozitorij s opisom i temama, stranica na OSM wikiju, DOI za
  bazu (Zenodo, mjesečna snimka), javiti se portalima koji su pisali o HEP-ovoj karti (Energetika-net,
  Energetico, Bloomberg Adria) — analitika kapaciteta iz Faze 15 je vijest.

**Provjera:** jedinični testovi za svaki generator; e2e: apsolutni canonical/hreflang/og:image na svim
stranicama, `404.html` postoji i ima `noindex`, JSON-LD ima obavezna polja (`Dataset`: opis ≥ 50 znakova,
licenca, `creator.url`; `Place`: `geo`; `BreadcrumbList`: pozicije), graf poveznica bez siročadi, Lighthouse
SEO ≥ 95; nakon deploya ručno Rich Results Test na tri adrese.

**Redoslijed:** 16-A (pola dana, najveći učinak po satu) → 16-B1/B2/B3/B7/B8 → Faza 15 → 16-B4/B5 →
16-C → 16-C6 ako se odluči.

**Odluke koje trebam:** (1) domena i je li stranica već objavljena; (2) jezik iz putanje (`/` i `/en/`)
umjesto automatskog biranja po pregledniku (A3); (3) HEP: šaljemo e-mail za dopuštenje korištenja API-ja, a dotad
radimo povijest iz PDF-ova; (4) dodatni jezici (C6) da ili kasnije.

### Faze 15 i 16 — odluke i napravljeno (2026-11-08)

**Odluke korisnika (2026-11-08):** domena `energetska-karta.tmit.hr` (Cloudflare Pages); HEP ODS je **dao
dopuštenje** za ponovnu upotrebu podataka s karte, ali API ni CSV neće postojati („radi najbolje moguće i
vidi kako ćemo osvježavati"); dalje se radi bez čekanja („dok čekamo možemo dalje raditi?"). Otvoreno: 16-A3
(jezik iz putanje) i 16-C6 (dodatni jezici).

**Kako osvježavamo HEP podatke (odluka u kodu):** dnevni `hep-daily` pita `api/substation-data/current`;
nova verzija ili promijenjen sadržaj (hash) → nova nepromjenjiva snimka na R2 → povijest se slaže iz svih
snimki → `hep/current.json` zadnji. Kvar formata = crveni posao + e-mail, stari podaci ostaju. Rezervni put
ako HEP ugasi te adrese: mjesečni PDF-ovi (15-B, nije napravljeno; nazivi TS isti, pa se povijest može dopuniti).

**Napravljeno — pipeline (Faza 15):**
- [x] `energymap/hep/capacity.py`: dohvat triju adresa, pydantic za svaki redak, normalizacija (razina napona
  iz naziva, kratko ime, MVA liste, kW na jednu decimalu, prazno ostaje prazno), validacija (≥ 300 TS i
  položaja, ≤ 2 % neispravnih, jedinstvena imena, kategorije, hash sadržaja), snimke i povijest, objava
  (starije izdanje odbijeno, pad > 10 % traži `--allow-drop`, `current.json` zadnji)
- [x] CLI `energymap hep fetch | publish-r2 | publish-dir`; workflow `hep-daily.yml` (prekidač `SCHEDULE_HEP`,
  ručni `allow_drop`); PRIPREMA.md i infra/README.md
- [x] Testovi `tests/test_hep.py` (37) na **deset stvarnih redaka** iz odgovora od 2026-11-08 (fixture
  `tests/fixtures/hep/`); `test_workflow_rules.py` zna za `hep-daily`
- [x] User-Agent pipelinea nosi adresu stranice

**Napravljeno — web (Faze 15 i 16):**
- [x] `web/src/data/hep.ts` (zod sheme, `loadHep`, analitika: po kategoriji, po području, gdje nadogradnja
  pomaže, hijerarhija, trend, zadnje promjene, slug) + `hep.fixture.ts` generiran iz pravog pipelinea
- [x] `/kapaciteti/` i `/en/grid-capacity/` + stranica po TS (s poviješću i TS koje napaja); u navigaciji,
  na početnoj, u `llms.txt` i `/api/index.json`
- [x] 16-A1 deploy na `main` bez `SITE_URL` pada; 16-A2 početna (canonical, og, WebSite, sažetak) i opisni
  naslov u aplikaciji; 16-A4 `404.html`; 16-A5 bez siročadi (test grafa ≤ 3 klika); 16-A6 opis bez „()";
  16-A7 `seo-manifest.json` i `lastmod`
- [x] 16-B3 tematske stranice + `/najvece-elektrane/`; 16-B7 breadcrumbs; 16-B8 naslovi s brojkom
- [x] 16-C1 robots za AI pretragu; 16-C3 JSON alternate; 16-C5 potpuniji `Dataset`
- [x] Testovi: `topics.test.ts` (18), `capacity.test.ts` (8), `hep.test.ts` (12); postojeći SEO testovi i e2e
  `seo.spec.ts` prilagođeni (BreadcrumbList, dvije poveznice „Slovenija", nova tematska stranica)
- [x] Usput: `test_gas.py::test_cli_gas_fetch_and_publish` padao je od kraja rujna (mock je odgovarao za
  fiksni datum, a CLI pita od danas) — popravljen (L-055)

**Kako je provjereno (sandbox bez npm/pip mreže):** pipeline — ruff, ruff format, mypy --strict na novom kodu,
pytest 96 testova (hep, gas, pravila repozitorija) uz lokalne zamjene za httpx/boto3/osmium/shapely.
Web — globalni `tsc` u strogom načinu nad `src/seo` i `src/data/hep*` uz tipske zamjene za zod/React,
Prettier projekta, 81 test čistih modula kroz lokalni Node okvir (vitest API na `node:test`). **Nije
pokrenuto ovdje:** ESLint (typescript-eslint nije instaliran), vitest sa stvarnim zodom, e2e i snimke —
to radi CI na pushu (deploy čeka check i e2e). L-053.

**Ostaje (stanje nakon Faze 17):**
- [ ] 15-5 sloj „Slobodni kapacitet (HEP ODS)" na karti (`capacityOverlay` je spreman) + detalji + legenda +
  atribucija na karti; 15-6 interaktivni prikaz analitike (grafikoni uz tablice). Traži sesiju s mrežom:
  build, e2e i snimke (L-011).
- [x] 15-3 poveznica HEP TS ↔ OSM trafostanica (17-7, u prerenderu; `overrides/hep_ts.yaml` nije trebao:
  izjednačeni kandidati ostaju bez para)
- [~] 15-B PDF povijest — **otpada** (odluka 2026-11-08)
- [x] 16-A3 (17-9); 16-B1/B2 (17-11); 16-B4/B5 (17-10)
- [x] 16-C2 markdown inačice (`index.md` uz svaku stranicu, `llms-full.txt`, 2026-11-15)
- [x] 16-C4 rečenica za citiranje: brojke su u uvodu stranica (zemlja, tematske, objekti s rangom i udjelom,
  kapaciteti, proizvodnja, cijene); datum podataka je u podnožju i u markdownu, ne u uvodu, da `lastmod` ostane
  vezan uz sadržaj (L-054)
- [ ] 16-C6 dodatni jezici — **odluka**
- [ ] 16-D (korisnik): Search Console, Bing Webmaster Tools, sitemap, `INDEXNOW_KEY`

## Faza 17 — kvaliteta i funkcionalnost, redom (plan 2026-11-08, potvrđeno „radi sve redom")

**Odluke korisnika (2026-11-08):** (1) GEM/TransitionZero zapisi pod CC BY-NC **ostaju u preuzimanju**, a
preuzimanje se označava kao **samo nekomercijalno** u cjelini (zatvara PRIPREMA.md, točka 5); (2) **`/` je
hrvatski, `/en/` engleski** (16-A3); (3) HEP povijest iz PDF-ova se **preskače** (15-B otpada); (4) **Cloudflare
Web Analytics da**. GitHub račun nije povezan sa sesijom, pa push, CI i prva pokretanja radi korisnik.

| # | Što | Pristup | Provjera |
|---|---|---|---|
| 17-4 | Licenca preuzimanja | tekstovi „O karti", FAQ, naslov izbornika preuzimanja, `llms.txt`, `/api/index.json`, `Dataset.license` kao popis (ODbL + CC BY-NC 4.0) s `conditionsOfAccess`; README i PRIPREMA | jedinični testovi SEO-a |
| 17-7 | HEP TS ↔ OSM trafostanica | čista funkcija u prerenderu: najbliža OSM trafostanica iz indeksa pretrage unutar 500 m čiji najviši napon nije manji od razine HEP TS; dvije jednako dobre → nema para (ne pogađa se). Stranica HEP TS pokazuje objekt na karti, stranica objekta pokazuje kapacitet | testovi na fixtureu s namjernim dvojbenim parom |
| 17-9 | Jezik iz putanje | prerender piše `dist/en/index.html` (engleski head i sažetak); aplikacija čita jezik iz putanje; `?lang=en` → `replaceState` na `/en/?…`; strani preglednik dobiva prijedlog, ne promjenu; hreflang i sitemap za početnu u oba jezika; kartu na `/en/` poslužuje statična datoteka (Pages), u devu i previewu Vite middleware | `url.test.ts` u okviru, SEO testovi, e2e prilagođeni |
| 17-10 | Proizvodnja i cijene | statične stranice iz `energy/current.json` (godine po zemlji: ukupno, po izvoru, udio obnovljivih) i `live/current.json` (satne cijene danas/sutra po zoni); bez podataka se ne rade; `web.yml` dobiva dnevni raspored nakon aukcije dan-unaprijed | jedinični testovi na fixtureima |
| 17-11 | Bogatije stranice objekata | prerender čita potpune zapise iz NDJSON preuzimanja (status, operator, godina, naponi, izvori i licence, rang i udio u zemlji, najbliži objekti); pipeline zadržava OSM `wikidata`/`wikipedia` → `sameAs` | testovi pipelinea i SEO-a |
| 17-12 | Analitika posjeta | CSP dopušta `static.cloudflareinsights.com` (skripta) i `cloudflareinsights.com` (slanje); upute za uključivanje | `securityHeaders.test.ts` |
| 17-13 | Keepalive | mjesečni workflow ponovno uključuje sve zakazane poslove preko API-ja (`gh workflow enable`), i sebe | `test_workflow_rules.py` |

**Svjesno odgođeno (traži sesiju s mrežom: build, e2e, snimke):** 15-5/15-6 HEP sloj i interaktivna
analitika na karti, 17-8 ispadi elektrana (ENTSO-E, uz sloj na karti).

### Faza 17 — napravljeno (2026-11-08)

- [x] 17-4 licenca: `web/src/seo/license.ts` (ODbL + CC BY-NC, „u cjelini nekomercijalno"), „O karti", FAQ,
  podnožje, izbornik preuzimanja, `Dataset.license` kao popis + `conditionsOfAccess`, `/api/`, `llms.txt`, feed;
  README i PRIPREMA (točka 5 zatvorena)
- [x] 17-7 `matchOsm` u `data/hep.ts` (ime > napon > udaljenost, ≤ 500 m, izjednačeno = bez para); HEP stranica
  pokazuje OSM trafostanicu (vlastita stranica ili karta), stranica OSM trafostanice pokazuje kapacitet
- [x] 17-9 `/` i `/en/`: `langFromPath`, `pathForLang`, `canonicalUrl` (`?lang=` → putanja, u `main.tsx`),
  `useUrlState` bez jezika preglednika, `dist/en/index.html` iz prerendera (engleski head i sažetak, provjera
  „točno jedno podudaranje" za svaku zamjenu), hreflang i sitemap za obje početne, `mapLink`/feed/navigacija.
  **Nije napravljeno:** natpis s prijedlogom engleskog za strane preglednike (sučelje, uz snimke)
- [x] 17-10 `energyPages.ts`: proizvodnja po zemlji i godini, cijene danas/sutra; workflow `prices-daily`
  (prekidač `SCHEDULE_ENTSOE`), `web.yml` sluša `prices-daily` i `hep-daily`
- [x] 17-11 pipeline: `wikidata`/`wikipedia` na elektranama i trafostanicama (validirani, testovi u
  `test_tags.py`); web: `records.ts` (NDJSON → zapisi stranica, > 1 % pokvarenih redaka zaustavlja build),
  `assetFacts.ts` (status, operator, godina, naponi, izvori, rang, udio, u blizini, Wikidata/Wikipedia, `sameAs`)
- [x] 17-12 CSP za Cloudflare Web Analytics + upute; 17-13 workflow `keepalive`
- [x] Testovi: `assets.test.ts` (7), `energyPages.test.ts` (7), `url.test.ts` (+2), `hep.test.ts` (+3),
  `capacity.test.ts` (+2), `topics.test.ts` (+2), `test_tags.py` (+13); e2e: `/en/` bez JS-a, stari `?lang=en`
  link, promjena jezika u `map.spec.ts`
- [x] Okvir za lokalnu provjeru sad pada na sintaksnoj grešci (L-056)

**Kako je provjereno:** isto kao Faze 15/16 (L-053): pipeline ruff/format/mypy/pytest uz zamjene, web `tsc`
nad SEO/podatkovnim modulima i `url.ts`, Prettier, testovi čistih modula u lokalnom okviru. **Čeka CI:** ESLint,
vitest sa zodom (uključujući `App.test.tsx`), e2e (`/en/`, preusmjeravanje, tematske stranice).

## Faza 18 — efekti u pravoj karti, sa stvarnim podacima (plan 2026-11-15, potvrđeno „može”)

**Povod:** prototip „Energetska karta u pokretu” (artifact, 2026-11-15) pokazao je noćni izgled, vremeplov i
cijene kroz dan, ali s izmišljenim podacima, ručno ucrtanom kartom i izvan dizajn sustava: crna pozadina, mono
VELIKA slova, ukrasne animacije. Korisnik: „kako da to budu pravi podaci i uživo? Karta bježi od dizajna.”
**Smjer:** bez novog prototipa; efekti idu u postojeću MapLibre kartu, u postojeće panele i tokene
(„Dizajn sustav”, gore).

| # | Što | Pristup | Provjera |
|---|---|---|---|
| 18-1 | Uživo u pregledniku | `live/current.json` se ponovno učitava svakih 15 min dok je kartica vidljiva i pri povratku na karticu; ako korisnik nije sam odabrao sat, prati se trenutni sat; statusna traka kaže kad je osvježeno | testovi s lažnim satom (`useAsync`, `live.ts`) |
| 18-2 | Cijene na karti | sloj `countries` (već u `grid.pmtiles`) bojan po cijeni odabranog sata (feature-state po kodu zemlje); skala iz tokena: negativno hladno, oko nule neutralno, skupo toplo; legenda u `LiveBar`; zona bez cijene je „nema podatka”, ne boja; gumb „pusti dan” kroz 24 h | jedinični testovi skale i mapiranja zona; e2e |
| 18-3 | Vremeplov | kontrola „Godina” u panelu filtera: klizač od najranije godine do danas + reprodukcija; filter na sloju elektrana `commissioningYear ≤ godina` (polje je već u pločicama); elektrane bez godine se tada ne prikazuju i panel kaže koliko ih je; godina u URL-u; pipeline dodaje `timeline.json` (MW po godini, tehnologiji i zemlji) za grafikon ispod klizača | test pipelinea, `filters.test.ts`, e2e |
| 18-4 | Noćni izgled | nije nova tema: postojeća prigušena tamna tema dobiva blagi sjaj vodova (duplikat slojeva s `line-blur`, niska prozirnost), boje iz `palette.ts`; bez crne pozadine | `style.test.ts`, snimke |
| 18-5 | Kretanje | po dizajn sustavu se miče samo ono što nosi značenje: tokovi (postoje), reprodukcija vremeplova, prijelaz boja pri promjeni sata; bez ukrasnih iskakanja i iscrtavanja; sve se gasi uz `prefers-reduced-motion` | jedinični test prekidača, snimke |
| 18-6 | Dokumentacija i snimke | README, „O karti” (što je uživo i koliko kasni), snimke desktop/tamna/mobitel | pregled snimki |

**Otvoreno (odluka korisnika):** zatvorene elektrane (TE Rijeka, TE Plomin 1, TE Sisak A/B) danas ne ulaze u
podatke (`gem/normalize.py` isključuje `retired`). Bez njih vremeplov pokazuje kako je izgrađen *današnji*
park. Prijedlog: zadržati GEM zapise sa statusom `retired` i godinom zatvaranja samo za vremeplov
(`timeline.json` + sloj obrisa koji se vidi samo u vremeplovu), uz istu CC BY-NC atribuciju.

**Preduvjeti (korisnik):** `ENTSOE_TOKEN` i `SCHEDULE_ENTSOE=true` (bez njih sloj uživo nema podataka),
`SCHEDULE_HEP=true`. **Provjera sučelja** traži sesiju u kojoj se aplikacija može pokrenuti (VS Code s
Claude Codeom ili povezano računalo): u ovoj sesiji nema mreže za `npm`, a računalo nije dostupno.

**Odluka korisnika (2026-11-15):** zatvorene elektrane iz GEM-a ulaze u vremeplov (prijedlog gore prihvaćen).

### Faza 18 — napravljeno (2026-11-15)

- [x] 18-1 `useAsync(…, { refreshMs })`: osvježavanje u pozadini bez stanja „učitava”, neuspjeh čuva zadnju
  dobru kopiju; `useHourClock` (otkucaj nakon punog sata i pri povratku na karticu); `App` osvježava
  `live/current.json` svakih 15 min
- [x] 18-2 `map/priceScale.ts` (`priceColor`, `priceFill`, `priceGradient`), `palette.price` za obje teme,
  sloj `live-price-fill` ispod mreže, `LiveOverlay.prices`; `LiveBar`: legenda, „Pusti dan” (`dayRange`)
- [x] 18-3 pipeline: `RetiredUnit`/`parse_retired` u `gem/normalize.py` (zatvorene jedinice samo za vremeplov),
  `timeline.py` (`build_timeline`, `retired_plants`), `timeline.json` u buildu i u `current.json`; web:
  `data/timeline.ts`, `?y=` u URL-u, `plantFilter` po godini, izvor i slojevi `timeline-running`/
  `timeline-closed`, `TimeBar` (godina, klizač, reprodukcija, složeni grafikon snage, zatvorene, bez godine),
  ulaz u filtrima
- [x] 18-4 sloj `lines-glow` (samo tamna tema, `palette.lineGlow`); tokovi (na zahtjev korisnika): `live-halo`
  (tamna: sjaj u boji toka; svijetla: sjena pomaknuta 2 px prema dolje) i `live-casing` (svijetli rub, samo
  svijetla tema), `palette.flowHalo`; test u `style.test.ts`
- [x] 18-5 `composeStyle(…, reducedMotion)`: prijelaz 400 ms, 0 uz smanjeno kretanje
- [x] Testovi: pipeline `test_timeline.py` (6); web `priceScale` (6), `timeline` (4), `timeChart` (4),
  `timeFilter` (3), `url` (+1), `useHourClock` (3), `useAsync` (+2), `live` (+1), `style` (+3 + stanje
  vremeplova u provjeri valjanosti), `LiveBar` (+3), `TimeBar` (4); e2e `timemachine.spec.ts` (2)

**Kako je provjereno:** pipeline ruff, format, mypy (bez novih grešaka) i pytest za nove testove (dijelovi koji
traže osmium/shapely/boto čekaju CI); web Prettier, `tsc` nad cijelim `src` sa zamjenama za vanjske pakete
(bez grešaka u izmijenjenim datotekama), testovi čistih modula u lokalnom okviru.
**Čeka:** ESLint, vitest (komponente, `style.test.ts`), e2e, i **pregled sučelja na snimkama** (desktop,
tamna tema, mobitel): sjaj, boje cijena preko podloge MapTiler, raspored dviju traka u doku.
**Nije napravljeno:** rečenica o vremeplovu na stranici „O karti” (dolazi uz pregled sučelja).

## Faza 19 — „Odakle dolazi struja” i „Kod mene” (plan 2026-11-15, korisnik: „Napravimo to!”)

**Cilj:** pošteno pokazati od čega se struja u mreži sastoji u odabranom satu (proizvodnja i mješavina s
uvozom) te za lokaciju posjetitelja vrijeme, procjenu proizvodnje solara sada i godišnji solarni potencijal.
**Načelo:** struja se u mreži miješa; ne tvrdimo da kuća dobiva struju iz određene elektrane.

| # | Što | Pristup | Provjera |
|---|---|---|---|
| 19-1 | Satna proizvodnja u sloju uživo | `entsoe/live.py`: A75 (stvarna proizvodnja po vrsti) za HR, SI, HU, RS, BA, ME, AT, po satu, tehnologije kao u `energy.PSR_TECHNOLOGY`; sat vrijedi samo ako ga prijave sve serije zemlje (inače `null`, da udjeli ne budu iskrivljeni); potrošnja (crpljenje) se ne broji; zemlje bez podataka u `missing.generation` | pytest |
| 19-2 | Mješavina | `web/src/data/mix.ts`: proizvodnja zemlje i mješavina u mreži = vlastita proizvodnja + uvoz po susjedu, uvoz raspodijeljen po proizvodnji zemlje izvoznice (jedan korak, bez daljnjeg praćenja); uvoz iz zemlje bez podataka ostaje „uvoz, sastav nepoznat”; ako odabrani sat još nema podataka (ENTSO-E kasni), uzima se zadnji sat s podacima i to se kaže | vitest |
| 19-3 | Kartica u traci uživo | traka udjela u bojama tehnologija, popis s postocima, prekidač „u mreži / proizvodnja”, odabir zemlje; rečenica o miješanju struje | vitest, e2e |
| 19-4 | „Kod mene” | lokacija preglednika (uz dopuštenje) ili središte karte; zaokruženo na 2 decimale šalje se samo Open-Meteu (`current=cloud_cover,shortwave_radiation,is_day`); procjena solara sada = kWp × zračenje/1000 × 0,8; CSP `connect-src` + `api.open-meteo.com`; atribucija Open-Meteo (CC BY 4.0) | vitest, test zaglavlja |
| 19-5 | Solarni potencijal (pitanje korisnika) | Open-Meteo arhiva (ERA5): zbroj dnevnog `shortwave_radiation_sum` za zadnjih 365 dana → kWh/m² godišnje → procjena kWh po kWp (× 0,8 × 1,12 za nagib); bez sjena i orijentacije krova, poveznica na PVGIS za točan izračun | vitest |
| 19-6 | Dokumentacija i paket | README, todo | — |

### Faza 19 — napravljeno (2026-11-15)

- [x] 19-1 `entsoe/live.py`: `GENERATION_COUNTRIES`, `hourly_generation`, `generation` i `missing.generation`
  u dokumentu, provjera duljina; `LiveSource.generation`; sintetička proizvodnja u `scripts/web_fixture.py`
- [x] 19-2 `web/src/data/mix.ts` (`generationAt`, `latestWithData`, `productionMix`, `gridMix`, `mixCountries`)
- [x] 19-3 `panels/MixCard.tsx` u `LiveBar` (traka udjela, popis, prekidač, odabir zemlje, napomena)
- [x] 19-4/19-5 `data/weather.ts` i `panels/HereCard.tsx`; CSP i `Permissions-Policy: geolocation=(self)`
- [x] Testovi: pipeline `test_entsoe_live.py` (+3); web `mix` (6), `weather` (4), `securityHeaders` (osvježen),
  `MixCard` (3, u CI-ju); e2e (+1 u `timemachine.spec.ts`)
**Čeka:** ESLint, vitest komponenti, e2e i pregled na snimkama; prvo stvarno pokretanje `live-hourly` s
proizvodnjom (8 upita više na sat, unutar ENTSO-E ograničenja).

### Inženjerski pregled (2026-11-15)

- Pipeline: 652 testa, 550 prolazi, 21 preskočen; 81 koji ne prolazi ovdje svi ovise o paketima koji se u
  ovoj okolini ne mogu instalirati (osmium, shapely, boto Stubber, logger zamjenskog httpx-a), provjereno po
  datoteci. Ruff, format i mypy bez novih grešaka.
- Web: 245 jediničnih testova prolazi u lokalnom okviru; 7 padova i 4 datoteke koje se ne mogu učitati su
  ograničenja okvira (nema DOM-a, zod bez provjere, nema `expect.any`, style-spec). Prettier za cijeli `src`,
  `vite`, `e2e`. `tsc` nad cijelim `src` sa zamjenama: preostale greške su samo od zamjena.
- Ugovor pipeline → web: stvarni izlaz `live.collect` (sintetički izvor) i `build_timeline` provučen kroz
  `mix.ts` i `timeline.ts`: udjeli se zbrajaju u 1, mreža = proizvodnja + uvoz za svaku zemlju i sat, brojke
  vremeplova točne (1990., 2020., 2026.).
- Ispravljeno: proizvodnja po zemlji degradira samostalno (`EntsoeError`/`EntsoeParseError` → `missing` + log,
  test); dok ima najveću visinu (desktop) i najviše pola ekrana (mobitel); polje „kW” drži tekst;
  ime grupe prekidača u kartici; robusniji testovi (`visibilityState`, naziv testa).
- Za pregled sučelja: visina trake uživo s karticom mješavine (možda sažetak s „više” na mobitelu), Italija se
  boji cijenom sjeverne zone, zatvorene elektrane u vremeplovu nemaju oblačić s imenom, rečenica o
  Open-Meteu i lokaciji na stranici „O karti”.

Kasnije (nije u ovoj fazi): sloj karte „solarni potencijal” iz Global Solar Atlasa (PVOUT, CC BY 4.0), najbliže
elektrane i HEP kapacitet u kartici „Kod mene”.

## Faza 20 — alat za praćenje zelene tranzicije (plan 2026-11-15, korisnik: „može, ali za svaku fazu provjeri da ne ubijemo trenutne funkcionalnosti”)

**Cilj:** karta postaje i javni monitor tranzicije: pokazatelji kroz vrijeme, iz podataka koje već imamo, s
metodologijom. **Načelo:** sve je dodatno; bez podataka nema odjeljka ni stranice, ništa postojeće se ne mijenja.

| # | Što | Pristup | Provjera |
|---|---|---|---|
| 20-1 | CO₂ intenzitet | `data/co2.ts`: emisijski faktori životnog ciklusa (IPCC AR5 WGIII, Annex III, medijani; nafta 650 i „ostalo” 700 kao označene pretpostavke), skladištenje (reverzibilne, baterije) se ne broji; intenzitet proizvodnje i mješavine u mreži; uvoz nepoznatog sastava se ne broji i to se kaže | vitest |
| 20-2 | „CO₂ sada” | redak u kartici „Od čega je struja u mreži” | vitest komponente |
| 20-3 | Stranica „Zelena tranzicija” | `seo/transition.ts`: `/zelena-tranzicija/` i `/en/energy-transition/` s pokazateljima za Hrvatsku: udio obnovljivih u proizvodnji (ENTSO-E, godine), CO₂ intenzitet proizvodnje (mjeseci), instalirana snaga obnovljivih (vremeplov), u izgradnji i planirano (statistika izdanja), zatvoreni fosilni kapaciteti, slobodni kapacitet mreže (HEP), cilj iz NECP-a s objašnjenjem, metodologija; JSON-LD `Dataset` s `variableMeasured`; poveznice s početne, „O karti” i stranice Hrvatske; `llms.txt` | testovi SEO-a (stranice, bez siročadi, markdown) |
| 20-4 | Mjesečni izvještaj | sljedeći korak, nakon pregleda 20-3 | — |
| 20-5 | Eurostat (službeni udio) | sljedeći korak: novi izvor u pipelineu | — |

**Regresija nakon svakog koraka:** svi lokalno izvršivi testovi weba (zbroj ne smije pasti), testovi SEO-a,
provjera ugovora pipeline → web, Prettier, `tsc` nad izmijenjenim datotekama.

### Faza 20 — napravljeno (2026-11-15)

- [x] 20-1 `data/co2.ts` (+3 testa) · regresija: 248 prolazi (+3), 7 poznatih padova okvira, ugovor u redu
- [x] 20-2 „CO₂ sada” u `MixCard` (+1 provjera u testu komponente)
- [x] 20-3 `seo/transition.ts`, `seo/transitionCopy.ts`, `PATHS.transition`, `SiteData.timeline`, učitavanje
  `timeline.json` u prerenderu, poveznice (početna, Hrvatska), `llms.txt`, `llms-full.txt`; testovi (+7),
  e2e (+1 u `seo.spec.ts`) · regresija: 255 prolazi, 7 poznatih padova okvira, svi postojeći testovi SEO-a
  prolaze bez izmjena, ugovor u redu, Prettier i `tsc` bez novih grešaka
- [ ] 20-4 mjesečni izvještaj · [ ] 20-5 Eurostat (službeni udio prema cilju)

## Faza 21 — geotermalna energija: „skriveno blago podzemlja” (plan 2026-11-15, korisnik: „ajmo”)

**Cilj:** sloj koji pokazuje geotermalni potencijal (toplinski tok, od žute do tamnocrvene), što danas radi i
što se priprema, s animacijom puta topline od bušotine do korisnika. **Načelo:** samo podaci s izvorom;
potencijal je orijentacijski i tako piše; ništa postojeće se ne mijenja (regresija nakon svakog koraka).

| # | Što | Pristup | Provjera |
|---|---|---|---|
| 21-1 | Lokacije | `pipeline/data/geothermal.yaml`: elektrane, toplinarstvo, toplice i projekti, svaki zapis s izvorom i fazom (u pogonu, projekt, potvrđen potencijal, istraživanje, lokalni projekt); koordinate mjesta (približno) | pydantic, pytest |
| 21-2 | Potencijal | `energymap/geothermal/heatflow.py`: Global Heat Flow Database (IHFC, izdanje 2024., CC BY 4.0, xlsx; zaglavlje u 6. retku, `q`, `lat_NS`, `long_EW`), regija, IDW na mreži 0,1° unutar 75 km od mjerenja (bez ekstrapolacije), najmanje 3 mjerenja po ćeliji | pytest s malim xlsx-om |
| 21-3 | Objava | `geothermal/current.json` (potencijal + lokacije), CLI `geothermal fetch/publish-r2/publish-dir`, radni tok `geothermal-update.yml` (ručno + mjesečno uz `SCHEDULE_OSM`), sintetički podaci za e2e | pytest, pravila radnih tokova |
| 21-4 | Sloj na karti | ključ sloja `geothermal`, ploha potencijala (topla skala iz tokena), lokacije po fazi, legenda | vitest stila |
| 21-5 | Traka „Geotermalna energija” | brojke (danas, u pripremi, potvrđen potencijal), popis lokacija, animacija kaskade (bušotina → elektrana → grijanje → staklenici → toplice → vraćanje), stvarne upotrebe lokacije istaknute; bez animacije uz smanjeno kretanje | vitest |
| 21-6 | Stranica `/geotermalna-energija/` | brojke, popis, potencijal, kako radi kaskada, izvori; poveznica sa „Zelene tranzicije” | testovi SEO-a |

### Faza 21 — napravljeno (2026-11-15)

- [x] 21-1 `overrides/geothermal.yaml` (16 lokacija, svaka s izvorom), `geothermal/sites.py`
- [x] 21-2 `geothermal/heatflow.py` (čitanje xlsx-a, IDW mreža)
- [x] 21-3 `geothermal/publish.py`, CLI, `geothermal-update.yml`, pravila radnih tokova, sintetički podaci za e2e
  · pipeline: ruff i `mypy --strict` čisti; testovi 567 prolazi, 81 pad samo zbog zamjenskih modula ovdje
  (osmium/shapely/boto3), isto kao prije faze
- [x] 21-4 sloj `geothermal` (ploha potencijala, lokacije po fazi, klik na lokaciju), test stila
- [x] 21-5 `GeothermalBar` s kaskadom (SVG, `animateMotion`, skriveno uz smanjeno kretanje); snaga lokacija na
  jednu decimalu (16,5 MW, ne 17); množina „1 lokacija / 2 lokacije” (`geoHeatSites_*`)
- [x] 21-6 `seo/geothermal.ts` (+6 testova): brojke s ispravnom množinom („u 1 gradu”, „u 2 grada”), lokacije po
  fazi s izvorima (naziv domene), potencijal, kaskada, izvori i GHFDB s licencom; `SiteData.geothermal`
  (prerender ga učitava neobavezno), poveznice s početne, sa „Zelene tranzicije” i iz `llms.txt`; e2e (+1)
  · shema: izvori i URL toplinskog toka moraju biti URL-ovi (pipeline već provjerava `HttpUrl`)
- **Regresija nakon faze:** web 265 prolazi (+6), 7 poznatih padova okvira (isti kao prije), svi postojeći
  testovi SEO-a i „Zelene tranzicije” prolaze bez izmjena, ugovor u redu, Prettier i `tsc` bez novih grešaka
- Izvan ove okoline: ESLint, vitest komponenti i e2e u CI-ju; stvarno preuzimanje GHFDB-a u `geothermal-update`
  (ako se format promijeni, pada glasno i ništa ne objavljuje); vizualni pregled na Cloudflare previewu

## Faza 22 — uvod: „mreža koja svijetli” (plan 2026-11-15, korisnik: „može sve kako si predložio”)

**Cilj:** prvi posjet otvara kratak uvod (≈ 5 s) s natpisom „Energetska karta Hrvatske i regije”: karta dolijeće s
globusa nad Jadran i spušta se na regiju, mreža se pali po naponu, gradovi zasvijetle, elektrane se pojave, tokovi
krenu. **Načelo:** sve što svijetli su stvarni podaci iz karte; nikakva slika ni video (slika iz poruke je
ilustracija s izmišljenim postrojenjima, dobra za objave, ne za kartu). Uvod pokriva vrijeme učitavanja, ne dodaje ga.

**Odluke (tumačenje „sve kako si predložio”):** prvo uvod, zatim grafovi za citiranje (Faza 23); natpis u uvodu je
„Energetska karta Hrvatske i regije”, naziv stranice („Regionalna energetska karta”) ostaje dok se ne odluči drukčije.

| # | Što | Pristup | Provjera |
|---|---|---|---|
| 22-1 | Kada se prikazuje | `app/intro.ts`: puni uvod samo kod prvog posjeta (pamti preglednik, `try/catch`); nikad uz poveznicu sa stanjem (`sel`, `v`, slojevi, filtri, `live`, `embed`…; `utm_*` se ne broji), u ugradnji ni u automatiziranom pregledniku (`navigator.webdriver`, pa postojeći e2e ostaje isti); uz smanjeno kretanje samo natpis koji se pretopi u kartu | vitest (čiste funkcije) |
| 22-2 | Natpis | `app/Intro.tsx` umjesto spinnera: tamna pozadina, natpis (IBM Plex, bez verzala) preko kojeg jednom prijeđe svjetlo, tanka linija ispod koja se „upali”, gumb „Preskoči uvod”; klik, tipka ili kotačić preskaču; nikad duže od 9 s ako se karta ne učita (tada normalni prikaz učitavanja) | vitest komponente, snimka |
| 22-3 | Let | `MapView` prop `intro` (`hold` → `play` → `null`): kamera kreće s globusa (samo kad je završni zoom ≥ 4,6, tj. ne na mobitelu), nagnuto nad Jadranom, završava točno na zadanom prikazu; ograničenja (minZoom, maxBounds) privremeno skinuta i vraćena; URL ostaje čist kao i dosad | vitest (planovi kamere), e2e u CI-ju |
| 22-4 | Paljenje mreže | `map/introStyle.ts`: faze stila (vodovi prigušeni → sjaj 400 → 220 → 110 kV, gradovi, točke, tokovi), prijelaz boja 900 ms; projekcija globus→Mercator i nebo samo dok traje uvod; nakon uvoda stil je identičan dosadašnjem | vitest stila (stil bez uvoda = isti kao prije) |
| 22-5 | Tema i sučelje | za vrijeme uvoda sve je noćno; svijetla tema se na kraju „razdani” (postojeći prijelaz teme); zaglavlje i paneli skriveni pa se pojave; dobrodošlica nakon uvoda | vitest, e2e |
| 22-6 | Tokovi | ako su stvarni ENTSO-E podaci dostupni, tokovi teku u završnoj fazi uvoda; sloj „uživo” se ne pali za stalno (dobrodošlica nudi „uživo”) | vitest |

**Rizik:** let i paljenje mreže ovdje se ne mogu vidjeti (nema MapLibrea ni pločica), pa je svaki korak zaštićen:
greška u uvodu odmah ga završava i karta ostaje normalna. Vizualni pregled na Cloudflare previewu.

### Faza 22 — napravljeno (2026-11-15)

- [x] 22-1 `app/intro.ts` (+5 testova): puni uvod, samo natpis ili ništa; poveznica „pokazuje nešto” kad
  `parseState` → `serializeState` nije prazan (ostaje usklađeno s URL-om; `utm_*` se ne broji)
- [x] 22-2 `app/Intro.tsx` + CSS (tokeni `--intro-*`), `app/useIntro.ts` (faze iz činjenica, bez setState u
  efektima: `title` → `play` → `handoff` → `done`; odustajanje nakon 9 s; greška podataka ga odmah sklanja);
  testovi komponente i kuke (vitest u CI-ju); snimke prekrivača provjerene ovdje (desktop i mobitel)
- [x] 22-3 `map/introFlight.ts` (+4 testa) i `MapView` (`intro`: `hold`/`play`/`null`, `onIntroReady`,
  `onIntroDone`): ograničenja privremeno skinuta i vraćena, kamera uvijek završava na uobičajenom prikazu,
  `moveend` za vrijeme uvoda ne piše u poveznicu, brojke tokova (markeri) se u uvodu ne prikazuju
- [x] 22-4 `map/introStyle.ts` (+5 testova): veo noći, sjaj po naponu, svjetlo gradova, točke, tokovi, smirivanje;
  projekcija globus→Mercator i nebo samo za vrijeme uvoda; `style.test.ts` provjerava sve faze stvarnim
  validatorom MapLibrea (u CI-ju)
- [x] 22-5 `useTheme(override)`: noć za vrijeme uvoda bez mijenjanja izbora čitatelja; zaglavlje, paneli i
  kontrole skriveni pa uvedeni zajedno (zasluge karte ostaju vidljive)
- [x] 22-6 tokovi: `live/current.json` se za vrijeme uvoda učita i nacrta kao da je sloj uključen; sloj „uživo”
  i poveznica ostaju netaknuti
- [x] `src/test/setup.ts`: testovi su „automatizacija” (bez uvoda), pa postojeći testovi komponenti i e2e rade
  kao prije; `e2e/intro.spec.ts` (+5) uvod uključuje izričito
- **Regresija nakon faze:** web 279 prolazi (+14), 7 poznatih padova okvira (isti), ugovor u redu, Prettier i
  `tsc` bez novih grešaka
- **Nije provjereno ovdje:** let, globus i paljenje mreže (nema MapLibrea ni pločica u ovoj okolini) → e2e u
  CI-ju i pregled na Cloudflare previewu. Svaki korak je zaštićen: kraj uvoda (bilo koji) vraća kameru,
  ograničenja i obični stil.

### Faza 22b — dorada uvoda nakon pregleda simulacije (2026-11-15)

Korisnik: „treba pokazati i regiju, ne treba natpis ispod, mora baš biti wow efekt”.
- [x] podnaslov uklonjen; ostaje samo natpis sa svjetlom i linijom
- [x] regija: granice regije svijetle od početka (sloj `intro-region` ispod `scope-outline`), pa se smire kad se
  mreža upali; „Hrvatska” u fazi 1, imena susjeda u fazi 2 (`COUNTRY_NAME_AT`, imena iz i18n, samo kad podloga
  ima fontove); oznake podloge (`symbol`) skrivene do kraja noći da se imena ne dupliraju
- [x] globus i na laptopu: prvi prikaz je cijela regija (`REGION_BBOX` 5,5–24,5° E, 35–49,5° N, zoom ≈ 4,5), pa
  je prag 3,8 umjesto 4,6 (globus i dalje samo na zaslonu ≥ 900 px)
- [x] testovi: +4 (granice, imena, bez fontova bez imena, globus na laptopu); validacija svih faza s imenima u
  `style.test.ts` (CI)
- **Regresija:** web 283 prolazi (+4), 7 poznatih padova okvira, ugovor u redu, Prettier i `tsc` čisti
- Pregled stvarnog izgleda: grana + PR → Cloudflare preview (produkcija netaknuta)

### Otvorena odluka — podrška i financiranje (2026-11-15)

- Ideja korisnika: biti vidljiv HEP-u i suptilno doći do financiranja; tekst „podržite projekt” na dnu.
- Prijedlog: ne u uvodu nego tiha poveznica (dobrodošlica, „O karti”, podnožje statičnih stranica) na stranicu
  „Podrška i partneri” s popisom financijera i izjavom da ne utječu na podatke.
- Ograničenja prije bilo kakvog novca: odluka 2026-09-16 (nekomercijalno) se ponovno otvara kod sponzorstva;
  MapTiler Free i besplatni Open-Meteo su samo za nekomercijalnu upotrebu (Open-Meteo izričito dopušta
  dobrovoljne donacije, oglase i pretplate ne). HEP-ove donacije (godišnji natječaj) primaju samo udruge i
  ustanove, ne obrte ni tvrtke.
- Čeka odluku korisnika: udruga ili partnerska ustanova, donacije da/ne, samoposluženje podloge (bez MapTilera).

## Faza 23 — grafovi i prikazi za citiranje i dijeljenje (plan 2026-11-15, korisnik: „ajde radi dalje”)

**Cilj:** svaki graf i prikaz može se citirati, spremiti kao slika i podijeliti, a izvor, datum i poveznica uvijek
idu s njim, i na snimci zaslona.

**Pristup (prvi krug):** jedan zajednički dio `src/share/` (čiste funkcije + jedna komponenta), primijenjen na
grafove stranice „Energija” i na statične stranice. Postojeći „Podijeli” karte (poveznica, ugradnja, PNG) ostaje.

| # | Što | Kako | Provjera |
|---|---|---|---|
| 23-1 | Trajna poveznica na graf | stanje je već u URL-u (`p=energy`, `ea`, `eu`, `et`, `er`, `es`); kartice dobivaju sidro (`#mix`, `#compare`, `#range`) i stranica se na njega pomakne nakon učitavanja | vitest |
| 23-2 | „Spremi sliku” | `share/chartImage.ts`: platno grafa na pozadini teme, iznad naslov i što je prikazano, ispod izvor, stanje podataka, naziv stranice i poveznica (kao `snapshot` karte) | vitest (raspored teksta), ručno u previewu |
| 23-3 | „Citiraj” | `share/cite.ts`: APA 7 (s datumom pristupa), redak za objavu („Izvor: … prema podacima …”) i BibTeX, HR/EN; kopiranje jednim klikom | vitest |
| 23-4 | „Preuzmi podatke” | `share/csv.ts` (RFC 4180, UTF-8 s BOM-om da Excel vidi dijakritike, brojevi bez oblikovanja) + `energy/csv.ts`: točno retci i stupci koje graf ili tablica prikazuju | vitest |
| 23-5 | „Ugradi graf” | novi parametar `ec` (`mix`/`compare`/`range`): uz `embed=1` stranica prikazuje samo taj graf s izvorom i poveznicom na cijeli prikaz | vitest, e2e |
| 23-6 | Snimka zaslona | svaka kartica ima vlastiti redak izvora („Izvor: ENTSO-E · stanje … · adresa stranice”), pa ga nosi i snimka samo te kartice | vitest |
| 23-7 | Statične stranice | odjeljak „Kako citirati” (APA i redak za objavu) na svakoj stranici i u njezinoj Markdown inačici | vitest |

**Alternative:** slika grafa iz HTML-a (html2canvas i sl.) → nova ovisnost i nepouzdano; grafovi su ionako platno
(Chart.js). OG slike po stranici traže iscrtavanje PNG-a pri izgradnji (nova ovisnost, npr. resvg) → **drugi krug**,
kao i dijeljenje trake „Odakle dolazi struja”, vremenskog stroja i geotermalne trake.
**Rizik:** dodaci u karticama ne smiju promijeniti postojeće testove stranice Energija (isti naslovi, tablice, gumbi).

### Faza 23 — napravljeno, prvi krug (2026-11-15)

- [x] 23-1 sidra kartica (`#mix`, `#compare`, `#range`), stranica se pomakne na karticu nakon učitavanja
- [x] 23-2 `share/chartImage.ts`: slika grafa s naslovom, prikazom, izvorom, datumom, nazivom i poveznicom
- [x] 23-3 `share/cite.ts` (+5 testova): APA 7 (datum podataka i datum pristupa, bez točke iza URL-a), redak za
  objavu, BibTeX s TeX znakovima; HR i EN
- [x] 23-4 `share/csv.ts` (+2) i `energy/csv.ts` (+3): RFC 4180, BOM, točno retci i stupci prikaza
- [x] 23-5 parametar `ec` (+1 test URL-a): ugrađena jedna kartica, bez dijeljenja, s poveznicom na cijeli prikaz
- [x] 23-6 redak izvora u svakoj kartici
- [x] 23-7 `seo/citation.ts` (+2): „Kako citirati” na svim statičnim stranicama i APA u Markdownu
- [x] `ShareMenu` koristi zajednički `share/download.ts` (isto ponašanje)
- [x] testovi komponente `ChartShare` (+5) i stranice Energija (+2) u vitestu (CI); e2e (+2) u `energy.spec.ts`
- **Regresija nakon faze:** web 298 prolazi (+15), 7 poznatih padova okvira, ugovor u redu, Prettier i `tsc` bez
  novih grešaka; postojeći testovi stranice Energija nepromijenjeni
- **Drugi krug (nije napravljeno):** OG slike po stranici iz stvarnih brojki (treba iscrtavanje PNG-a pri izgradnji,
  nova ovisnost), dijeljenje trake „Odakle dolazi struja”, vremenskog stroja i geotermalne trake

## Faza 24 — stranica „Podrška i partneri”, ugrađena i isključena (plan 2026-11-15)

Korisnik: „napravi je u kodu pa ćemo lako upaliti ako zatreba”.
- **Prekidač:** varijabla `SUPPORT` u GitHubu (Settings → Variables) → `VITE_SUPPORT=1` pri izgradnji; isto vidi i
  aplikacija (`config.ts`) i prerender (`seo/entry.ts`). Bez nje nema stranice, poveznica ni retka u sitemapu.
- **Sadržaj:** `web/src/support.ts` (kontakt, stranica za donacije, popis partnera po ulozi), provjeren zod shemom;
  zadano je sve prazno, pa stranica bez izmjena nudi dijeljenje, podatke i partnerstva, bez donacija i kontakta.
- **Stranica** `/podrska/` i `/en/support/` (`seo/support.ts`): kako pomoći (dijeljenje i citiranje, podaci,
  partnerstva, potpora samo uz adresu za donacije), kontakt, tko podržava projekt, neovisnost (financijeri ne
  utječu na podatke, popis je uvijek javan).
- **Tihe poveznice kad je upaljeno:** podnožje statičnih stranica, odjeljak na „O karti”, redak u dobrodošlici.
- **Provjera:** testovi isključenog i uključenog stanja (nema ničega / sve postoji), valjanost sadržaja, regresija.

### Faza 24 — napravljeno (2026-11-15)

- [x] `support.ts` (sadržaj + zod + `supportEnabled`), `config.ts` (`support`), `seo/entry.ts` i `prerender.ts`
  (`SiteData.support`), `web.yml` (`VITE_SUPPORT: vars.SUPPORT`)
- [x] `seo/support.ts` (+6 testova): stranica HR/EN, partneri po ulozi s mjesecom („od siječnja 2027.”), donacije i
  kontakt samo kad su upisani, JSON-LD s financijerima; podnožje statičnih stranica, odjeljak na „O karti”
- [x] dobrodošlica: redak „Neovisan projekt otvorenih podataka. Podržite ga” samo kad je upaljeno (+1 test, CI);
  `config.test.ts` (+1)
- [x] zod 4: `z.url()` / `z.email()` umjesto zastarjelih `z.string().url()` (i u `data/geothermal.ts`)
- **Regresija:** web 305 prolazi (+7), 7 poznatih padova okvira; isključeno stanje ne mijenja nijednu postojeću stranicu

## Pregled koda nakon Faza 18–24 (2026-11-15)

Korisnik: „radi dalje s provjerom i slaganjem cijele aplikacije, provjeravaj kod da vidimo prostore za poboljšanje”.

**Popravljeno odmah**
- [x] **Stil karte se gradio iznova pri svakom pomaku karte.** `state.view` je u ovisnostima stila, pa je svaki pomak
  ili zum ponovno slagao stil i tjerao MapLibre na diff stotina slojeva (status „učitavanje”, zastoj animacije tokova).
  Sada se stil gradi iz `StyleState` (samo polja od kojih je stil napravljen); tip jamči da filter koji treba novo
  polje ne prolazi prevođenje dok se ono ne doda.
- [x] mrtav kod: `CORE_LAYER_KEYS`, `ASSUMED_FACTORS`, `GasPoint`, `stageAt`, `supportLinkText`
- [x] zod 4: zastarjeli `z.string().url()` (ESLint `no-deprecated` u CI-ju bi pao)
- [x] zajednički `seo/site.fixture.ts` za nove testove statičnih stranica (geotermalna, citiranje, podrška)

**Prijedlozi (po vrijednosti)**
1. Sloj „Slobodni kapacitet (HEP ODS)” na karti (15-5): podaci se već objavljuju, `capacityOverlay` je gotov i
   testiran, ali nije spojen na kartu. Najveća korist za korisnike (gdje se može priključiti sunčana elektrana).
2. Podijeliti velike module: `map/layers.ts` (≈1050 redaka) po skupinama slojeva, `seo/pages.ts` (≈1050) po vrsti
   stranice (kao `transition.ts`, `geothermal.ts`, `support.ts`), iz `App.tsx` izvući učitavanje slojeva u kuke.
3. Ostalih šest SEO testova prebaciti na `site.fixture.ts` (isti `current` ponovljen u svakom).
4. Dijeljenje i za traku „Odakle dolazi struja”, vremenski stroj i geotermalnu traku; OG slike po stranici (Faza 23,
  drugi krug).
5. Otvoreno od prije: 20-4 mjesečni izvještaj, 20-5 službeni udio OIE (Eurostat), pregled UI stavki (visina MixCarda na
  mobitelu, Italija s cijenom IT-North, opisi za zatvorene elektrane, rečenica o Open-Meteu na „O karti”).

**Što se ovdje ne može provjeriti:** ESLint, vitest komponenti i e2e (nema `node_modules`), izgled uvoda i slika
grafova → GitHub Actions nakon pusha i Cloudflare preview.
- **Regresija:** web 305 prolazi, 7 poznatih padova okvira, ugovor u redu, Prettier čist; pipeline ruff čist.

## Faza 25 — sloj „Slobodni kapacitet (HEP ODS)” na karti (15-5; plan 2026-11-15, korisnik: „može, samo radi redom”)

Redoslijed iz pregleda koda: (1) ovaj sloj, (2) podjela velikih modula, (3) zajednički SEO fixture, (4) dijeljenje
ostalih traka i OG slike, (5) starije otvorene stavke. Svaka faza završava regresijom.

- **Podaci:** `hep/current.json` (već se objavljuje); `loadHep` i `capacityOverlay` postoje i testirani su.
- **Sloj** `capacity` (skupina „Mreža”, iza trafostanica): točka po TS, boja po kategoriji postojeće mreže kao
  **sekvencijalna** skala jedne boje (nema mogućnosti → siva prstenasta točka, A → D sve tamnija zelena), ne crveno-zeleno
  (ordinalni raspon, ne ocjena; bolje za daltonizam); veličina po razini (110/x veća od 35/x).
- **Traka** u doku (kao geotermalna): broj TS po kategoriji (legenda s bojama), datum i izvor, obavezna napomena
  HEP ODS-a (informativno, ne jamči priključenje; kategorija je raspon; 35/x ograničava i TS iznad), poveznica na
  `/kapaciteti/`. Klik na TS: ime, razina, kategorija sada → s nadogradnjom, slobodno, poveznica na stranicu TS.
- **Refaktor:** `stationSlugs` iz `seo/capacity.ts` u `data/hep.ts` (klijent i stranice daju isti slug).
- **Provjera:** test stila (sloj vidljiv uz `?l=…,capacity`), test trake (CI), `LAYER_GROUPS` pokriva sve ključeve,
  regresija.

### Faza 25 — napravljeno (2026-11-15)

- [x] sloj `capacity` (skupina „Mreža”, ikona, napomena), izvor `energymap-capacity`, krug po TS: boja po kategoriji
  (sekvencijalna zelena, „nema” kao prigušeni prsten), veličina po razini, bolje kategorije iznad
- [x] `CapacityBar`: legenda s brojem TS po kategoriji, kartica kliknute TS (kategorija sada i s nadogradnjom,
  slobodno, poveznica na stranicu TS), izvor s datumom i napomena HEP ODS-a; tekst kategorija i naziva iz
  `seo/capacityCopy.ts` (karta i stranice govore isto)
- [x] `loadHep(…, { history: false })` za kartu (L-058); `stationSlugs` premješten u `data/hep.ts`
- [x] klik i pokazivač: zajednička provjera slojeva iznad pločica (kapacitet, geotermalne lokacije)
- [x] testovi: stil (+1), `loadHep` bez povijesti (+1), `CapacityBar` (+3, CI), e2e prazno stanje (+1)
- **Regresija:** web 306 prolazi (+1 u okviru; ostali u CI-ju), 7 poznatih padova okvira, ugovor u redu, Prettier čist
- Napomena za sljedeći korak (podjela modula): `dataSources` ima već sedam pozicijskih parametara → objekt opcija

### Faza 26 — podjela velikih modula i zajednički fixture (koraci 2 i 3, 2026-11-15)

- [x] `map/layers.ts` (1057 → 793 retka): izvori, id-jevi i arhive u `map/sources.ts`, zajednički izrazi (boje, veličine,
  hover, prsten odabira) u `map/layerStyle.ts`; `layers.ts` i dalje izvozi sve što su drugi moduli uvozili
- [x] `dataSources(urls, overlays, optIn)`: objekt umjesto sedam pozicijskih parametara (`Overlays`)
- [x] `seo/pages.ts` (1045 → 71): `site.ts` (podaci, model stranice, adrese, JSON-LD), `markup.ts` (HTML pomoćnici),
  `aboutPages.ts`, `assetPages.ts`, `countryPages.ts`; ostali SEO moduli uvoze izravno iz temelja, pa nema kružnih
  uvoza kroz `pages.ts`
- [x] `app/useOverlay.ts`: plin, geotermalna i kapacitet učitavaju se istom kukom (stabilne funkcije značajki)
- [x] SEO testovi `assets`, `capacity`, `energyPages`, `markdown`, `transition` grade `current` na `SAMPLE_CURRENT`
  (`seo` i `topics` imaju drukčiju strukturu adresa pa ostaju svoji)
- **Dokaz da se ništa nije promijenilo:** snimka izlaza prije i poslije: 16 kombinacija stanja, teme i fontova za
  `dataLayers` + `dataSources` (1,1 MB JSON) i **svih 154 datoteke** koje prerender napiše za bogat skup podataka
  (stranice, Markdown, JSON API, sitemap, llms) — identično, bajt za bajt; isti popis izvoza
- **Regresija:** web 306 prolazi, 7 poznatih padova okvira, ugovor u redu, Prettier čist

### Faza 27 — dijeljenje traka i sitnice iz pregleda sučelja (koraci 4 i 5, 2026-11-15)

- [x] izbornik „Podijeli” na traci „Odakle dolazi struja” (CSV sata: izvori, uvoz, nepoznato, ukupno), vremeplovu
  (CSV: MW po izvoru za svaku godinu) i geotermalnoj traci (CSV lokacija s izvorima); poveznica = trenutni prikaz
  karte, citat s izvorom i datumom; bez slike (to su HTML/SVG prikazi, a karta ima svoju sliku u „Podijeli”)
- [x] `ChartShare`: slika i ugradnja nisu obavezne, izbornik se na trakama otvara prema gore (`placement="above"`)
- [x] `share/tables.ts` (+3 testa), testovi traka (+2, CI)
- [x] oblačić za elektrane vremeplova iz GEM-a (ime, izvor, snaga, godine rada) (+1 test)
- [x] legenda cijena: „Italija: cijena zone Sjever (IT-Nord)”
- [x] „O karti”: pitanje „Šalje li kartica ‚Kod mene’ moju lokaciju?” (zaokruženo na dvije decimale, samo Open-Meteo,
  ne sprema se), i u JSON-LD `FAQPage`
- **Nije napravljeno, s razlogom:** OG slike po stranici traže novu ovisnost za iscrtavanje PNG-a (npr. resvg); bez
  mreže ovdje se ne može instalirati ni provjeriti, a `package.json` bez ažuriranog `package-lock.json` srušio bi
  `npm ci` u CI-ju. Visina trake uživo na mobitelu: dok je pomičan i ograničen na pola zaslona; prijedlog „sažetak +
  više” tek nakon pogleda na previewu.
- **Regresija:** web 310 prolazi, 7 poznatih padova okvira, ugovor u redu, Prettier čist
- **Sljedeće:** 20-5 službeni udio OIE (Eurostat) na „Zelenoj tranziciji”, zatim 20-4 mjesečni izvještaj

## Faza 28 — službeni udio obnovljivih izvora (Eurostat) na „Zelenoj tranziciji” (20-5; plan 2026-11-15, korisnik: „može radi”)

**Cilj:** cilj NECP-a (42,5 % OIE u bruto konačnoj potrošnji energije 2030.) dosad je bio samo objašnjen, jer ga
pokazatelji za struju ne mjere. Eurostat objavljuje službenu vrijednost; stranica je pokazuje uz cilj, kroz godine
i u usporedbi sa susjedima.

**Izvor (provjereno 2026-11-15):** Eurostat, skup `nrg_ind_ren` (SHARES), API Statistics u JSON-stat 2.0:
`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_ind_ren?format=JSON&lang=EN&unit=PC&…`.
Pokazatelji `REN` (ukupno), `REN_ELC` (struja), `REN_HEAT_CL` (grijanje i hlađenje), `REN_TRA` (promet); zemlje:
svih 8 iz opsega (RS, BA i ME kao ugovorne strane Energetske zajednice, katkad godinu kasnije: BA je u siječnju 2026.
imala podatke do 2023.) i `EU27_2020`. Godišnje, T+1 (podaci za 2024. objavljeni 18. 12. 2025.). Licenca: CC BY 4.0,
„izvor se mora navesti”; za prilagođeni izvod citira se poveznica skupa podataka. `value` je rijedak objekt s
ključevima od 0, `status` oznake (p, e, b…). Pravi odgovor API-ja ovdje nije dohvatljiv (mreža), pa je parser
napisan prema specifikaciji JSON-stat 2.0 i dokumentaciji Eurostata, prihvaća oba oblika (`value` kao objekt ili
niz), a nepoznat oblik odbija glasno (CI crven, ništa se ne objavi).

**Pristup:**
1. Pipeline `energymap/eurostat/renewables.py`: dohvat jednim upitom, općeniti čitač JSON-stat ćelija (koraci po
   `id`/`size`), dokument `eurostat/renewables.json` (godine, nizovi po zemlji i pokazatelju, oznake, `missing`,
   `contentHash`, Eurostatov `updated`). Validacija: HR mora imati sve pokazatelje i ≥ 10 godina; vrijednosti 0–200 %
   (struja može prijeći 100 %). Objava: nepromijenjen sadržaj se ne piše; dokument s ranijom zadnjom godinom od
   objavljenog odbija se (krnji odgovor), objavljeno ostaje.
2. CLI `energymap eurostat fetch|publish-r2|publish-dir`; workflow `eurostat-update` jednom mjesečno (prekidač
   `SCHEDULE_OSM`, kao ostali izvori koji trebaju samo R2) i u `web.yml` → `workflow_run`, da se stranice obnove.
3. Web `data/eurostat.ts` (zod shema + provjera duljina nizova + pomoćnici), prerender ga učitava kao neobavezan.
4. „Zelena tranzicija”: prva rečenica i odjeljak „Službeni udio obnovljivih izvora (Eurostat)”: HR kroz 10 godina
   (ukupno, struja, grijanje i hlađenje, promet, s oznakama p/e/b), razlika do cilja u postotnim bodovima (samo
   oduzimanje, bez projekcija), usporedba sa susjedima i EU za istu godinu (zemlja bez te godine: zadnja godina u
   zagradi), objašnjenje zašto se „struja” po Direktivi razlikuje od udjela u proizvodnji gore (normalizacija hidro i
   vjetra, nazivnik bruto konačna potrošnja struje), redak izvora s poveznicom. Tekst cilja: „bruto konačnoj
   potrošnji” (potvrđeno), bez godine plana (izvori ne slažu 2024./2025.). Stranica postoji i samo s Eurostatom.

**Alternative:** ručno upisane brojke u kod (zastarijevaju, krše „podaci s izvorom”); DBnomics kao posrednik
(još jedan izvor koji može pasti, licenca ista) — odbačeno.

**Rizici:** stvarni oblik odgovora drukčiji od specifikacije → prvi ručni run padne glasno; zato prvo ručno
pokretanje, pa prekidač. Eurostat ograničava upit na 50 kategorija; ovaj ih ima 14 (+ godine).

**Provjera:** pytest (parser, upit, nedostajuće zemlje, greška API-ja, promjena formata, objava, CLI), web testovi
stranice (CI za zod), regresija, Prettier, ruff.

### Faza 28 — napravljeno (2026-11-15)

- [x] pipeline: `energymap/eurostat/renewables.py` (općeniti čitač JSON-stat ćelija, dokument, validacija, objava
  bez prepisivanja nepromijenjenog i s odbijanjem krnjeg odgovora), CLI `energymap eurostat …`, workflow
  `eurostat-update.yml` (prekidač `SCHEDULE_OSM`, test pravila workflowa), `web.yml` gradi stranice nakon njega;
  `tests/test_eurostat.py` (+27: položaji ćelija, objekt i niz, upit, poravnanje godina, oznake, greška API-ja,
  8 promjena formata, jedinica, raspon, 7 slučajeva validacije, objava, CLI); ruff, mypy --strict čisti
- [x] web: `data/eurostat.ts` (shema, provjera duljina, `shareAt`, `latestShare`) + fixture s izmišljenim
  brojkama (+4 testa); `SiteData.renewables`, prerender ga učitava kao neobavezan; „Zelena tranzicija”: prva
  rečenica, odjeljci „Službeni udio obnovljivih izvora (Eurostat)” i „Usporedba sa susjedima i EU-om”, razlika do
  cilja (`counted` s množinom za decimale: „8,4 postotna boda”, „1,1 postotni bod”; premješten u `markup.ts`),
  cilj „bruto konačnoj potrošnji”, metodologija, JSON-LD (`variableMeasured`, `isBasedOn`), opis, `llms.txt`
  (+7 testova)
- [x] regresija: web 321 prolazi (+11), 7 poznatih padova okvira; ugovor pipeline → web proširen dokumentom
  Eurostata i u redu; Prettier čist, `tsc` bez novih grešaka; pipeline: izvorni testovi 156 prolaze, ostali padovi
  su poznata ograničenja okvira (osmium/shapely)
- [x] README (Faza 28, licence), `infra/README.md` (prekidač)
- **Prvo pokretanje (ti):** Actions → `eurostat-update` → Run workflow. Ako je zelen, stranica se sama ponovno
  izgradi; ako padne, poruka kaže što je u odgovoru drukčije.
- **Sljedeće:** 20-4 mjesečni izvještaj (Faza 29)

## Faza 29 — mjesečni izvještaj (20-4; plan 2026-11-15, korisnik: „može, radi”: 24 mjeseca, feed da)

**Cilj:** za svaki završeni mjesec stranica s trajnom adresom koja se može citirati („Struja u Hrvatskoj i regiji:
listopad 2026.”), samo iz podataka koje stranica već objavljuje; ništa novo u pipelineu.

**Pristup:**
1. `seo/report.ts`: `/izvjestaji/2026-10/` i `/en/reports/2026-10/` za zadnja 24 potpuna mjeseca (pokrivenost kao
   `COMPLETE_COVERAGE`), te popis `/izvjestaji/` i `/en/reports/`.
2. Sadržaj iz ENTSO-E mjesečnih zbrojeva: proizvodnja Hrvatske po izvoru (MWh i udio), udio obnovljivih, CO₂
   intenzitet, potrošnja gdje je ima; usporedba s prethodnim mjesecom i istim mjesecom lani (samo razlike, bez
   projekcija); tablica regije za taj mjesec (udio obnovljivih, CO₂ intenzitet); HEP-ovo izdanje ako je izašlo u
   tom mjesecu; zadnji službeni godišnji udio (Eurostat) kao kontekst; poveznice na „Zelenu tranziciju” i
   proizvodnju.
3. Prva rečenica za citiranje: „U listopadu 2026. obnovljivi izvori dali su X % proizvodnje struje u Hrvatskoj
   (rujan: Y %, listopad 2025.: Z %), uz CO₂ intenzitet od oko N g/kWh.”
4. JSON-LD `Dataset` s `temporalCoverage`, Atom feed (unos za svaki novi mjesec), sitemap, `llms.txt`, Markdown,
   citat (postoji za sve stranice).

**Alternative:** jedna stranica „zadnji mjesec” (bez trajne adrese za citiranje, odbačeno); e-mail bilten (traži
servis za slanje i popis adresa, izvan „static-first”; može kasnije preko feeda).

**Otvoreno za korisnika:** koliko mjeseci unatrag (prijedlog 24; od 2015. bilo bi oko 130 stranica po jeziku) i
unos u feed (prijedlog: da).

**Provjera:** testovi stranica na izmišljenim brojkama, bez siročadi, Markdown, regresija.

### Faza 29 — napravljeno (2026-11-15)

- [x] `seo/report.ts` + `seo/reportCopy.ts`: popis `/izvjestaji/` (`/en/reports/`) i izvještaj za svaki od zadnja
  24 potpuna mjeseca (`/izvjestaji/2026-09/`): rečenica za citiranje (udio obnovljivih prema prethodnom mjesecu i
  istom mjesecu lani, CO₂ intenzitet), ukupna proizvodnja i potrošnja, tablica izvora za tri mjeseca, regija
  (samo zemlje s potpunim mjesecom), HEP-ovo izdanje objavljeno u tom mjesecu, metodologija, prethodni/sljedeći;
  JSON-LD `Dataset` s `temporalCoverage`; mjeseci u hrvatskom nominativu i lokativu
- [x] Eurostatov godišnji udio samo na popisu (mijenja se jednom godišnje; izvještaji ostaju kakvi su bili)
- [x] `energyPages.periodRows` (godine i mjeseci; `yearRows` je omotač), `largestSource` izvezen;
  `RES_TARGET_2030` premješten u `data/eurostat.ts`
- [x] feed: `atomFeed` prima i tuđe unose s vlastitim datumom (`FeedEntry`); tri najnovija izvještaja, datirana
  danom zadnje promjene sadržaja iz SEO manifesta; feed postoji i bez izvještaja o promjenama
- [x] poveznice: početna, „Zelena tranzicija” (zadnji izvještaj + popis), `llms.txt`
- [x] testovi `seo/report.test.ts` (+9, izmišljene brojke) · regresija: web 330 prolazi (+9), 7 poznatih padova
  okvira, ugovor u redu, Prettier čist, `tsc` bez novih grešaka; postojeći testovi feeda prolaze bez izmjena

## Energetika izvan struje (2026-11-15, korisnik: „idemo redom što možemo, sve ostalo za kasnije i zapišimo”)

Iz Geminijeva popisa, po vrijednosti i dostupnosti otvorenih podataka. Načelo kao dosad: samo stvarni podaci s
izvorom; što se ne može provjeriti, ne radi se napamet.

### Faza 30 — plin uživo: tokovi na granicama, LNG Krk, Okoli

- [x] **Korak 1 (2026-11-15): pregled točaka.** ENTSOG ne daje koordinate, a nazive i ključeve točaka na granicama
  odavde se ne može provjeriti (nema mreže). `energymap gas points` (`gas/points.py`) ispisuje sve smjerove točaka
  operatora u opsegu, polja koja platforma stvarno vraća i zadnji dnevni tok na granicama (ITP/VIP), LNG-u i
  skladištima; radni tok `gas-points.yml` (samo ručno) stavlja tablicu u sažetak posla, a `points.json` u
  artefakte. Ništa ne objavljuje. Testovi `test_gas_points.py` (+4).
- [ ] **Korak 2 (čeka korak 1):** ti pokreneš `gas-points` i pošalješ `points.json` (ili sažetak). Zatim:
  ručni popis točaka s koordinatama i parom zemalja (ključ = ENTSOG `pointKey`), dnevni tokovi u postojeći
  `gas-daily`, strelice plina na karti kao kod struje (neto tok po granici), krug na Krku (LNG), stranica „Plin u
  Hrvatskoj: LNG Krk, skladište, tokovi”.
- [ ] **Korak 3 (čeka odluku):** punjenost Okolija iz GIE AGSI+. Treba API ključ (registracija na agsi.gie.eu) i
  provjera uvjeta korištenja; ključ ide u tajne repozitorija.

### Za kasnije (zapisano, redom)

| # | Što | Zašto ne sada | Što treba |
|---|---|---|---|
| 2 | CO₂ po postrojenju (godišnje verificirane emisije, EU ETS / EEA registar industrijskih emisija) | oblik i polja datoteka odavde se ne mogu provjeriti; za BA, RS, ME službenih podataka po postrojenju vjerojatno nema | jedno preuzimanje datoteke za pregled; odluka smiju li GEM-ove procjene popuniti BA/RS/ME (jasno označene) ili ostaje praznina. Bez animacije dima (simulacija); izmjerena kvaliteta zraka i smjer vjetra mogu |
| 3 | Vodik (Dolina vodika Sjeverni Jadran, Cres, pilot-projekti) | velik dio su najave, malo stvarnih postrojenja | ručni popis s izvorom uz svaki zapis, kao geotermalni (`overrides/hydrogen.yaml`), faze projekta; sloj i stranica |
| 4 | Toplinarstvo i kogeneracija | pokrivenost OSM oznaka (`plant:output:hot_water`, `steam`) za HR nije poznata | oznaka „daje i toplinu” i toplinska snaga na elektranama; veza s geotermalnom kaskadom; mreže nisu otvoreni podaci |
| 5 | Nafta: rafinerija Rijeka, JANAF-ovi terminali | — (izvedivo iz OSM-a) | točke iz OSM-a (`industrial=refinery`, terminali), godišnji protok iz JANAF-ovih izvještaja ručno s izvorom; protoka uživo nema |
| 6 | Energetske zajednice | malo podataka, popisi razbacani | ručni popis s izvorima kad ih bude više |
| 7 | Biomasa i bioplin (bolja pokrivenost) | HROTE-ov popis: uvjeti ponovne upotrebe nepoznati | provjera uvjeta; dopuna postojećeg sloja elektrana, ne novi sloj |

## Faza 31 — temeljita provjera (5 podagenata, 2026-11-15) i ispravci redom

Korisnik: „kreni temeljito sa subagentima u provjeru svega, provjeri temeljito i UX”, pa „nastavi sa
subagentima”. Pet neovisnih pregleda (pipeline i workflowi; podaci i SEO stranice; logika karte; UX i
pristupačnost aplikacije; statične stranice u pravom pregledniku na 390 i 1280 px, svijetlo i tamno). Oko 110
nalaza; ovdje su grupirani po težini, a radi se redom. Svaki nalaz se prije ispravka provjeri.

**Serija 1 — pokvareno u produkciji / krivi podaci (P0)**
- [x] 1.1 CSP `style-src 'self'` blokira ugrađeni `<style>` svih statičnih stranica i 404 (PROVJERENO) te
  `style=""` u `index.html` → hash stila u CSP-u, `noscript` bez inline stila
- [x] 1.2 statične stranice na mobitelu: `dl` (trafostanica, API) gura vrijednosti izvan ekrana; tablice bez
  vlastitog omotača za klizanje; broj i jedinica se lome (`\u00a0`); kontrast poveznica i sivog teksta na pozadini
- [x] 1.3 stranica zemlje: broj elektrana uključuje planirane uz „u pogonu”; „u 1 elektrana”, „across 1 power plants”
- [x] 1.4 aplikacija: izbornici (Preuzmi bazu, Podijeli, dijeljenje grafova) odrezani unutar donjeg spremnika →
  Popover API (top layer, Escape i klik izvan)
- [x] 1.5 mobitel: trake u donjem spremniku prekrivaju otvoren „Filtri i pregled”; trake bez gumba za zatvaranje

Serija 1 napravljeno (2026-11-15):
- 1.1 `seo/style.ts` (stil statičnih stranica na jednom mjestu), `vite/securityHeaders.ts` dodaje njegov SHA-256
  u `style-src`; test renderira sve stranice i 404 i provjerava da je hash točno taj i da nema `style=""`;
  `index.html` bez inline stila (`.no-script` u tokens.css); maknut zastarjeli `interest-cohort`
- 1.2 tablice u `.scroll` omotaču (`role="region"`, fokusabilan, ime po stupcima); `dl` u jednom stupcu na
  mobitelu; `td.num` bez lomljenja; kontrast `--muted #56616b`, `--accent #1a6680`; poravnanje zaglavlja,
  FAQ razmaci, citat, `pre` 14 px. Nevezivi razmak u `i18n.power/energy` isproban pa vraćen (mijenja desetke
  testova komponenti koje se ovdje ne mogu pokrenuti); isti učinak u tablicama daje CSS. Provjereno ponovnim
  renderiranjem 28 stranica: nijedna stranica ni kartica više ne klizi bočno
- 1.3 `operatingPlants` u sažetku; rečenice „Elektrane u pogonu zabilježene na karti: N”, početna „Elektrane u pogonu”
- 1.4 `share/PopoverMenu.tsx` (Popover API, `placeMenu` s testom): preuzimanje, dijeljenje karte i grafova;
  gumbi imaju ime i na mobitelu; e2e lokatori na gumbe. Provjereno u Chromiumu na replici s pravim CSS-om:
  izbornici cijeli, klikabilni, Escape zatvara (računalo, mobitel, položeni mobitel)
- 1.5 listovi na mobitelu `z-index: 4` (listovi 49/49 vidljivih redaka, prije 41 px); traka uživo ima ✕
  („Isključi tokove uživo”); gumbi traka 44 px na dodirnim ekranima

**Serija 2 — cjelovitost podataka u pipelineu (P1)**
- [x] 2.1 HEP povijest: dedup samo susjednih jednakih snimki (A→B→A gubi zadnju)
- [x] 2.2 HEP „nepromijenjeno” mora uključiti `dataVersion` i `dataDate`
- [x] 2.3 Eurostat: odbiti odgovor koji gubi objavljene zemlje/pokazatelje ili im zadnju godinu
- [~] 2.4 ENTSO-E spajanje: ne zamijeniti dan podacima s manje tehnologija
- [x] 2.5 `web.yml` concurrency: neuspjeli ili preskočeni `workflow_run` otkazuje deploy s maina
- [x] 2.6 OSM objava bez `DATA_BASE_URL` nema zaštitu od pada broja objekata
- [x] 2.7 sitnije: keepalive samo uz `SCHEDULE_OSM`; `gas --days` bez granica; NaN tokovi; pregled plinskih točaka
  pada na prvoj grešci; provjera konfiguracije u eurostat/geothermal/emodnet/gem workflowima; README infra

Serija 2 napravljeno (2026-11-15):
- 2.1 `build_history` sažima samo uzastopne snimke istog sadržaja (A → B → A ostaje tri koraka), test
- 2.2 HEP je „nepromijenjen” tek kad se slažu sadržaj, `dataVersion`, `dataDate` i područja; novo izdanje s
  istim brojkama se objavljuje (datum „stanje” se pomiče), povijest ostaje na prvoj pojavi sadržaja; test
- 2.3 Eurostat: `losses()` uspoređuje svaku objavljenu zemlju i pokazatelj; gubitak ili starija zadnja godina
  odbija se osim uz `--allow-drop` (CLI, korak objave); test (samo HR, nestali SI REN_ELC 2024)
- 2.4 **ostavljeno namjerno**: dan s istom pokrivenošću i manje tehnologija zamjenjuje se jer to traži
  postojeći test („a revised day drops technologies that disappeared”: ENTSO-E ispravlja pogrešnu tehnologiju);
  gubitak je trajan samo ako tehnologija izostane svih 7 dana osvježavanja. Ako se pokaže u praksi, pravilo:
  zamjena samo uz jednak ili veći broj tehnologija
- 2.5 `web.yml`: neuspjelo/preskočeno `workflow_run` pokretanje ima svoju grupu (`…-idle`) i preskače provjere,
  pa ne prekida objavu i ne troši 20 min; testovi pravila
- 2.6 `osm-build`: objava traži `DATA_BASE_URL` (provjera prije builda)
- 2.7 keepalive radi uz bilo koji prekidač (test pravila prilagođen); `gas fetch --days` 1–60; `NaN`/beskonačno
  u ENTSOG-u nije tok; pregled plinskih točaka bilježi grešku po točki i nastavlja, prazan odgovor je greška,
  provjera jedinice; provjera R2 tajni u eurostat/geothermal/emodnet/gem workflowima; `infra/README.md`
  (prekidači, keepalive, bucket, ponovna izgradnja stranice)

**Serija 3 — točnost statičnih stranica (P1/P2)**
- [x] 3.1 puni zapisi za stranice objekata (17-11) se u produkciji nikad ne učitaju
- [x] 3.2 sve stranice datirane tjednim OSM izdanjem → datum po izvoru (energija, live, HEP, Eurostat)
- [x] 3.3 izvještaji: zadržati sve mjesece (obećana trajna adresa); navigacija izvan hasha stranice
- [x] 3.4 prazna rečenica bez potrošnje; „nedostaje 0 postotnih bodova”; poveznice na stranice koje se ne grade;
  feed (naslov, autodiscovery); „od 2015.”; poredak elektrana s planiranima; krivi naslovi stupaca u tablici
  proizvodnje; „2026..”; ISO datumi u tekstu; „od 302 trafostanica”; `date()` bez vremenske zone

Serija 3 napravljeno (2026-11-15):
- 3.1 prerender učitava `plants` i `substations` NDJSON preuzimanja (gzip ili već raspakirano) i iz njih zapise
  samo za objekte koji dobivaju stranicu (`loadRecords`, `loadGzipText` s testom); nedostaje li preuzimanje,
  build pada. Poredak elektrana tada broji samo one u pogonu („Najveća hidroelektrana u pogonu u Hrvatskoj …
  (od N u pogonu s upisanom snagom)”; prvo mjesto bez „1.”, planirana elektrana se ne rangira); test
- 3.2 `SiteData.energyUpdatedAt` i `builtAt`: stranice proizvodnje i izvještaji nose datum ENTSO-E pokazivača,
  cijene `live.generatedAt`, kapaciteti `publishedAt`, geotermalna svoj dokument, „Zelena tranzicija” najnoviji
  od svojih izvora (`latestDate`); promijenjena stranica u sitemapu dobiva dan builda, ne dan OSM izdanja; testovi
- 3.3 izvještaji od `REPORTS_FROM = "2024-11"` zauvijek (pri pokretanju točno 24, zatim rastu); prethodni i
  sljedeći u `page.nav`, izvan hasha stranice (test: dolazak listopada ne mijenja hash rujna i kolovoza)
- 3.4 rečenica o potrošnji samo kad je ima; prava prva godina umjesto „od 2015.”; razlika do cilja iz
  prikazanog udjela (42,47 → „dosegnut”); poveznice na pregled proizvodnje i cijene samo kad se grade, bez prazne
  sekcije (`hasGenerationOverview`, `hasPrices`); stupci „Izvor / Udio” u tablici po izvorima; feed: naslov
  „Novo na karti”, `hasFeed` za autodiscovery, API stranicu i llms.txt; „2026..” (geotermalna, `capSource`);
  mjeseci i datumi umjesto ISO u „Zelenoj tranziciji”; „od 302 trafostanice” (`stationsOf`);
  `i18n.date` u zagrebačkom vremenu; „Bosnia and Herzegovina”; navigacija „Glavna navigacija”; „provided”
- preostali P2 iz pregleda SEO-a prebačeni u 5.3: IndexNow samo promijenjene stranice, izmišljena adresa na API
  stranici, `checkedLive`/`checkedTimeline` u prerenderu, prazne tablice zemlje bez podataka, opis i varijable
  „Zelene tranzicije” samo za prikazane odjeljke, broj elektrana bez godine uključuje fosilne, `th scope`

**Serija 4 — aplikacija (P1/P2)**
- [ ] 4.1 svaki pomak karte ponovno gradi cijeli stil (novi `Set` objekti iz URL-a)
- [ ] 4.2 zasluge (attribution) zamrznute pri stvaranju karte: ENTSOG se ne pojavi, jezik se ne mijenja
- [ ] 4.3 nema korijenske granice greške; „Pokušaj ponovno” ne može oporaviti neuspjelo učitavanje MapLibre dijela
- [ ] 4.4 detalji objekta „Učitavanje…” + „izvan prikaza” bez kraja; fokus; Back izlazi sa stranice;
  `flyTo` ignorira smanjeno kretanje; `er=` ruši analitiku; uvod (predaja, ponovni povratak, dodir)

**Serija 5 — UX i pristupačnost (P1/P2), dio traži tvoju odluku**
- [ ] 5.1 kontrast tokena; aktivni čipovi; dodirne mete 44 px; 16 px polja (iOS); legenda na mobitelu i u
  ugradnji; raspored 721–1000 px; gusta traka uživo; imena gumba na mobitelu; MapLibre na hrvatskom;
  „Vi” umjesto „ti”; nazivlje; velika slova u grupama; prazna stanja; prečaci koji se mogu isključiti; h1
- [ ] 5.2 boje slojeva za daltoniste (380 kV crvena / 220 kV zelena, plin~biomasa) — **odluka:** zadržati
  OpenInfraMap konvenciju ili jednobojna skala za napone
- [ ] 5.3 statične stranice: poravnanje, mrvice, citat, FAQ razmaci, API oznake, 404, oznaka navigacije

## Raspored ažuriranja

| Izvor | Učestalost | Način |
|---|---|---|
| OSM | Tjedno | Automatski (cron) |
| HEP ODS kapaciteti (Faza 15) | U verzijama (provjera svaki dan) | Automatski, `hep-daily` (prekidač `SCHEDULE_HEP`) |
| Eurostat, službeni udio OIE (Faza 28) | Godišnje (provjera mjesečno) | Automatski, `eurostat-update` (prekidač `SCHEDULE_OSM`) |
| ENTSO-E kapaciteti | Mjesečno | **Nije napravljeno** (nema ni koda ni workflowa; vidi pregled 2026-09-17) |
| ENTSO-E tokovi (faza 6) | Po satu/dnevno | Automatski |
| GEM | Kad izađe novo izdanje (nekoliko puta godišnje) | Poluautomatski: preuzmi → pipeline → pregled diffa |
| TYNDP / PCI / planovi TSO-a | Kvartalno ili pri objavi | Ručni pregled + `overrides` |

---

## Otvorene odluke
1. ~~Uključujemo li Italiju?~~ ✅ **Da** (2026-09-16). Pretpostavka: cijela Italija.
6. ~~Austrija?~~ ✅ **Da** (2026-09-16). Cijela Austrija; važna zbog tranzita i crpnih hidroelektrana.
2. ~~Je li projekt komercijalan?~~ ✅ **Nekomercijalan** (2026-09-16): stranica je besplatna, bez oglasa, plaćenih paketa i komercijalnih klijenata. Time su dopušteni besplatni MapTiler plan i CC BY-NC podaci (uz atribuciju). **Ako se išta od toga promijeni, ova odluka se mora ponovno otvoriti.**
3. ~~Hosting~~ ✅ **Cloudflare Pages + R2** (2026-09-16). Domena još otvorena: do tada `*.pages.dev` i R2 javni URL.
4. ~~Jezik sučelja~~ ✅ **HR + EN** (2026-09-16)
5. ~~Koji slojevi iz "Proširenja" ulaze u prvu verziju?~~ ✅ **A (tokovi/proizvodnja/potrošnja), F (plin), I (Jadran)** (2026-09-16)

## Verifikacija plana (dry-run)
- Korisnik otvori stranicu → preuzme se samo HTML/JS + pločice za vidljivo područje (HTTP Range),
  pa je stranica brza i bez servera koji može pasti.
- Novi OSM podaci stignu → cron pokrene pipeline → validacija prođe → nove PMTiles se objave
  pod novim imenom → web pokazuje na novu verziju. Ako validacija padne → ništa se ne objavi,
  stara verzija ostaje, dobijemo obavijest.
- Isti objekt u OSM-u i GEM-u → konflacija ga spoji u jedan zapis s oba izvora u `provenance`;
  ako je dvojbeno → ide na ručni pregled umjesto krivog spajanja.
