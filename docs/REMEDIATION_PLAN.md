# CARMAZE — POST-DOCUMENTATION ENGINEERING REMEDIATION PLAN

**Version 1.0 · 8 Nov · Dependency-aware, incremental (no rewrite). Every item verified against source before planning.**

## Phase 1 verification verdict (all 12 confirmed)

| # | Finding | Verified location | Severity | Class |
|---|---|---|---|---|
| 1 | `POST /api/upload` missing; 13 call sites in 11 files break | no route file; contracts verified (`file`+`kind`, `{url,name?}`) | **CRITICAL** | Broken core |
| 2 | `AUTH_SECRET` dev fallback | `src/lib/auth.ts:12-14` | HIGH | Security |
| 3 | `Math.random()` security codes | `src/lib/ids.ts:19-21` | HIGH | Security |
| 4 | No email/SMS delivery (channels hard-FAILED by honesty guard) | `src/lib/notify.ts:64` | MEDIUM | Payments/ops adjacent |
| 5 | M-Pesa real code, no credentials | `src/lib/mpesa.ts` + `.env` (only `DATABASE_URL`) | MEDIUM | Payments |
| 6 | Supplier subscription broken: non-DEALER plans demand `GARAGE_OWNER` | `src/app/api/billing/subscribe/route.ts:32` | **HIGH** | Broken core / revenue |
| 7 | No supplier settlement/payout infrastructure | zero matches for "settlement" | HIGH | Payments/revenue |
| 8 | SLA sweep manual-only (code comment admits it) | `src/app/api/applications/sweep/route.ts:11-12` | MEDIUM | Ops |
| 9 | No Prisma migration history | `prisma/` has no `migrations/` | MEDIUM | Ops |
| 10 | In-memory rate limiter | `src/lib/rate-limit.ts` | LOW-MED | Ops |
| 11 | `ignoreBuildErrors: true` | `next.config.ts:8-10` | MEDIUM | Quality |
| 12 | No automated test framework | only manual `verification/security-tests.ts` | MEDIUM | Quality |

## Phase 2 execution waves (dependency order)

**Wave 1 — Security-critical (3B → 3A → 3C)**
1. `3B` auth.ts: fail-fast in production without strong `AUTH_SECRET`; dev fallback kept for sandbox only. ids.ts: `sixDigitCode()` → crypto random (rejection sampling on `randomBytes`). verify-email/verify-phone: real provider send when configured; dev code **only** in non-production; production without provider → honest 503 `CHANNEL_NOT_CONFIGURED`, never leaks code.
2. `3A` new `src/app/api/upload/route.ts`: `requireUser`, 60/15min rate limit, allowlist (JPEG/PNG/WEBP/PDF), magic-byte sniffing, size caps (images 8 MB, docs 10 MB), safe server-generated names `<userId>.<16hex>.<ext>` (matches both serving regexes), `kind=document` → private `data/uploads` + `/api/files/…` URL; else public `data/uploads/media` + `/api/media/…`; audit-logged. Contract `{url, name?}` preserved; add `kind:'document'` to supplier application dialog (business documents must be private).
3. `3C` subscribe: audience→role map `{DEALER: DEALER_OWNER, GARAGE: GARAGE_OWNER, SUPPLIER: SUPPLIER_OWNER}` + correct messages.

**Wave 2 — Payments & money (3F with 3E support)**
4. `3F` Settlements: new `Settlement` + `SettlementEvent` models (db:push, additive only). Hook: PO `release` branch creates `PENDING` settlement (net = accepted − commission). Dispute → `ON_HOLD`; payout attempt → `PROCESSING` only via provider or FINANCE reconcile → `SETTLED` with reference + note + audit. APIs: `GET /api/settlements` (org-scoped / FINANCE+), `POST /api/admin/settlements/[id]/action` (process|reconcile|hold|release|cancel, FINANCE+, demo-blocked). Supplier UI: settlements card in billing tab. **No simulated money movement.**
5. `3E` mpesa.ts: config summary helper, STK status query (reconciliation), B2C payout (real Daraja v3 code, requires B2C credential set), payout result callback (webhook-secret protected) — all fail honestly without credentials; `PaymentAttempt` listing for FINANCE reconciliation.

**Wave 3 — Notifications (3D)**
6. Provider layer: SMTP via nodemailer (`SMTP_URL`, `MAIL_FROM`); SMS providers `africastalking`|`twilio` via `SMS_PROVIDER`+`SMS_API_KEY`(+`SMS_USERNAME`,`SMS_SENDER_ID`). notify(): in-app immediate; external via `after()` with retry (≤3 attempts, backoff); `SENT` only on provider acceptance; `FAILED` with precise reason otherwise. Health endpoint reports configured providers.

**Wave 4 — Infrastructure (3G)**
7. rate-limit: periodic unref'd cleanup, stricter caps. `src/lib/logger.ts` structured logger. Jobs: `src/instrumentation.ts` + `src/lib/jobs.ts` (application SLA sweep extracted to shared lib + expired reset-token cleanup; `ENABLE_JOBS` guard, hot-reload safe). Migration baseline via `prisma migrate diff` + `migrate resolve --applied` (non-destructive). `scripts/backup-db.sh` + `db:backup` script. `.env.example` (names only).

**Wave 5 — Quality (3H) + Phase 4/5**
8. `bunx tsc --noEmit` → fix every error → `ignoreBuildErrors: false`. Lint. Run `verification/security-tests.ts` + upload/subscribe/notify curl proofs + role-by-role browser checks. Final honest report (env names only, no secrets, no invented results).

**Explicitly out of scope (documented, not hidden):** shared-store rate limiter (single-instance deployment), real payout execution (needs provider credentials), government/NTSA integrations (do not exist anywhere).
