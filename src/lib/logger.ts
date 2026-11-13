/**
 * Minimal structured logger for server-side modules (API routes, jobs,
 * providers). One JSON line per event so sandbox and production logs can be
 * grepped by level and component without stdout parsing heuristics.
 *
 * REDACTION: every meta object is scrubbed before serialisation — keys that
 * could carry credentials or secrets (passwords, tokens, OTPs/codes, API
 * keys, authorization headers, cookies, raw callbacks) are replaced with
 * "[REDACTED]" and their values never reach stdout or any log sink. This is
 * defence in depth: production logs must never expose passwords, tokens,
 * payment credentials, identity documents or OTPs.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level) || 'info'

// Key fragments whose values are always redacted (case-insensitive substring).
const REDACT_KEY_FRAGMENTS = [
  'password', 'passwd', 'secret', 'token', 'authorization', 'auth',
  'otp', 'code', 'credential', 'apikey', 'api_key', 'api-key', 'key',
  'cookie', 'session', 'callbackraw', 'pin', 'msisdn', 'idnumber', 'nationalid',
]

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // Redact long high-entropy strings that look like bearer tokens even when
    // the key name was not in the list (defense in depth).
    if (/^(Bearer\s+\S+|sk-[\w-]{16,}|ey[\w-]{20,}\.\S+\.\S+)$/.test(value)) return '[REDACTED]'
    return value
  }
  return value
}

function redact(meta: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 4) return { truncated: true }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    const lower = k.toLowerCase()
    if (REDACT_KEY_FRAGMENTS.some((frag) => lower.includes(frag))) {
      out[k] = '[REDACTED]'
      continue
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redact(v as Record<string, unknown>, depth + 1)
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) => (item && typeof item === 'object' ? redact(item as Record<string, unknown>, depth + 1) : redactValue(item)))
    } else {
      out[k] = redactValue(v)
    }
  }
  return out
}

function emit(level: Level, component: string, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return
  const entry = {
    time: new Date().toISOString(),
    level,
    component,
    message,
    ...(meta ? { meta: redact(meta) } : {}),
  }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export function createLogger(component: string) {
  return {
    debug: (message: string, meta?: Record<string, unknown>) => emit('debug', component, message, meta),
    info: (message: string, meta?: Record<string, unknown>) => emit('info', component, message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => emit('warn', component, message, meta),
    error: (message: string, meta?: Record<string, unknown>) => emit('error', component, message, meta),
  }
}
