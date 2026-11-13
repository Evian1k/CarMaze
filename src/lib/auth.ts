import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

const SESSION_COOKIE = 'carmaze_session'
const SESSION_DAYS = 7
/** Default demo session lifetime: 2 weeks. */
export const DEMO_SESSION_MINUTES_DEFAULT = 14 * 24 * 60

// Session signing secret.
// PRODUCTION: AUTH_SECRET is mandatory and must be >= 32 characters — the
// module fails fast at FIRST USE (session creation/verification) rather than
// silently running with a known value. Resolution is lazy so `next build`
// (which evaluates route modules with NODE_ENV=production to collect page
// data) still succeeds on machines that legitimately hold no secret.
// DEVELOPMENT: a clearly-named dev fallback keeps the sandbox usable.
let cachedAuthSecret: string | null = null
function resolveAuthSecret(): string {
  if (cachedAuthSecret) return cachedAuthSecret
  const provided = process.env.AUTH_SECRET
  if (provided && provided.length >= 32) {
    cachedAuthSecret = provided
    return provided
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_SECRET is not configured: set a strong (>= 32 character) AUTH_SECRET environment variable before running in production.'
    )
  }
  console.warn('[auth] AUTH_SECRET not set — using the development fallback secret. NEVER run in production like this.')
  cachedAuthSecret = 'carmaze-dev-secret-change-in-production'
  return cachedAuthSecret
}

/**
 * Raw AUTH_SECRET string — also used to derive sub-keys (e.g. secret-box).
 * Lazy: throws at first call in production when AUTH_SECRET is missing.
 */
export function authSecret(): string {
  return resolveAuthSecret()
}
const secret = () => new TextEncoder().encode(resolveAuthSecret())

export const ROLE = {
  CUSTOMER: 'CUSTOMER',
  SELLER: 'SELLER',
  SELLER_VERIFIED: 'SELLER_VERIFIED',
  DEALER_OWNER: 'DEALER_OWNER',
  DEALER_STAFF: 'DEALER_STAFF',
  GARAGE_OWNER: 'GARAGE_OWNER',
  GARAGE_STAFF: 'GARAGE_STAFF',
  SUPPLIER_OWNER: 'SUPPLIER_OWNER',
  SUPPLIER_STAFF: 'SUPPLIER_STAFF',
  LOGISTICS_OWNER: 'LOGISTICS_OWNER',
  SUPPORT: 'SUPPORT',
  REVIEWER: 'REVIEWER',
  MODERATOR: 'MODERATOR',
  FINANCE: 'FINANCE',
  ADMIN: 'ADMIN',
  FOUNDER: 'FOUNDER',
} as const

export type Role = (typeof ROLE)[keyof typeof ROLE]

export const STAFF_ROLES: string[] = [ROLE.SUPPORT, ROLE.REVIEWER, ROLE.MODERATOR, ROLE.FINANCE, ROLE.ADMIN, ROLE.FOUNDER]

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export async function createSession(userId: string, opts?: { maxAgeSeconds?: number; demoRole?: string }): Promise<void> {
  const maxAgeSeconds = opts?.maxAgeSeconds ?? SESSION_DAYS * 24 * 60 * 60
  // Session revocation: the token carries the user's current sessionVersion.
  // Password reset / MFA disable increments it, instantly invalidating every
  // previously issued token for that account (checked on every request).
  const account = await db.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } })
  const claims: Record<string, unknown> = { sub: userId, sv: account?.sessionVersion ?? 0 }
  if (opts?.demoRole) claims.demo = opts.demoRole
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${Math.floor(maxAgeSeconds)}s`)
    .sign(secret())
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: maxAgeSeconds,
    path: '/',
  })
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

export type SessionUser = {
  id: string
  email: string
  name: string
  phone: string | null
  phoneVerified: boolean
  emailVerified: boolean
  mfaEnabled: boolean
  department: string | null
  roles: string[]
  status: string
  isDemo: boolean
  marketingConsent: boolean
  createdAt: Date
}

/** Demo-scope info carried inside the session JWT (decoded, not trusted for
 * authorisation: role checks always re-read the user from the database). */
export type SessionDemoInfo = { active: true; roleKey: string; expiresAt: string } | null

export async function getSessionDemoInfo(): Promise<SessionDemoInfo> {
  try {
    const store = await cookies()
    const token = store.get(SESSION_COOKIE)?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, secret())
    if (typeof payload.demo !== 'string' || !payload.exp) return null
    return { active: true, roleKey: payload.demo, expiresAt: new Date(payload.exp * 1000).toISOString() }
  } catch {
    return null
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const store = await cookies()
    const token = store.get(SESSION_COOKIE)?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, secret())
    const userId = payload.sub
    if (!userId) return null
    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user || user.status !== 'ACTIVE') return null
    // Session revocation: a token issued before the latest password reset /
    // MFA change carries a stale sessionVersion and is rejected here.
    if (typeof payload.sv === 'number' && payload.sv !== user.sessionVersion) return null
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      phoneVerified: user.phoneVerified,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      department: user.department,
      roles: user.roles.split(',').filter(Boolean),
      status: user.status,
      isDemo: user.isDemo,
      marketingConsent: user.marketingConsent,
      createdAt: user.createdAt,
    }
  } catch {
    return null
  }
}

export function hasRole(user: SessionUser | null, ...roles: string[]): boolean {
  if (!user) return false
  return roles.some((r) => user.roles.includes(r))
}

export function isStaff(user: SessionUser | null): boolean {
  return hasRole(user, ...STAFF_ROLES)
}
