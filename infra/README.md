# Cloudflare i MapTiler: postavljanje

Tri dijela, svaki se radi jednom: **R2** (podaci), **Pages** (stranica), **MapTiler** (podloga karte).
Ukupno oko 30 minuta.

# A. R2: pohrana podataka

## 1. Bucket

Cloudflare → **R2** → **Create bucket**
- Naziv: `energetska-karta-podaci`
- Lokacija: automatska. Ne biraj posebnu jurisdikciju; pipeline koristi standardni R2 endpoint.

## 2. Javni pristup

U postavkama bucketa, **Public access**:
- **Produkcija:** poveži vlastitu (pod)domenu, npr. `podaci.tvoja-domena.hr`. Samo tada rade Cloudflareov keš i puna brzina.
- **Za probu:** uključi `r2.dev` poddomenu. Ona ima ograničenje prometa i nije za produkciju.

## 3. CORS

Karta čita PMTiles dio po dio (HTTP Range), pa preglednik mora smjeti slati te zahtjeve.

```bash
npx wrangler login
npx wrangler r2 bucket cors set energetska-karta-podaci --file infra/r2-cors.json
npx wrangler r2 bucket cors list energetska-karta-podaci
```

Pravilo dopušta čitanje (GET/HEAD) s bilo koje stranice. To je namjerno: podaci su javni (ODbL), zahtjevi
ne nose kolačiće ni prijavu, a pregledne verzije stranice imaju promjenjive adrese
(`<grana>.energetska-karta.pages.dev`) koje se ne mogu unaprijed nabrojati. Pisati u bucket može samo API token.

## 4. API token (samo za pipeline)

R2 → **Manage API tokens** → **Create API token**
- Dozvola: **Object Read & Write**
- Opseg: **samo** bucket `energetska-karta-podaci`

Zapiši *Access Key ID*, *Secret Access Key* i *Account ID*. Secret se prikazuje samo jednom.

## 5. GitHub tajne

Repozitorij → **Settings → Secrets and variables → Actions → New repository secret**:

| Naziv | Vrijednost |
|---|---|
| `R2_ACCOUNT_ID` | Account ID |
| `R2_ACCESS_KEY_ID` | Access Key ID |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key |
| `R2_BUCKET` | `energetska-karta-podaci` |

## 6. Prvo objavljivanje

**Actions → osm-build → Run workflow**. Za početak upiši zemlju `HR` i označi **publish**.

Kad je postavljena varijabla `DATA_BASE_URL` (dio B.3), svaki build se uspoređuje s onim što je **objavljeno**.
Zato build samo za neke zemlje, dok je objavljena cijela regija, bude odbijen: to štiti od slučajne zamjene
cijele regije jednom zemljom. Ako je to namjerno, označi **allow_drop**.

## 6a. Tjedno automatsko ažuriranje

Workflow **osm-scheduled** radi svakog ponedjeljka u 03:00 UTC (i ručno iz Actions):
preuzimanje → build uz usporedbu s objavljenim → izvještaj o promjenama → pločice → objava.

- Izvještaj (novo, uklonjeno, promijenjeno po sloju i zemlji) vidi se u sažetku posla i objavljuje se kao
  `builds/<id>/diff.json`.
- Ako nešto ne uspije, objavljeni podaci ostaju kakvi jesu, a otvara se GitHub issue
  *„Automatsko ažuriranje podataka nije uspjelo”* (ili se na postojeći dodaje komentar).
- Stranica upozorava ako su podaci stariji od 14 dana.
- Potrebno: sve `R2_*` tajne i varijabla `DATA_BASE_URL`. Bez njih workflow odmah javlja što nedostaje.
- **Raspored se uključuje ručno.** Dok varijabla `SCHEDULE_OSM` nije `true`, zakazana pokretanja se preskaču
  (ne padaju); ručno pokretanje radi uvijek. Uključi je tek kad ručni **osm-build** s objavom jednom prođe.
  Ista varijabla uključuje i mjesečne **emodnet-update**, **geothermal-update** i **eurostat-update**.

### Prekidači rasporeda

| Varijabla | Što uključuje | Kad je postaviti na `true` |
|---|---|---|
| `SCHEDULE_OSM` | `osm-scheduled` (tjedno), `emodnet-update`, `geothermal-update`, `eurostat-update` i `images-update` (mjesečno) | nakon prve uspješne objave (A.6); za `eurostat-update` nakon prvog uspješnog ručnog pokretanja |
| `SCHEDULE_ENTSOE` | `energy-daily` (dnevno), `live-hourly` (svaki sat), `prices-daily` (dnevno, nakon dražbe dan unaprijed) | nakon uspješnog `energy-backfill` (dio D) |
| `SCHEDULE_GAS` | `gas-daily` (dnevno, 07:40 UTC; ENTSOG, bez ključa) | nakon prvog uspješnog ručnog `gas-daily` (treba samo R2) |
| `SCHEDULE_HEP` | `hep-daily` (dnevno; HEP ODS slobodni kapaciteti) | nakon prvog uspješnog ručnog `hep-daily` |

`keepalive` (1. i 15. u mjesecu) radi kad je uključen bilo koji od prekidača: ponovno uključuje sve zakazane
workflowe, da ih GitHub ne isključi nakon 60 dana bez aktivnosti.

Zašto: novi repozitorij nema tajni, a ENTSO-E token stiže tek za nekoliko dana. Bez prekidača bi `live-hourly`
padao 24 puta dnevno i zatrpao prvi stvarni kvar. Pravilo provodi test `pipeline/tests/test_workflow_rules.py`.

**GitHub sam isključuje zakazane workflowe nakon 60 dana bez aktivnosti u repozitoriju** (prije toga pošalje
e-mail). `keepalive` to sprječava; ako se ipak dogodi, ne otvara se issue, jer posao ni ne krene, a vidi se samo
upozorenje o starim podacima na stranici. Ponovno uključivanje: Actions → workflow → **Enable workflow**.

## 6b. Global Energy Monitor (kad stigne tablica)

GEM šalje link za preuzimanje e-mailom. Da automatika može koristiti tablicu, spremi je jednom u bucket:

**Actions → gem-upload → Run workflow**, zalijepi link i upiši ime datoteke.

- Tablica se prvo provjeri. Ako nije prepoznata ili nema elektrana u našim zemljama, ništa se ne sprema,
  a poruka kaže koji stupci nedostaju.
- Sprema se kao `sources/gem/<sha256>-<ime>`, a `sources/gem/current.json` pokazuje na nju.
- Svaki sljedeći `osm-scheduled` i `osm-build` je preuzima, provjerava SHA-256 i spaja s OSM-om.
  Dok tablice nema, buildovi rade samo s OSM-om.
- Nova GEM verzija: isti postupak s novim linkom. Stare kopije ostaju u `sources/gem/`, pa se na njih uvijek
  možeš vratiti ponovnim uploadom.

Lokalno (s `R2_*` varijablama): `energymap sources gem-upload Global-Integrated-Power-Tracker.xlsx`.

## 7. Provjera

```bash
BASE=https://<tvoj-javni-url>
curl -s $BASE/current.json
# mora vratiti "206 Partial Content":
curl -s -o /dev/null -w "%{http_code}\n" -H "Range: bytes=0-126" "$BASE/$(curl -s $BASE/current.json | python3 -c 'import sys,json;print(json.load(sys.stdin)["tiles"])')"
```

Pločice možeš i pogledati: otvori <https://pmtiles.io> i upiši URL datoteke `grid.pmtiles`.

## Što se nalazi u bucketu

```
current.json                          pokazivač na zadnji build (keš 60 s)
builds/<id>/grid.pmtiles              vodovi, trafostanice, elektrane (nepromjenjivo)
builds/<id>/boundaries.pmtiles        granice država, rezervna podloga
builds/<id>/manifest.json             brojevi, izvori, statistika obrade
builds/<id>/tiles.json                zoomovi i granice pločica
builds/<id>/search.json               indeks za pretragu po imenu
builds/<id>/stats.json                zbrojevi po zemlji
builds/<id>/diff.json                 promjene u odnosu na prethodnu objavu (ako je postojala)
builds/<id>/<sloj>.ndjson.gz          puna baza za preuzimanje (ODbL)
sources/gem/current.json              GEM tablica koju buildovi koriste
sources/gem/<sha256>-<ime>            kopije GEM tablica (čišćenje buildova ih ne dira)
timeline.json, cities.json            vremeplov elektrana i gradske energetske inventure
live/current.json, live/gas.json      tokovi i cijene po satu (ENTSO-E), dnevna proizvodnja plina (ENTSOG)
energy/…                              dnevna i mjesečna proizvodnja po izvorima (ENTSO-E)
hep/current.json, hep/history.json    slobodni kapaciteti HEP ODS-a, povijest izdanja, hep/regions.geojson,
                                      hep/snapshots/…
geothermal/…                          geotermalne lokacije i toplinski tok
images/index.json, images/<hash>.jpg  fotografije elektrana s Wikimedia Commonsa (umanjene kopije, autor i licenca)
eurostat/renewables.json              službeni udio obnovljivih izvora (Eurostat nrg_ind_ren)
```

Pipeline čuva zadnjih 5 buildova. Povratak na stariji build:
`energymap publish r2 --build <id>` (lokalno, s istim `R2_*` varijablama).

# B. Pages: web stranica

## 1. Projekt

```bash
npx wrangler pages project create energetska-karta --production-branch main
```

## 2. API token za objavu

Cloudflare → **My Profile → API Tokens → Create token** → predložak *Edit Cloudflare Workers* ili vlastiti
token s dozvolom **Account → Cloudflare Pages → Edit**.

## 3. GitHub postavke

**Secrets** (Settings → Secrets and variables → Actions):

| Naziv | Vrijednost |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token iz koraka 2 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID |
| `MAPTILER_KEY` | ključ iz dijela C (bez njega stranica koristi pojednostavljenu podlogu) |

**Variables** (ista stranica, kartica *Variables*):

| Naziv | Vrijednost |
|---|---|
| `DATA_BASE_URL` | javna adresa bucketa iz A.2, npr. `https://podaci.tvoja-domena.hr/` |
| `PAGES_PROJECT` | ime Pages projekta iz koraka 1, npr. `energetska-karta` |
| `SITE_URL` | `https://gridatlas.eu` (odluka 2026-11-16; prije toga je planirana poddomena na tmit.hr), bez kose crte na kraju; iz nje nastaju canonical poveznice, sitemap, `og:image` i `llms.txt`. Produkcijski build na `main` bez nje pada |

Dok `PAGES_PROJECT` nije postavljen, workflow `web` pokreće provjere i e2e testove, a objavu preskače.
Stranica se objavljuje i nakon svakog uspješnog pokretanja podatkovnih workflowa (`osm-scheduled`,
`osm-build`, `prices-daily`, `hep-daily`, `geothermal-update`, `eurostat-update`; `workflow_run`), jer statične
stranice za tražilice (`/o-karti/`, `/zemlja/*`, `/objekt/*`, izvještaji, sitemap) nastaju iz objavljenih
podataka u trenutku builda. Neuspjelo ili preskočeno pokretanje ne gradi ništa i ne prekida objavu u tijeku.
Kad je postavljen, a `DATA_BASE_URL` nije, build namjerno pada, da se nikad ne objavi stranica bez podataka.

## 4. Vlastita domena: `gridatlas.eu`

1. Cloudflare → **Workers & Pages** → projekt `energetska-karta` → **Custom domains** → **Set up a custom
   domain** → `gridatlas.eu`.
2. DNS zapis:
   - ako je zona `gridatlas.eu` na Cloudflareu, Cloudflare zapis doda sam;
   - ako nije, zona se prvo mora prebaciti na Cloudflare: vršna domena (bez poddomene) na Pagesu radi samo
     kad su joj Cloudflareovi poslužitelji imena upisani kod registra.
   Po želji isto ponovi za `www.gridatlas.eu`, da radi i ta adresa.
3. Kad Cloudflare pokaže **Active** (certifikat se izda sam, obično za nekoliko minuta): GitHub varijabla
   `SITE_URL` = `https://gridatlas.eu` i ponovno pokreni workflow `web`.
4. MapTiler: dodaj `gridatlas.eu` u **Allowed HTTP origins** (dio C).
5. `energetska-karta.pages.dev` ostaje dostupna, ali sve stranice imaju canonical na vlastitu domenu, pa
   tražilice indeksiraju samo nju.

**Analitika posjeta (Cloudflare Web Analytics, bez kolačića):** Workers & Pages → `energetska-karta` →
**Metrics** → **Web Analytics** → Enable. Cloudflare sam dodaje svoju skriptu na stranice; CSP je već dopušta
(`web/vite/securityHeaders.ts`), a druge skripte izvana i dalje ne prolaze.

Ako je `gridatlas.eu` na Cloudflareu, istim putem (R2 → bucket → **Custom domains**) poveži i
`podaci.gridatlas.eu` za podatke (A.2): `r2.dev` ima ograničenje prometa i nije za produkciju.

## 5. Kako se objavljuje

Workflow `web` pokreće provjere i e2e testove, a tek kad oboje prođe objavljuje:
- grana `main` → produkcija `https://gridatlas.eu` (i `https://energetska-karta.pages.dev`)
- ostale grane i pull requestovi → pregledna verzija s vlastitom adresom

# C. MapTiler: podloga karte

1. Registracija na <https://cloud.maptiler.com> (besplatni plan).
2. **API keys** → novi ključ → **Allowed HTTP origins**: `energetska-karta.pages.dev`,
   `*.energetska-karta.pages.dev` i `gridatlas.eu`. Ključ je vidljiv u pregledniku, pa ga samo
   ovo ograničenje štiti od tuđeg korištenja.
3. Ključ spremi kao GitHub secret `MAPTILER_KEY`.

**Važno o besplatnom planu:**
- dopušten je samo za **nekomercijalnu** upotrebu (otvorena odluka #2 u `tasks/todo.md`)
- MapTiler logo mora biti vidljiv (stranica ga prikazuje sama)
- kad se potroši mjesečna kvota, podloga se zaustavlja; stranica tada prikazuje pojednostavljenu podlogu
  i obavijest, a slojevi mreže rade normalno

**Provjera nakon prve objave:** otvori stranicu i provjeri da se vide ceste i imena mjesta, a dolje lijevo
MapTiler logo. Stilove `dataviz` i `dataviz-dark` te adresu loga nisam mogao provjeriti iz razvojnog
okruženja jer MapTiler tamo nije dostupan.

# D. ENTSO-E token (proizvodnja i potrošnja kroz vrijeme)

1. Registracija na <https://transparency.entsoe.eu> (gore desno *Login → Register*).
2. E-mail na **transparency@entsoe.eu**, naslov **Restful API access**, a u tekstu e-mail adresa s kojom si
   se registrirao. Odgovor obično stiže unutar 3 radna dana.
3. Nakon odobrenja: *My Account Settings → Generate token*.
4. GitHub → Settings → Secrets → **`ENTSOE_TOKEN`**.

Token se nikad ne ispisuje: pipeline ga briše iz svih logova i poruka o greškama.

Nakon što token spremiš:
1. **Actions → energy-backfill → Run workflow** (od 2015., sve zemlje). Traje nekoliko minuta.
2. Varijabla **`SCHEDULE_ENTSOE` = `true`** (Settings → Secrets and variables → Actions → Variables).
3. Od tada **energy-daily** svaki dan u 05:30 UTC ponovno dohvaća zadnjih 7 dana i objavljuje, a
   **live-hourly** svaki sat objavljuje tokove i cijene.

U bucketu:

```
energy/current.json                   pokazivač (godine, zbrojevi, pokrivenost)
energy/previous.json                  prethodni pokazivač (za povratak)
energy/daily/<godina>-<sha>.json      MWh po danu, zemlji i izvoru
energy/periods-<sha>.json             mjeseci i godine
```

---

# D. Okidač: da se podaci osvježavaju na vrijeme

GitHubov vlastiti raspored je „kad stigne": 16. 11. 2026. satni `live-hourly` pokrenut je tri puta u dvadesetak
sati, a dnevni poslovi osam do deset sati kasnije. Zato raspored drži mali Cloudflare Worker
(`infra/trigger-worker/`): svaki sat u 12. minuti zatraži od GitHuba da pokrene poslove kojima je vrijeme
(`live-hourly` svaki sat; `energy-daily`, `hep-daily`, `gas-daily` i `prices-daily` jednom dnevno). Ne čita i ne
objavljuje nikakve podatke. GitHubov raspored ostaje kao rezerva.

## 1. GitHub token (samo za pokretanje poslova)

1. GitHub → **Settings** (profil, ne repozitorij) → **Developer settings** → **Personal access tokens** →
   **Fine-grained tokens** → **Generate new token**.
2. **Repository access** → **Only select repositories** → `energetskakarta`.
3. **Permissions** → **Repository permissions** → **Actions: Read and write**. Ništa drugo.
4. Rok trajanja po izboru (najdulje godinu dana; kad istekne, Worker u dnevniku javlja HTTP 401 i poslovi se
   opet pokreću samo po GitHubovu rasporedu). Token kopiraj; prikazuje se samo jednom.

## 2. Objava Workera

Iz mape `web/` (ondje je Wrangler):

```bash
npx wrangler deploy --config ../infra/trigger-worker/wrangler.toml
npx wrangler secret put GITHUB_TOKEN --config ../infra/trigger-worker/wrangler.toml
```

Druga naredba pita za token; zalijepi ga ondje. Token se ne upisuje ni u jednu datoteku.

## 3. Provjera

- Cloudflare → **Workers & Pages** → `energetska-karta-okidac` → **Settings** → **Trigger Events**: raspored
  `12 * * * *`.
- Nakon sljedeće 12. minute: GitHub → **Actions** → `live-hourly` ima novo pokretanje s oznakom
  `workflow_dispatch`. U dnevniku Workera (**Logs**) stoji `{"started":1,...}`.
- Test Workera: `node --test infra/trigger-worker/index.test.mjs`.

