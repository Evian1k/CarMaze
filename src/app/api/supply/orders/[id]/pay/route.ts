import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notify, notifyMany } from '@/lib/notify'
import { getMembership } from '@/lib/orgs'
import { stkPush, MpesaNotConfiguredError, mpesaConfigured } from '@/lib/mpesa'
import { getFees, computeCommission, poEvent } from '@/lib/supply'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const schema = z.object({
  phone: z.string().trim().regex(/^(\+?254|0)[17]\d{8}$/, 'Enter a valid Kenyan mobile number (07/01…).'),
})

/**
 * POST /api/supply/orders/[id]/pay: protected payment for a confirmed order.
 *
 * HONEST PAYMENT BOUNDARY:
 *  - With Daraja credentials configured, an STK push is raised; the order only
 *    becomes PROTECTED when Safaricom's callback confirms ResultCode 0
 *    (webhook below, idempotent).
 *  - Without credentials, the attempt fails with MPESA_NOT_CONFIGURED: never
 *    a simulated success. Platform FINANCE staff can reconcile a real
 *    paybill/bank statement against the invoice via the admin Supply console,
 *    which sets PROTECTED with provider MANUAL_RECONCILED and a full audit row.
 *
 * Breakdown shown to the garage BEFORE confirmation: product cost, delivery
 * charge, taxes, platform commission (taken from supplier proceeds at
 * release), total payable.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const rl = rateLimit(`po-pay:${user.id}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many payment attempts. Please try later.')
  const body = await parseBody(req, schema)

  const order = await db.purchaseOrder.findUnique({ where: { id }, include: { payment: true, delivery: true } })
  if (!order) return fail(404, 'NOT_FOUND', 'Order not found.')
  const member = await getMembership(order.garageOrgId, user.id)
  if (!member) return fail(403, 'FORBIDDEN', 'Only the purchasing garage can pay for this order.')

  if (order.status !== 'CONFIRMED') return fail(409, 'INVALID_STATE', `Payment opens after the order is confirmed (current: ${order.status}).`)
  if (order.payment && ['PROTECTED', 'PROCESSING'].includes(order.payment.status)) {
    return fail(409, 'ALREADY_PROTECTED', order.payment.status === 'PROTECTED' ? 'This order is already paid and protected.' : 'A payment is already in progress: check your phone.')
  }

  const fees = await getFees()
  const estimatedCommission = computeCommission(order.subtotalMinor, fees.supplyCommissionPct, fees.minCommissionMinor)

  // create / reuse the authorization record + platform invoice
  const payment = order.payment ?? (await db.paymentAuthorization.create({
    data: {
      refCode: refCode('PAY', 6),
      orderId: id,
      provider: 'MPESA_DARAJA',
      status: 'PENDING',
      amountMinor: order.totalMinor,
      currency: order.currency,
    },
  }))
  let invoice = order.invoiceId ? await db.invoice.findUnique({ where: { id: order.invoiceId } }) : null
  if (!invoice) {
    invoice = await db.invoice.create({
      data: {
        refCode: refCode('INV', 6),
        orgId: order.garageOrgId,
        userId: user.id,
        type: 'ORDER_PAYMENT',
        description: `Protected payment for purchase order ${order.refCode} (products + delivery + tax)`,
        amountMinor: order.totalMinor,
        currency: order.currency,
        status: 'PENDING',
      },
    })
    await db.purchaseOrder.update({ where: { id }, data: { invoiceId: invoice.id, paymentStatus: 'PROCESSING' } })
  }
  await db.paymentAuthorization.update({ where: { id: payment.id }, data: { status: 'PROCESSING', phone: body.phone } })
  await db.purchaseOrder.update({ where: { id }, data: { paymentStatus: 'PROCESSING' } })

  try {
    const push = await stkPush({ phone: body.phone, amountMinor: order.totalMinor, accountReference: order.refCode.replace(/-/g, '').slice(0, 12), description: `Order ${order.refCode}` })
    await db.paymentAuthorization.update({ where: { id: payment.id }, data: { checkoutRef: push.checkoutRequestId, status: 'PROCESSING', resultDesc: 'STK push sent' } })
    await poEvent(id, { type: 'PAYMENT', actorId: user.id, actorName: user.name, actorSide: 'GARAGE', note: `M-Pesa STK push sent to ${body.phone}. Order protected only after provider confirmation.` })
    await audit({ actorId: user.id, actorName: user.name, action: 'ORDER_PAYMENT_INITIATED', targetType: 'PURCHASE_ORDER', targetId: id, metadata: { provider: 'MPESA_DARAJA', checkout: push.checkoutRequestId } })
    return ok({
      payment: { refCode: payment.refCode, status: 'PROCESSING', provider: 'MPESA_DARAJA' },
      breakdown: {
        subtotalMinor: order.subtotalMinor,
        deliveryFeeMinor: order.deliveryFeeMinor,
        taxMinor: order.taxMinor,
        platformFeeMinor: estimatedCommission,
        totalMinor: order.totalMinor,
        note: 'Platform commission is recorded separately and taken from supplier proceeds at release; not charged on top.',
      },
      customerMessage: push.customerMessage,
      message: 'Enter your M-Pesa PIN. The order becomes protected only when Safaricom confirms the payment.',
    })
  } catch (e) {
    if (e instanceof MpesaNotConfiguredError) {
      await db.paymentAuthorization.update({ where: { id: payment.id }, data: { status: 'PENDING', resultDesc: 'M-Pesa not configured on this deployment' } })
      await db.purchaseOrder.update({ where: { id }, data: { paymentStatus: 'UNPAID' } })
      await poEvent(id, { type: 'PAYMENT', actorId: user.id, actorName: user.name, actorSide: 'GARAGE', note: 'M-Pesa attempt failed: provider not configured on this deployment. Manual reconciliation by platform finance is available.' })
      await notifyMany(
        (await db.orgMember.findMany({ where: { orgId: order.garageOrgId, role: { in: ['OWNER', 'GM'] } }, select: { userId: true } })).map((m) => m.userId),
        { type: 'ORDER_PAYMENT', title: `Payment pending for ${order.refCode}`, body: 'M-Pesa is not configured on this deployment. Platform finance can reconcile your payment manually; the order is protected only after reconciliation.', link: '/procurement?tab=orders' }
      )
      return fail(503, 'MPESA_NOT_CONFIGURED', e.message, {
        breakdown: {
          subtotalMinor: order.subtotalMinor,
          deliveryFeeMinor: order.deliveryFeeMinor,
          taxMinor: order.taxMinor,
          platformFeeMinor: estimatedCommission,
          totalMinor: order.totalMinor,
        },
        manualOption: 'A platform finance officer can reconcile this payment against a real M-Pesa/paybill statement (MANUAL_RECONCILED). The order is never marked protected by this attempt alone.',
      })
    }
    await db.paymentAuthorization.update({ where: { id: payment.id }, data: { status: 'FAILED', resultDesc: e instanceof Error ? e.message : 'Provider error' } })
    await db.purchaseOrder.update({ where: { id }, data: { paymentStatus: 'FAILED' } })
    return fail(502, 'PROVIDER_ERROR', e instanceof Error ? e.message : 'Payment provider rejected the request.')
  }
})

/** GET: payment status poll for the garage UI. */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const order = await db.purchaseOrder.findUnique({ where: { id }, include: { payment: true } })
  if (!order) return fail(404, 'NOT_FOUND', 'Order not found.')
  const member = await getMembership(order.garageOrgId, user.id) || await getMembership(order.supplierOrgId, user.id)
  if (!member) return fail(403, 'FORBIDDEN', 'Not authorised.')
  const fees = await getFees()
  return ok({
    payment: order.payment,
    mpesaConfigured: mpesaConfigured(),
    estimatedCommissionMinor: computeCommission(order.subtotalMinor, fees.supplyCommissionPct, fees.minCommissionMinor),
  })
})
