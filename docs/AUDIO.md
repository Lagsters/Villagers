# Dźwięk w grze — analiza i plan

## Stan obecny

Kroki 1–3 planu (niżej) są wdrożone, a głosy zwierząt, ptaki i okrzyki - na razie syntezą zamiast próbek (krok 4):
- `client/sfx.ts` - generatory dźwięków jednorazowych (`SFX`), pętli (`LOOPS`) i lista zatwierdzonych ziaren głosów
  (`PICKS`);
- `client/audio.ts` - silnik: położenie, wyrazistość, panorama, limity, pętle odświeżane przez sceny, otoczenie
  wg kadru, powiadomienia interfejsu;
- sceny pracy (`client/render/work/`) - pole `sound` cząsteczek uderzeń i wypływów oraz `c.sfx` / `c.sfxLoop`;
- `scripts/sounds.ts` i `scripts/sounds-page.py` - warianty, ranking i strona odsłuchu; procedura wyboru w README
  („Odsłuch dźwięków”).

Otwarte: krok 4 (próbki CC0), jeśli synteza nie wystarczy, krok 5 (osobne suwaki).

## Jak dźwięk ma zależeć od kamery

Słuchacz stoi w środku widoku (`cam.target`), a kamera jest ortograficzna, więc „bliżej” oznacza dwie rzeczy: większe przybliżenie (`zoom`) i mniejszą odległość źródła od środka ekranu. Proponowany model dla każdego dźwięku świata o położeniu `p`:

- **Odległość względna** `r = |p − target| / H`, gdzie `H` to połowa szerokości widoku w świecie (`viewHalf / zoom × aspect`). `r = 0` w środku ekranu, `r ≈ 1` przy krawędzi.
- **Głośność** `g = Z(zoom) × 1 / (1 + (r / 0.4)²)`, a od `r > 1.3` (poza kadrem) cisza. `Z` rośnie z przybliżeniem: z daleka (zoom < 1) ok. 0,15, przy zoom 2–3 ok. 0,6, przy zoom ≥ 6 pełna głośność.
- **Wyrazistość**: im dalej (większe `r`, mniejszy zoom), tym niższy filtr dolnoprzepustowy (od ~16 kHz z bliska do ~1,5 kHz z daleka) i więcej pogłosu (`ConvolverNode` z krótkim, generowanym impulsem). Z bliska dźwięk jest ostry i suchy, z daleka przytłumiony.
- **Panorama** stereo z położenia na ekranie (`StereoPannerNode`, x ekranu × 0,7).
- **Zbieranie podobnych źródeł**: przy 20 drwalach w kadrze grają tylko 2–3 najbliższe środka; pozostałe zasilają jedną pętlę „gwaru pracy” danego rodzaju, której głośność zależy od ich liczby. Do tego limit ok. 16 głosów naraz z priorytetami: UI i powiadomienia przed walką, walka przed pracą, praca przed otoczeniem.
- **Tempo gry**: przy 4× i 8× rytmiczne odgłosy pracy co drugi albo co czwarty raz, bez zmiany wysokości.

Źródło wyzwalaczy:
- **Sceny pracy** wołają `c.sfx(nazwa, x, y, z)` w chwili uderzenia. Sceny działają tylko dla postaci w kadrze, więc dźwięk jest zsynchronizowany z animacją i nie kosztuje nic poza ekranem.
- **Zdarzenia symulacji** dostają położenie (`e.pos`).
- **Pętle otoczenia** zależą od tego, co widać.

## Dźwięki, które gra powinna mieć

Kolumna „Źródło” to propozycja: **S** to synteza WebAudio (bez plików), **P** to próbka z biblioteki CC0 (sekcja „Skąd legalnie pobrać”).

### Otoczenie (pętle mieszane wg zawartości kadru)

| Dźwięk | Kiedy i jak głośno | Źródło |
|---|---|---|
| wiatr | zawsze; mocniejszy, gdy w kadrze góry i śnieg | S |
| szum liści, ptaki leśne | wg udziału drzew w kadrze | S (szum) + P (ptaki) |
| łąka: świerszcze, skowronek | otwarta trawa w kadrze, przy przybliżeniu | P |
| fale morza, przybój | wg udziału brzegu morza w kadrze | S |
| plusk jeziora | brzeg jeziora w kadrze | S |
| gwar osady (kroki, odgłosy pracy z daleka) | wg liczby osadników w kadrze, z oddalenia | S (mieszanka) |
| łopot flag | przy dużym przybliżeniu na flagę | S |

### Zawody (w chwilach uderzeń w scenach pracy)

| Zawód | Dźwięki | Źródło |
|---|---|---|
| Tragarz | kroki (miękkie na drodze), odłożenie towaru (stuk wg towaru: drewno, kamień, metal, worek), podanie z rąk do rąk, westchnienie przy siadaniu | S |
| Osioł (tragarz) | stukot kopyt, ryk osła co jakiś czas | S (kopyta) + P (ryk) |
| Przewoźnik | uderzenia wioseł, plusk | S |
| Kopacz | łopata wbijana w ziemię, sypanie ziemi | S |
| Budowniczy | młotek w drewno (gwoździe), kładzenie kamienia, piła | S |
| Drwal | siekiera w pień (głuchy stuk z trzaskiem), trzeszczenie i upadek drzewa (łamanie gałęzi, uderzenie o ziemię), okrzesywanie | S + P (upadek drzewa) |
| Leśnik | łopata, sadzenie, konewka (lanie wody) | S |
| Tracz | piła tam i z powrotem, odcięty kawałek spada | S |
| Kamieniarz | kilof w skałę, dłuto przy ociosywaniu, odpryski | S |
| Górnik | stłumione uderzenia kilofa z szybu, wózek na szynach, skrzypienie kołowrotu | S |
| Rybak | świst zarzucanej wędki, plusk spławika, trzepot ryby | S |
| Myśliwy | naciąg cięciwy, świst strzały, trafienie, jeleń w ucieczce | S + P (jeleń) |
| Rolnik | świst kosy i szelest ścinanych źdźbeł, sypanie ziarna przy siewie | S |
| Młynarz | skrzypienie skrzydeł wiatraka (pętla przy pracy), zrzucany worek | S |
| Piekarz | trzask ognia w piecu, łopata piekarska, wałek | S |
| Hodowca świń | wiadro (sypanie paszy, lanie wody), świnie: chrząkanie, kwik przy korycie, mlaskanie, chlupot w błocie | S (wiadro, błoto) + P (świnie) |
| Rzeźnik | tasak w pieniek | S |
| Hutnik | huk ognia w piecu, miech, syk lanego metalu | S |
| Kowal narzędzi, płatnerz | młot w kowadło (dźwięczny metal), syk hartowania w wodzie, miech | S |
| Szkutnik | młotek, gwoździe, piła | S |
| Geolog | stuk młotka w skałę; dzwonek, gdy znajdzie złoże | S |
| Rycerz | chrzęst zbroi przy chodzie, zderzenie mieczy, uderzenie w tarczę, okrzyk, upadek | S + P (okrzyki) |
| Studniarz | kołowrót, łańcuch, wiadro uderzające o wodę, nalewanie | S |
| Piwowar | bulgotanie kadzi, toczona beczka | S |
| Hodowca osłów | ryk osłów, stukot kopyt | P (ryk) + S |
| Smolarz | huk i trzask mielerza | S |
| Katapulciarz | skrzypienie naciągu, wystrzał, świst kamienia, uderzenie i kruszenie muru | S |
| Mincerz | uderzenie stempla, brzęk monet | S |

### Zwierzęta

| Zwierzę | Dźwięki | Źródło |
|---|---|---|
| Świnia | chrząkanie (co kilka sekund na wybiegu), kwik przy bieganiu do koryta, mlaskanie przy jedzeniu | P |
| Osioł | ryk (rzadko), parskanie, kopyta | P + S |
| Jeleń | szelest w lesie, odgłos ucieczki | P + S |
| Ptaki | śpiew w lesie i na łące (otoczenie) | P |
| Ryby | plusk przy wyciąganiu | S |

### Zdarzenia i obiekty

| Zdarzenie | Dźwięki | Źródło |
|---|---|---|
| Plac budowy postawiony | wbijanie palików | S (jest `thud`) |
| Wyrównywanie terenu | łopaty, sypanie | S |
| Budynek gotowy | dzwonek (jest `chime`), z bliska dodatkowo ostatnie uderzenia młotka | S |
| Pożar | trzask, huk ognia, zawalenie dachu przy końcu | S (jest `crackle`) |
| Rozbiórka | łamanie desek, sypanie gruzu | S |
| Budynek wojskowy obsadzony | róg, krótka fanfara | S |
| Atak, przejęcie, utrata zamku | róg, fanfara, ponury akord (są) | S |
| Znalezione złoże, wyczerpana kopalnia | dzwonek; głuchy spadający ton | S |
| Granica się przesuwa | cichy szum (opcjonalnie) | S |

### Interfejs

Klik, otwarcie i zamknięcie panelu, niedozwolona akcja (krótki „brzęk” błędu), postawienie flagi, krok budowy drogi (cichy stuk na każde pole), zakończenie drogi, zmiana tempa i pauza. Wszystko syntetyczne (S), bez położenia.

## Jak je wygenerować

1. **Synteza w WebAudio (obecna droga)**: oscylatory, szum, filtry, obwiednie, proste modele fizyczne. Daje to zero plików, zero licencji, jeden spójny styl i drobne różnice przy każdym odtworzeniu (losowa wysokość i barwa), więc rytmiczne odgłosy się nie nudzą. Dobrze nadaje się na uderzenia (siekiera, młot, kilof, łopata), metal (kowadło: kilka niewielokrotnych częstotliwości z długim wybrzmieniem), piły, ogień, wodę, wiatr, fale, skrzypienie (szum przez rezonujący filtr pasmowy z modulacją), UI. Słabo nadaje się na głosy zwierząt i ludzi; da się je przybliżyć, ale brzmią sztucznie.
2. **Generatory efektów offline**: jsfxr, Bfxr, ChipTone. Sami generujemy plik, który należy do nas. Pasują raczej do stylu retro; tu przydadzą się najwyżej do UI.
3. **Własne nagrania** (telefon i Audacity): uderzenia w drewno, łopata w ziemi, nalewanie wody, worek. To nasze prawa i naturalne brzmienie, ale kosztuje czas.
4. **Biblioteki z licencją pozwalającą na grę** (niżej): głównie dla zwierząt, ptaków i okrzyków.

**Rekomendacja**: hybryda. Wszystko oznaczone **S** syntetyzujemy w kodzie, rozszerzając `client/audio.ts`. Głosy zwierząt, ptaki i okrzyki bierzemy z bibliotek CC0. Pliki mono OGG/Opus 32–48 kb/s, łącznie do ok. 2–3 MB, ładowane leniwie (osobno pakiet „zwierzęta”, osobno „otoczenie”).

## Skąd legalnie pobrać

Repozytorium jest publiczne (licencja MIT), a gra działa na GitHub Pages. Pliki dźwiękowe leżą więc publicznie do pobrania w surowej postaci, a to wyklucza część licencji „darmowych do gier”. Kolejność od najbezpieczniejszych. Warunki trzeba sprawdzić w dniu pobrania i zapisać przy każdym pliku w `art/sounds/CREDITS.md` (źródło, autor, licencja, adres).

| Źródło | Licencja | Do tego projektu |
|---|---|---|
| **Kenney** (kenney.nl, paczki audio) | CC0 | Tak. Bez wymogu podpisu, wolno rozpowszechniać pliki. Głównie UI i proste efekty. |
| **Freesound** (freesound.org) z filtrem „Creative Commons 0” | CC0 (filtr) | Tak. Największy wybór zwierząt, ptaków i otoczenia. Pliki CC-BY też dopuszczalne, ale z podpisem w CREDITS. Unikać CC-BY-NC (zakaz użycia komercyjnego, niezgodny z MIT). |
| **OpenGameArt** (opengameart.org) | różne, per plik | Tak dla CC0 i CC-BY (z podpisem). GPL i CC-BY-SA lepiej omijać, bo narzucają licencję na całość. |
| **Sonniss GDC Game Audio Bundle** | royalty-free, użycie komercyjne bez podpisu | Tak w grze, ale licencja zabrania udostępniania dźwięków jako biblioteki. Surowe pliki w publicznym repozytorium to szara strefa, więc najlepiej tylko przetworzone fragmenty albo wcale. |
| **Pixabay** (pixabay.com, efekty dźwiękowe) | Pixabay Content License | Użycie komercyjne bez podpisu, ale bez rozpowszechniania pliku samodzielnie. To samo zastrzeżenie co przy Sonniss. |
| **Mixkit** (mixkit.co) | Mixkit License | Jak Pixabay: dozwolone w projektach, bez redystrybucji jako biblioteki. |
| **ZapSplat** (zapsplat.com) | darmowa z obowiązkowym podpisem | Możliwe z podpisem, ale ogranicza redystrybucję, więc lepiej nie. |
| **BBC Sound Effects** (sound-effects.bbcrewind.co.uk) | RemArc: tylko osobiste, edukacyjne, badawcze | Nie. Gra jest publikowana. |

Głosów z gier ani filmów nie bierzemy (prawa autorskie), podobnie jak dźwięków z pierwowzoru. Nazwa i zasoby pierwowzoru są w projekcie wykluczone.

## Plan wdrożenia (propozycja)

1. **Silnik**: `SoundWorld` w `client/audio.ts` z modelem odległości i wyrazistości (głośność, filtr, pogłos, panorama), limitem głosów, priorytetami, zbieraniem podobnych źródeł i aktualizacją położenia słuchacza z kamery w każdej klatce. W scenach pracy `c.sfx(...)`, w zdarzeniach położenie. Zdarzenia już obecne grają z odległością.
2. **Synteza zawodów**: młot i kowadło, siekiera, piła, kilof, łopata, woda, ogień, skrzypienie, kroki. Około 20 generatorów z losową zmiennością, podpiętych w ~75 miejscach uderzeń.
3. **Otoczenie**: pętle wiatru, lasu, morza, jeziora i gwaru osady mieszane wg zawartości kadru. Liczone co ok. 0,5 s z tego, co i tak rysujemy (chunki terenu w kadrze, liczba drzew, osadników, brzeg).
4. **Próbki CC0**: świnie, osły, jeleń, ptaki, okrzyki rycerzy (Freesound CC0 albo Kenney), przycięte, znormalizowane, mono OGG, plik `CREDITS.md`.
5. **Opcje**: osobne suwaki „efekty”, „otoczenie”, „powiadomienia” i wyciszenie dźwięków świata przy kamerze z daleka.

Kroki 1–3 nie wymagają żadnych plików ani licencji i dają większość efektu. Krok 4 wymaga wybrania konkretnych nagrań. Mogę je wyszukać i pokazać listę do akceptacji, zanim cokolwiek trafi do repozytorium.
