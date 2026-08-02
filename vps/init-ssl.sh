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
sed -i "s/YOUR_DOMAIN/$DOMAIN/g" nginx/conf.d/evolution.conf

# ── 2. Start Nginx on HTTP only (no cert yet) ─────────────────────────────────
# Temporarily serve HTTP so Certbot can complete the ACME challenge.
cat > nginx/conf.d/_bootstrap.conf << EOF
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 200 'bootstrapping...';
        add_header Content-Type text/plain;
    }
}
EOF

echo ">>> Starting Nginx for ACME challenge..."
docker compose up -d nginx

sleep 3

# ── 3. Request certificate ────────────────────────────────────────────────────
echo ">>> Requesting TLS certificate from Let's Encrypt..."
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

# ── 4. Remove bootstrap config and reload Nginx with full HTTPS config ────────
echo ">>> Removing bootstrap config, loading full HTTPS config..."
rm nginx/conf.d/_bootstrap.conf

docker compose exec nginx nginx -s reload

# ── 5. Bring up the full stack ────────────────────────────────────────────────
echo ">>> Starting full stack..."
docker compose up -d

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
