# GridAtlas

Regionalna energetska karta: moderna interaktivna karta elektroenergetske infrastrukture za Hrvatsku i širu
regiju (**HR, SI, HU, RS, BA, ME, IT, AT**). Javno na <https://gridatlas.eu>.

> **Pokretanje:** popis računa, tajni i redoslijeda koraka je u [`PRIPREMA.md`](PRIPREMA.md).

Pravila rada su u `CLAUDE.md`, plan i stanje u `tasks/todo.md`, naučene lekcije u `tasks/lessons.md`.

## Struktura

```
pipeline/     Python pipeline: OSM → validirani slojevi → PMTiles → R2 (Faze 1 i 1b)
web/          Web stranica: Vite + React + MapLibre (Faza 4)
overrides/    Ručne odluke o spajanju OSM i GEM elektrana
infra/        Cloudflare i MapTiler postavke i upute
prototype/    Interaktivni prototip dizajna (demo podaci)
tasks/        Plan i lekcije
.github/      CI, ručni i tjedni build podataka, objava stranice, Dependabot
```

## Pipeline: brzi početak

Potrebno: Python 3.12+.

```bash
cd pipeline
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# provjere kvalitete
ruff check . && ruff format --check . && mypy src tests && pytest

# stvarni podaci (Italija je oko 2 GB, cijela regija oko 4 GB)
energymap osm download --data-dir data                 # sve zemlje
energymap osm download --data-dir data --countries HR  # samo Hrvatska, za prvu probu
energymap osm build    --data-dir data --countries HR
energymap osm build    --data-dir data --gem gipt.xlsx --overrides ../overrides/conflation.yaml   # + Global Energy Monitor
energymap tiles build  --data-dir data                 # treba tippecanoe ≥ 2.17 (apt install tippecanoe)
energymap diff         --data-dir data --baseline-url https://<javni-url>/   # što se promijenilo
energymap publish r2   --data-dir data                 # treba R2_* varijable, vidi infra/README.md
```

Isto se može pokrenuti na GitHubu: **Actions → osm-build → Run workflow**. Rezultat se preuzima kao artefakt.

### Koraci

1. **download**: URL-ovi iz službenog Geofabrik indeksa, provjera MD5, atomsko zapisivanje. Nepromijenjene datoteke se ne preuzimaju ponovno.
2. **prefilter**: zadržava samo `power` objekte (uključujući `construction:`, `proposed:` i `planned:`) i čvorove potrebne za geometriju.
3. **extract**: dalekovodi i kabeli (≥ 60 kV), trafostanice, elektrane; površine postaju točka na površini.
4. **zemlje**: Natural Earth granice. Vod koji prolazi kroz dvije zemlje (≥ 500 m u svakoj) je interkonektor. Kraj voda u moru dodaje najbližu zemlju, pa se prepoznaju i podmorski kabeli.
5. **validacija**: pydantic modeli. Build se odbija ako je neki sloj prazan ili je pao više od 10 % (`--allow-drop` za namjerne promjene).
6. **lokalna objava**: `data/out/builds/<id>/` s `lines.ndjson`, `substations.ndjson`, `plants.ndjson` i `manifest.json`; `data/out/LATEST` pokazuje zadnji ispravan build.
7. **pločice**: `grid.pmtiles` sa slojevima `lines`, `substations` i `plants` (z3–z14). Vidljivost po zoomu određuju napon i snaga. Arhiva se provjerava prije nego zamijeni staru.
8. **R2**: prvo se uploadaju i provjere svi dijelovi builda, a tek na kraju `current.json`. Čuva se zadnjih 5 buildova.

Izlazni kodovi: `0` uspjeh, `1` build odbijen validacijom, `2` greška (mreža, datoteke, podaci).

### Global Energy Monitor (Faza 2)

S `--gem` se elektrane iz GEM-ove tablice (Global Integrated Power Tracker, `.xlsx` ili `.csv`) spajaju s
OSM elektranama: položaj i poveznica ostaju iz OSM-a, a snaga, status, godina i operator dolaze iz GEM-a.
GEM elektrane bez para u OSM-u dobivaju vlastiti zapis (`gem:L1…:status`).

- Parovi koji su blizu, ali nisu dovoljno sigurni, ne spajaju se; nalaze se u `builds/<id>/conflation.json`
  pod `review`. Odluku upiši u `overrides/conflation.yaml` (`force` ili `never`).
- Ako GEM promijeni nazive stupaca, uvoz javlja koji nedostaju i koji postoje; nove nazive dodaj u
  `pipeline/src/energymap/gem/read.py` (`COLUMNS`).
- Zapisi s TransitionZero podacima nose licencu CC BY-NC 4.0 (zapisano po zapisu i u atribuciji).

### Proizvodnja i potrošnja kroz vrijeme (ENTSO-E, Faza 3)

```bash
export ENTSOE_TOKEN=...                                   # nikad u kod ni u log
energymap energy fetch   --data-dir data --from-year 2015  # jednokratno punjenje
energymap energy refresh --data-dir data --days 7          # svakodnevno (ENTSO-E naknadno ispravlja podatke)
energymap energy pull    --data-dir data --baseline-url https://<javni-url>/   # novo računalo: objavljene godine
energymap energy publish-r2 --data-dir data               # objava (treba R2_* varijable)
```

- `data/energy/daily/<godina>.json`: MWh po lokalnom danu, po zemlji i izvoru, s pokrivenošću dana (0–1).
  Dan bez podataka je `null`, nikad 0.
- `data/energy/periods.json`: mjeseci i godine, izvedeni iz dnevnih podataka.
- Objava: `energy/current.json` pokazuje na godišnje datoteke i mjesečne/godišnje zbrojeve. Objava se odbija
  ako neka zemlja u nekoj godini ima manje pokrivenih dana nego u objavljenoj verziji.
- Automatika: `energy-daily` (svaki dan u 05:30 UTC, zadnjih 7 dana) i `energy-backfill` (ručno, npr. od 2015.).
- Italija: prvo se traže podaci za cijelu zemlju, a ako ih nema, zbrajaju se zone. Zbroj se sprema samo za
  dane u kojima su sve zone javile podatke.

### Tokovi preko granica i cijene (Faza 6A)

```bash
energymap live fetch      --data-dir data   # jučer, danas i sutra, po satu
energymap live publish-r2 --data-dir data   # live/current.json (keš 5 minuta)
```

- 14 granica unutar regije (Hrvatska i Crna Gora nisu izravno povezane); neto tok po satu, samo za sate za
  koje oba smjera imaju potpune podatke.
- Cijene dan-unaprijed po zoni trgovanja (Italija po zonama); BA i ME nemaju burzu i vode se kao "nema podataka".
- Workflow `live-hourly` radi svaki sat. Ako ENTSO-E ne vrati ništa upotrebljivo, objavljeni podaci ostaju.

### Jadran: cjevovodi i vjetroelektrane na moru (EMODnet, Faza 6C)

```bash
energymap marine fetch            --data-dir data                     # EMODnet → data/marine (samo regija)
energymap sources emodnet-upload  --data-dir data                     # provjerena kopija na R2
energymap sources emodnet-fetch   --data-dir data --baseline-url URL  # kopija s R2 (buildovi)
energymap osm build               --data-dir data --marine data/marine
```

- Novi sloj **cjevovodi (more)**: medij, status, operator, promjer, duljina. Stariji buildovi bez tog sloja i dalje
  se mogu objaviti.
- Vjetroelektrane na moru ulaze među elektrane, osim ako na 5 km već postoji vjetroelektrana iz OSM-a ili GEM-a.
- EMODnet nema jadranske energetske kabele; oni dolaze iz OpenStreetMapa.
- Workflow `emodnet-update` jednom mjesečno sprema kopiju; tjedni build koristi nju, pa ispad EMODneta ne ruši
  ažuriranje karte.

### Punionice za električna vozila (Faza 7D)

Iz OpenStreetMapa (`amenity=charging_station`), u **vlastitom arhivu pločica** (z11–z14) i zadano
isključenom sloju: ima ih desetke tisuća, pa ih nitko tko ih ne traži ne preuzima.

Prikazuje se ime, operator i broj mjesta za punjenje (`capacity`). **Snaga se ne prikazuje**: u OSM-u je
razbacana po `socket:*` ključevima u previše oblika da bi se svela na jedan pošten broj. Punionice ne
ulaze u indeks pretrage (preuzima ga svaki posjetitelj, a imena su uglavnom generička).

Predfiltar zbog njih ima **dva prolaza**: `amenity` je jedan od najčešćih ključeva u OSM-u, pa se ne
može filtrirati po ključu, a pyosmium filtri se lančaju kao I, ne kao ILI. Drugi prolaz zato bira po
točnom paru `amenity=charging_station` i ostaje sitan. Izvor se čita dvaput, jednom po novom izdanju.

### Podatkovni centri (Faza 7B)

Sloj ima dva izvora. Iz OpenStreetMapa dolaze objekti s oznakom `telecom=data_center` (i lifecycle
prefiksi za planirane), a ostalo iz **ručnog popisa** `overrides/datacenters.yaml`.

Popis u repozitoriju je **prazan**, i to namjerno: zapis se dodaje samo kad postoji javna stranica koja
ga potvrđuje, a poveznica na nju je obavezno polje (`source`). Build odbija cijelu datoteku ako ijedan
zapis prekrši pravilo, pa zapis „po sjećanju" ne može ući. `powerMw` se upisuje **samo ako je javno
objavljen**; procjena se nikad ne upisuje, jer broj na karti izgleda kao mjerenje.

Ručni zapis unutar 1 km od OSM zapisa **dopunjuje** taj zapis (ime, operator, snaga, godina) i zadržava
njegov id i položaj, pa dijeljeni linkovi ostaju valjani. Dalje od toga postaje zasebni zapis `dc:<id>`.
U detaljima se vide oba izvora i poveznica na stranicu s koje je podatak.

Poznato ograničenje: predfiltar drži ključeve `power*` i `telecom*`. Podatkovni centar označen samo kao
`building=data_center` zato ne ulazi; filtrirati po ključu `building` nije opcija jer je to jedan od
najčešćih ključeva u OSM-u i predfiltar bi izgubio smisao.

### Distribucijska mreža (Faza 7A)

Sve ispod 60 kV (`power=minor_line`, vodovi i kabeli < 60 kV, `substation=minor_distribution`) ulazi u
bazu kao **zaseban sloj**, u vlastitim datotekama `distribution_lines.ndjson` i
`distribution_substations.ndjson` te u vlastitom arhivu `distribution.pmtiles` (z10–z14).

Na stranici je sloj „Distribucijska mreža” **zadano isključen** i vidljiv od z10. Dok je isključen,
preglednik ne dohvaća ni jedan bajt tog arhiva, pa osnovna karta ostaje jednako brza. Pokrivenost u
OpenStreetMapu je neujednačena po zemljama, što sučelje izrijekom kaže; operatori distribucije ne
objavljuju otvorene trase. Statistika i indeks pretrage namjerno ostaju samo prijenosna mreža.

Izvan sloja ostaju stupni transformatori (`power=transformer`): to nisu vodovi, a broj im je ogroman.

### Što karta zna uz podatke (Faza 8)

- **Lebdenje:** prelaskom miša objekt zasvijetli, a uz kursor stoji ime, vrsta i ključna brojka.
  Isticanje je `feature-state` (bez novog stila po pokretu miša), pa karta ne trza.
- **Tokovi uživo teku:** crtice putuju po luku u smjeru toka. Staje uz `prefers-reduced-motion`,
  kad je kartica skrivena i dok se novi stil primjenjuje (inače karta nikad ne javi da je spremna).
- **„Novo":** treći tab u bočnoj ploči čita `diff.json` koji pipeline objavljuje uz svaki build:
  što je dodano, promijenjeno i uklonjeno od prošle objave, po sloju i zemlji, s primjerima na koje se
  skače klikom. Pipeline uz svaki primjer daje i koordinatu (`diff.py`, `representative_point`).
  Tab se ne nudi kad build nema izvještaj (prva objava starijim pipelineom).
- **Podijeli:** kopiranje poveznice (URL je cijelo stanje) i PNG trenutnog prikaza s upisanom
  atribucijom izvora, kako ODbL i CC BY traže. Slika sadrži platno karte; HTML oznake (brojke tokova) i
  ploče nisu na njoj.
- **Prečaci:** `/` pretraga, `Esc` zatvara, `?` popis, `t` tema, `l` tokovi uživo. Nikad dok se tipka.
- **Dizajn:** staklene ploče nad kartom (`backdrop-filter` gdje ga preglednik ima), ulaz detalja i
  oblačića, kostur umjesto praznine dok se pregled učitava; sve to jedan `--motion` ugasi uz
  `prefers-reduced-motion`.

### Gradovi: potrošnja energije po namjeni (Faza 10)

Sloj **Gradovi** i registar `/gradovi/` prikazuju što su gradovi predali Sporazumu gradonačelnika
(Covenant of Mayors): godišnju potrošnju energije po sektoru (javna rasvjeta, javni prijevoz, gradske
zgrade, stanovanje, industrija…) i energentu, iz čega izdvajamo struju. Izvor su tri Excel datoteke
po izdanju koje objavljuje JRC (`https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GCOM-MyCovenant/`),
licenca **CC BY 4.0** (`copyright.txt` u izdanju).

```bash
energymap cities download --data-dir data          # najnovije izdanje (ili --release 2025_Sixth_release)
energymap cities inspect --data-dir data           # imena listova i zaglavlja, za prilagodbu novom izdanju
energymap osm build --data-dir data --cities data/cities ...
```

Što to jest, a što nije: **registar s godinom inventara**, ne mjerenje uživo. Prikazuje se najnoviji
inventar grada (praćenje ima prednost pred baznim), a uz njega bazna godina i njezina struja, pa se vidi
promjena. Grad koji nije predao inventar nije prikazan; sektor koji grad nije prijavio nije nula, nego
ga nema. Pokrivenost ovisi o tome tko je potpisao: Italija i Mađarska dobro, Hrvatska solidno, ostale
zemlje regije slabo. Željeznica nije gradski inventar i ostaje izvan sloja.

Čitač (`pipeline/src/energymap/cities/read.py`) pronalazi datoteke popisom mape (imena su nepravilna
od izdanja do izdanja), listove po prefiksu imena i stupce po zaglavlju; nepoznat raspored **pada s
popisom onoga što je našao**. Raspored je izveden iz rada o skupu podataka (Scientific Data, 2024) i
provjerava se na fixtureu (`pipeline/scripts/cities_fixture.py`); prva stvarna obrada može tražiti
prilagodbu `LAYOUT` konstanti — zato postoji `cities inspect`.

### Tražilice i AI alati (Faza 9)

Karta je aplikacija, a tražilice i AI alati (GPTBot, ClaudeBot, PerplexityBot…) čitaju samo HTML koji
dobiju. Zato `npm run build` iz objavljenih podataka generira i **statične stranice**: `/o-karti/`
(izvori, licence, preuzimanja, česta pitanja; `Dataset` + `FAQPage` JSON-LD), `/zemlja/<hr|si|…>/`
(snaga po tehnologiji, km vodova; `Dataset`), `/objekt/<id>/` za elektrane ≥ 10 MW, trafostanice
≥ 220 kV i podatkovne centre (`Place` s koordinatama), uz engleske inačice pod `/en/…` s `hreflang`.
Uz njih idu `sitemap.xml` (s jezičnim inačicama), `robots.txt` (svi crawleri dopušteni, po odluci) i
`llms.txt`. Kod je u `web/src/seo/` (čiste funkcije, testirane) i `src/seo/entry.ts` (korak builda
`npm run prerender`). Za canonical i sitemap treba varijabla `SITE_URL` (PRIPREMA.md); stranica se
objavljuje i nakon svakog uspješnog builda podataka, da stranice ne zaostaju za kartom. Uz varijablu
`INDEXNOW_KEY` deploy nakon objave javlja IndexNow-u (Bing, Yandex, Seznam, Naver…) koje stranice
postoje (`web/src/seo/indexnow.ts`, `npm run notify:indexnow`); Google to ne koristi, za njega su
sitemap i Search Console.

### Doseg: ugradnja, feed, otvoreni JSON (Faza 12)

- **Ugradnja:** `?embed=1` daje samo kartu (bez zaglavlja i ploča) s poveznicom „Otvori cijelu kartu" na
  isti prikaz; meni Podijeli nudi gotov `<iframe>` kod. CSP zato dopušta `frame-ancestors *` — stranica
  nema prijave ni radnji koje bi clickjacking mogao zloupotrijebiti (`web/vite/securityHeaders.ts`).
- **Atom feed:** `/feed.xml` i `/en/feed.xml` iz izvještaja o promjenama (`diff.json`): što je dodano,
  promijenjeno i uklonjeno, s poveznicama na kartu; `<link rel="alternate" type="application/atom+xml">`
  na svim stranicama.
- **Otvoreni JSON:** `/api/index.json`, `/api/zemlja/<hr>.json`, `/api/objekt/<slug>.json`,
  `/api/gradovi.json` — statične datoteke iz builda s CORS zaglavljem, dokumentirane na `/api/`.
  Sažeci (polje `summary: true`); potpuni zapisi ostaju u NDJSON preuzimanjima na koja datoteke upućuju.
  Kod: `web/src/seo/{feed,api}.ts`.

### Crpilišta, rudnici i proizvodnja plina (Faza 13)

Pitanje je bilo „postoje li otvoreni podaci koji odmah mjere koliko se vadi". **Ne po bušotini ni po
rudniku** — nijedan otvoreni izvor ne mjeri proizvodnju pojedinog polja ili rudnika. Zato su ovo dva sloja
s jasno različitom svježinom:

- **Crpilišta i rudnici (13A)** — iz OpenStreetMapa, u vlastitom arhivu (`extraction.pmtiles`, z6–z14),
  zadano isključeno: `man_made=offshore_platform` (platforma), `petroleum_well` (bušotina),
  `industrial=mine` (rudnik), `mineshaft`/`adit` (okno/potkop) i `landuse=quarry` (površinski kop —
  **samo** kad `resource=*` kaže ugljen, lignit, treset, uran, naftu ili plin; kamenolomi kamena nisu
  energetski objekti). Tvar se čita iz `resource=*`/`substance=*` i boja krug; bušotina i platforma bez
  oznake su „nafta i plin", rudnik bez oznake „nepoznato". `disused:`/`abandoned:` se ne uzimaju. Sloj
  pokazuje **gdje** se vadi, nikad koliko — to piše u legendi i u detaljima. Platforme na moru dobivaju
  zemlju po najbližoj obali unutar ~1° (`config.OFFSHORE_TOLERANCE_DEG`), što je zamjena za granicu na
  moru koju Natural Earth nema. Treći prolaz predfiltra (`config.EXTRACTION_FILTER`), kao i punionice.
  Imenovane platforme, rudnici i kopovi dobivaju stranicu `/objekt/<slug>/` i `/api/objekt/<slug>.json`.
- **Proizvodnja plina (13D)** — koliko plina iz domaćih polja svaki plinski dan (06:00–06:00 CET) uđe u
  transportni sustav, s **ENTSOG Transparency Platforma** (javni API, bez ključa):
  `operatorpointdirections?idPointType=3` daje proizvodne ulazne točke po operatoru (bez koordinata),
  `operationalData?indicator=Physical Flow&periodType=day` dnevne tokove u kWh/d. `energymap gas fetch`
  skuplja zadnjih 14 dana u `live/gas.json`, `gas publish-r2` objavljuje; workflow `gas-daily` (07:40 UTC,
  prekidač `SCHEDULE_GAS`). Na karti: krug po zemlji na sidrištu (zbroj točaka, veličina = zadnji dan),
  detalji sa stupcem po danu; dan bez podatka je praznina, ne nula. Dokument koji nema nijednu vrijednost u
  zadnjih 7 dana se ne objavljuje (stari ostaje). Za naftu i ugljen takvog izvora nema.

Kod: `pipeline/src/energymap/gas/entsog.py`, `osm/tags.py` (`extraction_site`, `substance`),
`web/src/data/gas.ts`. Godišnja proizvodnja po polju/rudniku (GEM GOGET i GCMT) čeka preuzimanje s GEM-a
(`tasks/todo.md`, Faza 13B/C).

### Slobodni kapaciteti za priključenje: HEP ODS (Faza 15)

Koliko nove proizvodnje i baterija pojedina trafostanica distribucijske mreže još može primiti, s karte
**kapaciteti.hep.hr**. HEP ODS ne objavljuje API ni datoteku; **dopustio je ponovnu upotrebu** onoga što
njegova karta učitava (2026-11-08). Uz svaki prikaz stoji izvor i HEP-ova napomena: podaci su informativni,
ne jamče priključenje, a konačno se utvrđuje kroz EOTRP.

```bash
energymap hep fetch       --data-dir data   # trenutno izdanje → data/hep/current.json + regions.geojson
energymap hep publish-r2  --data-dir data   # snimka, povijest, područja i current.json (zadnji)
energymap hep publish-dir --data-dir data --out ../web/.data   # lokalno zrcalo
```

- **Izvor** (provjereno u pregledniku): `api/substation-data/current` (verzija i datum stanja),
  `api/substations/with-data` (488 trafostanica 110/x i 35/x kV, 440 s položajem; slobodni kapacitet i
  korisnici u kW, kategorija A–D ili „nema” za postojeću i nadograđenu mrežu, nadređena TS) i
  `regions/regions_low.geojson` (21 distribucijsko područje).
- **Osvježavanje:** HEP objavljuje u verzijama (`versionId`), ne svaki dan. Workflow `hep-daily` svaki dan
  pita; objavljuje samo kad se verzija ili sadržaj promijene. Svaka snimka ostaje
  (`hep/snapshots/<datum>-v<verzija>-<hash>.json`), a `hep/history.json` se svaki put iznova slaže iz svih
  snimki, pa jedan loš dan ne mijenja prošlost. Prekidač `SCHEDULE_HEP`.
- **Kad HEP promijeni format:** pydantic odbije odgovor (više od 2 % neispravnih redaka, preimenovano polje,
  manje od 300 trafostanica ili položaja), posao je crven i GitHub šalje e-mail; objavljeni podaci ostaju.
  Starije izdanje od objavljenog i pad broja trafostanica veći od 10 % se odbijaju (`--allow-drop` za namjeran).
- **Neobičnosti izvora** zapisane u kodu i testovima: prijenosni omjer zna proturječiti nazivu, pa razina
  napona dolazi iz naziva; prazan slobodni kapacitet ostaje prazan, nikad 0; kategorije se ne zbrajaju.
- **Na webu:** `web/src/data/hep.ts` (učitavanje i analitika kao čiste funkcije), statične stranice
  `/kapaciteti/` i `/en/grid-capacity/` (kategorije, po području, kroz izdanja, promjene, gdje bi nadogradnja
  pomogla) te stranica po trafostanici s poviješću i TS 35 kV koje napaja. Sloj na karti i interaktivni
  prikaz analitike su sljedeći korak (`tasks/todo.md`, 15-5 i 15-6).

Kod: `pipeline/src/energymap/hep/capacity.py`, `web/src/data/hep.ts`, `web/src/seo/capacity.ts`.

### SEO 2.0: tražilice i AI pretraživanje (Faza 16)

Domena je `https://gridatlas.eu` (`SITE_URL`, postavljanje u `infra/README.md`, B.4); produkcijski
deploy bez nje pada.

- **Početna** dobiva u prerenderu apsolutni canonical, `og:url`, `og:image`, `WebSite` JSON-LD s adresom i
  sažetak po zemljama za čitače bez JavaScripta (`web/src/seo/home.ts`, oznake `<!--seo:head-->` i
  `<!--seo:body-->` u `index.html`). Aplikacija zadržava opisni naslov kartice.
- **`404.html`**: bez nje Cloudflare Pages za svaku nepostojeću adresu vraća kartu sa statusom 200.
- **Tematske stranice** po zemlji i vrsti (`/zemlja/hr/hidroelektrane/`, `/zemlja/hr/trafostanice/`…, do
  500 najvećih) i `/najvece-elektrane/` (100 najvećih u regiji). Stranice zemalja povezuju tematske, a one
  objekte: test potvrđuje da je svaka stranica dohvatljiva s početne u najviše tri klika.
- **Breadcrumbs** (vidljivi + `BreadcrumbList`), **naslovi s ključnom brojkom** („HE X: hidroelektrana
  120 MW, Hrvatska”), `<link rel="alternate" type="application/json">` na otvoreni JSON, potpuniji `Dataset`.
- **`lastmod` koji nešto znači:** `seo-manifest.json` (putanja → hash sadržaja, datum) objavljuje se uz
  stranicu; sljedeći build ga čita sa `SITE_URL` i zadržava datum stranicama koje se nisu promijenile.
- **Markdown inačice:** uz svaku stranicu `index.md` (povezan iz heada, `Content-Type: text/markdown`) i
  `llms-full.txt` s glavnim engleskim stranicama u jednoj datoteci (`web/src/seo/markdown.ts`): AI alati ih
  čitaju jeftinije i pouzdanije od HTML-a.
- **robots.txt** imenom pušta i AI pretragu i dohvat na zahtjev korisnika (`OAI-SearchBot`, `ChatGPT-User`,
  `Claude-SearchBot`, `Claude-User`, `Perplexity-User`), ne samo crawlere za trening.

Što radiš ti: Google Search Console i Bing Webmaster Tools (ChatGPT pretraga i Copilot koriste Bingov
indeks), prijava sitemapa, `INDEXNOW_KEY`.

### Kvaliteta i doseg (Faza 17)

- **Jezik iz putanje:** `/` je hrvatski, `/en/` engleski; prerender piše i `dist/en/index.html` (engleski head
  i sažetak), aplikacija čita jezik iz putanje, a stari linkovi `?lang=en` se preusmjeravaju na `/en/?…`
  (`web/src/state/url.ts`, `canonicalUrl`). Preglednik više ne bira jezik sam.
- **Proizvodnja i cijene:** `/proizvodnja/` i `/proizvodnja/<zemlja>/` (godišnji zbrojevi po izvoru od 2015.,
  udio obnovljivih, potrošnja; nepotpune godine označene) i `/cijene-struje/` (satne cijene dan-unaprijed
  danas i sutra po zoni). Workflow `prices-daily` nakon aukcije provjeri da su cijene za sutra stigle i time
  pokrene objavu (`web/src/seo/energyPages.ts`). Bez ENTSO-E podataka stranice se ne rade.
- **Bogatije stranice objekata:** prerender čita potpune zapise iz NDJSON preuzimanja: status, operator,
  godina, naponi, izvori s licencama, rang u zemlji („2. najveća hidroelektrana u Hrvatskoj po upisanoj
  snazi”), udio u snazi u pogonu, najbliži objekti; pipeline zadržava OSM oznake `wikidata`/`wikipedia`, koje
  postaju `sameAs` (`web/src/seo/assetFacts.ts`, `records.ts`).
- **HEP ↔ karta:** HEP trafostanica se uparuje s OSM trafostanicom (≤ 500 m, napon nije niži, isto ime ima
  prednost, izjednačeni kandidati = bez para); stranice se međusobno povezuju.
- **Licenca preuzimanja:** u cjelini nekomercijalno, licenca uz svaki zapis (`web/src/seo/license.ts`).
- **Analitika posjeta:** CSP dopušta Cloudflare Web Analytics; uključuje se u Cloudflareu (`infra/README.md`).
- **Keepalive:** workflow `keepalive` dvaput mjesečno ponovno uključuje zakazane poslove.

### Karta u pokretu: uživo, cijene po zemljama, vremeplov (Faza 18)

Sve iz stvarnih podataka, u postojećem dizajnu karte (bez novih tema i ukrasnih animacija):

- **Uživo u pregledniku:** otvorena karta svakih 15 minuta (i pri povratku na karticu) u pozadini ponovno
  učita `live/current.json` i prati trenutni sat, osim ako je posjetitelj sam odabrao sat. Neuspjelo
  osvježavanje ostavlja zadnju dobru kopiju. Pipeline objavljuje svaki sat (`live-hourly`, prekidač
  `SCHEDULE_ENTSOE`); ENTSO-E i sam objavljuje sa zakašnjenjem, pa je to najbliže „uživo” što izvor daje.
- **Cijene po zemljama:** dok je sloj uživo uključen, zemlje (sloj `countries` iz `boundaries.pmtiles`) su
  obojane po cijeni dan-unaprijed odabranog sata: ispod nule hladno, oko nule neutralno, skupo toplo
  (`palette.price`, `map/priceScale.ts`). Zemlja bez cijene ostaje bez boje. Traka uživo ima legendu i
  „Pusti dan”.
- **Vremeplov:** u filtrima „Otvori vremeplov”. Elektrane u pogonu pojavljuju se u godini prve jedinice
  (`commissioningYear` iz pločica), a elektrane koje GEM vodi kao zatvorene vide se dok su radile i poslije
  kao sivi obrisi. Pipeline piše `timeline.json` (snaga u pogonu po godini, zemlji i tehnologiji, broj
  elektrana bez godine i popis zatvorenih; `timeline.py`), `current.json` ga navodi pod `timeline`. Godina je
  u linku (`?y=1975`).
- **Noćni sjaj:** u prigušenoj tamnoj temi dalekovodi imaju blagi sjaj svoje boje (`palette.lineGlow`), a
  tokovi preko granica sjaj u boji toka.
- **Tokovi u svijetloj temi:** ispod luka su svijetli rub (odvaja ga od vodova i točaka ispod) i blaga sjena
  pomaknuta prema dolje, pa luk „lebdi” iznad karte (`palette.flowHalo`).
- **Kretanje:** prijelazi boja između sati i godina traju 400 ms i gase se uz `prefers-reduced-motion`.

Ograničenja: elektrana proširena kasnije broji se cijelom snagom od prve jedinice; zatvorena jedinica na
lokaciji koja u OSM-u postoji kao cjelina može se kratko računati dvaput.

### Zelena tranzicija: pokazatelji (Faza 20)

- **Stranica `/zelena-tranzicija/`** (i `/en/energy-transition/`, `seo/transition.ts`), iz podataka koje već
  objavljujemo: udio obnovljivih u proizvodnji struje po godinama i CO₂ intenzitet proizvodnje po mjesecima
  (ENTSO-E), instalirana snaga obnovljivih kroz godine i zatvorene fosilne elektrane (`timeline.json`), što se
  gradi i planira (statistika izdanja), slobodni kapacitet mreže (HEP ODS), cilj iz NECP-a (42,5 %) s
  objašnjenjem da obuhvaća svu energiju, i metodologija. JSON-LD `Dataset` s `variableMeasured`, Markdown
  inačica, poveznice s početne, sa stranice Hrvatske i iz `llms.txt`. Bez podataka nema odjeljka ni stranice.
- **CO₂ intenzitet** (`data/co2.ts`): emisijski faktori životnog ciklusa (IPCC AR5 WGIII, Annex III, medijani);
  lignit kao ugljen, nafta 650 i „ostalo” 700 kao označene pretpostavke; skladištenje se ne broji. Kartica
  „Od čega je struja u mreži” pokazuje i intenzitet u odabranom satu.

### Podrška i partneri (Faza 24), ugrađeno i isključeno

- **Upaliti:** u GitHubu Settings → Secrets and variables → Actions → Variables dodaj `SUPPORT` = `1` i ponovno
  pokreni „Web” (ili pushaj). Ugasiti: obriši varijablu ili stavi `0`. Bez nje nema stranice, poveznica ni retka u
  sitemapu.
- **Uređivati:** `web/src/support.ts`: `contact` (e-adresa za partnere), `donate` (stranica za donacije, npr.
  udruge) i `partners` (ime, adresa, uloga `funder`/`data`/`institution`, `since` „2027-01”). Prazno polje znači
  da tog odjeljka nema; zod provjerava unos pri izgradnji.
- **Što se pojavi:** stranica `/podrska/` i `/en/support/` (kako pomoći, kontakt i potpora ako su upisani, tko
  podržava projekt, neovisnost), poveznica „Podržite projekt” u podnožju statičnih stranica, odjeljak na „O karti”
  i jedan tihi redak u dobrodošlici.
- **Prije donacija:** besplatni MapTiler i Open-Meteo su za nekomercijalnu upotrebu (dobrovoljne donacije Open-Meteo
  izričito dopušta), a odluka iz rujna 2026. kaže da je projekt nekomercijalan; sponzorstvo s promocijom tu odluku
  ponovno otvara (`tasks/todo.md`).

### Dijeljenje i citiranje grafova (Faza 23)

- Svaka kartica stranice „Energija” (`?p=energy`) ima izbornik **Podijeli**: poveznicu na graf (stanje je u
  URL-u, a sidro `#mix`, `#compare` ili `#range` otvara stranicu na kartici), **sliku (PNG)** s naslovom, onim što je
  prikazano, izvorom, datumom podataka, nazivom stranice i poveznicom upisanima u sliku, **podatke (CSV)** točno
  kakve graf ili tablica prikazuju (UTF-8 s BOM-om za Excel, brojevi bez oblikovanja), **citat** (redak za objavu,
  APA 7, BibTeX) i **kod za ugradnju** samo te kartice (`?p=energy&embed=1&ec=mix|compare|range`).
- Svaka kartica ima vlastiti redak izvora („Izvor: ENTSO-E Transparency Platform · stanje … · adresa”), pa ga
  nosi i snimka zaslona samo te kartice.
- Svaka statična stranica završava odjeljkom „Kako citirati” (redak za objavu i APA), a njezina Markdown inačica
  ima APA citat u podnožju.
- Kod: `web/src/share/` (`cite.ts`, `csv.ts`, `chartImage.ts`, `download.ts`, `ChartShare.tsx`),
  `web/src/energy/csv.ts`, `web/src/seo/citation.ts`.

### Uvod pri prvom posjetu (Faza 22)

- **Kada:** samo prvi posjet goloj adresi (preglednik pamti, `energymap-intro`). Nikad uz poveznicu sa stanjem
  karte (odabir, prikaz, slojevi, filtri, „uživo”, ugradnja…; parametri poput `utm_*` se ne broje), ni u
  automatiziranom pregledniku (`navigator.webdriver`: e2e i testovi vide običnu kartu). Uz smanjeno kretanje
  samo natpis koji ustupi mjesto karti.
- **Što:** samo natpis „GridAtlas” s crtom svjetla ispod, oko 2 sekunde
  (`app/Intro.tsx`) pokriva učitavanje; zatim karta dolijeće s globusa (na širokom zaslonu), nagnuta nad
  Jadranom, i spušta se točno na uobičajeni prvi prikaz, a to je cijela regija (`map/introFlight.ts`). Usput
  (`map/introStyle.ts`): granice regije zasvijetle prve, pojavi se „Hrvatska” pa imena susjeda, mreža se pali
  (vodovi, sjaj 380, 220 i 110 kV), gradovi daju toplo svjetlo (∝ √ potrošnje), pojave se točke i, ako su podaci
  tog sata tu, tokovi; oznake podloge čekaju kraj noći. Na kraju se sve smiri u temu. Sve što svijetli su
  podaci karte.
- **Pravila:** preskače se klikom, tipkom, kotačićem ili gumbom; ako se karta ne učita za 9 s, stranica se
  učitava kao i prije. Za vrijeme uvoda je noć, a svijetla tema se na kraju „razdani”; zaglavlje i paneli se
  pojave zajedno, a zasluge karte vide se cijelo vrijeme. Let se ne upisuje u poveznicu. Bez uvoda je stil
  karte potpuno isti kao prije.

### Plin: pregled točaka (Faza 30, korak 1)

- `energymap gas points --data-dir data` ispisuje sve točke operatora plinskog transporta u opsegu na ENTSOG-u
  (granice, LNG, skladišta, proizvodnja), polja koja platforma vraća i zadnji dnevni tok, te piše
  `data/gas/points.json`. Ništa ne objavljuje. Radni tok **gas-points** (Actions → gas-points → Run workflow)
  stavlja tablicu u sažetak posla i datoteku u artefakte; prema njoj se slaže sloj tokova plina.

### Mjesečni izvještaji (Faza 29)

- **Stranice** `/izvjestaji/` i `/en/reports/` (`web/src/seo/report.ts`): popis i po jedan izvještaj za svaki
  mjesec od studenoga 2024. (`REPORTS_FROM`) koji je ENTSO-E prijavio u cijelosti (barem 98 %), npr.
  `/izvjestaji/2026-09/`. Izvještaji se samo dodaju, nikad ne brišu: adresa je trajna i može se citirati. Prva
  rečenica je za citiranje: udio obnovljivih izvora u proizvodnji struje prema prethodnom mjesecu i istom mjesecu
  godinu ranije, uz CO₂ intenzitet. Slijede izvori za tri mjeseca, regija (samo zemlje s potpunim mjesecom),
  HEP-ovo izdanje ako je izašlo u tom mjesecu, metodologija i poveznice na susjedne mjesece.
- **Samo postojeći podaci** (ENTSO-E mjesečni zbrojevi, HEP ODS): ništa novo u pipelineu, bez projekcija.
  Eurostatov godišnji udio je samo na popisu, da se stari izvještaji ne mijenjaju svake godine.
- **Feed:** tri najnovija izvještaja ulaze u `/feed.xml` i `/en/feed.xml`, datirani danom kad im se sadržaj zadnji
  put promijenio (SEO manifest), pa se izvještaj u čitaču pojavi kad izađe, a ponovno samo ako ga ENTSO-E ispravi.

### Službeni udio obnovljivih izvora (Eurostat, Faza 28)

- **Izvor:** Eurostat, skup `nrg_ind_ren` (SHARES): udio obnovljivih izvora u bruto konačnoj potrošnji
  energije (`REN`, po njemu se mjeri cilj NECP-a od 42,5 % za 2030.), u struji (`REN_ELC`), grijanju i hlađenju
  (`REN_HEAT_CL`) i prometu (`REN_TRA`), za svih osam zemalja i EU-27. Godišnje, otprilike godinu dana kasnije;
  Srbija, BiH i Crna Gora (Energetska zajednica) katkad još godinu kasnije. Licenca **CC BY 4.0**.
- **Pipeline:** `pipeline/src/energymap/eurostat/renewables.py` jednim upitom čita API Statistics (JSON-stat 2.0;
  `value` i `status` kao objekt po položaju ili niz), sprema `eurostat/renewables.json` (godine, nizovi po
  zemlji i pokazatelju, Eurostatove oznake p/e/b, `missing`, `contentHash`). Hrvatska mora imati sva četiri
  pokazatelja i barem 10 godina; nepromijenjen odgovor se ne piše, a odgovor kojem nedostaje zadnja objavljena
  godina odbija se. CLI `energymap eurostat fetch | publish-r2 | publish-dir`, radni tok `eurostat-update.yml`
  (ručno i 12. u mjesecu uz `SCHEDULE_OSM`); nakon njega se stranice ponovno grade.
- **Stranica „Zelena tranzicija”:** prva rečenica i dva odjeljka: Hrvatska kroz zadnjih 10 godina (s oznakama),
  razlika do cilja u postotnim bodovima (samo oduzimanje, bez projekcija) i usporedba sa susjedima i EU-om za
  istu godinu (zemlja bez te godine: zadnja godina u zagradi). Objašnjeno je zašto „struja” po Direktivi nije
  isto što i udio u proizvodnji. Bez dokumenta stranica je kao prije; postoji i samo s Eurostatom.
- **Prvo pokretanje:** Actions → `eurostat-update` → Run workflow. Parser je pisan prema specifikaciji i
  dokumentaciji (pravi odgovor ovdje nije bio dohvatljiv); ako Eurostat odgovori drukčije, posao padne glasno i
  ništa se ne objavi.

### Geotermalna energija (Faza 21)

- **Lokacije** (`overrides/geothermal.yaml`, ručno uređen popis): elektrane, toplinarstvo, toplice i projekti,
  svaki zapis s fazom (u pogonu, projekt, potvrđen potencijal za grijanje, istraživanje, lokalni projekt),
  upotrebama i vlastitim izvorom. Koordinate su mjesta, ne bušotine. `pipeline/src/energymap/geothermal/`
  provjerava zapise (pydantic: obje bilješke, barem jedan izvor, bez dvostrukih oznaka).
- **Potencijal:** Global Heat Flow Database (IHFC, izdanje 2024., CC BY 4.0). Toplinski tok (mW/m²) na mreži od
  0,1°, IDW samo unutar 75 km od mjerenja i uz najmanje 3 mjerenja, bez ekstrapolacije. Orijentacijski, i tako
  piše uz legendu.
- **Objava:** `geothermal/current.json` (CLI `energymap geothermal fetch | publish-r2 | publish-dir`, radni tok
  `geothermal-update.yml`: ručno i mjesečno uz `SCHEDULE_OSM`). Ako preuzimanje ili provjera ne uspiju, ništa
  se ne objavljuje i ostaje zadnja dobra verzija.
- **Na karti:** sloj „Geotermalna energija” (ploha potencijala od svijetložute do tamnocrvene, lokacije po fazi).
  Traka pokazuje što radi danas, što se priprema i gradove s potvrđenim potencijalom, a animacija kaskade put
  topline: bušotina → struja → grijanje → staklenici → toplice → vraćanje u podzemlje. Uz smanjeno kretanje
  animacije nema. Klik na lokaciju otvara njezinu bilješku, korake kaskade koje stvarno koristi i izvore.
- **Stranica `/geotermalna-energija/`** (i `/en/geothermal-energy/`, `web/src/seo/geothermal.ts`): brojke,
  lokacije po fazi s izvorima, potencijal, kaskada, JSON-LD `Dataset`, Markdown inačica; poveznice s početne,
  sa „Zelene tranzicije” i iz `llms.txt`. Bez `geothermal/current.json` nema ni stranice ni poveznica.

### Odakle dolazi struja i „Kod mene” (Faza 19)

- **Satna proizvodnja:** `live-hourly` uz tokove i cijene sada povlači i stvarnu proizvodnju po izvoru (ENTSO-E
  A75) za HR, SI, HU, RS, BA, ME i AT (`live.generation`, MW po tehnologiji po satu). Sat vrijedi samo ako ga
  prijave sve serije zemlje; crpljenje se ne broji kao proizvodnja.
- **„Od čega je struja u mreži”** (kartica u traci uživo, `data/mix.ts`): proizvodnja zemlje ili mješavina u
  mreži, kad se uvoz raspodijeli prema proizvodnji zemlje iz koje dolazi (jedan korak). Uvoz iz zemlje bez
  podataka ostaje „sastav nepoznat”. ENTSO-E kasni, pa se za sat bez podataka uzima zadnji sat s podacima i to
  se piše. Uz karticu stoji rečenica da se struja u mreži miješa.
- **„Kod mene”:** lokacija preglednika (samo na pritisak) ili središte karte, zaokruženo na dvije decimale,
  šalje se samo Open-Meteu (CC BY 4.0): oblačnost i sunčevo zračenje sada, procjena koliko solar sada daje te
  godišnji solarni potencijal iz zadnjih 365 dana (`data/weather.ts`: × 0,8 učinkovitost, × 1,12 nagib).
  Gruba procjena bez sjena i orijentacije krova; za točan izračun poveznica na PVGIS. CSP dopušta
  `api.open-meteo.com` i `archive-api.open-meteo.com`, a `Permissions-Policy` lokaciju samo na našim
  stranicama (ne u ugradnjama).

### Vizualne dorade nakon pregleda (Faza 14)

Devet nalaza s pregleda snimki, sve u kodu:

- **Prsten odabira za sve točkaste slojeve** (`selectedRing` u `layers.ts`): punionice, crpilišta i
  plinski krug dobili su isti prsten kao elektrane; novi odabir ga dvaput „napuhne" (900 ms, `selectionPulse.ts`)
  pa oko nađe objekt među stotinama točaka. Ne radi uz `prefers-reduced-motion` i nikad dok se stil još
  slaže (`settledRef`, L-043). Karta bilježi `data-selection-pulse`.
- **Slojevi u tri skupine** (Mreža / Proizvodnja i potrošnja / Uživo), bilješka o sloju iza „i" gumba, a
  otvara se sama kad se sloj uključi (`LAYER_GROUPS`, `LAYER_NOTES` u `FiltersPanel.tsx`).
- **Sparkline u detaljima plina** (`sparkline.ts`, čisti SVG): skala od najmanjeg do najvećeg dana, oba
  označena, praznina za neprijavljeni dan; tablica svih dana sklopljena ispod.
- **Mobilna donja traka** stane u jedan red: kratki datum i gumbi samo s ikonom ispod 720 px.
- **Kartica dobrodošlice** (`Welcome.tsx`) u desnom stupcu dok ništa nije odabrano: tri ulaza (tokovi uživo,
  što je novo, gradovi); nestaje zauvijek na zatvaranje ili odabir ulaza (`localStorage`), za ovaj posjet
  čim se nešto odabere; nikad u embedu ni na mobitelu.
- **Legenda prigušuje vrste kojih nema u prikazu** (`inView.ts`: `queryRenderedFeatures` na `idle`, samo
  kad se promijeni); sloj koji nije nacrtan ne prigušuje ništa.
- **Broj na plinskom disku** (`gas-labels`, samo kad podloga ima glifove; `number-format` po jeziku).
- Naslov detalja plina je ime zemlje, energija uvijek s jednom decimalom; placeholder pretrage zna za gradove i rudnike.

### Poznata ograničenja (MVP)

- Elektrane mapirane kao `type=site` relacije se broje u manifestu, ali ne crtaju.
- Snaga bez mjerne jedinice (npr. `210`) i dvosmislen zapis (`1.200 MW`) ostaju prazni i broje se kao `ambiguous_capacity`.
- Natural Earth granice su generalizirane; zato postoji prag od 500 m za interkonektore.

## Pogledati kartu odmah (bez ijednog ključa)

```bash
cd web
npm install
npm run preview:local      # izgradi testne podatke, zatim aplikaciju, pa je posluži
```

Otvori <http://localhost:4173/>. Karta radi na **testnim podacima** iz `pipeline/tests/fixtures`
(izmišljeni objekti, jasno označeni), ali je aplikacija stvarna: svi slojevi, filtri, pretraga, detalji,
teme, HR/EN i prikaz proizvodnje kroz vrijeme. Za stvarne podatke trebaju ključevi iz `PRIPREMA.md`.

Mapa `prototype/` je nešto drugo: prototip **nadzorne ploče** (tokovi, cijene, plin) s izmišljenim
brojkama, dogovoren u Fazi 4a. Sama nadzorna ploča dolazi u Fazi 6 sa stvarnim ENTSO-E podacima.

## Web stranica: brzi početak

Potrebno: Node.js 22+, a za lokalne podatke i pipeline iz prethodnog odjeljka.

```bash
cd web
npm ci
npm run e2e:data          # testni podaci iz pravog pipelinea → e2e/.data
LOCAL_DATA_DIR=e2e/.data npm run dev

npm run check             # tipovi, lint, format, jedinični testovi
npx playwright install chromium
npm run e2e               # e2e na računalu i mobitelu (gradi stranicu sama)
```

Postavke su u `web/.env.example`: `VITE_DATA_BASE_URL` (adresa podataka) i `VITE_MAPTILER_KEY` (neobavezno;
bez njega karta koristi pojednostavljenu podlogu iz naših granica).

Sloj **Tokovi i cijene (uživo)** (u popisu slojeva) čita `live/current.json`: strelice neto tokova između
zemalja (debljina prema MW), cijena dan-unaprijed uz svaku zemlju (za Italiju sjeverna zona) i klizač kroz
jučer, danas i sutra. Sat bez podatka nema strelicu ni broj; ista brojka je i u tablici ispod klizača.

Prikaz **Proizvodnja kroz vrijeme** (prekidač u zaglavlju) čita `energy/current.json`: složeni stupci po izvoru
s crtom potrošnje (po mjesecima ili godinama), isti mjesec kroz godine i zbroj za odabrano razdoblje s udjelima
u proizvodnji i potrošnji. Nepotpuna razdoblja su označena, a razdoblja bez podataka su prazna, nikad 0. Svaki
grafikon ima i tablični oblik. Za razvoj i e2e `npm run e2e:data` generira izmišljene podatke o energiji
(`energy/FIXTURE_DATA_NOT_REAL.txt`); nikad se ne objavljuju.

Stranica prikazuje samo stvarne podatke. Sve što vidiš u URL-u (pogled, slojevi, filtri, odabrani objekt,
jezik) može se podijeliti linkom.

## Licence podataka

- OpenStreetMap: © OpenStreetMap contributors, **ODbL 1.0**. Izvedeni slojevi ostaju pod ODbL-om, a atribucija je obavezna.
- Granice: Natural Earth (javno dobro).
- Podloga karte: © MapTiler, © OpenStreetMap contributors (samo kad je `VITE_MAPTILER_KEY` postavljen).
- Global Energy Monitor, Global Integrated Power Tracker: CC BY 4.0; dio solarnih zapisa TransitionZero,
  Solar Asset Mapper: CC BY-NC 4.0 (projekt je nekomercijalan, odluka #2).
- **Preuzimanje baze je u cjelini samo za nekomercijalnu upotrebu** (odluka 2026-11-08): baza je ODbL, ali
  sadrži CC BY-NC zapise. Licenca stoji uz svaki zapis (`provenance`), pa se zapisi bez CC BY-NC smiju koristiti
  i komercijalno. Tako piše na stranici „O karti", u izborniku preuzimanja, u `Dataset` JSON-LD-u, `/api/` i
  `llms.txt` (`web/src/seo/license.ts`).
- Global Heat Flow Database (IHFC, 2024.): **CC BY 4.0**, izvor i licenca stoje uz legendu sloja i na stranici
  geotermalne energije. Lokacije geotermalnih projekata: izvor uz svaki zapis.
- HEP ODS (slobodni kapaciteti): ponovna upotreba uz dopuštenje HEP ODS-a (2026-11-08), uz izvor i HEP-ovu
  napomenu; podaci su informativni.
- Eurostat (`nrg_ind_ren`, službeni udio obnovljivih izvora): **CC BY 4.0**, izvor s poveznicom na skup podataka
  i datumom Eurostatova ažuriranja stoji uz oba odjeljka na „Zelenoj tranziciji”.

## Licenca koda

Kod je pod licencom **MIT** (datoteka `LICENSE`, odluka 2026-09-17). Licenca vrijedi samo za kod: podaci koje
pipeline proizvodi i stranica prikazuje ostaju pod licencama svojih izvora, navedenima gore (izvedena baza: ODbL).
