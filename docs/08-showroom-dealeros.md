# PARTS 8 + 14 — SHOWROOM SYSTEM (DEALEROS) · PUBLIC STOREFRONTS

## PART 8 — DEALEROS

DealerOS is the dealership management product at `#/dealer`. It has three lifecycle states rendered by one view:

1. **Not applied** — marketing panel + **4-step application wizard** (Business identity → Representative + plan interest `dealer-starter`/`dealer-pro` → Documents via the uploader → Review + consent) → `POST /api/applications {type:'DEALER'}` (refCode `DLA-…`). Drafts can be saved (`DRAFT`).
2. **Application pending** — status card with the event timeline, escalation alerts (SLA sweep), and a **resubmission form** when status is `MORE_INFO_REQUIRED` (`PATCH /api/applications/[id] {action:'resubmit', documents, notes}`).
3. **Active dashboard** — after staff approval creates the `Org` (DEALER, ACTIVE) + `OrgMember(OWNER)` + `DEALER_OWNER` role. Multi-org owners get a switcher. A suspended org shows a destructive alert.

### 8.1 Business onboarding & verification (the full journey)

Apply → docs attached (`BUSINESS_LICENSE`, `PIN_CERTIFICATE`, director ID inferred by kind) → reviewer queue (`GET /api/applications?scope=queue`, SLA age highlighting) → `assign` / `start_review` / `request_info` (corrections window) / `approve` — approval is blocked until **every document is VERIFIED** (400 `DOCS_PENDING`/`DOCS_REJECTED`/`NOT_VERIFIED`) → Org created ACTIVE + owner membership + role + notifications + audit. SLA follow-up: `POST /api/applications/sweep` (manual button; reminders at SLA, escalation at 2×SLA, applicant nudges past corrections-due; 12h idempotency).

### 8.2 Owner account, staff invitations & permissions

- Owner = the applicant. Invite staff: DealerOS → Staff (OWNER-only) → `POST /api/orgs/staff {orgId, email, role SALES|MANAGER|FINANCE|STAFF}` — unknown emails create an ACTIVE user with `CUSTOMER,DEALER_STAFF` and a **12-char one-time password shown once**; seat limit comes from the subscription plan (`staffLimit`, default 2) → 402 `PLAN_LIMIT`; removal (`DELETE`) strips the platform role if they have no other dealership; the OWNER seat is unremovable.
- Permission split (server-enforced): leads/inbox/test drives/offers/inventory = any member; staff mgmt + storefront/profile edits + invoice reads = OWNER/MANAGER (+FINANCE for reads); subscribe = owner-level role; demo staff are additionally sandboxed.

### 8.3 Branches (multi-showroom)

DealerOS → Branches = `BranchManager` (`src/components/branches/branch-manager.tsx`): create branches (name, unique code, county, town, address, lat/lng, phone, manager, per-day hours, delivery areas; first branch auto-primary), edit, set primary, **soft close** (never hard delete). Vehicles can carry a `branchId` (authoritative inventory location), and **inter-branch vehicle transfers** exist end-to-end in the backend (`/api/org/transfers`: REQUESTED → APPROVED → DISPATCHED(condition-out report) → RECEIVED(condition-in; moves `Vehicle.branchId`), plus reject/cancel) — however the transfer UI component (`TransfersPanel`) is currently **not imported by any view** (dead export; documented gap).

### 8.4 Inventory & listings

Overview/Inventory tabs use `GET /api/vehicles?mine=1&orgId=` (server re-validates membership): status badges, views/enquiries/offers counters, View / Submit / **Mark sold** actions, usage progress vs plan listing limit, review explainer for pending/rejected stock. New stock goes through the same `#/sell` wizard (org auto-attach) and the same human review pipeline.

### 8.5 Public showroom storefront — see Part 14 below.

### 8.6 Enquiry management & lead assignment

Enquiries tab: org-scoped threads with reply box; phone numbers shown only when the customer opted in. **Honest gap**: there is no per-lead assignment/reassignment field and no follow-up-reminder engine for sales leads (the brief requested both; application review has assignment + SLA sweep, sales leads do not). The Inbox tab (`MessagesTab scope="org"`) handles richer conversations with unread badges (20s polling).

### 8.7 Sales pipeline & viewing appointments / test drives

The pipeline is the status ladder on inventory (DRAFT → PENDING_REVIEW → PUBLISHED → RESERVED → SOLD) plus offers/test-drives, not a kanban. Test Drives tab polls every 15s: confirm, start (records odometer-out/fuel/condition/**releasedBy**), complete (odometer-in/fuel/returnedBy), no-show, cancel with note; overdue IN_PROGRESS drives badge after 2h.

### 8.8 Dealer-to-dealer offers & buying requests

- **Offers sent**: on private vehicles with `matchWithDealers` (Part 7.10); the Offers tab lists sent offers with statuses and expiry.
- **Buying requests**: the dealership posts what it wants to buy (make/model/year range/budget/notes → `POST /api/buying-requests`); the **Dealer board** (`?board=1`) publishes OPEN requests of other ACTIVE dealerships (seller→dealer supply matching); own requests can be closed (OWNER/MANAGER).

### 8.9 Promotions & campaigns

Billing tab → `PromotionsSection`: buy a `CampaignPackage` (Spotlight-7 KES 1,500 / Homepage-feature-3 KES 3,000) for a PUBLISHED org vehicle → creates **PENDING_PAYMENT campaign + linked invoice** → M-Pesa pay → activation only via payment (or admin activation against a PAID invoice). Impressions/clicks are **real counters** (homepage/home-feed increments); nothing is estimated. Cancel unpaid → voids the invoice.

### 8.10 Subscription management & billing

Billing tab: `GET /api/billing/plans` (DEALER audience) with feature lists and entitlements; Subscribe/Switch → `POST /api/billing/subscribe` → **PENDING invoice** (7-day due) → M-Pesa STK (`POST /api/billing/mpesa/stkpush`) → activation via callback/finance reconciliation only. Invoice table shows payment attempts (including failures). Overview shows entitlement usage (listings, featured slots, staff seats) and renewal date.

### 8.11 Analytics

Overview = five live StatCards (published/reserved, pending/drafts, total views, open/answered enquiries, offers sent) + **Dealer Copilot** (`GET /api/dealer/copilot` — rule-based insights with severity + deep links) + latest enquiries. Deeper analytics (revenue, conversion) are roadmap items.

### 8.12 Customer reviews

Reviews tab lists the org's earned reviews (completed test drives only) with the rating average; the storefront shows the distribution. Garages are reviewed after completed bookings; dealers after completed test drives — both server-verified.

### 8.13 Business settings

Profile tab (`PATCH /api/orgs/profile`, OWNER/MANAGER): name, description, location, county, town, phone, email (regNo read-only). Storefront content (hours, gallery, FAQs, specialities, contact toggles, response time) is edited from the public storefront's editor (Part 14).

### 8.14 Journey summary: enquiry → recorded sale

Customer enquires → notification fan-out → staff reply in thread → test drive booked & completed (odometer/fuel/condition logged) → optional offer on the customer's matched car (or the customer buys outright off-platform — CARMAZE records no buyer payment today) → vehicle marked SOLD (event + audit). "Recorded sale" = status transition + timeline; financial settlement is out of scope of the current build.

### 8.15 Staff vs owner on shared data

Both see the same business objects; the **differences are server-side powers**: staffing, profile/storefront edits, billing reads, subscription changes. A tampered staff client gains nothing — verified by `verification/security-tests.ts` §6 (staff 403 on invoices/subscribe).

---

## PART 14 — PUBLIC STOREFRONTS AND MARKETPLACE SURFACES

### 14.1 How public pages are created

A storefront is not a separate page object — it is the **public projection** of the `Org` row, built by `buildStorefrontPayload(orgId)` (`src/lib/storefront.ts`) and served by `GET /api/orgs/[id]/storefront` (public, `force-dynamic`). It exists only for `Org(type DEALER|GARAGE, status ACTIVE)`; anything else 404s.

### 14.2 What the public sees (`#/showrooms/<id>`, `#/garages/<id>` → `src/views/org-storefront/index.tsx`)

- **Hero**: cover image, logo, name, **verified badge** (org `verified` — staff-set only), star rating + review count, response-time chip (self-reported minutes), OpenNow chip (computed in Africa/Nairobi from opening hours — frontend approximation), specialities.
- **Action bar** (sticky desktop / fixed mobile): Message (auth dialog → conversation), garage-only: Request quote + **Hand over vehicle** (digital custody handover dialog with condition photos, authorised spend cap, road-test permission); Call / WhatsApp external chips explicitly labelled "leaves CARMAZE" (honouring `callEnabled`/`whatsappEnabled`).
- **Stats strip**: reviews count · completed jobs (garage) or live listings (dealer) · services or county · member since (CountUp).
- **Body**: About + service areas + photo gallery lightbox; GARAGE → services & pricing cards (price-from, Request quote / Book this service); DEALER → current inventory with per-vehicle Ask/Book-test-drive (disabled when SOLD) + "See all in marketplace" (`#/cars?org=<id>`); Reviews section (average, animated distribution, 10 latest, Write-a-review for eligible customers); FAQ accordion; opening-hours table + contact card; trust strip.
- **States**: skeleton, 404 "missing" screen (with a route back to the directory), fetch-error with reload.

### 14.3 Verification badges — exactly how they work

`Org.verified` and `Org.status` are set **only** by staff actions (application approval, admin supply console verify/unverify/suspend for suppliers, logistics partner suspend/reinstate). They cannot be edited by owners. Suspended orgs vanish from directories and storefronts (404/paused states).

### 14.4 Public information & privacy rules

Public payload: name, description, county/town, phone/email (dealer business contact), hours, gallery, FAQs, services, vehicles (published only), reviews (first names), rating, stats. Never public: regNo (dealer), staff identities, internal notes, invoices, enquiries, subscriptions.

### 14.5 Enquiry & booking actions → DealerOS/GarageOS connection

Every public action writes directly into the operating system: Message → `Conversation` (org inbox, unread flags); Request quote / Book → `ServiceRequest` (GarageOS Requests; fan-out to category-matching garages); Test drive → `TestDrive` (DealerOS Test Drives); Handover → `VehicleCustody` (GarageOS Custody board + customer Vehicle Protection); Review → `OrgReview` (earned-gated).

### 14.6 Discovery & search across the marketplace

Directories: `GET /api/dealers` (ACTIVE dealers + counts + 3 latest vehicles), `GET /api/garages` (county/category filters, rating-sorted), `GET /api/memberships` (public tier discovery), `GET /api/suppliers` (verified-only supplier directory), plus the marketplace itself. There is no global cross-module search; the command palette searches vehicles and navigates.

### 14.7 Featured placements

Homepage Featured row = `Vehicle.featured` (staff feature action or plan entitlement) + active campaigns (`impression`/`click` counters increment on real surfaces). Paid promotion is labelled in campaign reporting; organic results are never secretly reordered.
