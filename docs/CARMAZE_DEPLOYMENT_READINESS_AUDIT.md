# CARMAZE — Final Deployment Readiness Audit

**Date: 15 Nov 2026 · HEAD: `8fd26eb` · Scope:** verification that the runbook and acceptance report match the repository, live negative-testing of production guards on the real production build (isolated throwaway database, localhost-only, torn down after the tests), backup/restore drill, integration honesty check, logging hygiene check. No redesigns, no new features, no mock integrations, no real deployments, no money spent.

Method note: every "live" claim below was executed against the standalone production build (`bun run build` → `.next/standalone/server.js`, `NODE_ENV=production`) booted on `file:/tmp/carmaze-audit-prod.db` — a database created by `prisma migrate deploy` only, never the real dev/production data. Servers were localhost-only and stopped after each test.

---

## 1. Runbook ↔ repository cross-check — VERIFIED

| Runbook item | Repo reality | Result |
|---|---|---|
| `bun run db:deploy` / `db:status` | `package.json` → `prisma migrate deploy` / `prisma migrate status` | MATCH |
| `bun run founder:create` | `scripts/create-founder.ts` — refuses existing founder, duplicate email, demo data in DB, weak password; requires `FOUNDER_CONFIRM=YES`; transactional `FOUNDER_BOOTSTRAP` audit; password never logged | MATCH |
| `bun run build` | `next build` + standalone/static copy; type errors fail the build | MATCH (exit 0, §3) |
| Env vars §2 | `.env.example` names every variable in the runbook (DATABASE_URL, AUTH_SECRET, NEXT_PUBLIC_SITE_URL, all MPESA_*, SMTP_URL, MAIL_FROM, SMS_*) plus ops vars (ENABLE_JOBS, LOG_LEVEL, MPESA_BASE_URL, OFFSITE_BACKUP_REMOTE) and the never-in-production `CARMAZE_ALLOW_DEMO_SEED` / recommended `CARMAZE_SCAN_CMD` | MATCH |
| Migrations | 5 versioned migrations + `migration_lock.toml`; fresh `migrate deploy` → "Database schema is up to date!" (live) | MATCH |
| Health check §5/§9 | `/api/health` reports DB + honest per-provider state incl. `malware_scanner` (live-verified on the production build) | MATCH |
| Backup §8 | `scripts/backup-db.sh` resolves DB from CARMAZE_DB_FILE → DATABASE_URL → .env (no hardcoded dev path), 30-copy retention — live exit 0 | MATCH |
| Off-site sync §8 | `scripts/offsite-sync.mjs` fail-closed: exit 1 unconfigured, exit 2 rclone failure, `rclone copy` (never sync/deletes) — live-verified both refusal paths | MATCH |
| Restore drill §8 | `scripts/db-restore-test.sh`: gunzip → `PRAGMA integrity_check` + row counts on a TEMP copy, live DB untouched — live **PASSED** (integrity ok) | MATCH |
| Scheduled jobs §7 | `src/lib/jobs.ts` honours `ENABLE_JOBS=false`; single-instance scheduler documented | MATCH |
| Rollback §10 | additive-migration policy documented; rollback = checkout previous tag + restart + `db:status`; migration back-out = restore backup (matches backup guide §4) | MATCH |
| Referenced docs | `CARMAZE_FRESH_DATABASE_INIT.md`, `CARMAZE_ENVIRONMENT_VARIABLES.md`, `CARMAZE_DATABASE_AND_BACKUP_GUIDE.md`, `CARMAZE_FOUNDER_PRODUCTION_HANDOVER.md` all exist and agree with the scripts | MATCH |
| CI | `.github/workflows/ci.yml`: lint → tsc → fresh ephemeral DB migrate+seed → throwaway server → security suite → production build | PRESENT |

Non-blocking observation: runbook §1 creates `/opt/carmaze-backups` while §8's script default writes `/opt/carmaze/backups`. Harmless — the off-site sync copies whichever dir is configured; the founder may set `CARMAZE_BACKUP_DIR=/opt/carmaze-backups` if preferred.

## 2. Production build, TypeScript, ESLint — VERIFIED (re-run at HEAD)

| Gate | Exit code |
|---|---|
| `bun install --frozen-lockfile` | **0** (928 installs / 996 packages, no changes) |
| `bunx tsc --noEmit` | **0** |
| `bun run lint` | **0** |
| `bun run build` | **0** (`.next/standalone/server.js` produced) |
| `bun verification/security-tests.ts` (fresh dev server) | **0** — **139 passed, 0 failed** |

## 3. Demo seeding / demo-reset impossible in production — VERIFIED (live)

- `prisma/seed.ts` first statement refuses when `NODE_ENV=production` unless `CARMAZE_ALLOW_DEMO_SEED=YES` is explicitly set (a real production `.env` never contains it).
- `POST /api/admin/demo-accounts/reset` — the **production guard is the first statement, before authentication**:
  - unauthenticated direct POST on the production build → **403 `DEMO_RESET_DISABLED_IN_PRODUCTION`** (live);
  - the same POST **with a valid FOUNDER session** → still **403** (live) — no credential level bypasses it.
- No API route can create `DemoAccount` rows anywhere in the codebase (the only write outside the seed is the reset's `lastResetAt` bookkeeping, itself behind the guard).
- `POST /api/auth/demo` on a clean production database → **403 `DEMO_DISABLED`** (live; empty registry), with an integrity check that refuses to sign in any non-demo-marked user.

## 4. Production startup fails safely without secrets / security services — VERIFIED (live)

- **Missing `AUTH_SECRET`** (production build, live): server boots, `/api/health` stays reachable (200, monitoring intact); every session operation **fails closed** — login and registration return generic `500 INTERNAL_ERROR` with no internal detail to the client, and the server log names the missing variable (never a value). No insecure dev fallback exists in production. Session signing, MFA secrets and AES-256-GCM QR-token sealing all derive from `AUTH_SECRET` — nothing security-relevant runs without it.
- **Missing `MPESA_WEBHOOK_SECRET`**: unsigned Daraja callback on the production build → **401 `Rejected`** (live, fail-closed, no reason revealed).
- **No malware scanner**: PDFs quarantine with `SCANNER_UNAVAILABLE` / `viewable:false` and serve to nobody (live, §5); the hourly re-scan sweep releases them only after a real CLEAN verdict or staff approval.
- **M-Pesa / SMTP / SMS unconfigured**: health honestly reports `not_configured` per provider (live); payment attempts fail 503 `MPESA_NOT_CONFIGURED` and finance uses the audited manual-reconciliation path (verified end-to-end in the 76/76 workflow pass, code unchanged since).

## 5. Private identity / business / custody files cannot become public — VERIFIED (live, production build)

Executed on a scannerless host (the honest production posture until ClamAV is installed):

| Probe | Result |
|---|---|
| Public image upload → anon GET `/api/media/...` | 201 → **200** (correct public behaviour) |
| Private document (PNG) — owner / anon / stranger | **200 / 401 / 403** |
| Private PDF → quarantine; owner / anon | **423 `SCAN_PENDING`** (even the owner) / **401** |
| Quarantined PDF name via `/api/media/` | **404** (quarantine dir is not the media dir) |
| PDF declared as public upload | **415 `UNSUPPORTED_TYPE`** — refused before any bytes are kept |
| PDF with `/JavaScript`//`OpenAction` | **415 `ACTIVE_CONTENT_REFUSED`** |
| Evidence file — owner / non-participant / anon | **200 / 403 / 401** (+ 1-year expiry, FileAccessLog audit trail) |
| Upload review console (founder) | lists records with `scanStatus`; quarantine approval is audited staff-only |

**Defect found and fixed (smallest safe fix, commit `8fd26eb`):** 164 files under `data/` (upload/quarantine artifacts from dev testing) were git-tracked, and `.gitignore` did not exclude `data/` or `backups/`. Because the runbook's §2 release step is a plain `git clone`, a production checkout would have carried dev upload artifacts into the build — including two legacy 16-hex PNGs sitting in the **public** media directory, which would then have been publicly served in production. Fix: `data/` and `backups/` gitignored and untracked (`git rm --cached`; files remain on disk; nothing references the committed names in code). A clean clone now produces a clean production tree, exactly as the runbook assumes. No other code changed.

## 6. Production database initialisation cannot import demo data or overwrite real data — VERIFIED (live)

- Fresh DB created by `prisma migrate deploy` only → 5 migrations, exit 0, "up to date" (live). `package.json` contains **no `prisma.seed` wiring**, so migrations can never auto-seed.
- `founder:create` on the clean DB → FOUNDER minted (transactional `FOUNDER_BOOTSTRAP` audit); live row-count query: **exactly 1 user, 0 demoAccounts, 0 demo users, 0 vehicles, 0 invoices, 0 settlements, 0 purchaseOrders, 0 customerOrders**.
- Second founder / duplicate email → **REFUSED** (fail-closed, live).
- Demo data already in DB → founder creation refuses (guard in script; escape hatch `FOUNDER_ALLOW_DEMO_DB=YES` is explicit and manual).
- Self-promotion: freshly registered user → `/api/admin/uploads` **403**, `/api/admin/users` **403**, `/api/admin/settings` **405** (route does not even accept the method); no role-changing endpoint exists (roles change only via audited application approvals — verified in the 16/16 clean-env pass).
- The demo-reset path that destroyed data pre-hardening is 403-refused in production under every credential level (§3).
- These tests ran only on the throwaway `/tmp` database; the real databases were never touched.

## 7. Backups: off-server storage and safe restoration — VERIFIED (mechanism) / BLOCKED (real target)

- `backup-db.sh` → exit 0, timestamped gzip, 30-copy retention (live on the production-style DATABASE_URL path).
- `db-restore-test.sh` → **PASSED** (integrity ok, row counts sane) on a temp copy; the live database is never opened for write by the drill (live).
- `offsite-sync.mjs` → exit 1 with an explicit founder instruction when `OFFSITE_BACKUP_REMOTE` is unset; exit 2 (local backups intact) when rclone fails/missing (live). It only ever `rclone copy`s.
- **BLOCKED**: actual off-site storage requires the founder to provision a target (`rclone config` + `OFFSITE_BACKUP_REMOTE`). Per the script's own rule — and this audit's rule — off-site backup is NOT claimed working until it has exited 0 against the real target and a file has been verified there.

## 8. Integration points: implemented code vs. real-provider evidence

| Integration | Code | Tested with real provider |
|---|---|---|
| M-Pesa Daraja STK push + status query + B2C payout (`src/lib/mpesa.ts`) | **VERIFIED as code**: real Daraja endpoints, OAuth, correct payload contracts, honest `MPESA_NOT_CONFIGURED` 503, no simulated success | **BLOCKED** — no Daraja credentials have ever been present; no real STK/B2C round-trip exists. Pilot must be described as payment-ready, not live-verified |
| M-Pesa callback authenticity | **VERIFIED live**: production + missing secret → 401 fail-closed; secret present → timing-safe comparison | BLOCKED (Safaricom IP allow-listing still founder action) |
| Email (SMTP via nodemailer) | **VERIFIED as code**: honest `accepted` flag driven by provider acks | **BLOCKED** — no SMTP account configured; nothing delivered |
| SMS (Africa's Talking REST + Twilio REST) | **VERIFIED as code**: E.164 Kenyan normalisation, provider-ack-driven `accepted` | **BLOCKED** — no AT/Twilio account; nothing delivered |
| Malware scanning | **VERIFIED**: ClamAV auto-detect, `CARMAZE_SCAN_CMD` `{file}` contract, ClamAV exit-code convention (0/1/≥2), timeout→SCAN_ERROR, fail-closed quarantine; verdict handling 20/20 in the harness pass + live fail-closed today | **BLOCKED** — ClamAV is not installed on any host yet. Until `apt install clamav clamav-daemon` (or `CARMAZE_SCAN_CMD`) is done on the production host, PDFs stay in staff-reviewed quarantine. **No malware-scanning claim is made** |

## 9. Logging hygiene — VERIFIED

- `src/lib/logger.ts` redacts every meta key containing password/passwd/secret/token/auth/otp/code/credential/apikey/cookie/session/pin/msisdn/idnumber/nationalid (case-insensitive, depth-limited) plus bearer/JWT-shaped values by regex — defence in depth.
- Login/register/password-reset audit rows carry identifiers and IP only — never credentials or codes.
- M-Pesa callback audits store `resultDesc`, receipt, amount — no MSISDN, no credentials.
- Upload audits store filename/mime/size — never file bytes or identity-document content.
- The only raw `console.warn` in `src/` names the missing env variable without its value; the production log on missing `AUTH_SECRET` was live-checked (no secret material).
- Caddy config in the runbook does not log query strings (tokens/OTPs never hit access logs).

## 10. Founder action checklist — exact deployment order

Everything below is on the real host; nothing here can be executed from inside this sandbox. Execute in order; do not skip ahead.

1. **Provision the server** — Ubuntu 22.04/24.04 LTS (2 vCPU / 2–4 GB), runbook §1: system packages, `Africa/Nairobi`, ClamAV (`clamav clamav-daemon` + `freshclam`), UFW (80/443/SSH only — port 3000 closed), bun.
2. **Create the release layout** — `carmaze` user; `/opt/carmaze`, `/opt/carmaze-releases`, backup dir. Clone the repo **without** `db/` and `data/` (with `8fd26eb` a plain clone is already clean).
3. **Write `/opt/carmaze/.env`** (chmod 600) from runbook §2 — generate `AUTH_SECRET` (`openssl rand -base64 48`) and `MPESA_WEBHOOK_SECRET` (`openssl rand -hex 32`); fill Daraja/SMTP/SMS values when those accounts exist (they may stay unset — the app reports honestly).
4. **Initialise the database** — `bun run db:deploy && bun run db:status` ("up to date"). Nothing else ever creates the production DB.
5. **Bootstrap the founder** — runbook §4 (silent password entry, `FOUNDER_CONFIRM=YES`), then sign in and **enable MFA immediately**.
6. **Build and start** — `bun run build`; install the systemd unit (§5: `MemoryMax`, `Restart=always`, `NODE_ENV=production`); check `/api/health` reports `status:ok` and honest provider states (expect `mpesa/email/sms/malware_scanner` = `not_configured` until you fill them — ClamAV should show `configured (clamdscan)` because of step 1).
7. **TLS + reverse proxy** — Caddy per §6; confirm HSTS, production CSP, `/api/files/*` → `Cache-Control: private, no-store`.
8. **Verify the upload posture** — from the pilot account, upload one PDF: it must 423-quarantine until the scan sweep or staff approval; confirm `/api/admin/uploads` shows it.
9. **Backups + off-site** — one `backup-db.sh` run; nightly cron + `offsite-sync.mjs` after `rclone config` + `OFFSITE_BACKUP_REMOTE`; **run `db-restore-test.sh` and confirm PASSED**; only then claim off-site backups.
10. **Payment go-live (when Daraja is ready)** — set credentials, run ONE real STK push to your own phone for a small amount and one B2C payout to a test supplier; confirm both callbacks; only then describe payments as live.
11. **Post-deploy gate** — runbook §11 in order: health, `db:status`, security suite against a STAGING server (never the production process), founder walk-through of enquiry→listing→payment→reconcile, 1-hour soak.
12. **Legal/ops pack** — ODPC registration, privacy policy, terms (handover §3/§7); daily first-30-days checklist (handover §9).

---

## Verdict

**READY FOR CONTROLLED PILOT.**

Why:
- Every gate executable in this environment was executed and passed at HEAD `8fd26eb`: frozen-lockfile install, `tsc`, `lint`, production build (all exit 0), the 139-check security suite (139/139), and a fresh-DB production-mode battery (demo-reset guard 403 under every credential level, demo sign-in disabled, fail-safe startup without `AUTH_SECRET`, unsigned-callback 401, full upload-isolation matrix, founder bootstrap + duplicate refusal + zero-demo rows, backup/restore drill PASSED, off-site sync fail-closed).
- The one genuine defect found (git-tracked runtime upload artifacts that a plain production clone would have carried public) was fixed with the smallest safe change (`8fd26eb`) and re-verified.
- No FAILED items remain.

Why **not** READY FOR PUBLIC LAUNCH yet (the honest BLOCKED list, all external):
1. No real Daraja payment proof (STK + B2C round-trip) — pilot is payment-ready, not live-verified; manual reconciliation is the documented fallback.
2. No real email/SMS provider configured — OTPs ride in-app notifications.
3. ClamAV not installed on any host — PDFs stay staff-reviewed quarantine until step 1 is done (fail-closed, not unsafe, but a launch-order requirement).
4. Off-site backup target not yet provisioned — backups are local-only until `OFFSITE_BACKUP_REMOTE` exists and one sync exits 0.
5. Server, TLS, cron, monitoring: runbook commands exact and verified against the repo, but `[NOT RUN HERE]` by definition.
6. ODPC registration / legal pack outstanding.
