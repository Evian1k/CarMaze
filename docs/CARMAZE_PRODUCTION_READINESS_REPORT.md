# CARMAZE — Production Readiness Report

**Final engineering remediation report · 9 Nov 2026.**
Every statement below is backed by an executed test in this session (see `CARMAZE_TEST_RESULTS.md`). Nothing was mocked, nothing simulated, no secrets printed.

---

## 1. Overall launch assessment

**LIMITED PILOT READY.**

CARMAZE is internally consistent, security-hardened, regression-proven (93/93 automated checks, clean typecheck and lint, browser-verified journeys), and honest about every external dependency. What separates this from PUBLIC PRODUCTION READY is entirely external and clearly listed in `CARMAZE_REMAINING_BLOCKERS.md`: Daraja credentials with live payment proof, an SMTP/SMS provider, production hosting with `AUTH_SECRET` set, and legal review of the ODPC/data-processing items. The code activates those integrations without further changes once credentials exist.

Statuses used: VERIFIED WORKING / IMPLEMENTED BUT NOT EXTERNALLY VERIFIED / PARTIALLY IMPLEMENTED / NOT IMPLEMENTED / BLOCKED BY CREDENTIALS.

---

## 2. Verified original issues — final state

| # | Original issue | Confirmed? | Final status | Where |
|---|---|---|---|---|
| 1 | `POST /api/upload` missing (15 call sites in 11 files broken) | YES | **VERIFIED WORKING** — full secure pipeline implemented this session | `src/app/api/upload/route.ts` |
| 2 | `AUTH_SECRET` hardcoded dev fallback | YES (prior pass) | **VERIFIED WORKING** — boot refuses in production; dev fallback warns loudly | `src/lib/auth.ts` |
| 3 | `Math.random()` security codes | YES (prior pass) | **VERIFIED WORKING** — `randomBytes` + rejection sampling, no modulo bias | `src/lib/ids.ts` |
| 4 | No email/SMS delivery transports | YES (prior pass) | **IMPLEMENTED BUT NOT EXTERNALLY VERIFIED** — real SMTP/AT/Twilio code; `SENT` only on provider acceptance | `src/lib/providers/` |
| 5 | M-Pesa real code, unconfigured deployment | YES | **BLOCKED BY CREDENTIALS** — STK/query/B2C complete; honest 501 `MPESA_NOT_CONFIGURED` until env set | `src/lib/mpesa.ts` |
| 6 | Supplier plans gated behind `GARAGE_OWNER` | YES (prior pass) | **VERIFIED WORKING** — audience→role map; supplier owners subscribe to their own plans | `src/app/api/billing/subscribe/route.ts` |
| 7 | No supplier settlement infrastructure | YES (prior pass) | **IMPLEMENTED BUT NOT EXTERNALLY VERIFIED** — ledger + B2C payout + manual reconciliation; `SETTLED` requires provider/finance evidence | `src/lib/settlements.ts`, `src/app/api/settlements`, `src/app/api/admin/settlements/` |
| 8 | Manual-only application SLA sweep | YES (prior pass) | **VERIFIED WORKING** — hourly scheduled job via `src/instrumentation.ts` | `src/lib/jobs.ts`, `src/lib/sweeps.ts` |
| 9 | No Prisma migration history | YES (prior pass) | **VERIFIED WORKING** — baseline `0_init` + 2 forward migrations; reproducible | `prisma/migrations/` |
| 10 | In-memory rate limiter | YES (prior pass) | **PARTIALLY IMPLEMENTED** — capped, pruned, documented; shared-store needed only for multi-instance | `src/lib/rate-limit.ts` |
| 11 | `ignoreBuildErrors: true` | YES (prior pass) | **VERIFIED WORKING** — `false`; `tsc --noEmit` exits 0 | `next.config.ts` |
| 12 | No automated testing | YES (prior pass) | **PARTIALLY IMPLEMENTED** — 93-check live suite + tsc + lint; no CI/unit framework | `verification/security-tests.ts` |

**Session continuity note:** the previous remediation session lost two artifacts (`src/app/api/upload/route.ts`, `.env.example`) to a sandbox file-loss incident while its database/lib work survived. This session re-verified every claim against the current tree, rebuilt the missing endpoint, and extended the work into the remaining phases (see §3). The old `docs/REMEDIATION_REPORT.md` claimed those files existed; it was wrong about the final tree state — this document supersedes it.

---

## 3. Implemented in this session

**A. Secure uploads (Phase 1)** — `POST /api/upload`: authenticated; 60/15min rate limit; JPG/PNG/WEBP allowlist (+PDF for `kind=document`); magic-byte sniffing with declared-vs-actual anti-spoofing; 8/10 MB caps; server-generated names `<userId>.<16hex>.<ext>` (exclusive-create write, collision retry); private documents stored separately and served only to owner/staff via `/api/files`; public media via `/api/media`; every upload recorded (`UploadRecord` model: owner, purpose, visibility, verified MIME, size) and audit-logged (`FILE_UPLOADED`). Malware-scanning hook point documented (`scanForMalware`) — no scanner configured in sandbox, stated honestly.

**B. Verification-code lifecycle (Phase 2.2)** — codes now expire (10 min), carry a 5-attempt cap (then invalidated), are single-use, request-limited (5/h) and confirm-limited (10/h) for both email and phone; a daily job clears expired leftovers. Tested: countdown, `TOO_MANY_ATTEMPTS`, correct-code-dead-after-cap, `CODE_EXPIRED` on backdated expiry.

**C. Session revocation (Phase 2.3)** — sessions carry a `sessionVersion` claim verified against the database on every request. Password reset and MFA-disable increment it: every previously issued session dies instantly (verified: old cookie → `{user:null}`); the acting user is re-issued a fresh session (demo sessions preserve their demo claim).

**D. Central entitlements (Phases 5/11)** — `src/lib/entitlements.ts` resolves every plan limit from the seeded Plan rows (dealer/garage columns; supplier product/warehouse limits parsed from the seeded feature strings — "Up to 50 products"/"1 warehouse"/"Unlimited"), with deny-by-default free tiers and a 3-day grace window before `PAST_DUE`. Enforced server-side: supplier product creation (`PLAN_LIMIT_REACHED` on breach) and warehouse/branch creation; dealer listing + staff limits already enforced in their routes.

**E. Scheduled operations (Phase 8)** — jobs runner now covers: application SLA sweep (hourly), subscription expiry → `PAST_DUE` with owner notice (hourly), campaign expiry → `ENDED` (hourly), reset-token cleanup (daily), verification-code cleanup (daily). All idempotent, audit-logged, `ENABLE_JOBS`-gated, hot-reload-safe.

**F. Privacy readiness (Phase 10)** — `GET /api/privacy/export`: Kenya DPA data-subject export of the caller's own records (self-scoped queries, no hashes/other users, download audit-logged). `POST /api/privacy/delete-request`: records an erasure request as a DPO-tagged support ticket + staff notification — deliberately NOT auto-deleting (financial/fraud/dispute records have lawful retention); documented for legal review.

**G. Database (Phase 9)** — two additive migrations created via `prisma migrate dev` (`20261109052327_add_upload_records`, `…verification_code_security_session_version`); `db:backup` executed; restore drill passed in an isolated copy (integrity ok, 9/9 row counts match).

**H. Test expansion (Phase 14)** — security suite extended 68 → **93 checks** (uploads matrix, verification lifecycle, session revocation, privacy) — all passing; `tsc --noEmit` exit 0; lint clean.

**I. Demo integrity (Phase 15)** — demo supplier org seeded onto `supplier-pro` (mirrors dealer/garage demo pattern) so entitlement enforcement never breaks the demo experience; demo sandbox guards re-proven by the suite (403s, isolation, reset).

---

## 4. Journey verification (Phase 17, browser + API)

| Journey | Result | Evidence |
|---|---|---|
| Customer: browse → demo sign-in → dashboards | PASS | browser: homepage cards, demo banner, marketplace |
| Showroom: DealerOS loads with plan/renewal state | PASS | browser: "Nairobi Auto Hub · Dealer Pro renews 10 Nov 2026" |
| Supplier: SupplierOS billing incl. Settlements card, honest payment copy | PASS | browser: "activates after your payment is confirmed… never before" |
| Uploads: valid/spoofed/oversized/private/cross-user | PASS | suite §16 (9 checks) |
| Auth: login, reset, session revocation, verification caps | PASS | suite §17–18 (12 checks) |
| Privacy: self-only export, erasure request | PASS | suite §19 (3 checks) |
| Guards: supplier owner denied admin Control Center | PASS | browser: "Access denied" |
| Demo isolation + reset | PASS | suite §1–15 (unchanged, re-proven) |

---

## 5. Remaining external requirements (owner actions)

1. Daraja STK + B2C credentials, live sandbox-then-production payment proof, `MPESA_WEBHOOK_SECRET` + edge IP allow-listing.
2. SMTP account (`SMTP_URL`, `MAIL_FROM`) and SMS gateway (`SMS_PROVIDER`, `SMS_API_KEY`, …).
3. Production hosting: `AUTH_SECRET` (≥32 chars — boot refuses without it), `NEXT_PUBLIC_SITE_URL`, backup schedule (`bun run db:backup`).
4. ODPC registration decision + privacy notice + processor inventory (legal review — see `CARMAZE_SECURITY_AUDIT.md` §6).
5. Malware-scanning service decision for uploads (hook point ready).

Details: `CARMAZE_REMAINING_BLOCKERS.md` · env names: `CARMAZE_ENVIRONMENT_VARIABLES.md`.
