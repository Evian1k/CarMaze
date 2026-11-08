# PART 4 — HOW THE ENTIRE SYSTEM WORKS

The universal request flow, then the real end-to-end flows requested, each traced through frontend → API → guards → database → side effects. (Diagram versions: [19-system-diagrams.md](19-system-diagrams.md).)

## 4.0 The universal flow

```
User action in a view (src/views/*)
  → fetch via src/lib/client.ts (apiGet/apiSend/apiUpload, credentials:'include')
  → Next.js Route Handler (src/app/api/**/route.ts) wrapped in route()
      · runWithRequestContext: session resolved once per request (AsyncLocalStorage)
      · Authentication: getSessionUser() verifies JWT cookie → re-reads User row →
        requires status === 'ACTIVE' (suspension kills access instantly)
      · Authorization: requireRole(...) / getMembership() / requireOrgMember() /
        resource-ownership checks / demo sandbox guards (src/lib/demo.ts)
      · Input validation: parseBody(req, zodSchema) → 400 with field issues
  → Prisma query/mutation on SQLite (db/custom.db)
  → Side effects in the same handler: notifications (src/lib/notify.ts →
      Notification + NotificationDelivery rows), audit() → AuditLog, events
      (ApplicationEvent / POEvent / CustodyEvent / ListingEvent …), loyalty ledger
  → JSON response (ok() / fail())
  → Frontend updates state, shows sonner toast; error codes surface verbatim
  → Polling loops keep boards live (15–20s; threads 8s)
```

There is **no message queue and no background worker**: every side effect happens synchronously inside the request handler, and "sweeps" run when someone loads the relevant admin queue.

## 4.1 A user registers

1. `#/signin?mode=register` → `src/views/auth/index.tsx` form (name, email, password ≥8, optional Kenyan phone, optional referral code).
2. `POST /api/auth/register` (public; rate limit 5/h per IP).
3. Guards/validation: 409 `EMAIL_TAKEN` if the email exists; zod trims/validates.
4. DB: `User.create` with `bcrypt(password,10)`, **roles hardcoded `CUSTOMER,SELLER`**, `emailVerified:false`. No email/phone verification is required to use the account.
5. Referral: if `ref` resolves to an existing active user (cap 50 awards), a `$transaction` sets `referredById` and writes `LoyaltyLedger +500 REFERRAL_SIGNUP`; referrer gets a notification.
6. `createSession()` sets the httpOnly cookie; `audit('USER_REGISTERED')`; frontend redirects to `?next` or `#/account`.

**Role assignment** thereafter is *never* client-settable: roles change only through (a) staff application approvals (`/api/applications/[id]`), (b) admin staff management, (c) org invitations (`/api/orgs/staff`), (d) supplier application approval in the admin supply console.

## 4.2 A user logs in (and MFA)

1. `POST /api/auth/login` (10/15min per IP+email). Failure → 401 + `LOGIN_FAILED` audit (targetId = email). Non-ACTIVE → 403 `ACCOUNT_SUSPENDED`.
2. If `mfaEnabled`: response is `{mfaRequired:true, mfaToken}` — a 5-minute JWT scoped `mfa`; **no session cookie yet**. `POST /api/auth/mfa/verify` verifies the 6-digit TOTP (±1 time step, timing-safe) → session created, `MFA_LOGIN_SUCCESS` audited.
3. Frontend stores the user snapshot via `useAuth.refresh()` → `GET /api/auth/me` returns user + roles + demo info + org memberships + own applications; the shell then renders role-aware menus.

## 4.3 A customer creates a vehicle enquiry

1. Vehicle detail (`#/vehicle-detail/<id>`) → Enquire dialog → `POST /api/enquiries` `{vehicleId, message 5–2000, phoneShare, phone?}` (auth required; 20/h).
2. Guards: vehicle must be `PUBLISHED` (404), its org `ACTIVE` (409), not the customer's own listing (400), demo sandbox check.
3. DB: `Enquiry` (refCode `ENQ-…`, status `OPEN`) + first `EnquiryMessage` (senderSide CUSTOMER); `audit('enquiry.created')`.
4. Notification fan-out: if the listing belongs to an org → all `OrgMember` with role OWNER/MANAGER/SALES (link `/dealer`); if private → the owner (link `/my-listings`). Demo-actor notifications to real users are suppressed centrally.
5. Replies: `POST /api/enquiries/[id]` — seller reply flips the enquiry to `ANSWERED` and notifies the customer; either side can close it (`PATCH {status:'CLOSED'}`).

## 4.4 A seller submits a vehicle (and an administrator approves it)

1. `#/sell` 3-step wizard → `POST /api/vehicles` with status `DRAFT` or `PENDING_REVIEW` (20/h; zod constrains year/price/mileage/photos≤8).
2. Org resolution: only `DEALER_OWNER/DEALER_STAFF` may attach an orgId (must be a membership of an ACTIVE DEALER org); dealer roles get their first org auto-assigned; everyone else is `PRIVATE`.
3. DB: `Vehicle` + `VehiclePhoto[]` + `ListingEvent`; `audit('vehicle.created')`; if `PENDING_REVIEW` → notify all REVIEWER/ADMIN/FOUNDER staff + confirmation to the submitter.
4. Staff approval: Control Center → Listings tab → `GET /api/admin/listings?status=PENDING_REVIEW` → `PATCH /api/admin/listings {id, action:'approve'|'reject'|'suspend'|'feature'}` (REVIEWER/MODERATOR/ADMIN/FOUNDER only; reject/suspend require a ≥10-char note; demo guard resolves the subject owner/org).
5. Effects: status → `PUBLISHED` + `VehicleEvent` + `LISTING_PUBLISHED` notification + audit. Rejected listings show `reviewNote` to the owner and can be edited/resubmitted (`PATCH /api/vehicles/[id] {action:'submit'}`).

## 4.5 A showroom receives a lead and assigns/follows it

- **Receive**: enquiry/conversation/test-drive/offer creation fans out notifications to OWNER/MANAGER/SALES (`src/lib/orgs.ts` `INBOX_NOTIFY_ROLES`) with deep links to `#/dealer?tab=…`.
- **Work**: DealerOS Enquiries tab (`GET /api/enquiries?forOrg=1`) shows threads with reply boxes; Inbox tab shows conversations (`MessagesTab scope="org"`); Test Drives tab polls every 15s with confirm/start (odometer-out, fuel, condition, releasedBy)/complete/no-show actions.
- **Assignment reality**: there is **no explicit lead-assignment field** in the enquiry system (the founder brief requested one). Assignment is implicit — the whole sales-facing membership is notified and any member can reply. The application-review system *does* have assignment (`reviewOwnerId`), as do staff-managed queues. This is an honest gap; see Part 20.
- **Follow-up reminders**: the automated follow-up engine exists for *applications* (`/api/applications/sweep`), not for sales leads.

## 4.6 A garage receives a service request

1. Customer: `#/garages` (or a garage storefront) → Request-a-quote dialog → `POST /api/service-requests` `{category, vehicleDesc?, description 15–2000, county, town?, myVehicleId?, configId?}` (10/h).
2. Lead distribution: garages that actively offer that category (via their OWNER/MANAGER members of ACTIVE GARAGE orgs) are notified; if none match, all garage owners are notified. Requests are status `OPEN`.
3. Garage: GarageOS → Requests tab (`GET /api/service-requests?org=1`) shows eligible open leads **only in categories the garage actively offers** → sends a quote.

## 4.7 A customer approves a repair quote (booking)

1. `POST /api/quotes` (garage OWNER/MANAGER; must offer the category; one quote per (request, org), upsert semantics; request → `QUOTING`).
2. Customer: Account → Requests tab → Accept/Decline → `PATCH /api/quotes/[id] {action:'accept'|'decline'}` (only the request's customer).
3. Accept (transaction): `Quote → ACCEPTED`, other pending quotes → `EXPIRED`, `ServiceRequest → BOOKED`, `Booking` created (status `CONFIRMED`); org notified; audited.
4. Garage: Bookings tab → `PATCH /api/bookings?id=` `schedule` → `start` (request → `IN_PROGRESS`) → `complete` (request → `COMPLETED`; **customer earns +250 loyalty points**, idempotent) or `cancel`.

## 4.8 A garage records a vehicle handover (custody)

1. Customer/garage storefront: **Handover dialog** → `POST /api/custody` `{orgId, vehicleDesc, plate?, odometerKm?, fuelLevel?, conditionNotes?, photos≤6, valuables?, requestedWork 10–4000, authorisedSpendMinor?, roadTestAllowed}` → custody refCode `HC-…`, status `HANDOVER_REQUESTED`, first `CustodyEvent`; org members notified.
2. Garage receives: `PATCH /api/custody/[id] {action:'receive', staffName}` → `RECEIVED` (records `receivedByStaffName`).
3. Work states via `{action:'status'}`: `INSPECTION` ⇄ `AWAITING_APPROVAL` ⇄ `WORK_IN_PROGRESS` → `READY_FOR_COLLECTION` (requires `completedWork`; can attach final odometer, cost, ≤6 completion photos).
4. Road test (only if allowed): org `request-roadtest` (status `ROAD_TEST_REQUESTED`) → customer `authorize-roadtest`/`decline-roadtest` (Account/My Garage → Vehicle Protection) → org `start-roadtest`/`end-roadtest` (start/end odometer; incident flag notifies the customer).
5. Release: customer either `collect-self` or creates a **collection authorisation** (`POST /api/custody/[id]/collection-auth` → single-use 6-digit code, bcrypt-hashed, 48h TTL, plaintext shown once, re-issue revokes the old code). Garage `POST /api/custody/[id]/collect {collectorName, authCode}` verifies (bcrypt) → custody `RETURNED`, code marked used; failed attempts are audited (`COLLECTION_CODE_FAILED`).
6. Dispute at any pre-return point: customer `dispute` → creates a `SecurityIncident` (`DAMAGE_IN_CUSTODY`) + freezes custody as `DISPUTED`; staff notified.

## 4.9 A customer makes a subscription payment

1. DealerOS/GarageOS Billing tab → choose plan → `POST /api/billing/subscribe` (role + org-membership checked; dealer plans need DEALER_OWNER, garage plans GARAGE_OWNER) → creates a **PENDING Invoice** only (period encoded as `[plan:<code>]` in the description). No subscription is created yet.
2. Pay via M-Pesa dialog → `POST /api/billing/mpesa/stkpush {invoiceId, phone}` (ownership check; 10/h; demo actors blocked with `assertNotDemoActor`). Creates `PaymentAttempt` INITIATED.
3. Without Daraja credentials: attempt → FAILED with reason, audit `PAYMENT_STK_FAILED_NOT_CONFIGURED`, HTTP **501 MPESA_NOT_CONFIGURED** naming the five missing env vars. With credentials: Daraja STK push → attempt `PENDING`.
4. Safaricom calls `POST /api/billing/mpesa/callback` (public): signature verified (`x-carmaze-signature`; unsigned **rejected in production**, accepted+audited in dev), callback parsed, attempt matched by `checkoutRequestId`, idempotency check, **amount integrity check** (callback KES vs invoice minor units) → attempt `SUCCESS` → `activatePaidInvoice(id,'MPESA')` (`src/app/api/billing/_activate.ts`).
5. `activatePaidInvoice` is the **only** activation path: Invoice → PAID; type SUBSCRIPTION → Subscription upserted ACTIVE with periodEnd; CAMPAIGN → ACTIVE; MEMBERSHIP → BusinessMembership ACTIVE; ORDER_PAYMENT → PaymentAuthorization PROTECTED. Everyone who must know is notified; `auditPaymentConfirmed` records it.
6. Frontend never claims success from its own response — invoice status is re-fetched; the invoice table shows PENDING until the callback lands.

## 4.10 A notification is delivered

`notify({userId, type, title, body?, link?})` in any handler → 1 `Notification` row + IN_APP delivery `SENT` + EMAIL/SMS delivery rows `FAILED` ("not implemented"). The user sees it via the bell (fetch + mark-all-read) or Account → Notifications, and taps through `n.link` (a hash route). There is no email/SMS transport; `PaymentAttempt`/delivery failures are visible in Admin → Ops.

## 4.11 A support team handles a dispute

1. A dispute can originate from: a custody `dispute` (→ SecurityIncident), an incident report (`POST /api/incidents`, 12 categories), a supply PO dispute (`POST /api/supply/orders/[id]/action {action:'dispute'}`), a B2C order dispute, or a content report (`POST /api/reports`).
2. Staff triage: Admin → Supply console (PO/B2C disputes, resolutions REFUND_FULL/PARTIAL/REPLACEMENT/REJECTED; refunds recorded as `Refund` rows, money movement only via FINANCE invoice refund), Admin → Applications queue for escalated applications, incidents timeline (`PATCH /api/incidents/[id] {action:'status'}` staff-only, RESOLVED/DISMISSED require a note and are terminal).
3. Every step writes an event (`DisputeEvent`/`IncidentEvent`/`POEvent`) and an audit entry; the reporter keeps timeline visibility and can add notes/evidence (reporter-only evidence endpoint).

---

## 4.12 Cross-cutting invariants worth memorising

1. **Honest money**: nothing becomes PAID/PROTECTED/ACTIVE(billing) except through `activatePaidInvoice` or the supply webhook — both gated on provider confirmation or explicit FINANCE reconciliation with an audit note.
2. **Deny by default**: every org-scoped query filters by the caller's memberships; foreign IDs 403/404.
3. **Demo walls**: `isDemo` actors can only touch `isDemo` resources; platform-wide admin mutations are refused for demo sessions (`DEMO_SANDBOXED`).
4. **Events are append-only**: every state machine writes its event rows; nothing deletes history.
5. **The frontend is never the boundary**: hiding a button is cosmetic; every permission is re-checked server-side.
