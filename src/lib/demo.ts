import { db } from '@/lib/db'
import { createSession, type SessionUser } from '@/lib/auth'
import { ApiError } from '@/lib/api'
import { audit } from '@/lib/audit'

/**
 * CARMAZE demo-experience system — server side.
 *
 * Design rules (enforced here, never in the frontend):
 *  1. Credentials never reach the client. The sign-in page only ever sends a
 *     roleKey; this module maps it to the seeded demo account server-side.
 *  2. Demo sessions carry a `demo` JWT claim and a short, configurable lifetime.
 *  3. Demo accounts are real accounts with real roles — they do NOT bypass any
 *     permission. On top of normal RBAC, sandbox guards limit what demo users
 *     may touch (see assertDemoResourceGuard / demoStaffMutationGuard).
 *  4. Side effects that would reach the real world (notifications to real
 *     users, M-Pesa STK pushes) are blocked centrally for demo actors.
 */

export type DemoRoleKey =
  | 'customer'
  | 'private-seller'
  | 'showroom-owner'
  | 'showroom-staff'
  | 'garage-owner'
  | 'garage-staff'
  | 'platform-support'
  | 'platform-admin'

/** What the sign-in page may display. NEVER includes credentials. */
export type DemoCatalogEntry = {
  roleKey: DemoRoleKey
  label: string
  description: string
  icon: string
  dashboard: string
  restrictedNote: string | null
}

/** Server-side definitions. Emails here are resolved against the database. */
const DEFINITIONS: Record<DemoRoleKey, { email: string; label: string; description: string; icon: string; dashboard: string; restrictedNote: string | null }> = {
  'customer': {
    email: 'customer@carmaze.co.ke',
    label: 'Customer Demo',
    description: 'Browse the marketplace, save vehicles, compare, enquire, book garage services and track everything from your dashboard.',
    icon: 'user',
    dashboard: 'cars',
    restrictedNote: null,
  },
  'private-seller': {
    email: 'seller@carmaze.co.ke',
    label: 'Private Seller Demo',
    description: 'Manage your own vehicle listings, see listing approval status, handle enquiries and follow your own seller analytics.',
    icon: 'car',
    dashboard: 'my-listings',
    restrictedNote: null,
  },
  'showroom-owner': {
    email: 'dealer@carmaze.co.ke',
    label: 'Showroom Owner Demo',
    description: 'Run DealerOS for Nairobi Auto Hub: inventory, enquiries, test drives, staff, billing and business analytics.',
    icon: 'building',
    dashboard: 'dealer',
    restrictedNote: null,
  },
  'showroom-staff': {
    email: 'staff@carmaze.co.ke',
    label: 'Showroom Staff Demo',
    description: 'Work the assigned sales tools in DealerOS — enquiries, conversations and test drives — without owner-level access to billing or settings.',
    icon: 'id-card',
    dashboard: 'dealer',
    restrictedNote: null,
  },
  'garage-owner': {
    email: 'garage@carmaze.co.ke',
    label: 'Garage Owner Demo',
    description: 'Run GarageOS for Premium Motors Garage: quotes, bookings, technicians, procurement, subscriptions and garage analytics.',
    icon: 'wrench',
    dashboard: 'garage-dashboard',
    restrictedNote: null,
  },
  'garage-staff': {
    email: 'garage.staff@carmaze.co.ke',
    label: 'Garage Staff Demo',
    description: 'Assigned garage operations only — bookings, job progress and customer conversations. No billing, staff management or financials.',
    icon: 'hard-hat',
    dashboard: 'garage-dashboard',
    restrictedNote: null,
  },
  'platform-support': {
    email: 'support@carmaze.co.ke',
    label: 'Platform Support Demo',
    description: 'Support portal: customer tickets, complaint resolution and escalation workflows for the Support department.',
    icon: 'headset',
    dashboard: 'admin?tab=support',
    restrictedNote: null,
  },
  'platform-admin': {
    email: 'demo.admin@carmaze.co.ke',
    label: 'Platform Admin Demo',
    description: 'Restricted admin tour of the Operations OS — verification queues, moderation and analytics. Financial and security actions are disabled in demo mode.',
    icon: 'shield',
    dashboard: 'admin',
    restrictedNote: 'Restricted to authorised internal testing. Financial actions, staff management and platform-wide configuration are disabled for this demo account.',
  },
}

export const DEMO_ROLE_KEYS = Object.keys(DEFINITIONS) as DemoRoleKey[]

/** Demo session lifetime bounds.
 * Default and hard maximum: 2 weeks (14 days = 20160 minutes). Administrators
 * may configure anything between 15 minutes and this cap per demo role. */
export const DEMO_SESSION_MINUTES_MAX = 14 * 24 * 60
export const DEMO_SESSION_MINUTES_DEFAULT = DEMO_SESSION_MINUTES_MAX

function isDemoRoleKey(v: string): v is DemoRoleKey {
  return Object.prototype.hasOwnProperty.call(DEFINITIONS, v)
}

/** Public catalog for the sign-in page — only ENABLED roles, no credentials. */
export async function demoCatalog(): Promise<DemoCatalogEntry[]> {
  const rows = await db.demoAccount.findMany({ where: { enabled: true } })
  const out: DemoCatalogEntry[] = []
  for (const key of DEMO_ROLE_KEYS) {
    const row = rows.find((r) => r.roleKey === key)
    if (!row || !row.enabled) continue
    const def = DEFINITIONS[key]
    out.push({
      roleKey: key,
      label: row.label || def.label,
      description: row.description || def.description,
      icon: def.icon,
      dashboard: row.dashboard || def.dashboard,
      restrictedNote: row.restrictedNote ?? def.restrictedNote,
    })
  }
  return out
}

/** Create a secure server-side demo session for a roleKey. */
export async function startDemoSession(roleKeyRaw: string, ip: string): Promise<{ dashboard: string; label: string; expiresAt: string }> {
  if (!isDemoRoleKey(roleKeyRaw)) {
    throw new ApiError(400, 'UNKNOWN_DEMO_ROLE', 'That demo role does not exist.')
  }
  const roleKey = roleKeyRaw
  const row = await db.demoAccount.findUnique({ where: { roleKey } })
  if (!row || !row.enabled) {
    throw new ApiError(403, 'DEMO_DISABLED', 'This demo account is currently disabled by the platform team.')
  }
  const def = DEFINITIONS[roleKey]
  const user = await db.user.findUnique({ where: { email: def.email } })
  if (!user || user.status !== 'ACTIVE') {
    throw new ApiError(503, 'DEMO_UNAVAILABLE', 'The demo account for this role is unavailable. Try again shortly.')
  }
  if (!user.isDemo) {
    // Integrity check: the registry may only ever sign into demo-marked users.
    throw new ApiError(500, 'DEMO_MISCONFIGURED', 'Demo configuration error. The platform team has been notified.')
  }

  const maxAgeSeconds = Math.max(15, Math.min(row.sessionMinutes, DEMO_SESSION_MINUTES_MAX)) * 60
  await createSession(user.id, { maxAgeSeconds, demoRole: roleKey })
  await audit({ action: 'DEMO_LOGIN', targetType: 'USER', targetId: user.id, metadata: { roleKey, ip } })

  return {
    dashboard: row.dashboard || def.dashboard,
    label: row.label || def.label,
    expiresAt: new Date(Date.now() + maxAgeSeconds * 1000).toISOString(),
  }
}

// ─────────────────────────── Sandbox guards ───────────────────────────

const DEMO_SANDBOX_MESSAGE =
  'Demo mode: this action would affect real platform data, so it has been blocked. Demo accounts can safely explore and test using demo data only.'

/** Throw when a demo user attempts to act on a resource that is NOT demo-owned.
 * Ownership is checked server-side from database rows — never from client input. */
export async function assertDemoResourceGuard(user: SessionUser, target: { ownerId?: string | null; orgId?: string | null }): Promise<void> {
  if (!user.isDemo) return
  const owns = await demoActorOwnsResource(target)
  if (!owns) throw new ApiError(403, 'DEMO_SANDBOXED', DEMO_SANDBOX_MESSAGE)
}

/** Does the demo ecosystem own this resource? (owner user is demo-marked, or
 * the owning org is demo-marked). Missing references count as unowned. */
export async function demoActorOwnsResource(target: { ownerId?: string | null; orgId?: string | null }): Promise<boolean> {
  if (target.ownerId) {
    const owner = await db.user.findUnique({ where: { id: target.ownerId }, select: { isDemo: true } })
    return Boolean(owner?.isDemo)
  }
  if (target.orgId) {
    const org = await db.org.findUnique({ where: { id: target.orgId }, select: { isDemo: true } })
    return Boolean(org?.isDemo)
  }
  return false
}

/**
 * Platform-level mutation guard for STAFF endpoints.
 * Demo staff may explore read-only everywhere and may only mutate records whose
 * subject is part of the demo ecosystem — verified from the database. Platform-
 * wide configuration, financial reconciliation and staff-account management are
 * never allowed for demo users.
 */
export async function demoStaffMutationGuard(user: SessionUser, opts: { subjectUserId?: string | null; subjectOrgId?: string | null; platformWide?: boolean }): Promise<void> {
  if (!user.isDemo) return
  if (opts.platformWide) throw new ApiError(403, 'DEMO_SANDBOXED', DEMO_SANDBOX_MESSAGE)
  // The subject must exist AND belong to the demo ecosystem.
  if (opts.subjectUserId) {
    const subject = await db.user.findUnique({ where: { id: opts.subjectUserId }, select: { isDemo: true } })
    if (subject?.isDemo) return
  }
  if (opts.subjectOrgId) {
    const org = await db.org.findUnique({ where: { id: opts.subjectOrgId }, select: { isDemo: true } })
    if (org?.isDemo) return
  }
  throw new ApiError(403, 'DEMO_SANDBOXED', DEMO_SANDBOX_MESSAGE)
}

/** Blocking guard for actions that are never allowed from a demo session —
 * used for payment initiation and other real-world side effects. */
export function assertNotDemoActor(user: SessionUser | null, action: string): void {
  if (user?.isDemo) {
    throw new ApiError(403, 'DEMO_SANDBOXED', `Demo mode: ${action} is disabled. Real M-Pesa payments are never triggered by demo accounts.`)
  }
}
