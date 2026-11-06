import { db } from '@/lib/db'
import { isActorDemo } from '@/lib/request-context'

export type NotifyInput = {
  userId: string
  type: string
  title: string
  body?: string
  link?: string // hash route link e.g. /dealer
}

/** Cache of user demo flags within this process to avoid repeat lookups in
 * notify fan-out loops. Bounded, keyed by userId; demo flags never flip for an
 * existing user id, and a stale value only survives until the next process. */
const demoFlagCache = new Map<string, boolean>()

async function isDemoUser(userId: string): Promise<boolean> {
  const cached = demoFlagCache.get(userId)
  if (cached !== undefined) return cached
  const user = await db.user.findUnique({ where: { id: userId }, select: { isDemo: true } })
  const demo = Boolean(user?.isDemo)
  if (demoFlagCache.size > 5000) demoFlagCache.clear()
  demoFlagCache.set(userId, demo)
  return demo
}

/**
 * Create an in-app notification (always "SENT") and record honest delivery
 * attempts for EMAIL / SMS channels. No email/SMS provider is configured in
 * this deployment, so those channels are recorded as FAILED with the reason —
 * we never claim an email or SMS was delivered when it was not.
 *
 * DEMO ISOLATION: when the acting user of the current request is a demo
 * account, notifications to NON-demo users are skipped entirely — a demo
 * session must never place anything in a real user's inbox. (Delivery to demo
 * users proceeds normally, keeping demo workflows functional.)
 */
export async function notify(input: NotifyInput): Promise<string | null> {
  // Central demo sandbox: demo actor → real target would leak into a real
  // user's account. Block before any record is created.
  if (await isActorDemo()) {
    if (!(await isDemoUser(input.userId))) {
      return null // silently skipped — demo actions must not reach real users
    }
  }

  const notification = await db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      deliveries: { create: { channel: 'IN_APP', status: 'SENT', attempts: 1 } },
    },
  })

  // HONESTY GUARD: there is NO email/SMS sending implementation in this
  // codebase (no SMTP client, no SMS gateway integration, no queue consumer).
  // Even if SMTP_URL / SMS_API_KEY were set, nothing would ever deliver, so we
  // must NEVER record QUEUED/SENT for these channels — that would claim a
  // delivery that cannot happen. Channels stay FAILED with the exact reason
  // until a real provider integration + queue worker exists.
  const EXTERNAL_CHANNELS_IMPLEMENTED = false

  for (const channel of ['EMAIL', 'SMS'] as const) {
    await db.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        channel,
        status: 'FAILED',
        attempts: 1,
        lastError: EXTERNAL_CHANNELS_IMPLEMENTED
          ? null
          : `${channel.toLowerCase()} delivery is not implemented on this deployment — in-app notification only`,
      },
    })
  }
  return notification.id
}

export async function notifyMany(userIds: string[], input: Omit<NotifyInput, 'userId'>): Promise<void> {
  const unique = [...new Set(userIds)]
  for (const userId of unique) {
    try {
      await notify({ ...input, userId })
    } catch (e) {
      console.error('[notify] failed for user', userId, e)
    }
  }
}
