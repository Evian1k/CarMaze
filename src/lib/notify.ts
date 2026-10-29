import { db } from '@/lib/db'

export type NotifyInput = {
  userId: string
  type: string
  title: string
  body?: string
  link?: string // hash route link e.g. /dealer
}

/**
 * Create an in-app notification (always "SENT") and record honest delivery
 * attempts for EMAIL / SMS channels. No email/SMS provider is configured in
 * this deployment, so those channels are recorded as FAILED with the reason —
 * we never claim an email or SMS was delivered when it was not.
 */
export async function notify(input: NotifyInput): Promise<string> {
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

  const emailConfigured = Boolean(process.env.SMTP_URL)
  const smsConfigured = Boolean(process.env.SMS_API_KEY)

  for (const [channel, configured] of [['EMAIL', emailConfigured], ['SMS', smsConfigured]] as const) {
    await db.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        channel,
        status: configured ? 'QUEUED' : 'FAILED',
        attempts: 1,
        lastError: configured ? null : `${channel.toLowerCase()} provider not configured on this deployment`,
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
