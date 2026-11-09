# CARMAZE — Deployment Guide

**Target: single-instance Node/bun host behind a reverse proxy. This matches the existing architecture (Next.js 16 standalone output, SQLite, in-process jobs).**

---

## 1. Prerequisites

- Node 20+/bun 1.2+; 2 vCPU / 2 GB RAM minimum (Turbopack build wants ~1.5 GB heap).
- Fill `.env` from `.env.example` (names only there — real values never committed). `AUTH_SECRET` is mandatory: `openssl rand -base64 48`.
- Domain + TLS terminated at the proxy (Caddy/Nginx); forward `X-Forwarded-For` (rate limiting keys on it).

## 2. Build & run

```bash
bun install --frozen-lockfile
bunx prisma migrate deploy        # apply migration history (never db:push in prod)
bun run build                     # next build + static assets into standalone output
bun run start                     # NODE_ENV=production bun .next/standalone/server.js
```

- `typescript.ignoreBuildErrors` is `false`: a real type error fails the build. Do not re-enable it.
- Health check: `GET /api/health` (reports DB + provider configuration honestly).
- Jobs: `ENABLE_JOBS=false` on any secondary worker so only one process runs sweeps.

## 3. Webhooks & callbacks (M-Pesa)

- STK callback: `https://<domain>/api/billing/mpesa/callback`
- B2C result: `https://<domain>/api/admin/settlements/payout/result`
- Set `MPESA_WEBHOOK_SECRET` and configure the edge to **allow-list Safaricom Daraja IP ranges**; requests without the matching `x-carmaze-signature` header are rejected in production (fail-closed, 401, no detail).
- URLs must be public HTTPS — set `NEXT_PUBLIC_SITE_URL` accordingly.

## 4. Reverse proxy (Caddy sketch)

```
carmaze.example.ke {
  encode gzip
  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options    "nosniff"
    X-Frame-Options           "DENY"
    Referrer-Policy           "strict-origin-when-cross-origin"
  }
  reverse_proxy 127.0.0.1:3000
}
```

(A CSP header is the remaining hardening item — add one tuned to the app's inline/bundle shape before public launch; see blockers.)

## 5. Scheduled jobs

Started in-process by `src/instrumentation.ts` (`startScheduledJobs`): application SLA sweep (hourly), subscription expiry (hourly), campaign expiry (hourly), reset-token cleanup (daily), verification-code cleanup (daily). All idempotent + audit-logged. Verify boot in logs: `scheduled jobs started`.

## 6. Backups

`bun run db:backup` (cron daily + pre-deploy). Restore drill procedure in `CARMAZE_DATABASE_AND_BACKUP_GUIDE.md` §4. Keep `backups/` out of any public path.

## 7. Post-deploy checklist

1. `/api/health` 200 and reports the expected provider states.
2. Register one real user; verify email path behaves per provider config (or honest 503).
3. Demo mode: sign in as demo customer; upload an image; confirm it renders.
4. STK push on a real KES 1 invoice in Daraja **sandbox** first; confirm callback activates nothing until `ResultCode 0`.
5. `bun verification/security-tests.ts` against staging — expect 93/93.
6. Confirm `dev.log`/`server.log` show no `[api]` 500s after an hour of soak.

## 8. Environment variable names (values go only in `.env`)

See `CARMAZE_ENVIRONMENT_VARIABLES.md`. Never print, commit, or paste secrets; rotate `AUTH_SECRET` by re-issuing sessions (users re-login).
