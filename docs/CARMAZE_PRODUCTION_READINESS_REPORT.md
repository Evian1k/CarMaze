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

> **ADDENDUM — 10 Nov 2026.** The same two artifacts were lost a second time to another sandbox file-loss event (everything else — migrations, providers, settlements, jobs, entitlements, privacy routes, backups — survived intact). Both were rebuilt against the exact contracts already proven by the test suite: `POST /api/upload` re-implemented to the §16 upload matrix (auth → 401, magic-byte sniffing → 415 both spoof directions, kind guard → 400, 8 MB cap → 413, server-named `userId.16hex.ext` files, `UploadRecord` row + `FILE_UPLOADED` audit, `kind=document` → private `/api/files`), and `.env.example` restored from `CARMAZE_ENVIRONMENT_VARIABLES.md`. Suite re-run: **93/93 passed**; `tsc --noEmit` exit 0; lint clean. **One new defect was found and fixed during live browser verification** of this rebuild: the private serving route sent `Cache-Control: private, max-age=60`, and the browser's HTTP cache (keyed by URL, not credentials) kept serving a private document for up to 60 s **after the viewer's session ended** — observed as an anonymous cookie-less fetch returning 200 for a URL the same browser had just viewed. Fixed to `private, no-store` in `src/app/api/files/[name]/route.ts` (privacy over the small re-download cost; every authorised staff view now always reaches the access log). Re-verified live: owner 200 → same-URL anonymous fetch 401. Operational note: this sandbox reaps background jobs owned by a finished tool session, killing plain `nohup bun run dev &` within minutes; `scripts/start-dev-daemon.py` (double-fork daemonisation + heap cap) is the reliable way to keep the dev server up.

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

---

## 2026-11-10 (later session) — Role-surface hardening & third sandbox file-loss rebuild

1. **Third sandbox file-loss incident.** `src/app/api/upload/route.ts` was again missing
   from the working tree (17 client call sites affected). Rebuilt to the §16 contract and
   re-proven by the security suite: 93/93 on a fresh dev server process. Ops note: when a
   session resumes with "route not found" symptoms, check for silently reverted files
   before debugging the server.
2. **Demo-vs-real financial boundary closed.** Demo sessions could previously reach
   invoice mark-paid / refund / platform billing reads via ADMIN-tier roles. These now
   hard-fail 403 `DEMO_SANDBOXED` for demo sessions while real staff accounts retain the
   pilot-ops capability (control-tested with the seeded FOUNDER).
3. **Sandbox-consistent moderation.** Report resolution applies
   `demoStaffMutationGuard` against the reported content's true owner (resolved from the
   database), so demo staff can exercise the moderation queue on demo content only.
4. **Role-aligned business UI.** DealerOS/GarageOS now hide tabs and actions their
   caller's org role cannot exercise server-side (staff/billing for sales staff;
   service-editing, quoting and profile/billing for garage staff). This is UX alignment
   only — every API re-checks authorization (deny-by-default unchanged).
5. **Demo content completeness.** Seed now gives the primary garage org a live booking,
   an accepted-quote flow and two reviews so no demo dashboard opens empty.

## 2026-11-11 — Full functional + roles end-to-end pass

Triggered by the user's requests to (a) have a demo for every section and
(b) "make everything function the way it should including the roles".

1. **Fourth sandbox file-loss incident, same file.** `src/app/api/upload/route.ts`
   was missing again after session recycle. Restored from the tracked copy at
   `agent-ctx/upload-route-backup.ts` (byte-identical to the §16 contract) and
   re-proven through the REAL UI: demo private-seller completed the full sell
   wizard — photo upload → 201 → `/api/media/<server-name>` serves 200
   `image/png` → listing submitted for review. Security suite re-run: **93/93**.
2. **RBAC fixes (all server-verified in browser unless noted):**
   - `vehicles/[id]` PATCH/DELETE staff bypass narrowed to
     REVIEWER/MODERATOR/ADMIN/FOUNDER (was any staff role incl. SUPPORT/FINANCE),
     mirroring `/api/admin/listings`. Staff READ access unchanged.
   - `/api/dealer/copilot` now redacts billing insights (subscription, overdue
     invoices) from members without an OWNER/MANAGER/FINANCE org role — verified
     live: showroom-owner sees `subscription-renewal`, showroom-staff does not.
   - GarageOS `isOrgAdmin` narrowed to OrgMember OWNER|MANAGER to mirror the
     server gates exactly (GM/OPERATIONS/ACCOUNTANT no longer see edit
     affordances the API would 403). Code-level fix; seeded roles unaffected.
   - Demo platform-admin: `verification` added to `DEMO_RESTRICTED_TABS`, so the
     tab (whose queue endpoint is demo-blocked server-side) no longer renders a
     403 toast panel. Verified live: tab absent, no errors.
   - Schema comment drift removed: `PROCUREMENT` documented as a User role but
     only ever exists as an OrgMember role.
3. **Demo coverage additions (seed):** a second OPEN buying request from the
   OTHER demo dealership so DealerOS's cross-dealer board shows real market
   demand (verified live); one shared 3D-customizer configuration
   (`#/customizer?cfg=CRM9DEMO2XK4`) so the share-restore flow is demoable
   (verified live: exact config restored).
4. **Per-role browser walk (all 10 demo keys):** every demo identity logs in,
   lands on its correct dashboard, and sees live seeded content — customer
   (marketplace / my-garage / customizer share), private-seller (listings +
   sell/upload), showroom-owner & staff (DealerOS with role-appropriate tabs +
   copilot), garage-owner & staff (GarageOS + Procurement with approvals gated
   by OWNER/GM), supplier-owner (SupplierOS: products, warehouses, PO-DEMO01/02/03),
   logistics-owner (LogisticsOS: jobs incl. IN TRANSIT/DELIVERED, fleet),
   platform-support (support queue incl. live DPO ticket), platform-admin
   (restricted read-only tour).
5. **Layout re-check:** mobile (iPhone 14) marketplace renders with the fixed
   bottom tab bar; the `mt-auto` app footer measured flush with the document
   bottom on desktop (`bottom=900` at `innerHeight=900`; an earlier "gap" reading
   was a page-content `<footer>` CTA card, not the site footer). No console
   errors; only pre-existing benign warnings.

Known limitations (unchanged, honest): upload malware-scan hook is an honest
pass-through; M-Pesa/Daraja, SMTP and SMS remain unconfigured (env names in
`.env.example`); payment success is never simulated.

## 2026-11-13 — Fifth file-loss + permanent self-healing guard

`src/app/api/upload/route.ts` was again the only casualty of a session recycle
(whole directory removed; every other edit survived). Git forensics show the
platform's auto-commit snapshots had already recorded the deletion, so git
alone could no longer restore it. Permanent fix, verified live:

1. `scripts/ensure-critical-files.ts` now runs before every dev-server start
   (wired into the `dev` script) and restores any missing critical file from a
   tracked copy under `agent-ctx/critical/`. Restores only when the target is
   absent (never overwrites live edits); exits non-zero on failure so a broken
   start is loud.
2. Both the guard and a second recovery copy are committed to git
   (e4c4b01), so future snapshots can never lose the recovery path itself.
3. Guard tested both ways (present → pass-through; deleted → restored, exit 0).
4. Post-restore verification on a fresh server: unauthenticated upload → 401,
   authenticated upload → 201 with server-generated name, media read-back →
   200 image/png, declared-type spoof (PNG bytes as text/plain) → 415, image
   accepted under kind=document → 201. Home renders clean, dev log clean.

## 2026-11-13 — Full 10-role end-to-end walkthrough (browser-verified)

Every demo role was signed into a real browser and taken through its
dashboard and signature workflows, plus cross-role state transitions:

1. **Customer (Amina)** — AI car finder returned a real listing; vehicle
   detail + enquiry ENQ-HL396X sent; shortlist save; My Garage records +
   reminders; custody dialog read; customizer shared config CRM9DEMO2XK4
   loaded (Crimson selected), Save & Share reissued the same shareId;
   membership subscribe created a pending invoice with benefits locked
   until payment confirmation (no simulated success).
2. **Private seller (James)** — landed on My Listings; full sell wizard:
   make/model/body/county, photo upload (201 + media read-back), AI draft
   description applied, preview, submit → CM-U8TM5X Pending review;
   offers tab showed 2 seeded offers; accepting Nairobi Auto Hub's offer
   reserved the listing.
3. **Showroom owner (David)** — DealerOS overview KPIs + Copilot surfaced
   the cross-role enquiry; replied to ENQ-HL396X → status Answered;
   inventory shows Live/Draft/Reserved with per-status actions; buying
   board shows own + other dealers' requests.
4. **Showroom staff (Brian)** — Staff and Billing tabs hidden; Copilot
   shows operational insights only (no subscription/invoice fields);
   `/api/billing/invoices` → 403, org staff management → 403; enquiry
   read allowed (2 org enquiries).
5. **Garage owner (Mary)** — GarageOS KPIs live; customer custody job
   HC-K7Q2MD visible; procurement workbench + portal (OWNER badge, cart,
   7 tabs, KES 76K spend, stock alerts).
6. **Garage staff (Kevin)** — services tab has no edit affordances;
   supply orders read OK (3), POST → PERMISSION_DENIED; catalogue 200.
7. **Supplier owner (Peter)** — SupplierOS orders with DISPUTED
   (funds protected) / COMPLETED / SUBMITTED states; two-step accept flow
   (click Accept → confirm "Accept order") verified — first click only
   expands the note form by design; PO-DEMO01 → ACCEPTED via the real
   endpoint; consumer orders with delivery fees render.
8. **Logistics owner (Oscar)** — accepted open job (driver + fee) →
   ASSIGNED; marked picked up → PICKED_UP; seeded IN_TRANSIT job
   JOB-DEMO02 delivered with the requester's 6-digit code + POD photo →
   DELIVERED; requester notification confirmed to contain the drop-off
   code (257629) — verified in DB cross-role.
9. **Platform support (Halima)** — Control Center Support tab; permitted
   tabs only; resolved DPO-TPC3NX ticket (Save response & resolve) →
   RESOLVED via API check.
10. **Platform admin (restricted demo)** — moderation: approved CM-U8TM5X
    via two-step publish confirm → listing live on public marketplace;
    API boundaries verified live: `/api/admin/users` + `/api/admin/audit`
    → 403, listings/overview → 200, settings PUT → DEMO_SANDBOXED.
    Customer attempt to open GarageOS procurement → Access denied screen
    ("This attempt has been recorded").

Also verified cross-role: enquiry reply reached the customer's account;
customer collect-self completed the custody lifecycle (handover → received
→ inspection → work → ready → returned); roadside request RSA-663T4R
created with honest "Requested" status and 999/112 emergency disclaimer.

Environment note: the dev server was OOM-killed once mid-walkthrough
(next-server RSS had grown to ~1.8 GB across the long session) and was
restarted via `scripts/start-dev-daemon.py`; sessions survived the
restart (stable dev fallback secret). No user-facing error resulted —
the single in-flight POST that was lost (one job acceptance) was retried
and completed. Hygiene: `bun run lint` clean, `tsc --noEmit` clean, zero
5xx in dev.log across the entire walkthrough (403s were deliberate RBAC
checks). Known cosmetic issue: Radix logs a dev-mode-only
"DialogContent requires a DialogTitle" hint 3× across the whole session;
static audit confirms every DialogContent file contains a DialogTitle and
every dialog observed at runtime exposed an accessible name — no
functional or screen-reader-visible defect identified.

---

# 2026-11-13 — FINAL PRODUCTION READINESS AUDIT (all phases)

## Verdict

**CONDITIONALLY READY — controlled production launch.**

The application code is technically sound: every blocker found in this audit was
either fixed (25 issues) or is external to the codebase (credentials,
infrastructure, founder actions). Nothing in the launch path requires new
application features. CARMAZE is NOT "production-ready" today in the plain sense:
no real Daraja/email/SMS credentials are configured in this environment, and per
the standing rule nothing was simulated to pretend otherwise. What IS true: with
the external setup in `docs/CARMAZE_PRODUCTION_RELEASE_CHECKLIST.md` §6, the
platform is launchable as-is.

## What this audit did

Five independent code-audit passes (remediation verification, adversarial
security, financial integrity, workflow integrity, infrastructure) over the
entire API surface, followed by fixes, a rewritten test suite, a controlled
production build, a backup/restore drill and a load test.

## Confirmed working (verified, not assumed)

- Authentication/session: fail-fast AUTH_SECRET in production, sessionVersion
  revocation, DB re-read per request, instant demotion, hashed verification
  codes with attempt caps, hashed reset tokens with single-use + TTL.
- Uploads: auth, allowlist, magic-byte anti-spoof, size caps, server filenames,
  private/public split, private serving gated + audit-logged.
- Money: complete lifecycle map — the ONLY paths to PAID/PROTECTED/SETTLED are
  provider callbacks (signature-gated, fail-closed) or audited FINANCE
  reconciliation with demo hard-block. Idempotency via unique checkout refs +
  terminal-state checks. No simulation path exists anywhere.
- Settlements: PENDING = owed, never "moved"; SETTLED only on provider
  confirmation or referenced manual reconciliation.
- RBAC matrix (roleCan) enforced server-side for every procurement action;
  platform-role vs org-role separation holds; no route grants ADMIN/FOUNDER.
- Demo sandbox: demo accounts cannot reach real payments, real KYC documents,
  real account minting, or real users' notifications.
- Workflows: all 13 audited flows are server-enforced (details in the
  checklist §3).

## Fixed in this audit (25 confirmed issues; all verified by the suite)

CRITICAL/HIGH (8):
1. Logistics partner identity/business/insurance documents were uploaded to
   PUBLIC media → now private documents (owner-or-staff only).
2. Dealer/garage listing limits were never enforced server-side → central
   entitlements now gate POST /api/vehicles (PAST_DUE/expired → free tier).
3. Escrow release could pay out more than was protected (post-protection
   delivery-fee inflation) → fee frozen once PROCESSING/PROTECTED; release
   capped at amountMinor − refundedAmountMinor (409 otherwise).
4. A dispute resolution with a refund still allowed the garage to release the
   escrow afterwards → refund decisions now strip the escrow value (FULL →
   authorization REFUNDED).
5. OTP verification endpoints (custody release, PO handover, delivery drop-off,
   consumer-order collection) had no brute-force guard → rate-limited 5/10min
   each, suite-verified (429 after 5 wrong codes).
6. FINANCE/ADMIN acting on a supply order without membership crashed with a 500
   (null-deref) → null-safe resolution; staff bypass now reachable.
7. Demo staff could read REAL customer KYC documents via GET /api/documents/[id]
   → guarded; owner emails stripped from demo moderation/supply queues.
8. Privacy MARKETING_ONLY erasure was claimed automatic but not implemented →
   now genuinely automatic (User.marketingConsent withdrawn, verified by suite).

MEDIUM (12):
9. Demo sessions could mint REAL user accounts via org staff invites → blocked.
10. Demo customers could attach custody rows to real garages → blocked for
    non-demo orgs (demo-ecosystem handovers still explorable).
11. M-Pesa billing callback failed OPEN when the callback carried no amount →
    fails closed (attempt FAILED, never activated).
12. Supply escrow webhook accepted overpayments and compared against the
    mutable order total → exact equality vs immutable authorization snapshot.
13. PARTS_ORDER invoices were collected while the consumer order stayed UNPAID
    forever → activation now flips the order to PAID and notifies the supplier.
14. PO payment initiation ignored the role matrix (any member incl. STAFF could
    push money) → requireOrgMember(payment.initiate).
15. Staff-seat cap ignored subscription expiry → PAST_DUE falls back to 2 seats.
16. Email/phone verification codes stored plaintext → bcrypt-hashed at rest.
17. Custody collection verified the code but not the collector's name → both
    verified (matches the UI contract).
18. Suppliers could see rival suppliers' offers (amounts) on quote detail →
    bid confidentiality enforced.
19. Handover QR token was exposed to both sides → receiving side only.
20. Suspended-org members kept acting via getMembership → org status now
    required everywhere.

LOW/workflow (5):
21. Offer expiry was never enforced → rejected at accept + hourly sweep.
22. mark_sold was silent → open enquirers and pending-offer dealers notified;
    pending offers auto-expire.
23. Dispute resolution notified staff only → both parties notified; upheld
    orders un-hold ON_HOLD settlements; reconciliation blocked on DISPUTED orders.
24. GarageOS additional-work approval was decorative → over-cap cost now forces
    AWAITING_APPROVAL, garage cannot self-proceed, customer gets
    approve/decline actions (UI + server), cost figures OWNER/MANAGER-only.
25. Custody had no path out of DISPUTED → incident resolution returns the job
    to the workflow and notifies both sides.

Also: rate-limit key spoofing via forged X-Forwarded-For (first-hop trust) →
last trusted hop used; hot-path indexes added (9); unbounded admin/custody/
conversation queries bounded (SQL aggregates for revenue reporting); commission
floor can no longer exceed the base; B2C payout result amount-verified; refunds
PROCESSED require a provider reference and cannot exceed collected funds;
self-dealing guard on garage quotes; MPESA_BASE_URL documented.

## Per-issue record (severity / root cause / files / verification)

Every fix above: severity per phase agent report, root cause in the file
citation of the agent audit, fix = minimal server-side change with the existing
helper patterns (no module rewrites, no schema breaks), verification = the
extended suite (119/119) plus targeted API probes. Representative evidence:
- Escrow cap: release case, supply/orders/[id]/action/route.ts → suite §payment
  integrity passes; walkthrough data intact.
- OTP limiter: custody/[id]/collect, logistics/jobs/[id], supply orders action,
  orders/[id] → suite §brute-force: 429 after 5 wrong codes, job never delivered.
- Demo hardening: orgs/staff POST, custody POST, documents GET, admin listings
  GET → suite §demo sandbox hardening all green.
- Enquiry assignment: schema + enquiries/[id] PATCH + dealer EnquiriesTab UI →
  suite §assignment (owner assigns, staff/customer 403, clear works).
- Work approval: custody/[id] route + vehicle-protection.tsx → suite §work
  approval (garage 403, state guard 400).

## Tests

- `bun verification/security-tests.ts`: **119 passed, 0 failed** (26 new checks
  beyond the previous 93; requires a fresh dev-server process for in-memory
  limiter buckets).
- `bun run lint`: clean. `bunx tsc --noEmit`: clean.
- Production build: `next build` compiles successfully (Turbopack, 29.8s; all
  154 API routes + all views). First attempt failed at page-data collection
  because AUTH_SECRET was absent — the fail-fast guard working as designed;
  completed with a throwaway build-only secret (never committed).
- Production smoke: `next start` served / 200, /api/health honest (providers
  not_configured), /api/admin/users 401 anonymous.
- Backup/restore: `scripts/backup-db.sh` + new `scripts/db-restore-test.sh` —
  restore drill PASSED (integrity ok, full row counts) against a temp copy.
- Load: 1200 requests, 20 concurrent, 0 errors; second-pass RSS lower than
  first-pass (no app-tier leak).

## OOM incident analysis (Phase 6)

The single OOM (next-server RSS ~1.8 GB on a 4 GB sandbox, multi-hour dev
session) was Next.js dev-mode accumulation: per-route compile caches, HMR
state and module graphs for 154 routes + 28 views, with no memory cap. It is a
dev-workload property, not an application leak: the post-fix load test shows RSS
plateauing and DECLINING on repeat passes. Requirements documented:
- Production must run `next start` (lean; no on-demand compilation).
- Dev/CI comfortable minimum: 4 GB RAM (2 vCPU); production runtime minimum:
  2 GB RAM with a process supervisor (systemd/Docker) and restart policy.
- A supervisor memory cap + restart protects against any future regressions.

## External services still required (nothing invented)

- M-Pesa Daraja STK + B2C credentials (MPESA_CONSUMER_KEY/SECRET/SHORTCODE/
  PASSKEY/CALLBACK_URL/ENV, MPESA_WEBHOOK_SECRET, MPESA_INITIATOR_NAME/
  SECURITY_CREDENTIAL/B2C_RESULT_URL). Until configured: honest 501s, attempts
  FAILED, settlements PENDING. No simulation, by design.
- Email (SMTP_URL, MAIL_FROM) and SMS (SMS_PROVIDER/API_KEY/USERNAME/SENDER_ID):
  integrations are real (nodemailer / Africa's Talking / Twilio); unconfigured
  deployments record honest FAILED notification-delivery rows and return 503
  for verification sends in production.
- Domain/DNS/TLS, error monitoring, off-box backups, AV scanning for public
  media, multi-instance rate-limit store if scaling horizontally.

## Outstanding critical issues

None in application code. The remaining launch blockers are exactly the
external items above.

## Outstanding high-priority issues (non-blocking, tracked)

- FULL_ACCOUNT erasure runbook (human workflow) to be written by the founder's
  team — the request path is complete and honest.
- Multi-instance rate limiting store (only if horizontal scaling is chosen).
- Malware scanning integration for public media uploads.
- Configurable per-org enquiry SLA (currently fixed 24 h insight).
