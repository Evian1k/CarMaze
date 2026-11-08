# PART 7 — PRIVATE SELLER SYSTEM

The complete private-seller lifecycle as implemented: registration → (optional) verification → listing creation → review → publication → buyer engagement → sold management. Data-protection notes at the end.

## 7.1 Seller registration

Every registered user is already a seller (`roles = CUSTOMER,SELLER` at signup — Part 4.1). There is no separate "become a seller" step; the `#/sell` view is open to any signed-in user.

## 7.2 Identity & contact verification (optional but surfaced)

`SELLER_VERIFIED` is an **earned** status:

1. Seller opens `#/sell` → Verification Panel (`src/components/seller/verification-panel.tsx`) → applies with: full name, **national ID/passport number** (stored as `regNo`), county, town, phone, representative note, **≥1 document** (ID front/back/supporting; up to 10; consent required) → `POST /api/applications {type:'SELLER', status:'SUBMITTED'}` (rate-limited; one open application per type).
2. Documents become `VerificationDocument` rows (kinds inferred: ID_FRONT/ID_BACK/SUPPORTING) inside the **document state machine**: `SUBMITTED → UNDER_REVIEW → VERIFIED | REJECTED | MORE_INFO_REQUIRED(→resubmit) | EXPIRED | SUPERSEDED`. Uploading never self-verifies.
3. Staff decide in Admin → Verification (`PATCH /api/documents/[id]`: start_review / verify / reject(note≥10) / request_info(+due days) / expire). Every staff view is access-logged; demo reviewers can only act on demo subjects.
4. Application approval (`PATCH /api/applications/[id] {action:'approve'}`) requires **all documents VERIFIED** and grants the `SELLER_VERIFIED` role; the badge appears marketplace-wide. MORE_INFO_REQUIRED shows the reviewer's note and a resubmission form; RESUBMITTED re-enters the queue.

Verified vs unverified in the UI: vehicle cards/detail show "Verified seller" only for `SELLER_VERIFIED` (derived server-side, not self-claimed).

## 7.3 Ownership & authorisation checks (honest status)

- The listing form captures the vehicle's facts (make/model/year/mileage/condition/photos…) but **does not capture VIN/chassis or number plate, and does not collect a logbook/ownership document per listing** — `Vehicle` has no VIN/plate fields and no per-listing document link. Ownership authorisation is therefore **procedural** (moderation may reject with a note) rather than an automated documentary check. Stolen-vehicle screening is likewise not automated: there is no external registry integration; the platform relies on (a) human listing review, (b) community reports, (c) the incident system. See Part 10 for the honest split between automated checks, human review, and the missing integrations.
- What *is* enforced: only the owner (or org members for org stock, or platform staff) can edit/submit/delete a listing; transitions are state-machine-guarded.

## 7.4 Document submission

Via the seller KYC flow above. Documents must be `/api/files/…` URLs (the documents API rejects public `/api/media/` URLs to keep KYC material private). Files are served by the permissioned `files/[name]` route (owner-only; staff with access logging).

## 7.5 Vehicle listing creation (`#/sell`)

Three steps:
1. **Vehicle basics** — make, model, year (1980–next), body type, condition (BRAND_NEW/FOREIGN_USED/LOCAL_USED), fuel, transmission, engine cc, colour, county, town.
2. **Pricing & details** — price (KES → minor units), mileage, description (30–4000 chars) with the **AI Listing Assistant** (drafts only from the facts you provide), 12 feature chips, up to 8 photos (`POST /api/upload` — **currently a 404 gap**, Part 20).
3. **Reach & publish** — optional **"Match with dealers"** (`matchWithDealers`) which lets verified dealerships make offers, preview card, Save as draft or Submit for review.

`POST /api/vehicles` (20/h): zod-validated; creates `Vehicle` (status DRAFT or PENDING_REVIEW) + photos + a `ListingEvent`; notifies the submitter, and reviewers when submitted. Dealer members get their org attached automatically (first ACTIVE DEALER membership).

## 7.6 Duplicate detection (honest status)

**Not implemented.** No VIN/plate fields → no duplicate-VIN check; no image-hash dedupe. The only mitigations are human review and user reports ("duplicate" is one of the report reasons). Listed in Part 20 as a recommended control.

## 7.7 Listing review (staff)

`GET /api/admin/listings?status=PENDING_REVIEW` (12/page, photos, owner contact, org) → moderator actions `approve / reject(note≥10) / suspend(note≥10) / feature / unfeature`. Approval → `PUBLISHED` + `VehicleEvent` + notification; rejection records `reviewNote` (visible to the owner) and allows edit+resubmit. Rejected listings can be deleted by the owner; DRAFT/REJECTED only.

## 7.8 Listing publication & visibility

Published vehicles appear in the marketplace (with index-optimised queries on status+make/body/price/county/createdAt), the homepage feed, showroom pages (org stock), and similar-vehicle rails. `featured` (staff-set or plan entitlement slots) drives the homepage Featured row. Views count with 24h per-IP dedupe.

## 7.9 Buyer enquiries

Threaded per listing (Part 4.3/6.7): the buyer's first message opens the thread; the seller replies from `#/my-listings` → Enquiries (chat bubbles, close). **Phone number control is the buyer's** (`phoneShare` toggle); sellers see the phone only when shared.

## 7.10 Offers & viewing requests

- **Offers (dealers → matched private cars)**: only when `matchWithDealers` is on and the vehicle is PUBLISHED+PRIVATE. A dealer OWNER/MANAGER of an ACTIVE dealership sends `amountMinor` + message + validity days; the seller sees offers grouped by vehicle in `#/my-listings` → Offers with **Accept / Reject**. Accept is transactional: this offer ACCEPTED, other pending offers EXPIRED, vehicle → `RESERVED`, event + notifications. Withdraw is available to the offering dealer while PENDING. Buyer contact stays private until acceptance.
- **Viewing requests**: there is **no standalone viewing-appointment object for private sales** — the test-drive system is dealership-only. Private sellers arrange viewings through the enquiry thread. (Gap noted in Part 20.)

## 7.11 Listing performance

Inline performance on the Listings tab: **views, enquiry count, offer count** per listing (server counts). There is no separate analytics dashboard for private sellers (deliberate scope; the data exists).

## 7.12 Sold vehicle management

`Mark sold` (owner or staff; PUBLISHED/RESERVED → SOLD) with a confirm dialog + event + audit. The listing stops appearing in search; performance counters remain. There is **no post-sale payment or ownership-transfer module** (Part 20).

## 7.13 Fraud reporting

Anyone (incl. sellers) reports listings via `POST /api/reports` (targetType LISTING; reasons: scam, wrong price, already sold, duplicate, prohibited/stolen, other) → staff handle in Admin → Reports (resolve/dismiss with note). Custody/incident-grade fraud uses the SecurityIncident system instead (Part 10).

## 7.14 How seller data is protected

- Seller identity: only first name is exposed publicly on reviews; listing pages show the owner **only** for dealership orgs (business contact), never private owner contact — buyers reach sellers through the platform thread.
- Seller documents live in private `/api/files/` storage with owner-only access + staff access logging.
- All seller-scoped endpoints filter by `ownerId`; offers never expose the buyer's other activity; enquiry phone sharing is opt-in per enquiry.
- Demo sellers are sandboxed (demo listing data cannot mix with real buyers' enquiries; verified by the security suite).
