# PART 3 — COMPLETE PROJECT STRUCTURE

Verified tree (node_modules/.next omitted). After the tree: what each area controls, and how to change a feature safely.

```
/home/z/my-project
├── package.json                  # scripts (dev/build/start/lint/db:*/seed), dependencies
├── next.config.ts                # output:"standalone", allowedDevOrigins, ignoreBuildErrors
├── tsconfig.json                 # strict TS, "@/*" → src/*, bundler resolution
├── tailwind.config.ts            # darkMode:"class", shadcn HSL variable theme
├── components.json               # shadcn "new-york" config
├── eslint.config.mjs             # eslint-config-next (relaxed TS rules)
├── postcss.config.mjs            # @tailwindcss/postcss (Tailwind v4)
├── Caddyfile                     # :81 → :3000; ?XTransformPort= → local port proxy
├── bun.lock
├── .env                          # DATABASE_URL only (secrets not committed)
│
├── prisma/
│   ├── schema.prisma             # 99 models — the single source of database truth
│   ├── seed.ts                   # full demo world (22 users, 8 orgs, 12 vehicles, …)
│   └── seed-supply.ts            # supply network seed (categories, products, stock, POs)
│   (no migrations/ folder — db push workflow)
│
├── db/
│   └── custom.db                 # SQLite database file (~1.6 MB)
│
├── data/
│   └── uploads/                  # served by /api/files & /api/media (seed-provisioned)
│       └── media/                # public media files (hash-named)
│
├── public/                       # brand assets, images (12 car photos), video/intro.mp4,
│   │                             # manifest.webmanifest, robots.txt, icons, logo.svg
├── docs/                         # THIS documentation suite
├── upload/                       # founder's original briefs (product source of truth)
│
├── scripts/
│   ├── start-dev-daemon.py       # daemonised `bun run dev` (survives session reaping)
│   ├── gen-intro-video.ts        # one-shot AI video generation for public/video/intro.mp4
│   ├── make-brand-transparent.py # emblem extraction (PIL)
│   └── build-brand.ts            # sharp pipeline → all logo/icon sizes + OG card
│
├── verification/
│   └── security-tests.ts         # live RBAC/security suite (15 sections)
│
├── tests/                        # sandbox deploy-pipeline shell tests (not product tests)
├── examples/websocket/           # Socket.IO chat demo (server.ts :3003 + frontend.tsx) — reference only
├── agent-ctx/                    # historical sub-agent working notes (not product code)
├── download/                     # static export notes
│
└── src/
    ├── app/
    │   ├── layout.tsx            # root layout: ThemeProvider, Toaster, metadata
    │   ├── page.tsx              # THE single page: view registry + guards + AppShell
    │   ├── error.tsx / global-error.tsx
    │   ├── globals.css           # Tailwind v4 + shadcn variables + brand theme
    │   └── api/                  # ← ALL backend endpoints (see breakdown below)
    │
    ├── views/                    # 27 SPA views, one folder per hash route
    │   ├── home/ marketplace/ vehicle-detail/ sell/ seller-dashboard/
    │   ├── showrooms/ org-storefront/ dealer/ garages/ garage-dashboard/
    │   ├── supply/ supplier/ procurement/ logistics/
    │   ├── my-garage/ account/ auth/ admin/ (+ admin/demo-tab.tsx)
    │   ├── memberships/ roadside/ partners/ platforms/ community/
    │   ├── customizer/ static/ not-found/ access-denied/
    │
    ├── components/
    │   ├── ui/                   # 39 shadcn/ui primitives (button, dialog, table…)
    │   ├── layout/               # app-shell, mobile-tabbar, command-palette, intro,
    │   │                         # demo-banner, boot-screen, error-boundary, theme-*
    │   ├── storefront/           # org storefront parts, dialogs, handover-dialog, settings
    │   ├── messaging/            # conversation-panel (MessagesTab, unread hook)
    │   ├── protection/           # vehicle-protection, customer-test-drives
    │   ├── branches/             # branch-manager (+ TransfersPanel export, currently unused)
    │   ├── biz/                  # memberships-manager, trust-credit-manager
    │   ├── billing/              # promotions-section (campaigns + M-Pesa)
    │   ├── account/              # subscriptions-panel, customer-orders
    │   ├── supplier/             # SupplierOS tabs (gate, products, orders, warehouses…)
    │   ├── supply/               # public supply UI (catalogue, fitment-finder, product-detail…)
    │   ├── procurement/          # garage procurement (cart, order lifecycle, approvals…)
    │   ├── admin/                # verification-center, revenue-dashboard, supply-console
    │   ├── seller/               # verification-panel (SELLER KYC)
    │   ├── ai/                   # car-finder, listing-assistant, garage-assistant, shared
    │   ├── marketplace/          # vehicle-card
    │   ├── auth/                 # demo-accounts section
    │   ├── customizer/           # presets + car-scene (three.js)
    │   ├── brand/ motion/ partners/ loyalty/   # logo, animation primitives, dialogs, rewards
    │
    ├── lib/                      # server+client shared logic (see 3.2)
    ├── hooks/                    # use-hash-route, use-mobile, use-toast (unused)
    └── stores/                   # zustand: auth.ts, cart.ts
```

## 3.1 API routes by module (`src/app/api/`)

| Folder | Controls |
|---|---|
| `auth/` | register, login, logout, me, profile, forgot/reset password, verify-email, verify-phone, mfa/*, demo |
| `vehicles/` | listing CRUD + submit + view counting; `home/` homepage feed |
| `enquiries/`, `offers/`, `test-drives/`, `saved-vehicles/`, `saved-searches/` | marketplace engagement |
| `dealers/`, `garages/`, `garage-services/` | public directories + garage services CRUD |
| `service-requests/`, `quotes/`, `bookings/` | garage lead → quote → booking pipeline |
| `custody/` | vehicle handover lifecycle + `collection-auth` + `collect` |
| `incidents/` | security incidents (stolen vehicles, custody damage…) |
| `documents/` | verification document queue/state machine |
| `conversations/` | unified customer⇄business messaging |
| `notifications/`, `support/`, `reports/` | notifications, tickets, content reports |
| `applications/` (+ `sweep/`) | business onboarding + SLA follow-up engine |
| `orgs/` | dealer staff mgmt, storefront payload/edits, profile, me |
| `org/` | trust programme, credit ledger, transfers, business memberships |
| `billing/` | plans, subscribe, invoices (+ mark-paid/refund), M-Pesa STK/callback, `_activate.ts` |
| `memberships/`, `account/` | customer memberships + subscriptions dashboard |
| `supply/` | supplier/garage B2B: products, branches, inventory, orders (+ action/pay), quotes, fitment, catalogue, categories, alerts, reviews, saved, payments/webhook |
| `suppliers/` | public supplier directory + supplier application |
| `orders/`, `buying-requests/` | consumer parts orders; dealer sourcing board |
| `logistics/` | delivery jobs + fleet/drivers |
| `partners/` | partner directory, apply, referral requests |
| `community/` | posts, comments, votes, reactions |
| `campaigns/` | listing promotions (create/cancel; activation via billing) |
| `loyalty/`, `roadside/`, `customizer/`, `settings/`, `media/`, `files/`, `health/`, `ai/`, `security/` | loyalty ledger, roadside, 3D configs, site settings, file serving, health, AI features, access-denied telemetry |
| `dealer/` | dashboard + copilot (rule-based insights) |
| `admin/` | overview, users, staff, listings, applications(sweep), supply console, logistics, campaigns, partners, tickets, ops, broadcast, settings, audit, revenue, fees, demo-accounts(+reset) |

## 3.2 The `src/lib/` kernel (what to touch and what not to)

| File | Role | Change risk |
|---|---|---|
| `db.ts` | Prisma singleton | never change |
| `auth.ts` | session create/verify, ROLE map, `getSessionUser`, `hasRole` | **critical** — all auth depends on it |
| `api.ts` | `route()` wrapper, guards, error mapping | **critical** — every endpoint depends on it |
| `request-context.ts` | AsyncLocalStorage session memo + `isActorDemo()` | **critical** |
| `demo.ts` | demo sandbox guards | touches security |
| `orgs.ts` | `getMembership`, `notifyOrgMembers`, inbox links | tenancy kernel |
| `supply.ts` | org tenancy + `roleCan` permission matrix, fees, stock ops | supply-module kernel |
| `notify.ts` | in-app notifications (+ honest EMAIL/SMS failure rows) | notification fabric |
| `audit.ts` | audit-log writer (never throws) | compliance trail |
| `mpesa.ts`, `webhook-auth.ts` | Daraja client, webhook signature verification | money path |
| `rate-limit.ts` | in-memory sliding-window limiter | abuse control |
| `ids.ts` | refCode/shareId/sixDigitCode generators | used everywhere |
| `json.ts`, `format.ts`, `utils.ts`, `safe-storage.ts`, `client.ts` | parseJson; money/date/county constants; cn; guarded storage; fetch + hash router helpers | low risk |
| `storefront.ts` | public storefront payload builder | public surface |
| `partners.ts` | partner categories/status helpers | low risk |
| `totp.ts` | MFA implementation | security-sensitive |
| `view-guard.ts` | frontend-only view gating (explicitly NOT the security boundary) | UX only |

## 3.3 Which files control which parts of the website

| Part of the site | Primary files |
|---|---|
| Route table & view gating | `src/app/page.tsx`, `src/lib/view-guard.ts`, `src/hooks/use-hash-route.ts`, `src/lib/client.ts` |
| Header/footer/nav/mobile tabbar/command palette | `src/components/layout/app-shell.tsx`, `mobile-tabbar.tsx`, `command-palette.tsx` |
| Sign-in / registration / MFA / demo catalog | `src/views/auth/index.tsx`, `src/components/auth/demo-accounts.tsx`, `src/app/api/auth/**` |
| Marketplace search UX | `src/views/marketplace/index.tsx`, `src/components/marketplace/vehicle-card.tsx` |
| Vehicle detail & engagement dialogs | `src/views/vehicle-detail/index.tsx`, `src/components/storefront/dialogs.tsx` |
| Selling & listing assistant | `src/views/sell/index.tsx`, `src/components/seller/verification-panel.tsx`, `src/components/ai/listing-assistant.tsx` |
| Seller dashboard | `src/views/seller-dashboard/index.tsx` |
| DealerOS tabs | `src/views/dealer/index.tsx` (+ `branches/branch-manager.tsx`, `biz/memberships-manager.tsx`, `billing/promotions-section.tsx`, `components/messaging`) |
| GarageOS tabs | `src/views/garage-dashboard/index.tsx` (+ storefront handover dialog) |
| Custody / protection cockpit | `src/components/protection/vehicle-protection.tsx`, `src/app/api/custody/**` |
| Supply storefront/catalogue | `src/views/supply/index.tsx`, `src/components/supply/**` |
| Supplier portal | `src/views/supplier/index.tsx`, `src/components/supplier/**` |
| Procurement | `src/views/procurement/index.tsx`, `src/components/procurement/**` |
| Logistics | `src/views/logistics/index.tsx` |
| My Garage + Vehicle Passport | `src/views/my-garage/index.tsx`, `src/app/api/mygarage/**` |
| Account (all tabs) | `src/views/account/index.tsx`, `src/components/account/**`, `src/components/protection/**`, `src/components/loyalty/rewards-panel.tsx` |
| Admin Control Center | `src/views/admin/index.tsx` + `src/views/admin/demo-tab.tsx`, `src/components/admin/**`, `src/app/api/admin/**` |
| 3D Customizer | `src/views/customizer/index.tsx`, `src/components/customizer/*` |
| Community | `src/views/community/index.tsx`, `src/app/api/community/**` |
| Public content (about/FAQ/terms/privacy/safety) | `src/views/static/index.tsx`, `src/app/api/settings/**` |

## 3.4 How to change a feature without breaking unrelated parts

1. **Locate the vertical slice**: view → components → API folder → models. Example: "garage custody" = `views/garage-dashboard` (custody tab) + `components/protection/vehicle-protection.tsx` + `api/custody/**` + models `VehicleCustody`, `CustodyEvent`, `RoadTest`, `CollectionAuthorisation`.
2. **Change the API contract first** (zod schema + response shape), keep error codes stable (`{error: CODE}`), then update the view's TypeScript types (they mirror API payloads by hand, e.g. `components/storefront/types.ts`).
3. **Respect the kernels**: never bypass `route()`, `requireUser/requireRole`, `getMembership/requireOrgMember`; never write "paid/verified/active" states outside the designated transitions (e.g. activation only via `_activate.ts`).
4. **Schema changes**: edit `prisma/schema.prisma` → `bun run db:push` (destructive! confirm first) → if you touched enums/status strings, grep for the literal strings across `src/`.
5. **Frontend-only rules**: keep role visibility logic in `view-guard.ts` + app-shell conditions, and remember it is UX, not security; keep all money math in minor units; use `parseJson` for JSON columns; use `sonner` toasts; respect `useReducedMotion` via `components/motion`.
6. **Demo safety**: if you add a feature touching user/org data, decide how the demo sandbox applies (`assertDemoResourceGuard` / `demoStaffMutationGuard`) and add a case to `verification/security-tests.ts`.
7. **Lint after every change**: `bun run lint` (the only automated gate).
