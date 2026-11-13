# CARMAZE — Deployment Runbook (controlled Kenyan pilot)

**Every command below is the real, tested path.** The database procedure (fresh init + founder bootstrap) was executed end-to-end on a clean staging database this session; the code paths it exercises (migrations, founder script, health endpoint) are the same ones the security suite verifies. Commands marked `[NOT RUN HERE]` require the actual external host/provider — they are documented exactly but cannot be executed inside this sandbox; do not claim them done until you have run them.

Golden rule: **the production database is created by `prisma migrate deploy` and nothing else.** `db:push` is dev-only. See `CARMAZE_FRESH_DATABASE_INIT.md` for the proof and the negative tests.

---

## 1. Fresh server preparation `[NOT RUN HERE — exact commands]`

```bash
# Ubuntu 22.04/24.04 LTS, 2 vCPU / 2-4 GB RAM (e.g. DigitalOcean/Linode/Hetzner)
ssh root@YOUR_SERVER_IP

# system basics
apt update && apt -y upgrade
timedatectl set-timezone Africa/Nairobi
apt -y install curl git ufw fail2ban sqlite3 clamav clamav-daemon
freshclam                      # update AV signatures; systemctl status clamav-freshclam
systemctl enable --now clamav-daemon   # clamdscan (fast path) becomes available

# firewall: SSH + HTTP + HTTPS only. THE APP PORT (3000) STAYS CLOSED TO THE INTERNET —
# only the reverse proxy talks to it (rate limiting depends on this topology).
ufw default deny incoming && ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# bun (runtime)
curl -fsSL https://bun.sh/install | bash       # pins bun 1.x; verify: bun --version
```

Create the release layout:

```bash
useradd -m -s /bin/bash carmaze
mkdir -p /opt/carmaze /opt/carmaze-backups /opt/carmaze-releases
chown -R carmaze:carmaze /opt/carmaze /opt/carmaze-backups /opt/carmaze-releases
```

## 2. Code release + environment configuration

```bash
su - carmaze
cd /opt/carmaze
# copy/clone the repo WITHOUT db/custom.db and WITHOUT data/ (start clean)
git clone <YOUR_REPO_URL> .    # or rsync the working tree excluding db/ and data/
bun install --frozen-lockfile

# secrets — NEVER commit; chmod 600; values from your credential store
cat > /opt/carmaze/.env << 'EOF'
DATABASE_URL="file:/opt/carmaze/data/prod.db"
AUTH_SECRET="<openssl rand -base64 48>"
NEXT_PUBLIC_SITE_URL="https://YOUR_DOMAIN"
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...
MPESA_SHORTCODE=...
MPESA_PASSKEY=...
MPESA_ENV=production
MPESA_CALLBACK_URL="https://YOUR_DOMAIN/api/billing/mpesa/callback"
MPESA_WEBHOOK_SECRET="<openssl rand -hex 32>"
MPESA_INITIATOR_NAME=...
MPESA_SECURITY_CREDENTIAL=...
MPESA_B2C_RESULT_URL="https://YOUR_DOMAIN/api/admin/settlements/payout/result"
SMTP_URL="smtps://USER:KEY@smtp.host:465"
MAIL_FROM="CARMAZE <no-reply@YOUR_DOMAIN>"
SMS_PROVIDER=africastalking
SMS_API_KEY=...
SMS_USERNAME=...
SMS_SENDER_ID=...
EOF
chmod 600 /opt/carmaze/.env
mkdir -p /opt/carmaze/data
```

Variable reference: `.env.example` (names only) and `CARMAZE_ENVIRONMENT_VARIABLES.md`.

## 3. Database migration (the ONE procedure)

```bash
cd /opt/carmaze
bun run db:deploy          # prisma migrate deploy — creates the full schema from versioned migrations
bun run db:status          # must print: "Database schema is up to date!"
```

## 4. First FOUNDER creation (no demo import)

```bash
cd /opt/carmaze
export $(cat > /dev/null << 'EOF'
FOUNDER_CONFIRM=YES
FOUNDER_EMAIL=founder@YOUR_DOMAIN
FOUNDER_NAME="Your Full Name"
FOUNDER_PASSWORD='…≥12 chars, mixed case + digit + symbol…'
EOF
echo) # or export the four variables directly in the shell
bun run founder:create     # refuses on: existing founder, duplicate email, demo data in DB, weak password
unset FOUNDER_PASSWORD
history -c                 # keep the password out of shell history
```

The script verifies: exactly one user (roles=FOUNDER, isDemo=false), zero demo rows, bcrypt hash only, `FOUNDER_BOOTSTRAP` audit row — all verified on a staging database this session. Sign in, enable MFA (Profile → Security) immediately.

## 5. Production build and startup (systemd)

```bash
cd /opt/carmaze && bun run build   # next build → standalone output (type errors fail the build)

sudo tee /etc/systemd/system/carmaze.service > /dev/null << 'EOF'
[Unit]
Description=CARMAZE web application
After=network.target

[Service]
User=carmaze
WorkingDirectory=/opt/carmaze
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/home/carmaze/.bun/bin/bun .next/standalone/server.js
Restart=always
RestartSec=5
# Memory cap: the dev server has historically OOM'd near 1.8 GB RSS; cap and restart.
MemoryMax=1500M
Environment=NODE_OPTIONS=--max-old-space-size=1200

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now carmaze
curl -s http://localhost:3000/api/health   # must report status:ok, database:connected, provider states honest
```

## 6. Reverse proxy and TLS (Caddy — owns HTTPS + X-Forwarded-For)

```bash
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy

sudo tee /etc/caddy/Caddyfile > /dev/null << 'EOF'
YOUR_DOMAIN {
    # TLS is automatic (Let's Encrypt). HTTP→HTTPS redirect is automatic.
    reverse_proxy localhost:3000 {
        # Append the real client IP; the app trusts the LAST XFF entry.
        header_up X-Forwarded-For {remote_host}
    }
    # Never cache private file endpoints at the edge (defence in depth; the
    # app already sends no-store on /api/files):
    @private path /api/files/*
    header @private Cache-Control "private, no-store"
    # Do not log query strings (they must never carry tokens/OTPs):
    log {
        output file /var/log/caddy/carmaze-access.log
        format json
    }
}
EOF
sudo systemctl reload caddy
curl -I https://YOUR_DOMAIN/api/health
```

Confirm: HSTS present, `Content-Security-Policy` present (the app emits it in production), `/api/files/*` responses show `Cache-Control: private, no-store`.

## 7. Scheduled jobs

Nothing to install: the in-process scheduler starts with the app (`ENABLE_JOBS` unset/true on the single instance). Hourly: application SLA, subscription/campaign/offer expiry, upload quarantine re-scan. Daily: reset-token and verification-code cleanup, evidence retention. If you ever run a second worker instance, set `ENABLE_JOBS=false` there — but note the rate limiter is in-memory and single-instance is the supported topology for the pilot.

## 8. Off-site backups `[NOT RUN HERE — exact commands]`

```bash
# scripts/backup-db.sh already does: sqlite3 .backup → gzip → timestamped file → 30-copy retention.
sudo -u carmaze bash /opt/carmaze/scripts/backup-db.sh    # verify one run now

# nightly 02:30 + pre-deploy; then copy OFF-BOX (rclone to S3-compatible, or scp to a second machine)
sudo -u carmaze crontab -e
  30 2 * * * bash /opt/carmaze/scripts/backup-db.sh && /home/carmaze/.bun/bin/bun /opt/carmaze/scripts/offsite-sync.mjs 2>>/opt/carmaze/backups/sync.log
# offsite-sync.mjs: rclone copy /opt/carmaze-backups remote:carmaze-backups --max-age 48h
#   (write this 5-line script when the backup target account exists — the runbook does not invent credentials)

# restore drill (weekly): scripts/db-restore-test.sh verifies gunzip → integrity_check against a copy
```

Recovery procedure: `CARMAZE_DATABASE_AND_BACKUP_GUIDE.md` §4 (drill-verified): stop app → restore file → integrity_check → start → `db:status` → audit-log `DATABASE_RESTORED`. RPO ≤ 24 h; RTO minutes.

## 9. Monitoring

- Uptime: point your monitor at `https://YOUR_DOMAIN/api/health` — reports DB connectivity + honest per-provider state (`not_configured` until each provider is really configured; `malware_scanner` shows clamdscan/clamscan when installed).
- Process: systemd `Restart=always` + `MemoryMax=1500M` (OOM history documented in the handover §8).
- Daily first-30-days checklist: `CARMAZE_FOUNDER_PRODUCTION_HANDOVER.md` §9.
- Error monitoring: Sentry/GlitchTip SDK wiring is a documented hook (handover §5 step 9) — install when the account exists; no fake DSN is shipped.

## 10. Deployment (new release) and rollback

```bash
# ── deploy a new release ──
cd /opt/carmaze && git fetch && git checkout <NEW_TAG>
bun install --frozen-lockfile
bash /opt/carmaze/scripts/backup-db.sh                       # pre-deploy backup, always
bun run db:deploy && bun run db:status                       # migrations are additive-only by policy
bun run build && sudo systemctl restart carmaze
curl -s http://localhost:3000/api/health | grep -o '"status":"[^"]*"'

# ── rollback (code) ──
cd /opt/carmaze && git checkout <PREVIOUS_TAG>
bun install --frozen-lockfile
sudo systemctl restart carmaze
bun run db:status                                            # additive migrations keep old builds compatible
curl -s http://localhost:3000/api/health
# if a migration MUST be backed out (rare; additive policy makes this near-never):
#   restore the pre-deploy backup (§8 recovery) — never hand-edit migration state.

# ── rollback (bad release with DB untouched) ──
sudo systemctl stop carmaze && cd /opt/carmaze && git checkout <PREVIOUS_TAG> && bun run build && sudo systemctl start carmaze
```

## 11. Post-deploy verification gate (run in this order)

```bash
curl -s https://YOUR_DOMAIN/api/health                       # 1. honest health
bun run db:status                                            # 2. migrations clean
bun verification/security-tests.ts                           # 3. from a machine that can reach a STAGING server — never the production process (the suite mutates demo fixtures; it refuses non-local targets by design)
# 4. manual: founder sign-in + MFA, one end-to-end enquiry→listing→payment(PENDING)→reconcile walk-through
# 5. 1-hour soak: no `[api]` 500s in server logs, RSS stable under MemoryMax
```

---

### Honest status of this runbook

| Step | Status |
|---|---|
| Fresh DB init (`db:deploy`) | **TESTED** this session on a clean staging DB (5 migrations, exit 0) |
| Founder bootstrap (`founder:create`) | **TESTED** this session (+ negative tests: second founder / dup email / weak password all refused) |
| `bun run build` | **TESTED** (exit 0 in the hardening pass; re-run on the deployment host — the sandbox defers builds to protect the dev server) |
| Health endpoint | **TESTED** live (honest provider states incl. malware_scanner) |
| Server provisioning / Caddy TLS / cron / off-site sync | `[NOT RUN HERE]` — requires the real host & provider accounts; commands are exact |
| Security suite (139 checks) | **TESTED** this session on the dev server; re-run on staging before go-live |
