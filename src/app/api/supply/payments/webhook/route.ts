import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { parseCallback } from '@/lib/mpesa'
import { audit } from '@/lib/audit'
import { poEvent } from '@/lib/supply'
import { verifyWebhookSignature, webhookRejected } from '@/lib/webhook-auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/supply/payments/webhook — Safaricom Daraja callback for PROTECTED
 * ORDER payments. Idempotent: repeated callbacks for the same
 * CheckoutRequestID are recorded but processed once. The order only becomes
 * PROTECTED on ResultCode 0 — a supplier's dispatch confirmation can never
 * create this state.
 *
 * Source validation: when MPESA_WEBHOOK_SECRET is configured, requests must
 * present it in the x-carmaze-signature header (timing-safe compare); see
 * src/lib/webhook-auth.ts.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const sig = verifyWebhookSignature(req)
  if (!sig.ok) {
    await audit({ actorName: 'M-Pesa callback', action: 'WEBHOOK_SIGNATURE_REJECTED', targetType: 'PAYMENT' })
    const rej = webhookRejected()
    return Response.json(rej.body, { status: rej.status })
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return fail(400, 'INVALID_JSON', 'Body must be JSON.')
  }
  const parsed = parseCallback(payload as Parameters<typeof parseCallback>[0])
  if (!parsed) return ok({ ResultCode: 0, ResultDesc: 'Accepted (no actionable callback)' })

  const payment = await db.paymentAuthorization.findUnique({
    where: { checkoutRef: parsed.checkoutRequestId },
    include: { order: true },
  })
  if (!payment) return ok({ ResultCode: 0, ResultDesc: 'Accepted (unknown reference)' }) // never leak existence

  // idempotency: process each checkout reference once
  const processed = JSON.parse(payment.webhookEvents || '[]') as string[]
  const eventKey = `${parsed.checkoutRequestId}:${parsed.resultCode}`
  if (processed.includes(eventKey)) return ok({ ResultCode: 0, ResultDesc: 'Already processed' })

  if (parsed.resultCode === 0) {
    const amountOk = parsed.amount === null || parsed.amount * 100 >= payment.order.totalMinor
    if (!amountOk) {
      await db.paymentAuthorization.update({
        where: { id: payment.id },
        data: { status: 'FAILED', resultDesc: `Underpayment: received ${parsed.amount}`, webhookEvents: JSON.stringify([...processed, eventKey]) },
      })
      await audit({ actorName: 'M-Pesa callback', action: 'ORDER_PAYMENT_FAILED', targetType: 'PURCHASE_ORDER', targetId: payment.orderId, metadata: { reason: 'amount mismatch', amount: parsed.amount } })
      return ok({ ResultCode: 0, ResultDesc: 'Accepted' })
    }
    await db.paymentAuthorization.update({
      where: { id: payment.id },
      data: {
        status: 'PROTECTED',
        protectedAt: new Date(),
        resultDesc: parsed.resultDesc ?? 'Provider confirmed payment',
        webhookEvents: JSON.stringify([...processed, eventKey]),
      },
    })
    await db.purchaseOrder.update({ where: { id: payment.orderId }, data: { paymentStatus: 'PROTECTED' } })
    if (payment.order.invoiceId) {
      await db.invoice.update({ where: { id: payment.order.invoiceId }, data: { status: 'PAID', paidAt: new Date(), paidVia: 'MPESA' } })
    }
    await poEvent(payment.orderId, { type: 'PAYMENT', actorName: 'M-Pesa callback', actorSide: 'SYSTEM', note: `Provider confirmed payment${parsed.receipt ? ` (receipt ${parsed.receipt})` : ''}. Funds protected pending inspection.` })
    await audit({ actorName: 'M-Pesa callback', action: 'ORDER_PAYMENT_PROTECTED', targetType: 'PURCHASE_ORDER', targetId: payment.orderId, metadata: { receipt: parsed.receipt, amount: parsed.amount } })
  } else {
    await db.paymentAuthorization.update({
      where: { id: payment.id },
      data: { status: 'FAILED', resultDesc: parsed.resultDesc ?? 'Payment failed', webhookEvents: JSON.stringify([...processed, eventKey]) },
    })
    await db.purchaseOrder.update({ where: { id: payment.orderId }, data: { paymentStatus: 'FAILED' } })
    await audit({ actorName: 'M-Pesa callback', action: 'ORDER_PAYMENT_FAILED', targetType: 'PURCHASE_ORDER', targetId: payment.orderId, metadata: { desc: parsed.resultDesc } })
  }
  return ok({ ResultCode: 0, ResultDesc: 'Accepted' })
}
