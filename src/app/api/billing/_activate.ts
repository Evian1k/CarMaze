import { db } from '@/lib/db'
import { audit } from '@/lib/audit'
import { notifyMany, notify } from '@/lib/notify'
import { refCode } from '@/lib/ids'

/**
 * Audit helper for confirmed payments. Safe to call from both the automatic
 * M-Pesa callback (no actor) and manual reconciliation (acting staff member).
 */
export async function auditPaymentConfirmed(params: {
  refCode: string
  amountMinor: number
  paidVia: 'MPESA' | 'MANUAL'
  note?: string
  actorId?: string
  actorName?: string
  campaignActivated?: string | null
  subscriptionActivated?: string | null
}): Promise<void> {
  await audit({
    actorId: params.actorId ?? null,
    actorName: params.actorName ?? (params.paidVia === 'MPESA' ? 'M-Pesa callback' : 'Manual reconciliation'),
    action: 'INVOICE_PAID',
    targetType: 'INVOICE',
    targetId: params.refCode,
    metadata: {
      refCode: params.refCode,
      paidVia: params.paidVia,
      note: params.note ?? null,
      amountMinor: params.amountMinor,
      campaignActivated: params.campaignActivated ?? null,
      subscriptionActivated: params.subscriptionActivated ?? null,
    },
  })
}

/**
 * Shared paid-invoice activation logic used by manual reconciliation
 * (mark-paid) and the M-Pesa Daraja callback. Parses the plan code from the
 * invoice description "[plan:<code>]" suffix written by /api/billing/subscribe.
 */
export async function activatePaidInvoice(
  invoiceId: string,
  paidVia: 'MPESA' | 'MANUAL',
  note?: string
): Promise<{
  activatedSubscription: string | null
  activatedCampaign: string | null
  activatedMembership: string | null
  protectedOrder: string | null
  invoice: { id: string; refCode: string; amountMinor: number; currency: string; type: string }
}> {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } })
  if (!invoice) throw new Error('Invoice not found')

  await db.invoice.update({
    where: { id: invoice.id },
    data: { status: 'PAID', paidAt: new Date(), paidVia },
  })

  let activatedSubscription: string | null = null
  let activatedCampaign: string | null = null
  let activatedMembership: string | null = null
  let protectedOrder: string | null = null

  if (invoice.type === 'SUBSCRIPTION' && invoice.orgId) {
    // planCode is embedded by subscribe route as "[plan:<code>]" in the description
    const match = /\[plan:([a-z0-9-]+)\]/i.exec(invoice.description)
    const planCode = match?.[1] ?? null
    const periodEnd =
      invoice.periodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const existing = await db.subscription.findUnique({ where: { orgId: invoice.orgId } })
    if (existing) {
      await db.subscription.update({
        where: { orgId: invoice.orgId },
        data: { planCode: planCode ?? existing.planCode, status: 'ACTIVE', currentPeriodEnd: periodEnd },
      })
    } else if (planCode) {
      await db.subscription.create({
        data: { orgId: invoice.orgId, planCode, status: 'ACTIVE', startedAt: new Date(), currentPeriodEnd: periodEnd },
      })
    }
    activatedSubscription = planCode
  }

  if (invoice.type === 'CAMPAIGN') {
    const campaign = await db.campaign.findFirst({ where: { invoiceId: invoice.id } })
    if (campaign && campaign.status === 'PENDING_PAYMENT') {
      const pkg = await db.campaignPackage.findUnique({ where: { code: campaign.packageCode } })
      const days = pkg?.days ?? 7
      const now = new Date()
      await db.campaign.update({
        where: { id: campaign.id },
        data: { status: 'ACTIVE', startsAt: now, endsAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000) },
      })
      activatedCampaign = campaign.refCode
    }
  }

  // Business membership: activate only on real payment confirmation.
  if (invoice.type === 'MEMBERSHIP') {
    const match = /\[membership:([^\]]+)\]/.exec(invoice.description)
    const membershipId = match?.[1]
    if (membershipId) {
      const membership = await db.businessMembership.findUnique({ where: { id: membershipId }, include: { tier: { select: { name: true } }, org: { select: { name: true, type: true } } } })
      if (membership && membership.status === 'PENDING_PAYMENT') {
        const periodEnd = invoice.periodEnd ?? new Date(Date.now() + 30 * 24 * 3600 * 1000)
        await db.businessMembership.update({
          where: { id: membership.id },
          data: { status: 'ACTIVE', startedAt: new Date(), currentPeriodEnd: periodEnd },
        })
        activatedMembership = membership.refCode
        // Notify business staff + customer
        const staff = await db.orgMember.findMany({ where: { orgId: membership.orgId }, select: { userId: true } })
        await notifyMany(staff.map((m) => m.userId), {
          type: 'MEMBERSHIP_ACTIVE',
          title: `Membership active: ${membership.tier.name}`,
          body: `${invoice.refCode} paid. New member joined ${membership.tier.name}.`,
          link: membership.org.type === 'GARAGE' ? '/garage-dashboard?tab=memberships' : '/dealer?tab=memberships',
        })
        await notify({ userId: membership.customerId, type: 'MEMBERSHIP_ACTIVE', title: `Membership active: ${membership.tier.name}`, body: 'Your membership is now active. Benefits are available at participating branches.', link: '/account?tab=subscriptions' })
      }
    }
  }

  // Protected order payment: only a provider-confirmed payment sets PROTECTED.
  if (invoice.type === 'ORDER_PAYMENT') {
    const order = await db.purchaseOrder.findFirst({ where: { invoiceId: invoice.id } })
    if (order && order.paymentStatus !== 'PROTECTED' && order.paymentStatus !== 'RELEASED') {
      await db.paymentAuthorization.upsert({
        where: { orderId: order.id },
        create: {
          refCode: refCode('PAY', 6), orderId: order.id, provider: 'MPESA_DARAJA', status: 'PROTECTED',
          amountMinor: order.totalMinor, protectedAt: new Date(), resultDesc: 'Confirmed via payment callback',
        },
        update: { status: 'PROTECTED', protectedAt: new Date(), resultDesc: 'Confirmed via payment callback' },
      })
      await db.purchaseOrder.update({ where: { id: order.id }, data: { paymentStatus: 'PROTECTED' } })
      protectedOrder = order.refCode
      const garageMembers = await db.orgMember.findMany({ where: { orgId: order.garageOrgId, role: { in: ['OWNER', 'GM', 'PROCUREMENT'] } }, select: { userId: true } })
      await notifyMany(garageMembers.map((m) => m.userId), { type: 'ORDER_PAYMENT', title: `Payment protected: ${order.refCode}`, body: 'Provider confirmed the payment. The supplier can now dispatch; funds release after your inspection.', link: '/procurement?tab=orders' })
    }
  }

  // Notify org members about the confirmed payment
  if (invoice.orgId) {
    const members = await db.orgMember.findMany({ where: { orgId: invoice.orgId }, select: { userId: true } })
    await notifyMany(members.map((m) => m.userId), {
      type: 'PAYMENT_CONFIRMED',
      title: `Payment received: ${invoice.refCode}`,
      body: `Invoice ${invoice.refCode} (${(invoice.amountMinor / 100).toLocaleString()} ${invoice.currency}) was confirmed via ${paidVia === 'MPESA' ? 'M-Pesa' : 'manual reconciliation'}.`,
      link: '/dealer?tab=billing',
    })
  }

  await auditPaymentConfirmed({
    refCode: invoice.refCode,
    amountMinor: invoice.amountMinor,
    paidVia,
    note,
  })
  return {
    activatedSubscription,
    activatedCampaign,
    activatedMembership,
    protectedOrder,
    invoice: { id: invoice.id, refCode: invoice.refCode, amountMinor: invoice.amountMinor, currency: invoice.currency, type: invoice.type },
  }
}
