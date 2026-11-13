import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { notifyMany } from '@/lib/notify'
import { refCode } from '@/lib/ids'

type TxClient = Prisma.TransactionClient

type ActivationResult = {
  activatedSubscription: string | null
  activatedCampaign: string | null
  activatedMembership: string | null
  protectedOrder: string | null
  alreadyPaid: boolean
  invoice: { id: string; refCode: string; amountMinor: number; currency: string; type: string }
}

/**
 * Transactional paid-invoice activation used by manual reconciliation
 * (mark-paid) and the M-Pesa Daraja callback. MUST run inside the caller's
 * transaction so "invoice → PAID" and every state it unlocks (subscription,
 * campaign, membership, escrow, consumer order) land atomically.
 *
 * Idempotency: the invoice flip is a conditional updateMany — only an unpaid,
 * uncancelled invoice can flip to PAID. When the invoice is already PAID the
 * function returns alreadyPaid=true and touches nothing, so a replayed
 * callback or a concurrent manual reconciliation can never double-activate
 * (no duplicate subscription upserts, no double escrow protection, no second
 * audit row).
 *
 * Notifications are NOT sent here (no side-channel inside the transaction):
 * the caller fires them after the transaction commits.
 */
export async function activatePaidInvoiceTx(
  tx: TxClient,
  invoiceId: string,
  paidVia: 'MPESA' | 'MANUAL',
  note?: string,
  outbox?: NotifyJob[],
  actor?: { id?: string | null; name?: string | null },
): Promise<ActivationResult> {
  const notifyOutbox: NotifyJob[] = outbox ?? []
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } })
  if (!invoice) throw new Error('Invoice not found')

  const result: ActivationResult = {
    activatedSubscription: null,
    activatedCampaign: null,
    activatedMembership: null,
    protectedOrder: null,
    alreadyPaid: false,
    invoice: { id: invoice.id, refCode: invoice.refCode, amountMinor: invoice.amountMinor, currency: invoice.currency, type: invoice.type },
  }

  // THE money-critical flip: only an unpaid invoice can be marked PAID. Two
  // concurrent activations (callback + mark-paid, duplicate callbacks) race
  // here; exactly one wins and the loser sees alreadyPaid=true.
  const flipped = await tx.invoice.updateMany({
    where: { id: invoice.id, status: { notIn: ['PAID', 'REFUNDED', 'CANCELLED'] } },
    data: { status: 'PAID', paidAt: new Date(), paidVia },
  })
  if (flipped.count === 0) {
    result.alreadyPaid = true
    return result
  }

  if (invoice.type === 'SUBSCRIPTION' && invoice.orgId) {
    // planCode is embedded by subscribe route as "[plan:<code>]" in the description
    const match = /\[plan:([a-z0-9-]+)\]/i.exec(invoice.description)
    const planCode = match?.[1] ?? null
    const periodEnd =
      invoice.periodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const existing = await tx.subscription.findUnique({ where: { orgId: invoice.orgId } })
    if (existing) {
      await tx.subscription.update({
        where: { orgId: invoice.orgId },
        data: { planCode: planCode ?? existing.planCode, status: 'ACTIVE', currentPeriodEnd: periodEnd },
      })
    } else if (planCode) {
      try {
        await tx.subscription.create({
          data: { orgId: invoice.orgId, planCode, status: 'ACTIVE', startedAt: new Date(), currentPeriodEnd: periodEnd },
        })
      } catch (e) {
        // Concurrent activation created the subscription first (orgId unique).
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          await tx.subscription.update({
            where: { orgId: invoice.orgId },
            data: { planCode: planCode ?? planCode, status: 'ACTIVE', currentPeriodEnd: periodEnd },
          })
        } else {
          throw e
        }
      }
    }
    result.activatedSubscription = planCode
  }

  if (invoice.type === 'CAMPAIGN') {
    // Conditional flip: only a PENDING_PAYMENT campaign activates.
    const campaign = await tx.campaign.findFirst({ where: { invoiceId: invoice.id, status: 'PENDING_PAYMENT' } })
    if (campaign) {
      const pkg = await tx.campaignPackage.findUnique({ where: { code: campaign.packageCode } })
      const days = pkg?.days ?? 7
      const now = new Date()
      await tx.campaign.update({
        where: { id: campaign.id },
        data: { status: 'ACTIVE', startsAt: now, endsAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000) },
      })
      result.activatedCampaign = campaign.refCode
    }
  }

  // Business membership: activate only on real payment confirmation.
  if (invoice.type === 'MEMBERSHIP') {
    const match = /\[membership:([^\]]+)\]/.exec(invoice.description)
    const membershipId = match?.[1]
    if (membershipId) {
      const membership = await tx.businessMembership.findUnique({ where: { id: membershipId }, include: { tier: { select: { name: true } }, org: { select: { name: true, type: true } } } })
      if (membership && membership.status === 'PENDING_PAYMENT') {
        const periodEnd = invoice.periodEnd ?? new Date(Date.now() + 30 * 24 * 3600 * 1000)
        const activated = await tx.businessMembership.updateMany({
          where: { id: membership.id, status: 'PENDING_PAYMENT' },
          data: { status: 'ACTIVE', startedAt: new Date(), currentPeriodEnd: periodEnd },
        })
        if (activated.count > 0) {
          result.activatedMembership = membership.refCode
          // Notify business staff + customer (after commit, via caller queue)
          const staff = await tx.orgMember.findMany({ where: { orgId: membership.orgId }, select: { userId: true } })
          queueNotify(notifyOutbox, staff.map((m) => m.userId), {
            type: 'MEMBERSHIP_ACTIVE',
            title: `Membership active: ${membership.tier.name}`,
            body: `${invoice.refCode} paid. New member joined ${membership.tier.name}.`,
            link: membership.org.type === 'GARAGE' ? '/garage-dashboard?tab=memberships' : '/dealer?tab=memberships',
          })
          queueNotify(notifyOutbox, [membership.customerId], { type: 'MEMBERSHIP_ACTIVE', title: `Membership active: ${membership.tier.name}`, body: 'Your membership is now active. Benefits are available at participating branches.', link: '/account?tab=subscriptions' })
        }
      }
    }
  }

  // Protected order payment: only a provider-confirmed payment sets PROTECTED.
  if (invoice.type === 'ORDER_PAYMENT') {
    const order = await tx.purchaseOrder.findFirst({ where: { invoiceId: invoice.id } })
    if (order) {
      // Escrow upsert guarded by the DB: orderId is unique, so a concurrent
      // create fails cleanly; updates only ever move an unprotected escrow.
      const auth = await tx.paymentAuthorization.findUnique({ where: { orderId: order.id } })
      if (!auth) {
        try {
          await tx.paymentAuthorization.create({
            data: {
              refCode: refCode('PAY', 6), orderId: order.id, provider: 'MPESA_DARAJA', status: 'PROTECTED',
              amountMinor: order.totalMinor, protectedAt: new Date(), resultDesc: 'Confirmed via payment callback',
            },
          })
        } catch (e) {
          if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
        }
      } else {
        const protectedNow = await tx.paymentAuthorization.updateMany({
          where: { id: auth.id, status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } },
          data: { status: 'PROTECTED', protectedAt: new Date(), resultDesc: 'Confirmed via payment callback' },
        })
        if (protectedNow.count === 0) {
          // Escrow already PROTECTED/RELEASED/REFUNDED — nothing to protect.
        }
      }
      const poFlip = await tx.purchaseOrder.updateMany({
        where: { id: order.id, paymentStatus: { notIn: ['PROTECTED', 'RELEASED', 'PARTIALLY_RELEASED', 'REFUNDED'] } },
        data: { paymentStatus: 'PROTECTED' },
      })
      if (poFlip.count > 0) {
        result.protectedOrder = order.refCode
        const garageMembers = await tx.orgMember.findMany({ where: { orgId: order.garageOrgId, role: { in: ['OWNER', 'GM', 'PROCUREMENT'] } }, select: { userId: true } })
        queueNotify(notifyOutbox, garageMembers.map((m) => m.userId), { type: 'ORDER_PAYMENT', title: `Payment protected: ${order.refCode}`, body: 'Provider confirmed the payment. The supplier can now dispatch; funds release after your inspection.', link: '/procurement?tab=orders' })
      }
    }
  }

  // Consumer parts order: the buyer pays the PARTS_ORDER invoice directly
  // (M-Pesa). Without this branch the money was collected while the order
  // stayed UNPAID forever — the supplier had no honest signal to dispatch.
  if (invoice.type === 'PARTS_ORDER') {
    const consumerOrder = await tx.customerOrder.findFirst({ where: { invoiceId: invoice.id } })
    if (consumerOrder) {
      const paid = await tx.customerOrder.updateMany({
        where: { id: consumerOrder.id, paymentStatus: 'UNPAID' },
        data: { paymentStatus: 'PAID' },
      })
      if (paid.count > 0) {
        const supplierMembers = await tx.orgMember.findMany({ where: { orgId: consumerOrder.supplierOrgId }, select: { userId: true } })
        queueNotify(notifyOutbox, supplierMembers.map((m) => m.userId), {
          type: 'ORDER_PAYMENT',
          title: `Payment received: ${consumerOrder.refCode}`,
          body: 'The buyer paid the invoice via M-Pesa. You can dispatch and collect the verified handover code on delivery.',
          link: '/supplier?tab=consumer-orders',
        })
      }
    }
  }

  // Notify org members about the confirmed payment (queued for post-commit)
  if (invoice.orgId) {
    const members = await tx.orgMember.findMany({ where: { orgId: invoice.orgId }, select: { userId: true } })
    queueNotify(notifyOutbox, members.map((m) => m.userId), {
      type: 'PAYMENT_CONFIRMED',
      title: `Payment received: ${invoice.refCode}`,
      body: `Invoice ${invoice.refCode} (${(invoice.amountMinor / 100).toLocaleString()} ${invoice.currency}) was confirmed via ${paidVia === 'MPESA' ? 'M-Pesa' : 'manual reconciliation'}.`,
      link: '/dealer?tab=billing',
    })
  }

  // Audit INSIDE the transaction: money cannot be marked paid without its
  // audit trail, and a rollback removes both together.
  await tx.auditLog.create({
    data: {
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? (paidVia === 'MPESA' ? 'M-Pesa callback' : 'Manual reconciliation'),
      action: 'INVOICE_PAID',
      targetType: 'INVOICE',
      targetId: invoice.refCode,
      metadata: JSON.stringify({
        refCode: invoice.refCode,
        paidVia,
        note: note ?? null,
        amountMinor: invoice.amountMinor,
        campaignActivated: result.activatedCampaign,
        subscriptionActivated: result.activatedSubscription,
      }),
    },
  })

  return result
}

type NotifyJob = { userIds: string[]; input: { type: string; title: string; body?: string; link: string } }
function queueNotify(outbox: NotifyJob[], userIds: string[], input: { type: string; title: string; body?: string; link: string }): void {
  outbox.push({ userIds, input })
}
async function drainNotifyQueue(outbox: NotifyJob[]): Promise<void> {
  for (const job of outbox) {
    await notifyMany(job.userIds, job.input as Parameters<typeof notifyMany>[1]).catch(() => null)
  }
}

/**
 * Public wrapper: runs the transactional activation as its own transaction
 * and drains queued notifications afterwards. Used by mark-paid (manual
 * reconciliation); the Daraja callback uses activatePaidInvoiceTx directly
 * so the attempt flip and the activation share ONE transaction.
 */
export async function activatePaidInvoice(
  invoiceId: string,
  paidVia: 'MPESA' | 'MANUAL',
  note?: string,
  actor?: { id?: string | null; name?: string | null },
): Promise<ActivationResult> {
  const outbox: NotifyJob[] = []
  const result = await db.$transaction(async (tx) => activatePaidInvoiceTx(tx, invoiceId, paidVia, note, outbox, actor))
  await drainNotifyQueue(outbox)
  return result
}

export { drainNotifyQueue }
export type { NotifyJob }
