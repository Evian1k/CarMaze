# PART 10 — VEHICLE PROTECTION AND TRUST

The trust architecture as actually built: what is automated, what needs a human, and what would need an external integration that does **not** exist today.

## 10.1 Vehicle identity

- **Listings** (`Vehicle`): make/model/year/mileage/colour/engine/county + photos + refCode. **No VIN/chassis and no number-plate field exist on listings** — vehicle identity on the marketplace is descriptive, not registry-grade.
- **Plates** exist where operationally relevant: `MyVehicle.plate` (customer vault), `VehicleCustody.plate` (handover), logistics/supply vehicle registration fields (drivers, dispatch).
- **Chassis** appears only in supply compatibility data (`ProductCompatibility.chassis` = VIN-prefix code for fitment).

## 10.2 Ownership & authorisation evidence

- Business onboarding and seller KYC collect **documents** (business licence, PIN certificate, director ID, national ID, logbook kind `LOGBOOK`, `OWNERSHIP_AUTH`, insurance, vehicle registration) into the `VerificationDocument` state machine — but these attach to **applications**, not to individual listings.
- Therefore: a listing's ownership evidence is the reviewer's judgement during moderation (reject with note), not an automated document match. This is stated here plainly because the founder brief asked for ownership checks — the mechanism is human, procedural, and documented, not automated.

## 10.3 Stolen vehicle reports

`POST /api/incidents` with `category: STOLEN_VEHICLE` (also `MISSING_FROM_GARAGE`, `TEST_DRIVE_NOT_RETURNED`, `UNAUTHORISED_USE`, `UNAUTHORISED_RELEASE`, `DAMAGE_IN_CUSTODY`, `MISSING_PROPERTY`, `OWNERSHIP_FRAUD`, `FAKE_DOCS`, `MISCONDUCT`, `CUSTOMER_FRAUD`, `OTHER`): title, details, vehicle description, optional org/custody/test-drive linkage (existence-checked), ≤6 evidence files. The response always includes a **safety note** telling the reporter to contact the police — CARMAZE is not an emergency service and does not run a stolen-vehicle registry.

- **Reporter side** is derived server-side (ORG if the reporter is a member of the referenced org).
- Lifecycle: `OPEN → UNDER_REVIEW → ESCALATED → RESOLVED|DISMISSED` (staff-only transitions; terminal states locked; resolution notes mandatory ≥10 chars); evidence append is **reporter-only**; all participants can add notes; every action writes an `IncidentEvent` + audit.
- There is **no automatic listing suppression** when a stolen report references a listing (the linkage fields are custody/test-drive/org today) — moderation acts on reports manually.

## 10.4 Suspicious listings & fraud detection

Automated signals today: **none of significance** (no duplicate-image detection, no price-outlier model, no VIN checks). Human signals: listing moderation queue, community reports (`POST /api/reports`: scam/price/sold/duplicate/prohibited-stolen/other), staff risk-score tooling for suppliers (`supplierRiskScore` 0–100, ≥60 = high risk), and the incident queue. AI fraud prioritisation from the brief is **not implemented** (Part 12 distinguishes real AI from roadmap).

## 10.5 Test-drive controls

- Booking requires `licenceConfirmed: true` (explicit customer assertion — **no licence verification integration exists**), a 1h–60day window, dealership vehicles only, and org members cannot book their own stock.
- The drive itself records: `releasedBy` (who authorised release), odometer-out/fuel-out/condition-out, then odometer-in/fuel-in/condition-in/`returnedBy`. Statuses prevent skips (confirm→start→complete; no-show/cancel paths guarded).
- Non-return → incident category `TEST_DRIVE_NOT_RETURNED` ties the drive record to the investigation.
- Honesty note: `releasedBy`/`returnedBy` are free-text names, not staff accounts (Part 20).

## 10.6 Garage custody records (the core of vehicle protection)

Covered fully in Part 9.11–9.13. The protection properties: condition evidence at handover (photos + declared damage + valuables), an **authorised spend cap**, customer-permission road tests with odometer trails and incident flags, completion evidence (photos, final odometer, cost), and **authorised release** — the vehicle cannot be marked returned except by the customer personally or by a verified single-use code. All of it is an append-only event timeline visible to both sides.

## 10.7 Staff responsibility

Recorded as named fields: custody `receivedByStaffName`, test-drive `releasedBy`/`returnedBy`, transfer `receivedByName`, collection `collectedByName`, incident `assignedTo`. **Limitation**: these are strings, not foreign keys to `User` — good for evidence, weaker for access revocation (a fired employee's name still appears historically; their *access* dies immediately via role stripping, but past records can't be re-attributed automatically).

## 10.8 Vehicle movement records

- **Custody events** for garage possession (receive/status/road-test/collection).
- **Inter-branch transfers** for showrooms: `REQUESTED → APPROVED → DISPATCHED (dispatch ref, odometer, condition notes, ≤6 photos) → RECEIVED (condition-in; authoritative `Vehicle.branchId` moves)` with reject/cancel paths and full event timeline.
- **Deliveries** for parts (supply OTP/QR handover) and **delivery jobs** for logistics (pickup → transit → delivered with POD photos + OTP/QR).

## 10.9 Customer collection authorisation

Single-use 6-digit code (`CollectionAuthorisation`): bcrypt-hashed at rest, 48h expiry, last-2-digit hint for UX, re-issue revokes the previous code, failed verifications audited (`COLLECTION_CODE_FAILED`), success consumes the code (`usedAt`) in the same transaction that returns the vehicle. Rate-limiting on verification attempts is **not** implemented (bcrypt cost + 6-digit space are the current mitigations) — flagged in Part 20.

## 10.10 Incident reports, evidence preservation & audit history

- Evidence: JSON arrays of file URLs on incidents and disputes; the upload endpoint gap means real files must be seeded/pre-provisioned today (Part 20 #1).
- Immutability: event tables (`CustodyEvent`, `IncidentEvent`, `DisputeEvent`, `POEvent`, `VehicleTransferEvent`, `ListingEvent`, `ApplicationEvent`, `DocumentAccessLog`, `AuditLog`) have no delete/update endpoints — history cannot be quietly rewritten through the API.
- Admin audit trail: filterable, paginated (`GET /api/admin/audit`), records actor, action, target, metadata for every consequential mutation.

## 10.11 Dispute handling & appeals

- Custody disputes → SecurityIncident (customer-initiated, staff-resolved).
- Supply/B2C disputes → `Dispute` objects with reason enums, evidence, amount freezing where payment is protected, staff resolutions (REFUND_FULL/PARTIAL/REPLACEMENT/REJECTED) and `Refund` rows processed by FINANCE.
- Appeals: **no formal appeal object**. A party's recourse is a new incident/report and staff review; resolution states are terminal by design.

## 10.12 Automated vs human vs external (the honest split)

| Check | Automation | Human review | External integration |
|---|---|---|---|
| Business verification | State machine + SLA sweep + completeness gates | **Yes — reviewer decides** | Registry/CRB checks: **none** |
| Document verification | Expiry, supersession, access logging | **Yes — per document** | Government/NTSA/KRA validation: **none — do not claim it** |
| Listing approval | Validation, rate limits, dedup of views only | **Yes — moderator queue** | Stolen-vehicle registry: **none** |
| Stolen/fraud incidents | Routing, severity, timelines | **Yes — staff queue** | Police/Interpol feeds: **none** |
| Custody protection | Codes, hashing, state guards, spend caps | Disputes reviewed by staff | — |
| Payment protection | Amount checks, idempotency, signature verification | Finance reconciliation | **M-Pesa Daraja — wired, sandbox-only, unverified without credentials** |
| Seller identity | — | **Yes — KYC review** | ID database check: **none** |
| Reviews authenticity | **Earned-gating (automated)** | Report-based moderation | — |
| AI risk scoring | **Not implemented** (only rule-based Dealer Copilot) | — | — |

**Compliance line**: CARMAZE does not now, and must not be described as, performing government or NTSA verification of vehicles or documents. All verification statuses mean "a CARMAZE reviewer checked the submitted evidence".
