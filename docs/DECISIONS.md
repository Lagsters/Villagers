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
