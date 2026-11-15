# CARMAZE — Fresh Production Database Initialization (the ONE procedure)

**Status: tested end-to-end and re-confirmed in the final pass** on a clean staging database (`/tmp/carmaze-staging.db`, since deleted): 5 migrations applied, first FOUNDER minted, zero demo rows, password hash verified, audit row written (17/17 contract checks in `verification/verify-staging-bootstrap.ts`), and all four negative guards refused. This is the only supported way to create a production database.

## The rule

- **Production database = versioned Prisma migrations + founder bootstrap. Nothing else.**
- `bun run db:push` (`prisma db push --accept-data-loss`) is **DEV-ONLY**. It exists for fast iteration on the sandbox dev database (`db/custom.db`). Never run it against production: it can drop columns/tables without warning. All production documents, scripts and the runbook use `prisma migrate deploy` exclusively.
- `prisma/seed.ts` is the **demo-data seeder**. It must never touch a production database.
- Never copy `db/custom.db` to a server: it contains the demo dataset.

## Procedure (fresh server, clean database)

```bash
# 0. On the server, inside the release directory (see DEPLOYMENT_RUNBOOK step order)
cd /opt/carmaze && bun install --frozen-lockfile

# 1. Point DATABASE_URL at the (not yet existing) production SQLite file
#    .env: DATABASE_URL="file:/opt/carmaze/data/prod.db"   (dir must exist and be writable)

# 2. Create the full schema from versioned migrations — repeatable, ordered, non-interactive
bun run db:deploy            # = prisma migrate deploy

# 3. Verify every migration applied
bun run db:status            # "Database schema is up to date!"

# 4. Bootstrap the FIRST FOUNDER account (imports nothing — no demo data, no demo users)
bun run founder:create       # reads FOUNDER_EMAIL / FOUNDER_NAME / FOUNDER_PASSWORD / FOUNDER_CONFIRM=YES

# 5. (Optional, repeatable) verify the bootstrap contract — read-only checker
#    DATABASE_URL="file:/opt/carmaze/data/prod.db" STAGING_TEST_PASSWORD='…' bun verification/verify-staging-bootstrap.ts
```

Founder bootstrap contract (enforced by `scripts/create-founder.ts`, all fail-closed):

| Guard | Behaviour |
|---|---|
| `FOUNDER_CONFIRM=YES` required | no accidental runs |
| One founder ever | refuses if any `roles` contains `FOUNDER` |
| Email uniqueness | refuses if the email is registered |
| Clean-DB guard | refuses if the database contains demo accounts / demo users (deliberate override: `FOUNDER_ALLOW_DEMO_DB=YES`) |
| Password policy | ≥12 chars, mixed case + digit + symbol; stored as bcrypt hash only; never printed or logged |
| Audit trail | writes `FOUNDER_BOOTSTRAP` AuditLog row inside the same transaction that creates the user |

Environment needed by the script (values are passed in, never stored in git):

```
FOUNDER_CONFIRM=YES
FOUNDER_EMAIL=founder@yourdomain.co.ke
FOUNDER_NAME="Full Name"
FOUNDER_PASSWORD='...at least 12 chars...'
```

If the shell history concern matters, put them in a temporary root-owned file and `export $(cat …)` or run under `env -i`, then shred it.

## Why migrations are now complete (the fix this session)

History: early development applied some schema changes with `db:push`, so the migration folder was missing `User.marketingConsent`, `Enquiry.assignedToId` and 12 indexes. A fresh `migrate deploy` database therefore could NOT run the current app (verified: first staging attempt failed on the missing `marketingConsent` column).

Fix applied this session, non-destructively:
1. `20261113103525_prelaunch_security_hardening` — the pre-launch security schema (OTP TTL fields, QR hash/encrypted fields, Settlement & BusinessMembership uniques, UploadRecord scan/quarantine/evidence fields, FileAccessLog). Applied to the dev DB via SQL + marked applied; no data loss (verified: 25 users, 10 demo accounts, all vehicles intact).
2. `20261113103712_reconcile_schema_drift` — captures the historical db:push deltas so migration history == schema exactly. Marked applied on the dev DB (it already had the objects); applied for real on the fresh staging DB.
3. Verified: `prisma migrate diff --from-migrations --to-schema-datamodel` now reports **no difference**; `prisma migrate status` is clean on both dev and fresh databases; `migrate dev` no longer demands a destructive reset.

From now on the workflow is: change `prisma/schema.prisma` → `bunx prisma migrate dev --name <change>` on the dev DB → commit the migration → production gets it with `bun run db:deploy`.

## What was verified on the fresh staging database

| Check | Result |
|---|---|
| `bunx prisma migrate deploy` (5 migrations) | all applied, exit 0 |
| Users after bootstrap | exactly 1 — `roles=FOUNDER`, `isDemo=false` |
| Demo accounts / vehicles / invoices / uploads | 0 / 0 / 0 / 0 |
| Founder password | bcrypt hash verifies; plaintext never stored/printed |
| Audit trail | `FOUNDER_BOOTSTRAP` row written transactionally |
| Second-founder attempt | refused |
| Duplicate-email attempt | refused |
| Weak-password attempt | refused |

## Dev-machine convenience (NOT for production)

- `bun run db:push` — dev schema sync (destructive, dev DB only)
- `bun run db:seed` — demo dataset (dev DB only)
- `bun run db:migrate` / `db:reset` — migration authoring / scratch resets (dev only)
