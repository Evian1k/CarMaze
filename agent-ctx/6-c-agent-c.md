# Task 6-c — Garage Ecosystem + Roadside (Agent C)

Status: **COMPLETE** (all endpoints + 3 views built, lint/type-check clean, curl-verified end-to-end)

## Files created (ownership respected)

API routes:
- `src/app/api/garages/route.ts` — GET public directory (+`?mine=1` member feed), PATCH org profile
- `src/app/api/garage-services/route.ts` — GET public, POST, PATCH, DELETE (soft `active=false`)
- `src/app/api/service-requests/route.ts` — POST (rate 10/hr), GET `?mine=1`, GET `?org=1`
- `src/app/api/quotes/route.ts` — POST (rate 30/hr, upsert on `(requestId, orgId)`)
- `src/app/api/quotes/[id]/route.ts` — PATCH `accept` / `decline`
- `src/app/api/bookings/route.ts` — GET `?org=1` / `?mine=1`, PATCH schedule|start|complete|cancel
- `src/app/api/reviews/route.ts` — GET `?orgId=` (public), POST (earned-only upsert)
- `src/app/api/roadside/route.ts` — POST (rate 5/hr), GET `?mine=1` / `?providers=1`, PATCH accept|complete|cancel

Views:
- `src/views/garages/index.tsx` — hero w/ `/images/garage.png`, chips + county filter + search, GarageAssistant hook (`onSelect` sets category + scrolls), garage cards (Approved badge, stars, service chips w/ priceFrom, "Show more"), quote-request dialog → success card w/ refCode, "My quote requests" link for authed users
- `src/views/garage-dashboard/index.tsx` — phase machine: sign-in gate → 3-step application wizard (POST /api/applications type GARAGE) → application status/timeline/resubmit (MORE_INFO_REQUIRED) → full GarageOS tabs: Overview (stats/rating/pipeline), Services (add/edit/activate), Requests (leads + "3D configuration" chip → `#/customizer?cfg=`), Quotes (own quotes + statuses), Bookings (Schedule/Start/Complete/Cancel; customer name+phone only here), Reviews, Profile (PATCH /api/garages). Org switcher for multi-org owner. KES input → ×100 minor units w/ regex validation + live money preview.
- `src/views/roadside/index.tsx` — prominent honest disclaimer (incl. in header, form, success, directory), auth-gated request form (prefilled name/phone via mount-time init), success card w/ refCode + status, My requests (provider name+phone+note when ACCEPTED, mark-completed by requester), public providers directory (name/area/business phone/service chips).

## Key endpoint shapes (verified by curl)

- `GET /api/garages` → `{garages:[{org:{id,name,county,town,location,description,phone}, services:[{id,category,title,description,priceFromMinor}], rating:{avg,count}, reviewCount}]}` sorted rating desc → reviewCount. Filters `?category=TYRES` → only Mombasa Road Tyres & Service ✓
- `GET /api/garages?mine=1` → `{garages:[{org(+status), services(all w/ active), rating, stats:{openRequests,quoted,booked,completed,pendingBookings}, subscription}]}`
  - Real output: Premium Motors Garage | services: 4 | stats {openRequests:1, quoted:1…} | sub garage-basic; Mombasa Road Tyres & Service | 2 services | rating 5 (1)
- `GET /api/service-requests?mine=1` → exact account contract incl. `quotes[{id,amountMinor,leadDays,message,status,org{name}}]`, `booking{status,scheduledAt}|null` (plus harmless extras vehicleDesc/town/configId)
- `GET /api/service-requests?org=1[&orgId=]` → `{org, orgs, requests:[{id,refCode,category,vehicleDesc,description,county,town,status,configId,createdAt,customer{name},myQuote|null}]}` — eligible (OPEN/QUOTING ∧ category in active services) ∪ own-quoted (any status); **tenant isolation verified**: Premium feed shows only SRQ-2LM8VX, never Mombasa's quotes/amounts
- `POST /api/quotes` → 201 create; re-POST → 200 **same quote id updated** (PENDING restore); 409 ACCEPTED; 409 category-not-offered; 400 ORG_REQUIRED when ambiguous multi-org (dashboard always sends orgId)
- `PATCH /api/quotes/[id] {action:'accept'}` → quote ACCEPTED + Booking CONFIRMED + request BOOKED + other PENDING→EXPIRED + garage notified + audit; `decline` → DECLINED, request back to OPEN when no PENDING remain
- `GET/PATCH /api/bookings` — org view includes customer name+phone (justified by booking); transitions validated: start on IN_PROGRESS → **409 INVALID_STATE** ✓; schedule sets scheduledAt; complete → request COMPLETED + "leave a review" notification; cancel (either party) → booking+request CANCELLED + both sides notified + audit
- `POST /api/reviews` → 403 NOT_EARNED without COMPLETED booking (verified w/ garage user); upsert (same review id updated, author first name "Amina"); `GET ?orgId=` → `{reviews[{rating,comment,createdAt,author{name}}], summary{avg,count}}`
- `POST /api/roadside` → 201 `{request, disclaimer}` (REQUESTED, RSA-…); PATCH accept → 403 for garages without active TOWING/ROADSIDE (honest gate) then ACCEPTED w/ provider org+phone visible to requester; complete by requester ✓; `?providers=1` → ACTIVE garages w/ TOWING/ROADSIDE services
- Validation: description <15 chars → 400 w/ zod issue path; invalid `configId` → 400 "This 3D configuration link is no longer valid."; unauth `?mine=1` → 401

## Seed-state changes made through my own API (legit CRUD, for demo realism)

1. Added service "24/7 roadside assistance & towing" (ROADSIDE, from KES 3,500) to **Mombasa Road Tyres & Service** via `POST /api/garage-services` — without it no seeded org could accept roadside requests or appear in the providers directory (the accept gate correctly returned 403 before this).
2. Updated that org's description to mention roadside assistance (PATCH /api/garages).
3. Test data created & left in DB (real, honest state): SRQ-GNLPEF (TYRES, completed w/ booking + 5★ review), SRQ-FN235T (ELECTRICAL, cancelled booking), RSA-UJXEKY (FLAT_TYRE, completed), quote on SRQ-2LM8VX updated to KES 95,000 / 4-day lead (still PENDING).

## Issues hit / notes for other agents

- **D (billing), fixed by them during my run**: `src/app/api/billing/invoices/[id]/mark-paid/route.ts` imported `../../_activate` (wrong depth → global Turbopack compile failure, ALL routes 500 for ~3 min incl. `/api/health`). They corrected to `../../../_activate`; server recovered.
- **Pre-existing TS errors NOT from this module** (do not affect dev runtime): `prisma/seed.ts` local `type Seed` lacks `town?: string` (rows 232/240 pass `town`); `examples/websocket/*` missing socket.io deps. `src/app/api/vehicles/route.ts` had a syntax error earlier (another agent fixed it).
- `@/components/ai/garage-assistant` **still does not exist** (AI agent's file). `#/garages` will fail client-chunk compile until they land it; contract used: `<GarageAssistant onSelect={(category: string) => …} />`. Per instructions I did NOT create it.
- `RoadsideRequest.providerOrgId` has **no Prisma relation** — provider org resolved with a second query in GET (mine) and PATCH (notify). Schema untouched.
- Rate limits implemented as specified: service-requests 10/hr/user, quotes 30/hr/user, roadside 5/hr/user (keyed `getIp`+userId); in-memory (resets on restart, documented in lib).
- No GPS/dispatch/ETA language anywhere; all copy states honest statuses ("waiting for a provider to accept", "response depends on their availability", 999/112 escalation).

## Self-check results

- `bunx eslint` on all owned paths → **0 errors, 0 warnings** (react-hooks/set-state-in-effect violations fixed via stale-aware `loadedFor` fetch pattern; no sync setState in effect bodies).
- `tsc --noEmit` → only pre-existing errors in `prisma/seed.ts` + `examples/` (none in my files).
- dev.log → my routes: no errors after the two fixed import bugs (quotes route `audit` import, quotes/[id] missing `requireUser` — both mine, both fixed early).
