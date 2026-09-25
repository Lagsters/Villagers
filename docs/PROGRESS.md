# Postęp prac

## Stan
- [x] M0 Szkielet
- [x] M1 Mapa
- [ ] M2 Drogi i tragarze
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

## Dalej
M2: flagi, drogi, tragarze, zamek z magazynem, trasowanie towarów, test determinizmu.

## Znane problemy
Brak.
