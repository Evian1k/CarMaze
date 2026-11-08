import { db } from '@/lib/db'
import { isActorDemo } from '@/lib/request-context'
import { after } from 'next/server'
import { emailProviderConfigured, sendEmail } from '@/lib/providers/email'
import { smsProviderConfigured, sendSms } from '@/lib/providers/sms'

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

/** Initial attempt + 2 retries with backoff for external channels. */
const EXTERNAL_RETRY_MAX = 2

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
 * Run work after the response is sent when inside a request scope (Next.js
 * `after`), or as a detached background promise in other contexts (jobs,
 * scripts). Delivery records are written either way — only later.
 */
function scheduleExternal(fn: () => Promise<void>): void {
  try {
    after(() => fn())
  } catch {
    void fn().catch((e) => console.error('[notify] external delivery failed:', e))
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Provider-backed external channel delivery with retries. SENT is recorded
 * ONLY when the provider itself confirms acceptance of the message; every
 * other outcome is FAILED with the provider's own error detail.
 */
async function deliverExternal(
  notificationId: string,
  channel: 'EMAIL' | 'SMS',
  target: { email: string | null; phone: string | null },
  title: string,
  body: string
): Promise<void> {
  if (channel === 'EMAIL') {
    if (!target.email) {
      await db.notificationDelivery.create({
        data: { notificationId, channel, status: 'FAILED', attempts: 0, lastError: 'no email address on the account' },
      })
      return
    }
    if (!emailProviderConfigured()) {
      await db.notificationDelivery.create({
        data: { notificationId, channel, status: 'FAILED', attempts: 0, lastError: 'email provider not configured on this deployment (set SMTP_URL); in-app notification only' },
      })
      return
    }
    let attempts = 0
    let lastError = ''
    for (let i = 0; i <= EXTERNAL_RETRY_MAX; i++) {
      attempts++
      const result = await sendEmail({ to: target.email, subject: title, text: body || title })
      if (result.accepted) {
        await db.notificationDelivery.create({ data: { notificationId, channel, status: 'SENT', attempts, lastError: null } })
        return
      }
      lastError = result.detail
      if (i < EXTERNAL_RETRY_MAX) await sleep(1000 * 2 ** i)
    }
    await db.notificationDelivery.create({ data: { notificationId, channel, status: 'FAILED', attempts, lastError: lastError.slice(0, 300) } })
    return
  }

  // SMS
  if (!target.phone) {
    await db.notificationDelivery.create({
      data: { notificationId, channel, status: 'FAILED', attempts: 0, lastError: 'no phone number on the account' },
    })
    return
  }
  if (!smsProviderConfigured()) {
    await db.notificationDelivery.create({
      data: { notificationId, channel, status: 'FAILED', attempts: 0, lastError: 'sms provider not configured on this deployment (set SMS_PROVIDER + SMS_API_KEY); in-app notification only' },
    })
    return
  }
  let attempts = 0
  let lastError = ''
  for (let i = 0; i <= EXTERNAL_RETRY_MAX; i++) {
    attempts++
    const result = await sendSms({ to: target.phone, message: [title, body].filter(Boolean).join(' — ') })
    if (result.accepted) {
      await db.notificationDelivery.create({ data: { notificationId, channel, status: 'SENT', attempts, lastError: null } })
      return
    }
    lastError = result.detail
    if (i < EXTERNAL_RETRY_MAX) await sleep(1000 * 2 ** i)
  }
  await db.notificationDelivery.create({ data: { notificationId, channel, status: 'FAILED', attempts, lastError: lastError.slice(0, 300) } })
}

/**
 * Create an in-app notification (always recorded) and attempt provider-backed
 * EMAIL / SMS delivery.
 *
 * DELIVERY HONESTY: a delivery row says SENT only when the provider confirms
 * acceptance. Unconfigured channels record FAILED immediately with the exact
 * reason (attempts 0 — nothing was attempted); configured-but-failing
 * channels record the provider's error after retries. Nothing is ever marked
 * delivered on assumption.
 *
 * DEMO ISOLATION: when the acting user of the current request is a demo
 * account, notifications to NON-demo users are skipped entirely; a demo
 * session must never place anything in a real user's inbox (and must never
 * send real email/SMS). (Delivery to demo users proceeds normally, keeping
 * demo workflows functional.)
 */
export async function notify(input: NotifyInput): Promise<string | null> {
  // Central demo sandbox: demo actor → real target would leak into a real
  // user's account. Block before any record is created.
  if (await isActorDemo()) {
    if (!(await isDemoUser(input.userId))) {
      return null // silently skipped: demo actions must not reach real users
    }
  }

  const recipient = await db.user.findUnique({
    where: { id: input.userId },
    select: { email: true, phone: true },
  })
  if (!recipient) return null

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

  for (const channel of ['EMAIL', 'SMS'] as const) {
    const configured = channel === 'EMAIL' ? emailProviderConfigured() : smsProviderConfigured()
    const hasTarget = channel === 'EMAIL' ? Boolean(recipient.email) : Boolean(recipient.phone)
    if (!configured || !hasTarget) {
      // Record the honest not-delivered reason immediately: no attempt is made.
      const reason = !hasTarget
        ? `no ${channel === 'EMAIL' ? 'email address' : 'phone number'} on the account`
        : `${channel === 'EMAIL' ? 'email' : 'sms'} provider not configured on this deployment${channel === 'EMAIL' ? ' (set SMTP_URL)' : ' (set SMS_PROVIDER + SMS_API_KEY)'}; in-app notification only`
      await db.notificationDelivery.create({
        data: { notificationId: notification.id, channel, status: 'FAILED', attempts: 0, lastError: reason },
      })
    } else {
      scheduleExternal(() =>
        deliverExternal(notification.id, channel, { email: recipient.email, phone: recipient.phone }, input.title, input.body ?? '')
      )
    }
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
