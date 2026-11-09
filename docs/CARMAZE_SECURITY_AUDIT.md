# CARMAZE — Security Audit

**9 Nov 2026 · Based on code inspection + the 93-check live verification suite (`bun verification/security-tests.ts`) + manual endpoint probing.**

---

## 1. Authentication & sessions — STRONG

- **Password hashing**: bcrypt cost 10 (`src/lib/auth.ts`).
- **Session tokens**: HS256 JWT via `jose`, httpOnly + sameSite=lax cookie, `secure` in production, 7-day default (demo sessions clamp to ≤14 days, hard-capped server-side).
- **Per-request DB re-read**: roles/status re-verified every request — suspensions and role revocations are immediate (suite §12 proves live revocation).
- **Session revocation (new this session)**: `sessionVersion` claim checked against the DB per request; password reset and MFA-disable increment it. Verified: old cookie → `{user:null}` immediately after reset (suite §18).
- **Secret management**: `AUTH_SECRET` mandatory ≥32 chars in production — boot throws; the development fallback warns loudly and exists only outside production. Verified in dev.log output.
- **Login error surface**: generic failures; no account-existence disclosure in responses. Reset flow uses constant-shape responses (token always consumed the same way).
- **MFA**: self-implemented RFC 6238 TOTP (`src/lib/totp.ts`); disable requires the account password (re-auth for sensitive action) and now also revokes other sessions.

Residual: "sensitive actions require recent authentication" is implemented only for MFA-disable; other sensitive actions (e.g. org ownership transfer) rely on role checks rather than step-up auth. Acceptable for pilot; noted for hardening backlog.

## 2. Verification & one-time codes — STRONG (hardened this session)

- Codes: crypto-secure `sixDigitCode()` (rejection sampling, no modulo bias) — used for email/phone verification, dispatch handover OTP, custody collection codes.
- Lifecycle: 10-minute expiry, 5-attempt cap then invalidation, single-use, request 5/h, confirm 10/h per user. All four properties verified by executed tests (suite §17 + expiry backdating probe → `CODE_EXPIRED`).
- Password reset: sha256-hashed tokens, expiry, single-use, daily cleanup job.
- Production without a provider: verification endpoints return honest 503 `CHANNEL_NOT_CONFIGURED` — codes are never leaked in HTTP responses.

## 3. Authorization & tenancy — STRONG

- Deny-by-default: `requireUser`/`requireRole`/org membership gates on every business endpoint; the `route()` wrapper normalizes errors without leaking internals.
- Tenant isolation: `requireOwnOrg` + org-scoped queries; cross-org probes denied in suite §3–10.
- Demo sandbox: server-side guards (`assertDemoResourceGuard`, `demoStaffMutationGuard`, `assertNotDemoActor`, `assertNotDemoStaffRead`); demo sessions cannot reach real users' data, real payments, or platform-wide mutations; PII views closed to demo staff. Re-proven across suite §1–15.
- Uploads (new): authenticated, rate-limited, magic-byte allowlist (no executables can pass), declared-vs-actual MIME anti-spoof, server-generated filenames (no traversal/injection/overwrite), private documents separated from public media, owner/staff-only serving with document access logging. 9-check matrix passes (suite §16).

Residual: `GET /api/media/*` is intentionally public (marketplace photos) — attachments in authorised conversations use the same shared media pool by design; documented, unchanged.

## 4. Payments & webhooks — HONEST BY CONSTRUCTION

- Frontend responses can never activate paid entitlements; only the Daraja callback or FINANCE manual reconciliation does (`src/app/api/billing/_activate.ts`).
- Webhook: `MPESA_WEBHOOK_SECRET` timing-safe header check, **fail-closed in production** when unset (401, no detail). Amount integrity: mismatched callbacks rejected; idempotent per checkout id.
- Demo actors: STK push blocked centrally (`DEMO_SANDBOXED`), verified live.
- Unconfigured deployments: 501 `MPESA_NOT_CONFIGURED` + `PaymentAttempt` FAILED row with the exact missing env names — never a simulated success.
- Settlements: `PENDING → SETTLED` only via B2C result callback or audited manual reconciliation with external reference; disputes auto-hold owed payouts.

## 5. Infrastructure — ADEQUATE FOR SINGLE INSTANCE

- Rate limiting: sliding-window, 20k-bucket cap, idle pruning, unref'd housekeeping; keyed per user+IP on sensitive routes. Single-instance caveat documented in-code; multi-instance needs a shared store.
- Errors: `route()` wrapper returns normalized codes; stack traces never sent to clients; structured JSON logging (`src/lib/logger.ts`).
- Jobs: idempotent, audit-logged, `ENABLE_JOBS` kill-switch, once-per-process guard.
- Headers: framework defaults + `X-Content-Type-Options: nosniff` on media; a CSP is not configured (see blockers — recommended before public launch).
- Uploads: malware-scan hook point present; no scanner configured (strict allowlist is the active defense). Wire ClamAV/VirusTotal fail-closed before high-volume public launch.

## 6. Kenya DPA 2019 readiness — ENGINEERING-READY, LEGAL REVIEW REQUIRED

Implemented: self-scoped data export (audit-logged), erasure-request workflow with human review and retention-safe messaging, private identity documents with access logging, demo/PII view isolation, honest delivery records (no false claims of contact).

Requires legal review (not code): ODPC registration determination; privacy notice + consent copy; data-processor inventory (Safaricom Daraja, SMTP/SMS providers, host); retention schedule sign-off (financial/fraud/dispute records retained); breach-response procedure ownership.

## 7. Findings summary

| Severity | Finding | State |
|---|---|---|
| HIGH (was) | Missing upload endpoint — unauthenticated workaround risk | CLOSED this session |
| HIGH (was) | AUTH_SECRET fallback | CLOSED (prior pass, re-verified) |
| HIGH (was) | Math.random codes | CLOSED (prior pass, re-verified) |
| MEDIUM (was) | Codes never expired / unlimited attempts | CLOSED this session |
| MEDIUM (was) | Sessions survived password reset | CLOSED this session |
| MEDIUM (was) | Supplier plan entitlements unenforced | CLOSED this session |
| LOW | In-memory rate limiter (single instance) | DOCUMENTED, acceptable |
| LOW | No CSP header yet | OPEN — pre-launch item |
| LOW | Malware scan not connected | OPEN — hook ready, credential-gated |
