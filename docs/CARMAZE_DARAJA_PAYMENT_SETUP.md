# CARMAZE — M-Pesa Daraja Payment Setup (STK Push & B2C)

**13 Nov 2026. This document describes how to connect and verify the REAL Daraja integration that is already implemented in the code. Nothing here simulates money movement, and no payment state in CARMAZE can ever be reached by a front-end action alone — only a provider callback (signature-gated, fail-closed) or an audited FINANCE reconciliation with an external reference can move money states.**

Code references: `src/lib/mpesa.ts` (STK/query/B2C), `src/lib/webhook-auth.ts` (signature), `src/app/api/billing/mpesa/callback/`, `src/app/api/supply/payments/webhook/`, `src/app/api/admin/settlements/payout/result/`, `src/app/api/billing/mpesa/stkpush/`, `src/app/api/billing/mpesa/query/`, `src/app/api/billing/mpesa/attempts/`, `src/app/api/supply/orders/[id]/pay/`.

---

## 1. Credentials you must obtain (Safaricom Daraja portal — developer.safaricom.co.ke)

| Variable | Where it comes from | Used by |
|---|---|---|
| `MPESA_CONSUMER_KEY` | Daraja app (created after account approval) | OAuth token for every API call |
| `MPESA_CONSUMER_SECRET` | Daraja app | OAuth token |
| `MPESA_SHORTCODE` | Your Paybill/business shortcode (test shortcode in sandbox) | STK "BusinessShortCode" + partyB |
| `MPESA_PASSKEY` | Daraja test passkey (sandbox) / Lipa na M-Pesa Online passkey (production, issued per shortcode) | STK password |
| `MPESA_ENV` | `sandbox` then `production` | Selects `sandbox.safaricom.co.ke` vs `api.safaricom.co.ke` |
| `MPESA_CALLBACK_URL` | Your public HTTPS origin + `/api/billing/mpesa/callback` | STK result callback |
| `MPESA_BASE_URL` | (optional) only if Daraja changes hosts | Overrides the derived base |
| `MPESA_WEBHOOK_SECRET` | **You generate it** (`openssl rand -hex 32`) | HMAC on `x-carmaze-signature` for BOTH inbound callback routes — this is CARMAZE's own edge validation layer on top of Daraja |
| `MPESA_INITIATOR_NAME` | B2C API initiator (organisation name on the shortcode) | Payouts |
| `MPESA_SECURITY_CREDENTIAL` | Initiator password encrypted with Daraja's public cert (per Daraja B2C docs) | Payouts |
| `MPESA_B2C_RESULT_URL` | `https://<domain>/api/admin/settlements/payout/result` | B2C result callback |

**Never commit real values.** `.env` is in `.gitignore`; only `.env.example` (names) is tracked. Never paste secrets into reports, chats or screenshots.

## 2. STK Push configuration (customer & subscription payments)

- Production entry points: `POST /api/billing/mpesa/stkpush` (invoices/memberships) and `POST /api/supply/orders/[id]/pay` (protected purchase orders). Both: authenticated, rate-limited, demo-session-blocked, Kenyan phone format validated, and they record a `PaymentAttempt`/`PaymentAuthorization` row BEFORE the push.
- The STK request uses the current order/invoice amount in minor units; the amount is snapshotted at initiation. The callback verifies the provider-reported amount against that snapshot — a callback with no amount, or a different amount, fails closed (`MPESA_CALLBACK_AMOUNT_MISMATCH` audit + attempt `FAILED`, no activation). A subscription/order becomes PAID/PROTECTED only on `ResultCode 0` **and** exact amount.
- Callback URLs must be publicly reachable HTTPS. Configure them in Daraja AND in `MPESA_CALLBACK_URL`. The app re-checks the HMAC signature header before parsing the body; in production (`NODE_ENV=production`) a missing `MPESA_WEBHOOK_SECRET` fails every callback closed with 401 — so the secret MUST be set before go-live.
- Edge hardening: allow-list Safaricom Daraja egress IP ranges at the proxy for `/api/billing/mpesa/*` and `/api/supply/payments/webhook` where feasible (defense in depth; the signature check remains the primary gate).

## 3. Callback validation (what the code actually does)

1. `x-carmaze-signature` HMAC compared with `timingSafeEqual` — rejected BEFORE body parsing (fail-closed in production, 401, no detail leakage).
2. The body's `CheckoutRequestID` must match an existing attempt (no orphan activation possible).
3. Terminal-state idempotency: an attempt already `SUCCESS` short-circuits; `FAILED`/`CANCELLED` are ignored — replays cannot double-credit.
4. Amount equality: `Math.round(callback.amount) !== Math.round(attempt.amountMinor/100)` → attempt FAILED, nothing activates. The purchase-order webhook (`/api/supply/payments/webhook`) verifies exact minor-unit equality against the immutable authorization snapshot.
5. Only then: invoice activation (`_activate.ts`), order → PROTECTED, audit + notifications.

**Missing-callback recovery:** `POST /api/billing/mpesa/query` (FINANCE/ADMIN/FOUNDER, demo-blocked) asks Daraja for the true status of a checkout and records it on the attempt; activation still flows through the normal path — the query endpoint never auto-marks an invoice paid. The attempt ledger `GET /api/billing/mpesa/attempts` (FINANCE tier, demo-blocked) lists every push with provider refs so missed callbacks can be reconciled against Safaricom's own records.

## 4. B2C configuration (supplier settlement payouts — where supported and approved)

- Prerequisites: B2C API access approved by Safaricom for your shortcode, the initiator name + security credential (public-cert-encrypted), a payout phone per supplier org, and funds in the shortcode account.
- `POST /api/admin/settlements/[id]/action {"action":"process"}` → `b2cPayout` (Daraja B2C). Without credentials: honest `501 PAYOUT_NOT_CONFIGURED` — the settlement stays PENDING. Never simulated.
- Provider accepts → settlement `PROCESSING`. `SETTLED` happens ONLY on the B2C result callback with `ResultCode 0` AND an amount exactly equal to `netMinor`; mismatched/absent amounts keep the settlement in PROCESSING for review.
- A dispute on the linked order holds payouts (`ON_HOLD`); reconciliation/hold-release are blocked while a dispute is OPEN/UNDER_REVIEW.

## 5. Payment reconciliation (daily operations)

1. Morning: compare `GET /api/billing/mpesa/attempts` against the M-Pesa statement/paybill report.
2. Anything SUCCESS-but-not-activated (callback lost): use invoice **mark-paid** (`POST /api/billing/invoices/[id]/mark-paid`, FINANCE tier + demo hard-block + audited, requires the provider receipt reference) — this is the only manual path to PAID.
3. Purchase orders: FINANCE `reconcile-payment` in the admin Supply console sets PROTECTED with provider `MANUAL_RECONCILED` + external reference; blocked on DISPUTED orders.
4. Settlements: `reconcile` with an external payment reference (min 3 chars, audited) — the honest manual path while B2C is unconfigured.

## 6. Refund procedure

- Invoice refunds: `POST /api/billing/invoices/[id]/refund` (FINANCE tier, demo hard-block). `PROCESSED` requires the real provider reference (M-Pesa reversal code / bank ref ≥3 chars) and cannot exceed collected funds.
- Supply-order refunds: FINANCE `process-refund` in the admin console — same provider-reference requirement; the cap counts BOTH prior refunds AND proceeds already released to the supplier (release+refund can never exceed the escrow; 409 `REFUND_EXCEEDS_PAYMENT` otherwise). Dispute resolutions queue refunds capped to what is actually still in escrow; if nothing remains, the resolution records an honest note instead of a fake refund.
- Refunds never move money in the app — the actual reversal happens in M-Pesa/Bank by a human, and its reference is recorded. The report distinguishes REQUESTED (queued) from PROCESSED (money left, evidence attached).

## 7. Test vs live mode — separation and the honest boundary

| Aspect | Sandbox (`MPESA_ENV=sandbox`) | Production (`MPESA_ENV=production`) |
|---|---|---|
| Host | sandbox.safaricom.co.ke, test credentials/passkey | api.safaricom.co.ke, live credentials |
| Money | None — Daraja sandbox never moves real money | Real money |
| Activation rule | Identical code paths: ResultCode 0 + amount equality | Identical |
| Demo accounts | Blocked from ALL payment initiation (403 `DEMO_SANDBOXED`) — in every mode | Same |
| Unconfigured | Honest 501/503; attempts FAILED; subscriptions stay pending | Same |

Rules that hold in both modes: no simulated success anywhere in the codebase; a payment state is reachable only via a verified callback or audited manual reconciliation; demo sessions can never trigger real STK pushes or read the real attempt ledger.

## 8. Production test cases to execute after credentials exist (owner runbook)

1. Sandbox STK on a KES 1 invoice → complete on the test phone → callback → invoice PAID, subscription/order effects correct, one audit row, exactly one settlement if it is a PO.
2. Replay the same callback (same CheckoutRequestID) → no double activation, no duplicate settlement.
3. Callback with amount 0/missing/mismatched → attempt FAILED, nothing activated, `MPESA_CALLBACK_AMOUNT_MISMATCH` audit present.
4. Callback without signature header in production mode → 401, nothing touched.
5. Abandoned STK (PIN not entered) → attempt FAILED/CANCELLED by callback or query; invoice stays PENDING.
6. Missed callback → `mpesa/query` records provider truth; mark-paid with receipt completes activation.
7. B2C payout → result callback ResultCode 0 + exact amount → SETTLED; mismatched amount stays PROCESSING.
8. Refund a collected invoice → PROCESSED only with the reversal reference; cumulative refunds > collected → 409.
9. Release a protected PO, then attempt a full-refund dispute resolution → refund capped to remaining escrow (0 remaining → honest note, no refund row).
10. Demo session attempts every money route → all 403.

**Until Safaricom itself confirms a live transaction, CARMAZE must be described externally as "payment-ready, not yet live-verified". No document, message or claim may state that real money has been processed before test cases 1–7 above have actually passed in production mode.**
