import { db } from '@/lib/db'
import { route, ok, requireRole } from '@/lib/api'
import { STAFF_ROLES } from '@/lib/auth'
import { mpesaConfigured } from '@/lib/mpesa'

/**
 * GET /api/admin/ops — operations dashboard data:
 * failed notification deliveries, payment attempts, open support tickets and
 * honest integration flags recomputed inline (no cached health state).
 */
export const GET = route(async () => {
  await requireRole(...STAFF_ROLES)

  const [failedDeliveries, paymentAttempts, tickets] = await Promise.all([
    db.notificationDelivery.findMany({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { notification: { select: { title: true, type: true } } },
    }),
    db.paymentAttempt.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { invoice: { select: { refCode: true, status: true } } },
    }),
    db.supportTicket.findMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ])

  return ok({
    failedDeliveries: failedDeliveries.map((d) => ({
      id: d.id,
      channel: d.channel,
      status: d.status,
      lastError: d.lastError,
      notification: d.notification,
      createdAt: d.createdAt,
    })),
    paymentAttempts: paymentAttempts.map((p) => ({
      id: p.id,
      invoice: p.invoice,
      provider: p.provider,
      phone: p.phone,
      amountMinor: p.amountMinor,
      status: p.status,
      resultDesc: p.resultDesc,
      createdAt: p.createdAt,
    })),
    tickets,
    health: {
      mpesa: mpesaConfigured(),
      email: Boolean(process.env.SMTP_URL),
      sms: Boolean(process.env.SMS_API_KEY),
    },
  })
})
