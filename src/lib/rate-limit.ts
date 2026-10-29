// In-memory sliding-window rate limiter.
// Suitable for this single-instance deployment; document: reset on restart.
type Bucket = { hits: number[] }

const buckets = new Map<string, Bucket>()

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b) {
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
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.hits.length === 0 || now - v.hits[v.hits.length - 1] > windowMs * 2) buckets.delete(k)
    }
  }
  return { allowed: true, retryAfterSec: 0 }
}
