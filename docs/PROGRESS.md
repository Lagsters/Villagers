# Postęp prac

## Stan
- [x] M0 Szkielet
- [x] M1 Mapa
- [x] M2 Drogi i tragarze
- [ ] M3 Budowa i pierwsze łańcuchy
- [ ] M4 Pełna gospodarka
- [ ] M5 Terytorium i wojsko
- [ ] M6 AI
- [ ] M7 Sieć
- [ ] M8 Grafika
- [ ] M9 Wydajność i dopracowanie
- [ ] M10 Wydanie

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

## Dalej
M3: map sweep (wzrost drzew), drwal, leśnik, tartak, kamieniarz; e2e z budową przez UI.

## Znane problemy
Brak.
