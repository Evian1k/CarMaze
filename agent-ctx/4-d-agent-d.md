# Task 4-d — Control Center upgrades (partners tab, broadcast, refunds, home hero)

Agent: D (Task ID **4-d**). Status: **COMPLETE** — all endpoints + UI built, curl-verified end-to-end, lint/tsc clean on owned files.

## Files

| Action | Path |
|---|---|
| DELETED | `src/app/api/route.ts` (hello-world leftover; `GET /api` now 404 — verified) |
| CREATED | `src/app/api/admin/broadcast/route.ts` (POST + GET) |
| CREATED | `src/app/api/billing/invoices/[id]/refund/route.ts` (POST) |
| CREATED | `src/app/api/settings/home-hero/route.ts` (public GET) |
| MODIFIED | `src/views/admin/index.tsx` (Partners tab, Broadcast UI, refund action, tab registry) |
| MODIFIED | `src/views/home/index.tsx` (hero copy from SystemSetting with exact fallback) |

Ownership respected — nothing else touched. Schema untouched, no db:push.

## API contracts (all verified by curl against the live dev server)

### POST /api/admin/broadcast — ADMIN/FOUNDER, rate limit 4/hour/user+IP
Body: `{ title: 4..120, body: 10..1000, audience: 'ALL'|'CUSTOMERS'|'DEALERS'|'GARAGES'|'STAFF', link?: string (must start with '/') }`
- 200 → `{ recipients, audience, channels: { inAppSent, emailDeliveries: 'queued'|'failed (not configured)', smsDeliveries: ... }, warning? }`
- 400 VALIDATION_ERROR with zod issues; 409 NO_RECIPIENTS; 429 RATE_LIMITED (verified: 4th-1 successful/attempted POSTs then 429 with retryAfterSec).
- **Recipient resolution** (ACTIVE users only, roles parsed from comma string, deduped):
  - ALL → every active user, hard cap 1000 (metadata records `capped`).
  - CUSTOMERS → has `CUSTOMER` and **no** business role (DEALER_OWNER/DEALER_STAFF/GARAGE_OWNER/GARAGE_STAFF) **and no** staff role (avoids double-delivery with the STAFF audience; SELLER still counts as customer).
  - DEALERS → DEALER_OWNER or DEALER_STAFF; GARAGES → GARAGE_OWNER/GARAGE_STAFF; STAFF → any of STAFF_ROLES.
  - Verified live: STAFF → 2 recipients; CUSTOMERS → 8 (dealer/garage/staff accounts correctly excluded).
- **Honest delivery semantics copied from `src/lib/notify.ts`**: one Notification per recipient (type `BROADCAST`) created in chunks of 50 inside transactions, each with nested deliveries: IN_APP `SENT`(1 attempt); EMAIL/SMS → `QUEUED` if SMTP_URL/SMS_API_KEY set else **`FAILED` with lastError "…provider not configured on this deployment"**. Never pretends a channel sent; response includes a `warning` to that effect when unconfigured.
- Audit `BROADCAST_SENT` (actor, title, audience, recipients, link, capped).

### GET /api/admin/broadcast — any staff
Last 20 `BROADCAST_SENT` audit rows parsed from metadata → `{ broadcasts: [{ id, actorName, createdAt, title, audience, recipients|null, link|null }] }` (corrupt metadata degrades to placeholders, never 500).

### POST /api/billing/invoices/[id]/refund — FINANCE/ADMIN/FOUNDER (mirrors mark-paid rigour)
Body: `{ reason: string min 10 max 500 }` (mandatory; 400 verified).
- 404 NOT_FOUND; 409 ALREADY_REFUNDED (verified); 409 INVALID_STATE if not PAID ("Only PAID invoices can be refunded — invoice X is PENDING").
- 200 → `{ invoice, subscriptionCancelled, campaignsEnded }`.

### Refund consequence cascade (all in one `db.$transaction`, verified live)
1. Invoice `status → REFUNDED`; **paidAt + paidVia kept** as payment history; reason lives ONLY in audit metadata.
2. `type === 'SUBSCRIPTION'` and org's Subscription is `ACTIVE` with `currentPeriodEnd > now` → status **CANCELLED** (money returned ⇒ entitlement ends). Verified: Westlands Motors sub CANCELLED, periodEnd preserved. (PAST_DUE/CANCELLED/expired subs left untouched.)
3. `type === 'CAMPAIGN'` → `updateMany` campaigns with `invoiceId = invoice.id AND status ACTIVE` → **ENDED** + `endsAt = now` (same as manual end). Verified: `campaignsEnded: 1`, campaign ENDED, that org's unrelated subscription untouched.
4. Audit `INVOICE_REFUNDED` with actor + `{ refCode, amountMinor, currency, type, reason, subscriptionCancelled, campaignsEnded }` (verified).
5. Org OWNER members notified in-app (`INVOICE_REFUNDED`, reason included, link `/dealer?tab=billing`) — verified body text.

### GET /api/settings/home-hero — public
Reads SystemSetting `home_hero`; shape-guards (`headline`+`subheadline` non-empty strings; trims; optional `ctaLabel`/`ctaHref`) → `{ hero: {…}|null }`. Corrupt JSON / wrong shape → `{hero:null}` (verified with a string value), never crashes the homepage. Writes go through the existing `PUT /api/admin/settings` (`home_hero` already whitelisted there — not my file, unchanged).

## Admin view (`src/views/admin/index.tsx`)

- **Partners tab** (`partners` between Campaigns and Support in TABS + nav): status chip group (pending/approved/suspended/rejected) with live counts from `GET /api/admin/partners`; scrollable table (name + BadgeCheck verified badge, refCode, category, county, status badge + rejectionReason preview, referrals, created, Review button); Review Dialog with every field (contact person, phone, email, website, WhatsApp, county, service areas, rating, referrals, timestamps, public description, rejection reason, internal notes rendered as {by, at, text} entries — handles both pre-parsed `notesList` and JSON-string `notes`); actions per state: Approve (AlertDialog confirm; PENDING/REJECTED), Reject (mandatory ≥10-char reason), Suspend (mandatory reason, APPROVED only), Reactivate (confirm, SUSPENDED only), Add internal note (staff-only text). PATCHes `/api/admin/partners/[id]` with `{action:'approve'|'reject'|'suspend'|'reactivate'|'note'}` per the other agent's contract. Toasts, loading skeletons, error retry, honest empty states; actions that move the partner out of the current filter auto-close the dialog via list refresh.
- **Billing tab**: PAID invoices get a "Record refund" button (Undo2 icon), visible only with FINANCE/ADMIN/FOUNDER (same `canFinance = hasAnyRole(user,'FINANCE','ADMIN','FOUNDER')` gate as mark-paid; API re-enforces). AlertDialog with consequences text per invoice type (SUBSCRIPTION → "ACTIVE subscription is CANCELLED immediately…", CAMPAIGN → "any ACTIVE campaign linked… ENDED immediately", LEAD_FEE → no entitlement change) + mandatory reason textarea (disabled <10 chars); success toast reports refund + cascade counts; non-finance users see an explanatory footnote.
- **Notifications tab**: new Broadcasts card — history list (title, audience, recipient count, sender, timeAgo, optional link; empty state when none) and, for ADMIN/FOUNDER, a composer Dialog (audience Select, title, message with char counter, optional in-app link) with a confirmation step showing the recipient-estimate text for the chosen audience + the honest EMAIL/SMS note; send → toast with actual count + warning toast when channels are unconfigured. Non-admin staff see an "admin only" badge instead of the button (GET history still visible to staff).
- Overview revenue chart: **verified, changed nothing** — `/api/admin/overview` counts `paid = status==='PAID'` and pending = PENDING/OVERDUE only, so REFUNDED invoices are excluded from both (refunded money is not revenue). Cross-checked API output vs direct DB recomputation with 2 refunded invoices: exact match (paid 1,280,000 minor / pending 0).

## Home hero (`src/views/home/index.tsx` + API)

Fetches `GET /api/settings/home-hero` on mount (initial state = built-in copy, so nothing flashes). When `hero` present: headline rendered with the same WordRise two-tone pattern (all words white except the last word in gold `#D9B878`, delays preserved: `0.12 + precedingWords*0.055`); subheadline swapped; optional CTA button (`ctaLabel`+`ctaHref`, gold accent style, ArrowRight) appears under the subheadline. When null → renders the EXACT original copy/markup ("Find your next car with confidence." etc.) — verified delay math is bit-identical for the default string. Hero design, parallax, image, animations untouched. `home_hero` was reset to null after testing so the site shows the default.

## Verification results (curl, live server on :3000)

- Broadcast: STAFF → 2 recipients; CUSTOMERS → 8; validation 400s (short title, external link); 429 after limit; audit history GET rows correct. ✅
- Refund: 400 short reason; SUBSCRIPTION refund → REFUNDED + sub CANCELLED + owner notified + audit with reason/actor; duplicate → 409 ALREADY_REFUNDED; CAMPAIGN refund → `campaignsEnded: 1`, campaign ENDED with endsAt. ✅
- home-hero: null default; configured value round-trips; corrupt value → null. ✅
- `GET /api` → 404 after deletion. ✅
- tsc --noEmit: no errors in owned files (only pre-existing `prisma/seed.ts` + `skills/` errors). `bunx eslint` on the 5 owned files: **0 problems**. dev.log: my routes all 200, no runtime errors.
- Note: full-project `bun run lint` reports 2 pre-existing errors in **another agent's** files (`src/components/partners/partner-dialogs.tsx` react-hooks/set-state-in-effect ×2, warning in `src/views/partners/index.tsx`) — not mine to fix.

## Real state left in DB (all created via legitimate API flows, honest & consistent)

- 2 audit-logged broadcasts (STAFF→2, CUSTOMERS→8) with their FAILED email/SMS delivery rows.
- INV-MN7X2W (SUBSCRIPTION) refunded via the new endpoint → Westlands Motors subscription CANCELLED; INV-TD4K8Z (CAMPAIGN) manually reconciled then refunded → campaign ENDED; owner notifications + INVOICE_REFUNDED audit rows.
- 1 internal note on partner PRT-Z7TLUL ("Directory listing details confirmed with the partner contact by phone.").
- `home_hero` setting exists but is `null` → default hero.

## Notes for other agents / blockers

- Partners admin API (4-c's contract) is live and matches spec; my UI additionally tolerates `serviceAreas` as array-or-string and `notes` as JSON string + `notesList`, and ignores the extra `counts.ALL` key — no coordination needed.
- Broadcast rate limiter counts *attempts* (incl. validation failures) — intentional, conservative. In-memory, resets on restart (same as existing lib).
- I briefly hit a dev-server outage mid-session (port 3000 lock contention during platform restart); the platform auto-restart recovered it — I did not modify dev scripts.
