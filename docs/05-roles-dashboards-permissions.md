# PART 5 — EVERY ROLE AND ITS DASHBOARD

Roles live in two layers: **platform roles** on `User.roles` (comma-separated string; defined in `src/lib/auth.ts`) and **org roles** on `OrgMember.role` (per business). The frontend hides views via `src/lib/view-guard.ts`; the backend enforces the same (and stricter) rules in every route. Both layers are documented per role below.

**Role groups used in the matrix:** `AF` = ADMIN+FOUNDER · `STAFF6` = SUPPORT, REVIEWER, MODERATOR, FINANCE, ADMIN, FOUNDER · `FIN+` = FINANCE, ADMIN, FOUNDER · `MODQ` = REVIEWER, MODERATOR, ADMIN, FOUNDER.

---

## 5.1 Visitor (unauthenticated)

- **Gets**: every public view — Home, Marketplace, Vehicle detail, Showrooms, Garages, Storefronts, Supply Network, Memberships, Roadside, Partners, Community (read), Customizer (view/share), Platforms, Info pages (about/FAQ/terms/privacy/safety), Sign in/Register, Demo catalog.
- **Cannot**: save, enquire, offer, book, message, review, post, order, or reach any dashboard (`view-guard` sends them to access-denied/sign-in; APIs return 401). Anonymous rate limits are stricter (e.g. AI Car Finder 5/h).
- **Login mechanics**: `POST /api/auth/login` (or one-click demo `POST /api/auth/demo`).

## 5.2 Customer (`CUSTOMER`)

| Aspect | Detail |
|---|---|
| Registration | Self-service; every new user gets `CUSTOMER,SELLER` |
| Verification | Optional: email code, phone code, TOTP MFA (Account → Profile) |
| Dashboard | `#/account` — 12 tabs: profile, saved, enquiries, messages, requests, orders, searches, rewards, protection, subscriptions, testdrives, notifications |
| Also | `#/my-garage` (vehicle vault + protection), `#/my-listings` (as a seller) |
| Actions | Browse/search/compare/save vehicles & searches; enquire; message businesses; request quotes; accept quotes → bookings; book test drives; order parts; subscribe to business memberships; buy/hold trust/credit programmes offered to them; custody approvals (road-test, collection codes, collect-self, dispute); report incidents; loyalty points; community posts |
| API surface | `/api/vehicles` (read), `/api/enquiries`, `/api/offers` (none — offers are dealer→seller), `/api/test-drives?mine`, `/api/saved-*`, `/api/conversations?scope=mine`, `/api/service-requests?mine`, `/api/quotes/[id]` (accept/decline as customer), `/api/bookings?mine`, `/api/custody?mine` + collection-auth/collect-self, `/api/incidents?mine`, `/api/orders`, `/api/memberships/*`, `/api/account/subscriptions`, `/api/loyalty/summary`, `/api/mygarage/**`, `/api/community/*`, `/api/reports` |
| Records accessible | Strictly their own rows (`userId = session user`) + public data. Custody access = `customerId === user.id`; document access = `ownerUserId === user.id` |
| Cannot access | Any business dashboard (DealerOS/GarageOS/SupplierOS/LogisticsOS/admin — view-guard + 403s), other users' anything, staff queues |
| Suspension | `getSessionUser()` returns null on every request → 401 everywhere; cookie may persist but is dead |

## 5.3 Private seller (`SELLER` / `SELLER_VERIFIED`)

- **Who**: any registered user listing vehicles privately. `SELLER_VERIFIED` is granted **only** by staff approving a SELLER KYC application (`POST /api/applications {type:'SELLER'}` with ≥1 document; approval in Admin → Applications).
- **Dashboard**: `#/my-listings` — tabs `listings` / `offers` / `enquiries`; verification banner states; plus `#/sell` wizard (also edit mode `#/sell?id=`).
- **Actions**: create/edit/submit listings (DRAFT → PENDING_REVIEW), resubmit rejected, mark sold, delete drafts, respond to enquiries, accept/reject dealer offers on their `matchWithDealers` vehicles.
- **Server scoping**: `GET /api/vehicles?mine=1` → `ownerId = user.id` (plus org-owned if they are dealer members); offers visible only for own vehicles; enquiries `?selling=1` scoped identically.
- **Cannot**: publish themselves (staff publish), see buyer identities beyond enquiry content, access any org module they are not a member of.

## 5.4 Showroom Owner (`DEALER_OWNER` + `OrgMember OWNER/MANAGER/SALES/…`)

- **How**: `#/dealer` 4-step onboarding wizard → `POST /api/applications {type:'DEALER'}` with documents → staff approve → system creates the `Org` (DEALER, ACTIVE) + `OrgMember(OWNER)` + grants `DEALER_OWNER`.
- **Dashboard**: DealerOS `#/dealer?tab=` — 12 tabs: `overview` (stats + Dealer Copilot + subscription card), `inventory`, `branches` (BranchManager + vehicle transfers), `enquiries`, `inbox`, `offers`, `testdrives` (15s polling), `buying` (buying requests + dealer board), `memberships` (MembershipsManager: tiers/trust/credit), `staff` (OWNER-only invite; seat limits from plan), `billing` (plans, invoices, M-Pesa, promotions), `profile`.
- **Data access**: everything scoped to `orgId IN (my memberships)` — inventory, enquiries, conversations, offers sent, test drives, branches, staff, invoices (`?org=1` requires OWNER/MANAGER/FINANCE), campaigns, storefront edits (OWNER/MANAGER).
- **Cannot**: other orgs' data (403/404), admin queues, platform settings, demo management.
- **Multi-org**: owner of several dealerships gets an org switcher.

## 5.5 Showroom Manager / Staff (`DEALER_STAFF` + `OrgMember MANAGER/SALES/FINANCE/STAFF`)

- **How**: invited by the OWNER in DealerOS → Staff (`POST /api/orgs/staff`; creates or links the user, one-time password shown once; seat limit = `Plan.staffLimit`, default 2 without a plan → 402 `PLAN_LIMIT`).
- **Dashboard**: same DealerOS shell. Differences enforced server-side, not just hidden:
  - Invite/remove staff: **OWNER only** (UI shows "Owner or manager access required"; API 403s).
  - Invoices read: OWNER/MANAGER/FINANCE only; subscribe requires the org role + platform role.
  - Profile edit: OWNER/MANAGER.
  - Leads/inbox/test drives/offers: **any membership role** can work them (this is the intended staff workflow).
- **Cannot**: see or act on other dealerships; access billing as `STAFF`/`SALES` (verified by the security suite); ever become OWNER except by owner action.

## 5.6 Garage Owner (`GARAGE_OWNER`)

- **How**: `#/garage-dashboard` wizard → `POST /api/applications {type:'GARAGE', categories…}` (categories required) → approval creates `Org(GARAGE)` + owner membership + role.
- **Dashboard**: GarageOS `#/garage-dashboard?tab=` — 12 tabs: `overview` (stat cards + rating + pipeline), `services` (CRUD, soft-deactivate), `requests` (eligible open leads), `quotes`, `bookings` (schedule/start/complete/cancel), `custody` (board over the 11-status lifecycle + receive/status/roadtest/ready/collect actions + release verification), `procurement` (link to `#/procurement`), `branches`, `memberships`, `inbox`, `reviews`, `profile` (+ promotions).
- **Server scoping**: custody/board/quotes/bookings/services all filter `orgId IN memberships`; custodies expose collection-auth metadata only (never the code hash); collection codes verify via bcrypt.
- **Cannot**: other garages' custody/jobs/customers; dealer inventory; admin surfaces.

## 5.7 Garage Manager / Reception / Technician (`GARAGE_STAFF`)

- **How**: invited via GarageOS (org role OWNER/MANAGER set up the same `POST /api/orgs/staff`-style invite on the garage side; supply-side garages additionally use fine-grained roles: GM, BRANCH_MANAGER, PROCUREMENT, MECHANIC, ACCOUNTANT, INVENTORY).
- **Honest capability note**: in **core GarageOS** (bookings, custody, quotes, services) any org membership role can act — the API does **not** currently split "reception" vs "technician" permissions (both are `GARAGE_STAFF` + an org role; the seed uses `MANAGER`/`MECHANIC`). The **procurement** module *does* split roles precisely via the `roleCan` matrix (order.create = OWNER/GM/PROCUREMENT; approve = OWNER/GM; pay = +ACCOUNTANT; inspection = OWNER/GM).
- **Cannot**: billing (subscribe is owner-gated), branch admin (OWNER/GM/OPERATIONS), owner removal, other garages.

## 5.8 Supplier Owner / Staff (`SUPPLIER_OWNER`/`SUPPLIER_STAFF`)

- **How**: public `#/supply` → "Become a supplier" or `#/supplier` apply (`POST /api/suppliers` → SUPPLIER application) → staff approve in Admin → Supply console (`approve-application` creates Org(SUPPLIER) + OWNER membership + role; `verify-supplier` makes the storefront public).
- **Dashboard**: `#/supplier?tab=` — 8 tabs: overview, products (SKU/price/wholesale/compatibility; authenticity is read-only), orders (B2B PO lifecycle incl. revise/dispatch/handover-confirm/dispute), consumer-orders, quotes, warehouses (branches with delivery areas), inventory (stock levels + restock), billing.
- **Permission matrix** (`src/lib/supply.ts` `roleCan`, mirrored in UI): catalogue.write = OWNER/OPERATIONS; stock.write = +WAREHOUSE; order.respond = OWNER/OPERATIONS/WAREHOUSE; delivery.arrange = same +garage side; dispute.open = OWNER/OPERATIONS; finance.read = +ACCOUNTANT.
- **Cannot**: see garage buyer identity beyond order data; act on other suppliers; self-verify (admin only).

## 5.9 Logistics Partner (`LOGISTICS_OWNER`)

- **How**: `#/logistics` application (`type:'LOGISTICS'`, ≥1 document, consent) → approval creates a `LogisticsPartner` (APPROVED) + role; suspension is enforced per action (`PARTNER_SUSPENDED`).
- **Dashboard**: `#/logistics?tab=` — 4 tabs: `jobs` (open board + active + history; accept requires an ACTIVE driver; deliver requires OTP/QR + ≥1 POD photo), `fleet` (drivers CRUD; delete blocked while busy), `requests` (requester tool with QR display), `earnings` (honest counters; explicitly "records, not wallet balances").
- **Cannot**: see OTP codes of jobs (only requester/staff see `otpHint`/`qrToken`), other partners' jobs, admin surfaces.

## 5.10–5.13 Platform staff (`STAFF6`)

All staff land on the **Control Center** `#/admin` (nav pills filtered by role, department badge, health chips). Powers per endpoint (full table below):

| Role | Distinct powers | Explicitly blocked from |
|---|---|---|
| **SUPPORT** (`platform-support`) | Read all queues; tickets (handle/resolve); campaigns (activate/end/cancel); partners (approve/reject/suspend/notes); supply console mutations except finance actions; listings queue **read** | Listing moderation **writes**, user/staff management, settings, revenue, fees, broadcasts, audit read (demo sessions) |
| **REVIEWER** | Everything above **plus** listing moderation writes (approve/reject/suspend/feature) | Same as SUPPORT for admin-only surfaces |
| **MODERATOR** | Same as REVIEWER (moderation queue + queues) | Same |
| **FINANCE** | Invoices read; mark-paid; refunds; platform fees; **revenue dashboard**; supply `reconcile-payment`/`process-refund` | User mutations, staff mgmt, settings, broadcasts, listings writes |
| **ADMIN** (Super Admin) | Everything: users suspend/reactivate, staff lifecycle (invite/set role/department/suspend/remove), settings (JSON keys), logistics suspend/reinstate, broadcasts, demo management + reset, plus all FIN+ and STAFF6 powers | Cannot act on FOUNDER (`FOUNDER_PROTECTED`); cannot modify self in destructive actions |
| **FOUNDER** | Everything ADMIN has; untouchable target everywhere | — |

**Admin route guard table** (from `src/app/api/admin/**`):

| Endpoint | Read | Mutate | Demo restriction |
|---|---|---|---|
| `/admin/overview`, `/admin/ops`, `/admin/campaigns`, `/admin/partners`, `/admin/listings` (GET), `/admin/tickets`, `/admin/supply` (GET), `/admin/broadcast` (GET) | STAFF6 | — | subject-scoped or blocked |
| `/admin/audit` (GET) | STAFF6 | — | fully blocked for demo sessions |
| `/admin/users` (GET) | STAFF6 | PATCH: **AF** | PII blocked for demo; subject must be demo-owned |
| `/admin/staff` (GET/POST) + `[id]` | **AF** | **AF** | platformWide blocked |
| `/admin/settings` | **AF** | **AF** | platformWide blocked |
| `/admin/logistics` + `[id]` | **AF** | **AF** | subject-scoped |
| `/admin/listings` (PATCH) | — | **MODQ** | subject-scoped |
| `/admin/supply` (POST) | — | STAFF6; `reconcile-payment`/`process-refund` → **FIN+** | DB-resolved subject must be demo-owned |
| `/admin/fees`, `/admin/revenue` | **FIN+** | **FIN+** (fees PUT) | fully blocked for demo |
| `/admin/broadcast` (POST) | — | **AF** (cap 1000, 4/h) | platformWide blocked |
| `/admin/demo-accounts` (+reset) | **AF** | **AF** | demo callers read-only/blocked |

Additional staff mechanisms: department badges (`User.department`), one-time password staff invites (bcrypt-stored, shown once), instant revocation (role strip → next request 403), suspension semantics identical to users.

## 5.14 Partner users

Partners (`Partner` model: inspection, insurance, finance, towing, parts, transport, other) **do not log in**. They apply publicly (`POST /api/partners/apply`), staff approve (`PATCH /api/admin/partners/[id]`), and their public card exposes only public fields (internal notes are staff-only). Customer requests become `PartnerRequest` rows with tracked ref codes; the partner is expected to make contact out-of-band (referral model, no commission billing yet).

## 5.15 Demo accounts (8)

Registry table `DemoAccount` (roleKey, server-only email mapping, `enabled`, `sessionMinutes` default/cap 20160 = 14 days, `restrictedNote`, reset counters). `POST /api/auth/demo {role}` maps to the seeded user server-side (credentials never shipped), clamps session length, adds a `demo` claim to the JWT. Sandboxing (`src/lib/demo.ts`): demo actors touch only demo resources; demo staff cannot read real PII/audit/revenue and cannot perform platform-wide mutations (`DEMO_SANDBOXED`); notifications from demo actors to real users are suppressed; real payments are blocked (`assertNotDemoActor`). Admin → Demo tab manages enable/disable/session length and runs a full data reset (`bun prisma/seed.ts` re-run, single-flight, confirmation phrase required).

## 5.16 Role–permission matrix (condensed)

Legend: ✅ allowed · 🔶 partial/role-conditioned · ❌ denied. "Own org" = orgs where the user holds a membership.

| Capability | Customer | Seller | Dealer Owner | Dealer Staff | Garage Owner | Garage Staff | Supplier | Logistics | Support/Rev/Mod | Finance | Admin/Founder |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Browse/compare/save | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create listing | 🔶 own | ✅ | 🔶 org | 🔶 org | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Publish listing (approve) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🔶 Rev/Mod/AF | ❌ | ✅ |
| Enquire/message/book | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Send dealer offer | ❌ | ❌ | ✅ | 🔶 (org rule) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Accept/reject offers on vehicle | ❌ | ✅ owner | 🔶 org | 🔶 org | ❌ | ❌ | ❌ | ❌ | 🔶 staff | 🔶 | 🔶 |
| Test-drive lifecycle (org side) | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Quote on service request | ❌ | ❌ | ❌ | ❌ | ✅ | 🔶 org member | ❌ | ❌ | ❌ | ❌ | ❌ |
| Custody receive/status/roadtest | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (member) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Custody authorize/collect | ✅ owner | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Staff invite (org) | ❌ | ❌ | ✅ owner | ❌ | ✅ owner | ❌ | 🔶 | ❌ | ❌ | ❌ | ❌ |
| Billing: subscribe/mark-paid/refund | 🔶 own invoices | ❌ | 🔶 org invoices | 🔶 MANAGER/FIN read | 🔶 same | ❌ | 🔶 (defect: garage-gated) | ❌ | ❌ | ✅ | ✅ |
| PO create/approve/pay/inspect | ❌ | ❌ | ❌ | ❌ | 🔶 matrix | 🔶 matrix | ❌ | ❌ | ❌ | ❌ | ❌ |
| PO respond/dispatch | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🔶 matrix | ❌ | ❌ | ❌ | ❌ |
| Delivery jobs (partner side) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Applications approve (onboarding) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ STAFF6 | ✅ | ✅ |
| Documents verify | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ STAFF6 | ✅ | ✅ |
| Users suspend / staff mgmt | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ AF |
| Settings / broadcast / demo mgmt | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ AF |
| Revenue + fees | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Incident status decisions | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Supplier verify / authenticity | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |

## 5.17 How cross-role privacy is enforced (with the attack paths)

1. **Query scoping** — every list endpoint filters by the caller's id/memberships before returning (`?mine=1`, `?org=1`, `forOrg`, `incoming`); there is no "list all" for non-staff.
2. **Direct-ID access** — every `GET/PATCH /…/[id]` re-derives permission from the DB row (owner id, org membership, or staff role), not from client claims. Foreign IDs → 403 or 404-masquerade.
3. **Role escalation is impossible from the API** — no endpoint accepts a roles field for self-service; role grants exist only inside staff approval/invitation flows, which are themselves role-gated and audited.
4. **Suspension/revocation is immediate** — sessions are re-resolved against the DB each request (verified by `verification/security-tests.ts` §12).
5. **Demo walls** — `isDemo` org/user checks block cross-contamination in both directions (verified §10).
6. **Sensitive documents** — private `/api/files/*` route: owner-only, staff bypass requires STAFF_ROLES + demo guard, every non-owner view logged to `DocumentAccessLog`.
7. **Known view-layer leaks (UX only, not security)**: the ⌘K palette lists role portals to all users; mobile hamburger lacks role links. Backend still denies.

## 5.18 When accounts are suspended or permissions revoked

- **User suspended**: every API call → 401/403 within the same request cycle; their org memberships remain but are unreachable; storefronts list other members still.
- **Staff removed** (`remove_staff`): staff roles stripped (falls back to `CUSTOMER`), department cleared, notification sent, audit entry; next request has no admin powers.
- **Org membership removal** (`DELETE /api/orgs/staff`): the platform role is stripped if the user has no other dealer orgs; all org-scoped queries immediately exclude them.
- **Org suspended**: org leaves every public surface; members' dashboards show a paused-org alert; subscriptions' entitlement checks fail closed.
- **Partner suspended**: disappears from public directory; jobs/partner actions fail with explicit status errors.
- **Demo role disabled**: disappears from catalog; sign-in attempts → 403 `DEMO_DISABLED`.
