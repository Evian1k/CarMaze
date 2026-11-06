import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

const SESSION_COOKIE = 'carmaze_session'
const SESSION_DAYS = 7

// Dev fallback secret — in production always set AUTH_SECRET env var.
const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'carmaze-dev-secret-change-in-production'
)

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

export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret)
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
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
  createdAt: Date
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const store = await cookies()
    const token = store.get(SESSION_COOKIE)?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, secret)
    const userId = payload.sub
    if (!userId) return null
    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user || user.status !== 'ACTIVE') return null
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
