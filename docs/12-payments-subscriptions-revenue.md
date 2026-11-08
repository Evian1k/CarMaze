# PART 13 — PAYMENTS, SUBSCRIPTIONS AND HOW CARMAZE MAKES MONEY

## 13.1 Plans and entitlements (as seeded)

| Code | Audience | Monthly (KES) | Limits in code |
|---|---|---|---|
| dealer-starter | DEALER | 4,900 | 10 listings · 1 featured · 2 staff |
| dealer-pro | DEALER | 9,900 | 40 listings · 5 featured · 8 staff |
| garage-basic | GARAGE | 2,900 | 20 requests · 3 staff |
| garage-pro | GARAGE | 5,900 | 100 requests · 10 staff |
| supplier-starter | SUPPLIER | 1,499 | 50 products · 1 warehouse |
| supplier-pro | SUPPLIER | 3,999 | 500 products · 5 warehouses |
| supplier-enterprise | SUPPLIER | 8,999 | unlimited |

- Trials: **not implemented** (no trial fields/logic anywhere in `Plan`/`Subscription`).
- Entitlement enforcement: staff seat limit at invite time (402 `PLAN_LIMIT`, default 2 without a plan); listing/featured limits surface as UI progress bars from plan metadata; request-volume limits are plan metadata (the API does not currently hard-count monthly request volume for garages — honest gap).
- **Known defect**: `POST /api/billing/subscribe` gates **every non-dealer plan behind `GARAGE_OWNER`**, so supplier plans currently return 403 for supplier owners (the supplier billing tab surfaces the API error verbatim instead of faking success). Ranked in Part 20.

## 13.2 Free tiers

No free business tier exists. A business without a subscription operates on defaults (e.g. staff limit 2, no entitlement badges) but core workflows function; the demo world serves as the "free experience" for stakeholders.

## 13.3 Payment methods & the M-Pesa flow

- **Only method: M-Pesa STK push** (Daraja "Lipa na M-Pesa Online") via `src/lib/mpesa.ts` — OAuth token (Basic auth), password = base64(shortcode+passkey+timestamp), phone normalised to 254 7/1XXXXXXXX, amount = round(minor/100) with a minimum of 1 KES.
- Entry points: platform invoices (subscriptions, campaigns, memberships, parts orders) → `POST /api/billing/mpesa/stkpush`; supply B2B orders → `POST /api/supply/orders/[id]/pay` (creating a separate `PaymentAuthorization`).
- **Without credentials**: HTTP 501/503 `MPESA_NOT_CONFIGURED` naming the five required env vars; `PaymentAttempt` recorded FAILED with reason; audits `PAYMENT_STK_FAILED_NOT_CONFIGURED`. **Demo accounts can never trigger pushes** (`assertNotDemoActor`).
- **Callbacks**: `POST /api/billing/mpesa/callback` and `POST /api/supply/payments/webhook`:
  - Signature header `x-carmaze-signature` checked with `MPESA_WEBHOOK_SECRET` (timing-safe compare; **unsigned requests rejected in production**, accepted-with-audit in dev);
  - Idempotency (terminal attempt states short-circuit; supply keeps a `webhookEvents` key list);
  - **Amount integrity check** — underpayment marks the attempt FAILED and never activates anything;
  - Always answers 200 `{ResultCode:0}` so Daraja stops retrying; unknown/unparseable callbacks are audited and acked.
- **Status honesty**: UI renders provider state verbatim ("protected only when Safaricom confirms"); polling continues until the callback lands; a frontend success toast never means money moved.

## 13.4 Invoices, receipts, renewals, failures

- `Invoice` types in use: SUBSCRIPTION, CAMPAIGN, MEMBERSHIP, ORDER_PAYMENT, PARTS_ORDER (LEAD_FEE is modelled but unused). Lifecycle `PENDING → PAID | OVERDUE | CANCELLED | REFUNDED`; `paidVia` = MPESA or MANUAL; period fields on subscription invoices; `PaymentAttempt` rows (provider refs, result codes, raw callback JSON) attached per invoice.
- **The single activation path** is `src/app/api/billing/_activate.ts` `activatePaidInvoice(invoiceId, paidVia, note?)` — used by the M-Pesa callback and by FINANCE mark-paid; it flips the invoice, then activates the correct entitlement (Subscription ACTIVE, Campaign ACTIVE, BusinessMembership ACTIVE, PaymentAuthorization PROTECTED) and notifies/audits.
- **Renewals are manual**: buyers pay the next period; there is **no auto-renewal, dunning, or retry engine**. Overdue subscription invoices appear as failed renewals in the revenue dashboard's retention tab.
- **Refunds** (FINANCE/ADMIN/FOUNDER, reason ≥10 chars, audited): invoice refund cascades entitlement termination (subscription → CANCELLED, campaign → ENDED, parts order → REFUNDED). Supply refunds are `Refund` rows (FULL/PARTIAL) accumulating `refundedAmountMinor` toward the payment authorization's REFUNDED state. **No money-movement integration** — refunds record accounting intent; actual reversal happens with the provider out-of-band.
- **Cancellation**: memberships cancellable by the customer (no auto-refund, disclosed); POs cancellable only before payment protection; campaigns only while PENDING_PAYMENT.
- **Expiration**: memberships lazily expire past `currentPeriodEnd`; subscriptions can be `PAST_DUE` (reporting); campaigns expire by date (sweep on campaigns GET).

## 13.5 Receipts

The invoice row is the receipt (refCode, amount, status, paidVia, period, payment attempts). **No PDF receipt generation exists.**

## 13.6 Revenue reporting (Admin → Revenue, FINANCE/ADMIN/FOUNDER only; demo-blocked)

`GET /api/admin/revenue` computes from real rows only:
- **MRR/ARR** from ACTIVE subscriptions (latest PAID subscription invoice per org ÷ months), split DEALER/GARAGE/SUPPLIER;
- **Commissions** from `PurchaseOrder.platformFeeMinor` on RELEASED/PARTIALLY_RELEASED orders (month + total), with released-order count;
- **Marketplace GMV shown as context, never booked as revenue** (explicit transparency rule);
- Campaign paid invoices; membership gross + platform-fee portion; churn %, cancelled count, PAST_DUE count, overdue receivables; a 6-month stacked series (subscriptions/commissions/promotions).
- Platform fees editable at `PUT /api/admin/fees` (supply 3%, delivery 5%, min KES 50, vehicle sale 1.5%, booking 2%, membership 5%) stored in `SystemSetting 'platform_fees'` and consumed by `computeCommission()`.

## 13.7 Who pays whom — the money flow

1. Dealers / garages / suppliers pay **subscriptions** to CARMAZE (invoice → M-Pesa STK → activation).
2. Dealers/garages pay **promotion invoices** for listing campaigns.
3. Customers pay **business membership** invoices (the business's programme; CARMAZE attributes a 5% platform fee in reporting — it is not charged at transaction time).
4. Buyers (garages in B2B, consumers in B2C) pay **parts-order invoices**. B2B funds sit `PROTECTED` until inspection, then **release to the supplier minus the recorded platform commission** (commission deducted from supplier proceeds, never added to the garage's total).
5. **No payout/withdrawal system exists** — supplier settlement of (total − commission) is out-of-band; the platform's ledger shows released amounts and commission per order.
6. Vehicle purchases between private parties and dealership sales: **no payment rail in the platform** (dealership "sales" are recorded as status transitions, not transactions).

## 13.8 Collected vs pending vs projected (reporting discipline)

**Collected** = PAID invoices + released commissions. **Pending** = PENDING/OVERDUE invoices, PENDING_PAYMENT campaigns/memberships, PROCESSING payment attempts. **Projected** = MRR/ARR, labelled as such. The revenue dashboard keeps these separated, and the demo seed's paid invoices are sandbox rows.

## 13.9 Payment security controls

Signature-verified fail-closed callbacks; idempotency keys; amount checks; single activation path; actor-less audits named "M-Pesa callback"; demo lockout on all push endpoints; ownership checks per push; rate limits (10/h pushes); no card data anywhere (M-Pesa holds PCI scope). Gaps: sandbox-only verification (no live Daraja test evidence exists in the repo), no reconciliation exports, no automatic retry.
