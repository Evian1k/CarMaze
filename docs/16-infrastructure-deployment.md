# PART 18 — INFRASTRUCTURE AND DEPLOYMENT

Exactly how CARMAZE runs, with real commands from `package.json` / `scripts/`. Secrets are referenced by name only.

## 18.1 Local development setup

**Required software**: Bun ≥ 1.3 (runtime + package manager), Node-compatible OS. No Docker required.

```bash
bun install                       # install dependencies
# .env must contain DATABASE_URL (e.g. "file:./db/custom.db" — relative to prisma/ or absolute)
bun run db:deploy                 # apply versioned migrations (prisma migrate deploy) — the ONLY production DB command
bun run db:seed                   # optional: full demo world (bun prisma/seed.ts)
bun run dev                       # next dev -p 3000, logs tee'd to dev.log
bun run lint                      # ESLint (the only automated gate)
```

- `scripts/start-dev-daemon.py` double-forks `bun run dev` so it survives sandbox session reaping (guards against double-start on :3000, sets `NODE_OPTIONS=--max-old-space-size=1536`).
- Open `http://localhost:3000`. The single page bootstraps: BootScreen → (optional intro) → AppShell.
- Demo logins: Sign-in page → demo accounts (credentials are seeded server-side; the shared demo password pattern is documented in `prisma/seed.ts` — it is printed by the seed run and must not be committed anywhere).

## 18.2 Environment variables (names only — never commit values)

| Variable | Purpose | Required? |
|---|---|---|
| `DATABASE_URL` | SQLite file location for Prisma | **Yes** |
| `AUTH_SECRET` | Session/MFA JWT signing key | **Yes in production** (dev falls back to a hardcoded string — remove that fallback) |
| `NODE_ENV` | production ⇒ secure cookies, fail-closed webhooks, hides dev codes | set by start script |
| `NEXT_PUBLIC_SITE_URL` | metadata base for SEO tags | recommended |
| `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` | Daraja API credentials | for payments |
| `MPESA_SHORTCODE` | business shortcode (code reads this name only) | for payments |
| `MPESA_PASSKEY` | Lipa na M-Pesa Online passkey | for payments |
| `MPESA_CALLBACK_URL` | public HTTPS URL Daraja calls back | for payments |
| `MPESA_ENV` / `MPESA_BASE_URL` | `sandbox` (default) / `production` (+ override URL) | optional |
| `MPESA_WEBHOOK_SECRET` | shared secret for `x-carmaze-signature` on callbacks | **strongly recommended** (fail-closed in prod) |
| `SMTP_URL`, `SMS_API_KEY` | presence-checked only (health/dev-code decisions) — **no transport implemented** | optional |

## 18.3 Database setup, migrations & reset

- Schema: single file `prisma/schema.prisma` (99 models). **No migrations folder exists.**
- `bun run db:deploy` — applies versioned migrations (safe, ordered, repeatable). `bun run db:push` is DEV-ONLY (--accept-data-loss) and must never run against a real database.
- `bun run db:generate` — regenerate the Prisma client after schema edits.
- `bun run db:seed` — rebuilds the demo world: `deleteMany` on users/orgs (invalidating all demo sessions by orphaning JWT subjects) then inserts 22 users, 8 orgs, branches, 12 vehicles, 30 categories, 18 products, stock, POs, invoices, custody, incidents, logistics jobs, community, settings, 8 demo accounts.
- `db:migrate` / `db:reset` scripts exist but are unused; adopting real migrations is a recommended change (Part 20).
- Backup = file copy of `db/custom.db` (stop the server or accept a momentary copy risk); no automated backups.

## 18.4 Backend / frontend startup

- **One process serves both**: `bun run dev` (dev) or `bun run build && bun run start` (production standalone server on :3000, logs to `server.log`).
- Build script also copies `.next/static` and `public/` into `.next/standalone/` (required by `output: "standalone"`).
- Background workers: **none** (Part 2.11). The WebSocket example (`examples/websocket/`) would run separately on :3003 via `bun examples/websocket/server.ts` — reference only.

## 18.5 File storage

Local disk `data/uploads/` (private documents) and `data/uploads/media/` (public images), served by the two GET routes. **The write path (POST /api/upload) is not implemented** — provision files by seed or implement the endpoint before launch (Part 20 #1).

## 18.6 Hosting, domain, DNS, CI/CD

Nothing in the repo configures a production host. The sandbox layout is: Caddy (`:81`) reverse-proxying to `localhost:3000`, with `?XTransformPort=<port>` routing to auxiliary local services. For production you would need: a host running the standalone server behind a TLS-terminating proxy, a domain with DNS, **a public HTTPS callback URL for Daraja** (`MPESA_CALLBACK_URL`), and the `MPESA_WEBHOOK_SECRET` set on both sides. There is **no CI/CD pipeline** in the repo; deploys are manual (`build` + `start`).

## 18.7 Build process details

`next build` with `typescript.ignoreBuildErrors: true` (type errors will not fail the build — run `bunx tsc --noEmit` separately when you want the real check). ESLint is not run by the build. Static assets are emitted into the standalone bundle by the post-build copy.

## 18.8 Logs, monitoring, health

- Logs: stdout → `dev.log` (dev) / `server.log` (prod) via tee. API errors `console.error('[api]', …)`.
- Health: `GET /api/health` → DB probe + `mpesaConfigured()` + SMTP/SMS presence + AI status; used by the admin health chips.
- Monitoring: audit log + admin ops view (failed deliveries, failed payment attempts). **No external APM/alerting.**

## 18.9 Scaling & rollback

- **Vertical first**: the app is a single Node/Bun process + SQLite. Reads scale fine for pilot traffic; SQLite is the ceiling (no multi-writer). Next steps if needed: Postgres via Prisma (schema is portable; JSON columns would migrate to jsonb), distributed rate limiting (Redis), a real queue for notifications/emails.
- **Rollback**: redeploy the previous build artifact (standalone folders are self-contained); if a schema push was destructive, restore `db/custom.db` from the file backup. There is no automated rollback.

## 18.10 Recovery runbook (recommended minimum)

1. Stop the server; copy `db/custom.db` (corrupted?) aside.
2. Restore the latest backup file; `bun run db:deploy` brings the schema fully up to date (migrations are ordered and idempotent-in-effect).
3. Restart; verify `GET /api/health`; spot-check `GET /api/vehicles/home`.
4. If Daraja callbacks failed during downtime: reconcile unpaid invoices via Admin → Billing (FINANCE mark-paid with note) after confirming receipts with the provider.
