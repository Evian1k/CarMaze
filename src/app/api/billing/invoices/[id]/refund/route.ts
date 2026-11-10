import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireRole } from '@/lib/api'
import { assertNotDemoActor } from '@/lib/demo'
import { audit } from '@/lib/audit'

type Ctx = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  reason: z.string().trim().min(10, 'A refund reason is required (at least 10 characters)').max(500),
})

/**
 * POST /api/billing/invoices/[id]/refund: FINANCE / ADMIN / FOUNDER only.
 *
 * Records a genuine refund of a PAID invoice. Money has left the platform, so
 * the entitlement it bought ends too (honest accounting, not silent bookkeeping):
 *  - Invoice status → REFUNDED. paidAt is kept as the historical payment date;
 *    the reason lives ONLY in the audit metadata, never on the invoice row.
 *  - SUBSCRIPTION invoice → if the org's subscription is ACTIVE with a
 *    currentPeriodEnd in the future, it is set to CANCELLED: the paid period
 *    is returned, so the entitlement ends immediately.
 *  - CAMPAIGN invoice → any Campaign linked to this invoice that is currently
 *    ACTIVE is set to ENDED (endsAt = now), same as ending it manually.
 *
 * The acting staff member and the written reason are mandatory and
 * audit-logged (INVOICE_REFUNDED). The org owner is notified in-app.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireRole('FINANCE', 'ADMIN', 'FOUNDER')
  // Refunds move real money and end paid entitlements: never available from a
  // demo session, even when the invoice belongs to the demo ecosystem.
  assertNotDemoActor(user, 'invoice refunds')
  const { id } = await ctx.params
  const body = await parseBody(req, bodySchema)

  const invoice = await db.invoice.findUnique({ where: { id } })
  if (!invoice) throw new ApiError(404, 'NOT_FOUND', 'Invoice not found.')
  if (invoice.status === 'REFUNDED') {
    return fail(409, 'ALREADY_REFUNDED', `Invoice ${invoice.refCode} was already refunded.`)
  }
  if (invoice.status !== 'PAID') {
    return fail(409, 'INVALID_STATE', `Only PAID invoices can be refunded: invoice ${invoice.refCode} is ${invoice.status}.`)
  }

  const result = await db.$transaction(async (tx) => {
    // 1. The invoice itself: status only. paidAt/paidVia stay as the
    //    historical payment record; the reason is audit material, not invoice data.
    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: 'REFUNDED' },
    })

    // 2. Entitlement cascade: money returned ⇒ entitlement ends.
    let subscriptionCancelled = false
    let campaignsEnded = 0

    if (invoice.type === 'SUBSCRIPTION' && invoice.orgId) {
      const sub = await tx.subscription.findUnique({ where: { orgId: invoice.orgId } })
      if (sub && sub.status === 'ACTIVE' && sub.currentPeriodEnd > new Date()) {
        await tx.subscription.update({
          where: { orgId: invoice.orgId },
          data: { status: 'CANCELLED' },
        })
        subscriptionCancelled = true
      }
    }

    if (invoice.type === 'CAMPAIGN') {
      const ended = await tx.campaign.updateMany({
        where: { invoiceId: invoice.id, status: 'ACTIVE' },
        data: { status: 'ENDED', endsAt: new Date() },
      })
      campaignsEnded = ended.count
    }

    // 3. Parts-order invoice → the linked consumer order settles as refunded.
    let customerOrderSettled = false
    if (invoice.type === 'PARTS_ORDER') {
      const order = await tx.customerOrder.findFirst({ where: { invoiceId: invoice.id } })
      if (order) {
        await tx.customerOrder.update({
          where: { id: order.id },
          data: { paymentStatus: 'REFUNDED', status: 'COMPLETED', completedAt: order.completedAt ?? new Date() },
        })
        await tx.customerOrderEvent.create({
          data: { orderId: order.id, type: 'NOTE', actorSide: 'SYSTEM', actorName: user.name, note: `Invoice ${invoice.refCode} refunded. Order settled as refunded.` },
        })
        customerOrderSettled = true
      }
    }

    return { invoice: updated, subscriptionCancelled, campaignsEnded, customerOrderSettled }
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'INVOICE_REFUNDED',
    targetType: 'INVOICE',
    targetId: invoice.refCode,
    metadata: {
      refCode: invoice.refCode,
      amountMinor: invoice.amountMinor,
      currency: invoice.currency,
      type: invoice.type,
      reason: body.reason,
      subscriptionCancelled: result.subscriptionCancelled,
      campaignsEnded: result.campaignsEnded,
      customerOrderSettled: result.customerOrderSettled,
    },
  })

  // Notify the org owner (if the invoice belongs to an organisation).
  if (invoice.orgId) {
    const owners = await db.orgMember.findMany({
      where: { orgId: invoice.orgId, role: 'OWNER' },
      select: { userId: true },
    })
    const { notifyMany } = await import('@/lib/notify')
    await notifyMany(owners.map((o) => o.userId), {
      type: 'INVOICE_REFUNDED',
      title: `Invoice ${invoice.refCode} refunded`,
      body: `Invoice ${invoice.refCode} (${(invoice.amountMinor / 100).toLocaleString()} ${invoice.currency}) has been refunded by the CARMAZE team. Reason: ${body.reason}${
        result.subscriptionCancelled ? ' Your subscription has been cancelled with immediate effect.' : ''
      }${result.campaignsEnded > 0 ? ` ${result.campaignsEnded} active campaign(s) linked to this invoice have ended.` : ''}`,
      link: '/dealer?tab=billing',
    })
  }

  // Notify the buyer when a consumer parts-order settles as refunded.
  if (result.customerOrderSettled) {
    const { notify } = await import('@/lib/notify')
    if (invoice.userId) {
      await notify({
        userId: invoice.userId,
        type: 'INVOICE_REFUNDED',
        title: `Refund processed: invoice ${invoice.refCode}`,
        body: `Your parts-order refund has been processed (${(invoice.amountMinor / 100).toLocaleString()} ${invoice.currency}). The order is now settled. Reason: ${body.reason}`,
        link: '/account?tab=orders',
      })
    }
  }

  return ok({
    invoice: result.invoice,
    subscriptionCancelled: result.subscriptionCancelled,
    campaignsEnded: result.campaignsEnded,
    customerOrderSettled: result.customerOrderSettled,
  })
})
