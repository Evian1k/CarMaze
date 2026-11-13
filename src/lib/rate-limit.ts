// In-memory sliding-window rate limiter.
//
// Suitable for this single-instance deployment. Three documented caveats:
//  1. buckets reset on process restart (acceptable: a restart also ends the
//     sessions an attacker was hammering);
//  2. a multi-instance deployment must move to a shared store (Redis or the
//     primary database) — flagged in the remediation plan, not hidden. THE
//     CONTROLLED PILOT MUST RUN AS A SINGLE APP INSTANCE (systemd
//     restart=always, one process); horizontal scaling without a shared
//     limiter would multiply every limit by the instance count;
//  3. the proxy in front of the app (Caddy, see the deployment runbook) is
//     the ONLY thing allowed to connect to the app port — it must not be
//     bound publicly — and it must append the client IP to X-Forwarded-For.
//     getIp() trusts the LAST XFF entry for exactly this topology.
type Bucket = { hits: number[] }

const buckets = new Map<string, Bucket>()

// Hard cap so abuse cannot grow the map unboundedly: once exceeded, old
// buckets are aggressively pruned on every call.
const MAX_BUCKETS = 20000
const IDLE_MULTIPLIER = 2

function prune(now: number, windowMs: number): void {
  for (const [k, v] of buckets) {
    if (v.hits.length === 0 || now - v.hits[v.hits.length - 1] > windowMs * IDLE_MULTIPLIER) buckets.delete(k)
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b) {
    if (buckets.size >= MAX_BUCKETS) prune(now, windowMs)
    b = { hits: [] }
    buckets.set(key, b)
  }
  b.hits = b.hits.filter((t) => now - t < windowMs)
  if (b.hits.length >= limit) {
    const oldest = b.hits[0]
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) }
  }
  b.hits.push(now)
  // opportunistic cleanup
  if (buckets.size > 5000) prune(now, windowMs)
  return { allowed: true, retryAfterSec: 0 }
}

// Periodic housekeeping independent of traffic so idle-bucket memory is
// reclaimed even on quiet deployments. unref'd: never keeps the process alive.
const cleanup = setInterval(() => prune(Date.now(), 60 * 60 * 1000), 5 * 60 * 1000)
if (typeof cleanup.unref === 'function') cleanup.unref()

/** Current bucket count — exposed for ops diagnostics. */
export function rateLimitBucketCount(): number {
  return buckets.size
}
