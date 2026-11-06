/**
 * Storage access that never throws.
 *
 * Sandboxed iframes (preview panels, privacy modes, storage-partitioned
 * browsers) can make any `sessionStorage`/`localStorage` access throw a
 * SecurityError. An uncaught throw during render unmounts the whole React
 * tree: the infamous "blank screen". Every read/write goes through these
 * guards so a blocked storage backend degrades gracefully to in-memory.
 */

const memorySession = new Map<string, string>()
const memoryLocal = new Map<string, string>()

function trySession(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function tryLocal(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function sessionGet(key: string): string | null {
  const store = trySession()
  if (store) {
    try {
      return store.getItem(key)
    } catch {
      /* fall through to memory */
    }
  }
  return memorySession.get(key) ?? null
}

export function sessionSet(key: string, value: string): void {
  const store = trySession()
  if (store) {
    try {
      store.setItem(key, value)
      return
    } catch {
      /* quota/blocked: keep in memory */
    }
  }
  memorySession.set(key, value)
}

export function localGet(key: string): string | null {
  const store = tryLocal()
  if (store) {
    try {
      return store.getItem(key)
    } catch {
      /* fall through to memory */
    }
  }
  return memoryLocal.get(key) ?? null
}

export function localSet(key: string, value: string): void {
  const store = tryLocal()
  if (store) {
    try {
      store.setItem(key, value)
      return
    } catch {
      /* quota/blocked: keep in memory */
    }
  }
  memoryLocal.set(key, value)
}

export function localRemove(key: string): void {
  const store = tryLocal()
  if (store) {
    try {
      store.removeItem(key)
    } catch {
      /* ignore */
    }
  }
  memoryLocal.delete(key)
}
