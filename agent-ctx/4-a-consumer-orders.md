# Task 4-a — Consumer parts ordering (Customer Platform) — work record

Status: **COMPLETE** — backend (2 routes), supplier UI tab, customer Orders tab, product-detail CTA all wired. Lint 0 errors, tsc clean on owned files, Next dev server compiles with no errors.

## Files created
| File | Purpose |
|---|---|
| `src/app/api/orders/route.ts` | `GET` (default = caller's own orders; `?scope=supplier&orgId=` = supplier-member view + counts by status), `POST` create (per-supplier split, server pricing, stock guard, CREATED event, supplier notifications, audit) |
| `src/app/api/orders/[id]/route.ts` | `GET` detail (buyer/staff/supplier-member participant check, items + product info + events desc), `POST` actions via zod discriminatedUnion: `accept` / `reject` / `dispatch` / `delivered` / `confirm` / `cancel` |
| `src/components/supplier/consumer-orders.tsx` | SupplierOS "Consumer orders" tab: filter chips, search, cards, detail dialog with Accept (branch Select), Reject (reason), Dispatch (courier), Mark delivered (collection code input), items table, delivery/payment panels, event timeline |
| `src/components/account/customer-orders.tsx` | Account "Orders" tab: order cards (ref, supplier, status/payment/invoice badges, totals, items, address), Cancel (SUBMITTED), collection-code hint box (DISPATCHED), Confirm receipt (DELIVERED), Pay via M-Pesa STK dialog (ACCEPTED/CONFIRMED + UNPAID) |

## Files modified
| File | Change |
|---|---|
| `src/views/supplier/index.tsx` | added `consumer-orders` to TABS, `ShoppingCart` icon on the trigger, awaiting badge, `consumerOrders` fetch (`/api/orders?scope=supplier&orgId=`), refresh button reloads it, `<ConsumerOrdersTab>` TabsContent. Tab label: **"Consumer orders"** |
| `src/views/account/index.tsx` | added `orders` to TABS, `ShoppingCart` trigger labeled **"Orders"** (after Requests), `<CustomerOrders />` TabsContent; deep link `#/account?tab=orders` works via the existing initial-state query read |
| `src/components/supply/product-detail.tsx` | consumer CTA row under the price card: signed-in non-supplier users get "Order this part" (opens qty 1–99 + fulfilment/county/address/phone/notes dialog → POST /api/orders → navigates to `#/account?tab=orders`); anonymous users get "Sign in to order" → `#/signin`; supplier users (isOwner or SUPPLIER_OWNER/SUPPLIER_STAFF) see nothing. Enquiry/save/fitment features untouched |

## API contracts
### `GET /api/orders`
- Default: caller's own orders. `200 { orders: CustomerOrderRow[] }` where row = `{ id, refCode, status, paymentStatus, supplier:{id,name,county,verified}, deliveryMethod, county, address, phone, notes, courierName, otpHint, rejectedReason, deliveredAt, completedAt, itemCount, items:[{id,productId,name,sku,qty,unitPriceMinor,lineTotalMinor,image}], deliveryFeeMinor, totalMinor, currency, invoice:{id,refCode,status}|null, createdAt, updatedAt }`.
- `?scope=supplier&orgId=`: requires membership (`403 NOT_A_MEMBER`), org type SUPPLIER (`403 NOT_A_SUPPLIER`), ACTIVE (`403 ORG_INACTIVE`). Returns `200 { side:'SUPPLIER', counts:{status:n}, orders:[row with buyer:{id,name}, fulfillmentBranchId, invoice] }`.

### `POST /api/orders` (auth, rate-limit 20/h per user)
- Body `{ items:[{productId, qty 1-99}] min1 max40, county, address(min5), phone /^(\+?254|0)\d{9}$/, notes? max500, deliveryMethod DIRECT|COLLECTION (default DIRECT) }`.
- Errors: 401, 429, 400 `DUPLICATE_ITEMS`/`INVALID_PRODUCTS`/`VALIDATION_ERROR`, 409 `INSUFFICIENT_STOCK` (names product; requires any single branch to cover each line).
- Products must be PUBLISHED from an ACTIVE verified SUPPLIER org. `unitPriceMinor` always from product. Delivery fee: COLLECTION 0 / DIRECT 25000 minor. One order per supplier, created + items + CREATED event in a transaction. Notifies supplier members (OWNER/OPERATIONS/WAREHOUSE/SALES) link `/supplier?tab=consumer-orders`; audits `CUSTOMER_ORDER_CREATED`. `201 { orders:[{id,refCode,status,totalMinor,currency,supplierOrgId,supplierName}], message }`.

### `GET /api/orders/[id]`
- Participant check: buyer OR staff (STAFF_ROLES) OR supplier-org member, else 403. `200 { side:'BUYER'|'STAFF'|'SUPPLIER', role, order:{ ...row, fulfillmentBranch:{id,name,town}|null, events:[...desc] } }` (otpHash never exposed).

### `POST /api/orders/[id]` — actions (zod discriminatedUnion on `action`)
- `accept` (supplier member, status SUBMITTED): optional `fulfillmentBranchId` validated to the org + ACTIVE (`400 BAD_BRANCH`); auto-picks the branch covering all lines with most stock; per-line availability verified (`409 INSUFFICIENT_STOCK` names product). Transaction: decrement `qtyOnHand` per item, StockMovement (delta −qty, reason SALE, refType MANUAL, refId order), PENDING Invoice `type:'PARTS_ORDER'`, `userId=buyerUserId`, `orgId=supplierOrgId`, due +7d; order → ACCEPTED + invoiceId + fulfillmentBranchId. ACCEPTED event; buyer notified link `/account?tab=orders`; audit `CUSTOMER_ORDER_ACCEPTED`.
- `reject` (supplier member, SUBMITTED only): `reason` min5 → REJECTED + rejectedReason, event, buyer notified, audit.
- `dispatch` (supplier member, ACCEPTED|CONFIRMED): `courierName` → sixDigitCode hashed with bcryptjs (hashSync 10), otpHint = last 4, DISPATCHED, event, buyer notified with the full code in the in-app body (only real channel) link `/account?tab=orders`, audit.
- `delivered` (supplier member, DISPATCHED): `code` compared with `bcrypt.compareSync`, mismatch → `403 INVALID_CODE`; else DELIVERED + deliveredAt, event, buyer asked to confirm receipt, audit.
- `confirm` (buyer only, DELIVERED): → COMPLETED + completedAt, event, supplier members notified, audit.
- `cancel` (buyer only, SUBMITTED only): → CANCELLED, event, supplier members notified, audit.
- Wrong side → 403 FORBIDDEN; wrong state → 409 INVALID_STATE. paymentStatus stays UNPAID on accept (invoice is the payment vehicle).

## Payment (task 3): NO backend change needed
Verified `src/app/api/billing/mpesa/stkpush/route.ts` line 36: `authorised = invoice.userId === user.id` — user-owned invoices are already supported (org membership is the fallback branch). Customer pays their PARTS_ORDER invoice via that endpoint; the honest `501 MPESA_NOT_CONFIGURED` server message is surfaced verbatim in the UI error toast. No payment is ever simulated.

## Notes / decisions
1. `fulfillmentBranch` has **no Prisma relation** on CustomerOrder (only `fulfillmentBranchId` string) — the detail route loads the branch via a separate `db.orgBranch.findUnique`; schema untouched, no db:push run.
2. Reject is restricted to SUBMITTED (spec: "release nothing (nothing reserved)") — after acceptance the supplier path is dispatch/delivered; buyer cannot cancel past SUBMITTED (409 explains).
3. Collection code is never returned by the API nor shown to the supplier; supplier sees the hint (`··1234`), buyer sees the hint + "full code was sent to your notifications" (link to Alerts tab). Notification body carries the full code — the one channel that actually exists.
4. Stock guard at creation intentionally requires a SINGLE branch to cover each line (matches the accept flow which decrements one branch), unlike the B2B multi-warehouse reservation.
5. Account `?tab=` deep-link uses the view's existing initial-state pattern (works on mount; same limitation as all other account tabs on in-place hash changes — pre-existing behavior, not altered).
6. Verification: `bun run lint` → **0 errors** (4 pre-existing warnings in `admin/verification-center.tsx` + `views/logistics/index.tsx`, files not touched by this task); `bunx tsc --noEmit` → no errors in any touched file (remaining project errors pre-exist in `src/app/api/documents/route.ts`, `examples/`, `skills/`); dev.log shows clean `✓ Compiled` with no route errors. HTTP smoke tests from the shell were not possible (dev server is in another network namespace), so behaviour was verified by compile + full code review against the conventions.
