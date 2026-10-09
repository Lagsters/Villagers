# Postęp prac

## Stan
- [x] M0 Szkielet
- [x] M1 Mapa
- [x] M2 Drogi i tragarze
- [x] M3 Budowa i pierwsze łańcuchy
- [x] M4 Pełna gospodarka
- [ ] M5 Terytorium i wojsko
- [x] M6 AI
- [x] M7 Sieć
- [x] M8 Grafika
- [x] M9 Wydajność i dopracowanie
- [x] M10 Wydanie

## Dziennik
### M0
Vite + TS strict + ESLint + Vitest + Playwright (Chromium, Firefox), CI w GitHub Actions
(lint, typecheck, testy, e2e, build, deploy na Pages z `main`).

### M1
- `sim/`: PRNG xorshift32, fixed-point 16.16 z tablicą sinusa liczoną na BigInt, siatka heksagonalna
  (offset, 6 kierunków, spirala), generator mapy z kodu (value noise na liczbach całkowitych,
  percentyle terenu, złoża, ryby, lasy, skały, rozstawienie startów najdalszym punktem),
  `hashAny` + serializacja z RLE dla tablic typowanych.
- `client/`: teren w chunkach 32×32 (flat shading, kolory wierzchołków), ocean wokół mapy,
  kamera ortograficzna (pan, zoom, obrót o 60°), mysz/klawiatura/dotyk, wybór pola ray-marchem po
  mapie wysokości, obiekty mapy na InstancedMesh z odrzucaniem chunków poza kadrem.
- Testy: jednostkowe (fixed, siatka, PRNG, generator, serializacja), e2e (render + wybór pola).

### M2
- Encje symulacji (`sim/types.ts`): flagi (8 slotów), drogi, budynki, osadnicy; wolne sloty z listami
  wolnych id; stan w całości serializowalny.
- Flagi i drogi (walidacja, podział drogi flagą, rozbiórka), trasowanie Dijkstrą po grafie flag
  z leniwym cache (unieważnianym wersją sieci), A* dla marszu na przełaj.
- Tragarze: odbiór, przenoszenie, wnoszenie do budynku, zamiana towarów przy pełnej fladze, osły.
- Gospodarka: przydział tragarzy/budowniczych/kopaczy/pracowników z najbliższego magazynu,
  zamówienia towarów z wagami ustawień, narodziny osadników i osłów, szkolenie rycerzy.
- Budowa: plac budowy, kopacz wyrównuje teren pod duże budynki, budowniczy, ukończenie, pożar, ruina,
  utrata terytorium.
- Klient: drogi, flagi z towarami, budynki, place budowy, osadnicy z interpolacją, granice, podgląd drogi,
  znaczniki miejsc budowy, HUD (czas, tempo, zapasy), panel kontekstowy.
- Testy: scenariusze transportu i budowy, determinizm (2 instancje + zapis/odczyt w połowie).

### M3
- Przegląd mapy (`sim/mapsweep.ts`): wzrost sadzonek i zboża, pnie, znaki, ruiny, odnawianie ryb.
- Produkcja (`sim/production.ts`): warsztaty, kopalnie, zbieracze wychodzący w teren z rezerwacją celu,
  wynoszenie wyrobów na flagę, wybór celu towaru. Od razu wszystkie budynki gospodarcze (M4 dopina testy).
- Zwierzęta dla myśliwego. Rendering zwierząt.
- E2E: budowa drwala i drogi przez prawdziwe kliknięcia w UI (Chromium + Firefox).

### M4
- Wszystkie budynki gospodarcze z testami: kopalnie (jedzenie + złoże, wyczerpanie), huty, narzędziownia
  (priorytety + braki), zbrojownia (miecz + tarcza → rycerze), farma → młyn → piekarnia,
  chlewnia → rzeźnia, rybak, myśliwy, stocznia.
- Geolog (komenda, badanie 8 pól, znaki złóż). Statystyki (próbki co 300 ticków).
- Sprawiedliwy rozdział towarów (premia za czas oczekiwania).
- UI: ustawienia gospodarki (rozdział, narzędzia, kolejność transportu, obsada), statystyki (wykres
  porównawczy z legendą, etykietami i tabelą; tabela towarów).

### Po M10: modele
- Budynki przebudowane w stylu pierwszej części serii (terakota, bielone ściany, deski, bale, unikalne
  sylwetki), kamera 44°, postacie z nakryciami głowy i narzędziami zawodów (docs/DECISIONS.md).

### Po M10: sceny pracy zawodów
- Każdy zawód ma własną sekwencję pracy (`client/render/work/`), szkielet postaci z pełną pozą (`rig.ts`),
  cząsteczki bez stanu (`fx.ts`), etapy przy chacie w symulacji dla leśnika, kamieniarza i myśliwego
  (wydajność bez zmian, `tests/sim/workstages.test.ts`), tryb pokazowy `?demo=1` z panelem „Pokaz zawodów”,
  nagrywanie klatek `scripts/capture.ts` (stały krok czasu `--fixed`).

### Po M10: teren, natura, podwórka na stoku
- Teren malowany w shaderze (wagi rodzajów terenu, poszarpane granice, faktury trawy, skały, piasku, śniegu i wody),
  odmiany drzew i skał z wzorami w shaderze, pola z rzędami kłosów, płynny wzrost sadzonek i zboża, znak geologa
  z kolorem złoża; sprzęty przed budynkami leżą na terenie, a budynek na stoku ma podmurówkę (docs/DECISIONS.md).
- Teren, drogi, drzewa i pola jako jeden obraz: stan pól w teksturze dla shadera terenu (cienie, ściółka, wydeptana
  ziemia, drogi i zaorane pola rysowane przez teren), wspólna paleta zieleni, niższe zboże bez płyty, kępy trawy
  i krzaki (docs/DECISIONS.md).
- Plaża, góry, śnieg i woda: rodzaje terenu w teksturze (granice niezależne od siatki), nowa skała, zaspy, wydmy
  i mokry brzeg, falująca woda z pianą, trzcina, suche kępy i drobne kamienie (docs/DECISIONS.md).
- Niższe fundamenty (poziom budynku ze średniej wysokości terenu), schody przed drzwiami i ścieżka od flagi pod
  drzwi, limit stoku pod chatą (SIM_VERSION 3), woda tylko na poziomie swojego lustra (docs/DECISIONS.md).
- Łagodne wzniesienie górskie przy zamkach, kamera do 10° nad horyzontem, krzywizna świata z morzem i niebem
  (docs/DECISIONS.md); równowaga botów: test wymaga co najmniej 10/20 wygranych trudnego bota.
- Jednolity kolor podmurówki, cokołu i schodów, jaśniejsze deski; ręczne poprawki mapy DOLINA/64 (wzniesienie
  z kopalniami i jezioro), ziemia placu budowy na terenie, kłody i pieniek drwala, grządka leśnika bliżej drzwi
  (docs/DECISIONS.md).
- Świnki z zachowaniami na wybiegu (błoto, rycie, płot), tragarze niosą towar wg ciężaru i mają więcej zachowań
  w bezczynności, okrągłe kłody na stoku, drogi przez drzewa łagodnym łukiem (SIM_VERSION 4) (docs/DECISIONS.md).
- Drogi omijają łukiem także budynki; postacie z łokciami i dłońmi (docs/DECISIONS.md).
- Dźwięk z położeniem (głośność i wyrazistość wg przybliżenia i odległości od środka widoku, panorama), dźwięki
  pracy wszystkich zawodów, głosy zwierząt i rycerzy, otoczenie mieszane wg kadru; odsłuch wariantów
  `scripts/sounds.ts` i strona odsłuchu `scripts/sounds-page.py`, wybór właściciela w `PICKS`, kwik świni wybrany pomiarem (README, docs/AUDIO.md,
  docs/DECISIONS.md).
- Serwer lobby gry wieloosobowej na `api.kwasnypp.ovh/osada/` (repozytorium `vps01`, wydanie `signal-v*`),
  limit połączeń odporny na podrobiony nagłówek, panel budowy z nazwami w jednej linii (docs/DECISIONS.md).

## Dalej
M5: budynki wojskowe (obsada rycerzami, strefy), terytorium, atak, pojedynki, przejęcia, zwycięstwo.

## Znane problemy
- Test lobby WebRTC tylko w Chromium (ograniczenie Playwright-Firefox na http://localhost).
