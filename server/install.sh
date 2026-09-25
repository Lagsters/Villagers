#!/usr/bin/env bash
# =============================================================================
# Osadnicy Doliny - instalacja serwera sygnalizacyjnego + TURN na Ubuntu (Oracle Cloud Free Tier).
#
# Uzycie (na serwerze, jako uzytkownik z sudo):
#   sudo DOMAIN=twoja-nazwa.duckdns.org EMAIL=ty@example.com bash install.sh
#
# Co robi:
#   - instaluje Node.js 24, coturn, Caddy (reverse proxy z automatycznym TLS od Let's Encrypt),
#   - kopiuje serwer sygnalizacyjny do /opt/osadnicy i tworzy usluge systemd "osadnicy-signal",
#   - konfiguruje coturn (use-auth-secret) ze wspolnym sekretem, ktory zna tez serwer sygnalizacyjny,
#   - otwiera porty w iptables (Oracle ma domyslnie zamkniete wszystko poza SSH) i zapisuje reguly.
# Skrypt mozna uruchomic ponownie (np. po aktualizacji) - zachowa istniejacy sekret TURN.
# =============================================================================
set -euo pipefail

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
SIGNAL_PORT="${SIGNAL_PORT:-8787}"
TURN_PORT="${TURN_PORT:-3478}"
TURN_MIN_PORT="${TURN_MIN_PORT:-49160}"
TURN_MAX_PORT="${TURN_MAX_PORT:-49200}"
APP_DIR=/opt/osadnicy
ENV_FILE=/etc/osadnicy.env
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Uruchom przez sudo." >&2
  exit 1
fi
if [[ -z "$DOMAIN" ]]; then
  echo "Podaj domene: sudo DOMAIN=nazwa.duckdns.org EMAIL=adres bash install.sh" >&2
  exit 1
fi

echo "==> Pakiety systemowe"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https \
  coturn iptables-persistent openssl

echo "==> Node.js 24"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Sekret TURN i plik srodowiskowy"
if [[ -f "$ENV_FILE" ]] && grep -q '^TURN_SECRET=' "$ENV_FILE"; then
  TURN_SECRET="$(grep '^TURN_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
else
  TURN_SECRET="$(openssl rand -hex 32)"
fi
PUBLIC_IP="$(curl -fsS https://api.ipify.org || true)"
PRIVATE_IP="$(hostname -I | awk '{print $1}')"
cat > "$ENV_FILE" <<EOF
PORT=$SIGNAL_PORT
HOST=127.0.0.1
TURN_SECRET=$TURN_SECRET
TURN_URLS=turn:$DOMAIN:$TURN_PORT?transport=udp,turn:$DOMAIN:$TURN_PORT?transport=tcp
ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-}
EOF
chmod 640 "$ENV_FILE"

echo "==> Serwer sygnalizacyjny w $APP_DIR"
id -u osadnicy >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin osadnicy
mkdir -p "$APP_DIR/server"
cp "$SRC_DIR/signal.ts" "$APP_DIR/server/signal.ts"
cat > "$APP_DIR/package.json" <<'EOF'
{ "name": "osadnicy-signal", "private": true, "type": "module", "dependencies": { "ws": "^8.21.3" } }
EOF
(cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund)
chown -R osadnicy:osadnicy "$APP_DIR"
chgrp osadnicy "$ENV_FILE"

cat > /etc/systemd/system/osadnicy-signal.service <<EOF
[Unit]
Description=Osadnicy Doliny - serwer sygnalizacyjny WebRTC
After=network-online.target
Wants=network-online.target

[Service]
User=osadnicy
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $APP_DIR/server/signal.ts
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

echo "==> coturn"
sed "s|__TURN_SECRET__|$TURN_SECRET|; s|__REALM__|$DOMAIN|; s|__PORT__|$TURN_PORT|; s|__MIN_PORT__|$TURN_MIN_PORT|; s|__MAX_PORT__|$TURN_MAX_PORT|; s|__EXTERNAL_IP__|${PUBLIC_IP:-}/${PRIVATE_IP:-}|" \
  "$SRC_DIR/turnserver.conf" > /etc/turnserver.conf
if [[ -z "$PUBLIC_IP" ]]; then sed -i '/^external-ip=/d' /etc/turnserver.conf; fi
sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || true

echo "==> Caddy (TLS + reverse proxy na serwer sygnalizacyjny)"
sed "s|__DOMAIN__|$DOMAIN|; s|__EMAIL__|${EMAIL:-}|; s|__PORT__|$SIGNAL_PORT|" "$SRC_DIR/Caddyfile" > /etc/caddy/Caddyfile
if [[ -z "$EMAIL" ]]; then sed -i '/^\s*email\s*$/d; /email __/d' /etc/caddy/Caddyfile; fi

echo "==> Zapora (iptables)"
# Oracle Ubuntu ma w INPUT regule REJECT na koncu - nowe reguly wstawiamy przed nia (inaczej na koniec).
allow() {
  local proto="$1" port="$2"
  iptables -C INPUT -p "$proto" --dport "$port" -j ACCEPT 2>/dev/null && return 0
  local pos
  pos="$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')"
  if [[ -n "$pos" ]]; then
    iptables -I INPUT "$pos" -p "$proto" --dport "$port" -j ACCEPT
  else
    iptables -A INPUT -p "$proto" --dport "$port" -j ACCEPT
  fi
}
allow tcp 80
allow tcp 443
allow tcp "$TURN_PORT"
allow udp "$TURN_PORT"
allow udp "$TURN_MIN_PORT:$TURN_MAX_PORT"
netfilter-persistent save

echo "==> Uruchamianie uslug"
systemctl daemon-reload
systemctl enable --now osadnicy-signal
systemctl enable coturn
systemctl restart coturn
systemctl enable caddy
systemctl restart caddy

sleep 2
echo
echo "Gotowe."
echo "  Healthcheck lokalnie:  curl -s http://127.0.0.1:$SIGNAL_PORT/health"
echo "  Healthcheck z sieci:   https://$DOMAIN/health   (certyfikat TLS moze pojawic sie po minucie)"
echo "  Adres dla gry (zmienna SIGNAL_URL w GitHub):  wss://$DOMAIN"
curl -s "http://127.0.0.1:$SIGNAL_PORT/health" || echo "(serwer jeszcze startuje - sprawdz: journalctl -u osadnicy-signal -n 50)"
echo
