#!/usr/bin/env node
/**
 * CARMAZE off-site backup sync — copies the local backup directory to a
 * remote object-storage/machine target with rclone.
 *
 * FAIL-CLOSED BY DESIGN: no credentials, no remote name and no defaults are
 * invented here. The script refuses to run until the founder provisions a
 * backup target and configures exactly two things:
 *
 *   1. `rclone` installed and a remote configured once, interactively:
 *        rclone config          # e.g. S3, B2, rsync.net — any remote works
 *   2. OFFSITE_BACKUP_REMOTE in /opt/carmaze/.env, e.g.
 *        OFFSITE_BACKUP_REMOTE="remote:carmaze-backups"
 *
 * Cron usage (see docs/CARMAZE_DEPLOYMENT_RUNBOOK.md §8):
 *   bun /opt/carmaze/scripts/offsite-sync.mjs 2>>/opt/carmaze/backups/sync.log
 *
 * Exit codes: 0 synced · 1 refused (not configured) · 2 rclone failed.
 * The script never deletes remote files (rclone copy, never sync) — remote
 * retention is managed by the provider's lifecycle rules.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Resolve the local backup dir (same precedence as scripts/backup-db.sh).
let backupDir = process.env.CARMAZE_BACKUP_DIR || path.join(ROOT, 'backups')

// Cron jobs don't inherit the service env: read OFFSITE_BACKUP_REMOTE from
// the project .env when it is not already exported.
let remote = process.env.OFFSITE_BACKUP_REMOTE || ''
if (!remote) {
  try {
    const envFile = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    const line = envFile.split('\n').reverse().find((l) => /^OFFSITE_BACKUP_REMOTE=/.test(l.trim()))
    if (line) remote = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
  } catch {
    /* no .env — reported below */
  }
}

if (!remote) {
  console.error(
    'REFUSED: OFFSITE_BACKUP_REMOTE is not set. Backups stay local-only until the founder provisions a target: ' +
    'run `rclone config` once, then set OFFSITE_BACKUP_REMOTE="remote:bucket" in /opt/carmaze/.env. ' +
    'NEVER mark off-site backups as done until this script exits 0 against a real target.'
  )
  process.exit(1)
}

if (!fs.existsSync(backupDir)) {
  console.error(`REFUSED: backup directory does not exist: ${backupDir} — run scripts/backup-db.sh first.`)
  process.exit(1)
}

const rclone = spawnSync('rclone', ['copy', backupDir, remote, '--max-age', '48h'], {
  stdio: ['ignore', 'inherit', 'inherit'],
})
if (rclone.error || rclone.status !== 0) {
  console.error(`OFFSITE SYNC FAILED: rclone exit ${rclone.status ?? 'spawn-error'} — check credentials/network. Local backups are intact.`)
  process.exit(2)
}
console.log(`Off-site sync complete: ${backupDir} → ${remote} (copy only; nothing deleted).`)
