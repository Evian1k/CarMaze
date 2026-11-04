# Task 3-b — LogisticsOS (delivery-partner platform + requester-side delivery service)

Agent: 3-b · Date: 2026-11-05 · Status: COMPLETE (all owned files delivered + full API smoke-tested end-to-end)

## Files created

| File | Purpose |
|---|---|
| `src/app/api/logistics/jobs/route.ts` | GET `?scope=self\|open\|partner\|mine` (+`&status=`) · POST create delivery request |
| `src/app/api/logistics/jobs/[id]/route.ts` | GET role-aware detail · POST lifecycle actions (`accept\|decline\|pickup\|transit\|deliver\|fail\|cancel`) |
| `src/app/api/logistics/fleet/route.ts` | GET drivers (+active job counts) · POST add driver (rate 30/h) |
| `src/app/api/logistics/fleet/[id]/route.ts` | PATCH driver fields/toggle · DELETE (409 `DRIVER_BUSY` when non-terminal jobs) |
| `src/app/api/admin/logistics/route.ts` | GET partners w/ owner email + job stats (ADMIN\|FOUNDER) |
| `src/app/api/admin/logistics/[id]/route.ts` | PATCH `suspend\|reinstate\|note` + audit + owner notify |
| `src/views/logistics/index.tsx` | Full LogisticsOS view: states A–D, tabs Jobs/Fleet/My requests/Earnings |

## Files edited (only the 3 permitted)

- `src/app/page.tsx` — registered `logistics: dynamic(() => import('@/views/logistics'), { ssr, loading })` in VIEWS.
- `src/components/layout/command-palette.tsx` — always-visible "Logistics Network — delivery partners & delivery requests" page entry; Workspaces entry "LogisticsOS — delivery operations" gated on `LOGISTICS_OWNER`.
- `src/components/layout/app-shell.tsx` — desktop header nav "LogisticsOS" (only when user has `LOGISTICS_OWNER`); footer "For Business" column gained "Delivery Network". Public NAV array untouched.

No other files touched. No schema changes, no db push/generate, no lint/build/tsc run (per task rules).

## API contracts

### GET /api/logistics/jobs
- `scope=self` → `{ partner: { id, refCode, name, partnerType, county, town, status, verified, capabilities[], serviceAreas[], decisionNote, createdAt } | null }` — used by the view to branch (no ugly 403 dance).
- `scope=open` → APPROVED partner only (SUSPENDED → 403 `PARTNER_SUSPENDED`; non-partner → 403 `NOT_A_PARTNER`). OPEN jobs not requested by self, newest first, contacts included (needed to perform pickup/drop).
- `scope=partner` → partner's own jobs, any status, `?status=` filter, includes driver + full events + podPhotos. **No OTP data ever.**
- `scope=mine` → requester's jobs, includes partner name/phone, driver, `otpHint` (never `otpHash`), full `podPhotos` when DELIVERED, events. `?status=` filter.
- Unknown scope/status → 400.

### POST /api/logistics/jobs (create)
- requireUser; rate limit `dlv-create:${user.id}` 20/hour.
- Zod: cargoDesc 5..300, sizeClass SMALL|MEDIUM|LARGE, counties 2..60, addresses 5..200, contact names 2..80, phones 9..20; `requesterOrgId` optional → verifies `orgMember.findFirst({orgId,userId})` (OrgMember has no status column — existence = membership) + captures org name.
- Creates status OPEN, `refCode('DLV',6)`, event `CREATED` (side CUSTOMER), audit `DELIVERY_JOB_CREATED`. Response has no OTP fields (none exists yet).

### POST /api/logistics/jobs/[id] (actions)
- `accept` (partner, job OPEN, not own request, partner APPROVED): requires `driverId` (own ACTIVE driver → else 400 `INVALID_DRIVER`) + `feeMinor` int 1..10_000_000. Sets partnerId/driverId/feeMinor/status ASSIGNED; **generates OTP exactly like supply dispatch**: `otp = sixDigitCode(); otpHash = bcrypt.hash(otp,10); otpHint = otp.slice(-2)`. Notifies requester in-app type `DLV_ASSIGNED`, body: "Fee KES <fee>. Your drop-off verification code is <otp>. Share it only when you receive the cargo." Audit `LOGISTICS_JOB_ACCEPTED`. Raw OTP never returned to partner.
- `decline` (partner, OPEN): event `NOTE` side PARTNER, **no status change** (job stays OPEN for others).
- `pickup` (assigned partner, ASSIGNED): → PICKED_UP, pickupAt=now, notify `DLV_PICKED_UP` ("Delivery DLV-… picked up").
- `transit` (PICKED_UP): → IN_TRANSIT, notify `DLV_IN_TRANSIT`.
- `deliver` (IN_TRANSIT): requires `otp` 6-digit (bcrypt compare, mismatch → 400 `OTP_INVALID`) + `photos` 1..6 urls. → DELIVERED, podPhotos JSON, deliveredAt=now, notify `DLV_DELIVERED`, audit `LOGISTICS_JOB_DELIVERED`.
- `fail` (ASSIGNED|PICKED_UP|IN_TRANSIT): reason ≥10 chars → FAILED + failReason, notify `DLV_FAILED`, audit `LOGISTICS_JOB_FAILED`.
- `cancel` (requester only, OPEN|ASSIGNED): → CANCELLED, event side CUSTOMER; if ASSIGNED also notifies partner owner `DLV_CANCELLED`.
- Every action writes a DeliveryJobEvent. State violations → 409 `INVALID_STATE`; suspended partners → 403 `PARTNER_SUSPENDED` on every act.

### GET /api/logistics/jobs/[id]
Requester/staff see otpHint + podPhotos (never otpHash); assigned partner owner sees contacts + events but **no OTP hint**; everyone else 403.

### Fleet
Partner-only gates (APPROVED, SUSPENDED blocked). PATCH partial (name/phone/licenseNo/vehicleReg/vehicleType/status). DELETE blocked with 409 `DRIVER_BUSY` while driver carries ASSIGNED/PICKED_UP/IN_TRANSIT jobs.

### Admin
GET: partners + owner {name,email} + `stats {total,completed,failed,active}` + drivers count + status counts (groupBy). PATCH suspend: status SUSPENDED + verified=false + decisionNote + event + audit `LOGISTICS_PARTNER_SUSPENDED` + notify owner; reinstate: APPROVED + verified=true + audit `LOGISTICS_PARTNER_REINSTATED` + notify; note: event `NOTE`. Clean JSON for the admin-view agent (task 3-x owns `src/views/admin`).

## UI states (src/views/logistics/index.tsx, 'use client', ~2,140 lines)
- **A Landing** (anon or signed-in w/o logistics footprint): hero "CARMAZE Logistics Network", audience cards (garages/showrooms/suppliers/customers), honest verification copy ("granted by our review team after document checks — never automatic, never self-claimed"), requirements list, CTAs "Join our delivery network" (anon → `signin?mode=register`) and "Request a delivery" / "Sign in to request".
- **B Application**: full form (name, COMPANY/INDEPENDENT radio, regNo company-only, county select, town, phone, email, representative, capabilities checkboxes PARCELS/VEHICLES/TOWING/PARTS, service-area county chips, /api/upload document uploader w/ remove, notes, consent) → POST `/api/applications` type LOGISTICS. If a reviewable LOGISTICS application exists → honest status card (ref, status badge, event timeline) with **resubmit flow** on MORE_INFO_REQUIRED (merges existing + new docs, PATCH `action:'resubmit'`). Rejected app → alert + "Apply again".
- **C Dashboard** (`?tab=` hash-driven, procurement-style tabs): Jobs (open board cards w/ contacts + Accept dialog [driver select w/ Fleet fallback, KES fee input → feeMinor] · active deliveries w/ lifecycle buttons · deliver dialog [6-digit OTP input + min-1 photo POD uploader] · fail dialog · history), Fleet (driver cards, add dialog, toggle, delete w/ 409 surfaced verbatim), My requests (requester create dialog + list w/ OTP hint chip "Code ••• XY — sent to your notifications", podPhotos, cancel, timeline), Earnings (completed/active/failed honest records + note "in-app payment collection for delivery fees is not yet enabled").
- **D Suspended**: amber notice + staff reason (decisionNote), no actions.
- Errors surface verbatim from ClientApiError via toasts; skeleton loaders; honest empty states; mobile 1-col grids; dark-mode-safe tokens; no blue/indigo.

## Verification performed (dev server, then cleaned up)
Registered 3 disposable users, seeded one APPROVED partner (mirroring the approve endpoint's own logic), and drove the full API: create → open board → fleet add → accept (verified OTP went to requester notification only, partner response contains no OTP fields) → pickup → transit → deliver (wrong OTP = 400 OTP_INVALID; correct + photo = DELIVERED with podPhotos visible to requester) → decline (stays OPEN) → cancel → fail (short reason 400, valid = FAILED) → busy-driver delete 409 → toggle inactive → admin GET stats → suspend (verified=false, board/actions blocked) → reinstate → note. **All passed.** All smoke users/jobs/drivers/notifications/audit rows + media were deleted afterwards (0 DLV jobs remain).

## Assumptions & notes for other agents
1. `scope=self` added to `/api/logistics/jobs` (allowed per task brief) so the view branches without a 403 probe.
2. The unified Application model has no `serviceAreas` column — the apply form folds selected counties into reviewer `notes` ("Service areas: …"); the approve endpoint copies `categories`→capabilities but not service areas, so partner.serviceAreas stays null until staff add it.
3. `OrgMember` has no status column — membership = row existence (spec said ACTIVE; existence is the only signal available without schema changes).
4. Decline writes a `NOTE` event only (per the task's correction); it does not change job status.
5. Cancel (ASSIGNED) additionally notifies the partner owner — not required by spec but honest ops UX; easy to remove.
6. Earnings intentionally shows no wallet/payout numbers — honest counts + agreed-fee sums only.
7. Admin JSON is final; whoever owns `src/views/admin/index.tsx` should render `partners[].stats` / `counts` as-is.
