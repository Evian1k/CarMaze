import { db } from '@/lib/db'
import { notifyMany, type NotifyInput } from '@/lib/notify'

/** Roles that receive inbound-message notifications for an org inbox. */
export const INBOX_NOTIFY_ROLES = ['OWNER', 'MANAGER', 'SALES', 'STAFF'] as const

export async function getMembership(orgId: string, userId: string) {
  return db.orgMember.findFirst({ where: { orgId, userId } })
}

/** Notify the members of an org (optionally restricted to roles). */
export async function notifyOrgMembers(orgId: string, input: Omit<NotifyInput, 'userId'>, roles?: readonly string[]): Promise<void> {
  const members = await db.orgMember.findMany({
    where: { orgId, ...(roles ? { role: { in: [...roles] } } : {}) },
    select: { userId: true },
  })
  await notifyMany(members.map((m) => m.userId), input)
}

/** Dashboard inbox link for an org, matching the app's hash router. */
export function orgInboxLink(orgType: string): string {
  return orgType === 'GARAGE' ? '/garage-dashboard?tab=inbox' : '/dealer?tab=inbox'
}

/**
 * Platform staff user ids whose role list contains any of the given role
 * names. Roles are stored as a comma-separated string on User.roles.
 */
export async function staffUserIds(...roleNames: string[]): Promise<string[]> {
  if (roleNames.length === 0) return []
  const users = await db.user.findMany({
    where: { OR: roleNames.map((r) => ({ roles: { contains: r } })) },
    select: { id: true },
  })
  return users.map((u) => u.id)
}
