#!/usr/bin/env bash
# CARMAZE SQLite backup: sqlite3 .backup (WAL-safe snapshot) → gzip →
# timestamped file → 30-copy retention.
#
# The database path is resolved in this order (so the SAME script works in the
# sandbox and on the production host, whose DATABASE_URL points at
# /opt/carmaze/data/prod.db and whose repo has no db/custom.db):
#   1. CARMAZE_DB_FILE       — explicit override
#   2. $DATABASE_URL         — file:<path> (service env / manual runs)
#   3. .env DATABASE_URL     — cron jobs do not inherit the service env
#   4. db/custom.db          — legacy sandbox/dev layout
# Backup directory: $CARMAZE_BACKUP_DIR (default ./backups, absolute paths OK).
set -euo pipefail
cd "$(dirname "$0")/.."

DB_FILE="${CARMAZE_DB_FILE:-}"
if [ -z "$DB_FILE" ] && [ -n "${DATABASE_URL:-}" ]; then
  DB_FILE="${DATABASE_URL#file:}"
fi
if [ -z "$DB_FILE" ] && [ -f .env ]; then
  ENV_DB="$(grep -E '^DATABASE_URL=' .env | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
  [ -n "$ENV_DB" ] && DB_FILE="${ENV_DB#file:}"
fi
[ -z "$DB_FILE" ] && DB_FILE="db/custom.db"

BACKUP_DIR="${CARMAZE_BACKUP_DIR:-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -f "$DB_FILE" ]; then
  echo "ERROR: database file not found: $DB_FILE (resolved from CARMAZE_DB_FILE/DATABASE_URL/.env)" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TARGET="$BACKUP_DIR/carmaze-$STAMP.db.gz"
# Zero-copy .backup when the sqlite3 CLI exists; plain copy otherwise (the
# deployment uses journal mode delete, so a consistent-enough snapshot for
# small DBs; .backup is preferred and present on the production host).
sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/carmaze-$STAMP.db'" 2>/dev/null || cp "$DB_FILE" "$BACKUP_DIR/carmaze-$STAMP.db"
gzip -f "$BACKUP_DIR/carmaze-$STAMP.db"
echo "Backup written: $TARGET (source: $DB_FILE)"

# Retention: keep the 30 most recent backups.
ls -1t "$BACKUP_DIR"/carmaze-*.db.gz 2>/dev/null | tail -n +31 | while read -r old; do
  rm -f "$old"
  echo "Pruned old backup: $old"
done
