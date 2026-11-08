/**
 * Minimal structured logger for server-side modules (API routes, jobs,
 * providers). One JSON line per event so sandbox and production logs can be
 * grepped by level and component without stdout parsing heuristics.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level) || 'info'

function emit(level: Level, component: string, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return
  const entry = {
    time: new Date().toISOString(),
    level,
    component,
    message,
    ...(meta ? { meta } : {}),
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
