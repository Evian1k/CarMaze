# Task 8-c — CARMAZE Garage Procurement Portal (GarageOS Procurement)

Agent: C (Task ID 8-c). Status: **COMPLETE** — `npx tsc --noEmit` clean for all owned files, ESLint 0 problems, all response shapes verified against the live dev server with curl (garage@carmaze.co.ke session).

## Files created (no existing files modified)

- `src/views/procurement/index.tsx` (default export, 256 lines) — gate + tab shell + cart + deep links
- `src/components/procurement/shared.tsx` — API response types, role gates, StatusChip/PaymentChip/SideChip/FIT_STYLES, Img fallback, QtyStepper, StatCard, EmptyState, CardGridSkeleton, lifecycle constants (STEPS/stepIndex/CANCELABLE/ARRANGEABLE/PayStatus/Row), `kesToMinor`, `uploadOne`
- `src/components/procurement/cart-sheet.tsx` — Cart Sheet (side=right) grouped by supplier + wholesale unlock hints + per-supplier subtotals + Checkout Dialog (destination branch select, note) → POST /api/supply/orders
- `src/components/procurement/overview-tab.tsx` — 5 stat cards (open, awaiting approval, dispatched/in transit, delivered-awaiting-inspection, spend this month), stock-alerts widget (add-to-cart + DELETE alert), quick reorder from most recent COMPLETED order
- `src/components/procurement/catalogue-tab.tsx` — debounced search, category/condition/sort selects, in-stock toggle, vehicle-fitment toggle (make/model/year → real compat filtering), pagination, product cards (authenticity + verified badges, wholesale hints, qty stepper + add)
- `src/components/procurement/fitment-tab.tsx` — make/model/year finder → MATCH/POSSIBLE/NO_FITMENT badges + fit records, honest zero-match copy + Request-a-Part CTA
- `src/components/procurement/quotes-tab.tsx` — quote requests list, Request-a-Part dialog (photo upload via /api/upload, vehicle fields, budget, county, expiry), accept/decline offers, close request (OWNER/GM/PROCUREMENT)
- `src/components/procurement/orders-tab.tsx` — orders list, status filter chips with counts, ref/supplier search, deep-link `?order=<id>` auto-open
- `src/components/procurement/order-detail.tsx` — detail dialog shell: header, 7-step visual lifecycle stepper (with AWAITING_APPROVAL internal-gate note), supplier revision approve/decline (REVISED state), items, cost breakdown, delivery panel (arrange DIRECT/COLLECTION/MEETUP with geolocation picker + agreement flags + agree-location), retry
- `src/components/procurement/order-payment.tsx` — step 5 payment (breakdown incl. commission note, phone regex `^(\+?254|0)[17]\d{8}$`, 5s auto-poll of GET …/pay while PROCESSING) + step 6 handover (OTP `…hint`, QR token, optional GPS capture)
- `src/components/procurement/order-actions.tsx` — cancel (reason), inspection form (per-item qtyAccepted steppers + notes + result ACCEPT/PARTIAL/ISSUES + photos), release (shows released amount + commission), dispute dialog (reason/details/evidence photos), request-return (returnable items w/ qty), warranty claim (only warrantyMonths>0 items), claims record (disputes/refunds), merged order+delivery timeline with actor-side badges
- `src/components/procurement/approvals-tab.tsx` — AWAITING_APPROVAL queue, approve (note) / reject (=cancel with reason), OWNER/GM only
- `src/components/procurement/spend-tab.tsx` — purchases-not-revenue alert, 12-month CSS bar chart, spend-by-supplier with share bars, avg order value, client-side CSV blob export (minor units documented)

## Role gates (UI mirror of src/lib/supply.ts MATRIX; backend enforces for real)

- approve / approvals tab / inspect: OWNER+GM · create order + cancel/return/warranty: OWNER+GM+PROCUREMENT · pay/release: +ACCOUNTANT · dispute: OWNER+GM+PROCUREMENT · handover verify: any garage role (order.read)

## Lifecycle actions implemented (POST /api/supply/orders/[id]/action)

`approve` (AWAITING_APPROVAL) · `cancel` (pre-dispatch, blocked when PROTECTED) · `arrange` (ACCEPTED/CONFIRMED/REVISED; COLLECTION pulls supplier warehouses from public `GET /api/suppliers/[id]`; MEETUP address+lat/lng+geolocation, mutual-agreement flags + `agree-location`) · `handover` (otp|qrToken, captureLocation) · `inspect` (delivery.status DELIVERED) · `release` (INSPECTED + PROTECTED) · `dispute` / `request-return` / `warranty` (post-delivery) · `revision-decision` (REVISED, server requires it or orders strand there)

## Honest payment boundary

STK push success text says protection happens ONLY on Safaricom confirmation; `503 MPESA_NOT_CONFIGURED` renders the error message + `manualOption` (from error body top-level — see mismatch notes) + "no payment taken, nothing simulated"; poll stops on terminal statuses or 24 attempts; when `mpesaConfigured:false` a pre-warning is shown.

## API mismatches / notes found (read against route files + live curl)

1. **quotes list omits `expiresAt`** — GARAGE side of `GET /api/supply/quotes` doesn't map it (only `createdAt`), so the UI doesn't show expiry (GET [id] does return it).
2. **`fail()` spreads `data` top-level** — the 503 pay body is `{error, message, breakdown, manualOption}` (not `data.manualOption`); ClientApiError.data is the whole body, so I read `e.data?.manualOption`. Task wording said "response.data" — actual shape handled.
3. **`GET /api/supply/branches`** is org-membership-gated, so COLLECTION's supplier-warehouse picker uses the **public** `GET /api/suppliers/[id]` branches list (same branch ids the backend validates against).
4. **`inspect` requires `order.approve`** server-side (OWNER/GM only) — UI gates accordingly (spec didn't call this out).
5. **fitment results lack `wholesaleMinQty`** — cart items added from fitment carry no wholesale threshold (wholesale price still shown as hint).
6. **List endpoint caps at 100 orders** (`take: 100`) — spend/orders analytics note this implicitly; fine for now.
7. **Dispute evidence shape** is `[{url,name}]` (not string[]) per the zod schema.
8. Seed data has `mpesaConfigured:false` → every real pay attempt honestly 503s; UI pre-warns and explains the MANUAL_RECONCILED path.

## Self-check

- `npx tsc --noEmit` → only pre-existing errors elsewhere (prisma/seed-supply.ts, examples/websocket, skills/, **src/components/supplier/** — another agent's in-progress task, not mine).
- `bunx eslint src/views/procurement src/components/procurement` → 0 problems.
- curl (garage session): /api/orgs/me, /api/supply/orders, /api/supply/orders/[id], /api/supply/orders/[id]/pay, /api/supply/quotes, /api/supply/alerts, /api/supply/catalogue, /api/supply/categories, /api/supply/fitment, /api/supply/branches — all match the client types I wrote.
- react-hooks v6 `set-state-in-effect` compliance: all fetch effects use async-only setState (stale-aware `loadedFor`/key patterns); deep-link open + refresh are derived/event-driven.

## ⚠ Integrator handoff (required for visibility)

`src/app/page.tsx` VIEWS map has **no `procurement` entry** (I did not modify existing files per task rules). Add:
`procurement: dynamic(() => import('@/views/procurement'), { ssr, loading }),`
Routes used (all hash-based, already consistent with notification links in the backend): `#/procurement?tab=overview|catalogue|fitment|quotes|orders|approvals|spend`, plus `&order=<id>` (auto-opens detail) and `&newRequest=1` (auto-opens Request-a-Part).
