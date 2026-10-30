# Task 4-c — Loyalty & Referrals (referral attribution, points ledger, award hooks, Rewards tab)

Agent: C (Task ID 4-c). Status: COMPLETE. Fully E2E-verified, DB restored to seeded state afterwards.

## Files changed/created (all within ownership)
- `src/app/api/loyalty/summary/route.ts` (NEW) — GET loyalty summary
- `src/app/api/auth/register/route.ts` — added optional `ref` + attribution (`attributeReferral`, `findReferrer`)
- `src/app/api/reviews/route.ts` — +100 award in POST create path only
- `src/app/api/bookings/route.ts` — +250 award in PATCH `complete` case
- `src/components/loyalty/rewards-panel.tsx` (NEW) — customer Rewards panel
- `src/views/account/index.tsx` — "Rewards" tab (TABS const, TabsTrigger w/ Gift icon, TabsContent after Searches)
- `src/views/auth/index.tsx` — `?ref=` from hash query → register payload + dismissible hint

## API contracts
### GET /api/loyalty/summary (requireUser → 401 if anon)
```json
{
  "points": 350,
  "referralCode": "K62P9SNF",
  "referralCount": 1,
  "referralsAvailable": 49,
  "entries": [{ "id","points","reason","refType","refId","note","createdAt" }],  // last 50 desc
  "rules": [ {title, detail, points} × 3: Invite 500 / Review 100 / Service 250 ],
  "finePrint": "Points have no cash value. Points cannot be bought. CARMAZE may adjust rules with notice."
}
```
- Lazily mints an 8-char referralCode (`shareId(8)`, A–Z minus I/O + 2–9) with 5-retry unique-collision loop.
- `referralsAvailable` = 50 − REFERRAL_SIGNUP ledger count (clamped ≥0) — honest cap surfaced for UI.

### POST /api/auth/register
- Schema + `ref: z.string().trim().min(1).max(32).optional()`. Response shape unchanged (additive only).

## Award hooks (file + behaviour)
| Hook | Location | Trigger | Points |
|---|---|---|---|
| Referral | register `attributeReferral()` after `user.create`, before session | new signup w/ `ref` | referrer +500 REFERRAL_SIGNUP (refType USER, refId newUserId) + LOYALTY_POINTS notification "You earned 500 points — a friend joined CARMAZE" (link `/account?tab=rewards`) |
| Review | reviews POST, `if (!existing)` block | first publication only (updates never re-award) | author +100 REVIEW_EARNED (ORG_REVIEW, reviewId) |
| Service | bookings PATCH case `'complete'` | IN_PROGRESS → COMPLETED transition | customer +250 SERVICE_COMPLETED (BOOKING, bookingId) |

**Duplicate-award protection:** every award is preceded by `loyaltyLedger.findFirst({ userId, reason, refId })` — skip if present. Referral additionally: `ledger.count({ userId, reason:'REFERRAL_SIGNUP' }) >= 50` → skip (cap), and referrer must be ACTIVE + email ≠ new user (self-referral). All three hooks wrapped in try/catch → points failure NEVER fails the parent operation (review/booking/register). Referral update+ledger are inside one `db.$transaction`.

**Case-insensitive ref lookup (SQLite):** exact `findFirst` first, then `contains` fallback (LIKE is CI for ASCII) with post-verification `candidate.referralCode.toUpperCase() === code` — no partial-match false positives. Verified: `k62p9snf` matched `K62P9SNF`; `NOT-A-CODE` ignored silently, registration still 200.

## UI
- **Rewards tab** (account view, between Searches & Vehicle protection, exact existing trigger pattern): deep-green `#315E4B` hero card w/ gold `#D9B878` CountUp balance + Gift icon + "Friends who joined" counter; "How to earn" rules (icon/title/detail/+pts Badge) from API + fine print; referral card (mono code, 44px "Copy link" button → clipboard + sonner toast, full `origin/#/signin?ref=CODE` link shown, honest count copy + "N of 50 referral bonuses remaining"); ledger history `max-h-96 overflow-y-auto scrollbar-thin` (+green/−red tabular points, reason label via REASON_META, `timeAgo`), honest empty state; skeleton loading; error card with retry (remount via key — avoids setState-in-effect lint error). No blue/indigo.
- **Auth view**: `ref` captured from hash query (`route.query.get('ref')`, same pattern as `mode`), sent as `ref` in register payload only; gold-tinted dismissible hint "Joining with a referral from a friend" (X button, 44px touch target on mobile). Sign-in flow untouched; no changes to stores/auth or auth/me needed (panel is fully summary-driven).

## Verification (curl E2E on temp instance, then DB restored)
- register A → summary → code minted `K62P9SNF`, points 0, cap 50. Register B w/ lowercase ref → A: points 500, entries 1, referralCount 1, available 49, notification delivered (unread 1). Garbage ref → no award. Unauth summary → 401.
- Seeded flow: customer accepted seed quote → booking schedule→start→complete → customer +250 (note "Service completed — Premium Motors Garage"); review POST → +100 (350 total); identical POST (update path) → still 350, 2 entries — no double-award.
- Cleanup: reftest users + all ledger/review/booking/quote/status/notification artifacts removed; `loyaltyLedger` rows back to 0.

## Blockers / notes for integrators
- I briefly ran a temp `next dev -p 3100` for E2E (main server was down); **it held `.next/dev/lock` and blocked the auto server on 3000** — I killed it and port 3000 recovered (`GET / 200`, `/api/loyalty/summary` → 401 compiled+answered on it). Do NOT run a second next dev instance alongside the auto server.
- Views wiring outside my ownership NOT done (per ownership): signin?ref → account Rewards deep-link already works via notification link `/account?tab=rewards` (TABS includes 'rewards').
- Pre-existing lint warnings in `src/components/brand/logo.tsx` (unused eslint-disable) — not mine, left untouched. My files: 0 lint errors.
- If a nav/home "Rewards" entry point is wanted, `navigate('account?tab=rewards')` (or `#/account?tab=rewards`) is the canonical deep link.
