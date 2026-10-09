# Osadnicy Doliny — zasady pracy w repozytorium

## README.md zawsze aktualne

Po zakończeniu **każdego** kroku pracy (funkcja, poprawka wyglądu, zmiana zasad, nowe narzędzie) sprawdź
`README.md` i popraw go, zanim zgłosisz krok jako skończony. README ma opisywać:

- **wszystko, co gra robi** — mechaniki, zasady (np. stawiania budynków), wygląd świata, interfejs, sterowanie,
  tryby uruchomienia i parametry adresu;
- **jak jest rozwijana i sprawdzana autonomicznie** — symulacja i jej testy, partie botów, budowa modeli,
  zdjęcia i animacje z gry, testy przeglądarkowe, bramka przed commitem.

Opis ma się zgadzać z kodem w chwili zakończenia kroku: usuń to, czego już nie ma, dopisz to, co doszło.

## Stałe zasady

- Nie używaj nazw „Settlers”, „Serf City”, „Blue Byte” w kodzie, interfejsie ani komentarzach.
- Zanim zmienisz symulację (`sim/`), przedstaw właścicielowi warianty i skutki (tempo gry, boty, `SIM_VERSION`);
  po zmianie podnieś `SIM_VERSION` i sprawdź, że 20/20 partii botów kończy się zwycięstwem.
- Modele tylko ze skryptów `art/scripts/*.py` (Blender 5.2): `node art/build.ts <katalog> [nazwy]`; budżety
  trójkątów pilnuje `tests/art/models.test.ts`.
- Kształt modelu po przebudowie sprawdzaj najpierw na podglądzie z Blendera (`art/previews/<nazwa>.png`, dla postaci
  `icon_serf.png`, `icon_knight.png`) - szybciej niż zdjęcie z gry; grę nagrywaj dopiero, gdy model jest gotowy.
- Wygląd sprawdzaj zdjęciami z gry (`scripts/capture.ts`, `scripts/sheet.py`), z bliska i z daleka, z obrotem
  kamery; na koniec pokaż porównanie przed/po.
- Przed zakończeniem: `bash scripts/check.sh` i `npx playwright test tests/e2e --project=chromium`; przegląd
  dopisanych komentarzy skillem `global-comment-style`; wpis w `docs/DECISIONS.md` (decyzja i powód) oraz
  `docs/PROGRESS.md`.
- Jeden serwer deweloperski (`npm run dev`, port 5173). Serwery uruchomione na chwilę (np. do zdjęć „przed”)
  zamknij.
- Nie commituj bez zgody właściciela.
