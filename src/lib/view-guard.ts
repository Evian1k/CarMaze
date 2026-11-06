import type { CurrentUser } from '@/stores/auth'
import { hasAnyRole, isStaffUser } from '@/stores/auth'

/**
 * Central role-aware view protection.
 *
 * This is UX-level routing: it decides which views render for the current
 * session and which produce an access-denied screen. It is deliberately NOT
 * the security boundary: every API behind these views re-checks role, org
 * membership and resource ownership server-side (deny-by-default). A user who
 * tampers with the frontend at worst sees an empty shell; they can never read
 * or mutate another role's data.
 */

export type ViewGuard =
  | { kind: 'public' }
  | { kind: 'auth' } // any signed-in user
  | { kind: 'roles'; roles: string[] }

export const VIEW_GUARDS: Record<string, ViewGuard> = {
  // Business operating systems: strictly the matching org role.
  dealer: { kind: 'roles', roles: ['DEALER_OWNER', 'DEALER_STAFF'] },
  'garage-dashboard': { kind: 'roles', roles: ['GARAGE_OWNER', 'GARAGE_STAFF'] },
  supplier: { kind: 'roles', roles: ['SUPPLIER_OWNER', 'SUPPLIER_STAFF'] },
  procurement: { kind: 'roles', roles: ['GARAGE_OWNER', 'GARAGE_STAFF'] },
  logistics: { kind: 'roles', roles: ['LOGISTICS_OWNER'] },
  admin: { kind: 'roles', roles: ['SUPPORT', 'REVIEWER', 'MODERATOR', 'FINANCE', 'ADMIN', 'FOUNDER'] },
  // Personal workspaces: any signed-in user (data itself is server-scoped).
  account: { kind: 'auth' },
  'my-listings': { kind: 'auth' },
  'my-garage': { kind: 'auth' },
}

export type GuardVerdict =
  | { access: 'granted' }
  | { access: 'denied'; reason: 'unauthenticated' }
  | { access: 'denied'; reason: 'forbidden' }

export function checkViewAccess(view: string, user: CurrentUser | null, loading: boolean): GuardVerdict {
  const guard = VIEW_GUARDS[view]
  if (!guard) return { access: 'granted' }
  if (loading) return { access: 'granted' } // session still loading: render shell, not a false denial
  if (guard.kind === 'auth') {
    return user ? { access: 'granted' } : { access: 'denied', reason: 'unauthenticated' }
  }
  if (guard.kind === 'roles') {
    if (!user) return { access: 'denied', reason: 'unauthenticated' }
    return hasAnyRole(user, ...guard.roles) ? { access: 'granted' } : { access: 'denied', reason: 'forbidden' }
  }
  return { access: 'granted' }
}

/** Home dashboard route for a role; used by the access-denied "safe way back". */
export function dashboardFor(user: CurrentUser | null): string {
  if (!user) return 'signin'
  if (hasAnyRole(user, 'DEALER_OWNER', 'DEALER_STAFF')) return 'dealer'
  if (hasAnyRole(user, 'GARAGE_OWNER', 'GARAGE_STAFF')) return 'garage-dashboard'
  if (hasAnyRole(user, 'SUPPLIER_OWNER', 'SUPPLIER_STAFF')) return 'supplier'
  if (hasAnyRole(user, 'LOGISTICS_OWNER')) return 'logistics'
  if (isStaffUser(user)) return 'admin'
  if (hasAnyRole(user, 'SELLER', 'SELLER_VERIFIED')) return 'my-listings'
  return 'account'
}
