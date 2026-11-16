# Priprema za pokretanje

Sve je besplatno. Detaljni koraci za svaku stavku su u `infra/README.md`; ovdje je samo popis.

## 1. Računi (napravi ih prvo, neki traže čekanje)

| Račun | Zašto | Čekanje | Gdje |
|---|---|---|---|
| **GitHub** | kod, automatika, tajne | odmah | github.com |
| **Cloudflare** | pohrana podataka (R2) i stranica (Pages) | odmah; uključivanje R2 može tražiti unos načina plaćanja, iako se besplatna razina ne naplaćuje | dash.cloudflare.com |
| **MapTiler** | podloga karte (ceste, imena mjesta) | odmah | cloud.maptiler.com |
| **ENTSO-E** | proizvodnja, potrošnja, tokovi, cijene | **do 3 radna dana** | transparency.entsoe.eu, pa e-mail na transparency@entsoe.eu, naslov "Restful API access" |
| **Global Energy Monitor** | snaga i status elektrana | link stiže e-mailom | globalenergymonitor.org → Global Integrated Power Tracker → Download data |

Savjet: ENTSO-E i GEM pošalji **prvi dan**, jer se na njih čeka.

## 2. Što zapisati dok radiš (trebat će za GitHub)

Tajne (**Settings → Secrets and variables → Actions → Secrets**):

| Naziv | Odakle |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare, desni stupac na početnoj stranici računa |
| `R2_ACCESS_KEY_ID` | Cloudflare → R2 → Manage API tokens (Object Read & Write, samo za taj bucket) |
| `R2_SECRET_ACCESS_KEY` | isto mjesto; prikazuje se **samo jednom** |
| `R2_BUCKET` | ime bucketa, npr. `energetska-karta-podaci` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens (Cloudflare Pages: Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | isto kao `R2_ACCOUNT_ID` |
| `MAPTILER_KEY` | MapTiler → API keys (ograniči na domene stranice) |
| `ENTSOE_TOKEN` | ENTSO-E → My Account Settings → Generate token (nakon odobrenja) |

Varijabla (**isti izbornik → Variables**):

| Naziv | Vrijednost |
|---|---|
| `DATA_BASE_URL` | javna adresa bucketa, npr. `https://pub-xxxx.r2.dev/` |
| `PAGES_PROJECT` | ime Cloudflare Pages projekta, npr. `energetska-karta`; dok je nema, stranica se ne objavljuje (provjere rade) |
| `INDEXNOW_KEY` | ključ za IndexNow: 32 znamenke heksadecimalno (npr. `openssl rand -hex 16`); nije tajna, objavljuje se kao `/<ključ>.txt`. S njim Bing, Yandex i partneri saznaju za nove stranice odmah nakon objave |
| `SITE_URL` | `https://gridatlas.eu` (bez kose crte na kraju; postavljanje domene: `infra/README.md`, B.4); iz nje se rade canonical poveznice, sitemap, slike za dijeljenje i `llms.txt`. Produkcijski build na `main` bez nje pada |
| `SCHEDULE_OSM` | `true` tek kad korak 3 prođe: uključuje tjedno ažuriranje karte i mjesečni EMODnet |
| `SCHEDULE_ENTSOE` | `true` tek kad korak 5 prođe: uključuje dnevne podatke i tokove svaki sat |
| `SCHEDULE_GAS` | `true` kad **Actions → gas-daily** jednom ručno prođe (ne treba ključ, samo R2): uključuje dnevnu proizvodnju plina (ENTSOG) |
| `SCHEDULE_HEP` | `true` kad **Actions → hep-daily** jednom ručno prođe (ne treba ključ, samo R2): svaki dan provjerava ima li HEP ODS novu verziju podataka o slobodnim kapacitetima i objavljuje je |

Dok prekidači `SCHEDULE_*` nisu uključeni, zakazani poslovi se preskaču i ništa nije crveno. Ručno pokretanje radi uvijek.

Ništa od ovoga ne šalji meni ni ne stavljaj u kod: sve ide samo u GitHub tajne.

## 3. Redoslijed

1. GitHub repozitorij s kodom iz zipa → provjere se pokreću same (Actions).
2. Cloudflare R2: bucket, javni pristup, CORS, API token → 4 tajne `R2_*` + varijabla `DATA_BASE_URL`.
3. **Actions → osm-build**: zemlja `HR`, uključi *publish*. Kad prođe: varijabla `SCHEDULE_OSM` = `true`.
4. Cloudflare Pages projekt + `CLOUDFLARE_*` tajne + MapTiler ključ + varijabla `PAGES_PROJECT` → push na `main` objavi stranicu.
5. Kad stigne ENTSO-E token: `ENTSOE_TOKEN` → **Actions → energy-backfill** (jednom). Kad prođe: varijabla `SCHEDULE_ENTSOE` = `true`. Od tada sve ide samo.
6. Kad stigne GEM link: **Actions → gem-upload**, zalijepi link.
7. Nakon R2: **Actions → emodnet-update** (jednom ručno; ne treba ključ). Sljedeći build ima jadranske cjevovode.
   Isto tako **Actions → gas-daily** (jednom ručno; ne treba ključ). Kad prođe: varijabla `SCHEDULE_GAS` = `true`.
   Isto tako **Actions → hep-daily** (jednom ručno; ne treba ključ). Kad prođe: varijabla `SCHEDULE_HEP` = `true`.
8. Kad HR radi: **osm-build** za sve zemlje (ostavi zadanu vrijednost polja, `HR,SI,HU,RS,BA,ME,IT,AT`).

## 4. Što mi pošalji

- poveznicu na stranicu (Pages) nakon koraka 4
- `manifest.json` iz koraka 3 (Actions → posao → Artifacts)
- ako nešto padne: poveznicu na posao ili kopiju crvene poruke

Tada pregledavamo prave podatke i ispravljamo što iskoči.

## 5. Licenca preuzimanja (odlučeno 2026-11-08)

Dio solarnih zapisa iz GEM-a je CC BY-NC, a baza je ODbL. Odluka: zapisi ostaju, a preuzimanje je označeno kao
**u cjelini samo nekomercijalno**; licenca stoji uz svaki zapis (`tasks/todo.md`, Faza 17).

## 6. Održavanje (jednom mjesečno, 5 minuta)

- Spoji Dependabotove PR-ove kojima su provjere zelene.
- GitHub isključuje zakazane poslove nakon **60 dana bez aktivnosti** u repozitoriju (prije toga pošalje e-mail).
  Workflow `keepalive` ih dvaput mjesečno sam ponovno uključuje (radi uz `SCHEDULE_OSM`), pa se to ne bi smjelo
  dogoditi; ako ipak dođe e-mail, vrijedi korak ispod.
  Ako stranica javlja da su podaci stariji od 14 dana, a nema otvorenog issuea: Actions → workflow → **Enable workflow**.
