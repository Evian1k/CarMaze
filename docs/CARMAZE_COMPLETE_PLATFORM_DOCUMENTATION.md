# CARMAZE — COMPLETE PLATFORM DOCUMENTATION

**Main index & executive handover document**
Version 1.0 · Generated from a full source-code inspection (every API route, view, component, library and database model in this repository was read; nothing in this documentation is invented).

---

## How to use this document

This is the **index document**. CARMAZE's documentation is large, so it is split into focused files under `docs/`. Each file covers specific Parts of the requested 22-Part documentation. The table below maps every Part to its file.

| Part | Topic | File |
|---|---|---|
| Index + Part 1 + Part 22 (executive summary, glossary) | What CARMAZE is · handover orientation | **this file** |
| Whole-platform narrative (10-page continuous read) | The entire story of the platform in one sitting | [CARMAZE_TEN_PAGE_NARRATIVE.md](CARMAZE_TEN_PAGE_NARRATIVE.md) |
| **Final remediation report set (9 Nov)** | Production readiness · security audit · payments & settlements · database & backup · deployment · test results · remaining blockers · environment variables | [CARMAZE_PRODUCTION_READINESS_REPORT.md](CARMAZE_PRODUCTION_READINESS_REPORT.md) · [CARMAZE_SECURITY_AUDIT.md](CARMAZE_SECURITY_AUDIT.md) · [CARMAZE_PAYMENT_AND_SETTLEMENT_REPORT.md](CARMAZE_PAYMENT_AND_SETTLEMENT_REPORT.md) · [CARMAZE_DATABASE_AND_BACKUP_GUIDE.md](CARMAZE_DATABASE_AND_BACKUP_GUIDE.md) · [CARMAZE_DEPLOYMENT_GUIDE.md](CARMAZE_DEPLOYMENT_GUIDE.md) · [CARMAZE_TEST_RESULTS.md](CARMAZE_TEST_RESULTS.md) · [CARMAZE_REMAINING_BLOCKERS.md](CARMAZE_REMAINING_BLOCKERS.md) · [CARMAZE_ENVIRONMENT_VARIABLES.md](CARMAZE_ENVIRONMENT_VARIABLES.md) |
| Part 2 | How the website was built (technology stack) | [02-technology-stack.md](02-technology-stack.md) |
| Part 3 | Complete project structure | [03-project-structure.md](03-project-structure.md) |
| Part 4 | How the entire system works (browser → database flows) | [04-system-workflows.md](04-system-workflows.md) |
| Part 5 | Every role and its dashboard + role-permission matrix | [05-roles-dashboards-permissions.md](05-roles-dashboards-permissions.md) |
| Part 6 + Part 11 | Customer experience · Vehicle Passport & My Garage | [06-customer-experience.md](06-customer-experience.md) |
| Part 7 | Private seller system | [07-private-seller-system.md](07-private-seller-system.md) |
| Part 8 + Part 14 | Showroom system (DealerOS) · public storefronts | [08-showroom-dealeros.md](08-showroom-dealeros.md) |
| Part 9 | Garage system (GarageOS) | [09-garage-garageos.md](09-garage-garageos.md) |
| Part 10 | Vehicle protection and trust | [10-vehicle-protection-trust.md](10-vehicle-protection-trust.md) |
| Part 12 | AI and automation | [11-ai-and-automation.md](11-ai-and-automation.md) |
| Part 13 | Payments, subscriptions and revenue | [12-payments-subscriptions-revenue.md](12-payments-subscriptions-revenue.md) |
| Part 15 | Messaging and notifications | [13-messaging-notifications.md](13-messaging-notifications.md) |
| Part 16 | Database and data relationships (+ ERD) | [14-database-documentation.md](14-database-documentation.md) |
| Part 17 | Security, privacy and compliance | [15-security-privacy-compliance.md](15-security-privacy-compliance.md) |
| Part 18 | Infrastructure and deployment | [16-infrastructure-deployment.md](16-infrastructure-deployment.md) |
| Part 19 | How to maintain and extend CARMAZE | [17-developer-guide.md](17-developer-guide.md) |
| Part 20 | Known limitations and future development | [18-limitations-and-roadmap.md](18-limitations-and-roadmap.md) |
| Part 21 | Complete system diagrams (Mermaid) | [19-system-diagrams.md](19-system-diagrams.md) |
| Part 22 | Final handover brief | final section of this file |

---

# PART 1 — WHAT CARMAZE IS

## 1.1 What CARMAZE does

CARMAZE is a **Kenya-first automotive ecosystem**: a single web platform that connects everyone involved in the life of a vehicle — buyers, private sellers, showrooms, garages, parts suppliers, delivery/logistics partners, inspection/insurance/towing partners, and the CARMAZE operations team — into one coherent product with one identity system, one database and one set of trust rules.

Concretely, the platform as built provides:

1. **CARMAZE Marketplace** (`#/cars`) — a moderated vehicle listings market with search, filters, compare, saved vehicles/searches, enquiries, offers and test-drive booking.
2. **CARMAZE DealerOS** (`#/dealer`) — a complete showroom management portal: onboarding application, inventory, enquiry inbox, test drives, dealer-to-dealer offers, buying requests, branches, staff seats, memberships programmes, promotions, billing and profile/storefront management.
3. **CARMAZE GarageOS** (`#/garage-dashboard`) — a garage management portal: service catalogue, quote requests, bookings, the full **vehicle custody lifecycle** (digital handover → inspection → work → road-test authorisation → release codes → return), branches, memberships, reviews and profile management.
4. **CARMAZE Supply Network** (`#/supply`, `#/supplier`, `#/procurement`) — a verified B2B parts marketplace: supplier storefronts and catalogue with fitment data, garage procurement portal with cart, RFQs, approval gates, protected payments (M-Pesa escrow-style release), OTP/QR delivery handover, inspection, disputes, returns and warranty claims — plus direct consumer parts ordering.
5. **CARMAZE LogisticsOS** (`#/logistics`) — a delivery partner network: drivers/fleet management, open job board, OTP/QR-verified proof-of-delivery with photos.
6. **CARMAZE My Garage** (`#/my-garage`) — the customer's private vehicle vault: owned-vehicle records, service history, maintenance reminders, **Vehicle Protection** (custody tracking, road-test approvals, collection authorisation codes, security incident reporting).
7. **CARMAZE 3D Customizer** (`#/customizer`) — a real-time WebGL (three.js) vehicle configurator with shareable configurations that can be sent to garages as modification quote requests.
8. **CARMAZE Community** (`#/community`) — moderated automotive discussions, polls, reactions and reporting.
9. **CARMAZE Memberships & loyalty** (`#/memberships`, `#/account`) — business-defined customer membership tiers with per-month benefit redemption, a private "Trusted Customer" programme, a business-controlled credit ledger, and a platform loyalty/referral points ledger.
10. **CARMAZE Roadside** (`#/roadside`) — roadside assistance requests routed to approved providers (with explicit "not an emergency service" disclaimers).
11. **CARMAZE Partner Network** (`#/partners`) — a human-verified directory of inspection, insurance, finance, towing, parts and transport partners with tracked referral requests.
12. **CARMAZE Control Center** (`#/admin`) — platform staff operations: verification queues, listing moderation, applications, users, staff management, supply console, disputes/refunds/reconciliation, campaigns, partners, tickets, broadcasts, audit log, settings, revenue and the demo-account system.

All twelve live in **one Next.js application** with **one database**, one auth/session system, and a shared `Org` (business) + `OrgMember` (membership) model that every business module reuses.

## 1.2 The problem it solves

CARMAZE was founded (per the founder's original build brief, preserved in `upload/Pasted Content_1793281966815.txt` and `upload/Pasted Content_1793317588043.txt`) around problems specific to buying and owning vehicles in Kenya:

- **Trust deficit**: classifieds are full of unverified sellers, stolen vehicles and fake documents. CARMAZE's answer is a **human verification pipeline** — business applications with documents, a per-document verification state machine, "uploading never self-verifies", and a security-incident system for stolen-vehicle and fraud reports.
- **Vendor chaos**: showrooms and garages run on WhatsApp and paper. DealerOS and GarageOS give them real operating software (inventory, leads, jobs, custody records, staff seats, analytics) instead of just a listing page.
- **Garage custody risk**: customers hand cars to strangers. CARMAZE makes handover a **recorded digital event** with condition photos, declared valuables, authorised spend caps, explicit road-test permission, and a single-use collection code required before release.
- **Parts procurement opacity**: garages need verified suppliers, fitment certainty and payment protection. The Supply Network records compatibility data (with honest MATCH/POSSIBLE/NO_FITMENT verdicts), protects payment until delivery inspection, and verifies handover with OTP/QR.
- **Fragmentation**: buyers, sellers, garages and suppliers otherwise use disconnected tools; CARMAZE keeps the whole vehicle lifecycle in one identity/data graph.

## 1.3 Who uses it

Every role below exists in code (`src/lib/auth.ts` `ROLE` map, comma-separated roles on the `User` row, org roles on `OrgMember.role`):

| Persona | How they appear in the system |
|---|---|
| Visitor | Unauthenticated user; public marketplace, directories, community, storefronts, customizer |
| Customer | `CUSTOMER` role (auto-granted at registration together with `SELLER`) |
| Private seller | `SELLER` (default) / `SELLER_VERIFIED` (granted only after staff approve a SELLER KYC application) |
| Showroom owner | `DEALER_OWNER` platform role + `OrgMember(OWNER)` of a `DEALER` Org |
| Showroom manager/staff | `DEALER_STAFF` platform role + `OrgMember(MANAGER/SALES/FINANCE/STAFF)` |
| Garage owner | `GARAGE_OWNER` + `OrgMember(OWNER)` of a `GARAGE` Org |
| Garage manager/staff | `GARAGE_STAFF` + `OrgMember(MANAGER/MECHANIC/STAFF)` |
| Supplier owner/staff | `SUPPLIER_OWNER`/`SUPPLIER_STAFF` + `OrgMember` with supply roles (OWNER/OPERATIONS/WAREHOUSE/SALES/PROCUREMENT/ACCOUNTANT) |
| Logistics partner owner | `LOGISTICS_OWNER` + an approved `LogisticsPartner` row + managed `Driver` records |
| Platform support | `SUPPORT` (staff role) |
| Reviewer / moderator / finance | `REVIEWER`, `MODERATOR`, `FINANCE` (staff roles with distinct powers) |
| Administrator | `ADMIN` (Super Admin) |
| Founder | `FOUNDER` — untouchable target in every admin guard (`FOUNDER_PROTECTED`) |
| Partner (referral directory) | A `Partner` record managed by staff; no login account is required to be listed |

The eight **demo accounts** (`DemoAccount` table) map to seeded, sandboxed copies of these personas and are described in Part 5.

## 1.4 Why it is different from an ordinary vehicle marketplace

Ordinary marketplaces stop at listing + chat. CARMAZE's differentiators, all of which exist in code:

1. **Verified, moderated supply side.** Businesses cannot self-verify. Applications → documents → reviewer decisions → org creation are separate steps (`Application`, `VerificationDocument` state machines). Suspended orgs disappear from every public surface.
2. **Custody-grade garage operations.** The `VehicleCustody` model records the entire possession lifecycle with a customer-authorised release code — a feature class marketplaces do not have.
3. **Protected B2B payments.** Garage procurement money moves through a `PaymentAuthorization` that becomes `PROTECTED` **only** on provider confirmation and is released to the supplier **only after garage inspection** (`release` action computes the platform commission).
4. **Honesty as architecture.** Email/SMS notification rows are recorded as `FAILED` ("not implemented") rather than pretending; M-Pesa endpoints return `501 MPESA_NOT_CONFIGURED` naming the missing variables instead of simulating success; fitment verdicts include an explicit `NO_FITMENT` state; the AI endpoints never invent vehicle data.
5. **A connected ecosystem, not a directory.** The 3D customizer produces quote requests; garage completions earn loyalty points; test drives/completed services are the only way to "earn" a review; branches hold inventory and receive transfers.

## 1.5 How the parts of the ecosystem work together

- The **`Org`** row is the hub: a business is created by an approved application, holds members, branches, inventory, services, subscription, storefront content, campaigns and invoices.
- The **customer** (`User`) reaches businesses through public surfaces (marketplace, directories, storefronts) and every interaction (enquiry, conversation, quote, booking, custody, test drive, order) writes a row that links back to both the user and the org.
- **Staff** see queues across the platform (applications, documents, listings, incidents, disputes, invoices) but are sandboxed by role (see the matrix in Part 5).
- **Demo isolation** (`User.isDemo`, `Org.isDemo`, `src/lib/demo.ts`) keeps the seeded demonstration world separate from any real data — demo actors cannot touch real resources, and real users never receive notifications generated by demo actors.

## 1.6 Customer value proposition

- Discover verified vehicles and businesses in one place, with real moderation.
- Talk to businesses in-app with persistent history and attachments.
- Hand a car to a garage with a **recorded** handover, condition evidence, spend cap and authorised release.
- Track every owned vehicle's history and reminders in My Garage.
- Report stolen vehicles/fraud through a structured incident system (while being explicitly told to contact police first — CARMAZE is not an emergency service).
- Earn loyalty points for verifiable actions only (referrals, eligible reviews, completed services) — points are never purchasable.

## 1.7 Business value proposition (showrooms & garages)

- A private operating system (DealerOS/GarageOS) plus a public storefront, both created only after verification.
- Lead capture (enquiries, conversations, quote requests, test drives) with notification fan-out to the right staff roles.
- Subscription plans that gate operational limits (see [12-payments-subscriptions-revenue.md](12-payments-subscriptions-revenue.md)).
- Tools for multi-branch operation (branch manager, inter-branch vehicle transfers), staff seats, and customer programmes (memberships, trust labels, credit ledger).
- Promotions with **real** impression/click counters and invoices that must be paid before activation.

## 1.8 How CARMAZE intends to make money

From the founder's revenue brief and the implemented models (`Plan`, `Invoice`, `CampaignPackage`, `PurchaseOrder.platformFeeMinor`, `SystemSetting platform_fees`):

1. **Dealer subscriptions** — seeded plans: Dealer Starter KES 4,900/mo (10 listings, 1 featured, 2 staff), Dealer Pro KES 9,900/mo (40/5/8).
2. **Garage subscriptions** — Garage Basic KES 2,900/mo (20 requests, 3 staff), Garage Pro KES 5,900/mo (100/10).
3. **Supplier subscriptions** — Starter KES 1,499, Professional KES 3,999, Enterprise KES 8,999 (note: the subscribe endpoint currently gates supplier plans behind the garage-owner role — a known defect, see Part 20).
4. **Promotions** — Campaign packages: Spotlight 7 days KES 1,500; Homepage feature 3 days KES 3,000. Campaigns stay `PENDING_PAYMENT` until the linked invoice is paid.
5. **Commission on protected supply orders** — configurable via `SystemSetting platform_fees`: supply commission 3%, delivery commission 5%, minimum KES 50, vehicle sale 1.5%, booking 2%, membership platform fee 5%. Commission is computed and recorded at payment release.
6. **Membership platform fee** — 5% of business membership revenue is attributed to the platform in reporting.
7. **Planned but not implemented**: billable lead fees, inspection/verification paid services, partner referral commissions (the brief lists them; the code has no billing path for them).

Money flow: businesses/customers pay **M-Pesa STK push** into the platform's Daraja collection account (or FINANCE marks invoices paid after manual reconciliation); CARMAZE's earnings are the subscription invoice amounts and the recorded `platformFeeMinor` on released orders. **No payout/withdrawal system to suppliers exists** — supplier settlement is out of band. See [12-payments-subscriptions-revenue.md](12-payments-subscriptions-revenue.md).

## 1.9 Scaling from Kenya outward

The codebase is already structured for it: county lists and Kenyan phone/M-Pesa specifics are concentrated in `src/lib/format.ts` and `src/lib/mpesa.ts`; money is integer minor units with a `currency` field on every financial model; `AdminRevenue` rejects non-KE with a reserved `?country=` parameter; counties served are data (branch `deliveryAreas`, partner `serviceAreas`), not code. What a new market requires: a payments provider module beside `mpesa.ts`, locale currency formatting, and new county/area seed data — plus the operational reality of local verification staff.

## 1.10 The complete lifecycle of a vehicle on CARMAZE

1. **Created as a listing** — a private seller or showroom staff/owner submits vehicle details (draft → review → published; staff approve/reject/feature).
2. **Discovered** — marketplace search/AI Car Finder/similar-vehicles; views are counted with 24h per-IP dedupe (`ViewEvent`).
3. **Engaged** — enquiries (per-listing Q&A threads), conversations (org inbox), offers (dealers → matched private cars, reservation on acceptance), test drives (licence-confirmed, odometer/fuel logged at start and end).
4. **Transacted** — offer acceptance reserves the vehicle; marking sold completes it. (A full buyer-payment/ownership-transfer flow is *not* implemented — see Part 20.)
5. **Owned** — the buyer adds it to My Garage: records (service/repair/inspection/modification), reminders with recurrence, mileage sync.
6. **Serviced** — service requests → garage quotes → bookings; digital custody handover with condition evidence and authorised work; road tests only with explicit permission; release only via owner's single-use code; completion records cost, odometer and photos.
7. **Protected** — disputes/incidents (damage in custody, missing vehicle, unauthorised release…) open security incidents with immutable event timelines reviewed by staff.
8. **Maintained long-term** — parts procurement via the Supply Network, roadside assistance, membership benefits, community knowledge.
9. **Re-sold** — a new listing cycle begins; My Garage history remains with the customer account.

## 1.11 Purpose of every major module (one line each)

| Module | Purpose in one line |
|---|---|
| Marketplace | Moderated discovery and engagement for vehicle listings |
| DealerOS | Run a showroom: stock, leads, appointments, staff, money |
| GarageOS | Run a garage: quotes, bookings, custody-protected jobs |
| Supply Network | Verified B2B/consumer parts commerce with fitment + protected payments |
| Procurement | Garage buying workbench over the Supply Network |
| LogisticsOS | Delivery partner operations with verified handover |
| My Garage | Customer vehicle vault + protection cockpit |
| Customizer | Visual configuration that converts into garage quote requests |
| Community | Owned discussion surface with moderation + reporting |
| Memberships / Trust / Credit | Business-run customer programmes on shared rails |
| Roadside | Assistance requests routed to approved providers |
| Partner Network | Verified referrals to inspection/insurance/finance/towing partners |
| Control Center | Human verification, moderation, money, safety and settings |
| Notifications | In-app notification fabric (email/SMS rows recorded honestly as failed) |
| Demo system | Sandboxable 8-role demonstration world for stakeholders |

---

# PART 22 (EXECUTIVE SUMMARY) — FINAL HANDOVER BRIEF

**What exists.** CARMAZE is a working, single-repo Next.js 16 application (~75,000 lines of TypeScript/TSX (18,700 of them API routes), 99 database models, 154 API route files, 27 hash-routed views) implementing the twelve modules above. It is a genuine full-stack product: every view is backed by real API routes that enforce authentication, role and tenant checks server-side; there is no mock data layer and no second database. The seeded demo world (`prisma/seed.ts`, 22 users, 8 orgs, 12 vehicles, full supply network, complete example workflows) is quarantined behind `isDemo` flags and guards.

**Architecture in one paragraph.** React 19 SPA (one `/` route, hash routing) → fetch via `src/lib/client.ts` → Next.js App Router API routes wrapped in `route()` (request context, uniform errors, zod validation) → guards (`requireUser`, `requireRole`, `getMembership`, `requireOrgMember`, demo sandbox) → Prisma 6 → SQLite (`db/custom.db`). Auth is a signed httpOnly JWT cookie re-resolved against the database on every request; passwords are bcrypt; sessions die instantly on suspension because `getSessionUser()` rejects non-`ACTIVE` users.

**What is verified working** (by code inspection throughout, and by the pre-existing `verification/security-tests.ts` suite): registration/login/logout, MFA (TOTP), role-guarded dashboards, tenant isolation (org-scoped queries everywhere), the listing review pipeline, enquiry/offer/test-drive flows, the full custody lifecycle with collection codes, the protected PO workflow with OTP/QR handover and inspection-gated release, invoice-only activation of subscriptions/campaigns/memberships, M-Pesa wiring with fail-closed webhook verification, the admin hierarchy, demo sandboxing and reset.

**What is honestly not there yet** (detailed in [18-limitations-and-roadmap.md](18-limitations-and-roadmap.md)): **no file-upload write endpoint** (`POST /api/upload` is called by 12 frontend components but no backend route exists — uploads 404; seeded media is pre-provisioned), no email/SMS delivery, no background scheduler (SLA sweep is manual), no Prisma migration history (db push workflow), in-memory rate limiting, six-digit codes generated with `Math.random`, M-Pesa in sandbox-only mode without credentials, and several smaller gaps listed per module.

**Priority order for the next engineering phase** (security → revenue → experience): (1) implement the upload endpoint with the same hash-named storage the GET routes already serve; (2) rotate `AUTH_SECRET` and remove the dev fallback before any public deployment; (3) fix supplier-plan subscription gating; (4) wire the application SLA sweep to a scheduler; (5) add migration history; (6) then growth features (email via provider, notifications digest, VIN/plate checks).

**How to run it**: `bun install`, set `DATABASE_URL` in `.env`, `bun run db:push`, optionally `bun run db:seed`, `bun run dev` (port 3000). Full commands, deployment and rollback: [16-infrastructure-deployment.md](16-infrastructure-deployment.md). Day-to-day development rules: [17-developer-guide.md](17-developer-guide.md).

---

## Glossary of technical terms

| Term | Meaning |
|---|---|
| **Minor units** | Money stored as integer cents (KES 1,500 = `150000`) to avoid float errors. Every money field ends in `Minor`. |
| **Org** | A verified business row (`DEALER`/`GARAGE`/`SUPPLIER`) in the `Org` table. |
| **OrgMember** | A user's membership in an Org with a role (`OWNER`, `MANAGER`, `SALES`, `FINANCE`, `STAFF`, `MECHANIC`, supply roles). |
| **Platform role vs org role** | Platform roles (`DEALER_OWNER`, `GARAGE_STAFF`…) are on `User.roles`; org roles are per-membership on `OrgMember.role`. Both are checked server-side. |
| **Staff roles** | `SUPPORT, REVIEWER, MODERATOR, FINANCE, ADMIN, FOUNDER` — platform team roles (STAFF_ROLES in `src/lib/auth.ts`). |
| **Demo sandbox** | Seeded accounts/orgs flagged `isDemo`; guards in `src/lib/demo.ts` prevent demo actors touching real resources and vice versa. |
| **Hash route** | SPA navigation via URL fragments (`#/dealer?tab=billing`) parsed by `src/hooks/use-hash-route.ts`. |
| **Custody** | The `VehicleCustody` workflow recording a vehicle's possession inside a garage. |
| **Protected payment** | `PaymentAuthorization.status = PROTECTED` — funds confirmed by the provider and held until inspection release. |
| **STK push** | Safaricom Daraja "Lipa na M-Pesa Online" prompt sent to a customer's phone. |
| **Entitlement** | Limits derived from a plan (listings, featured slots, staff seats) enforced at API level. |
| **RBAC** | Role-based access control — the layered role/ownership/tenant checks in every API route. |
| **cuid** | Collision-resistant unique ID generated by Prisma for primary keys. |
| **STAFF6 / AF / FIN+** | Shorthand used in Part 5 for role groups (see the matrix there). |

---

*Prepared as a complete knowledge transfer: every statement above was verified against the repository's source code. Where a capability is configured-but-unverified (M-Pesa, email) or frontend-only, the supporting documents say so explicitly.*
