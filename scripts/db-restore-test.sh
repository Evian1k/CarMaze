#!/usr/bin/env bash
# CARMAZE restore test: proves a backup can actually be restored, WITHOUT
# touching the live database. Gunzips the newest (or given) backup into a
# temp directory, runs SQLite integrity checks and sanity row counts against
# it through Prisma, then deletes the temp copy. Safe to run any time.
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${CARMAZE_BACKUP_DIR:-backups}"

BACKUP="${1:-}"
if [ -z "$BACKUP" ]; then
  BACKUP=$(ls -1t "$BACKUP_DIR"/carmaze-*.db.gz 2>/dev/null | head -n 1 || true)
fi
if [ -z "$BACKUP" ] || [ ! -f "$BACKUP" ]; then
  echo "FAIL: no backup found under $BACKUP_DIR/ — run scripts/backup-db.sh first" >&2
  exit 1
fi
echo "Restore-testing backup: $BACKUP"

TMPDIR_RESTORE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_RESTORE"' EXIT

gunzip -c "$BACKUP" > "$TMPDIR_RESTORE/restore-test.db"
TEST_DB="$TMPDIR_RESTORE/restore-test.db"

DATABASE_URL="file:$TEST_DB" bun -e "
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const integrity = await db.\$queryRaw\`PRAGMA integrity_check\`;
  const ok = JSON.stringify(integrity).includes('ok');
  const [users, orgs, vehicles, invoices, settlements] = await Promise.all([
    db.user.count(), db.org.count(), db.vehicle.count(), db.invoice.count(), db.settlement.count(),
  ]);
  console.log(JSON.stringify({ integrity: ok ? 'ok' : integrity, users, orgs, vehicles, invoices, settlements }));
  if (!ok) process.exit(2);
  if (users === 0) { console.error('FAIL: restored database has zero users'); process.exit(3); }
  await db.\$disconnect();
  console.log('RESTORE TEST PASSED');
})()"

echo "Restore test complete (temp copy discarded; live database untouched)."
