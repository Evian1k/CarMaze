import { NextRequest, NextResponse } from 'next/server'
import { ZodError, ZodType } from 'zod'
import { getSessionUser, hasRole, SessionUser } from '@/lib/auth'
import { contextSessionUser, runWithRequestContext } from '@/lib/request-context'

export class ApiError extends Error {
  status: number
  code: string
  data?: Record<string, unknown>
  constructor(status: number, code: string, message: string, data?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.data = data
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, init)
}

export function fail(status: number, code: string, message: string, data?: Record<string, unknown>) {
  return NextResponse.json({ error: code, message, ...data }, { status })
}

/** Wrap a route handler with uniform error handling. Generic ctx keeps each
 * dynamic route's own params typing (e.g. { id: string }) intact.
 * Every handler runs inside a request context so the acting user's session
 * (and demo status) is resolved once and shared with central guards. */
export function route<C = RouteCtx>(handler: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      return await runWithRequestContext(() => handler(req, ctx))
    } catch (e) {
      if (e instanceof ApiError) {
        return fail(e.status, e.code, e.message, e.data)
      }
      if (e instanceof ZodError) {
        return fail(400, 'VALIDATION_ERROR', 'Invalid input', { issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
      }
      console.error('[api]', e)
      return fail(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.')
    }
  }
}

export type RouteCtx = { params: Promise<Record<string, string>> }

export async function requireUser(): Promise<SessionUser> {
  const user = await contextSessionUser()
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.')
  return user
}

/** Session user or null — for endpoints that change for signed-in users but
 * also work anonymously (e.g. product detail). */
export async function requireUserOptional(): Promise<SessionUser | null> {
  try {
    return await contextSessionUser()
  } catch {
    return null
  }
}

export async function requireRole(...roles: string[]): Promise<SessionUser> {
  const user = await requireUser()
  if (!hasRole(user, ...roles)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.')
  }
  return user
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.')
  }
  return schema.parse(json)
}

export function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local'
}
