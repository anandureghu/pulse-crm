#!/bin/bash
# Run this ONCE on first deploy to obtain the Let's Encrypt certificate.
# After this, the certbot service handles automatic renewals every 12 hours.
#
# Usage:
#   chmod +x init-ssl.sh
#   ./init-ssl.sh

set -euo pipefail

# ── Load env ─────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example and fill it in first."
  exit 1
fi
source .env

if [ -z "${DOMAIN:-}" ] || [ "$DOMAIN" = "evo.yourdomain.com" ]; then
  echo "ERROR: Set DOMAIN in .env to your real domain before running this."
  exit 1
fi

EMAIL="${CERTBOT_EMAIL:-admin@${DOMAIN}}"

echo ">>> Domain : $DOMAIN"
echo ">>> Email  : $EMAIL"
echo ""

# ── 1. Patch YOUR_DOMAIN placeholder in nginx config ─────────────────────────
echo ">>> Patching nginx config with domain: $DOMAIN"

# Restore config if a previous failed run left it in disabled/
if [ ! -f nginx/conf.d/evolution.conf ] && [ -f nginx/conf.d/disabled/evolution.conf ]; then
  mv nginx/conf.d/disabled/evolution.conf nginx/conf.d/evolution.conf
fi
if [ ! -f nginx/conf.d/evolution.conf ]; then
  echo "ERROR: nginx/conf.d/evolution.conf is missing. Re-copy the vps/nginx folder from the repo."
  exit 1
fi
sed -i "s/YOUR_DOMAIN/$DOMAIN/g" nginx/conf.d/evolution.conf
# ── 2. Start Nginx on HTTP only (no cert yet) ─────────────────────────────────
# Temporarily hide HTTPS config (certs don't exist yet) and serve ACME only.
echo ">>> Preparing HTTP-only bootstrap config..."
mkdir -p nginx/conf.d/disabled
if [ -f nginx/conf.d/evolution.conf ]; then
  mv nginx/conf.d/evolution.conf nginx/conf.d/disabled/evolution.conf
fi

cat > nginx/conf.d/_bootstrap.conf << EOF
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 200 'bootstrapping SSL...';
        add_header Content-Type text/plain;
    }
}
EOF

echo ">>> Starting Nginx for ACME challenge (no deps)..."
docker compose up -d --no-deps nginx

sleep 3

# ── 3. Request certificate ────────────────────────────────────────────────────
echo ">>> Requesting TLS certificate from Let's Encrypt..."
# Override the renew-loop entrypoint from docker-compose.yml
docker compose run --rm --entrypoint certbot certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

# ── 4. Restore full HTTPS config and bring stack up before nginx reload ───────
echo ">>> Restoring HTTPS nginx config..."
rm -f nginx/conf.d/_bootstrap.conf
if [ -f nginx/conf.d/disabled/evolution.conf ]; then
  mv nginx/conf.d/disabled/evolution.conf nginx/conf.d/evolution.conf
fi

echo ">>> Starting full stack (Evolution must be up for nginx upstream)..."
docker compose up -d

echo ">>> Reloading Nginx with HTTPS config..."
sleep 3
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload

echo ""
echo "✅ Done! Evolution API is live at https://$DOMAIN"
echo ""
echo "Next steps:"
echo "  1. Set webhook in Evolution dashboard:"
echo "     URL: $WEBHOOK_URL"
echo "     Events: messages.upsert, messages.update"
echo ""
echo "  2. Open the CRM → Settings → Get QR Code → scan with WhatsApp"
echo ""
echo "Certbot will auto-renew the certificate every 12 hours."
