# Task 4-a — Org-facing Promotions/Campaign purchase flow (Agent A)

Status: **COMPLETE** — backend + shared UI + both dashboards wired, curl-verified end-to-end (purchase → invoice → payment → activation → real metrics → cancel), lint/type-check clean on owned files.

## Files created
| File | Purpose |
|---|---|
| `src/app/api/campaigns/route.ts` | `GET ?mine=1` org-scoped campaigns + active packages (+ opportunistic ACTIVE→ENDED expiry sweep); `POST` purchase promotion |
| `src/app/api/campaigns/[id]/cancel/route.ts` | `POST` cancel an unpaid promotion (campaign + pending invoice → CANCELLED in one transaction) |
| `src/components/billing/promotions-section.tsx` | `'use client'` reusable Promotions panel used by BOTH portals (purchase form, campaign list w/ recorded activity, M-Pesa STK dialog, cancel confirm) |

## Files modified
| File | Change |
|---|---|
| `src/app/api/vehicles/home/route.ts` | after selecting featured rows: single `updateMany` +1 `impressions` for every ACTIVE campaign on featured vehicles |
| `src/app/api/vehicles/[id]/view/route.ts` | after a counted view (not the dedupe short-circuit): `updateMany` +1 `clicks` for ACTIVE campaigns on that vehicle |
| `src/views/dealer/index.tsx` | import + `<PromotionsSection />` inside BillingTab (below Plans/Invoices) |
| `src/views/garage-dashboard/index.tsx` | import + `<PromotionsSection />` in the profile/billing TabsContent below the profile card |

## Not modified (verified instead)
- `src/app/api/billing/mpesa/stkpush/route.ts` — **already org-invoice-agnostic** (ownership = invoice owner OR member of invoiced org; no type restriction). Verified a CAMPAIGN invoice passes ownership and reaches the honest 501 `MPESA_NOT_CONFIGURED` (attempt recorded FAILED). No extension needed.
- `src/app/api/billing/_activate.ts` — conformed to, not touched: on invoice PAID it sets campaign ACTIVE with `startsAt=now`, `endsAt=now+package.days`, notifies org, audits `INVOICE_PAID`.

## API contract
### `GET /api/campaigns?mine=1` (auth, any org role — SALES/STAFF may view)
- `400 SCOPE_REQUIRED` without `?mine=1`; `403 NO_ORG_MEMBERSHIP` when caller has no org; `401` unauthenticated.
- `200 { campaigns: CampaignRow[], packages: PackageRow[] }`
  - `CampaignRow = { id, refCode, orgId, packageCode, status: PENDING_PAYMENT|ACTIVE|ENDED|CANCELLED, startsAt, endsAt, impressions, clicks, createdAt, vehicle: { id, refCode, title, status }, package: { code, name, days } | null, invoice: { id, refCode, status, amountMinor, currency, dueDate, paidAt } | null }`
  - `PackageRow = { code, name, days, priceMinor, currency, description }` (active only, ordered by price)
- Side effect: opportunistic sweep `ACTIVE ∧ endsAt < now → ENDED` (real data maintenance, same spirit as the viewEvent prune).

### `POST /api/campaigns` (auth; rate-limit 10/h per user+IP)
- Body `{ vehicleId: string, packageCode: string }` (zod).
- Errors: `401`, `429 RATE_LIMITED`, `403 ROLE_REQUIRED` (not OWNER/MANAGER of an ACTIVE DEALER/GARAGE org), `404 VEHICLE_NOT_FOUND`, `400 VEHICLE_NOT_YOURS`, `400 VEHICLE_NOT_PUBLISHED`, `404 PACKAGE_NOT_FOUND`, `409 CAMPAIGN_EXISTS` (one PENDING_PAYMENT/ACTIVE promotion per vehicle — double-payment guard).
- `201 { campaign: { id, refCode, status, packageCode }, invoice: { id, refCode, description, amountMinor, currency, status, dueDate } }`
- One transaction: Campaign `PENDING_PAYMENT` (ref `CMP-XXXXXX`, invoiceId linked) + Invoice `type: 'CAMPAIGN'`, `PENDING`, `amountMinor = package.priceMinor`, description `Promotion — <pkg name> for <make model year>`, `dueDate = now+3d`. Audit `CAMPAIGN_CREATED` + notifyOrgMembers "Promotion created — complete payment to activate" (link per org type).

### `POST /api/campaigns/[id]/cancel` (auth)
- `404 NOT_FOUND`, `403 FORBIDDEN` (not OWNER/MANAGER of that org), `409 INVALID_STATE` unless `PENDING_PAYMENT`.
- `200 { campaign: { id, refCode, status: 'CANCELLED' }, cancelledInvoice: string | null }` — linked invoice cancelled only while still PENDING (transaction). Audit `CAMPAIGN_CANCELLED` + notify org.

## Payment + activation end-to-end (verified live)
1. `POST /api/campaigns` → 201 (`CMP-842EA6` + `INV-QETC2V`, KES 3,000, due +3d) ✓
2. `POST /api/billing/mpesa/stkpush { invoiceId, phone }` → ownership OK for the org member; honest `501 MPESA_NOT_CONFIGURED` here (no Daraja creds; attempt recorded FAILED; **no simulated payments**) ✓
3. Alternative real path: FINANCE `POST /api/billing/invoices/[id]/mark-paid` → `activatePaidInvoice` set campaign `ACTIVE`, `activatedCampaign: 'CMP-9ZT3KD'` returned, org notified, audit trail written ✓
4. Metrics while ACTIVE: 2 homepage renders → impressions 0→2 (single updateMany); 2 deduped views of the promoted Prado → clicks 0→2; counters frozen once campaign no longer ACTIVE ✓
5. `POST /api/campaigns/[id]/cancel` → `CANCELLED` + invoice cancelled; second cancel → 409 ✓
6. Scoping: customer no-org → 403; DEALER_STAFF GET → 200 / POST → 403; GARAGE_OWNER buying a dealer's vehicle → 400 VEHICLE_NOT_YOURS; duplicate purchase → 409 ✓

## Deviations / notes
1. **Vehicles feed**: task suggested `GET /api/vehicles?org=1` ("the param the dealer inventory tab uses"). Inspection shows `?org=1` flows into the *public showroom* filter (`org.findUnique({ id: '1' })` — can never match a cuid) and always returns `[]`. I used `?mine=1` (what the seller dashboard actually uses for own+org listings, includes `status`) and filter `PUBLISHED` client-side.
2. **409 CAMPAIGN_EXISTS guard** added (not in spec): prevents paying twice for the same promoted slot.
3. **Expiry sweep** in GET (not in spec): keeps ENDED status honest without a cron; UI computes "days remaining" from `endsAt`.
4. **Garage portal reality**: garages never own PUBLISHED listings (`resolveOrgInput` only attaches vehicles to DEALER orgs), so there the panel shows the honest "no published listings to promote" empty state; packages + list still render. Matches the task's empty-state requirement.
5. **Vehicle select placeholder** uses shadcn `SelectValue` default (static label) — controlled Select, value resets after purchase.
6. Mid-verification the dev server flapped (platform supervisor; a parallel agent's admin-campaigns route also ended my ACTIVE test campaign — that agent owns that route, my data was restorable and checks re-ran fine). Server currently healthy on :3000; `GET /` 200; no compile errors from my files.
7. Lint: `bunx eslint` on all 7 owned files → **0 errors, 0 warnings** (project-wide `bun run lint` currently fails only inside `src/components/partners/*` + `src/views/partners/*` — parallel agent's files, not mine). `tsc --noEmit`: only pre-existing `examples/` + `skills/` errors.
