# Lessons Learned

> Svaki put kad me ispraviš ili pronađemo grešku u mojoj logici, ovdje dodajem zapis.
> Čita se na početku svake sesije, zajedno s `CLAUDE.md`.

## Format
```
### L-### — <kratki naslov> (YYYY-MM-DD)
- Što se dogodilo:
- Uzrok:
- Pravilo ubuduće:
```

---

### L-001 — Demo podaci moraju poštovati fiziku sustava (2026-09-16)
- Što se dogodilo: prvi demo model dao je negativnu proizvodnju iz upravljivih izvora (HR u 01:00, HU u 09:00).
- Uzrok: uvozi su zadani neovisno o potrošnji i sunčanoj proizvodnji.
- Pravilo ubuduće: svaki model ima ugrađenu provjeru (baca grešku) i test svih sati prije prikaza. Uvoz izvan regije pada kad sunce raste.

### L-002 — Inline element ne dobiva visinu (2026-09-16)
- Što se dogodilo: stupci neto pozicije bili su nevidljivi.
- Uzrok: `.netbar` je bio `<span>` bez `display: block`, pa `height` nije djelovao.
- Pravilo ubuduće: nakon svake promjene rasporeda pogledati snimku zaslona, ne pretpostavljati.

### L-003 — Oznake na karti se sudaraju kod kratkih veza (2026-09-16)
- Što se dogodilo: oznake tokova (MW) prekrivale su oznake zemalja (GW) kod SI–HR i BA–HR.
- Uzrok: dvije vrste oznaka natječu se za isti prostor oko malih, bliskih zemalja.
- Pravilo ubuduće: u jednom stanju prikaza na karti je samo jedna vrsta brojčanih oznaka; ostalo ide u popis ili traku brojki.

### L-004 — Tipovi vanjskih biblioteka nisu ukras (2026-09-16)
- Što se dogodilo: prva verzija ekstrakcije koristila je `obj.is_area()` i slične provjere; `mypy --strict` je pokazao da tip objekta nije sužen i da bi pogrešan pristup atributu prošao nezamijećeno.
- Uzrok: oslanjanje na metode-predikate umjesto na `isinstance`.
- Pravilo ubuduće: za pyosmium objekte uvijek `isinstance(obj, osmium.osm.Node | Way | Relation | Area)`. Kod nije gotov dok `mypy --strict` ne prođe.

### L-005 — Testovi ne smiju pisati u izvorni kod (2026-09-16)
- Što se dogodilo: test je generirao PBF datoteku u `tests/fixtures/`.
- Uzrok: fixture je koristio mapu s uzorcima kao radni prostor.
- Pravilo ubuduće: sve što testovi stvaraju ide u `tmp_path` / `tmp_path_factory`.

### L-006 — Logging vezan uz zatvoreni tok (2026-09-16)
- Što se dogodilo: nakon CLI testova kasniji testovi su ispisivali "Logging error".
- Uzrok: `log.configure()` je vezao handler uz stderr koji pytest zatvara nakon testa.
- Pravilo ubuduće: testovi uvijek vraćaju globalno stanje (logging, env) u početno stanje; autouse fixture to radi za logging.

### L-007 — Ne pretpostavljati determinizam vanjskih alata (2026-09-16)
- Što se dogodilo: test je očekivao bajt-identičan PMTiles pri ponovnom pokretanju; razlika je bila 1 bajt.
- Uzrok: tippecanoe u metapodatke upisuje putanje privremenih datoteka.
- Pravilo ubuduće: uspoređivati značenje (broj pločica, zoomovi, granice), ne bajtove, kad alat ne jamči determinizam.

### L-008 — Test koji se tiho preskače nije test (2026-09-16)
- Što se dogodilo: testovi s tippecanoeom bi se u CI-ju mogli tiho preskočiti ako instalacija ne uspije.
- Pravilo ubuduće: CI postavlja `ENERGYMAP_REQUIRE_TIPPECANOE=1`, pa nedostatak alata ruši build umjesto da ga preskoči.

### L-009 — tippecanoe tiho gubi objekte s `tippecanoe.minzoom` (2026-09-16)
- Što se dogodilo: na prvoj snimci stranice pola kopna bilo je "more". Uzrok je bio širi: kad objekt nosi `tippecanoe.minzoom`, tippecanoe 2.49 u svakoj pločici zadrži **samo jedan** objekt, bez obzira na `-r1` i ostale opcije. Isto je vrijedilo za sloj mreže.
- Uzrok zašto testovi nisu to vidjeli: testni uzorak nikad nije imao dva objekta u istoj pločici, a provjera pločica gledala je samo zaglavlje i jednu pločicu.
- Pravilo ubuduće: zoom pravilo je običan atribut `minzoom` + globalni `--feature-filter` (`$zoom`); nema `--drop-*` opcija, pa prevelika pločica ruši build umjesto da tiho gubi podatke. Regresijski test puni jednu z14 pločicu sa 114 objekata i provjerava svaki zoom; dokazano pada sa starim kodom.

### L-010 — Filtar tippecanoea i isključeni atributi (2026-09-16)
- Što se dogodilo: uz `--exclude=minzoom` filtar je odbacio sve objekte (atribut više nije postojao).
- Pravilo ubuduće: atribut na kojem filtar radi ostaje u pločicama. Svaku kombinaciju opcija alata provjeriti dekodiranjem stvarne pločice.

### L-011 — Snimka zaslona je test (2026-09-16)
- Što se dogodilo: konzola bez grešaka i uspješan build nisu otkrili problem; otkrila ga je tek snimka zaslona.
- Pravilo ubuduće: svaka promjena koja utječe na prikaz završava pregledom snimke; e2e testovi uz to provjeravaju i sadržaj karte.

### L-012 — Plutajući elementi na mobitelu moraju imati rezervirano mjesto (2026-09-16)
- Što se dogodilo: e2e je pokazao da otvoreni list s filtrima prekriva gumb za zatvaranje, a otvoreni detalji gumb za filtre. Prva zakrpa ("podigni gumb iznad lista") rješavala je samo jedan od dva slučaja.
- Uzrok: dva lista i gumb natjecali su se za isti donji rub bez zajedničkog pravila.
- Pravilo ubuduće: na mobitelu gumb živi u fiksnoj traci, a svi listovi otvaraju se iznad nje (`--mobile-bar`). Nema zakrpa koje ovise o visini sadržaja.

### L-013 — Oznaka "spremno" mora opisivati trenutno stanje, ne prvo (2026-09-16)
- Što se dogodilo: `data-map-status="ready"` ostajao je uključen nakon prvog iscrtavanja, pa je test kliknuo kartu dok se novi filtar još primjenjivao.
- Pravilo ubuduće: stanje se izvodi iz podataka (`posljednji primijenjeni stil === stil koji je iscrtan`), ne postavlja se jednom i zaboravi.

### L-014 — Pretpostavke o okruženju pregledati prije zaključka (2026-09-16)
- Što se dogodilo: dvaput sam "pogrešku" pripisao aplikaciji, a uzrok je bio u provjeri: zastarjeli zapis testa i engleski jezik preglednika u skripti.
- Pravilo ubuduće: prije zaključka provjeriti vrijeme zapisa, postavke preglednika i je li provjera uopće pokrenuta.

### L-015 — Zaštita koja ovisi o lokalnom stanju ne radi na čistom stroju (2026-09-16)
- Što se dogodilo: pri planiranju Faze 5 uočeno je da pravilo "pad > 10 % = stop" uspoređuje s *lokalnim* prethodnim buildom, kojeg na novom GitHub runneru nema. Zaštita bi u automatici bila tiho isključena.
- Pravilo ubuduće: svaka zaštita mora imati izvor istine koji postoji i u CI-ju (ovdje objavljeni `current.json`). Nedostupan izvor je greška, a ne razlog za preskakanje; samo izričit 404 znači "prva objava".

### L-016 — Format identifikatora čitati doslovno (2026-09-16)
- Što se dogodilo: GEM piše "L1 + 11 znamenki"; pročitao sam to kao ukupno 11 znamenki, pa bi pravi GEM zapisi bili odbačeni kao neispravni.
- Kako je uhvaćeno: testni uzorak je koristio primjer iz GEM-ove dokumentacije (`L100000603791`), a ne izmišljen oblik.
- Pravilo ubuduće: testni podaci za vanjske formate prepisuju se iz dokumentacije izvora, a ne iz vlastitog tumačenja.

### L-017 — Isti parser ne vrijedi za sve izvore (2026-09-16)
- Što se dogodilo: GEM koordinate ("45.812") prošle su kroz OSM parser brojeva, koji zapis s točkom i tri znamenke namjerno odbacuje kao dvosmislen.
- Pravilo ubuduće: pravila čitanja brojeva ovise o izvoru (OSM je višejezičan, GEM je engleski); svaki izvor ima svoj parser i svoje testove.

### L-018 — `pkill -f` pogađa i vlastitu naredbu (2026-09-16)
- Što se dogodilo: `pkill -f "vite preview"` ubijao je i ljusku koja ga je pokrenula, pa su neka pokretanja testova tiho nestajala.
- Pravilo ubuduće: `pkill -f "[v]ite preview"` (uzorak koji ne odgovara samom sebi) i uvijek provjeriti vrijeme zapisa prije čitanja rezultata.

### L-019 — Rezervirana imena u strukturiranom logiranju (2026-09-16)
- Što se dogodilo: `log.info(..., extra=asdict(source))` bi pri svakom uploadu GEM-a srušio program, jer podaci sadrže ključ `name`, koji Python rezervira za zapis loga. Otkrio ga je CLI test.
- Pravilo ubuduće: `extra` je uvijek doslovni rječnik bez rezerviranih ključeva, a složeni podaci idu ugniježđeni pod jedan ključ. Test `test_logging_rules.py` to provodi za cijeli paket i dokazano hvata izvornu grešku.

### L-020 — `echo "x=$(naredba)"` skriva neuspjeh naredbe (2026-09-16)
- Što se dogodilo: u workflowu bi neuspjelo preuzimanje GEM-a dalo prazan rezultat, a build bi se tiho napravio bez GEM-a.
- Uzrok: `set -e` ne reagira na neuspjeh unutar `$(...)` koji je argument druge naredbe.
- Pravilo ubuduće: rezultat se prvo dodijeli varijabli (`x=$(naredba)`), pa tek onda koristi. Korisnički unosi u workflowima idu isključivo kroz `env`, nikad izravno u skriptu.

### L-021 — Oduzimanje vremena u istoj zoni ignorira prijelaz na ljetno vrijeme (2026-09-16)
- Što se dogodilo: dan 29. 3. imao je "24 sata", pa bi pokrivenost potpuno prijavljenog dana bila 96 %, a dijelovi intervala oko promjene sata dobili bi krivu energiju.
- Uzrok: Python dva `datetime` objekta s istim `tzinfo` oduzima po satu na zidu, ne po stvarnom vremenu.
- Pravilo ubuduće: trajanja se računaju u UTC-u; granice lokalnog dana vraćaju se u UTC-u. Testovi uvijek uključuju dane od 23 i 25 sati.

### L-022 — Globalno stanje biblioteka između testova (2026-09-16)
- Što se dogodilo: test zaštite tokena prolazio je sam, a padao u punom pokretanju jer je CLI test utišao `httpx` logger.
- Pravilo ubuduće: fixture vraća i razine loggera biblioteka koje `log.configure()` mijenja; testovi koji ovise o logu sami postavljaju razinu za logger koji provjeravaju.

### L-023 — Dva istodobna dinamička uvoza istog modula (2026-09-16)
- Što se dogodilo: u testu je jedan grafikon dobio podmetnuti modul, a drugi pravi Chart.js, iako su oba uvozila isti `./charts`.
- Uzrok: dva odvojena `import("./charts")` u istom trenutku; Vitestovo podmetanje nije pokrilo oba.
- Pravilo ubuduće: jedan modul se lijeno učitava kroz jedno zajedničko obećanje (`loading ??= import(...)`). To je i u produkciji čišće: jedan zahtjev, jedna instanca.

### L-024 — Aritmetiku u testu provjeriti prije koda (2026-09-16)
- Što se dogodilo: test je očekivao 38, a točan zbroj bio je 33; kod je bio ispravan.
- Pravilo ubuduće: očekivane vrijednosti u testu pišu se s kratkim računom u komentaru (npr. "HR 20 + 3, SI 10"), da se greška u testu odmah vidi.

### L-025 — Skriptirana izmjena koja ništa ne pronađe mora pasti (2026-09-16)
- Što se dogodilo: formatter je prelomio kod, pa moja zamjena teksta nije ništa promijenila, a test je i dalje padao iz "neobjašnjivog" razloga.
- Pravilo ubuduće: svaka automatska zamjena ima provjeru da je tekst pronađen (`assert old in s`). Testovi se ne oslanjaju na privatne atribute kad postoji javni parametar (ovdje `limiter=`).

### L-026 — Dvostruko okretanje smjera (2026-09-16)
- Što se dogodilo: kod obrnutog toka luk se gradio od odredišta prema izvoru i zatim još jednom okretao, pa bi svaka strelica toka "unatrag" pokazivala krivi smjer. Na karti bi to izgledalo uvjerljivo i nitko ne bi posumnjao.
- Kako je uhvaćeno: test provjerava da strelica počinje u zemlji koja šalje, i da obrnuti luk ima iste točke obrnutim redom.
- Pravilo ubuduće: smjer se primjenjuje na jednom mjestu. Za sve što pokazuje smjer postoji test koji provjerava početnu i završnu točku, a ne samo broj.

### L-028 — `StrEnum` je i `str` (2026-09-16)
- Što se dogodilo: `isinstance(status, str)` bio je istinit i za ispravno prepoznat `Status`, pa bi svaki cjevovod s poznatim statusom bio odbačen kao "nepoznat".
- Pravilo ubuduće: funkcija koja vraća "prepoznato ili sirovi tekst" vraća par `(vrijednost, neprepoznato)`, a ne jednu vrijednost čiji se tip provjerava. Namjerno vraćena greška potvrdila je da je test hvata.

### L-029 — Jedan neispravan zapis ne smije srušiti preuzimanje (2026-09-16)
- Što se dogodilo: trasa s jednom točkom rušila je cijelo preuzimanje EMODneta unutar biblioteke shapely.
- Pravilo ubuduće: podaci izvana prvo se provjeravaju vlastitim kodom (granice iz koordinata); neispravni zapisi broje se i preskaču, a greška se diže samo kad je cijeli skup sumnjiv (prazan, zamijenjene osi).

### L-030 — Provjera koja ništa ne provjerava (2026-09-16)
- Što se dogodilo: e2e korak `if (vidljivo) expect(vidljivo)` prolazi uvijek.
- Pravilo ubuduće: uvjet u testu ovisi o poznatom okruženju (npr. projekt "desktop"), nikad o samom stanju koje se provjerava.

### L-031 — Element koji sam bira svoj položaj prije ili kasnije nekoga prekrije (2026-09-17)
- Što se dogodilo: statusna traka (`bottom: 40px`) prekrivala je dno trake tokova (`bottom: 48px`); na mobitelu je traka tokova prekrivala atribuciju. L-012 je isti problem riješio samo za gumb na mobitelu, a pravilo nije primijenjeno na nove elemente.
- Uzrok: svaka komponenta nosila je vlastite apsolutne pomake; testovi su provjeravali sadržaj, ne raspored.
- Pravilo ubuduće: komponenta ne zna gdje stoji; položaj određuje jedan spremnik (dok na računalu, stupac na mobitelu). `e2e/layout.spec.ts` provjerava sve parove plutajućih elemenata; svaki novi plutajući element dodaje se u njegov popis.

### L-032 — Nalaz sa snimke zaslona izmjeriti prije nego što se prijavi (2026-09-17)
- Što se dogodilo: u pregledu sam prijavio da detalji prekrivaju gumbe za zumiranje. Mjerenje okvira pokazalo je da presjeka nema; "prekrivanje" je bila linija granice iz testnih podataka.
- Pravilo ubuduće: snimka otkriva sumnju, a potvrđuje je mjerenje (`boundingBox`) ili uvećani isječak. U izvještaj ide samo potvrđeno (nastavak L-014).

### L-033 — Okvir sadržaja nije okvir onoga što se vidi (2026-09-17)
- Što se dogodilo: test je javio da legenda prekriva atribuciju i nakon popravka, jer je mjerio `<details>` unutar okvira koji kliže, a ne sam okvir.
- Pravilo ubuduće: u provjerama rasporeda mjeri se element koji reže sadržaj (`overflow`), ne njegov sadržaj.

### L-034 — Automatika se projektira i za prvi dan, ne samo za uhodano stanje (2026-09-17)
- Što se dogodilo: svi zakazani poslovi pretpostavljali su postavljene tajne; u novom repozitoriju `live-hourly` bi padao svaki sat do dolaska ENTSO-E tokena (do 3 radna dana), a deploy bi bio crven do postavljanja Cloudflarea.
- Pravilo ubuduće: raspored je izričit prekidač koji se uključuje nakon prvog uspješnog ručnog pokretanja; ručno pokretanje nikad nije ograničeno i bez postavki glasno pada. Upute za postavljanje provjeravaju se "na suho" redom kojim ih korisnik izvodi: što je crveno nakon svakog koraka?

### L-035 — Isto pravilo napisano dvaput se razilazi (2026-09-17)
- Što se dogodilo: uvođenjem klase „< 60 kV" ispravio sam `voltageClass()` u TypeScriptu, ali ne i `voltageClassExpr`, isto pravilo pisano kao MapLibre izraz. Karta je 20 kV vod bojala i filtrirala kao 60–109 kV. Testovi su prolazili; otkrio je tek e2e u kojem filtar nije sakrio ono što je trebao.
- Uzrok: dvije izvedbe istog pravila bez ijedne provjere da daju isti odgovor.
- Pravilo ubuduće: kad pravilo mora postojati dvaput (jednom kao kod, jednom kao izraz za kartu), postoji test koji izraz stvarno **izvrši** (`expression.createExpression`) i usporedi s funkcijom na graničnim vrijednostima. Namjerno vraćena stara verzija potvrdila je da test pada.

### L-036 — „Ne dohvaća se" treba izmjeriti, ne pretpostaviti (2026-09-17)
- Što se dogodilo: napisao sam da MapLibre ne dohvaća pločice izvora bez vidljivog sloja, pa distribucijski arhiv može stajati deklariran. E2e koji broji mrežne zahtjeve pokazao je jedan zahtjev za `distribution.pmtiles` i prije nego što je sloj uključen: MapLibre čita zaglavlje arhiva čim izvor postoji.
- Pravilo ubuduće: obećanje o performansama je tvrdnja o ponašanju, pa ima test koji ga mjeri. Izvor se sada deklarira tek kad se sloj crta, a e2e broji zahtjeve.

### L-037 — Test ne smije ovisiti o smjeru koji se mijenja po satu (2026-09-17)
- Što se dogodilo: test rasporeda čekao je redak „Slovenija → Hrvatska". U punom pokretanju u drugo doba dana neto tok je bio obrnut, pa je redak glasio „Hrvatska → Slovenija" i test je pao.
- Pravilo ubuduće: test koji ne provjerava podatak ne smije se vezati uz njegovu vrijednost; čeka strukturu (tablicu), a test koji podatak stvarno provjerava sam fiksira sat (nastavak L-030).

### L-038 — Ključ prekidača i ključ datoteke nisu isti pojam (2026-09-17)
- Što se dogodilo: `LAYER_KEYS` je istovremeno bio popis prekidača na karti i popis datoteka za preuzimanje. Distribucija ima jedan prekidač, a dvije datoteke, pa se popis raspao.
- Pravilo ubuduće: dva pojma koja su slučajno bila isti popis razdvajaju se čim se prvi put raziđu (`LAYER_KEYS`, `DEFAULT_LAYER_KEYS`, `DOWNLOAD_KEYS`). Isto vrijedi za `INTERACTIVE_LAYERS`: vrijednost je ime sloja u pločici, a ne ime prekidača.

### L-039 — Ono što raste mora se mjeriti, ne procijeniti jednom (2026-09-18)
- Što se dogodilo: donje trake i legenda odmicale su se od MapLibreove atribucije za fiksnih 40 px. Dodavanjem šestog izvora podataka atribucija se prelomila u dva reda i prekrila statusnu traku i mjerilo na užem prozoru.
- Uzrok: fiksna brojka za visinu elementa koji po prirodi raste sa svakim novim izvorom.
- Pravilo ubuduće: visina takvog elementa se mjeri (`ResizeObserver`) i objavljuje kao CSS varijabla (`--map-chrome`), a ostalo se odmiče od nje. Fiksni razmak smije ostati samo prema nečemu čija je visina stvarno stalna.

### L-040 — Prazna datoteka je ispravan sadržaj, ako je shema uz nju (2026-09-18)
- Što se dogodilo: za podatkovne centre ne postoji otvorena baza za regiju. Napast je bila „popuniti" popis poznatim imenima iz sjećanja.
- Pravilo ubuduće: ako podatak nema izvor, ne upisuje se. `overrides/datacenters.yaml` ide u repozitorij prazan, sa shemom i pravilima u komentaru, a validacija odbija zapis bez https poveznice na izvor i procijenjenu snagu. Test provjerava da je datoteka u repozitoriju i dalje prazna.

### L-041 — Keširana međudatoteka mora nositi i pravila po kojima je nastala (2026-09-18)
- Što se dogodilo: predfiltar je keširao datoteke po imenu `<zemlja>-<md5 izvora>`. Proširenje popisa ključeva (dodan `telecom`) ne bi promijenilo ime, pa bi build tiho koristio staru datoteku i podatkovni centri se nikad ne bi pojavili.
- Pravilo ubuduće: ime keširane datoteke sadrži sve što određuje njezin sadržaj — ovdje i kratki hash popisa ključeva.

### L-042 — Kad jedan filtar ne može obuhvatiti dvije stvari, dva prolaza su rješenje, a ne kompromis (2026-09-18)
- Što se dogodilo: punionice traže `amenity=charging_station`, a `amenity` je jedan od najčešćih ključeva u OSM-u. Filtriranje po ključu učinilo bi predfiltar besmislenim (Italija ~2 GB), a pyosmium filtri se lančaju kao I, pa se „power ILI amenity=charging_station" ne može izraziti u jednom prolazu.
- Pravilo ubuduće: umjesto širenja jednog filtra do besmisla, uvodi se **popis prolaza**, svaki sa svojim izborom i svojom izlaznom datotekom. Cijena je čitanje izvora jednom više, dobitak je da svaka datoteka ostaje onoliko mala koliko treba biti. `SourceFilter` odbija prolaz koji istovremeno bira po ključu i po paru, da razlika ostane jasna.


### L-043 — Animacija koja crta svaki kadar izgladnjuje „idle" (2026-09-19)
- Što se dogodilo: animacija tokova mijenjala je `line-dasharray` svaki kadar. MapLibre zato nikad nije javio `idle`, a „spremno" na karti (koje čeka `idle` nakon novog stila) nije stiglo: svi e2e testovi s uključenim slojem uživo pali su na čekanju karte.
- Uzrok: dva mehanizma dijelila su isti signal (`idle`) s oprečnim potrebama — jedan ga čeka, drugi ga stalno odgađa.
- Pravilo ubuduće: petlja koja crta bez kraja mora znati kad se karta smiruje i **pričekati** (`settledRef`: false nakon `setStyle`, true na prvi `idle`). Svaki test koji čeka „spremno" uz uključenu animaciju sada to i dokazuje.

### L-044 — Vite obrađuje `href` svake `<link>` oznake u index.html (2026-09-19)
- Što se dogodilo: `hreflang` poveznice `<link rel="alternate" href="/">` srušile su build s `EISDIR`: Vite svaki `<link href>` smatra datotekom koju treba uvrstiti u bundle, a `/` je mapa.
- Pravilo ubuduće: `<link>` koji pokazuje na stranicu, a ne na datoteku (alternate, canonical), dobiva `vite-ignore`. Test e2e za SEO gradi cijeli `dist`, pa bi se ponavljanje uhvatilo prije objave.

### L-045 — Pozadinski poslužitelj + `reuseExistingServer` = testovi na starom buildu (2026-09-19)
- Što se dogodilo: e2e pokrenut u pozadini ostavio je `vite preview` živim. Sljedeći `playwright test` ga je (po `reuseExistingServer`) ponovno iskoristio i testirao **stari** build: popravak rasporeda na mobitelu izgledao je kao da ne radi.
- Pravilo ubuduće: prije lokalnog e2e provjeriti da na portu ne visi stari poslužitelj (`pkill -f "vite preview"`), a u CI-ju `reuseExistingServer` ostaje isključen. Test koji „ne vidi" promjenu prvo je pitanje: koji build gleda?

### L-046 — `getAttribute("open")` na otvorenom `<details>` je `""`, dakle „false" (2026-09-19)
- Što se dogodilo: e2e test za legendu provjeravao je `if (!(await legend.getAttribute("open"))) click(summary)`. Na otvorenoj legendi atribut je prazan string → uvjet istinit → klik ju je **zatvorio**, pa je test pao s „hidden". U `cities.spec.ts` isti kod je radio samo zato što je legenda ondje bila kompaktna (zatvorena).
- Uzrok: boolean HTML atribut se čita kao string; prisutnost, ne vrijednost, nosi značenje.
- Pravilo ubuduće: stanje boolean atributa pitati element (`el.open`, `el.checked`, `el.disabled`) ili `hasAttribute`, nikad kroz istinitost `getAttribute`. Oba testa sad koriste `evaluate((el) => el.open)`.

### L-047 — Kad treći opcionalni arhiv stigne, dva boolean argumenta postaju zapis (2026-09-19)
- Što se dogodilo: `dataSources(tiles, live, showDistribution, showChargers)` i `LayerOptions.showDistribution/showChargers` — s trećim opt-in arhivom (crpilišta) svaki poziv bi dobio još jedan pozicijski boolean i još jedno mjesto gdje se odluka „prekidač uključen I arhiv objavljen" ponavlja.
- Pravilo ubuduće: čim se isti oblik odluke ponovi treći put, ona dobiva ime i jedno mjesto: `OptIn = Record<OptInArchive, boolean>` i `optedIn(tiles, layers)`; izvori i slojevi je čitaju iz istog zapisa. Dodavanje sljedećeg arhiva je jedan unos u `OPT_IN_ARCHIVES`, ne još jedan parametar.

### L-048 — Skriven tekst u gumbu ruši `getByText(...).click()`, ne gumb (2026-09-19)
- Što se dogodilo: donja traka na mobitelu dobila je gumbe samo s ikonom (tekst `display: none` ispod 720 px). Tri e2e testa klikala su `getByText("Preuzmi bazu", { exact: true })` — to nađe **unutarnji span**, koji je sad skriven, pa klik pada iako je gumb vidljiv i radi. Isto s dva datuma (dugi/kratki) u jednoj pilulici: `getByText(/^Podaci od /)` nađe dva elementa i puca na strict mode.
- Pravilo ubuduće: u testu se klika **kontrola** (`locator("summary", { hasText })`, `getByRole`), ne tekst u njoj; element koji ima više prikaza istog sadržaja dobiva `data-*` oznaku i test cilja nju. Tekst je sadržaj, ne selektor.

### L-049 — Zip i `.gitignore` odbacili su izvorni kod: uzorak `data/` bez sidra (2026-09-19)
- Što se dogodilo: završna provjera iz **raspakiranog zipa u čistom direktoriju** pokazala je da `web/src/data/` (kod koji učitava podatke) uopće nije u arhivi — isključenje `*/data/*` mišljeno za `pipeline/data` pogodilo je i njega. Gore: isti uzorak `data/` stajao je i u `.gitignore`, pa bi i GitHub push tiho izostavio taj direktorij i CI bi pao na prvom buildu. Svi prethodni zipovi imali su istu rupu, a nitko je nije vidio jer su sve provjere išle nad radnom kopijom, ne nad artefaktom.
- Uzrok: uzorci bez sidra (`data/`, `*/data/*`) hvataju svaki direktorij tog imena; i ime „data" je za kod jednako prirodno kao za podatke.
- Pravilo ubuduće: (1) uzorci u `.gitignore` i pri pakiranju su **usidreni** (`/pipeline/data/`, `energetska-karta/web/e2e/.data/*`); (2) `tests/test_repo_rules.py` pita sam git (`git check-ignore`) jesu li izvorni direktoriji ignorirani; (3) svaka isporuka se provjerava **iz artefakta**: raspakirati, svježi `venv`/`npm ci`, sve provjere i produkcijski build — ne iz radne kopije.

### L-050 — Polje izvora može proturječiti nazivu (2026-11-08)
- Što se dogodilo: HEP-ov redak „TS 110/35 kV BJELOVAR 1" ima prijenosni omjer „35/10(20) kV". Razina napona
  iz polja omjera svrstala bi TS 110 kV među TS 35 kV, i analitika po razini bila bi kriva bez ikakve greške.
- Uzrok: pretpostavka da su dva polja istog zapisa usklađena.
- Pravilo ubuduće: kad dva polja kažu isto, kod bira izvor s razlogom (ovdje naziv, koji HEP koristi i u
  službenim PDF-ovima) i test sadrži baš taj stvarni proturječni primjer.

### L-051 — Regex za čišćenje imena testira se na svakom obliku iz izvora (2026-11-08)
- Što se dogodilo: uzorak za vodeći kod („4TS26 ") s opcionalnom znamenkom i razmakom pojeo je „RP 35 " iz
  „RP 35 KV GTE CIGLENA", pa je kratko ime postalo „KV GTE CIGLENA". Uhvatio ga je parametrizirani test sa
  stvarnim imenima.
- Pravilo ubuduće: uzorci su što uži (znamenka obavezna, bez razmaka unutar koda), a test nabraja po jedan
  stvarni primjer za svaki oblik imena koji izvor koristi.

### L-052 — Intl stavlja neprelomivi razmak prije „%" (2026-11-08)
- Što se dogodilo: test HTML-a tražio je „1 (100 %)" s običnim razmakom; hrvatski `Intl.NumberFormat` piše
  neprelomivi razmak, pa je test pao iako je ispis bio ispravan.
- Pravilo ubuduće: test koji provjerava formatirane brojke koristi isti formatter ili `\s` u regexu, nikad
  doslovni razmak iz glave.

### L-053 — Lokalna provjera bez node_modules nije CI (2026-11-08)
- Što se dogodilo: sandbox nije imao mrežu za npm/pip. Logika i tipovi provjereni su lokalnim okvirom
  (transpilacija globalnim TypeScriptom, tipske zamjene za zod/React, vitest API na `node:test`, zamjene za
  httpx/boto3/osmium u Pythonu), ali ESLint, stvarni zod, e2e i snimke nisu pokrenuti.
- Pravilo ubuduće: izvještaj uvijek razdvaja što je provjereno lokalno od onoga što čeka CI; promjene
  sučelja (karta, React) rade se tek uz build, e2e i snimke (L-011). Zamjene nikad ne ulaze u repozitorij.

### L-054 — Datum builda nije datum promjene stranice (2026-11-08)
- Što se dogodilo: sitemap je svim stranicama svaki tjedan davao datum builda kao `lastmod`, pa bi ga
  tražilice prestale uzimati u obzir.
- Pravilo ubuduće: datum promjene izvodi se iz sadržaja (hash), a ne iz trenutka izvođenja; prethodno stanje
  čita se s objavljene stranice (isti princip kao L-015).

### L-055 — Mock koji odgovara za fiksni datum, a kod pita za danas (2026-11-08)
- Što se dogodilo: `test_cli_gas_fetch_and_publish` prolazio je 19. 9., a od kraja rujna pada: CLI traži
  zadnje plinske dane od `datetime.now()`, a mock je vraćao dane računate od fiksnog `NOW`. Izvan prozora,
  odbačeni su i dokument je odbijen kao zastario. CI bi bio crven bez ijedne promjene koda.
- Pravilo ubuduće: mock odgovara na ono što zahtjev traži (raspon iz parametara), a test koji ide kroz CLI s
  pravim satom ne smije ovisiti o fiksnom datumu. Provjera „iz artefakta" pokreće i stare testove (L-049).

### L-056 — Lokalni okvir je prevodio i neispravan kod (2026-11-08)
- Što se dogodilo: komentar je progutao zagradu u testu (`toContain("…" // …);`), a lokalni okvir je test ipak
  pokrenuo: `ts.transpileModule` vraća izlaz i kad ima sintaksnih grešaka. Uhvatio ga je tek Prettier.
- Pravilo ubuduće: okvir traži `reportDiagnostics` i pada na svakoj sintaksnoj grešci; Prettier i `tsc` se
  pokreću nakon svake izmjene, ne samo na kraju. Očekivane brojke u testu računaju se istim formatterom kao
  kod (`power()` zaokružuje od 10 MW na cijeli MW — nastavak L-024).


### L-057 — Prototip efekata otišao izvan odobrenog dizajna (2026-11-15)
- Što se dogodilo: prototip „Energetska karta u pokretu” imao je crnu pozadinu, mono etikete VELIKIM slovima,
  ukrasna iskakanja i sjaj, ručno ucrtanu kartu i žute tokove. Korisnik: „karta mi malo bježi od dizajna”.
- Uzrok: prototip je rađen kao samostalna stranica po općim smjernicama, a „Dizajn sustav” iz `tasks/todo.md`
  (srednji tonovi, Plex bez mono i velikih slova, miču se samo tokovi, boje uvoza i izvoza) nije pročitan prije
  rada; od tokena je preuzet samo dio.
- Pravilo ubuduće: prije svakog vizualnog rada, i prototipa, pročitati „Dizajn sustav” i `tokens.css`/`palette.ts`
  i držati ih se. Efekti se prikazuju u pravoj karti sa stvarnim podacima; izmišljeni podaci samo uz jasnu oznaku
  i samo kad pravi ne postoje.

### L-058 — Inženjerski pregled Faza 18–19: dodatni podaci ne smiju rušiti glavne (2026-11-15)
- Što se dogodilo: pregled je našao tri greške u vlastitom kodu: (1) jedna neuspjela ENTSO-E proizvodnja
  (nakon ponovnih pokušaja) srušila bi cijelo satno objavljivanje tokova i cijena; (2) dok s trakom uživo,
  karticom mješavine i vremeplovom nije imao gornju granicu, pa bi na nižim ekranima izrastao iznad karte, a
  na mobitelu je pojeo kartu; (3) polje „kW” nije se dalo isprazniti pri tipkanju.
- Uzrok: nova polja dodana su uz postojeći tok bez pitanja „što ako baš ovo padne / naraste”.
- Pravilo ubuduće: svaki dodatni izvor u postojećem poslu hvata vlastite greške i bilježi ih u `missing` i log,
  a glavni podaci se objavljuju; svaki novi blok u plutajućem sučelju provjerava najveću visinu dok svi blokovi
  stoje zajedno; kontrolirana polja za brojeve drže tekst, a računaju iz zadnje valjane vrijednosti.

### L-059 — Pregled mora pokazati ono što pokazuje prava stvar (2026-11-15)
- What happened: simulacija uvoda (video) prikazala je samo Hrvatsku jer su offline bili dostupni samo hrvatski
  obrisi; korisnik je zaključio da uvod ne pokazuje regiju, iako prava karta završava na cijeloj regiji.
- Root cause: natpis u videu rekao je da su podloga i trase shematske, ali ne i da nedostaje cijela regija;
  pregled je izostavio upravo ono po čemu se proizvod zove („Hrvatske i regije”).
- Rule going forward: kad pregled ne može prikazati dio prave stvari, to se kaže izričito, uz poruku i u samom
  pregledu, a za vizualnu ocjenu predlaže se pravi preview (grana + PR → Cloudflare preview).

### L-060 — CSP je u produkciji blokirao stil svih statičnih stranica (2026-11-15)
- What happened: `_headers` šalje `style-src 'self'`, a svaka statična stranica ima samo ugrađeni `<style>`.
  Pregled podagentom (Faza 31) to je našao; nijedan test nije, jer `vite preview` u e2e ne primjenjuje `_headers`.
- Root cause: politika i stranice su se mijenjale odvojeno, bez testa koji ih spaja.
- Rule going forward: svaki ugrađeni stil ili skripta ide kroz jedan modul, a test renderira stvarne stranice i
  provjerava ih prema CSP-u (hash). Ono što e2e ne vidi (zaglavlja, CDN) provjerava se jediničnim testom.

### L-061 — „vidljivo” nije „može se kliknuti” (2026-11-15)
- What happened: izbornici za preuzimanje i dijeljenje unutar donjeg spremnika (overflow) bili su odrezani;
  e2e `toBeVisible()` prolazi i za odrezan element.
- Root cause: apsolutno pozicionirani izbornik unutar spremnika koji klizi; provjera samo vidljivosti.
- Rule going forward: plutajući izbornici idu u gornji sloj (Popover API); provjera rasporeda koristi
  `elementFromPoint` na sredini ciljanog elementa, ne samo vidljivost.


### L-062 — Dvije datoteke koje se razlikuju samo veličinom slova (2026-11-15)
- What happened: na Windowsu se stranica nije podigla: `import { Intro } from "./Intro"` dobio je `intro.ts`
  umjesto `Intro.tsx` („does not provide an export named 'Intro'”). Na Linuxu (CI) radi, pa nitko nije vidio.
- Root cause: `src/app/intro.ts` i `src/app/Intro.tsx` u istoj mapi; Windows i macOS ne razlikuju velika i mala slova.
- Rule going forward: imena modula u istoj mapi razlikuju se i bez obzira na veličinu slova (logika je sada
  `introMode.ts`). Vite dev poslužitelj treba ponovno pokrenuti nakon takvog preimenovanja.

### L-063 — Preglednik ne smije uvoziti iz alata za build (2026-11-15)
- What happened: `src/data/weather.ts` uvozio je `WEATHER_ORIGINS` iz `vite/securityHeaders.ts`; otkad taj modul
  pri učitavanju računa hash (`node:crypto`, Faza 31), stranica u pregledniku pada prije prvog prikaza.
- Root cause: zajednička konstanta živjela je u Node modulu; jedinični testovi rade u Nodeu pa to ne vide.
- Rule going forward: ovisnost ide samo u smjeru build → `src/`. Zajedničke konstante žive u `src/` u modulu bez
  uvoza (`src/data/weatherOrigins.ts`). Nakon promjene u `vite/` stranicu treba stvarno otvoriti u pregledniku.

### L-064 — Čitač pisan prema opisu, ne prema datoteci (2026-11-15)
- What happened: prvi pravi `osm-build` pao je na sloju gradova: 7. izdanje GCoM-a počinje listovima `README` i
  `df*_METADATA`, podaci su u listovima „1”, „2”, „2D_1”, sektori i energenti su zbirni
  (`aggregated_sector`: „Transportation”, „Non-ETS”), a grad s više planova ima više baznih inventara.
- Root cause: `cities/read.py` i fixture pisani su prema znanstvenom radu o podacima, bez stvarne datoteke.
- Rule going forward: list se bira po prefiksu imena **i** zaglavlju, nikad po položaju. Čitač vanjskog
  izvora nije gotov dok jednom ne prođe na stvarnoj datoteci; test nosi imena listova i stupaca prepisana
  iz nje (`test_seventh_release_layout_is_read`).

### L-065 — Provjere koje nikad nisu pokrenute zajedno (2026-11-15)
- What happened: prvi `web` na GitHubu pao je na `tsc` (7 grešaka); iza toga su čekale 24 lint primjedbe i 16
  testova koji su stavke tražili u izborniku prije nego što ga otvore (Popover API iz Faze 31; jsdom ga nema).
- Root cause: `npm run check` staje na prvoj grešci, a nakon Faze 31 nije pokrenut do kraja ni jednom.
- Rule going forward: faza nije gotova dok `npm run check` ne prođe cijeli. Testovi izbornik prvo otvore;
  jsdom dobiva Popover API iz `src/test/popover.ts`. Automatski `eslint --fix` se pregleda u diffu (zamjena
  `a && a.b !== null` u `a?.b !== null` mijenja značenje).

### L-066 — Traka viša od svog okvira (2026-11-16)
- What happened: otkad traka „Tokovi i cijene” nosi karticu sastava struje, na desktopu je ulazila pod panel s
  detaljima, a njezin donji dio ležao je skriven ispod retka s izvorima i, na mobitelu, ispod gumba „Filtri i
  pregled”. e2e `layout.spec.ts` je to uhvatio; e2e nije pokrenut nakon te promjene.
- Root cause: dock je bio jedini okvir koji se pomiče, pa je traka unutra bila viša od onoga što se vidi; širina
  docka nije računala stupac s detaljima.
- Rule going forward: traka se pomiče unutar vlastitog okvira (`.liveSlot > *`), a redak sa stanjem podataka
  ostaje vidljiv; dock završava prije stupca s detaljima (od 1200 px). e2e ima 45 minuta i sprema izvještaj i
  kad istekne; testni podaci su artefakt `e2e-data`, pa se e2e može vrtjeti i na Windowsu
  (`PW_CHROMIUM_PATH`, `--workers=1`).

### L-067 — „Provjereno na živom API-ju” koje nije bilo (2026-11-16)
- What happened: prvi `gas-daily` nije dobio nijednu vrijednost. Upit `operationalData` filtrirao je po polju
  `id` iz popisa točaka („5HR-TSO-0001PRD-00197entry”), a ENTSOG na to odgovara 404; prihvaća operator + točku +
  smjer („HR-TSO-0001PRD-00197entry”). Testni stand-in je odgovarao upravo na krivi oblik.
- Root cause: stand-in je pisan iz iste pretpostavke kao i kod, pa ju je potvrđivao umjesto provjeravao.
- Rule going forward: oznaka se slaže iz stabilnih polja (`entsog.point_direction_of`), u oba modula. Uz to:
  `pipeline` provjere su `ruff check .`, `ruff format --check .`, `mypy src tests` i `pytest`, sve četiri prije
  pusha (mypy samo nad `src` propustio je šest grešaka u testovima); `%` u `help=` teksta argparsea piše se `%%`.

### L-068 — Jedna kriva koordinata rasteže cijelu kartu (2026-11-16)
- What happened: nakon prve objave svih zemalja karta se otvarala nad istočnim Sredozemljem. Dva grada u 7.
  izdanju GCoM-a (Istrana, Csongrád) imaju zamijenjenu širinu i dužinu, pa su završila u Jemenu i Iranu, a
  granice pločica (`current.json` → `tiles.grid.bounds`), po kojima se karta prvi put namješta, protegnule su se do tamo.
- Root cause: izvor koji sam navodi zemlju uzet je za riječ; lokacija nije provjerena prema toj zemlji.
- Rule going forward: točka iz izvora koji navodi zemlju provjerava se prema granicama te zemlje
  (`CountryIndex.is_in_or_near`). Zamijenjene koordinate koje padaju u navedenu zemlju se ispravljaju i broje,
  ostalo se izostavlja i broji. Nakon svake objave pogledati i `tiles.*.bounds`, ne samo brojeve objekata.

### L-069 — Novo izdanje izvora mijenja nazive bez najave (2026-11-16)
- What happened: GEM tablica iz rujna 2026. prošla je provjeru, ali bi sve plinske elektrane postale naftne, a
  sve sunčane „ostalo”: stupac „Fuel” sada je „Fuel (combustion only)”, a vrsta „solar” je „utility-scale solar”.
- Root cause: neobavezan stupac koji nedostaje i nepoznata vrsta padaju na zadanu vrijednost bez upozorenja.
- Rule going forward: prije prve objave novog izdanja izvora pogledati zbroj po tehnologiji za jednu poznatu
  zemlju (Hrvatska: hidro ~1,5 GW, plin ~1,1 GW, vjetar ~1,1 GW). Otvoreno: nepoznata vrsta i prazan stupac goriva
  trebaju brojač u statistici builda, da se ovo vidi i bez ručne provjere.

### L-070 — Granica domaćina koju testovi ne poznaju (2026-11-16)
- What happened: nakon spajanja s GEM-om objava je pala: „Pages only supports up to 20,000 files”. Stranica je
  imala 20 251 datoteku, od toga 14 212 za stranice pojedinih objekata (HTML i Markdown, na dva jezika).
- Root cause: broj stranica raste s podacima, a ograničenje Cloudflare Pagesa nije bilo nigdje u kodu.
- Rule going forward: stranica jednog objekta nema Markdown blizanca (ima JSON u API-ju); `prerender` odbija
  build koji bi prešao `PAGES_FILE_LIMIT` i kaže brojke. Novo ograničenje domaćina upisuje se kao provjera u buildu.

### L-071 — Promjena vidljivog teksta bez pokretanja e2e testova koji ga čitaju (2026-11-16)
- What happened: pri preimenovanju u GridAtlas naslovu početne stranice dodan je opis („GridAtlas: Regionalna
  energetska karta”). Jedinični testovi su ažurirani i prošli, ali `e2e/seo.spec.ts` je i dalje očekivao samo
  ime, pa je objava dvaju commitova (ime, semafor) pala na e2e i stranica nije objavljena.
- Root cause: lokalno je pokrenut samo `npm run check` (bez e2e), a tekst je promijenjen nakon automatske
  zamjene koja je e2e datoteke već „popravila” na staru vrijednost.
- Rule going forward: nakon promjene bilo kojeg vidljivog teksta pretraži `e2e/` za stari i novi tekst i pokreni
  pogođene e2e datoteke lokalno prije slanja; „check prolazi” ne znači da prolazi i e2e.

### L-072 — Uzastopna slanja prekidaju objavu, a korisniku je rečeno da je stvar objavljena (2026-11-16)
- What happened: nakon slanja sunčanog potencijala (c780002) poslana su još dva commita u dvadesetak minuta.
  Svako slanje prekida testove prethodnoga (ista grupa u `web.yml`), pa su objave c780002 i b89abf0 otkazane.
  Korisniku je javljeno da će sloj „proraditi s objavom koja se vrti”; nije ga našao na stranici.
- Root cause: novo slanje je krenulo bez provjere je li prethodna objava završila; izvještaj je pisan po
  očekivanju, ne po provjeri žive stranice.
- Rule going forward: dok traje objava nečega što je korisniku najavljeno, sljedeće izmjene se skupljaju lokalno
  i šalju tek kad objava završi. „Objavljeno” se javlja tek nakon provjere na živoj stranici (sadržaj paketa ili
  stranice), a do tada se kaže „poslano, objava traje”.


### L-073 — Test koji prolazi samo u mojoj vremenskoj zoni (2026-11-17)
- What happened: test kartice punionice očekivao je „u satu od 09:00”. Lokalno (Europe/Zagreb) je prošao, na
  GitHubu (UTC) pao jer komponenta ispisuje „08:00”; objava `fe28577` nije prošla i stranica je ostala na
  prethodnoj verziji dok to nisam primijetio.
- Root cause: komponenta ispravno prikazuje sat u zoni čitatelja, a test je imao upisan sat moje zone. Prije
  slanja pokrenuo sam testove samo u svojoj zoni.
- Rule going forward: test koji provjerava ispisano vrijeme očekivanu vrijednost računa istim formatiranjem
  (ili zadaje zonu), nikad je ne upisuje ručno. Novi test s datumom ili satom prije slanja pokrenuti i s
  `TZ=UTC`, jer tako radi CI.
