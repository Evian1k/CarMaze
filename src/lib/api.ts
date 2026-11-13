import { NextRequest, NextResponse } from 'next/server'
import { ZodError, ZodType } from 'zod'
import { Prisma } from '@prisma/client'
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
      // A malformed record id (e.g. GET /api/orders/xyz) is a Prisma P2023
      // validation error, which used to surface as JSON 500 noise from any
      // low-privilege caller. It is a lookup miss, not a server fault: 404.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2023') {
        return fail(404, 'NOT_FOUND', 'The requested record does not exist.')
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

/** Session user or null: for endpoints that change for signed-in users but
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
  // Rate-limit keys must not be spoofable: a client can forge its own first
  // X-Forwarded-For entry, but the LAST entry is appended by our own trusted
  // edge proxy. Prefer it; fall back to x-real-ip, then to 'local'.
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }
  return req.headers.get('x-real-ip') || 'local'
}
