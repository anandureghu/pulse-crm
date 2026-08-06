# VPS Setup — Evolution API + Nginx + HTTPS

## What this stack runs

| Container | Image | Purpose |
|---|---|---|
| `crm_evolution` | `evoapicloud/evolution-api:latest` | WhatsApp gateway |
| `crm_postgres` | `postgres:16-alpine` | Evolution's database |
| `crm_redis` | `redis:7-alpine` | Session cache |
| `crm_nginx` | `nginx:1.25-alpine` | Reverse proxy + TLS termination |
| `crm_certbot` | `certbot/certbot` | Auto-renewing Let's Encrypt certs |

## VPS requirements

- **OS**: Ubuntu 22.04 LTS (recommended)
- **RAM**: 2 GB minimum, 4 GB recommended
- **CPU**: 2 vCPU minimum
- **Disk**: 20 GB+
- **Ports open**: 80, 443
- **Domain**: An A record pointing to the VPS IP (e.g. `evo.yourdomain.com → 1.2.3.4`)

## First-time deploy

### 1. On your VPS — install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Upload these files to your VPS

```bash
# From your local machine
scp -r vps/ user@YOUR_VPS_IP:~/whatsapp-crm/
ssh user@YOUR_VPS_IP
cd ~/whatsapp-crm
```

### 3. Configure environment

```bash
cp .env.example .env
nano .env   # fill in all values
```

Required values:

| Variable | Example | Notes |
|---|---|---|
| `DOMAIN` | `evo.yourdomain.com` | Must have DNS A record → VPS IP |
| `EVOLUTION_API_KEY` | `abc123...` | Run: `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | `xyz789...` | Run: `openssl rand -hex 24` |
| `REDIS_PASSWORD` | `def456...` | Run: `openssl rand -hex 24` |
| `WEBHOOK_URL` | `https://<project-ref>.supabase.co/functions/v1/evolution-webhook` | From `supabase functions deploy` output |

### 4. Generate passwords quickly

```bash
echo "EVOLUTION_API_KEY=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
```

### 5. Run the SSL bootstrap (first time only)

```bash
chmod +x init-ssl.sh
./init-ssl.sh
```

This will:
1. Patch your domain into the Nginx config
2. Start Nginx on port 80
3. Use Certbot to issue a Let's Encrypt certificate
4. Reload Nginx with HTTPS
5. Start the full stack

### 6. Verify everything is running

```bash
docker compose ps
# All containers should show "healthy" or "running"

curl https://evo.yourdomain.com/   
# Should return Evolution API JSON response
```

## Day-to-day commands

```bash
# View logs
docker compose logs -f evolution
docker compose logs -f nginx

# Restart Evolution after config change
docker compose restart evolution

# Stop everything
docker compose down

# Start everything
docker compose up -d

# Force certificate renewal (normally automatic)
docker compose run --rm certbot renew

# Update Evolution API to latest version
docker compose pull evolution
docker compose up -d evolution
```

## Updating Evolution API version

```bash
docker compose pull evolution
docker compose up -d evolution
```

Image: `evoapicloud/evolution-api:latest` (same as local compose).
## Firewall (UFW)

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (for ACME renewal)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

## File structure

```
vps/
├── docker-compose.yml     # All services
├── .env.example           # Environment template
├── .env                   # Your secrets (never commit this)
├── init-ssl.sh            # First-time SSL bootstrap
└── nginx/
    ├── nginx.conf         # Global Nginx config
    └── conf.d/
        └── evolution.conf # Domain config + proxy rules
```
