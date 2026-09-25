# Osadnicy Doliny — Game Design Document

Gra ekonomiczno-strategiczna czasu rzeczywistego. Mechanicznie odtwarza klasyczną grę budowania osad
z 1993 roku: gospodarka opiera się na sieci dróg, flag i tragarzy, granice wyznaczają budynki wojskowe,
a o zwycięstwie decydują pojedynki rycerzy. Wszystkie zasoby (modele, ikony, dźwięki, teksty, mapy)
są własne.

Wszystkie liczby w tym dokumencie są źródłem prawdy dla `sim/`. Czas podaję w tickach (10 ticków = 1 s).

---

## 1. Mapa

### 1.1 Siatka
- Mapa to prostokąt `W × H` wierzchołków (pól), bez zawijania. Rozmiary: 64, 96, 128, 160.
- Siatka heksagonalna w układzie „offset”: wiersze nieparzyste są przesunięte o pół pola w prawo.
  Każde pole ma 6 sąsiadów: `E, SE, SW, W, NW, NE` (kierunki 0–5, zgodnie ze wskazówkami zegara).
- Pole ma: wysokość `0–31`, typ terenu, obiekt (drzewo, kamień, pole zboża, flaga, budynek, znak geologa),
  właściciela terytorium, maskę dróg (6 bitów) i złoże (typ + ilość).
- Skrajny pas szerokości 1 pola jest nieprzechodni (krawędź świata).

### 1.2 Typy terenu
| Typ | Chodzenie | Budowa | Uwagi |
|---|---|---|---|
| Woda | nie (tylko łodzią po drodze wodnej) | nie | ryby |
| Trawa | tak | tak | drzewa, pola, zwierzęta |
| Pustynia | tak | tylko flagi i drogi | nic nie rośnie |
| Góry | tak | tylko kopalnie, flagi, drogi | złoża węgla, żelaza, złota, kamienia |
| Śnieg | nie | nie | szczyty gór |

### 1.3 Generator mapy
- Kod mapy: 1–12 znaków `[A-Z0-9]`. Kod → 32-bitowe ziarno (FNV-1a). Ten sam kod = ta sama mapa.
- Wysokość: suma trzech oktaw całkowitoliczbowego szumu wartości (value noise) na siatce kontrolnej,
  interpolacja smoothstep w fixed-point.
- Poziom morza, pasma gór, śnieg na szczytach, pustynie z drugiego szumu („wilgotność”).
- Lasy (drzewa w skupiskach), skały (skupiska kamieni), złoża w górach (plamy wg trzeciego szumu),
  ryby na każdym polu wody (ilość zależna od odległości od brzegu).
- Pozycje startowe graczy: pola trawy, na których da się postawić zamek, maksymalnie od siebie oddalone
  (algorytm najdalszego punktu z deterministycznym rozstrzyganiem remisów). Wokół każdego startu
  generator gwarantuje las, skały i kawałek gór w promieniu ~14 pól.

---

## 2. Flagi i drogi

- **Flaga** stoi na polu przechodnim, w którym nie ma obiektu; żaden z 6 sąsiadów nie może być flagą.
  Flaga musi leżeć na własnym terytorium.
- **Droga** łączy dwie flagi ścieżką po krawędziach siatki. Droga nie może przechodzić przez inną drogę,
  budynek, flagę (poza końcami), drzewo, kamień ani pole nieprzechodnie. Maksymalna długość: 30 krawędzi.
  Na polu pośrednim drogi można później postawić flagę — dzieli ona drogę na dwie.
- **Droga wodna**: wszystkie krawędzie nad wodą (pole pośrednie = woda), końce na brzegu.
  Obsługuje ją tragarz z łodzią (towar „łódź” z magazynu).
- **Tragarz**: dokładnie jeden na odcinek. Nosi jeden towar naraz. Czeka na środku drogi; gdy na którejś
  z flag leży towar kierowany w jego drogę, idzie po niego, zabiera i niesie na drugą flagę.
  Jeśli tam czeka towar w przeciwną stronę, od razu go zabiera.
- **Kolejka na fladze**: maks. 8 towarów. Gdy flaga docelowa jest pełna, tragarz czeka z towarem.
- **Osioł**: gdy na drodze przez 300 ticków średnio ≥ 3 towary czekają na jej końcach, drogę dostaje
  osioł (drugi przenoszący, działa jak tragarz). Osły rodzą się w zamku: +1 co 900 ticków, maks. 20 w zapasie.
- **Kolejność transportu**: tragarz wybiera towar o najwyższym priorytecie transportu (ustawienie gracza),
  przy remisie najstarszy.
- **Prędkość marszu**: krawędź płaska = 8 ticków; pod górę +2 ticki za każdy poziom różnicy wysokości,
  z góry +1 za poziom. Z towarem tak samo, z łodzią po wodzie 10 ticków.

## 3. Trasowanie towarów

- Każdy towar ma cel: budynek (odbiorca) albo magazyn (zamek/magazyn).
- Na każdej fladze towar wybiera kolejną drogę najkrótszą ścieżką (Dijkstra po grafie flag, koszt = suma
  czasów marszu, remis → niższy kierunek). Tablice kierunków są liczone leniwie i unieważniane po każdej
  zmianie sieci.
- Gdy cel znika albo przestaje być osiągalny, towar dostaje nowy cel: najbliższy odbiorca potrzebujący
  tego towaru, a gdy go brak — najbliższy magazyn. Gdy nie ma magazynu w zasięgu, towar czeka na fladze.
- **Popyt**: co 5 ticków (każdy gracz w innej fazie) budynki z niezaspokojonym popytem szukają źródła:
  najbliższy magazyn z towarem (Dijkstra od flagi budynku). Magazyn wydaje towary na swoją flagę
  (maks. 1 towar na 4 ticki).
- **Produkcja**: gotowy wyrób trafia na flagę budynku z celem = najlepszy odbiorca
  (priorytet ustawień × 64 − odległość), inaczej najbliższy magazyn.

## 4. Osadnicy i zawody

- W zamku/magazynie osadnicy są licznikami (bez encji). Wychodząc, stają się jednostkami na mapie.
- Nowy wolny osadnik rodzi się w zamku co 250 ticków, dopóki liczba wszystkich osadników gracza < 200.
- Zawód wymaga narzędzia z magazynu. Magazyn szkoli wolnego osadnika na żądanie, zużywając narzędzie.

| Zawód | Narzędzie | Budynek |
|---|---|---|
| Tragarz | — | droga |
| Kopacz (wyrównuje teren) | łopata | plac budowy dużego budynku |
| Budowniczy | młotek | plac budowy |
| Drwal | siekiera | chata drwala |
| Leśnik | — | leśniczówka |
| Tracz | piła | tartak |
| Kamieniarz | kilof | kamieniołom |
| Górnik | kilof | kopalnia |
| Rybak | wędka | rybak |
| Myśliwy | — | myśliwy |
| Rolnik | kosa | farma |
| Młynarz | — | młyn |
| Piekarz | — | piekarnia |
| Hodowca świń | — | chlewnia |
| Rzeźnik | tasak | rzeźnia |
| Hutnik | — | huta żelaza, huta złota |
| Narzędziowiec | młotek + piła | narzędziownia |
| Płatnerz | młotek + szczypce | zbrojownia |
| Szkutnik | młotek | stocznia |
| Geolog | młotek | wysyłany na flagę |
| Rycerz | miecz + tarcza | budynki wojskowe |

## 5. Budowa

- Budynek stoi na polu `P`, jego flaga na `SE(P)` (flaga powstaje automatycznie, jeśli jej nie ma).
- **Mały budynek**: `P` wolne, na trawie; flaga możliwa; różnica wysokości między `P` a sąsiadami ≤ 4.
- **Duży budynek**: dodatkowo pola `W(P)`, `NW(P)`, `NE(P)` wolne i nie-woda/nie-śnieg, różnica wysokości ≤ 3.
  Przed budową kopacz wyrównuje teren: ustawia `P` i 6 sąsiadów na średnią wysokość (1 poziom na 20 ticków).
- **Kopalnia**: `P` w górach, warunki jak mały budynek.
- Wszystkie pola budynku muszą leżeć na własnym terytorium, nie przy granicy (sąsiedzi też własni).
- Plac budowy potrzebuje materiałów (deski D, kamień K) i budowniczego. Budowniczy wbudowuje każdą jednostkę
  materiału w 40 ticków. Po skończeniu wraca do magazynu, a budynek zamawia pracownika.
- Rozbiórka: natychmiastowa, budynek płonie 150 ticków (wizualnie), materiały przepadają.

## 6. Budynki i łańcuchy produkcji

| Budynek | Rozmiar | Koszt | Wejście → Wyjście | Czas cyklu | Uwagi |
|---|---|---|---|---|---|
| Zamek | duży | — | magazyn, rodzi osadników i osły | — | promień terytorium 9 |
| Magazyn | duży | 4D 4K | magazyn | — | |
| Drwal | mały | 2D | drzewo → pień | 80 + marsz | drzewa w promieniu 6 |
| Leśnik | mały | 2D | sadzi drzewa | 120 + marsz | promień 5 |
| Tartak | mały | 2D 1K | pień → deska | 80 | |
| Kamieniarz | mały | 2D | skała → kamień | 80 + marsz | promień 7 |
| Rybak | mały | 2D | ryby → ryba | 100 + marsz | brzeg w promieniu 7 |
| Myśliwy | mały | 2D | zwierzę → mięso | 60 + pogoń | promień 8 |
| Farma | duży | 3D 1K | sieje/zbiera → zboże | 80 + marsz | pola w promieniu 3, rosną 2000 |
| Młyn | mały | 3D 1K | zboże → mąka | 60 | |
| Piekarnia | mały | 2D 2K | mąka → chleb | 80 | |
| Chlewnia | duży | 3D 2K | zboże → świnia | 120 | |
| Rzeźnia | mały | 2D 1K | świnia → mięso | 60 | |
| Kopalnia węgla | mały | 4D | jedzenie → węgiel | 100 | złoże w promieniu 2 |
| Kopalnia żelaza | mały | 4D | jedzenie → ruda żelaza | 100 | |
| Kopalnia złota | mały | 4D | jedzenie → ruda złota | 100 | |
| Kopalnia kamienia | mały | 4D | jedzenie → kamień ×2 | 100 | |
| Huta żelaza | mały | 2D 2K | ruda żelaza + węgiel → stal | 100 | |
| Huta złota | mały | 2D 2K | ruda złota + węgiel → sztabka złota | 100 | |
| Narzędziownia | mały | 3D 1K | deska + stal → narzędzie | 120 | wg priorytetów narzędzi |
| Zbrojownia | mały | 2D 2K | stal + węgiel → miecz + tarcza | 140 | |
| Stocznia | mały | 3D | deska → łódź | 150 | |
| Strażnica | mały | 1D 1K | — | — | 2 rycerzy, promień 5 |
| Wieża | mały | 2D 3K | — | — | 4 rycerzy, promień 7 |
| Twierdza | duży | 4D 6K | — | — | 8 rycerzy, promień 9 |

- Budynek produkcyjny ma bufor wejściowy 4 sztuki na każdy surowiec. Pracuje, gdy ma komplet wejść.
- Kopalnia: każdy cykl zużywa 1 jedzenie (ryba, chleb albo mięso — którekolwiek jest) i 1 jednostkę złoża
  z pola w promieniu 2 (pierwsze niepuste w stałej kolejności). Brak złoża → cykl bez wyrobu,
  po 5 pustych cyklach kopalnia zgłasza „wyczerpana”.
- Drzewo: sadzonka rośnie 4 etapy po 700 ticków, potem jest dorosłe. Ścięte zostawia pień na 300 ticków.
- Skała: 6 jednostek kamienia, znika po wyczerpaniu.
- Pole zboża: 4 etapy po 500 ticków, dojrzałe czeka 3000 ticków na żniwa, potem obumiera.
- Ryby: każde pole wody 0–10 jednostek, +1 co 3000 ticków do 10.
- Zwierzęta: stada na trawie; nowe zwierzę co 1500 ticków w losowym lesie, maks. 1 na 150 pól mapy.

## 7. Geolog

Wysłany na flagę bada 8 pól w promieniu 5 od flagi (60 ticków na pole), stawia znak z typem i ilością
złoża (lub „pusto”). Znak znika po 6000 ticków. Działa tylko w górach (na innym terenie stawia „pusto”).

## 8. Ustawienia gospodarki (na gracza)

- **Priorytety transportu**: kolejność 26 towarów (im wyżej, tym szybciej zabierany z flagi).
- **Jedzenie dla kopalń**: waga 0–8 dla kopalni węgla, żelaza, złota, kamienia.
- **Rozdział desek**: budowa / stocznia / narzędziownia (0–8).
- **Rozdział stali**: narzędziownia / zbrojownia (0–8).
- **Rozdział węgla**: huta żelaza / huta złota / zbrojownia (0–8).
- **Rozdział zboża**: młyn / chlewnia (0–8).
- **Priorytety narzędzi**: 9 wag 0–8. Narzędziownia robi narzędzie o największym `waga × (1 + braki)`,
  gdzie braki = liczba osadników czekających na to narzędzie.
- **Obsada budynków wojskowych**: minimalna liczba rycerzy w budynkach wewnątrz kraju / przy granicy /
  przy wrogu (0–pełna).
- **Rezerwa rycerzy w zamku** i **rezerwa wolnych osadników** (nie przerabiaj ich na rycerzy poniżej progu).

Waga 0 oznacza „nie dostarczaj”.

## 9. Terytorium

- Budynek wojskowy z co najmniej jednym rycerzem wpływa na pola w promieniu (odległość heksagonalna).
- Przeliczenie pola: jeśli obecny właściciel nadal ma na nie wpływ, zostaje. W przeciwnym razie pole
  dostaje gracz z najbliższym wpływającym budynkiem (remis → niższe id budynku), a gdy nikt — niczyje.
  Nowy budynek nie odbiera więc cudzej ziemi; odbiera ją dopiero przejęcie albo zniszczenie budynku wroga.
- Budynki, flagi i drogi na utraconym polu płoną/znikają; osadnicy z nich wracają do magazynu.
- Strefy dla obsady: pole budynku wojskowego jest „przy wrogu”, gdy w promieniu 12 jest cudza granica,
  „przy granicy”, gdy w promieniu 6 jest niczyje pole, inaczej „wewnątrz”.

## 10. Wojsko

- Rycerz ma poziom 0–4. Rycerz powstaje w magazynie z wolnego osadnika + miecz + tarcza (poziom 0).
- **Szkolenie**: budynek wojskowy przechowuje do 2 sztabek złota (twierdza 4). Co 600 ticków, jeśli
  budynek ma złoto, jeden jego najsłabszy rycerz poniżej poziomu 4 awansuje. Rycerze w zamku szkolą się
  tak samo, jeśli zamek ma złoto (co 900 ticków).
- **Morale gracza** = `50 + min(50, 4 × złoto)` [%], gdzie złoto = sztabki w magazynach i budynkach wojskowych.
- **Atak**: gracz wybiera wrogi budynek wojskowy lub zamek w odległości ≤ 14 od któregoś własnego
  budynku wojskowego. Dostępni są rycerze z własnych budynków wojskowych w promieniu 14 od celu
  (każdy budynek zostawia co najmniej 1). Rycerze idą (poza drogami) pod flagę celu.
- **Obrona**: budynek wysyła po jednym obrońcy na atakującego, dopóki ma rycerzy (ostatni wychodzi też).
- **Pojedynek**: runda co 6 ticków; atakujący trafia z szansą
  `clamp(50 + 10 × (poziomA − poziomB) + (moraleA − moraleB) / 4, 10, 90)` %, obrońca symetrycznie.
  Punkty życia: `3 + poziom`. Trafienie odbiera 1 PŻ. Zwycięzca wraca do działań.
- Pusty budynek zajmuje pierwszy atakujący, który do niego dotrze: budynek zmienia właściciela
  (zamek zamiast tego płonie). Pozostali atakujący wracają do swoich budynków.
- **Eliminacja**: gracz, który stracił zamek, odpada: jego budynki płoną, osadnicy znikają.
- **Zwycięstwo**: ostatni gracz (lub drużyna — brak drużyn w v1) z zamkiem.

## 11. Statystyki

Co 300 ticków zapis próbki dla każdego gracza (historia maks. 240 próbek, starsze uśredniane parami):
liczba budynków, osadników, rycerzy (i suma poziomów), ilość każdego towaru w magazynach,
produkcja każdego towaru od początku gry, wielkość terytorium. Ekran statystyk pokazuje wykresy.

## 12. AI

Dwa poziomy: **Łatwy** (reaguje co 50 ticków, nie atakuje przed 20. minutą, atakuje małymi siłami)
i **Trudny** (co 20 ticków, pełny łańcuch militarny, atakuje przewagą). AI działa wyłącznie przez komendy.

## 13. Komendy (jedyne wejście symulacji)

`flag`, `road`, `build`, `demolish`, `attack`, `geologist`, `setting`, `surrender`, `aiTakeover`.
Każda komenda ma `player`; symulacja sama sprawdza poprawność (niepoprawna komenda jest ignorowana).
