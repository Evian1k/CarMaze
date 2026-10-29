'use client'

// Client-side API helpers + hash router for the single-page app.

export class ClientApiError extends Error {
  code: string
  status: number
  data?: Record<string, unknown>
  constructor(status: number, code: string, message: string, data?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.data = data
  }
}

async function handle<T>(res: Response): Promise<T> {
  let body: Record<string, unknown> | null = null
  try {
    body = await res.json()
  } catch {
    /* non-json */
  }
  if (!res.ok) {
    const code = (body?.error as string) || 'REQUEST_FAILED'
    const message = (body?.message as string) || `Request failed (${res.status})`
    throw new ClientApiError(res.status, code, message, body as Record<string, unknown>)
  }
  return body as T
}

export async function apiGet<T>(url: string): Promise<T> {
  return handle<T>(await fetch(url, { credentials: 'include' }))
}

export async function apiSend<T>(url: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  return handle<T>(
    await fetch(url, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  )
}

export async function apiUpload<T>(url: string, formData: FormData): Promise<T> {
  return handle<T>(await fetch(url, { method: 'POST', credentials: 'include', body: formData }))
}

// ─────────────────────────── Hash router ───────────────────────────

export type RouteInfo = {
  /** path segments after #/, e.g. ["cars","abc"] */
  segments: string[]
  /** first segment or "" for home */
  view: string
  query: URLSearchParams
  full: string
}

export function parseHash(): RouteInfo {
  if (typeof window === 'undefined') return { segments: [], view: '', query: new URLSearchParams(), full: '' }
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [pathPart, queryPart] = raw.split('?')
  const segments = pathPart.split('/').filter(Boolean)
  return {
    segments,
    view: segments[0] ?? '',
    query: new URLSearchParams(queryPart ?? ''),
    full: raw,
  }
}

export function navigate(to: string, opts?: { replace?: boolean }) {
  const target = to.startsWith('#') ? to : `#/${to.replace(/^\//, '')}`
  if (opts?.replace) {
    window.location.replace(target)
  } else {
    window.location.hash = target.slice(1)
  }
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
}

export function buildQuery(base: string, params: Record<string, string | number | undefined | null>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}
