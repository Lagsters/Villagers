# Publikacja: GitHub Pages + serwer na Oracle Cloud Free Tier

Gra składa się z dwóch części:

1. **Klient** (pliki statyczne) — publikowany automatycznie na GitHub Pages przez GitHub Actions
   przy każdym pushu na `main`. Adres: `https://lagsters.github.io/Villagers/`.
2. **Serwer** — jedna darmowa maszyna Oracle Cloud. Służy wyłącznie do **sygnalizacji WebRTC**
   (lobby, kody pokojów) i jako **TURN** (coturn) dla graczy za restrykcyjnym NAT-em.
   Serwer nie liczy symulacji: po zestawieniu połączeń gracze rozmawiają ze sobą bezpośrednio.

Gra z botami działa bez serwera. Serwer jest potrzebny tylko do gry wieloosobowej.

Jedyna rzecz, którą wpisujesz ręcznie, to **adres serwera sygnalizacyjnego** (krok 6).

---

## 1. Darmowa domena (DuckDNS)

GitHub Pages działa po HTTPS, więc przeglądarka wymaga połączenia `wss://` z certyfikatem — do tego
potrzebna jest nazwa domenowa.

1. Wejdź na <https://www.duckdns.org> i zaloguj się (GitHub/Google).
2. Dodaj subdomenę, np. `osadnicy` → dostajesz `osadnicy.duckdns.org`.
3. Adres IP uzupełnisz w kroku 3, gdy maszyna będzie gotowa.

## 2. Maszyna w Oracle Cloud

1. Załóż konto na <https://www.oracle.com/cloud/free/> (Free Tier, wymaga karty — nie jest obciążana).
2. **Compute → Instances → Create instance**:
   - obraz: **Ubuntu 24.04** (albo 22.04),
   - kształt: **VM.Standard.A1.Flex** (ARM Ampere, np. 1 OCPU / 6 GB) albo **VM.Standard.E2.1.Micro** (AMD) —
     serwerowi wystarczy najmniejszy,
   - dodaj swój klucz SSH (albo pobierz wygenerowany),
   - zapisz **publiczny adres IP** instancji.

## 3. Wpis DNS

W DuckDNS wpisz publiczny IP maszyny przy swojej subdomenie i kliknij **update ip**.
Sprawdź: `ping osadnicy.duckdns.org` powinien pokazać ten adres.

## 4. Porty w konsoli Oracle (Security List)

**Networking → Virtual Cloud Networks → (twoja VCN) → Subnet → Security List → Add Ingress Rules**,
źródło `0.0.0.0/0`:

| Protokół | Port(y) | Po co |
|---|---|---|
| TCP | 80 | Let's Encrypt (wystawienie certyfikatu) |
| TCP | 443 | `wss://` - sygnalizacja przez Caddy |
| TCP | 3478 | TURN (TCP) |
| UDP | 3478 | TURN (UDP) |
| UDP | 49160-49200 | przekaźniki TURN (relay) |

Zapora systemowa (iptables) zostanie skonfigurowana przez skrypt w kroku 5.

## 5. Instalacja serwera

Zaloguj się na maszynę i uruchom skrypt z repozytorium:

```bash
ssh ubuntu@osadnicy.duckdns.org
```

```bash
git clone https://github.com/Lagsters/Villagers.git && cd Villagers/server
```

```bash
sudo DOMAIN=osadnicy.duckdns.org EMAIL=twoj@email.pl bash install.sh
```

Skrypt instaluje Node.js 24, coturn i Caddy, generuje sekret TURN (wspólny dla coturn i serwera
sygnalizacyjnego, zapisany w `/etc/osadnicy.env`), tworzy usługę `osadnicy-signal`, otwiera porty
w iptables i uruchamia wszystko. Można go uruchomić ponownie (np. po aktualizacji repozytorium) —
zachowa istniejący sekret.

Sprawdzenie (po ok. minucie, gdy Caddy dostanie certyfikat):

```bash
curl https://osadnicy.duckdns.org/health
```

Oczekiwana odpowiedź: `{"ok":true,"rooms":0,"peers":0}`.

Przydatne polecenia na serwerze:

```bash
journalctl -u osadnicy-signal -n 50
```

```bash
sudo systemctl restart osadnicy-signal coturn caddy
```

**Opcjonalnie:** ograniczenie połączeń do strony gry — w `/etc/osadnicy.env` ustaw
`ALLOWED_ORIGINS=https://lagsters.github.io` i zrestartuj `osadnicy-signal`.

## 6. Adres serwera w grze

W repozytorium na GitHubie: **Settings → Secrets and variables → Actions → Variables → New repository
variable**:

- nazwa: `SIGNAL_URL`
- wartość: `wss://osadnicy.duckdns.org`

Build w CI wstawia ją do klienta (`VITE_SIGNAL_URL`). Alternatywnie możesz wpisać adres na stałe
w `client/config.ts`.

## 7. GitHub Pages

Pages jest już włączone w trybie **GitHub Actions** (Settings → Pages → Source: GitHub Actions).
Po zmianie zmiennej z kroku 6 uruchom workflow ponownie: **Actions → CI → Run workflow**
(albo zrób dowolny push na `main`). Po zielonym przebiegu gra jest pod
`https://lagsters.github.io/Villagers/`.

Jeśli repozytorium ma inną nazwę albo własną domenę, CI samo ustawia ścieżkę bazową
(`BASE=/<nazwa-repozytorium>/`). Dla własnej domeny w katalogu głównym ustaw w workflow `BASE: /`.

---

## Uruchomienie lokalne (bez serwera w chmurze)

```bash
npm install
```

```bash
npm run server
```

```bash
npm run dev
```

Klient na `localhost` łączy się z `ws://localhost:8787` bez TLS. Grę wieloosobową sprawdzisz w dwóch
kartach przeglądarki (w obu „Gra wieloosobowa”: w jednej „Utwórz pokój”, w drugiej kod pokoju).

## Rozwiązywanie problemów

- **„Nie można połączyć się z serwerem sygnalizacyjnym”** — sprawdź `curl https://domena/health`,
  zmienną `SIGNAL_URL` i czy workflow po jej ustawieniu przebudował stronę.
- **Lobby się łączy, ale gra nie startuje u części graczy** — zwykle NAT bez TURN: sprawdź porty
  3478 (TCP/UDP) i 49160-49200 (UDP) w Security List oraz `journalctl -u coturn`.
- **Certyfikat się nie wystawia** — port 80 musi być otwarty, a DNS musi wskazywać na maszynę.
- Diagnostyka połączeń w przeglądarce: w konsoli `localStorage.debugNet = '1'` i odśwież stronę.
