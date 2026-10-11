# Publikacja: GitHub Pages + serwer lobby na api.kwasnypp.ovh

Gra składa się z dwóch części:

1. **Klient** (pliki statyczne) — publikowany automatycznie na GitHub Pages przez GitHub Actions przy każdym
   pushu na `main`. Adres: `https://lagsters.github.io/Villagers/`.
2. **Serwer lobby** (`server/signal.ts`) — kojarzy graczy: kody pokoi i wymiana opisów połączeń WebRTC.
   Stoi pod `wss://api.kwasnypp.ovh/osada/` na maszynie Oracle Cloud właściciela. Nie liczy symulacji i nie
   widzi ruchu gry: po zestawieniu połączeń gracze rozmawiają ze sobą bezpośrednio (szyfrowane DTLS).

Gra z botami działa bez serwera. Serwer jest potrzebny tylko do gry wieloosobowej.

## Jak serwer trafia na maszynę

Konfiguracja maszyny jest w prywatnym repozytorium `pkwasny/vps01` (ponumerowane kroki, rejestr wykonań na
serwerze). Serwer lobby obsługują kroki `0016`–`0018`: konto `osada`, Node.js z nodejs.org (przypięta
wersja i suma SHA-256), usługa systemd `osada-signal` na `127.0.0.1:8787` za nginx (TLS, `/osada/`).
Krok `0020` stawia przekaźnik TURN (niżej).

1. **Wydanie serwera** — tag `signal-v<n>` w tym repozytorium uruchamia `.github/workflows/signal.yml`:
   testy serwera, `npm run build:server` (jeden plik `osada-signal.cjs`, razem z biblioteką `ws`) i wydanie
   z plikiem oraz jego sumą SHA-256.
2. **Wpis w `vps01`** — numer wydania i sumę wpisuje się w `files/osada/versions.env`. Serwer pobiera plik
   z wydania i odrzuca go, gdy suma się nie zgadza.
3. **Wdrożenie** — maszyna co 2 minuty pobiera zmiany z `main` repozytorium `vps01` (kluczem tylko do
   odczytu) i wykonuje nowe kroki. Stan ostatniego przebiegu: `https://api.kwasnypp.ovh/deploy-status`.

Ustawienia usługi (`/etc/osada/signal.env`, składane z `config.env` w `vps01`):

| Zmienna | Znaczenie |
|---|---|
| `PORT`, `HOST` | nasłuch, na serwerze `127.0.0.1:8787` |
| `ALLOWED_ORIGINS` | strony, z których wolno się łączyć (`https://lagsters.github.io`) |
| `TRUST_PROXY=1` | adres gracza z nagłówka `X-Real-IP` ustawianego przez nginx (limit 16 połączeń na adres) |
| `TURN_SECRET`, `TURN_URLS` | przekaźnik TURN (coturn, `use-auth-secret`); na serwerze w osobnym `/etc/osada/turn.env` (krok `0020`) |

Sprawdzenie: `curl https://api.kwasnypp.ovh/osada/health` → `{"ok":true,"rooms":0,"peers":0}`.

## Adres serwera w grze

Klient poza `localhost` łączy się z `wss://api.kwasnypp.ovh/osada/` (`client/config.ts`). Inny adres można
podać zmienną repozytorium `SIGNAL_URL` (Settings → Secrets and variables → Actions → Variables) — CI
wstawia ją do builda jako `VITE_SIGNAL_URL`.

## GitHub Pages

Pages działa w trybie **GitHub Actions** (Settings → Pages → Source: GitHub Actions). CI samo ustawia ścieżkę
bazową (`BASE=/<nazwa-repozytorium>/`); dla własnej domeny w katalogu głównym ustaw w workflow `BASE: /`.

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

## Przekaźnik TURN

Gracze łączą się bezpośrednio (STUN). Za restrykcyjnym NAT-em (część sieci firmowych i komórkowych)
połączenie bezpośrednie się nie zestawi - wtedy ruch gry idzie przez przekaźnik coturn na tej samej maszynie
(`turn:api.kwasnypp.ovh:3478`, UDP i TCP). Serwer lobby daje każdemu graczowi w powitaniu krótkotrwałe hasło
(HMAC z sekretem wspólnym z coturn, ważne 6 godzin); sekret powstaje na serwerze i nie ma go w żadnym
repozytorium. Przekaźnik nie przekazuje ruchu do adresów prywatnych, samej maszyny ani metadanych chmury, nie
przekazuje TCP do celu i ma limity przepustowości i przydziałów. Porty: UDP i TCP 3478, UDP 49160–49359
(iptables na maszynie i Security List w konsoli Oracle).

Nie przejdą tylko sieci przepuszczające wyłącznie HTTPS na porcie 443 (zajmuje go nginx).

## Rozwiązywanie problemów

- **„Nie można połączyć się z serwerem sygnalizacyjnym”** — sprawdź `/osada/health` i `/deploy-status`.
- **Lobby się łączy, ale gra nie startuje u części graczy** — sieć blokuje też przekaźnik (wyżej); sprawdź,
  czy powitanie lobby zawiera adresy `turn:` (diagnostyka niżej).
- Diagnostyka połączeń w przeglądarce: w konsoli `localStorage.debugNet = '1'` i odśwież stronę.
