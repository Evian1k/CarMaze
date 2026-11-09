# CARMAZE — Database & Backup Guide

**9 Nov 2026 · SQLite via Prisma 6 · 101 models · migration history established.**

---

## 1. Current database

- File: `db/custom.db` (SQLite), `DATABASE_URL` in `.env` (never print or commit).
- Schema: `prisma/schema.prisma` — 101 models, no enums (string states with documented value sets), 11 event-timeline tables, cascade rules audited (86 cascade / 2 SetNull).
- Money is stored in integer minor units (KES cents) everywhere.

## 2. Migration strategy — ESTABLISHED AND REPRODUCIBLE

`prisma/migrations/` now contains real history:

```
0_init                                          (baseline, resolved as applied)
20261109052327_add_upload_records               (UploadRecord table + indexes)
2026…_verification_code_security_session_version (User: code expiry/attempt cols + sessionVersion)
```

Rules that made this safe and apply going forward:

1. **Schema changes are made with `bunx prisma migrate dev --name …`** — never by editing the DB.
2. The legacy `db:push` script still exists for the sandbox, but migrations are the source of truth; a fresh environment reproduces the DB with `bunx prisma migrate deploy`.
3. Additive-only changes were used throughout remediation; no column was dropped or retyped; no data was lost (verified by pre/post row counts during the restore drill).
4. `prisma migrate status` must say "Database schema is up to date" before any deploy.

## 3. Backup procedures

- **Script**: `bun run db:backup` → `scripts/backup-db.sh` — uses `sqlite3 .backup` (falls back to a copy), gzips to `backups/carmaze-<timestamp>.db.gz`, retains the 30 most recent.
- **Frequency (recommended ops policy)**: before every deploy or migration; daily cron on the host (e.g. `0 2 * * * cd /home/z/my-project && bun run db:backup`); immediately before any demo reset on production-like data.
- **Protection**: the `backups/` directory must be excluded from web serving and included in host-level backups; it contains personal data — same access discipline as the DB itself.

## 4. Restore procedure (drill-verified)

```bash
gunzip -c backups/carmaze-<stamp>.db.gz > /tmp/restored.db
# verify BEFORE swapping in:
bun -e "const {Database}=require('bun:sqlite');const d=new Database('/tmp/restored.db',{readonly:true});console.log(d.query('PRAGMA integrity_check').get())"
# stop the app, then atomically replace:
mv db/custom.db db/custom.db.pre-restore && mv /tmp/restored.db db/custom.db
# restart and run `bunx prisma migrate status` → must report up to date
```

**Drill executed this session (isolated copy, live DB untouched):** integrity_check `ok`; row counts matched live on User 23/23, Org 8/8, Vehicle 12/12, Product 18/18, Subscription 4/4, Invoice 7/7, AuditLog 14/14, Settlement 0/0, UploadRecord 0/0. **PASS.**

## 5. Recovery objectives

- RPO: ≤24 h with the daily cron (≤ interval since last backup).
- RTO: minutes — single-file restore + process restart; no schema replay needed because migrations ship with the code.
- After ANY restore: run `bunx prisma migrate status`, verify `/api/health`, and audit-log a `DATABASE_RESTORED` note with the backup stamp.

## 6. SQLite vs PostgreSQL — guidance, not a silent switch

SQLite is appropriate for the single-instance pilot (simple ops, one writer, small footprint). Move to PostgreSQL **when any of these become true**: multi-instance deployment (also required by the shared rate limiter), sustained concurrent write pressure, or a need for server-managed backups/replication. Migration plan at that point: `prisma migrate diff` from the SQLite schema → PostgreSQL baseline, data ETL via a dump/transform script, dual-run verification on row counts and financial sums, cutover behind a maintenance window. Do **not** switch in-place and do not lose records; keep the SQLite file as the fallback until reconciliation passes.
