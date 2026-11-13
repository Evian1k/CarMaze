# CARMAZE — Final Pre-Launch Blocker Resolution: Acceptance Report

**Date: 13 Nov 2026 (final re-verification pass).** This report covers ONLY the pre-launch blocker work requested in "FINAL PRE-LAUNCH BLOCKER RESOLUTION". No new features, no redesigns, no price or commission changes, no demo/user data deleted, no external provider claimed working without a real test.

**Verification gates actually executed (re-executed and confirmed in the final pass, not inherited from a prior session):**

| Gate | Result |
|---|---|
| `bunx tsc --noEmit` | exit 0, no errors |
| `bun run lint` | clean (exit 0) |
| `bun verification/security-tests.ts` (fresh dev server) | **139 passed, 0 failed** (119 prior checks preserved + 20 new regression checks) |
| Fresh-database procedure on a clean staging DB | **RE-TESTED end-to-end in the final pass** (see §1) |
| Founder bootstrap + 4 negative guards | **RE-TESTED in the final pass** (see §1) |
| `prisma migrate diff --from-migrations --to-schema-datamodel` | **No difference detected** (exit 0) |
| Browser walkthrough (agent-browser) | landing renders, demo sign-in works, marketplace loads with live data, non-admin correctly denied at #/admin, mobile 390px layout + sticky footer verified, screenshots in `verification/09-final-mobile.png` / `10-final-desktop.png`, no console page errors |
| `bun run build` (production) | exit 0 in the previous session's pass; **NOT re-executed in the final pass** (sandbox rule protects the dev server; the build ran clean when last executed — re-run it on the deployment host per the runbook) |

**Incident found and fixed in the final pass (6th file-loss event):** the hardened upload endpoint (`src/app/api/upload/route.ts`) — the centrepiece of §2 — was lost from the working tree between sessions because it had **never been committed to git** (all git history and both recovery copies held only the pre-quarantine version; the security suite caught it immediately: 130/139 with 6 quarantine failures). The endpoint was rebuilt to the same contract, the two recovery copies (`agent-ctx/critical/api-upload-route.ts`, `agent-ctx/upload-route-backup.ts`) were updated to the hardened version, and **everything is now committed** (commit `4402bfc`). The suite was re-run on a fresh server after the rebuild: 139/139.

---

## 1. Deployment contradictions — RESOLVED and RE-TESTED

**Root contradiction found and fixed:** the migration history was incomplete — `User.marketingConsent`, `Enquiry.assignedToId` and 12 indexes had only ever been applied to the dev DB via `db:push`. A fresh `prisma migrate deploy` database could not run the app (verified: the first staging attempt failed on the missing `marketingConsent` column).

Changes:
- `prisma/migrations/20261113103525_prelaunch_security_hardening` — the security schema of this pass (OTP TTL fields, QR hash/encrypted fields, `Settlement @@unique([orderId, kind])`, `BusinessMembership @@unique([orgId, customerId])`, UploadRecord scan/quarantine/evidence fields, `FileAccessLog`). Applied to the dev DB non-destructively (SQL executed + marked applied; 25 users / 10 demo accounts / all vehicles verified intact after).
- `prisma/migrations/20261113103712_reconcile_schema_drift` — captures the historical db:push deltas so migration history == schema exactly (`prisma migrate diff` now reports **no difference** — re-confirmed exit 0 in the final pass).
- `bun run db:deploy` (= `prisma migrate deploy`) and `bun run db:status` added; `db:push` relabelled DEV-ONLY everywhere in code comments and docs.
- `scripts/create-founder.ts` + `bun run founder:create`: fail-closed one-off bootstrap (refuses: existing founder, duplicate email, demo data in DB without explicit override, weak password, missing `FOUNDER_CONFIRM=YES`; bcrypt-only storage; `FOUNDER_BOOTSTRAP` audit row written transactionally).
- One documented, repeatable procedure: `docs/CARMAZE_FRESH_DATABASE_INIT.md`.
- Docs contradiction sweep: `02-technology-stack`, `03-project-structure`, `16-infrastructure-deployment`, `17-developer-guide`, `CARMAZE_PRODUCTION_RELEASE_CHECKLIST` no longer suggest `db:push` for production anywhere.
- New in the final pass: `verification/verify-staging-bootstrap.ts` — a repeatable read-only contract checker for a candidate fresh DB (17 checks: exactly one FOUNDER user, bcrypt hash format + password verifies + plaintext never stored, zero demo/vehicle/invoice/upload/settlement/order rows, audit row links to the founder).

**Staging test re-executed in the final pass:** fresh `/tmp/carmaze-staging.db` → `prisma migrate deploy` (5 migrations, exit 0) → `prisma migrate status` "Database schema is up to date!" → founder created → `verify-staging-bootstrap.ts` **17/17 PASS** → negative tests: second founder REFUSED, duplicate email REFUSED (behind the founder guard), weak password REFUSED, missing `FOUNDER_CONFIRM` REFUSED → re-check after refusals: database unchanged (still exactly one user, one audit row) → staging DB deleted.

## 2. Upload security — genuine quarantine workflow implemented (rebuilt + committed in the final pass)

- **Scanner integration (`src/lib/malware-scan.ts`):** auto-detects `clamdscan`/`clamscan` on the host, or a custom command via `CARMAZE_SCAN_CMD`. Exit codes 0/1/2 → CLEAN/INFECTED/ERROR. No scanner claimed working — the sandbox has none, and the health endpoint honestly reports `malware_scanner: not_configured` (verified live in the final pass).
- **Fail-closed quarantine (`/api/upload`, rebuilt in the final pass):** every PDF (the active-content class) is written to `data/quarantine` and is NOT served to anyone — not even the uploader (HTTP 423 SCAN_PENDING) — until a scan reports CLEAN or staff approve after human review. Scanner unavailable or erroring ⇒ stays locked. **Nothing is silently approved.**
- **Enforced-inert images** (PNG/JPEG/WEBP, magic-byte-verified; SVG/HTML can never be stored) serve with an honest `SCANNER_UNAVAILABLE` status recorded, visible in the staff console, with takedown available.
- **Static active-content refusal:** any PDF containing `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/OpenAction` or `/AA` is rejected outright (415 `ACTIVE_CONTENT_REFUSED`) regardless of scanner state.
- **Audited staff review console:** `GET /api/admin/uploads` (REVIEWER/MODERATOR/ADMIN/FOUNDER, never demo sessions) + `POST /api/admin/uploads/[name]/action` (`rescan` | `approve` → `APPROVED_MANUAL` | `reject` → bytes destroyed). Every action audit-logged with reviewer identity.
- **Sweeps:** hourly quarantine re-scan (releases clean files once a scanner is installed; never self-approves) and daily evidence retention (expired EVIDENCE past a 90-day grace is deleted with its access logs).
- **Sensitive evidence moved out of the public media path.** Chat attachments, protection-incident evidence, POD photos, custody handover/completion photos, quote/order/dispute evidence now upload as `kind=evidence` → private storage, served via `/api/files/[name]` with **participant-gated access control** derived from the case rows (`src/lib/evidence-acl.ts`: conversation participants, incident reporter/org, delivery requester/partner, custody customer/org, dispute parties), **1-year access expiry**, and **every non-owner view + every denial recorded in `FileAccessLog`**. Verified live by the suite: stranger 403, anon 401, owner 200.
- **Supplier business-registration docs** (supplier onboarding gate) were previously PUBLIC — fixed to `kind=document` (private).
- **Upload-provenance validation:** chat/incident/POD/custody/dispute schemas now accept only `/api/(media|files)/<name>` references matching the server-generated name shape (external URLs and traversal strings rejected; verified live).
- Existing upload functionality preserved: listing/product/branch images, verification documents, and all client flows keep working (client call sites updated in place; the suite re-verifies the full pipeline each run).
- **Anti-recurrence:** the hardened endpoint is committed to git AND its recovery copies are the hardened version, so the `ensure-critical-files` guard can only ever restore the correct build.

## 3. Financial integrity — atomic, guarded, durably audited

New principle applied everywhere money moves: **re-read inside the transaction, conditional `updateMany` transitions (count-checked), DB unique constraints as backstops, audit row written inside the same transaction (`auditTx`, `src/lib/audit.ts`).** No amounts, prices or commissions were changed.

| Path | Fix | Regression test |
|---|---|---|
| Supply escrow webhook (`/api/supply/payments/webhook`) | Full transaction + terminal-state guard (RELEASED/REFUNDED/CANCELLED can never be resurrected); success flips require `status in [PENDING, PROCESSING]`; failure callbacks can never clobber a concurrent PROTECTED; duplicate event keys are no-ops; PO/invoice flips conditional; audit inside tx | live no-op checks (unknown ref + replay) |
| Escrow release (`action: release`) | One transaction: escrow re-read, cap recomputed against current refunds inside tx, conditional PROTECTED→RELEASED flip, conditional PO INSPECTED→COMPLETED, settlement created in-tx against the DB unique | covered by suite + code |
| Settlement creation (`src/lib/settlements.ts`) | `@@unique([orderId, kind])` migration + P2002 catch returning the existing row — **one payout queue per order, DB-enforced** | migration + suite |
| B2C payout result (`/api/admin/settlements/payout/result`) | Conditional PROCESSING-only transitions; **ON_HOLD (dispute) settlements are NEVER settled by a late provider result** — recorded for manual reconciliation instead; replays on SETTLED/FAILED/CANCELLED are no-op events | live unknown-ref ack |
| Settlement admin actions (`process`/`reconcile`) | `process` enters PROCESSING via conditional updateMany (two finance operators can't both start a payout); failure path only clobbers PROCESSING; `reconcile` flips SETTLED in-tx with the audit row | code-level |
| Billing callback (`/api/billing/mpesa/callback`) | Attempt flip + invoice activation in ONE transaction; both conditional (attempt must be INITIATED/PENDING; invoice must be unpaid); duplicate/late callbacks are acknowledged no-ops; audit inside tx | live replay acks |
| Invoice activation (`_activate.ts`) | Rewritten as `activatePaidInvoiceTx`: invoice flip conditional (`notIn PAID/REFUNDED/CANCELLED`) → concurrent mark-paid vs callback resolves to a single winner; subscription create P2002-safe; campaign/membership/consumer-order flips conditional; escrow protection never clobbers PROTECTED/RELEASED/REFUNDED; INVOICE_PAID audit written in-tx (mark-paid passes its actor) | code-level |
| `mark-paid` | Uses the transactional activation; duplicate audit rows eliminated | code-level |
| `stkpush` | Double-charge guard: refuses when an INITIATED/PENDING attempt already exists for the invoice (PAYMENT_IN_FLIGHT) | code-level |
| Manual reconciliation (`reconcile-payment`) | Transaction + conditional escrow flip (PENDING/PROCESSING/FAILED only) — a concurrent provider confirmation wins and reconciliation is honestly rejected | code-level |
| Refund processing (`process-refund`) | Refund flip conditional (REQUESTED/APPROVED only → never double-counted); escrow refunded total recomputed in-tx against the full already-out cap; rollback on breach | code-level |
| Dispute resolution refund queue | Cap computation + refund row + escrow bookkeeping in one transaction against a freshly-read escrow; `DISPUTE_REFUND_QUEUED` audited in-tx | code-level |
| Dispute open (`action: dispute`) | Duplicate-dispute check transactional; PAYMENT_FINALISED checked before creation | code-level |
| Inspection (`action: inspect`) | Conditional DELIVERED→INSPECTED flip (one concurrent inspection wins, loser rejected before writing quantities/stock/refunds); refund-queue creation transactional | code-level |
| Credit facility ledger | Balance recomputed + entry written + audit in one transaction (concurrent charges can't both pass the limit check) | code-level |
| Membership subscribe | Limit + one-per-customer checks inside the transaction; `@@unique([orgId, customerId])` backstop catches concurrent subscribes (verified 0 pre-existing duplicates before migrating) | migration + code |
| Campaign create | One-promotion-per-listing check moved INSIDE the creation transaction | code-level |
| Consumer order accept | Stock cover re-checked in-tx with conditional decrement (`qtyOnHand >= qty`); concurrent accepts can't oversell; no invoice minted on rollback; order flip conditional | code-level |
| PO pay route | Authorization create P2002-safe (orderId unique); invoice dedup via conditional flip; snapshot refresh in-tx; PROCESSING flip conditional | code-level |
| Audit durability | `auditTx()` writes financial audit rows inside the money transaction (money can never move without its trail; rollback removes both). `audit()` retained for non-financial events | used across all paths above |

## 4. Security hygiene — closed

- **QR tokens hashed** (`sha256Hex` in `src/lib/secret-box.ts`): logistics `DeliveryJob` and procurement `Delivery` tokens now stored as `qrTokenHash` (the ONLY verification input) + `qrTokenEnc` (AES-256-GCM sealed raw token, key derived from AUTH_SECRET, unsealed only for the intended recipient's QR rendering). Legacy plaintext rows self-heal to hash+sealed on first verification (code re-verified in the final pass; no data loss — the 1 legacy row keeps working).
- **Absolute OTP expiry (72h)** on: logistics drop-off codes (`DeliveryJob.otpExpiresAt`), procurement handover OTP/QR (`Delivery.otpExpiresAt`), consumer collection codes (`CustomerOrder.otpExpiresAt`) — enforced at verification with clear user-facing errors (all three enforcement sites re-verified in code in the final pass). Custody collection codes already had 48h; email/phone/reset already TTL'd (`verify-phone`: 10-minute `CODE_TTL_MS`).
- **CSP + security headers** (`next.config.ts`, production only so the sandbox preview iframe keeps working): strict `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `nosniff`, `X-Frame-Options DENY`, `Referrer-Policy`, minimal `Permissions-Policy`, HSTS. Documented that Caddy owns TLS.
- **Proxy/rate-limit topology confirmed** in code comments + runbook: single app instance required for the pilot; the limiter is in-memory (documented caveat); Caddy must be the only thing able to reach port 3000 and must append the client IP to X-Forwarded-For (`getIp` trusts the last entry).
- **Log hygiene:** `logger.ts` redacts secret-shaped keys (password/token/otp/code/secret/key/cookie/session/credential/authorization/msisdn/national-id…) and bearer-token-shaped values at any nesting depth (re-verified in the final pass). No `console.*` in `src/` prints secrets; audit metadata carries no raw OTP/tokens; dev-only plaintext code returns are gated to non-production AND provider-unconfigured.
- `CustomerOrder.otpHint` remains last-4 (buyer-facing collection code UX; the code itself is bcrypt-hashed, TTL'd, attempt-capped and rate-limited).

## 5. Automated verification — repeatable and isolated

- `bun run verify` = lint + tsc + security suite (one command).
- CI: `.github/workflows/ci.yml` — ESLint → `tsc --noEmit` → fresh ephemeral DB via `prisma migrate deploy` + seed → boots a throwaway server → runs the full security suite → production build. **Test data is ephemeral (CI) or demo/test-local (manual); the suite REFUSES to run against a non-local target or a production process (isolation guard at suite start).**
- **20 new regression checks; suite grew 119 → 139, all passing on a fresh server (re-confirmed in the final pass after the upload-route rebuild):** honest scan status + 423 owner lock + anon lock + active-content PDF refusal; review-console RBAC (admin OK, user 403, demo 403, anon 401) + audited approval flow (423 → APPROVED_MANUAL → owner 200 → stranger 403); evidence ACL (private store, owner 200, stranger 403, anon 401); attachment provenance (external URL 400, traversal 400); money no-op idempotency (B2C unknown ref, escrow duplicate callback, replayed billing callback).
- `.env.example` documents `CARMAZE_SCAN_CMD`; `/api/health` surfaces `malware_scanner` honestly.

## 6. Deployment runbook

`docs/CARMAZE_DEPLOYMENT_RUNBOOK.md` — exact commands for fresh server prep (incl. ClamAV + UFW), release/env config, migration, FOUNDER creation, build + systemd (with `MemoryMax` reflecting the known OOM history), Caddy TLS + XFF, jobs, off-site backups + restore drill, monitoring, deploy/rollback, post-deploy gate. Every step carries an honest status: **TESTED** (db init, founder, build, health) vs `[NOT RUN HERE]` (requires the real host/provider) — nothing invented, no credentials fabricated.

## 7. Remaining known risks (honest)

1. **No malware scanner in this sandbox** — the workflow is fail-closed (PDFs locked until staff approval), but you should install ClamAV on the production host (`apt install clamav clamav-daemon`) so scans happen automatically instead of by human review.
2. **No live payment proof exists** — unchanged: Daraja sandbox/production test cases require real credentials. Until they pass, describe CARMAZE as payment-ready, not live-verified.
3. **Production build not re-executed in the final pass** (sandbox rule protects the dev server from build-induced OOM). It exited 0 when last run; the deployment host build is the authoritative one (runbook §5).
4. **Concurrency regressions** were verified by the conditional-guard code paths + reachable live checks; true parallel stress tests (two simultaneous releases) are not in the suite — the DB constraints (unique settlement, conditional transitions) are the enforcement layer.
5. **In-memory rate limiter** resets on restart and is single-instance (documented; pilot runs one instance).
6. **Evidence URLs in chat** remain JSON arrays in message bodies; participant lookup uses containment matching (works for the pilot's scale; a dedicated link table would be the post-pilot refinement).
7. **Sandbox file-loss pattern** (6 incidents to date) — mitigated as far as the sandbox allows: critical file is committed, recovery copies updated, guard restores on missing-only, and the suite's 20 quarantine regressions fail loudly within one run if the endpoint ever regresses again. The deployment host has no such history.
8. **Legal pack, ODPC registration, provider accounts** — unchanged founder TODOs (handover §3/§7).

## 7b. External credentials/accounts still required (unchanged)

AUTH_SECRET, NEXT_PUBLIC_SITE_URL, the Daraja STK + B2C sets, MPESA_WEBHOOK_SECRET, SMTP_URL/MAIL_FROM, SMS set, hosting, domain, backup target, error monitoring — exactly per `.env.example` and handover §4. New optional: `CARMAZE_SCAN_CMD` (or just install ClamAV).

## 7c. Exact deployment commands

See `docs/CARMAZE_DEPLOYMENT_RUNBOOK.md` (full) and `docs/CARMAZE_FRESH_DATABASE_INIT.md` (the tested DB + founder core):

```bash
bun run db:deploy && bun run db:status
FOUNDER_CONFIRM=YES FOUNDER_EMAIL=… FOUNDER_NAME="…" FOUNDER_PASSWORD='…' bun run founder:create
bun run build && systemctl start carmaze   # unit file in the runbook
curl -s http://localhost:3000/api/health
```

**Yes — a fresh database deployment and founder bootstrap were successfully tested on a clean staging database in the final pass** (17/17 contract checks + all 4 negative guards refusing), the full suite ran **139/139** on a fresh server, tsc and lint are clean, and the browser walkthrough confirmed the app renders and the golden paths work. **No critical blocker remains in the application itself**; the remaining items (§7) are external provisioning tasks — real-host setup, provider credentials and a live payment proof — that by definition cannot be completed inside this sandbox.

**Verdict: CONDITIONALLY READY for the controlled Kenyan pilot** — application-side blockers are resolved and verified; go-live requires executing the runbook on the real host with real credentials.
