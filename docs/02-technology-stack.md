# PART 2 — HOW THE WEBSITE WAS BUILT (TECHNOLOGY STACK)

Every technology below was identified by reading `package.json`, config files and the actual source that uses it. For each: what it is, why it is used, where CARMAZE uses it, how it connects to the rest, what failure looks like, and its implementation status.

## 2.1 Stack summary table

| Layer | Technology | Version | Status |
|---|---|---|---|
| Frontend framework | **Next.js (App Router)** | `^16.1.1` | Fully implemented |
| UI library | **React** | `^19.0.0` | Fully implemented |
| Language | **TypeScript** | `^5` (`tsconfig` strict, `noImplicitAny:false`) | Fully implemented |
| Styling | **Tailwind CSS v4** + `tailwindcss-animate` | `^4` | Fully implemented |
| Component library | **shadcn/ui (new-york)** over Radix primitives | Radix ~1.x set | Fully implemented (39 files in `src/components/ui`) |
| Icons | lucide-react `^0.525.0` | — | Fully implemented |
| Animation | framer-motion `^12.23.2` | — | Fully implemented (motion primitives respect `useReducedMotion`) |
| 3D | three `^0.186.1` + @react-three/fiber + drei | — | Fully implemented (Customizer only) |
| Charts | recharts `^2.15.4` | — | Admin Overview + Revenue dashboard |
| Backend framework | **Next.js Route Handlers** (`src/app/api/**/route.ts`) | — | Fully implemented (154 route files) |
| ORM | **Prisma** `^6.11.1` + `@prisma/client` | — | Fully implemented |
| Database | **SQLite** (file `db/custom.db`, ~1.6 MB) via `DATABASE_URL` | — | Fully implemented |
| Auth | Custom **JWT session cookie** using `jose` HS256 + bcryptjs password hashing | — | Fully implemented (NextAuth v4 is installed but **unused**) |
| MFA | Custom **TOTP** implementation (`src/lib/totp.ts`, HMAC-SHA1, RFC 4648 base32, timing-safe compare) | — | Fully implemented |
| Validation | zod `^4.0.2` in every mutating endpoint (`parseBody`) | — | Fully implemented |
| State (client) | zustand `^5.0.6` (`src/stores/auth.ts`, `src/stores/cart.ts`) | — | Fully implemented |
| Server state | @tanstack/react-query installed; **the app primarily uses hand-rolled fetch hooks** (`useFetch`, polling `setInterval`) | — | Partially used |
| Forms | react-hook-form + @hookform/resolvers installed; most forms are hand-rolled controlled components | — | Partially used |
| Toasts | sonner `^2.0.6` (the shadcn `use-toast` hook exists but is unused) | — | Fully implemented |
| Markdown | react-markdown, @mdxeditor/editor | — | Installed (community/editor ready; light usage) |
| DnD | @dnd-kit/* | — | Installed (UI polish) |
| OTP input | input-otp `^1.4.2` | — | MFA + collection code entry |
| QR | qrcode `^1.5.4` | — | Client-side QR of delivery/collection tokens |
| Image processing | sharp `^0.34.3` | — | Brand asset pipeline scripts only (`scripts/build-brand.ts`) |
| AI | **z-ai-web-dev-sdk** `^0.0.18` (server-side only) | — | Implemented, 3 API features + intro video script |
| Payments | **Safaricom Daraja M-Pesa** via custom `src/lib/mpesa.ts` (no SDK) | — | Fully wired; **unverified without credentials** |
| Date/time | date-fns `^4.1.0`; storefront "open now" uses `Intl` with Africa/Nairobi | — | Fully implemented |
| PWA | `public/manifest.webmanifest` + icons + theme `#315E4B` | — | Implemented (no service worker) |
| Runtime | **Bun** (`bun run dev`, `bun prisma/seed.ts`, bun-types) | — | Fully implemented |
| Lint | ESLint 9 + eslint-config-next | — | `bun run lint` |
| Tests | `verification/security-tests.ts` (live RBAC/security suite); shell tests for the deploy pipeline (`tests/*.sh`) | — | Implemented; no unit-test framework |

## 2.2 Frontend framework — Next.js 16 App Router

- **What**: React meta-framework. CARMAZE uses the App Router with exactly **one page** (`src/app/page.tsx`) — a client-side SPA shell — plus `layout.tsx`, `error.tsx`, `global-error.tsx`.
- **Why**: the deployment target exposes a single route; hash routing (`#/cars`, `#/dealer?tab=billing`) gives shareable deep links while satisfying that constraint (`src/hooks/use-hash-route.ts`, `src/lib/client.ts`).
- **Where**: `VIEWS` map in `page.tsx` lazy-loads 27 views from `src/views/*` via `dynamic()` with `ssr:false`; `AppShell` (`src/components/layout/app-shell.tsx`) renders header/footer/mobile tabbar/command palette; `view-guard.tsx` renders an access-denied screen for role-gated views (UX only — the real boundary is server-side).
- **Failure mode**: a view chunk failing to load triggers `AppErrorBoundary`, which auto-reloads once for `ChunkLoadError` and otherwise shows a branded recovery panel. If the API layer is down, views show error states with Retry (they never render fake success).
- **Status**: fully implemented. `reactStrictMode: false` and `typescript.ignoreBuildErrors: true` are set in `next.config.ts` (type safety is advisory at build time).

## 2.3 Backend framework — Next.js Route Handlers

- **What**: every endpoint is a Route Handler in `src/app/api/**/route.ts`. There is **no separate backend service**.
- **Why**: single deployable; the SPA and API share TypeScript types and the Prisma client.
- **Where**: 154 route files, all wrapped by `route()` in `src/lib/api.ts` which provides: AsyncLocalStorage request context (`src/lib/request-context.ts`), uniform error mapping (`ApiError` → its status, `ZodError` → 400 `VALIDATION_ERROR`, unknown → 500 `INTERNAL_ERROR`), and guards (`requireUser`, `requireUserOptional`, `requireRole`).
- **Failure mode**: unhandled exceptions become JSON 500s, never HTML error pages; `console.error('[api]', e)` writes to `dev.log`.
- **Status**: fully implemented. Two callbacks (`/api/billing/mpesa/callback`, `/api/supply/payments/webhook`) intentionally bypass `route()` to answer Daraja in its own format.

## 2.4 Database — SQLite via Prisma

- **What**: single SQLite file `db/custom.db`; schema in `prisma/schema.prisma` (99 models). SQLite has no enums/arrays/JSON, so status fields are `String` and JSON columns are `String` parsed by `src/lib/json.ts` (`parseJson`).
- **Why**: zero-ops persistence suitable for the current pilot scale; trivially backed up by file copy.
- **Where**: `src/lib/db.ts` creates one `PrismaClient` (cached on `globalThis` in dev to survive hot reload).
- **Failure mode**: DB errors surface as 500 `INTERNAL_ERROR`; `/api/health` runs `SELECT 1` and reports `degraded`.
- **Status**: fully implemented. **Versioned migrations are the source of truth** (`prisma/migrations/`, applied with `bun run db:deploy` / `prisma migrate deploy`). `db:push` survives only as a DEV-ONLY convenience for the sandbox database and is never used in production (see docs/CARMAZE_FRESH_DATABASE_INIT.md).

## 2.5 Authentication & authorization

- **What**: custom system — no NextAuth usage despite the dependency being present.
  - Passwords: bcryptjs cost 10 (`src/lib/auth.ts`).
  - Session: HS256 JWT (`jose`) in httpOnly cookie `carmaze_session`, 7-day default, `AUTH_SECRET` env (a hardcoded dev fallback exists in `auth.ts` and `totp.ts` — must be removed before production).
  - Every request re-reads the `User` row; only `status === 'ACTIVE'` resolves a session → suspension kills access instantly even though the JWT is stateless.
  - MFA: TOTP enrolment/verify/disable flows (`/api/auth/mfa/*`), 5-minute scoped challenge JWT.
  - Authorization: layered — platform role (`requireRole`), org membership (`getMembership`, `requireOrgMember` with a role→action matrix in `src/lib/supply.ts`), resource ownership (`assertParticipant`, `canManageVehicle`, `ownedVehicle()`), and demo sandbox guards (`src/lib/demo.ts`).
- **Failure mode**: any missing/invalid cookie or non-ACTIVE user → 401; wrong role → 403 `FORBIDDEN`; wrong tenant → 403/404 (masquerade).
- **Status**: fully implemented and exercised by `verification/security-tests.ts`.

## 2.6 API architecture

REST-style JSON over the same origin. Patterns:

- **Naming**: plural resources (`/api/vehicles`, `/api/custody`), action endpoints for state machines (`/api/supply/orders/[id]/action`, `PATCH /api/custody/[id]` with discriminated `action` unions).
- **Validation**: zod schemas per endpoint; `parseBody` throws 400 with per-field issues.
- **Errors**: `{ error: CODE, message, data? }` with stable codes (`UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_TRANSITION`, `DEMO_SANDBOXED`, `MPESA_NOT_CONFIGURED`, `PLAN_LIMIT`, …).
- **Rate limiting**: in-memory sliding window (`src/lib/rate-limit.ts`) applied per route (e.g. login 10/15min, register 5/h, STK push 10/h, broadcast 4/h).
- **API index**: `GET /api` returns a service descriptor; `GET /api/health` reports DB + integration status.

## 2.7 File & image storage

- **Serving**: `GET /api/media/[name]` (public marketplace/storefront images, regex-validated names, immutable cache) and `GET /api/files/[name]` (private verification documents; owner-only or staff with access logging to `DocumentAccessLog`).
- **Writing**: **there is no upload endpoint.** `media/[name]`'s comment references `POST /api/upload`, and 12 frontend components (`sell` view, handover dialog, verification panel, staff/branch dialogs, incident evidence, POD photos…) call it — but no route writes files. All uploads in the current build fail with 404. Files under `data/uploads/` were provisioned by seeding (placeholder-size files). This is the platform's most important gap and is ranked #1 in Part 20.
- **Status**: GET/serving implemented; **upload write path not implemented**.

## 2.8 Search functionality

- Marketplace: server-side Prisma `contains` filters (make/model/q), enum filters, price/year/mileage ranges, sorts, pagination (`GET /api/vehicles`).
- Supply catalogue: `GET /api/supply/catalogue` with category tree, brand, condition, in-stock, sort, pagination; fitment engine `GET /api/supply/fitment` with MATCH/POSSIBLE/NO_FITMENT verdicts.
- SQLite limitations force JS-side filtering in several admin/community searches (documented in code comments: SQLite `contains` is case-sensitive; queries scan ≤500 rows).

## 2.9 Real-time communication

- **Polling only.** The app refreshes live data with `setInterval`: org inboxes 20s, open thread 8s, custody boards 15s, test drives 15s, M-Pesa status polling.
- A **Socket.IO demo** exists at `examples/websocket/` (server on port 3003, Caddy `XTransformPort` forwarding, React chat UI) but is **not wired into the product**. No production realtime (WebSocket) is implemented.
- Status: reference demo only.

## 2.10 Notification infrastructure

- **In-app only**, by design: `src/lib/notify.ts` creates a `Notification` + an IN_APP delivery row marked `SENT`, and always records EMAIL/SMS delivery rows as `FAILED` with reason "not implemented" (`EXTERNAL_CHANNELS_IMPLEMENTED = false`).
- The admin **broadcast** endpoint marks EMAIL/SMS `QUEUED` if `SMTP_URL`/`SMS_API_KEY` env vars are present — but **no queue consumer exists**, so those rows would never be delivered (a documented honesty inconsistency).
- Unread counts poll `GET /api/notifications?count=1`; the header bell fetches and marks read.

## 2.11 Background jobs & scheduled tasks

**None.** No cron, queue or worker process exists. Recurring behaviour is opportunistic, on-request:
- `POST /api/applications/sweep` — application SLA reminders/escalations; triggered manually from the admin Overview ("Run follow-up sweep"); 12h idempotency.
- Campaign expiry sweep on `GET /api/campaigns`; document lazy-expiry on the verification queue; subscription/membership lazy expiry on read.
- Rate-limit bucket cleanup when >5000 keys.

## 2.12 AI integrations

Three server-side features via `z-ai-web-dev-sdk` (backend-only): AI Car Finder (natural language → whitelisted search filters → real listing query), Listing Assistant (facts → description draft), Garage Assistant (symptoms → guidance + service categories). All log to `AiUsage`, degrade to `503 AI_UNAVAILABLE`, and never invent data. A fourth script (`scripts/gen-intro-video.ts`) generated the intro video once. Details: [11-ai-and-automation.md](11-ai-and-automation.md). "Dealer Copilot" insights (`GET /api/dealer/copilot`) are **rule-based** computations, not LLM calls.

## 2.13 Payment integrations

**Safaricom Daraja M-Pesa** (Lipa na M-Pesa Online / STK push), custom client in `src/lib/mpesa.ts`:
- Required env: `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL`; optional `MPESA_ENV` (sandbox default) and `MPESA_BASE_URL`.
- Two webhook endpoints (`/api/billing/mpesa/callback`, `/api/supply/payments/webhook`) verify a shared-secret signature header (`x-carmaze-signature`, `MPESA_WEBHOOK_SECRET`) with timing-safe compare and **fail closed in production**; callbacks are idempotent and amount-checked.
- Status: fully wired and honestly guarded; **unverified against the live API** (no credentials in this environment). Anything marking money as paid must pass `activatePaidInvoice` — there is no path from a frontend response to "paid".

## 2.14 Maps and location services

**None.** Location is text-based (Kenya county list in `src/lib/format.ts`, branch lat/lng fields, meetup lat/lng for supply deliveries). No map SDK is installed. Browser geolocation is captured optionally for supply handover evidence.

## 2.15 Hosting and deployment

- **Local/sandbox**: `bun run dev` (port 3000, logs to `dev.log`), behind a Caddy reverse proxy (`Caddyfile`: port 81 → localhost:3000, plus `XTransformPort` query param → arbitrary local port for auxiliary services like the WebSocket demo).
- **Build**: `next build` with `output: "standalone"`; `bun run start` runs the standalone server.
- **No CI/CD, domain, TLS or cloud config exists in the repo.** Deployment scripts under `tests/*.sh` validate the sandbox's DB/runtime build conventions.

## 2.16 Environment configuration

`.env` currently contains only `DATABASE_URL`. Variables referenced by code (names only): `AUTH_SECRET`, `NODE_ENV`, `NEXT_PUBLIC_SITE_URL`, `MPESA_*` (6), `SMTP_URL`, `SMS_API_KEY`. See [16-infrastructure-deployment.md](16-infrastructure-deployment.md) for the full table with purposes.

## 2.17 Logging and error monitoring

- **Logging**: `console.*` → stdout → `dev.log` (dev script tees). API errors log via `console.error('[api]', e)`; audit events go to the `AuditLog` table (actor, action, target, metadata).
- **Error monitoring**: none beyond logs + the audit trail. No Sentry/OTel.

## 2.18 Testing infrastructure

- `verification/security-tests.ts`: a 15-section live suite asserting real-vs-demo isolation, RBAC denials, tenant isolation, demo sandboxing, role revocation immediacy, webhook/catalog safety (run against a running instance with `bun verification/security-tests.ts`).
- `tests/*.sh`: sandbox deploy-pipeline tests (DB runtime build, python runtime) using hidden fixtures — not product tests.
- **No unit/integration/e2e test framework** (no vitest/playwright). `bun run lint` is the automated gate.

## 2.19 Libraries installed but not (yet) load-bearing

`next-auth` (unused custom auth instead), `@tanstack/react-query`, `react-hook-form`, `@mdxeditor/editor`, `@dnd-kit/*`, `three/drei` (used only by customizer), `next-intl` (no locale routing wired), `uuid` (Prisma cuids used instead), `input-otp` and `qrcode` (used), `embla-carousel-react` (gallery/carousel polish). Their presence does not imply functionality — where relevant, features are hand-rolled.
