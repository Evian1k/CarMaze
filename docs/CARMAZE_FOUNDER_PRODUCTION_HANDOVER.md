# CARMAZE — Founder Production Handover

**13 Nov 2026. Prepared for the founder ahead of a controlled production launch.**
Every "verified" claim below was executed in this session: a clean git tree, a full secret scan, `119/119` automated checks on a fresh server, clean `tsc` + ESLint, a successful production build (`next build`, exit 0) with an honest production smoke (`/api/health` reports `not_configured` for every external provider — no fakes), and targeted probes proving each new security guard blocks what it must. No simulated payments, no invented integrations, no data deleted, no prices changed, no working features removed.

---

## 1. What is implemented and verified

**Platform** — 12 interlocking surfaces (Marketplace, DealerOS, GarageOS, Supply/SupplierOS/Procurement, LogisticsOS, My Garage/Vehicle Protection, 3D Customizer, Community, Memberships, Roadside, Partner Network, Control Center) on Next.js 16 + TypeScript + Prisma 6/SQLite, 154 API routes, 16 roles, all enforced server-side (deny-by-default).

**Security posture (verified this session by three independent adversarial reviews + fixes):**
- Auth: fail-fast `AUTH_SECRET`, DB-checked sessions with `sessionVersion` instant revocation, hashed verification codes with expiry/attempt caps, hashed single-use reset tokens.
- Uploads: auth, magic-byte anti-spoof, size caps, server filenames, private/public split, audit-logged staff views, `no-store` on private files.
- Money: the ONLY paths to PAID/PROTECTED/SETTLED are provider callbacks (signature-gated, fail-closed, amount-verified, idempotent) or audited FINANCE reconciliation with an external reference and demo hard-block. No simulation path exists.
- Escrow integrity (re-reviewed + hardened in this session): release capped at escrow minus refunds; refunds capped at escrow minus released proceeds (a release can never be combined with a full refund — the double-payout hole found by re-review is closed); release/inspection/dispute are terminal once money moves; settlement reconcile/release respect dispute holds; one settlement per order (dedup); stale authorization amounts refresh on payment retry so collected funds can never be stranded outside protection.
- Tenant isolation: no IDOR found in the systematic [id]-route sweep; suspended orgs lose write access on every mutating route (12 routes hardened this session); self-dealing guard mirrored to procurement quotes; bid confidentiality; QR/OTP confinement to the receiving side.
- Demo isolation: demo sessions cannot touch real payments, KYC documents, user directories, revenue, the payment ledger, incident queues, application queues, or ANY escrow action — all proven by live 403 probes this session; demo-on-demo workflows (the public demo tour) still work.
- Ops: hourly/daily scheduled sweeps, daily backups + drill-verified restore, honest health endpoint, honest notification delivery rows.

**Quality gates (this session):** `119/119` suite · `tsc --noEmit` clean · `eslint` clean · production build exit 0 · secret scan clean across 774 tracked files · git tree clean (only runtime `db/custom.db` modified).

## 2. What is still incomplete

1. **All external services are unconfigured** (by honesty rule): Daraja, SMTP, SMS, off-box backups, error monitoring, malware scan. The code activates them when env vars exist; until then it returns honest 501/503 and records FAILED.
2. **No live payment proof exists.** Sandbox/test-mode verification of the full money loop requires real Daraja credentials. CARMAZE must not be advertised as processing real payments until the §DARAJA test cases have passed in production mode.
3. **Legal pack unpublished**: privacy notice, TOS, partner agreements, ODPC registration — drafts/checklist in `CARMAZE_DATA_PROTECTION_COMPLIANCE.md`, require Kenyan counsel.
4. **Tracked hygiene items — RESOLVED in the pre-launch blocker pass (13 Nov 2026, all verified by the 139-check suite):** operational OTP codes now carry an absolute 72-hour TTL (logistics drop-off, procurement handover, consumer collection codes); single-use QR tokens are stored SHA-256-hashed (verification consults only the hash; the requester-side QR view uses an AES-256-GCM sealed copy keyed from AUTH_SECRET; legacy plaintext rows self-heal on first verification); every money transition now runs inside a conditional-guard transaction with the audit row written in the same transaction (duplicate/replayed callbacks, concurrent releases, double settlements and ON_HOLD bypass are DB-enforced non-events — regression-tested); a malware quarantine workflow protects uploads (PDFs fail closed until a scan or audited staff approval; images are enforced-inert types with recorded scan status; ClamAV/CARMAZE_SCAN_CMD integrates with zero code changes); sensitive evidence (chat attachments, incident/POD/custody/dispute evidence) moved to participant-gated private storage with 1-year access expiry and full FileAccessLog auditing; strict CSP + security headers are emitted in production; the logger redacts secret-shaped keys and values; versioned migrations are complete (drift reconciled) and `prisma migrate deploy` + `bun run founder:create` reproduce a clean production DB on demand (staging-tested); CI runs lint + tsc + the security suite + production build on every push.
5. **Demo data ships in the repo** (demo DB + demo uploads tracked by this sandbox's auto-commits). They are synthetic, demo-marked and isolated — but a production deployment MUST start from migrations + a fresh DB, never by copying `db/custom.db`.

## 3. External accounts you must create (founder, personally)

| # | Account | Why | Cost today |
|---|---|---|---|
| 1 | Safaricom Daraja (developer.safaricom.co.ke) | STK payments + B2C payouts | Free to register; production shortcodes need a live Paybill/till |
| 2 | Email provider (e.g. Zoho Mail / Google Workspace SMTP / Brevo) | Transactional email | From ~US$1–6/mo (see §6) |
| 3 | Africa's Talking | OTP + notification SMS | Pay-as-you-go (est. KES 0.8–1.5/SMS) |
| 4 | Hosting provider (VPS or PaaS) | Run the app | see §6 |
| 5 | Domain registrar (.co.ke via KeNIC registrar) | Domain | est. KES 800–1,500/yr |
| 6 | Error monitoring (Sentry or self-hosted GlitchTip) | Production error alerts | Free tier likely sufficient initially |
| 7 | Off-box backup target (S3-compatible or separate disk) | Backups must not live on the app host only | see §6 |

## 4. Credentials you must obtain

Exactly the env names in `.env.example` — **names only, values never committed**: `AUTH_SECRET` (generate: `openssl rand -base64 48`), `NEXT_PUBLIC_SITE_URL`, the Daraja STK set (`MPESA_CONSUMER_KEY/SECRET/SHORTCODE/PASSKEY/ENV/CALLBACK_URL`), `MPESA_WEBHOOK_SECRET` (you generate), the B2C set (`MPESA_INITIATOR_NAME/SECURITY_CREDENTIAL/B2C_RESULT_URL`), `SMTP_URL`, `MAIL_FROM`, `SMS_PROVIDER/SMS_API_KEY/SMS_USERNAME/SMS_SENDER_ID`.
Detailed setup: `CARMAZE_DARAJA_PAYMENT_SETUP.md` · `CARMAZE_EMAIL_SMS_SETUP.md` · `CARMAZE_ENVIRONMENT_VARIABLES.md`.

## 5. Exact setup instructions (order matters)

1. **Host**: 2 vCPU / 2 GB RAM min, Ubuntu LTS, supervisor (systemd). Install bun or Node 20. Create `/opt/carmaze` release dir.
2. **Repo**: clone/copy the repo (WITHOUT `db/custom.db` — start clean), `bun install --frozen-lockfile`.
3. **Database**: `bunx prisma migrate deploy` (never `db:push` in prod) → creates an empty schema; then create the FOUNDER admin by running the seed ONLY if you want demo data (`bun prisma/seed.ts`), otherwise mint the first admin with a one-off script — the app bootstraps no real accounts itself. Decide deliberately.
4. **`.env`**: fill per §4; `chmod 600 .env`; never commit.
5. **Proxy/TLS**: Caddy or nginx per `CARMAZE_DEPLOYMENT_GUIDE.md` §4; proxy must own `X-Forwarded-For`.
6. **Build & run**: `bun run build`; systemd unit running `bun .next/standalone/server.js` with `NODE_ENV=production`, restart=always, MemoryMax=1500M.
7. **Jobs**: leave `ENABLE_JOBS` unset (true) on the single instance; `false` on any secondary worker.
8. **Backups**: cron `bun run db:backup` daily + pre-deploy; copy `backups/` off-box (rclone to the backup target); verify one restore per the DB guide §4.
9. **Monitoring**: wire `/api/health` into uptime monitoring; install Sentry/GlitchTip SDK when chosen (documented hook).
10. **Integrations**: follow the Daraja and Email/SMS docs; run each §test case.
11. **Verification**: `bun verification/security-tests.ts` on staging (fresh process) → 119/119; then the post-deploy checklist in the deployment guide.

## 6. Monthly infrastructure cost estimates

| Item | Estimate | Basis |
|---|---|---|
| VPS 2 vCPU/2–4 GB (DigitalOcean/Linode/Contabo/Hetzner) | **US$12–24/mo** | published list prices, verified ranges |
| Domain .co.ke | ~US$6–12/yr | registrar list prices (estimate) |
| Email (Zoho Mail Lite / Brevo free tier) | **US$0–6/mo** | published prices; free tiers exist |
| SMS (Africa's Talking) | **~KES 1,000–3,000/mo** at pilot volume (1–3k OTP/notifications) | AT list rate ~KES 0.8–1.5/SMS (estimate; verify) |
| Backups (S3-compatible 10–20 GB) | **US$1–5/mo** | published prices (estimate) |
| Error monitoring (Sentry free tier / GlitchTip self-host) | **US$0** | free tier limits apply (verified tiers may change — check) |
| Daraja | KES 0 per transaction for STK (customer pays); B2C payouts carry Safaricom tariff | Safaricom tariff sheet (estimate — confirm current B2C rates) |
| **Total pilot run-rate** | **≈ US$15–40/mo** | sum of above; every line flagged where it is an estimate vs a published price |

## 7. Production launch sequence (controlled)

1. Legal pack signed off + published (privacy notice, TOS) → ODPC registration filed.
2. Provision host + domain + TLS; deploy build; health check green.
3. Set `AUTH_SECRET`, mint the real FOUNDER account, enable your own provider accounts one by one with one live proof each (email → SMS → Daraja sandbox → Daraja production).
4. Daraja sandbox test cases 1–7 (`CARMAZE_DARAJA_PAYMENT_SETUP.md` §8) → then production-mode test cases on KES 1 invoices.
5. Smoke: 119-check suite on staging, post-deploy checklist, 1-hour soak with zero `[api]` 500s.
6. Soft launch: invite a SMALL set of real users (pilot), keep the demo mode enabled for prospects, monitor daily (§9).
7. Scale up only after the pilot proves the payment loop and support workflow.

## 8. Rollback and recovery

- **Code rollback**: previous release dir kept; stop service → repoint → `bunx prisma migrate status` (additive-only migrations keep old builds compatible) → start → `/api/health`.
- **Database restore**: `CARMAZE_DATABASE_AND_BACKUP_GUIDE.md` §4 (drill-verified): gunzip → integrity_check → atomic swap → restart → migrate status → audit-log `DATABASE_RESTORED`. RPO ≤24 h (daily cron; tighten to hourly during pilot if volume grows), RTO minutes.
- **Session compromise**: rotate `AUTH_SECRET` → all sessions die instantly; users re-login.
- **Provider outage**: payments/notifications fail honestly (FAILED rows); reconcile after recovery via the attempts ledger + mark-paid/query flows. Never hand-edit rows to fake delivery.

## 9. First 30 days of operational monitoring (daily/weekly checklist)

**Daily (first 2 weeks, then twice weekly):**
- `/api/health` 200 + provider states as expected; uptime monitor alerts configured.
- `server.log`: no `[api]` 500s; watch memory (RSS) — supervisor restarts on cap.
- Money reconciliation: attempts ledger vs M-Pesa statement; settlements PENDING list vs what has actually been paid out; zero unmatched.
- NotificationDelivery: SENT/FAILED ratio; any FAILED with provider errors investigated same day.
- Backups: job ran, off-box copy exists, newest timestamp sane.

**Weekly:** restore drill on the newest backup (10 min); review AuditLog for `ACCESS_DENIED`/`DEMO_SANDBOXED`/`COLLECTION_CODE_FAILED` anomalies; review ODPC/erasure tickets; check disk (uploads + backups); review slowest endpoints if p95 rises.

**Metric baselines to record on day 1:** p95 page/API latency, daily signups, enquiries, listing submissions, booking/PO/delivery counts, payment success rate, refund rate, dispute count. Any deviation >50% week-over-week gets a look.

---

## The honest list — what YOU must do personally

1. **Register and approve the external accounts** (§3) — none of them can be created by the software.
2. **Obtain and configure credentials** (§4) and keep them out of git and chat.
3. **Run the Daraja test cases yourself** and only then claim payment capability. Until then, externally describe CARMAZE as payment-ready, not live-verified.
4. **Engage a Kenyan advocate/compliance professional** for the privacy policy, TOS, partner agreements, ODPC registration and KYC/AML posture (§6 of the compliance doc lists the exact matters).
5. **Mint your real admin account and own the DPO workflow** (erasure requests land as DPO tickets that a human must resolve).
6. **Decide the first-admin bootstrap** (seed-with-demo vs clean-DB script) — a business decision the code deliberately does not make for you.
7. **Fund and verify the backup target and monitoring**, and do the weekly restore drills.
8. **Approve any price/plan change explicitly** (seeded prices are untouched; changing them is a plan-row edit + your approval, per standing rule).
9. **Publicly claim nothing unverified**: no "payments live", no "SMS delivered", no "ODPC registered" until each is actually true.
