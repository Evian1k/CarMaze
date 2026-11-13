# CARMAZE — Production Release Checklist

Status code used below: **[x] done and verified · [~] code-complete, needs external credentials/action · [ ] not started**

This checklist is the founder-facing gate. Everything marked [~] is blocked ONLY by
external setup (credentials, domain, budget) — the application code for it is
complete, reviewed and honest (it never fakes success).

---

## 1. Security gate

- [x] AUTH_SECRET fail-fast in production (boot refuses without ≥32-char secret; verified by the production build attempting to start without it)
- [x] Session cookies: httpOnly + SameSite=Lax + secure-in-production + 7-day expiry, sessionVersion revocation, per-request DB revalidation
- [x] Password reset / MFA-disable invalidate every existing session
- [x] Email + phone verification codes hashed at rest, TTL, 5-attempt cap, single-use
- [x] Custody release code + collector-name verification, rate-limited (5 / 10 min)
- [x] Delivery drop-off OTP + PO handover OTP + consumer-order collection code: bcrypt-hashed, wrong-code attempts rate-limited (5 / 10 min) — verified by automated suite
- [x] Rate limiter key hardening (last-hop X-Forwarded-For; client-forged first hop ignored)
- [x] IDOR sweep across 20+ resource families — ownership/membership enforced on read AND write
- [x] Demo sandbox: no real payments (assertNotDemoActor on STK push + escrow pay), no real account minting (org staff invites blocked), no real KYC document reads (documents GET guard), owner PII stripped from moderation queues for demo staff, demo→real notifications centrally blocked
- [x] No SQL injection (single parameterized raw query, health check only), no XSS sinks (React text interpolation only; all _blank links noopener), no secrets in logs, generic 500s
- [x] Admin privilege separation: no endpoint grants ADMIN/FOUNDER; org OWNER cannot reach platform roles; FINANCE split for reconciliation/refunds/payouts; FOUNDER_PROTECTED + CANNOT_MODIFY_SELF
- [x] Marketplace moderation RBAC server-enforced (owner + moderator four-role gate)
- [x] Supplier bid confidentiality (rival offers filtered on quote detail)
- [x] Handover QR token exposed to the receiving side only
- [~] Malware scanning of uploads: honest pass-through stub in code — plug an AV/CLAMAV or Daraja-adjacent scanner service before launch with public media (disclosed in `src/app/api/upload/route.ts`)
- [~] Rate limiting is in-memory (single-instance). For multi-instance deployment, move buckets to Redis/Postgres — flagged in `src/lib/rate-limit.ts`, not hidden
- [~] CSRF posture is SameSite=Lax + JSON-only bodies; if you later add form-encoded or cross-subdomain flows, add explicit Origin validation

## 2. Money integrity gate

- [x] No code path lets client JSON mark money paid (all PAID/PROTECTED/SETTLED writers are provider-callback or FINANCE-gated; verified by enumerating every writer)
- [x] M-Pesa callbacks: x-carmaze-signature (timing-safe), fail-closed in production without MPESA_WEBHOOK_SECRET, unique CheckoutRequestID match, terminal-state idempotency, amount-mismatch refuses activation, missing amount fails closed
- [x] Supply escrow webhook: exact-amount equality against the immutable authorization snapshot (overpayment and null amount rejected)
- [x] Escrow release cannot exceed protected funds (cap = amountMinor − refundedAmountMinor; over-cap release → 409 RELEASE_EXCEEDS_ESCROW)
- [x] Delivery-fee freeze once payment is PROCESSING/PROTECTED (late fee inflation cannot create payout above collected funds)
- [x] Dispute refund decisions strip the escrow value they cover (FULL → authorization REFUNDED; PARTIAL → cap); refund-resolution can no longer double-pay
- [x] Refund PROCESSED requires an external provider reference; over-refund bookkeeping rejected
- [x] Reconciliation blocked on DISPUTED orders
- [x] Settlements: created PENDING on release, auto-held on dispute, SETTLED only via provider B2C result (amount-verified) or audited FINANCE reconcile with external reference; never simulated
- [x] PARTS_ORDER invoices now flip the consumer order to PAID on confirmed payment (previously money was collected while the order stayed UNPAID)
- [x] Commission floor can never exceed the commission base; money is Int minor units everywhere
- [x] Listing limits server-enforced via central entitlements (PAST_DUE/expired orgs fall back to free tier)
- [x] Staff-seat cap respects subscription status + grace
- [x] PO payment initiation follows the roleCan matrix (OWNER/GM/PROCUREMENT/ACCOUNTANT)
- [~] Real M-Pesa STK: requires Daraja credentials (MPESA_CONSUMER_KEY/SECRET/SHORTCODE/PASSKEY/CALLBACK_URL/ENV + MPESA_WEBHOOK_SECRET). Without them the API returns honest 501 MPESA_NOT_CONFIGURED and never simulates
- [~] Real B2C payouts: requires MPESA_INITIATOR_NAME/SECURITY_CREDENTIAL/B2C_RESULT_URL. Without them settlements stay PENDING (501 PAYOUT_NOT_CONFIGURED)

## 3. Workflow integrity gate (server-enforced, browser + suite verified)

- [x] Marketplace: submit → moderate → live → enquire → reply → offer → accept → reserved → sold (sold notifies open enquirers + pending-offer dealers; pending offers auto-expire hourly + at accept time)
- [x] DealerOS: enquiry reply SLA (copilot), enquiry assignment (owner/manager only, assignee must be org member, audited), staff billing isolation
- [x] GarageOS: quote → customer-only accept → booking (race-safe unique), custody lifecycle, road tests (authorize/decline customer-only; frozen while DISPUTED), additional-work approval (over-cap cost forces customer approve/decline; garage cannot self-proceed; cost figures OWNER/MANAGER-only)
- [x] Customer protection: custody history, collection codes (code + name verified), incident → staff-only resolution → custody exits DISPUTED on resolution
- [x] SupplierOS: PO respond/approve/revision (garage OWNER/GM; server recomputes totals from DB items), inspection → partial refunds, escrow release cap, disputes (both parties notified on resolution; non-refund resolutions un-hold settlements)
- [x] Logistics: accept (driver+fee) → pickup → OTP-verified delivery with POD photos; wrong OTP never delivers; failure + cancel flows notify
- [~] Enquiry response SLA is fixed at 24 h (copilot insight). Configurable per-org SLA is future work, not a blocker

## 4. Data gate

- [x] Prisma migrations exist (3 applied); dev workflow `db:push`; additive-only changes in this audit (Enquiry.assignedToId, User.marketingConsent, 9 hot-path indexes)
- [x] Hot-path indexes added: Vehicle.ownerId/orgId, Enquiry.userId/vehicleId/status+createdAt, Invoice.orgId+status/userId+status/dueDate, PaymentAttempt.invoiceId, SupportTicket.status/userId
- [x] FK behavior verified: personal artifacts cascade; business records Restrict (no orphaning, no wrong cascades)
- [x] Backup: `bash scripts/backup-db.sh` (gzip, 30-copy retention)
- [x] Restore test: `bash scripts/db-restore-test.sh` — verified PASS (integrity ok, 25 users/8 orgs/13 vehicles restored to a temp copy; live DB untouched)
- [~] Production database: SQLite is correct for single-node launch; document a nightly cron (`backup-db.sh`) + off-box copy (rclone/S3). For multi-node, migrate to Postgres
- [~] Privacy: MARKETING_ONLY erasure is now automatic (consent flag withdrawn immediately, verified); FULL_ACCOUNT erasure is an honest human-reviewed DPO workflow — write the internal runbook (who executes, retention schedule) before launch

## 5. Operations gate

- [x] Scheduled jobs: 6 idempotent sweeps (application SLA, subscription expiry, campaign expiry, offer expiry, token cleanup, code cleanup); ENABLE_JOBS=false for secondary workers; none touch money
- [x] Health endpoint reports database + provider configuration honestly (booleans/names only, never values)
- [x] Environment reference complete in `.env.example` (all variables names-only; MPESA_BASE_URL added)
- [x] Production build: `next build` compiles clean (TypeScript passes; all 154 API routes built); production server smoke-tested (home 200, health honest, admin gated 401)
- [x] Automated suite: `bun verification/security-tests.ts` — **119 passed, 0 failed** (was 93: +26 covering payment forgery/idempotency, demo money blocks, moderation RBAC, procurement tenant isolation, demo sandbox hardening, enquiry assignment, OTP brute-force limiter, work-approval state machine)
- [x] Load sanity: 1200 requests / 20 concurrent → 0 errors; memory stable (dev-mode compile cache plateaus; no app-tier leak)
- [~] Error monitoring (Sentry or equivalent) — not wired; wire before launch
- [~] Domain + DNS + TLS in front of NEXT_PUBLIC_SITE_URL; Daraja callbacks must reach https://<domain>/api/billing/mpesa/callback
- [~] Long-lived process supervision (systemd/Docker) with memory limit + restart policy; dev-mode Next.js accumulates compile caches for hours — production must run `next start`, not `next dev`

## 6. Founder actions (exact, in order)

1. Provision the domain; point DNS; install TLS.
2. Fill `.env` from `.env.example`: strong AUTH_SECRET, NEXT_PUBLIC_SITE_URL, MPESA_* (Daraja sandbox first, then production), MPESA_WEBHOOK_SECRET (`openssl rand -hex 32`), SMTP_URL/MAIL_FROM, SMS_*.
3. Apply DB migrations (`bunx prisma migrate deploy` once migrations are the workflow, or keep `db:push` for single-node first launch) and run one manual `backup-db.sh` + `db-restore-test.sh`.
4. Create the real Daraja app; register the two callback URLs; pay the API accessibility fee if applicable; run one sandbox STK push end-to-end.
5. Choose and configure the email + SMS vendors; send one real verification email + one real SMS from the staging deployment.
6. Set up nightly `backup-db.sh` cron + off-site copy; run the restore test once on the off-site copy.
7. Wire error monitoring (Sentry DSN) + uptime check on /api/health.
8. Run `bun verification/security-tests.ts` against staging; require 119/119.
9. Decide the pilot-ops policy for FINANCE mark-paid usage (manual reconciliation is audited but bypasses provider verification — restrict to named staff).
10. Only then flip MPESA_ENV=production.

## 7. Known accepted trade-offs (documented, not hidden)

- Chat attachments and protection-claim photos are public media under unguessable random names (they must be viewable by the counterparty; private storage would need per-object ACLs). Identity/business documents are private (verified).
- Verification codes for email/phone were hashed this audit; the dev-only code-return channel is strictly gated behind NODE_ENV !== 'production'.
- In-memory rate limits reset on restart (single-instance trade-off).
- Audit writes are best-effort (non-transactional with the mutation) — acceptable for this scale; transactional audit is future work.
- Vehicle.featured flag is wired to paid campaigns but featured slots are not yet granted anywhere (dead flag — cosmetic).
