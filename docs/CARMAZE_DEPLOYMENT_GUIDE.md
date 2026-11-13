# CARMAZE — Deployment Guide

**Target: single-instance Node/bun host behind a reverse proxy. This matches the existing architecture (Next.js 16 standalone output, SQLite, in-process jobs).**

Updated 13 Nov 2026 after the final remediation pass (25 audited fixes + 20 independently re-reviewed hardening fixes; suite now 119 checks).

---

## 1. Prerequisites

- Node 20+/bun 1.2+; 2 vCPU / 2 GB RAM minimum for the production runtime (see §10 for sizing and the dev/CI memory note). The Turbopack build step wants ~1.5 GB heap — build on the same host or a CI box with 4 GB.
- Fill `.env` from `.env.example` (names only there — real values never committed). `AUTH_SECRET` is mandatory: `openssl rand -base64 48`. In production the boot fails fast without it — this is by design.
- Domain + TLS terminated at the proxy (Caddy/Nginx). **The proxy MUST set `X-Forwarded-For` itself and strip/overwrite any client-supplied header chain** (nginx: `proxy_set_header X-Forwarded-For $remote_addr;`; Caddy: `reverse_proxy` with `trusted_proxies` configured). The app's rate limiter keys IP-based buckets on the LAST XFF entry; behind a correctly configured edge that is the real client IP, while a directly exposed instance would let clients rotate the key by forging the header. Sensitive routes (login as a user account, M-Pesa attempts, STK push) key on user id and are not affected.
- Log rotation for `server.log` (the start command pipes stdout through `tee`; use logrotate or a journald unit without `tee`).

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
5. `bun verification/security-tests.ts` against staging — expect **119/119** (run it against a FRESH server process: the in-memory rate-limit buckets must start empty for the brute-force tests to pass).
6. Confirm `dev.log`/`server.log` show no `[api]` 500s after an hour of soak.

## 8b. Rollback

1. Keep the previous release directory (`/opt/carmaze/releases/<stamp>`); the standalone build is self-contained (`.next/standalone` + copied `static` + `public`).
2. Rollback = stop the service, point the unit/symlink at the previous stamp, `bunx prisma migrate status` (only forward migrations are ever applied — a rolled-back code version must be compatible with the DB; additive-only migrations keep this true), start, check `/api/health`.
3. If the database itself is suspect, restore from `backups/` per `CARMAZE_DATABASE_AND_BACKUP_GUIDE.md` §4, then start the previous release.

## 9. Environment variable names (values go only in `.env`)

See `CARMAZE_ENVIRONMENT_VARIABLES.md`. Never print, commit, or paste secrets; rotate `AUTH_SECRET` by re-issuing sessions (users re-login; `sessionVersion` invalidates old ones immediately).

## 10. Resource sizing (verified, not guessed)

- Production runtime: 2 vCPU / 2 GB RAM minimum, with a supervisor restart policy. Load test on the audit pass: 1200 requests / 20 concurrent / 0 errors, RSS plateaued and DECLINED on repeat passes (no app-tier leak).
- Dev/CI (Turbopack on-demand compilation of 154 routes): 4 GB RAM. The one historical OOM was a multi-hour `next dev` session accumulating compile caches — a dev-workload property, not a production leak.
- SQLite: single-writer; fine for the pilot. Horizontal scaling or heavy concurrent writes → move to PostgreSQL first (guide in `CARMAZE_DATABASE_AND_BACKUP_GUIDE.md` §6).
