/**
 * Self-healing guard for critical files.
 *
 * This sandbox has repeatedly (5x as of 2026-11-11) lost the same source file
 * between sessions — `src/app/api/upload/route.ts` — while every other edit
 * survived. The platform's auto-commit snapshots faithfully record whatever is
 * on disk, so once a snapshot captured the deletion, git alone can no longer
 * restore it. This script closes that gap: it runs before every dev-server
 * start (wired into the `dev` package script) and restores any missing file
 * from a tracked copy in `agent-ctx/critical/`.
 *
 * Rules:
 *   - restores ONLY when the target is missing (never overwrites live edits)
 *   - sources must be committed to git (they are the recovery path)
 *   - exits non-zero if a restore fails, so a broken dev start is loud,
 *     never silent
 *
 * To add a new critical file: copy it to agent-ctx/critical/<same-relative-path>
 * and add an entry to MANIFEST below.
 */
import { copyFile, mkdir, access } from 'fs/promises'
import path from 'path'
import { constants } from 'fs'

const ROOT = process.cwd()

type Entry = { target: string; source: string }

const MANIFEST: Entry[] = [
  {
    // The single secure upload endpoint — 17 client call sites depend on it.
    // Lost 5x by the sandbox; the tracked backup has survived every incident.
    target: 'src/app/api/upload/route.ts',
    source: 'agent-ctx/critical/api-upload-route.ts',
  },
]

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

let failures = 0

for (const entry of MANIFEST) {
  const target = path.join(ROOT, entry.target)
  const source = path.join(ROOT, entry.source)

  if (await exists(target)) continue

  if (!(await exists(source))) {
    console.error(`[ensure-critical-files] MISSING BOTH: ${entry.target} and its recovery copy ${entry.source}`)
    failures++
    continue
  }

  try {
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(source, target)
    console.log(`[ensure-critical-files] restored ${entry.target} from ${entry.source}`)
  } catch (e) {
    console.error(`[ensure-critical-files] FAILED to restore ${entry.target}:`, e)
    failures++
  }
}

if (failures > 0) process.exit(1)
