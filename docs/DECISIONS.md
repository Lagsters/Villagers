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
