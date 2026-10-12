#!/usr/bin/env bash
# Installs or updates QIC as a systemd service on Ubuntu/Debian.
# Usage (from the repo folder): sudo bash deploy/install.sh [port]
set -euo pipefail

PORT="${1:-80}"
APP_DIR=/opt/qic
DATA_DIR=/var/lib/qic
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash deploy/install.sh" >&2
  exit 1
fi

echo "==> Checking Node.js"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  apt-get update
  apt-get install -y curl ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y python3 make g++ >/dev/null 2>&1 || true

echo "==> Copying app to $APP_DIR"
mkdir -p "$APP_DIR"
rm -rf "$APP_DIR/public" "$APP_DIR/src"
cp -r "$SRC_DIR/package.json" "$SRC_DIR/package-lock.json" "$SRC_DIR/server.js" \
      "$SRC_DIR/src" "$SRC_DIR/public" "$APP_DIR/"
cd "$APP_DIR"
npm ci --omit=dev

echo "==> Creating service user and data folder"
id qic >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin qic
mkdir -p "$DATA_DIR"
chown -R qic:qic "$DATA_DIR"

cat > /etc/systemd/system/qic.service <<EOF
[Unit]
Description=QIC Messenger
After=network.target

[Service]
User=qic
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT
Environment=DATA_DIR=$DATA_DIR
Environment=NODE_ENV=production
AmbientCapabilities=CAP_NET_BIND_SERVICE
ExecStart=$(command -v node) server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable qic >/dev/null
systemctl restart qic

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow "$PORT"/tcp
fi

sleep 2
if systemctl is-active --quiet qic; then
  IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  URL="http://$IP"; [ "$PORT" != "80" ] && URL="$URL:$PORT"
  echo ""
  echo "QIC is running: $URL"
else
  echo "QIC failed to start. Logs:" >&2
  journalctl -u qic -n 30 --no-pager >&2
  exit 1
fi
