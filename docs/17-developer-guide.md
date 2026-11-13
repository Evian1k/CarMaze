# PART 19 — HOW TO MAINTAIN AND EXTEND CARMAZE (DEVELOPER GUIDE)

Real examples from this codebase. Read [03-project-structure.md](03-project-structure.md) first for the map; this file is the "how".

## 19.1 Daily workflow

```bash
bun install                # after pulling dependency changes
bun run db:deploy          # after pulling schema changes (prisma migrate deploy — versioned migrations)
bun run dev                # http://localhost:3000 (logs: dev.log)
bun run lint               # before every commit
bunx tsc --noEmit          # optional strict type check (build ignores TS errors)
bun verification/security-tests.ts   # RBAC/security suite against the running dev server
```

Sign in with demo accounts from the sign-in page for role testing; the admin demo tab can reset the whole sandbox (`POST /api/admin/demo-accounts/reset`, phrase `RESET_DEMO_DATA`).

## 19.2 Making a database change

1. Edit `prisma/schema.prisma` (keep conventions: `Minor` money, String enums + comment, JSON-as-String, event tables).
2. `bun run db:generate && bun run db:migrate` (author the migration with `prisma migrate dev`; **back up `db/custom.db` first**). Production applies it with `bun run db:deploy`. `db:push` remains DEV-ONLY.
3. Grep for literal status strings you introduced/renamed across `src/` (SQLite has no enum guard): `rg "PENDING_REVIEW" src/`.
4. If you added a workflow state, extend the matching `*Event` writes and the UI badge maps (e.g. `VEHICLE_STATUS_LABELS` in `src/lib/format.ts`).

Example — adding a "vehicle.inspection" flag:
```prisma
model Vehicle { … inspectedAt DateTime? }
```
then `bun run db:migrate` (migration), then surface it in `GET /api/admin/listings` and the listings table UI.

## 19.3 Adding a new API endpoint

Template (copy any existing route, e.g. `src/app/api/saved-vehicles/route.ts`):

```ts
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, requireUser, ok, parseBody, ApiError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { notify } from '@/lib/notify'

const bodySchema = z.object({ /* … */ })

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()                 // 401 gate
  const input = await parseBody(req, bodySchema)   // 400 gate
  // tenant check: db.orgMember / ownership / requireRole(...) / demo guard
  const row = await db.x.create({ data: { … } })
  await audit({ actorId: user.id, actorName: user.name, action: 'X_CREATED', targetType: 'X', targetId: row.id })
  await notify({ userId: target.id, type: 'X_CREATED', title: '…', link: '/#/route' })
  return ok({ row })
})
```

Rules: always `route()`; always zod; always scope queries by the caller; stable error codes (`ApiError(409, 'ALREADY_X', …)`); rate-limit public writes (`rateLimit(key, n, ms)`); never set paid/verified/active states outside their designated paths.

## 19.4 Adding a frontend page / view

1. Create `src/views/my-feature/index.tsx` (`'use client'`).
2. Register it in `page.tsx`: `'my-feature': dynamic(() => import('@/views/my-feature'), { ssr: false, loading })`.
3. If role-gated, add to `VIEW_GUARDS` in `src/lib/view-guard.ts` (UX only — enforce server-side too).
4. Add navigation where appropriate: `NAV` in `src/components/layout/app-shell.tsx`, the command palette, and (mobile) tabbar — keep the palette/menu consistency noted in Part 20.
5. Fetch with `apiGet/apiSend` (`src/lib/client.ts`); toasts via `sonner`; skeletons for loading; explicit error + empty states.

## 19.5 Adding a dashboard feature (DealerOS/GarageOS/Admin)

Dashboards are tab-keyed views: `#/dealer?tab=inventory`. Add a tab key to the view's tab list + role filter, render your component, and deep-link with `navigate('dealer?tab=inventory')`. Follow the existing patterns: StatCards for counts, tables on desktop/cards on mobile, AlertDialogs for destructive actions, `?order=<id>`-style deep links for notifications.

## 19.6 Adding a new role

1. Add the constant to `ROLE` in `src/lib/auth.ts` (CSV storage needs no migration).
2. Decide staff vs business: if staff, add to `STAFF_ROLES` and to the admin tab-role map (`TAB_ROLES` in `src/views/admin/index.tsx`) + endpoint guards.
3. Create the grant path (application approval / invitation) — **never** a self-service role field.
4. Add view guards + UI conditions; extend `dashboardFor()` for the access-denied "way back".
5. Extend `verification/security-tests.ts` with deny cases (other roles must get 403).

## 19.7 Adding permissions to an existing role

Two places: `requireRole(...)` calls at endpoints (platform roles) and the `roleCan` matrix in `src/lib/supply.ts` (supply actions) / local membership-role checks (e.g. `requireGarageAdmin`). Change the server first; mirror the change in the UI's permission mirrors (they are courtesies, not the boundary).

## 19.8 Adding a payment integration

- Model it after `src/lib/mpesa.ts`: a config reader that **throws** when env is missing, `providerConfigured()`, an initiate function, a callback parser.
- Add a webhook route that: verifies a signature (fail-closed in production), matches your attempt/authorization record, is idempotent, validates amounts, then calls `activatePaidInvoice(...)` or the equivalent single activation path. Never mark money states from the initiate response.
- Register the provider in `PaymentAttempt.provider` / `PaymentAuthorization.provider` value sets and the admin ops/revenue views.

## 19.9 Adding an AI feature

Copy `src/app/api/ai/listing-assistant/route.ts`: dynamic SDK import → strict system prompt (anti-hallucination) → `extractJson` → **validate/whitelist every field** before touching the DB → `AiUsage` logging on success/failure → 503 on provider failure → rate limit. UI: `src/components/ai/*` with the shared `AiDisclaimer`/`AiPanel`.

## 19.10 Debugging errors

1. `dev.log` — `console.error('[api]', e)` prints full stacks; route name in the fetch URL.
2. Browser: network tab for `{error: CODE, message}` — codes are stable and greppable: `rg "CODE" src/`.
3. State machines: find the action handler (e.g. `rg "INVALID_TRANSITION" src/app/api`) to see allowed from-states.
4. Data: `bunx prisma studio` for a GUI over SQLite.
5. Blank screen: `page.tsx` BootScreen/error boundary; check `dev.log` for hydration/chunk errors (the boundary auto-reloads once on chunk failures).

## 19.11 Deploying changes

```bash
bun run lint && bunx tsc --noEmit     # gates
bun run build                          # standalone build
bun run start                          # serve :3000 (logs → server.log)
```
With schema changes: back up `db/custom.db` → `bun run db:migrate` → then build/start. Production DBs only ever receive `bun run db:deploy`. Set production env (`AUTH_SECRET`, MPESA_*) and ensure `MPESA_CALLBACK_URL` is reachable.

## 19.12 Rolling back a failed deployment

1. Restart the previous standalone build directory (they are self-contained).
2. If the DB was pushed: restore the `db/custom.db` backup taken before the push (schema-forward changes usually tolerate old builds; schema-backward changes require the backup).
3. Rotate `AUTH_SECRET` only if compromise is suspected (invalidates all sessions — that is the point).
