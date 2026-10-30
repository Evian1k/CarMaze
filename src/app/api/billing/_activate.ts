import { db } from '@/lib/db'
import { audit } from '@/lib/audit'
import { notifyMany } from '@/lib/notify'

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

  // Notify org members about the confirmed payment
  if (invoice.orgId) {
    const members = await db.orgMember.findMany({ where: { orgId: invoice.orgId }, select: { userId: true } })
    await notifyMany(members.map((m) => m.userId), {
      type: 'PAYMENT_CONFIRMED',
      title: `Payment received — ${invoice.refCode}`,
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
    invoice: { id: invoice.id, refCode: invoice.refCode, amountMinor: invoice.amountMinor, currency: invoice.currency, type: invoice.type },
  }
}
