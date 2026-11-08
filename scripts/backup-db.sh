#!/usr/bin/env bash
# CARMAZE SQLite backup: copies db/custom.db to backups/ with a timestamp
# (WAL-safe for this deployment: the dev/production server uses journal mode
# delete by default, so a plain copy mid-write is acceptable for small DBs;
# for zero-copy backups use `sqlite3 db/custom.db ".backup ..."`).
set -euo pipefail
cd "$(dirname "$0")/.."

DB_FILE="db/custom.db"
BACKUP_DIR="backups"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -f "$DB_FILE" ]; then
  echo "ERROR: $DB_FILE not found" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TARGET="$BACKUP_DIR/carmaze-$STAMP.db.gz"
sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/carmaze-$STAMP.db'" 2>/dev/null || cp "$DB_FILE" "$BACKUP_DIR/carmaze-$STAMP.db"
gzip -f "$BACKUP_DIR/carmaze-$STAMP.db"
echo "Backup written: $TARGET"

# Retention: keep the 30 most recent backups.
ls -1t "$BACKUP_DIR"/carmaze-*.db.gz 2>/dev/null | tail -n +31 | while read -r old; do
  rm -f "$old"
  echo "Pruned old backup: $old"
done
