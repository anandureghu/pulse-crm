# AWS EC2 + Domain Setup (Evolution API)

Step-by-step guide to recreate the Pulse CRM WhatsApp gateway on a new AWS account.  
Stack lives in `vps/` — Docker Compose + Nginx + Let’s Encrypt.

**Last known production shape**

| Item | Value |
|------|--------|
| Hostname | `pulseevo.picominds.com` (or your subdomain) |
| OS | Ubuntu 22.04 LTS |
| App dir on server | `~/whatsapp-crm` |
| Public URL | `https://<DOMAIN>/` |

---

## Checklist (high level)

1. Create EC2 instance (Ubuntu, enough disk)
2. Allocate + attach an **Elastic IP** (stable / non-changing public IP) — **before** DNS
3. Open ports **80 / 443** in the security group
4. Point DNS **A record** → Elastic IP **once** (no remap when the instance stops/starts)
5. Install Docker, copy `vps/`, fill `.env`
6. Run `./init-ssl.sh` once
7. Point CRM / Supabase at the new Evolution URL + API key

---

## 1. Launch EC2

AWS Console → **EC2** → **Launch instance**.

| Setting | Recommendation |
|---------|----------------|
| Name | `pulse-evolution` (anything) |
| AMI | **Ubuntu Server 22.04 LTS** |
| Instance type | `t3.small` or better (2 GB RAM min; 4 GB preferred) |
| Key pair | Create/download a `.pem` — keep it safe |
| Storage | **≥ 20 GB** gp3 (do not use ~8 GB — disk fills and Docker dies) |
| Network | Default VPC is fine |

### Security group (inbound)

Create a security group (or edit the default one):

| Type | Port | Source | Notes |
|------|------|--------|--------|
| SSH | 22 | *My IP* | Prefer locking to your IP |
| HTTP | 80 | `0.0.0.0/0` | Needed for Let’s Encrypt + redirects |
| HTTPS | 443 | `0.0.0.0/0` | Public Evolution API |

Outbound: leave default (all).

Launch the instance, then note the **Instance ID** and wait until **Status check = 2/2**.

The instance may show a temporary public IPv4 — **ignore it for DNS**. Use the Elastic IP from the next step instead.

---

## 2. Elastic IP — stable public IP (required)

**Why:** A normal EC2 public IP is ephemeral. If the instance **stops, crashes, or is restarted**, AWS often assigns a **new** public IP. Then `pulseevo…` keeps pointing at the old address and the site looks “down” until you update DNS.

An **Elastic IP** is a fixed public IPv4 you own in the account. Associate it with the instance once; when the instance comes back up, the **same IP** returns. **Domain mapping does not need to change.**

We used this in the previous account for exactly that reason.

### Allocate and attach

1. EC2 → **Network & Security** → **Elastic IPs** → **Allocate Elastic IP address** → Allocate  
2. Select the new address → **Actions** → **Associate Elastic IP address**  
3. Resource type: **Instance** → pick your Evolution instance → Associate  

Copy the Elastic IP (e.g. `13.x.x.x`). This is the only IP you put in DNS.

### Rules of thumb

- Point the domain A record at the **Elastic IP**, never at the random public IP shown at launch.
- Keep the Elastic IP **associated** with this instance. If you release it or leave it unassociated while the instance runs, you can lose the stable mapping (and unused EIPs can incur a small charge).
- Moving to a **new** EC2 later: Associate the **same** Elastic IP with the new instance → DNS stays valid, no domain update.

---

## 3. Map the domain (DNS A record) — once

At your DNS host (wherever `picominds.com` or your domain is managed):

| Type | Name / Host | Value | TTL |
|------|-------------|--------|-----|
| **A** | `pulseevo` (or `evo`) | *Elastic IP from step 2* | 300 or Auto |

Full hostname example: `pulseevo.picominds.com`.

Because DNS points at the Elastic IP, **you do not re-edit this record** when the instance goes down and comes back up.

Wait until DNS resolves:

```bash
csdig +short pulseevo.picominds.com A
# must print your Elastic IP
```

Do **not** run SSL bootstrap until this matches.

---

## 4. SSH into the instance

```bash
chmod 400 /path/to/your-key.pem
ssh -i /path/to/your-key.pem ubuntu@YOUR_ELASTIC_IP
```

Ubuntu AMIs use user `ubuntu` (not `ec2-user`).

Optional: Session Manager if the instance has an IAM role with SSM — then no SSH key needed.

---

## 5. Install Docker on the EC2 box

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
```

Optional firewall (UFW) — security group already restricts traffic, but this is fine too:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## 6. Upload the `vps/` stack

From your **laptop** (repo root):

```bash
scp -i /path/to/your-key.pem -r vps/ ubuntu@YOUR_ELASTIC_IP:~/whatsapp-crm/
```

On the **EC2** box:

```bash
cd ~/whatsapp-crm
ls
# expect: docker-compose.yml  init-ssl.sh  nginx/  .env.example  README.md
```

---

## 7. Configure `.env`

```bash
cd ~/whatsapp-crm
cp .env.example .env
nano .env
```

Fill in (Compose reads `KEY=value` — **do not** prefix lines with `export`):

```bash
DOMAIN=pulseevo.picominds.com
EVOLUTION_API_KEY=<openssl rand -hex 32>
POSTGRES_PASSWORD=<openssl rand -hex 24>
REDIS_PASSWORD=<openssl rand -hex 24>
WEBHOOK_URL=https://<supabase-project-ref>.supabase.co/functions/v1/evolution-webhook
```

Generate secrets on the box:

```bash
echo "EVOLUTION_API_KEY=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
```

Save `EVOLUTION_API_KEY` somewhere safe — the CRM / Edge Functions need the same key.

---

## 8. First-time SSL + start stack

```bash
cd ~/whatsapp-crm
chmod +x init-ssl.sh
./init-ssl.sh
```

This script:

1. Patches Nginx with your `DOMAIN`
2. Starts HTTP-only Nginx for ACME
3. Issues a Let’s Encrypt cert
4. Restores HTTPS config
5. Starts the full Compose stack

Verify:

```bash
docker compose ps
curl -sS https://pulseevo.picominds.com/
# expect Evolution welcome JSON
```

From the box (if external curl fails, check SG / DNS):

```bash
curl -sS https://127.0.0.1/ \
  -H "Host: pulseevo.picominds.com" \
  --resolve pulseevo.picominds.com:443:127.0.0.1
```

---

## 9. Wire the CRM to the new server

Update wherever Evolution is configured (app settings / Supabase secrets / env):

| Setting | Value |
|---------|--------|
| Evolution API URL | `https://pulseevo.picominds.com` |
| API key | same as `EVOLUTION_API_KEY` in `.env` |
| Webhook | already set in compose via `WEBHOOK_URL` |

Reconnect WhatsApp instances in Evolution (QR) after a fresh Postgres volume.

---

## Day-to-day (after first setup)

```bash
cd ~/whatsapp-crm

docker compose up -d          # start / restart
docker compose ps
docker compose logs -f evolution
docker compose logs -f nginx

docker compose pull evolution # update Evolution image
docker compose up -d evolution
```

**Do not** run `./init-ssl.sh` again for normal restarts — only when certs/domain need a full re-bootstrap. Certbot container renews certs automatically.

Stop without deleting data:

```bash
docker compose down            # keeps volumes
# never use docker compose down -v in prod unless you intend to wipe DB + sessions + certs
```

More ops detail: [`vps/README.md`](../vps/README.md).

---

## Troubleshooting

### Domain doesn’t open (timeout on 80/443)

1. Security group: inbound **80** and **443** from `0.0.0.0/0`
2. DNS A record = **current Elastic IP**
3. On EC2: `docker compose ps` — `crm_nginx` healthy, ports `80`/`443` published

```bash
curl -sS http://checkip.amazonaws.com/   # should match Elastic IP + DNS
dig +short YOUR_DOMAIN A
```

### Public IP changed after reboot / domain “down” after stop-start

You either skipped the Elastic IP, or the association broke. Fix:

1. Associate (or re-associate) the **Elastic IP** with the instance  
2. Confirm `dig +short YOUR_DOMAIN A` still equals that Elastic IP  
3. Only update the A record if DNS was pointed at the old ephemeral IP by mistake  

With Elastic IP correctly associated, stop/start should **not** require a domain change.

### Disk full / Docker won’t start

Symptoms: `No space left on device`, Docker daemon down, root ~100%.

```bash
df -h
sudo journalctl --vacuum-size=100M
sudo apt-get clean
docker system prune -f   # careful: removes unused images/containers
```

Resize the EBS volume in AWS (modify volume → grow filesystem) if still tight. Target **≥ 20 GB**.

### Postgres “recovery” / Evolution 500

```bash
docker compose logs --tail=80 postgres
# wait until: database system is ready to accept connections
docker compose restart evolution
```

### Re-issue SSL (domain change or cert lost)

```bash
cd ~/whatsapp-crm/vps
# Confirm DOMAIN in .env matches DNS
grep DOMAIN .env
docker compose down            # no -v
./init-ssl.sh
```

---

## Migrate local Evolution → prod (DB + WhatsApp sessions)

Postgres dump alone is **not enough**. WhatsApp auth lives in the Docker volume `evolution_instances`.

**Rule:** stop **local** Evolution before copying sessions, or WhatsApp will keep the session on the laptop and prod stays `connecting`.

### On Mac (local)

```bash
cd /path/to/pulse-crm/vps

# 1) Stop local so sessions are released
docker compose -f docker-compose.local.yml stop evolution

# 2) Dump Postgres
docker exec evolution_postgres pg_dump -U evolution -d evolution -Fc -f /tmp/evolution.dump
docker cp evolution_postgres:/tmp/evolution.dump /tmp/evolution-local.dump

# 3) Pack session volume
docker run --rm -v vps_evolution_instances:/from -v /tmp:/to alpine \
  sh -c 'cd /from && tar czf /to/evolution-instances-local.tgz .'

# 4) Upload both
scp -i ~/Documents/pulse-evo.pem \
  /tmp/evolution-local.dump \
  /tmp/evolution-instances-local.tgz \
  ubuntu@YOUR_ELASTIC_IP:/tmp/
```

### On EC2 (prod)

```bash
cd ~/whatsapp-crm/vps
docker compose stop evolution

# Restore DB
docker cp /tmp/evolution-local.dump crm_postgres:/tmp/evolution-local.dump
docker compose exec -T postgres psql -U evolution -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='evolution' AND pid <> pg_backend_pid();"
docker compose exec -T postgres pg_restore -U evolution -d evolution \
  --clean --if-exists --no-owner --no-acl /tmp/evolution-local.dump

# Restore sessions
docker run --rm -v vps_evolution_instances:/data -v /tmp:/tmp alpine \
  sh -c 'rm -rf /data/* /data/.[!.]* 2>/dev/null; tar xzf /tmp/evolution-instances-local.tgz -C /data'

docker compose start evolution
# Wait ~15s, then check: connectionStatus should become "open"
# If still "connecting", open Settings → QR and scan (WhatsApp sometimes invalidates moved sessions)
```

Keep **local Evolution stopped** while using prod, or you’ll fight over the same WhatsApp device again.

---

## Quick recreate card

```text
1. Launch Ubuntu 22.04 EC2 (≥20 GB disk, t3.small+)
2. SG: 22 (my IP), 80 + 443 (0.0.0.0/0)
3. Allocate + associate Elastic IP  ← stable IP; DNS set once, no remap on reboot
4. DNS A → Elastic IP only  (wait dig match)
5. ssh ubuntu@ELASTIC_IP
6. Install Docker
7. scp vps/ → ~/whatsapp-crm
8. cp .env.example .env  (DOMAIN, keys, WEBHOOK_URL — no "export")
9. ./init-ssl.sh
10. curl https://DOMAIN/  → update CRM Evolution URL + API key
```
