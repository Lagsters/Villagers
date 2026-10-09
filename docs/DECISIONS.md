# Decyzje projektowe

Każdy wpis: data, decyzja, uzasadnienie.

## 2026-09-25 — M0

- **Tytuł roboczy:** „Osadnicy Doliny”. Zostaje.
- **Jeden `package.json` w korzeniu** zamiast monorepo z workspace'ami. Projekt jest mały, a jeden
  zestaw zależności upraszcza CI i uruchamianie.
- **TypeScript uruchamiany natywnie przez Node ≥ 22.18** (type stripping). Dlatego `erasableSyntaxOnly`
  (bez `enum`, bez parameter properties) i importy z rozszerzeniem `.ts`. Serwer sygnalizacyjny
  i skrypty narzędziowe działają bez kroku kompilacji.
- **Zależności:** `three` (rendering), `ws` (serwer sygnalizacyjny). Dev: `typescript`, `vite`, `vitest`,
  `@playwright/test`, `eslint` + `typescript-eslint` + `@eslint/js` (lint), `@types/*`.
  Wszystkie wymagane przez specyfikację lub niezbędne do typowania.
- **ESLint pilnuje determinizmu:** w `sim/` zakazane są `Math.random`, `Math.sin/cos/sqrt`, `Date.now`,
  `performance.now`, `window`, `document`.
- **`base` Vite** ustawiany zmienną `BASE` (domyślnie `/Villagers/`); CI ustawia go na nazwę repozytorium.
- **Repozytorium:** właściciel wskazał `github.com/Lagsters/Villagers`. Pages publikuje pod `/Villagers/`,
  stąd domyślny `base`. Kod jest wypychany na `main` po każdym etapie; CI buduje i publikuje.

## 2026-09-25 — M2–M4

- **Pozycja w komendach** to indeks pola `pos = y * W + x` zamiast pary `x, y` (mniej walidacji, jedno pole).
- **Teren per wierzchołek**, nie per trójkąt jak w oryginale: typ terenu i wysokość należą do pola, kolor
  trójkąta wynika z jego trzech wierzchołków. Prostsza generacja i walidacja zabudowy, wygląd low-poly bez zmian.
- **Flaga budynku na SE**, budynek duży zajmuje dodatkowo pola W, NW, NE. Wyrównywanie terenu tylko pod
  duże budynki (kopacz z łopatą).
- **Osadnicy mogą stać na tym samym polu** (brak blokowania ruchu jednostkami) - bez zakleszczeń na drogach.
- **Myśliwy** (nieobecny w oryginale, wymagany przez specyfikację) nie potrzebuje narzędzia; poluje na
  zwierzęta wędrujące przy lasach. **Osły** (też spoza oryginału) rodzą się w zamku, bez osobnego budynku.
- **Rozdział towarów:** wynik odbiorcy = `waga × 64 − odległość + min(240, czas_od_dostawy / 2)`.
  Przy równych wagach odbiorcy dostają na zmianę; różnica wagi ≥ 4 daje pierwszeństwo.
- **Kolory graczy** zostają przy palecie z `sim/defs.ts`. Walidator palety (dataviz) potwierdza kontrast
  ≥ 3:1 i rozdzielenie par sąsiednich, ale 8 barw nie da się rozróżnić przy wszystkich parach i każdym
  typie daltonizmu (najgorsza para przy normalnym wzroku: pomarańczowy/czerwony, ΔE 13,2). Dlatego
  tożsamość gracza nigdy nie opiera się na samym kolorze: w statystykach jest legenda z nazwami, etykiety
  na końcach linii (do 4 graczy) i tabela; w świecie gry panel pokazuje nazwę właściciela.
- **Statystyki**: próbka co 300 ticków, maks. 240 próbek, po zapełnieniu średnia parami.
- **Testy scenariuszy** przerabiają mapę (np. robią góry ze złożem obok zamku), żeby nie zależeć od losowego terenu.

## 2026-09-25 — Rozszerzenie gospodarki do poziomu Settlers 2 (uwaga właściciela)

Właściciel zauważył, że budynków jest za mało i ekonomia różni się od oryginału. Porównanie z pełną listą
budynków Settlers 2 (settlers2.net) pokazało brakujące łańcuchy. Dodane:
- **Studnia** (woda) jako drugie wejście piekarni, chlewni, browaru i hodowli osłów.
- **Browar**; rekrut wymaga piwa (osadnik + miecz + tarcza + piwo).
- **Mennica** zamiast huty złota: ruda złota + węgiel → moneta; monety szkolą rycerzy i podnoszą morale.
- **Hodowla osłów** (osły nie rodzą się już same w zamku), **Smolarnia** (węgiel z drewna i zboża),
  **Katapulta** (kamienie jako amunicja, zabija rycerzy wroga w zasięgu 10).
- **Rozmiar „dom”** (średni) obok chaty i dużego budynku; większość warsztatów to domy.
- Wojskowe jak w S2: barak (2), wartownia (3), wieża strażnicza (6), twierdza (9).
- 12 narzędzi (doszły łuk, tygiel, wałek; leśnik potrzebuje łopaty, kowal tylko obcęgów, płatnerz młotka).
- Nowe suwaki rozdziału: zboże (5 odbiorców) i woda (4 odbiorców).

Pominięte (z uzasadnieniem): **port i statki** (w oryginale S2 dostępne tylko w kampanii rzymskiej, duża
złożoność sieciowa), **wieża obserwacyjna** (gra nie ma mgły wojny, więc nie miałaby funkcji).
Drogi wodne z łodziami zostają (część pierwsza).

## 2026-09-25 — M6 (boty i reguły wynikające z partii testowych)

- **Rycerze idą do budynku wojskowego na przełaj, gdy nie ma drogi.** Przejęcia i utrata terytorium
  masowo odcinały budynki frontowe od sieci; nie dało się ich wzmocnić i partie utykały. Pozostali osadnicy
  chodzą wyłącznie drogami.
- **Ocalali atakujący obsadzają zdobyty budynek** (do pojemności), jak w Settlers 2.
- **Przekwalifikowanie bezczynnych specjalistów**: specjalista w magazynie oddaje narzędzia, gdy są potrzebne
  innemu zawodowi albo do rekrutacji (jeden z każdego zawodu zostaje). Zapobiega zakleszczeniu „brak młotka,
  więc nie ma kowala, który zrobi młotek”.
- **Limit osadników 300** (było 200) - duże osady potrzebują więcej tragarzy.
- **Kuźnia nie robi narzędzi w nadmiarze** (≥ 4 w zapasie i nikt nie czeka).
- **Boty czytają złoża z mapy** w granicach własnego terytorium zamiast wysyłać geologów - uproszczenie AI,
  nie wpływa na grę ludzi.
- **Test partii botów:** mapa 64, trudny vs łatwy, limit 108 000 ticków (3 h gry) jako „rozsądna liczba”.
  Faktycznie partie trwają 36-101 min.
- **Zakleszczenie gospodarki** w teście = okno 6000 ticków bez produkcji, choć ≥ 3 obsadzone budynki wytwarzające
  towar mają komplet wejść. Upadek osady pod naporem wroga (brak surowców) nie jest zakleszczeniem.

## 2026-09-25 — M7 (sieć)

- **Lockstep z przekaźnikiem u hosta**: klienci nie numerują tur - host przypisuje komendy do najbliższej
  zamykanej tury (co 200 ms) i nadpisuje w nich numer gracza (nikt nie wyda komendy za kogoś innego).
  Host nie wyprzedza najwolniejszego klienta o więcej niż 12 tur; klient z zaległościami przyspiesza.
  Opóźnienie komendy = RTT do hosta + do 1 tury.
- **Boty w grze sieciowej liczy tylko host**; ich komendy idą przez lockstep jak komendy ludzi.
  Rozłączony gracz dostaje bota (poziom trudny).
- **Test e2e lobby tylko w Chromium.** W Playwright-Firefox RTCPeerConnection nie zbiera kandydatów ICE
  na stronie z `http://localhost` (na `about:blank` działa) - to ograniczenie środowiska testowego,
  nie gry. Połączenie sieciowe dodatkowo sprawdzono ręcznie w przeglądarce wbudowanej (Chromium):
  lobby, start, bot hosta, brak desynchronizacji, komunikat po utracie gospodarza. Pozostałe testy e2e
  działają w Chromium i Firefoksie.
- **W CI Firefox działa z oknem pod xvfb** (headless Firefox na Linuksie nie ma WebGL).
- Diagnostyka połączeń: `localStorage.debugNet = '1'` włącza logi `[rtc]` w konsoli.

## 2026-09-25 — M8 (grafika i dźwięk)

- **Modele wyłącznie ze skryptów** `art/scripts/{nature,units,goods,buildings}.py` (bpy, `--background`),
  wspólna biblioteka `lib.py`: bryły z kolorem w wierzchołkach z jednej palety, bez tekstur.
  `npm run art` generuje wszystko (`art/models/*.glb`, `art/previews/*.png`, `art/icons/*.png`).
  Wygenerowane pliki są w repozytorium, żeby CI i GitHub Pages nie potrzebowały Blendera.
- **Budżet domów (średnich) 1200 trójkątów** - specyfikacja podaje tylko mały (800) i duży (2000).
  Faktycznie budynki mają 98-664 trójkątów.
- **Animacje bez szkieletu:** osadnik składa się z części (tułów, głowa, 2 nogi, 2 ręce, u rycerza hełm,
  tarcza, miecz), każda na własnym InstancedMesh, ruch liczony w kodzie (wahadło nóg i rąk, ręce nad głową
  przy noszeniu, zamach mieczem). Skrzydła wiatraka to osobny model obracany w rendererze.
- **Jednostki są w skali 1,25** względem budynków (czytelność z kamery izometrycznej).
- **Ikony UI to rendery modeli** (96 px, przezroczyste tło) - te same modele co w grze, spójny styl.
- **Dźwięk proceduralny w WebAudio** (oscylatory + szum), bez plików; odgłosy świata tylko w kadrze kamery,
  z limitem częstotliwości.
- **Tło menu** to mała partia dwóch botów z krążącą kamerą; wyłączone przy niskiej jakości grafiki.
- Rozmiar: kod + CSS ~215 KB gzip (limit 2 MB), modele 644 KB, ikony 552 KB (razem z modelami < 5 MB).

## 2026-09-25 — M9 (wydajność, balans)

- **Zasięg ataku 18** (było 14). Przy 14 fronty często nie miały celów w zasięgu i partie zamierały
  w równowadze; w oryginale atakować można było budynki widoczne za granicą, czyli dalej niż sama
  granica. Po zmianie 40 z 40 partii botów (trudny vs łatwy, mapa 64) kończy się zwycięstwem:
  mediana 50 min, 90% w 87 min; trudny wygrywa 25:15.
- **Starty graczy w największym spójnym obszarze lądu** - na osobnych wyspach zwycięstwo byłoby niemożliwe.
- **Rycerze trafiają najpierw do budynków z najmniejszą obsadą** (pusty budynek nie trzyma terytorium).
- **Zbieracz bez celu ponawia próbę z rozrzutem i rosnącym odstępem**, a A* dla jego wypraw ma limit
  600 węzłów - wcześniej wszyscy jednocześnie liczyli nieudane ścieżki co 41 ticków (skoki czasu ticku).
- **Renderer rysuje tylko encje w kadrze** (prostokąt z rzutu narożników ekranu na teren), ocean to kolor
  tła zamiast płaszczyzny pod mapą, słupki graniczne też tylko w kadrze.
- **Domyślna jakość grafiki wykrywana automatycznie**: renderer programowy (SwiftShader/llvmpipe) albo
  ≤ 4 GB RAM → „niska” (bez wygładzania krawędzi).
- **Test wydajności** w Chromium (CDP: CPU ×4, 1280×720, DPR 1, 8 graczy, 30 min gry): 45 FPS,
  najdłuższy tick 3,7 ms, pamięć JS ~45 MB, 45 wywołań rysowania. W headless Chromium grafika jest
  rasteryzowana programowo, więc to ostrzejszy warunek niż zintegrowana karta.
- Bot: budowa w kolejności zastępczej (twierdza → wieża → wartownia → barak), sprawdzanie obsady
  (narzędzia, kopacz, budowniczy) przed budową, rezerwy desek i kamienia, łączenie odciętych magazynów,
  2 kopalnie węgla na kopalnię żelaza i smolarnia przy niedoborze węgla, tryb dobijania przy przewadze.
- **Test wydajności w CI jest informacyjny dla FPS i skoków ticku.** Runner GitHub Actions (2 współdzielone
  vCPU, bez GPU, rasteryzacja programowa na tych samych rdzeniach) dał 18,7 FPS i skok ticku 13,6 ms, podczas
  gdy lokalnie przy CPU ×4 test daje 45 FPS i 3,7 ms. W CI twardo sprawdzane są pamięć, liczba wywołań
  rysowania i średni tick; pełne kryteria uruchamia `npm run test:perf` na zwykłym komputerze.

## 2026-09-25 — Dopracowanie modeli (uwaga właściciela)
- **Styl budynków wzorowany na pierwszej części klasycznej serii** (tylko sylwetki i paleta, bez żadnych
  grafik z oryginału): dachy z terakoty z rzędami dachówek, ściany bielone z widocznymi kamieniami,
  z desek albo z bali, każdy budynek z własną sylwetką - smukłe białe wieże zamku ze spiczastymi dachami,
  drewniana wieża wyciągowa nad szopą kopalni i kupka urobku w kolorze rudy, silos farmy, osobny chlew,
  przysadzista kamienna chata wartownicza pod wielkim dachem, wysoka kamienna wieża z przybudówką,
  otwarte palenisko z żarem w zbrojowni, kwadratowy komin-wieża narzędziowni. Budynki drugiej części
  (studnia, browar, hodowla osłów, smolarnia, katapulta, wartownia) w tym samym stylu.
- **Kamera 44° zamiast 52° nad horyzontem**, ściany wyższe, dachy niższe - z góry dachy zasłaniały ściany,
  a to ściany (deski, bale, kamień) odróżniają budynki. W kadrze mieści się ~18% więcej terenu; test
  wydajności nadal 39,5 FPS przy CPU ×4 i 52 wywołaniach rysowania.
- **Zawody widać po postaci**: 14 nakryć głowy (część z brodami: górnik, kowale, geolog) i 12 narzędzi
  w prawej ręce (siekiera, piła, kilof, łopata, kosa, wędka, łuk, wałek, tasak, szczypce, młotek, wiadro)
  jako osobne warstwy instancji; narzędzie porusza się z ręką, znika przy niesieniu towaru. Budżet
  sprawdzany w teście: ciało + najcięższa czapka + najcięższe narzędzie ≤ 300 trójkątów (296).
- Rękawy lniane zamiast barwionych kolorem gracza (barwienie instancji mnożyło też kolor dłoni);
  kolor gracza niesie tunika.
- Fałszywy AO w kolorach wierzchołków budynków (przyciemnienie przy ziemi) zamiast cieni - zero kosztu.
- **Druga runda (uwaga: „za duże dachy, za mało podobne domki, ludzie i teren”)**, porównanie ze zrzutem
  rozgrywki i portretami zawodów oryginału:
  - dachy: okap 0,035 zamiast 0,06-0,07, wysokość 0,34 rozpiętości zamiast 0,62, cieńsze połacie i listwy;
  - teren: wspólne wierzchołki z kolorem per pole (płynne przejścia zamiast płaskich trójkątów), gładkie
    normalne z mapy wysokości (bez szwów między chunkami), soczysta zieleń w łatach (szum niskiej
    częstotliwości), generowana w kodzie faktura 128×128 (ziarno + kępki) mnożona przez kolor, gładka
    otwarta woda przechodząca ku krawędzi mapy w kolor tła (brzeg mapy niewidoczny), węższe drogi-ścieżki;
  - postacie: głowa ×1,35 (głowa, czapki i hełm skalowane względem szyi), oczy, duży nos, rude włosy
    i brody, hutnik w masce; jednostki w skali 1,0 zamiast 1,25, flagi na drogach ×0,8 - w oryginale
    ludziki i proporczyki są drobne względem domów. Rycerz bez pióropusza (budżet 298/300 trójkątów).
  - Wydajność po zmianach: 36,5 FPS przy CPU ×4, 52 wywołania rysowania, najdłuższy tick 3,6 ms.
- **Trzecia runda (uwaga: „domki za podobne, widać tylko dach”)**: rodzaj dachu zależny od budynku -
  gont brązowy (chaty z bali, szopy kopalń, stocznia, studnia), zielony gont (leśnik), strzecha (farma,
  rybak, chlewnia, hodowla osłów, smolarnia), łupek (kamieniarz, huta, narzędziownia, zbrojownia,
  wartownia, katapulta), niebieski czterospadowy (mennica), terakota (domy rzemieślników); dachy
  czterospadowe (magazyn, narzędziownia, browar, mennica); ściany ×1,5, dach 0,3 rozpiętości;
  **szyld z modelem produktu** na słupku przed wejściem (kłoda, drzewko, deski, kamień, ryba, poroże,
  snop, chleb, świnia, szynka, sztaba, moneta, młotek, kufel) - tablica odchylona ku kamerze. Kamera 38°.
  Wydajność: 35,4 FPS przy CPU ×4, 52 wywołania rysowania.
- **Czwarta runda („jeszcze bardziej jak oryginał”)**: każdy budynek odwzorowany na podstawie grafiki
  z pierwowzoru, bez dodatków spoza oryginału - wszystkie dachy z terakoty z kratką dachówek (pionowe
  spoiny na widocznej połaci), bez szyldów z produktami (szyld tylko w mennicy i zbrojowni, jak w oryginale).
  Chaty z bali długą ścianą do kamery, z jasnymi czołami bali na narożniku i skrzyżowanymi deskami na
  szczycie; magazyn z trzema równoległymi dachami, okrągłymi basztami bez dachu, kominem-wieżą i schodami;
  tartak szczytem do kamery z łukowym otworem i dobudówką; piekarnia piętrowa z oknem pieca; rzeźnia
  pół z desek, pół bielona; rybak na kamiennej podmurówce z siecią; kopalnie z A-ramą i szopką z desek na
  szczycie (kopalnia granitu z kamienną szopą); huta z dwóch części z kominem; mennica kamień + deski;
  narzędziownia z kamienną wieżą, dachem czterospadowym i wiatrowskazem; zbrojownia z otwartą kuźnią;
  stocznia jako otwarta szopa z łodzią; kwadratowa chata wartownicza pod dachem czterospadowym; wieża
  z murem z blankami i bramą; warownia z okrągłymi basztami z blankami; młyn niski z dużymi skrzydłami.
  Jednostki w skali 0,85. Wydajność: 37,3 FPS przy CPU ×4.
- **Swobodna kamera** (uwaga: „nie mogę obracać, myślałem, że to 3D”): zamiast samych skoków o 60° (Q/E)
  obrót o dowolny kąt przeciąganiem prawym/środkowym przyciskiem myszy i skrętem dwóch palców, pochylenie
  22°-80° (przeciąganie w pionie, R/F), Home przywraca widok domyślny (38°). Prawy klik bez przeciągania
  nadal anuluje akcję. Nowy krok samouczka opisuje sterowanie kamerą.
- **Zoom do 10× (było 3,2×) i przybliżanie kółkiem do punktu pod kursorem** (uwaga: „za mało można przybliżyć”) - z bliska widać postacie i detale budynków.
- **Drogi na ziemi z fakturą**: wstęga drogi to jedna ciągła taśma przez pola trasy (połączenia na zakrętach
  bez szpar), każdy wierzchołek na wysokości siatki terenu (interpolacja barycentryczna), faktura ubitej
  ziemi z koleinami, kamykami i poszarpanym, półprzezroczystym brzegiem generowana w kodzie.
- **Dwuklik na własnej fladze** zaczyna budowę drogi (jak w pierwowzorze), przycisk w panelu zostaje.
- **Budynki jak w pierwowzorze względem flagi**: modele w grze skalowane (chata 1,7×, dom 1,55×,
  kopalnia 1,6×, duży 1,3×) i przesunięte ku fladze (pole SE), tak że drzwi wychodzą prawie na flagę,
  a budynek sięga w górę i w lewo; wcześniej mały model na środku pola zostawiał ~0,6 pola trawy do flagi.
  Logika pól (zajętość, zasady stawiania) bez zmian.
- **Ikony miejsc budowy** (modele z Blendera, `art/scripts/markers.py`): żółty zamek (duży budynek), dom,
  chata, kilof (kopalnia) i flaga - zamiast kolorowych sześciokątów. **Kursor zaznaczenia z kropek**
  wokół pola (każda na wysokości terenu) zamiast obrysu sześciokąta.
  Wydajność: 36,5 FPS przy CPU ×4, 53 wywołania rysowania.
- **Zasady stawiania budynków z pierwowzoru** (wg reimplementacji freeserf, `src/game.cc`: `can_build_flag`,
  `can_build_small`, `can_build_large`): każdy budynek - także duży - stoi na jednym polu (wcześniej duży zajmował
  4 pola: P, W, NW, NE); chata bez warunków co do sąsiadów i wysokości (wcześniej różnica <= 4); dom i duży
  budynek: brak budynków na 6 sąsiednich polach (drzewa i flagi nie przeszkadzają; wcześniej drzewo i obca flaga
  blokowały), brak innego domu/dużego w drugim pierścieniu, różnica wysokości w drugim pierścieniu < 9, teren
  wyrównywany (kopacz) także pod domy. Młyn jest chatą (jak w pierwowzorze). Flagi nadal nie mogą sąsiadować -
  stąd jedno pole odstępu między budynkami w rzędzie, tak samo jak w pierwowzorze. Test: `tests/sim/rules.test.ts`;
  20/20 partii botów nadal kończy się zwycięstwem.
- **Koszt rysowania po zagęszczeniu zabudowy**: drogi dzielone na 2 kawałki na odcinek (było 4) i rysowane bez
  mieszania (brzeg wycinany progiem alphaTest); czapki i narzędzia postaci rysowane dopiero od przybliżenia 1,6×.
  Pomiar wydajności w tej sesji był niemiarodajny (obciążona maszyna: ta sama wersja z poprzedniego commita dała
  27,9 FPS zamiast wcześniejszych 36-39); nowa wersja w tych samych warunkach: 23-30 FPS, 53 wywołania rysowania,
  70 tys. trójkątów. Próg 30 FPS bez zmian - do potwierdzenia pomiarem na nieobciążonej maszynie.
- **Budowa drogi krok po kroku** (jak w pierwowzorze), z zachowaniem skrótu: klik na sąsiedniej kropce
  przedłuża drogę o jedno pole (zielone kropki pokazują możliwe kroki), klik na fladze albo istniejącej drodze
  kończy, ponowny klik na końcu stawia tam flagę i pozwala prowadzić dalej, klik na polu trasy cofa do niego,
  prawy przycisk / Backspace cofa krok, klik na dalekim polu dociąga najkrótszą drogę od bieżącego końca.
  Sama logika w interfejsie - do symulacji trafia jak dotąd jedna komenda `road` z listą kierunków.
- **Gładkie budynki zamiast poszarpanych**: dachówki (drobne, w rzędach przesuniętych o pół, z zaokrąglonym
  brzegiem i cieniem pod zakładką), deski i bale (okrągły przekrój; naroża chat gładkie, bez czół bali)
  rysuje shader materiału modeli (`MODEL_PATTERNS` w `client/render/scene.ts`) z UV zapisanego w Blenderze
  (`surface_pattern` w `art/scripts/lib.py`: numer wzoru × 1000 + położenie poziome, wysokość albo odległość od
  okapu); z daleka wzór gaśnie do średniej, bez migotania. Kamienie na bielonych i kamiennych ścianach, wieżach i
  młynie oraz obręcze beczek są malowane kolorem na płaskich ścianach brył (`Model.block`, `paint`). Zamiast
  doklejanych listewek i kostek: płaskie ściany, sfazowane naroża, okrągłe kalenice, gęstsze okrągłe bryły
  (10-16 segmentów); normalne z ostrymi krawędziami powyżej 40° (`SMOOTH_ANGLE`), materiał bez `flatShading`.
  Podglądy i ikony z Blendera (Workbench) nie pokazują wzorów z shadera. Budżety trójkątów bez zmian
  (800/1200/2000), modele lżejsze niż wcześniej; wydajność 31,8 FPS przy CPU ×4.
- **Praca tartaku widoczna**: przed tartakiem stoi kozioł; gdy trwa cykl produkcji, na koźle leży kłoda,
  a za nim tracz rytmicznie piłuje (`SAW_HORSE` w `client/render/entities.ts`; w symulacji tracz jest w budynku).
- **Drogi przycięte do trójkątów terenu**: każdy kawałek wstęgi leży w płaszczyźnie jednego trójkąta terenu,
  więc teren nie przebija drogi na grzbietach i szczytach (`EDGE_FAMILIES` w `client/render/roads.ts`).
- **Drwal jak w pierwowzorze**: siekiera tkwi w pieńku przed chatą; drwal bierze ją, gdy po wyjściu z chaty
  stanie na fladze, i odkłada do pieńka w chwili, gdy kładzie pień na flagę (model `woodcutter_axe`). Po ścięciu
  niesie drzewo z gałęziami na prawym ramieniu (`felled_trunk` + `felled_branches`), kładzie je na pieńku,
  okrzesuje siekierą (znikają tylko gałęzie, pień ma tę samą grubość) i niesie pień na ramieniu na flagę.
  W symulacji etap `WS.LIMBING` (`LIMB_TICKS` = 24 ticki), o tyle krótsze jest ścinanie - wydajność drwala
  bez zmian; 20/20 partii botów kończy się zwycięstwem.
- **Pokrycie dachu wg ścian**: na ścianach z drewna (bale, deski) papa - ciemne pasy z zakładem i listwy
  dociskowe w dół połaci (wzór `TARPAPER` w shaderze), na murowanych dachówka. Budynki mieszane mają
  niższą drewnianą przybudówkę pod papą obok murowanej części pod dachówką (rzeźnia, zbrojownia).
  Wydajności nie mierzymy na tej maszynie (równolegle renderuje inny projekt - wyniki niemiarodajne).
- **Postacie gładkie, wg portretów zawodów pierwowzoru** (siedlercommunity.de/die-siedler/berufe/): kształty
  organiczne zamiast kostek i walców - tunika z paskiem jako bryła obrotowa z profilu (dół, pas, pierś, szerokie
  barki, szyja domknięta pod głową), ręce do połowy schowane w barkach tuniki (rękaw w kolorze tuniki, niżej gołe
  przedramię z dłonią), nogi w spodniach, obłe kalosze z płaską podeszwą, okrągła głowa z małym nosem
  w kolorze skóry i tyłem we włosach, fryzury od czubka do karku, miękkie czapki jako półkule; cieniowanie gładkie
  (próg 75°, `SMOOTH` w `art/scripts/units.py`). Kolor gracza ma tylko tunika (tułów i rękawy): ściany skóry
  i paska mają wzór `PLAIN`, dla którego shader cofa barwienie instancji. Oczy (białka ze źrenicami), brwi tuż
  nad oczami, usta nad podbródkiem i rumieńce rysuje shader (wzór `FACE`, `face_pattern` w `lib.py`); z daleka
  zostają ciemne plamki oczu.
  Nakrycia głowy wg portretów: tragarz i narzędziowiec - brązowe włosy, rolnik i świniarz - rude włosy z wąsem,
  drwal - czerwona czapka i ruda broda, rybak i szkutnik - błękitna czapka, tracz - czarny kapelusz z wąsem,
  kamieniarz - różowa chusta, kowal - łysy z włosami po bokach, rzeźnik - biała czapka w pas, hutnik - biała
  maska z wizjerem, górnik - szary hełm z lampką, młynarz - siwy wąs, rycerz - srebrny hełm z pióropuszem.
  **Budżet postaci podniesiony z 300 do 400 trójkątów** (`UNIT_BUDGET` w `tests/art/models.test.ts`): gładkie,
  organiczne kształty nie mieszczą się w 300; osadnik z najcięższą czapką i narzędziem ma 399, rycerz 399.
- **Tempo i przybliżenie**: przy tempie 1× symulacja liczy 5 ticków na sekundę (`TICKS_PER_SECOND` w `sim/defs.ts`,
  `TICK_MS` = 200 ms) - gra była dwa razy za szybka; reguły w tickach bez zmian, zegar i statystyki liczą czas
  wg tej stałej. Przyciski tempa: pauza, 1×, 2×, 4×, 8×. Maksymalne przybliżenie kamery 24× (było 10×).

## 2026-10-08 — Sceny pracy zawodów (uwaga właściciela)
- **Każdy zawód ma krótką, czytelną sekwencję pracy** (jak drwal okrzesujący drzewo na pieńku). Sceny tylko rysują:
  etap i postęp biorą ze stanu symulacji (podstan osadnika, timer, faza i timer budynku) i z czasu animacji.
  Pracownicy warsztatów są w symulacji w środku budynku - scena rysuje ich „wirtualnie” przed budynkiem w trakcie
  cyklu (`b.phase != 0`), gdy prawdziwy pracownik nie wynosi akurat towaru na flagę.
- **Szkielet postaci z pełną pozą** (`client/render/rig.ts`, `Pose`): pochylenie i przechył tułowia, skręt tułowia
  względem nóg, przysiad (wykrok z oboma stopami na ziemi), ręce w trzech osiach (wymach, odwiedzenie, obrót
  w barku), pochylenie i skręt głowy, narzędzie w prawej i przedmiot w lewej ręce. `figure()` zwraca macierze stawów,
  do których sceny przyczepiają rekwizyty (worek w dłoni, łuk, zwierzyna na karku).
- **Sceny w osobnych plikach** (`client/render/work/`: `wood.ts`, `field.ts`, `crafts.ts`, `industry.ts`,
  `people.ts`), rejestr w `index.ts` (każdy zawód i budynek ma jednego właściciela - powtórzenie to błąd przy starcie).
  API scen (`WorkCtx` w `types.ts`): rekwizyty z puli warstw tworzonych przy pierwszym użyciu (`client/render/props.ts`,
  pusta warstwa nie kosztuje wywołania rysowania), układ modelu budynku (`at`, `frameOf`), miejsce pracy od strony
  kamery (`beside` - pracownik przy drzewie czy skale nie chowa się za nim), rytm uderzeń (`beat`, `strike`),
  ukrywanie statycznego obiektu mapy na czas sceny (`hideObject` - np. padające drzewo, koszone zboże).
- **Cząsteczki bez stanu** (`client/render/fx.ts`): pozycja każdej cząstki liczona z czasu i ziarna, więc nic nie trzeba
  pamiętać ani sprzątać; ciągły wypływ (`stream`, `smoke`) i jednorazowy wyrzut w chwili uderzenia (`burst`).
  Dwa białe modele (`fx_puff`, `fx_bit`, `art/scripts/props.py`) barwione kolorem instancji.
- **Czas animacji płynie z tempem gry i stoi przy pauzie** (wcześniej postacie machały rękami także w pauzie);
  kamera zawsze w czasie rzeczywistym.
- **Etapy przy chacie w symulacji** (`sim/production.ts`, `WS`), każdy kosztem innego etapu tego samego zawodu,
  więc wydajność się nie zmienia: leśnik bierze sadzonkę z grządki (`PREP`, 14 ticków; o tyle krótsze sadzenie),
  kamieniarz ociosuje blok na kostkę (`DRESS`, 24; o tyle krótsze łupanie), myśliwy strzela z odległości 2 pól,
  podchodzi po zdobycz (`FETCH`) i wiesza ją na stojaku (`HANG`, 14; o tyle krótszy odpoczynek w chacie).
  Upolowane zwierzę leży (`Animal.dead`), aż myśliwy je zabierze; bez myśliwego znika. `SIM_VERSION` = 2
  (zapisy z wersji 1 nie wczytują się). Test: `tests/sim/workstages.test.ts`.
- **Bot trzyma rezerwę tygla** (`adjustSettings` w `ai/bot.ts`): bez tygla w magazynach kuźnia narzędzi robi go
  najpierw. Zakleszczenie istniało wcześniej - wróg spalił jedyną hutę razem z hutnikiem, a tygla nie da się zrobić
  bez stali; zmiana czasu etapów skierowała jedną z 20 partii testowych (BOT15) na tę ścieżkę i partia nie
  kończyła się w limicie. Z rezerwą 20/20 partii kończy się zwycięzcą, trudny bot wygrywa 15/20.
- **Tryb pokazowy `?demo=1`** (`client/game/demo.ts`): mała dolina z jeziorem, skałami, lasem ze zwierzyną i górami
  ze złożami, wszystkie budynki gotowe, z pracownikami i zapasami, dojrzałe zboże, place budowy na nierównym terenie
  (kopacz, budowniczy), reżyser wysyła geologa i atakuje sąsiada za frontem (pojedynki, katapulta). Panel
  „Pokaz zawodów” (`client/ui/demoTour.ts`) przenosi kamerę do wybranego zawodu (pracownika w terenie śledzi)
  i ma automatyczną wycieczkę. Klatki animacji bez okna: `node scripts/capture.ts`, arkusz: `scripts/sheet.py`.
- **Sceny zawodów** (szczegóły w nagłówkach plików `client/render/work/*.ts`):
  - teren (`field.ts`): leśnik klęka przy grządce i wyjmuje sadzonkę (grządka się przerzedza i odrasta), kopie
    dołek trzema sztychami, sadzi i udeptuje; kamieniarz łupie skałę kilofem (odpryski), ostatnim uderzeniem
    odłamuje blok, niesie go na ramieniu i ociosuje na stole na kostkę; rybak zarzuca wędkę, spławik drga, ryba
    szamocze się na żyłce i ląduje w koszu, przy chacie schnie sieć i ryby; myśliwy skrada się, klęka, naciąga łuk,
    strzała trafia jelenia, który pada, niesie go na karku i wiesza na stojaku; rolnik kosi rząd za rzędem (zostaje
    ściernisko), wiąże snop, a przy siewie rozrzuca ziarno z worka; jelenie chodzą, pasą się i czujnie podnoszą łeb;
  - drewno (`wood.ts`): drwal rąbie z boku, drzewo pada, okrzesuje je na pieńku; tracz piłuje i odnosi deskę na stos;
  - żywność (`crafts.ts`): młynarz wnosi worek zboża i wytrzepuje worek z mąki, skrzydła rozpędzają się i zwalniają;
    piekarz wałkuje ciasto, wsuwa chleb do pieca (ogień w otworze), wykłada bochenki na stół; rzeźnik rąbie tuszę
    na pniu; hodowca świń sypie paszę do koryta i świnie podbiegają; hodowca osłów oprowadza oślicę z oślątkiem;
    studniarz kręci korbą, wiadro wyjeżdża i woda leje się do beczki; piwowar wsypuje słód i miesza w kotle;
    pracownicy wynoszą wyroby po swojemu (worek na ramieniu, kosz chleba, wiadro, toczona beczka);
  - metal i drewno (`industry.ts`): koło na wieży szybowej kręci się, górnik wypycha wózek po szynach i wysypuje
    urobek na kupkę; hutnik wyjmuje tygiel z pieca i przelewa żelazo do formy; kowale grzeją, kują (iskry) i hartują
    w beczce (para), kuźnia narzędzi pokazuje robione narzędzie; mincerz wybija monety na kowadełku; szkutnik
    przybija deski, łódź rośnie deska po desce; smolarz obchodzi mielerz z łopatą, dym gęstnieje;
  - pozostali (`people.ts`): tragarze schylają się po towar i podają go sobie przy fladze, bezczynni przestępują
    z nogi na nogę i siadają; osły kłusują i skubią trawę; przewoźnik wiosłuje; budowniczy nosi deski i kamienie
    i przybija/muruje; kopacz rzuca ziemię za siebie (rosną kopczyki); geolog stuka w skałę, przykłada ucho,
    wbija znak; rycerze na warcie, pojedynki z tarczą i ciosami, pokonany pada, zwycięzca unosi miecz;
    katapulta wyrzuca kamień łukiem, katapulciarz nakręca ramię kołem zapadkowym i ładuje kamień.
  Statyczne elementy modeli, które teraz są animowane, zniknęły z modeli budynków (świnie, osioł, kołowrót studni,
  łódź w stoczni, dym mielerza, ramię katapulty, skrzydła młyna - teraz `crf_sails`); rekwizyty scen w
  `art/scripts/props_*.py` (prefiksy `fld_`, `crf_`, `ind_`, `ppl_`), każdy w budżecie 300 trójkątów.

## 2026-10-09 — Teren i natura, podwórka budynków na stoku (uwaga właściciela)
- **Teren malowany w shaderze** (`client/render/terrain.ts`): każdy wierzchołek niesie wagi rodzajów terenu
  (trawa, piasek, skała, śnieg; reszta to woda), a shader rozstrzyga w każdym pikselu, który rodzaj wygrywa -
  z szumem granic w dwóch skalach, więc przejścia są wąskie i poszarpane jak malowane, a nie rozmyte na całe pole.
  Faktury z jednej generowanej w kodzie tekstury 256×256 (kanały: trawa z kępami i źdźbłami, skała z głazów
  i szczelin - komórki Worleya, piasek ze zmarszczkami, szum granic); skała oświetlona od słońca (spadek wysokości
  z tekstury ku słońcu), na urwiskach mapowana pionowo; śnieg zsuwa się ze stromizn na skałę, na stromej łące
  prześwituje ziemia; woda jaśnieje na płyciźnie, przy brzegu biała piana; plaża węższa (pole przy wodzie
  w 60% piasek). Koszt: 4-5 odczytów tekstury na piksel terenu, liczba wywołań rysowania bez zmian.
- **Natura** (`art/scripts/nature.py`): gładkie bryły, kolor malowany w wierzchołkach (ciemny dół, jasna góra)
  i nowe wzory w shaderze modeli (`MODEL_PATTERNS`, numery 7-12): nieregularne kępy liści i gałęzi igliwia
  (komórki wokół losowych punktów, każda oświetlona od góry), kora, skała ze spękaniami, źdźbła, kłosy.
  Odmiany: świerk i sosna (`tree_pine`, `tree_pine2`), drzewo liściaste i brzoza (`tree_leaf`, `tree_leaf2`),
  dwie skały (`stone`, `stone2`) - korony i głazy z kilku zlepionych elipsoid, ściany schowane w sąsiedniej bryle
  są usuwane (budżet). Pole zboża: sześć grzbietów kłosów (trzy rzędy po dwa - żniwa w `field.ts` nadal koszą
  trzy rzędy), rekwizyty żniw (`fld_wheat_row`, `fld_stubble`, `fld_soil`) z tych samych funkcji. Znak geologa
  pokazuje kolorem symbolu znalezione złoże (węgiel, żelazo, złoto, kamień, nic). Budżety bez zmian: drzewa
  132-142/150 trójkątów, reszta ≤ 300 (pole 188, skały 178-184).
- **Rozmieszczenie** (`client/render/mapObjects.ts`): odmiana modelu i odcień instancji (jasność, ciepło) wg
  pola, drzewa różnej wysokości (`treeLook` zwraca `sy` i odcień - drwal rysuje padające drzewo tak samo).
  Sadzonki rosną płynnie do wielkości tego samego drzewa (bez skoku przy dojrzeniu), zboże rośnie płynnie i pod
  koniec przechodzi z zieleni w złoto - wzrost liczony z licznika przeglądu mapy (`objTimer` i położenie
  `sweep`, `sim/mapsweep.ts`), chunki z rosnącymi obiektami przeliczane co 5 ticków. Trzy nowe modele to trzy
  warstwy instancji więcej (+3 wywołania rysowania, gdy wszystkie są w kadrze; puste warstwy nic nie kosztują).
- **Podwórka budynków na stoku - bez zmian w symulacji.** Model budynku stał na wysokości swojego pola, a sprzęty
  0,5-0,8 pola dalej tonęły w zboczu albo wisiały. Rozwiązanie w renderze:
  - Blender dzieli części modelu budynku na konstrukcję (stoi na ziemi i jest wysoka albo rozległa) i podwórko
    (zaczyna się nisko poza konstrukcją) i zapisuje w drugiej i trzeciej warstwie UV wagę podwórka (rośnie
    z odległością od obrysu konstrukcji, 0 przy ścianie) oraz punkt, w którym brać wysokość terenu - zwarty sprzęt
    (pieniek, beczka, stos desek) przesuwa się w całości wg środka, długi (żerdź płotu, tor) kładzie się na
    stoku wierzchołek po wierzchołku (`Model.yard` w `art/scripts/lib.py`, obrys w `art/models/yards.json`).
  - Shader modeli czyta wysokości pól z tekstury (ten sam rachunek co `groundHeight`, test w
    `tests/unit/render.test.ts`) i przesuwa wierzchołki podwórka ku terenowi; spód konstrukcji wydłuża się w dół
    do niższego terenu i jest malowany jako kamienna podmurówka, więc budynek nie wisi.
  - Budynek stoi na najwyższym punkcie terenu pod obrysem, ale najwyżej pół jednostki wysokości ponad swoim
    polem (`MAX_LIFT`) - na łagodnym stoku nie tonie, przy urwisku wbija się w zbocze zamiast stać na wysokiej
    podmurówce (z samym maksimum chata rybaka przy urwisku stała na murze wysokości piętra).
  - Sceny pracy biorą tę samą wysokość: `WorkCtx.at` i nowe `WorkCtx.floor` (`client/render/yard.ts`);
    postacie i rekwizyty przed budynkiem (pieniek drwala z siekierą, kozioł i stos desek tartaku, tory kopalni,
    kowadło, mennica, szkutnik) stoją na tym samym podłożu co model.
  - Sprawdzone w pokazie z terenem sztucznie przechylonym wokół każdego budynku: płoty chlewni i hodowli osłów
    oraz beczka studni wcześniej całkiem znikały w zboczu, teraz stoją na terenie. Na bardzo stromym stoku długie
    sterty (bale przy tartaku) mocno się przechylają - w grze domy i duże budynki stoją na wyrównanym terenie
    (pole i 6 sąsiadów), więc dotyczy to praktycznie tylko chat i kopalń.
- **Warianty zmiany symulacji (do decyzji właściciela, niewdrożone):** (1) wyrównywanie kopaczem także pod chatami
  (pole budynku i 6 sąsiadów, jak pod domami) - dłuższa budowa chat, wolniejszy start botów, `SIM_VERSION` 3;
  kopalnie bez wyrównywania (zmieniałoby góry); (2) wyrównanie pod chatą tylko pola budynku i flagi - mniejsza
  zmiana terenu i tempa; (3) powrót limitu różnicy wysokości przy stawianiu chat - sprzeczne z przyjętymi zasadami
  pierwowzoru. Po zmianach w renderze żaden nie jest potrzebny.

## 2026-10-09 — Teren, drogi, drzewa i pola jako jeden obraz (uwaga właściciela)
Uwaga: trawa, ścieżki i drzewa za mocno się od siebie różnią, nie są ze sobą zintegrowane. Przyczyny: każda warstwa
miała własną paletę (jaskrawa limonkowa trawa, ciemnoturkusowe świerki, pomarańczowe drogi), obiekty nie
zostawiały na ziemi żadnego śladu (cienia, ściółki, wydeptania), drogi były osobną wstęgą o ostrych brzegach,
a pola - płytami z pionowymi bokami.
- **Stan pól w teksturze** (`client/render/cells.ts`): tekstura RGBA8 rozmiaru mapy - drzewo, inna bryła rzucająca
  cień (budynek, skała), bity dróg (`map.roads` z symulacji), flaga, pole zboża, wydeptana ziemia. Przeliczana po
  tickach, wysyłana tylko po zmianie. Shader terenu bierze trójkąt siatki pod pikselem (ten sam podział co
  `groundHeight`) i interpoluje wartości jego trzech pól, a z szumem granic robi z nich malowane plamy.
  Bez nowych wywołań rysowania; koszt to 6 odczytów tekstury stanu i do 18 odległości od odcinków dróg na piksel
  terenu.
- **Ziemia pod obiektami**: ściółka lasu (ciemna, z rudymi plamami) pod drzewami i między nimi, łąka przy lesie
  ciemniejsza; cień drzew i budynków na terenie - stan pola przesunięty od słońca (cień pada w tę samą stronę co
  oświetlenie modeli) - i ciemniejsza plama tuż przy pniu i ścianie; wydeptana ziemia przy budynkach, placach
  budowy i flagach w kolorze podłoża (na piasku ciemniejszy piasek, na skale żwir).
- **Drogi w shaderze terenu** zamiast osobnej siatki (`client/render/roads.ts` usunięty): odległość od odcinków
  drogi wychodzących z wierzchołków trójkąta, postrzępiony brzeg, dwie koleiny, przydeptana trawa przy brzegu;
  szerokość jak dotąd. Droga zawsze leży dokładnie na terenie (bez przycinania wstęgi do trójkątów).
- **Wspólna paleta**: trawa przygaszona (z dużymi łatami i przesuszeniem na wzgórzach i przy plażach), korony
  drzew z tej samej rodziny zieleni, światło odbite od ziemi zielonkawe (spody koron i okapy łapią kolor łąki).
  Kwiaty jako rzadkie plamki w łatach łąki (z daleka gasną).
- **Pola**: ziemię z bruzdami rysuje teren, model ma samo zboże - niższe grzbiety o falującej wysokości,
  stonowane kolory. Rozstaw grzbietów 0,125 mieści się 4 razy w pół pola, więc bruzdy sąsiednich pól leżą na
  jednej siatce (bez szwów). Siew i ściernisko oznaczają pole jako zaorane na czas klatki (`WorkCtx.plowCell`) -
  rekwizyt `fld_soil` usunięty, ziemia przy pracy rolnika wygląda tak samo jak pod polem.
- **Ozdoby łąki** (`tuft` 27 trójkątów, `bush` 72): kępy trawy w kolorze trawy pod nimi, wokół drzew i skał,
  częściej na skraju lasu (tam też krzaki); bez ozdób na drogach, przy wodzie i obok flag i budynków. Dwie warstwy
  instancji (+2 wywołania rysowania, gdy są w kadrze). Ozdoby nie należą do obiektu pola - sceny pracy ukrywające
  drzewo czy zboże ich nie chowają; znikają z pola zaoranego przez scenę.
- Symulacja bez zmian (`SIM_VERSION` bez zmian, boty 20/20).

## 2026-10-09 — Plaża, góry, śnieg i woda jako część tego samego obrazu (uwaga właściciela)
Uwaga: to samo, co z trawą, drogami i drzewami, trzeba zrobić z plażą, górami, śniegiem i wodą. Przyczyny:
granice rodzajów terenu szły schodkami po trójkątach siatki (wagi rodzajów w wierzchołkach), skała miała
regularną siatkę spękań jak wyschnięte błoto i pionowe smugi na urwiskach, śnieg - szare linie jak kafelki,
piasek był płaskim beżem bez wydm i mokrego brzegu, a woda - płaską, nieruchomą plamą.
- **Rodzaje terenu w teksturze** (`kindMap` w `client/render/terrain.ts`, zamiast atrybutu wierzchołków): shader
  czyta wagi w punkcie przesuniętym szumem (do ~0,2 pola), więc granice trawa/piasek/skała/śnieg/woda falują
  niezależnie od siatki. Rodzaje pól się nie zmieniają (wyrównanie zmienia tylko wysokość) - tekstura statyczna.
- **Skała**: faktura z garbatego szumu i pól drobnych głazów (bez siatki spękań), rzutowana z trzech stron wg
  normalnej (bez rozciągnięć na urwiskach), ciemniejsza paleta, ciepły albo chłodny odcień w dużych łatach,
  warstwy na urwiskach, mech i górska trawa na płaskich półkach, piarg przy łące. Filtrowanie anizotropowe
  faktury terenu (stoki widziane pod ostrym kątem bez niego rozmazują się w smugi).
- **Śnieg**: miękkie zaspy (relief z szumu), stoki odwrócone od słońca niebieskawe, bez faktury skały.
- **Piasek**: wydmy, łaty cieplejszego piasku, mokry, ciemniejszy pas przy wodzie, rzadkie kamyki.
- **Woda**: dwie warstwy fal płynące w czasie (`uTime`, czas rzeczywisty - także przy pauzie) i błyski, na
  płyciźnie prześwituje piaszczyste dno, piana przy brzegu faluje (z daleka słabsza); kolor płycizny i otwartej
  wody bliżej zieleni lądu.
- **Ozdoby** w istniejących warstwach (bez nowych wywołań rysowania): trzcina na brzegu (wydłużona kępa trawy) od
  strony wody, suche kępy na pustyni przy łące i rzadko w głębi, drobne kamienie w górach (więcej przy łące) z kępami
  górskiej trawy, kamyki na pustyni.
- Koszt: na piksel terenu 3 odczyty rodzajów, 2 szumu przesunięcia, 2 rzuty skały z boku, 2 fale; bez nowych
  wywołań rysowania. Symulacja bez zmian.

## 2026-10-09 — Niższe fundamenty, nasyp pod drewnianymi budynkami (uwaga właściciela)
Uwaga: fundamenty bywają bardzo wysokie; może drewniane powinny stać na górce z ziemi, a kamienne mieć schody.
Przyczyna: budynek stał na najwyższym punkcie terenu pod obrysem, a od dołu ściana schodziła pionowo do terenu
kamienną podmurówką (na stoku przy plaży - jak pół ściany).
- **Poziom budynku = średnia wysokość terenu pod obrysem** (dalej najwyżej `MAX_LIFT` nad polem, `originOf`
  w `client/render/entities.ts`): na stoku górna strona wchodzi w zbocze, od dołu odsłania się mniej muru.
- **Nasyp pod drewnianymi budynkami**: Blender oznacza spód konstrukcji, nad którą stoją ściany z desek albo bali
  (także modelowany cokół takiej ściany), jako nasyp (`BASE_BERM` w `art/scripts/lib.py`), murowane i kamienne -
  podmurówka (`BASE_STONE`). Na każdej części konstrukcji jest pierścień wierzchołków 1,2 cm nad ziemią, na którym
  skarpa się zgina (ściana nad nim zostaje pionowa; ~10-40 trójkątów na budynek). Shader modeli (`YARD_NORMAL`
  w `client/render/scene.ts`) zsuwa spód do terenu i rozchyla go na zewnątrz 1,3 raza tyle, ile zszedł (skarpa
  ~40°), wysokość terenu bierze w odsuniętym punkcie, przechyla normalną (skarpa oświetlona jak stok) i maluje ją
  kolorem wydeptanej ziemi wokół budynku z plamami trawy. Bez nowych modeli i wywołań rysowania.
- Chata rybaka: kamienna platforma w modelu niższa (8 → 5 cm) - była dwa razy wyższa niż cokoły innych chat.
- Schody przy drzwiach budynków kamiennych - odłożone (wymagają położenia drzwi zapisanego w modelach).

## 2026-10-09 — Wspólna podmurówka, schody i ścieżka do drzwi, limit stoku pod chatą, woda na swoim poziomie (uwagi właściciela)
- **Nasyp pod drewnianymi budynkami wycofany** (poprzednia sekcja): wszystkie budynki mają z powrotem jednolitą
  szarą podmurówkę, bez skośnej ziemi po bokach. Zostaje poziom budynku ze średniej wysokości terenu pod obrysem.
- **Schody przed drzwiami, gdy są potrzebne.** Blender zapisuje główne drzwi każdego budynku (środek progu na
  przedniej ścianie, wysokość progu, szerokość) w `art/models/yards.json` (`door()` i `double_door()`
  w `art/scripts/buildings.py`, bramy zamku i warowni, otwory tartaku i narzędziowni dopisane ręcznie; studnia
  i otwarta szopa stoczni bez drzwi). Budynek nie stoi niżej niż teren tuż przed drzwiami (wejście nie bywa
  zakopane). Gdy stoi wyżej, przed drzwiami powstają stopnie (wysokość ~0,035, głębokość 0,045, najwyżej 10)
  od progu do terenu, każdy sięga do terenu pod sobą - model `stair_step` (`art/scripts/props.py`), jedna
  warstwa instancji (+1 wywołanie rysowania, gdy schody są w kadrze). Na płaskim terenie wystarcza próg modelu.
- **Ścieżka od flagi pod same drzwi** (albo pod schody): druga tekstura stanu pól (`paths` w
  `client/render/cells.ts`) z odcinkiem od flagi do podnóża wejścia na polu flagi i na polu budynku; shader terenu
  rysuje go jak drogę.
- **Limit stoku pod chatą (zmiana symulacji, `SIM_VERSION` 3):** chata tylko tam, gdzie żaden z 6 sąsiadów nie
  różni się wysokością od jej pola o więcej niż 1 (`HUT_HEIGHT_STEP` w `sim/world.ts`). Odstępstwo od
  pierwowzoru na prośbę właściciela - chata nie ma kopacza, więc na stromym stoku stała na wysokiej podmurówce
  ze schodami. Kopalnie bez limitu (z natury stoją w zboczu). Boty: 20/20 partii kończy się zwycięstwem.
- **Woda tylko na poziomie swojego lustra:** shader terenu przygasza wodę, gdzie teren wznosi się nad poziom
  najbliższej wody (atrybut wierzchołków `wlevel` - poziom wody pola albo najniższej wody w promieniu 2 pól),
  z szumem, żeby brzeg nie szedł prosto po trójkątach; w głąb wody szum wcina się tylko przy brzegu. Poziom
  liczony per woda, więc jezioro może leżeć wyżej niż morze; generator map stawia dziś każdą wodę na tej samej
  wysokości (`SEA_HEIGHT`) - jeziora położone wyżej wymagałyby zmiany w `sim/mapgen.ts`.

## 2026-10-09 — Łagodne wzniesienie przy zamku, niższa kamera, krzywizna świata (uwagi właściciela)
- **Masyw górski przy starcie** (`prepareStart` w `sim/mapgen.ts`, gdy w pobliżu zamku brak gór): był blokiem na
  wysokości co najmniej 17 na niskiej łące - urwisko, na którego krawędzi boty stawiały kopalnie. Teraz to łagodne
  wzniesienie piętrami od wysokości środka (+3, +2, +1). Próba globalnego łagodzenia gór (niższe góry, spadek
  najwyżej 1 na całej mapie) wycofana - „za łagodnie”, właściciel chciał poprawić tylko to jedno miejsce.
- **Kopalnie bez limitu stoku**: limit 1 (jak chaty), 2, 3 i 5 sprawdzone - w górach sąsiednie pola różnią się
  zwykle o 2-3 i boty nie znajdowały miejsc na kopalnie (partie bez zwycięzcy) albo zmieniał się wynik partii.
- **Wzniesienie z kopalniami powiększone** do promienia 3 (37 pól; +3 w środku i pierwszym pierścieniu, dalej +2, +1).
- **Równowaga botów (otwarte):** trudny bot wygrywa z łatwym mniej więcej połowę partii - po zmianach terenu przy
  zamku 8, 10 albo 9 z 20 (promień wzniesienia 2, 3, 4; test wymaga ponad 10). Wszystkie partie kończą się
  zwycięzcą. Korekty bota (próg ataku 1,35, 5 rycerzy w zamku) nie pomogły - zmiany terenu przestawiają wyniki
  losowo; potrzebne wzmocnienie trudnego bota (osobne zadanie).
- **Kamera**: pochylenie od 10° nad horyzontem (było od 22°).
- **Krzywizna świata** (`client/render/curve.ts`): w shaderach terenu i modeli każdy punkt opada o d² / (2R),
  R = 90 pól, d - odległość od środka widoku; wybieranie pola uwzględnia to samo opadanie. Morze wokół mapy to
  siatka z krzywizną podążająca za widokiem (`client/render/ocean.ts`, materiał bez oświetlenia, mgiełka przy
  horyzoncie), w tle niebo - przy kamerze z góry morze zakrywa ekran jak dawniej kolor tła.

## 2026-10-09 — Mapa świata botów, plac budowy na stoku, porządek przy drwalu i tartaku (uwagi właściciela)
- **Ręczne poprawki mapy DOLINA/64** (`MAP_TWEAKS` w `sim/mapgen.ts`): wzniesienie z kopalniami przy niebieskim
  zamku przesunięte o pole w prawo i rząd do przodu, jezioro nad nim o 2 rzędy do przodu (odsłonięta woda staje
  się niską łąką). Inne mapy, w tym partie botów w testach, bez zmian.
- **Ziemia placu budowy kładzie się na terenie**: gęsta siatka (7×7) zamiast płaskiej płyty, każdy wierzchołek
  na wysokości terenu pod nim (`Model.draped` w `art/scripts/lib.py`) - płyta na wysokości budynku chowała się
  w trawie po stronie zbocza.
- **Drwal**: kłody leżą wzdłuż lewej ściany chaty (jak przy tartaku), pieniek do okrzesywania (z siekierą) z prawej,
  bliżej drzwi niż dotąd (`CHOP_BLOCK` w `client/render/work/wood.ts`; drwal stoi przy nim od zewnątrz).
- **Leśnik**: grządka sadzonek bliżej drzwi (`SEEDBED` w `client/render/work/field.ts`).
- **Dobudówki z dachem jednospadowym** (tartak, rybak; `lean_to` w `art/scripts/buildings.py`): wierzch ścian
  opada razem z dachem - wcześniej ściany kończyły się na stałej wysokości i pod dachem była szpara.
- **Plac budowy bez kozła** z przodu po lewej - w tym miejscu po budowie stoi zwykle stanowisko pracy zawodu.
- **Stanowiska pracy w stałym miejscu (do zrobienia):** właściciel chce je blisko drzwi, po ich lewej stronie.
  Właściciel zrezygnował - stanowiska zostają na swoich miejscach.

## 2026-10-09 — Świnki, tragarze, kłody na stoku, drogi przez drzewa, zamek (uwagi właściciela)
- **Świnki** (`client/render/work/crafts.ts`, model `crf_pig` + osobna głowa `crf_pig_head`): między karmieniami
  każda chodzi po swoim pasie wybiegu i robi coś innego - ryje ryjem, rozgląda się i węszy, tapla się w błotnych
  kałużach (leży na boku i tarza się), ociera się o płot. Poza marszem stoją (bez przestępowania w miejscu - było
  „krok w przód, krok w tył”). Do koryta biegną z miejsca, w którym są; po jedzeniu wracają na wybieg. Głowa
  pochyla się sama (jedzenie, rycie), tułów zostaje poziomo. Plan zachowań liczony z czasu (bez stanu).
- **Tragarze niosą towar wg ciężaru** (`carryStyle` w `client/render/rig.ts`): na głowie lekkie, na prawym ramieniu
  pnie i deski (druga ręka macha do kroku), oburącz przed sobą ciężkie (kamień, rudy, węgiel, stal, beczka, świnia;
  tułów odchylony), wiadro z wodą w ręce u boku. Pod górę pochylają się do przodu, z góry odchylają. Bez pracy
  co kilka sekund inna drobna czynność: drapanie się w głowę, przeciąganie z ziewnięciem, wypatrywanie z dłonią przy
  czole, ręce za plecami, przytupywanie.
- **Kłody na stoku nie spłaszczają się**: długa część podwórka (bal, żerdź płotu) idzie za terenem tylko wzdłuż
  swojej osi (punkt na osi części), więc jej przekrój zostaje okrągły (`Model.yard` w `art/scripts/lib.py`).
- **Zamek**: bez skalnego kopczyka pod murami (jego ukośne ścianki wydłużone do terenu dawały ciemne trójkąty),
  pod murami zwykły cokół.
- **Drogi przez drzewa (zmiana symulacji, `SIM_VERSION` 4)**: droga gracza może przejść przez pole z drzewem
  (także sadzonką i pieńkiem, `isRoadPassable` w `sim/world.ts`); drzewo zostaje, a droga omija je w grze łagodnym
  łukiem - środek drogi na tym polu przesunięty w poprzek od pnia (`client/render/roadBend.ts`; teren rysuje łuk,
  postacie chodzą po nim). Flagi na takim polu postawić się nie da. Boty dalej prowadzą drogi po wolnych polach
  (`findRoadPath(..., throughTrees = false)`): z drogami przez las 3 z 20 partii kończyły się bez zwycięzcy (długich
  dróg przez las nie da się dzielić flagami). Partie botów: 20/20 ze zwycięzcą, trudny 10/20 (bez zmian).
- **Drogi omijają też budynki**: gdy model budynku w promieniu 2 pól (zamek z basztami sięga dalej niż sąsiednie
  pole) wystaje nad drogę, środek drogi na tym polu
  odsuwa się w poprzek drogi od obrysu budynku (prostokąty konstrukcji z `art/models/yards.json`) - najmniejsze
  przesunięcie, przy którym droga mija ścianę, najwyżej 0,3 pola. Tylko wygląd: przesunięcie liczy
  `client/render/roadBend.ts`, teren rysuje łuk (tekstura `bends`), postacie chodzą po nim (`EntitiesRenderer.wp`).
  Ustawienie modeli budynków przeniesione do `client/render/placement.ts` (wspólne z drogami).
- **Łokieć i dłonie**: ręka postaci z dwóch części - ramię z rękawem (kolor gracza, walec równej grubości)
  i przedramię z kulką łokcia i dłonią (walce zamiast zwężających się kul, które w łokciu były cienkie jak kreska)
  (`serf_upperarm`, `serf_forearm` w `art/scripts/units.py`), zgięcie w łokciu w pozie (`elbowL`, `elbowR`).
  Układ przedramienia jest dawnym układem ręki (dłoń w `(0, HAND, 0)`), więc narzędzia i rekwizyty scen idą za
  zgiętym przedramieniem bez zmian w scenach. Łokcie zginają się przy chodzie (mocniej przy wymachu do przodu),
  przy noszeniu towaru (na głowie, na ramieniu, oburącz) i w czynnościach bez pracy (drapanie się, daszek
  z dłoni). Ramię to obła bryła rękawa (dół chowa się w kulce łokcia), przedramię - okrągły walec (6 ścian);
  walce z mniejszą liczbą ścian wyglądały na kwadratowe, a otwarty walec ramienia miał przy wymachu dziurę.
  Dłoń jak rękawica bez palców: płaska, dłuższa niż szersza, z kciukiem z przodu.
  **Budżet postaci podniesiony z 400 do 460 trójkątów** (rycerz 459, osadnik z czapką i narzędziem ok. 405): kulka
  dłoni nie czytała się jako dłoń, a ręka z łokciem potrzebuje dwóch obłych brył; postacie rysują się instancjami
  (kilka warstw na wszystkie postacie), więc dodatkowe trójkąty nie dokładają wywołań rysowania.

## 2026-10-09 — Dźwięk z położeniem, praca zawodów, głosy i otoczenie (prośba właściciela, kroki 1–3 z docs/AUDIO.md)
- **Model odległości** (`Sound.place` w `client/audio.ts`): słuchacz w środku widoku, `r` = odległość źródła od
  środka w połowach szerokości widoku; głośność `Z(zoom) / (1 + (r / 0,45)²)`, cisza od `r > 1,3`; wyrazistość
  przez filtr dolnoprzepustowy (1,5 kHz z daleka do ok. 16 kHz z bliska) i udział pogłosu; panorama z wektora
  „w prawo” kamery. Kamera jest ortograficzna, więc „bliżej” to przybliżenie i środek ekranu, nie odległość 3D.
- **Wyzwalacze w scenach pracy**: cząsteczki uderzeń (`fx.burst`) i wypływy (`fx.stream`) mają pole `sound` -
  wyrzut gra dźwięk raz, wypływ trzyma pętlę, dopóki scena go rysuje. Tam, gdzie nie ma cząsteczek (piła, upadek
  drzewa, kowadło przy zimnym pręcie, skrzydła wiatraka, kołowrót, świnie, osioł, jeleń, cięciwa, tragarz),
  `c.sfx` z kluczem: wołane co klatkę, gra raz na zdarzenie (klucz zapamiętany na 0,25 s od ostatniego wołania).
  Dzięki temu dźwięk zgadza się z animacją co do klatki i nie wymaga stanu ani zmian w symulacji.
- **Limity**: 18 dźwięków naraz, 3 jednakowe, 10 pętli - dwudziestu drwali w kadrze to nie dwadzieścia uderzeń.
- **Głosy syntetyczne zamiast próbek** (na razie, wg właściciela): ton krtaniowy przez filtry formantowe
  z chrapliwością, oddechem i lekkim vibrato. Generatory głosów mają szeroką przestrzeń parametrów (wysokość,
  barwa, rytm, rodzaj zawołania); `scripts/sounds.ts` renderuje 100 ziaren każdego głosu, liczy cechy nagrania
  i wybiera 6 najbliższych wzorcowi prawdziwego odgłosu, możliwie różnych. Agent nie słyszy, więc ranking to tylko
  sito - o tym, co zostaje w grze, decyduje odsłuch właściciela; zatwierdzone ziarna wpisuje się do `PICKS`, a gra
  losuje spośród nich.
- **Otoczenie** wg kadru (`viewMix` w `client/render/scene.ts`, co 0,5 s, siatka 12 × 12 punktów widoku): udział
  drzew, wody, brzegu, gór, trawy i osadników ustawia głośność pętli wiatru, lasu, morza, jeziora i gwaru; ptaki
  i świerszcze losowane wg tych udziałów.
- **Wybór właściciela wpisany do `PICKS`** (odsłuch 2026-10-09): chrząkanie świni 9 i 13, ryk osła 27, jeleń 89,
  ptaki 52, 74 i 76, świerszcze 5, 60, 74 i 76, okrzyk 66 i 86, upadek rycerza 1 i 66, trzask pnia 1, upadek
  drzewa 1. Przy dźwiękach pracy z zaznaczonymi wszystkimi trzema wariantami gra losuje z całej przestrzeni
  (próbki były losowe, więc „wszystkie dobre” znaczy „generator dobry”). Kwik świni nie ma zaznaczenia, więc zostaje
  bez ograniczenia do decyzji właściciela. Procedurę opisuje README („Odsłuch dźwięków”), bo będzie powtarzana;
  strona odsłuchu pokazuje warianty już grające obok nowych.
- **Tło najniższym priorytetem** (uwaga właściciela: „za bardzo słychać morze i las”): las i morze są prawie
  w każdym kadrze, więc ich poziom spadł do ok. 40%, a całe tło przycisza się wraz z liczbą grających dźwięków
  świata i pętli (`duck` w `updateBeds`, najwyżej do 35%) - praca i zwierzęta zawsze wybijają się ponad tło.
- **Młotek budowniczego był niesłyszalny** (uwaga właściciela): w scenie budowniczego punkt deski (`wp`) i miejsce
  pracy dzieliły ten sam wektor roboczy, więc punkt uderzenia liczył się z już przeliczonych współrzędnych świata
  i wypadał ok. 80 pól dalej - poza kadrem (cisza, a wióry i odpryski rysowały się tam, gdzie nikt nie patrzy).
  Sprawdzone logiem: żaden dźwięk w pokazie zawodów ani przy budowie nie pada dalej niż kadr.
- **Rycerze szarpali w marszu** (uwaga właściciela: „teleport w przód i w tył”): krok rycerza zaczynał się od
  zapamiętanego położenia (żeby po pojedynku ruszał z boku pola, nie ze środka), ale pamięć odświeżała się co
  klatkę, także w marszu - każda klatka zaczynała krok od poprzedniej, rycerz wyrywał się do przodu, a po
  oddaleniu się o 0,3 pola od startu wracał skokiem na właściwy tor. Początek kroku ustalany jest teraz raz na krok
  (`stepCell`, `sx`, `sz` w `KnightMem`) i kasowany, gdy rycerz stoi. Pomiar w stałym kroku 60 klatek/s, 418 klatek
  marszu: przed 76 cofnięć i 8 skoków (do 0,25 pola), po 0 i 0, równy krok.
- **Kwik świni wybrany pomiarem** (właściciel: „sam wybierz najlepszy”): z 200 wariantów 173 mieściło się
  w luźnym wzorcu odsłuchu, więc ranking zawężony do profilu kwiku: 0,55-0,95 s, ton 1000-1500 Hz w środku
  i 900-1600 Hz na początku, bez skoków wysokości (stosunek do 2,2), barwa 1500-2800 Hz, głośny. Ze spektrogramów
  najlepszych ośmiu wybrane 55, 99 i 133 - wyraźny łuk tonu w górę i w dół, chropowatość widoczna jako
  „paciorki” na tonie podstawowym, najgłośniejsze. Wpis w `PICKS`; właściciel może je zmienić zwykłym odsłuchem.
- **Próg testu botów: trudny bot wygrywa co najmniej 10 z 20 partii** (decyzja właściciela: „więcej niż 9”).
  Wcześniej test wymagał ponad 10, a po zmianach terenu trudny bot wygrywał 8-10 z 20; wzmocnienie bota odłożone.

## 2026-10-09 — Serwer lobby na api.kwasnypp.ovh, panel budowy
- **Serwer lobby na maszynie właściciela zamiast DuckDNS + Caddy**: konfiguracja w repozytorium `pkwasny/vps01`
  (kroki: konto `osada`, Node.js z nodejs.org z przypiętą sumą, usługa `osada-signal` za nginx pod `/osada/`).
  Nie publiczny serwer PeerJS: ten nie ma pokoi ani limitów, identyfikator gracza jest tam adresem, a przekaźnik
  ma wspólne hasło. Na serwer trafia jeden plik `osada-signal.cjs` z wydania `signal-v*` (CI buduje go
  rolldownem razem z `ws`); serwer odrzuca plik o innej sumie SHA-256 niż wpisana w `vps01`.
- **Limit połączeń na adres liczony z `X-Real-IP` tylko za zaufanym proxy** (`TRUST_PROXY=1`): wcześniej serwer
  brał pierwszy wpis `X-Forwarded-For`, który klient może podać sam i tak obejść limit.
- **Bez przekaźnika TURN**: wymaga otwarcia portów UDP w konsoli Oracle, czego agent nie może zrobić (blokada
  zmian zapory w chmurze) - właściciel zdecydował zrobić tylko to, co działa bez tego. Gracze za restrykcyjnym
  NAT-em zobaczą lobby, ale partia im nie wystartuje (docs/DEPLOY.md). Usunięte `server/install.sh`, Caddyfile
  i szablon coturn.
- **Panel budowy**: koszt pod nazwą budynku zamiast obok, panel 340 px (był 320). Pomiar w przeglądarce: przy
  koszcie obok nazwy 9 z 31 nazw łamało się na dwie linie przy 320 px i wszystkie mieściły się dopiero przy
  400 px; z kosztem pod nazwą wszystkie mieszczą się już przy 320 px, a przycisk nie rośnie (dwie linie tekstu
  mieszczą się w wysokości ikony).

