# Task 4-b — Partner Network (Agent 4-b)

Status: **COMPLETE** (all endpoints + public view built, lint clean, curl + headless-browser verified end-to-end)

## Files created (no existing files modified; schema untouched)

Shared lib:
- `src/lib/partners.ts` — client-safe single source of truth: `PARTNER_CATEGORY_VALUES` (const tuple for zod), `PARTNER_CATEGORIES` [{value,label}], `partnerCategoryLabel()`, `parseServiceAreas()` (defensive JSON string[] parse), `parsePartnerNotes()` (defensive [{by,at,text}] parse), `appendPartnerNote()`, `whatsappLink()` (normalises 07xx→254).

API routes (all `export const dynamic = 'force-dynamic'`):
- `src/app/api/partners/route.ts` — GET public directory
- `src/app/api/partners/apply/route.ts` — POST public application (rate 5/h/IP)
- `src/app/api/partners/[id]/request/route.ts` — POST auth referral request (rate 20/h/user)
- `src/app/api/partners/requests/mine/route.ts` — GET auth "my requests"
- `src/app/api/admin/partners/route.ts` — GET staff list + status counts
- `src/app/api/admin/partners/[id]/route.ts` — PATCH staff moderation (5 actions)

Frontend:
- `src/views/partners/index.tsx` — public Partner Network page (`#/partners`, already registered in page.tsx + nav)
- `src/components/partners/partner-dialogs.tsx` — RequestServiceDialog + ApplyDialog (form state lives inside Radix DialogContent so every open starts clean — no setState-in-effect; lint rule `react-hooks/set-state-in-effect` enforced this)

## API contracts (all curl-verified)

### GET /api/partners (public)
Filters: `?category=` (exact enum), `?county=` (matches partner.county OR any parsed serviceAreas entry), `?q=` (case-insensitive substring on name/description; done in JS because Prisma+SQLite has no case-insensitive contains and serviceAreas is JSON). Lists ONLY `status=APPROVED && verified=true`. Sort: rating desc with nulls last, then name.
→ `{ partners: [{ id, refCode, name, category, county, serviceAreas: string[], description, logoUrl, coverUrl, phone, whatsapp, website, rating, referrals, createdAt }], categories: [{value,label}×7] }`
NEVER exposed publicly: notes, contactName, email, rejectionReason. (Tested: PENDING/REJECTED/SUSPENDED partners return 404 on request route and never appear in list.)

### POST /api/partners/apply (public, no auth needed; 429 after 5/h/IP)
Zod: `{ name≥2≤120, category enum, county ∈ KENYA_COUNTIES, serviceAreas?: string[](≤20), description 20..2000, contactName≥2≤80, phone≥9≤20, email?: email|'', website?: url|'' }`
→ 201 `{ refCode: "PRT-XXXXXX", message: "Application received. Every application is reviewed by the CARMAZE team, and a listing appears only after business verification is complete. No payment is charged for applying." }`
Creates Partner(status PENDING, verified false). Audit `PARTNER_APPLICATION`. Notifies all STAFF_ROLES users (`PARTNER_APPLICATION_REVIEW_REQUESTED`, link `/admin?tab=partners`). If applicant has an account, also notifies them (`PARTNER_APPLICATION_RECEIVED`). Zod issues come back as `{error:'VALIDATION_ERROR', issues:[{path,message}]}`.

### POST /api/partners/[id]/request (requireUser — any signed-in role)
Zod: `{ name≥2, phone≥9, county≥2, message 10..1000, email?: email|'' }`
- Partner must be APPROVED+verified else 404 `NOT_FOUND` ("not currently accepting requests") — no existence leak.
- `$transaction`: create PartnerRequest (refCode `PRQ-XXXXXX`) + increment partner.referrals.
- Audit `PARTNER_REQUEST` (targetType PARTNER, metadata {requestId, ref, partnerRef}).
- In-app Notification to requester `PARTNER_REQUEST_SENT` with the refCode.
→ 201 `{ refCode: "PRQ-XXXXXX" }`. Unauth → 401. 429 after 20/h/user.

### GET /api/partners/requests/mine (requireUser)
→ `{ requests: [{ id, refCode, name, phone, county, message, status, createdAt, partner: { id, name, refCode, category } }] }` newest first.

### GET /api/admin/partners?status= (requireRole(...STAFF_ROLES), rate 60/min)
`status` optional ∈ PENDING|APPROVED|SUSPENDED|REJECTED (invalid/absent = all). Newest first.
→ `{ partners: [<all Partner fields incl. contactName, email, notes, rejectionReason> + serviceAreas parsed string[] + notesList parsed [{by,at,text}]], counts: { PENDING, APPROVED, SUSPENDED, REJECTED, ALL } }` — counts are global (not affected by filter).

### PATCH /api/admin/partners/[id] (requireRole(...STAFF_ROLES))
Zod discriminated union on `action`:
- `{action:'approve'}` → status APPROVED, verified true, rejectionReason cleared. Audit `PARTNER_APPROVED`.
- `{action:'reject', reason 10..1000}` → status REJECTED, verified false, rejectionReason=reason. Audit `PARTNER_REJECTED`.
- `{action:'suspend', reason 10..1000}` → status SUSPENDED, **reason stored in `rejectionReason`** (chosen: single "status reason" field, documented; NOT appended to notes). Idempotent: re-suspend returns 200 with message "already suspended". Audit `PARTNER_SUSPENDED`.
- `{action:'reactivate'}` → only from SUSPENDED else 409 `INVALID_STATE`; → APPROVED, verified true, rejectionReason cleared. Audit `PARTNER_REACTIVATED`.
- `{action:'note', text 2..1000}` → appends `{by: staff.name, at: ISO, text}` to notes JSON array (read-modify-write inside `$transaction`). Audit `PARTNER_NOTED`. No notification.
All responses: `{ partner: {...all fields, serviceAreas parsed, notesList parsed} }`.
Partner-contact notifications: partners are businesses, not accounts — when a registered ACTIVE user's email matches partner.email, they get an honest in-app notification on approve/reject/suspend/reactivate (`PARTNER_APPROVED/REJECTED/SUSPENDED/REACTIVATED`); otherwise delivery is skipped (never faked).

## What the public page shows (#/partners)
1. Deep-green hero (`bg-primary text-primary-foreground`): "Verified businesses only" gold badge, H1 "CARMAZE Partner Network", subcopy listing the six categories + bold gold line "Only businesses that completed CARMAZE verification appear here.", CTA "Become a partner" (+ "My requests" scroll link when signed in), 3 trust points (Human verification / Direct introductions / Tracked referrals).
2. Sticky filter row (`sticky top-16` under the h-16 AppShell header, backdrop-blur): category chips from API response (All + 7), county Select (All counties + KENYA_COUNTIES), debounced (300 ms) search.
3. Grid `sm:grid-cols-2 lg:grid-cols-3` with Stagger/StaggerItem entrance + HoverLift cards: logo-or-initial avatar, name + gold BadgeCheck, refCode, county + "serves …" areas, category badge, Stars (`@/components/storefront/parts`) with numeric rating or "New partner" gold badge, line-clamped description, actions: Request service / Call (`tel:`) / WhatsApp (`wa.me`, 254-normalised) / Website (`rel="noopener noreferrer"`), honest footer line (referral count or "Verified by the CARMAZE team").
4. Empty states: filtered ("No partners match those filters" + Clear filters) and true-empty ("No verified partners yet") — both keep the apply CTA. Never invents partner data; skeletons while loading.
5. "Become a partner" section: benefits list + deep-green "How it works" panel (apply → human verification → live listing), "it's free" CTA.
6. My requests (signed in only): status badges (New/Contacted/Closed), partner + category, refCode, timeAgo, message; empty dashed state.
7. Dialogs: Request (prefilled from auth user; if signed out → toast + `navigate('signin')`; success screen shows PRQ ref; honest "your name and phone are shared with this partner" note) and Apply (all contract fields, gold honesty panel: human review / verification required / no fee; success screen shows PRT ref + returned message).

## Verification performed
- curl: GET filters (category/county/q), PENDING hidden, apply 201 + zod 400s, unauth 401s (admin GET, request POST), approve → appears publicly, note → notesList, reject short reason → 400, suspend → hidden from public + request 404, reactivate-from-non-suspended → 409, reactivate → APPROVED/reason cleared, request → 201 + referrals incremented (0→1) + `?mine=1` shows it, counts by status correct, audit trail (PARTNER_APPLICATION/APPROVED/NOTED/REQUEST) present, staff + requester notifications created.
- Headless browser (agent-browser): signed-out page render, apply dialog full submit (disabled until valid → PRT refCode screen), request-service while signed out → redirect to #/signin, signed-in request flow (prefill → send → PRQ screen → My requests row), category chip filter → empty state → clear, search filter → empty state → clear, desktop + mobile screenshots.
- Lint: **0 errors**. Remaining 2 warnings are pre-existing in `src/components/brand/logo.tsx` (not my file, left untouched).
- Test data cleaned up: both test partners deleted from DB (audit logs + notifications remain as honest history); partner table back to 0 rows awaiting lead-engineer seed.

## Notes for other agents
- Admin UI contract confirmed exactly as briefed: `GET /api/admin/partners?status=` and `PATCH /api/admin/partners/[id]` with `approve|reject|suspend|reactivate|note`. Suspend reason lives in `rejectionReason`; `notesList` is the parsed staff-note thread.
- Staff notifications for new applications link to `/admin?tab=partners`.
- `src/lib/partners.ts` is client-safe — reuse `PARTNER_CATEGORIES`/`partnerCategoryLabel` in the admin UI for consistent labels.
- No blockers. Dev server flapped once mid-testing (shared-port EADDRINUSE from concurrent starts, external to this task); all flows re-verified after it stabilised on port 3000.
