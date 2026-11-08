# PART 20 — KNOWN LIMITATIONS AND FUTURE DEVELOPMENT

Every claim below was verified by reading the code. Statuses: ✅ fully implemented · 🟡 implemented, not fully tested · 🟠 partial · 🔵 frontend-only · 🔴 backend-only · 🧪 demo/demonstration · 🔑 needs credentials/external service · 📋 planned, not implemented.

## 1. Fully implemented and verified (code-inspected end to end)

- Auth core: register/login/logout, bcrypt, JWT sessions, MFA (TOTP), password reset, profile, role model ✅
- RBAC/tenancy: platform roles, org membership, supply `roleCan` matrix, demo sandbox, admin hierarchy, FOUNDER protection ✅ (plus a live security suite: `verification/security-tests.ts`)
- Marketplace: listing CRUD/state machine, review pipeline (staff publish), search/filters/sort/pagination, saved vehicles/searches, view dedupe, compare, AI car-finder over real listings ✅
- Enquiries, conversations (thread reuse, unread flags, archive/close), notifications (in-app) ✅
- Offers with reservation transaction; test drives with full odometer/fuel/condition trail ✅
- Garage pipeline: service requests → quotes → bookings (+loyalty) ✅
- Custody lifecycle incl. road-test authorisation, single-use bcrypt collection codes, dispute→incident ✅
- Security incidents (12 categories, evidence, staff-only terminal decisions) ✅
- Applications + documents verification state machines, SLA sweep logic, org creation on approval ✅
- Supply network: catalogue/fitment (honest verdicts), branches/warehouses, stock reservation, RFQs, PO state machine with approval gate, protected payments, OTP/QR handover, inspection→release with commission, disputes/refunds/returns/warranty ✅
- Consumer parts orders with collection codes; supplier fulfilment ✅
- Logistics: partner applications, fleet, job board, OTP/QR POD with photos ✅
- Billing: plans, honest invoice-only activation, M-Pesa client + fail-closed webhooks, refunds (entitlement cascade), FINANCE mark-paid, revenue dashboard from real rows ✅
- Memberships (tiers, redemption uniqueness), trust programme, credit ledger ✅
- Dealer Copilot (rule-based), loyalty ledger (idempotent), roadside, partners, community, customizer + share links, settings, broadcasts (in-app), audit log ✅

## 2. Implemented but not fully tested

- **M-Pesa end-to-end** 🔑 — the client, callbacks, idempotency and amount checks are complete in code, but no live Daraja credentials exist in this environment; nothing here proves a real STK push or callback ever succeeded (sandbox vs production distinction must be re-verified with real keys).
- WebSocket example (reference only), 3D customizer on low-end devices (WebGL fallback exists but untested broadly), bulk/boundary behaviours of the in-memory rate limiter under restarts.
- `bun run build` is not part of the routine dev loop in this environment; CI has never run it.

## 3. Partially implemented

- **File uploads** — GET/serving + permissioning are complete; the **POST /api/upload write path does not exist** (12 frontend callers 404). #1 gap.
- **Lead assignment & follow-ups (sales)** — application review has assign/SLA; sales enquiries have neither assignment fields nor a follow-up engine.
- **Garage role granularity** — reception vs technician vs manager behave identically in core GarageOS (procurement has the fine-grained matrix).
- **Repair invoicing to customers** — custody records cost/cap, but no customer-facing invoice object for repairs.
- **Job cards / technician assignment** — no dedicated model; custody + notes carry the workflow.
- **Additional-work approvals** — spend cap exists; there is no customer approval request object for out-of-scope work (`AWAITING_APPROVAL` is internal-only).
- **Staff accountability links** — `receivedByStaffName`/`releasedBy`/`assignedTo` are free text, not user FKs.
- **Saved-search alerts** — `alertsOn` column exists; no engine sends alerts.
- **Entitlement enforcement** — staff seats enforced; listing/featured limits shown but request-volume limits not hard-counted.
- **Renewals** — manual re-payment only; no auto-renew/dunning.
- **CSV/exports** — procurement spend CSV is client-side only.
- **Bulk admin actions** — none; all queues are one-at-a-time.

## 4. Frontend-only

- View guard / nav visibility (by design — UX layer).
- Compare tray, procurement spend analytics, cart persistence (localStorage), QR rendering (of server tokens), "Open now" computation, dead defensive "module loading" 404 branches in DealerOS, `TransfersPanel` (backend complete, **UI component never imported**), command-palette role-link visibility inconsistencies, mobile hamburger missing role dashboards.

## 5. Backend-only

- Inter-branch vehicle transfers API (`/api/org/transfers`) — complete state machine, no UI.
- `ConversationMessage.refType/refId` — columns never written.
- `SavedSearch.alertsOn`, custody `COLLECTION_PENDING`/`INCIDENT` statuses, `Invoice` type `LEAD_FEE` — modelled, unused.
- Membership-refund cascade absent on the invoice refund path (memberships not reverted on refund).
- `PATCH /api/garages` profile endpoint (used) vs `orgs/profile` (dealer) — parallel implementations.

## 6. Mock or demonstration functionality

- The **entire seeded demo world** (`prisma/seed.ts` + `seed-supply.ts`): 22 users (all `isDemo`), 8 orgs, 12 vehicles, supply catalogue/stock/POs, custody, incidents, jobs, invoices — quarantined by demo guards; resettable from Admin.
- Seeded media files are **placeholders** (17–69 bytes) under `data/uploads/` — they demonstrate the serving path, not real content.
- `examples/websocket/` chat demo (not product).
- No fake stats anywhere: dashboards compute from DB rows; revenue shows "GMV = context, never revenue"; logistics earnings are labelled "records, not wallet balances".

## 7. Requires credentials or external services

- **M-Pesa Daraja** 🔑 (5 env vars + webhook secret) — wired, unverified live.
- **Email (SMTP)** / **SMS gateway** 🔑 — presence-checked only; no transport code; EMAIL/SMS delivery rows honestly FAIL.
- **Stolen-vehicle / ID / registry verification** — no integration exists (do not claim government/NTSA verification).
- **Map SDK** — none.
- **Managed AI** — works via the bundled SDK; availability/cost depend on the provider.

## 8. Planned but not implemented (from the founder briefs)

Billable lead fees & lead-fee dispute tooling · inspection/verification paid services · partner referral commissions · AI vehicle insights & fraud prioritisation · automatic sales-lead follow-up engine · per-listing ownership documents (VIN/plate/logbook linkage) · buyer-side vehicle purchase payments & ownership transfer · email/SMS delivery · scheduled jobs · customer repair invoices · warranty/vehicle-warranty records in My Garage · multi-language (next-intl installed, unused).

## 9. Recommended future improvements (prioritised)

| # | Item | Why / risk | Effort |
|---|---|---|---|
| 1 | **Implement `POST /api/upload`** (hash-named files into `data/uploads/{,media/}`, MIME allow-list, size caps, auth + demo guard, reuse existing GET routes) | Blocks photos, KYC docs, evidence, POD — core trust features | S |
| 2 | **Remove `AUTH_SECRET` dev fallbacks; rotate secrets; add session revocation on password change** | Security before launch | S |
| 3 | **Fix supplier-plan subscription gating** (`billing/subscribe`) | Revenue path broken for a whole audience | S |
| 4 | **Scheduler for sweeps** (applications SLA, campaign expiry, reminder notifications) | Operational correctness | M |
| 5 | **Adopt Prisma migrations** (`migrate dev/deploy`) + automated DB backups + restore runbook | Deployment safety | M |
| 6 | **Email/SMS provider + queue** (respect the QUEUED rows) | Notifications = engagement + payment prompts | M |
| 7 | Crypto-strong OTPs (`sixDigitCode` → `crypto`), rate-limit collection-code verification attempts | Brute-force hardening | S |
| 8 | Per-listing ownership evidence (VIN/plate fields + duplicate checks + doc linkage) | Trust differentiator | M |
| 9 | Sales-lead assignment + follow-up reminders; garage job cards & technician assignment; additional-work approval object | Dealer/Garage OS depth | L |
| 10 | Payout/settlement ledger for suppliers; PDF invoices/receipts | Completing the money loop | M |
| 11 | DPA-2019 readiness: data export/erasure, retention policy, breach process, ODPC registration | Legal operation in Kenya | M |
| 12 | Production hardening: distributed rate limiting, CSRF review, CSP headers, APM, error tracking | Scale & operations | M |
| 13 | Wire `TransfersPanel` into DealerOS; palette/nav consistency; remove dead code (`use-toast`, unused statuses) | Polish | S |

**Ordering rationale**: security and revenue-path defects first (1–3), then operational correctness (4–6), then trust-differentiating features (7–8), then product depth (9–10), then compliance and hardening (11–13).
