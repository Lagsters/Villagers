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
