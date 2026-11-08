# PART 9 — GARAGE SYSTEM (GARAGEOS)

GarageOS (`#/garage-dashboard`) mirrors DealerOS structurally but operates a **service business with custody of customer vehicles**. Three lifecycle states: application wizard (3 steps: business → representative → documents + **service categories** + consent) → application status (timeline, resubmission) → dashboard (multi-garage switcher, paused-org alert).

## 9.1 Garage application & business verification

`POST /api/applications {type:'GARAGE', categories…}` (categories mandatory; refCode `GRA-…`) → reviewer queue → approval gated on all documents VERIFIED → creates `Org(GARAGE, ACTIVE)` + `OrgMember(OWNER)` + `GARAGE_OWNER` role. Verified orgs appear publicly; the county is locked post-verification (profile can't move the business to a new county).

## 9.2 Owner & staff accounts

Staff invite works like the dealership's (one-time password, seat limits by plan; seeded roles MANAGER/MECHANIC). Permission nuance: **core GarageOS actions are open to any membership role** (reception vs technician are not yet separately privileged — Part 5.7); **procurement** uses the fine-grained matrix (OWNER/GM/PROCUREMENT order, OWNER/GM approve & inspect, +ACCOUNTANT pay).

## 9.3 Branches

Same `BranchManager` as dealers (kind WAREHOUSE for supply-side garages; garage workshops use kind BRANCH, e.g. seeded PM-01). Branch scoping applies to procurement deliveries and membership tiers.

## 9.4 Public garage storefront

Part 14 + Part 6.9. Garage-specific blocks: services & pricing, quote/booking/handover actions, earned reviews.

## 9.5 Services & packages (pricing model)

Overview → Services tab: CRUD `GarageService` rows — one of 12 categories (`GENERAL_SERVICE, MECHANICAL, ELECTRICAL, TYRES, BODYWORK, DETAILING, MODIFICATIONS, AUDIO, INSPECTION, TOWING, ROADSIDE, OTHER`), title, description, **priceFromMinor** (or null = quote-based). Deactivation is a soft delete (`active:false`) so history survives. Active categories **determine which leads the garage receives** — a real eligibility filter, not decoration.

## 9.6 Availability & bookings

There is no calendar/availability model; "availability" is operational (the garage schedules each confirmed booking). Booking lifecycle (from accepted quotes): `schedule` (datetime) → `start` (request → IN_PROGRESS) → `complete` (request → COMPLETED, +250 loyalty points to the customer) / `cancel` (either side, with cascade). Customer contact is revealed to the garage only after acceptance.

## 9.7 Quote requests & the lead pipeline

Requests tab lists **eligible open leads** (status OPEN/QUOTING in the garage's active categories, county/matching fan-out at creation, take 60 + own quotes merged). Quotes are upsert-per-(request, org); sending flips the request to QUOTING; acceptance by the customer creates the booking; declining all quotes returns the request to OPEN. 3D customizer requests arrive with a `configId` deep link back to the shared configuration.

## 9.8 Customer conversations

Inbox tab = the same two-pane messaging used everywhere (attachments, close/reopen/archive, unread badges, 8s thread polling, 20s list polling).

## 9.9 Job cards & technician assignment (honest status)

There is **no JobCard model and no technician-assignment field**. The operational equivalent is the **custody record** (below) plus the booking; the work narrative lives in custody status/note events and `completedWork`. This is a documented gap vs the founder brief.

## 9.10 Parts & materials

Via the **Procurement** portal (`#/procurement`, Part 14 of the index): catalogue/cart → POs with approval gates → protected M-Pesa payment → dispatch → OTP/QR handover → inspection → release (commission recorded) → disputes/returns/warranty. Stock alerts (`GarageStockAlert`) surface low-stock items on the procurement overview.

## 9.11 Vehicle check-in: the digital custody handover

Initiated by the customer from a garage storefront (**Handover dialog**, 3 animated steps: vehicle facts → condition + ≤6 photos + valuables → requested work + optional **authorised spend cap**) → `POST /api/custody` → `HANDOVER_REQUESTED` + first event + org notifications. The record captures: vehicle description, plate, odometer at drop-off, fuel level, declared condition notes, photos, declared valuables, requested work, spend cap, road-test permission.

## 9.12 Vehicle custody lifecycle (GarageOS Custody tab, 15s polling)

Board grouped by status with 4 counters; detail dialog per record:

1. **Receive** — `{action:'receive', staffName}` → `RECEIVED` (records who took the vehicle in).
2. **Status moves** — `{action:'status'}`: `INSPECTION` ⇄ `AWAITING_APPROVAL` ⇄ `WORK_IN_PROGRESS` → `READY_FOR_COLLECTION` (requires `completedWork` ≥5 chars; optional final odometer, final notes, ≤6 completion photos, cost).
3. **Notes** — append-only `{action:'note'}` events.
4. **Road test** — `{action:'request-roadtest'}` (purpose + driver name; blocked if one is active) → customer authorises/declines → `{action:'start-roadtest'}` / `{action:'end-roadtest'}` (start/end odometer, incident flag → customer notified). Authorisation is **always the customer's**; the garage cannot self-authorise.
5. **Release** — two paths: customer **collect-self**, or customer issues a **collection authorisation** (`collectorName` + phone → single-use 6-digit code, bcrypt-hashed, 48h, plaintext shown once, last-2 hint stored, re-issue revokes) and the garage verifies it (`POST /api/custody/[id]/collect`) → `RETURNED`.
6. **Dispute** — customer-only, any pre-RETURNED state → creates a SecurityIncident (`DAMAGE_IN_CUSTODY`) and freezes the custody as `DISPUTED` (staff notified).

Known dead states: `COLLECTION_PENDING` and `INCIDENT` exist in the schema but no route sets them. Staff names are free text (not user-linked) — a known limitation for accountability chains.

## 9.13 Repair authorisation & additional-work approvals

The **authorised spend cap** (`authorisedSpendMinor`) is the repair authorisation instrument: recorded at handover, displayed on the job facts, and visible to the customer throughout. There is **no separate "additional work approval" request/approval object** — if work exceeds the cap or scope, the current system relies on the customer-visible cost (`costMinor`) at completion, the note timeline, and ultimately the dispute path. This is an honest gap vs the brief; the custody state `AWAITING_APPROVAL` exists for internal workflow signalling but is not a customer-facing approval gate.

## 9.14 Invoices & billing

- **Garage → customer invoices for repairs are NOT implemented** (no customer-repair invoice model; the spend cap + completion cost are recorded on the custody row).
- The garage's own money flows: subscription invoices (Plans `garage-basic`/`garage-pro`), promotion invoices, and (in supply) incoming PO payments as the supplier side.
- Membership revenue reporting exists (MembershipsManager shows gross, paid/pending counts, platform fee %).

## 9.15 Reviews, disputes & ratings

Reviews tab + storefront: earned reviews only (completed bookings), rating average, distribution. Disputes: custody disputes (Part 9.12) and supply-side disputes (Part 10/12 references). Everything is event-timeline based.

## 9.16 Subscriptions & analytics

Subscription: seeded Garage Basic KES 2,900 (20 requests/3 staff) and Garage Pro KES 5,900 (100/10); subscribe → invoice → M-Pesa → activation. Analytics: overview StatCards (eligible open requests, quotes sent, active bookings, services completed), rating card, request pipeline; deeper revenue analytics are roadmap.

## 9.17 The complete lifecycle of a vehicle in a garage's possession

```
Customer handover (photos, odometer, fuel, valuables, spend cap, road-test OK?)
  → Garage receives (staff name recorded)
  → INSPECTION → (optional road test: request → customer AUTHOrises → driven with odometer trail → any incident notified)
  → AWAITING_APPROVAL / WORK_IN_PROGRESS (notes accumulate)
  → READY_FOR_COLLECTION (completed work, final odometer, cost, completion photos)
  → Release: customer collects personally  OR  authorised collector presents the single-use 6-digit code (bcrypt-verified, audited)
  → RETURNED
(any point → customer dispute → SecurityIncident + DISPUTED freeze)
```

Every arrow above writes a `CustodyEvent`; nothing in the lifecycle is deletable; the customer sees the same timeline in Vehicle Protection.
