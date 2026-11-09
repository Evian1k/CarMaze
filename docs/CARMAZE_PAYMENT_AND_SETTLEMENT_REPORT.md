# CARMAZE — Payment & Settlement Report

**9 Nov 2026 · Governing rule: no payment state advances without provider evidence or an audited human decision. Nothing in CARMAZE simulates a successful payment.**

---

## 1. M-Pesa Daraja (STK Push) — IMPLEMENTED, BLOCKED BY CREDENTIALS

`src/lib/mpesa.ts` + `src/app/api/billing/mpesa/*`:

- OAuth token fetch, STK push, phone normalisation (07xx → 2547…), amount conversion from KES minor units, timestamped password.
- **Callback** (`/api/billing/mpesa/callback`, public): webhook-secret validation (timing-safe, fail-closed in production), amount-integrity check, idempotency per checkout id, `ResultCode 0` is the ONLY thing that marks an invoice PAID and activates subscriptions/campaigns/memberships/protected orders (`_activate.ts`).
- **Status query** (`/api/billing/mpesa/query`, FINANCE): asks Daraja for the truth when a callback was missed — the provider's answer is the only source of truth.
- **Attempts ledger** (`/api/billing/mpesa/attempts`, FINANCE): every push recorded (`PaymentAttempt`), successes and failures.
- Deployment without credentials: 501 `MPESA_NOT_CONFIGURED` naming the missing variables; demo actors are centrally blocked (403 `DEMO_SANDBOXED`). Both verified live.

Required env (names only): `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_ENV`, `MPESA_CALLBACK_URL`, `MPESA_WEBHOOK_SECRET`; B2C adds `MPESA_INITIATOR_NAME`, `MPESA_SECURITY_CREDENTIAL`, `MPESA_B2C_RESULT_URL`.

## 2. Subscriptions & invoices — VERIFIED WORKING

- `POST /api/billing/subscribe` creates a **PENDING invoice only**; audience→role map (`DEALER→DEALER_OWNER`, `GARAGE→GARAGE_OWNER`, `SUPPLIER→SUPPLIER_OWNER`) with org-type match; cross-audience denied (verified).
- Activation exclusively via provider callback or FINANCE mark-paid (audited, manual) — never from a frontend response (verified: activation logic reachable only from those two paths).
- Renewal = new invoice; `PAST_DUE` after period end + 3-day grace via scheduled sweep; entitlement service blocks featured/campaign entitlements when `PAST_DUE` while preserving all data.

## 3. Supplier settlement ledger — IMPLEMENTED, EXTERNAL CONFIRMATION PENDING

Models: `Settlement` + `SettlementEvent` (append-only trail).

- `CREATED (PENDING)` when a protected PO payment is RELEASED: gross, commission (supply 3%), net.
- Dispute opened → non-final settlements auto `ON_HOLD` with reason.
- FINANCE/ADMIN/FOUNDER actions via `/api/admin/settlements/[id]/action`:
  - `process` — real Daraja B2C payout; unconfigured → 501 `PAYOUT_NOT_CONFIGURED` (never a fake state);
  - `reconcile` — manual settlement with external reference + note (audited, single-use) → `SETTLED`;
  - `hold` / `release` / `cancel` — each event-logged with actor side.
- Supplier view: `GET /api/settlements` + SupplierOS Billing → Settlements card.
- B2C result callback (`/api/admin/settlements/payout/result`): webhook-secret-secured; provider confirmation is what completes an automated payout.

**Money-handling honesty:** a `PROTECTED` database state is not a claim that CARMAZE holds funds. The ledger records what is owed and what was settled; it does not simulate escrow. Automated money movement only happens through the B2C integration once credentials exist; until then, settlement is the audited manual workflow. No licence/regulated-partner determination has been made — flagged for legal review before enabling automated payouts at scale.

## 4. Refunds — PARTIALLY IMPLEMENTED

- Refund records exist on invoices (`/api/billing/invoices/[id]/refund`) and supply orders; creation requires authorisation, records reason/amount, and refuses to exceed the paid amount.
- Refunds do NOT move money through a provider automatically: a refund record is an accounting instruction that FINANCE executes out-of-band, then reconciles (manual `mark-paid`-style evidence model). `REFUNDED` invoice states are therefore "authorised and recorded", not "provider-confirmed" — documented and honest.
- Remaining improvement (external): B2C refund integration + provider refund references when Daraja credentials are live.

## 5. Financial reporting rules — ENFORCED

- Revenue dashboards compute from real records; GMV is not counted as revenue; pending ≠ collected; projected MRR ≠ received; settlements only count when `SETTLED` with provider/manual evidence.
- Commission rates are SystemSetting-driven (supply 3%, delivery 5%, min KES 50, vehicle 1.5%, booking 2%, membership 5%) and applied in the ledger math.

## 6. Reconciliation workflow — OPERATIONAL

FINANCE can: list all payment attempts (ledger), query Daraja for any checkout id, mark invoices paid manually (audited with reason), and manage the settlement ledger. Duplicates are idempotent (callback keyed by checkout id; reconcile is single-use). Missed callbacks are recoverable via stkQuery without fabricating data.

## 7. What external proof remains

Live sandbox STK push → callback → invoice PAID → subscription ACTIVE; live B2C payout → result callback → settlement SETTLED; refund round-trip with provider reference. All code paths exist and are unit-visible; none can be honestly claimed as executed without credentials.
