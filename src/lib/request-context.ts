import { AsyncLocalStorage } from 'async_hooks'
import { getSessionUser, type SessionUser } from '@/lib/auth'

/**
 * Per-request context (AsyncLocalStorage).
 *
 * Purpose 1: session memoisation: `requireUser()` may be called several times
 * inside one request (guards + handlers); the first lookup is cached so we
 * never hit the database twice for the same request.
 *
 * Purpose 2: sandbox enforcement: the demo status of the ACTING user travels
 * with the request context, so centralised side-effect helpers (notifications,
 * payments) can refuse to reach real users when a demo account is acting,
 * even if an individual endpoint forgets to check.
 */

type RequestContext = {
  user: SessionUser | null
  userResolved: boolean
}

const storage = new AsyncLocalStorage<RequestContext>()

/** Run a handler inside a fresh request context. */
export function runWithRequestContext<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ user: null, userResolved: false }, fn)
}

/**
 * Session user for the current request; memoised. Outside a request context
 * (background jobs, scripts) this falls back to a direct lookup.
 */
export async function contextSessionUser(): Promise<SessionUser | null> {
  const store = storage.getStore()
  if (!store) return getSessionUser()
  if (!store.userResolved) {
    store.user = await getSessionUser()
    store.userResolved = true
  }
  return store.user
}

/** True when the current request is performed by a demo-experience account. */
export async function isActorDemo(): Promise<boolean> {
  const user = await contextSessionUser()
  return Boolean(user?.isDemo)
}
