import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { parseCallback } from '@/lib/mpesa'
import { auditTx } from '@/lib/audit'
import { poEvent } from '@/lib/supply'
import { verifyWebhookSignature, webhookRejected } from '@/lib/webhook-auth'

export const dynamic = 'force-dynamic'

// Escrow rows in these states are FINAL: a late/replayed callback must never
// resurrect or mutate them. Only a pending payment can transition.
const TERMINAL_ESCROW_STATES = ['RELEASED', 'PARTIALLY_RELEASED', 'REFUNDED', 'CANCELLED']

/**
 * POST /api/supply/payments/webhook: Safaricom Daraja callback for PROTECTED
 * ORDER payments. Idempotent: repeated callbacks for the same
 * CheckoutRequestID are recorded but processed once. The order only becomes
 * PROTECTED on ResultCode 0: a supplier's dispatch confirmation can never
 * create this state.
 *
 * Concurrency: every transition is a conditional updateMany inside one
 * transaction — the row must still be in the expected state when the write
 * happens, otherwise the callback is acknowledged as a no-op (a duplicate or
 * late callback can never double-protect, resurrect a released escrow, or
 * race a concurrent release/refund).
 *
 * Source validation: when MPESA_WEBHOOK_SECRET is configured, requests must
 * present it in the x-carmaze-signature header (timing-safe compare); see
 * src/lib/webhook-auth.ts.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const sig = verifyWebhookSignature(req)
  if (!sig.ok) {
    await auditTx(db, { actorName: 'M-Pesa callback', action: 'WEBHOOK_SIGNATURE_REJECTED', targetType: 'PAYMENT' })
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

  const outcome = await db.$transaction(async (tx) => {
    // Re-read INSIDE the transaction: the authoritative state at write time.
    const current = await tx.paymentAuthorization.findUnique({
      where: { id: payment.id },
      include: { order: true },
    })
    if (!current) return { kind: 'noop' as const, desc: 'Reference no longer exists' }

    const processed = JSON.parse(current.webhookEvents || '[]') as string[]
    const eventKey = `${parsed.checkoutRequestId}:${parsed.resultCode}`
    const alreadyProcessed = processed.includes(eventKey)

    // Terminal escrow: a success callback after RELEASE/REFUND/CANCEL (or a
    // duplicate of an already-processed event) must never change the state.
    if (TERMINAL_ESCROW_STATES.includes(current.status) || alreadyProcessed) {
      await tx.paymentAuthorization.update({
        where: { id: current.id },
        data: { webhookEvents: JSON.stringify([...processed, ...(alreadyProcessed ? [] : [eventKey])]) },
      })
      return { kind: 'noop' as const, desc: alreadyProcessed ? 'Already processed' : `Escrow already ${current.status}` }
    }

    if (parsed.resultCode === 0) {
      // Amount integrity: compare the provider-stated amount against the
      // immutable escrow snapshot (payment.amountMinor — the amount that was
      // actually initiated), not the mutable order total. A MISSING amount is
      // unverifiable and fails closed; overpayments are rejected (exact match).
      const amountOk = parsed.amount !== null && Math.round(parsed.amount * 100) === current.amountMinor
      if (!amountOk) {
        const initiatedKes = (current.amountMinor / 100).toLocaleString()
        // Conditional guard: only a still-PENDING payment may flip to FAILED.
        const updated = await tx.paymentAuthorization.updateMany({
          where: { id: current.id, status: { in: ['PENDING', 'PROCESSING'] } },
          data: {
            status: 'FAILED',
            resultDesc: parsed.amount === null ? 'Callback carried no verifiable amount' : `Amount mismatch: received KES ${parsed.amount}, initiated KES ${initiatedKes}`,
            webhookEvents: JSON.stringify([...processed, eventKey]),
          },
        })
        if (updated.count === 0) return { kind: 'noop' as const, desc: 'Escrow state moved concurrently; callback ignored' }
        await poEvent(current.orderId, { type: 'PAYMENT', actorName: 'M-Pesa callback', actorSide: 'SYSTEM', note: parsed.amount === null ? 'Callback carried no verifiable amount; payment not protected.' : `Amount mismatch (received KES ${parsed.amount}, initiated KES ${initiatedKes}); payment not protected.` })
        await auditTx(tx, { actorName: 'M-Pesa callback', action: 'ORDER_PAYMENT_FAILED', targetType: 'PURCHASE_ORDER', targetId: current.orderId, metadata: { reason: 'amount mismatch', amount: parsed.amount } })
        return { kind: 'failed' as const }
      }
      // THE money-critical write: PROTECTED only if the escrow is still pending.
      // Two concurrent callbacks (or a callback racing a manual reconciliation)
      // can only win this guard once; the loser is an acknowledged no-op.
      const protectedNow = await tx.paymentAuthorization.updateMany({
        where: { id: current.id, status: { in: ['PENDING', 'PROCESSING'] } },
        data: {
          status: 'PROTECTED',
          protectedAt: new Date(),
          resultDesc: parsed.resultDesc ?? 'Provider confirmed payment',
          webhookEvents: JSON.stringify([...processed, eventKey]),
        },
      })
      if (protectedNow.count === 0) return { kind: 'noop' as const, desc: 'Escrow state moved concurrently; callback ignored' }
      await tx.purchaseOrder.update({ where: { id: current.orderId }, data: { paymentStatus: 'PROTECTED' } })
      if (current.order.invoiceId) {
        await tx.invoice.updateMany({ where: { id: current.order.invoiceId, status: { not: 'PAID' } }, data: { status: 'PAID', paidAt: new Date(), paidVia: 'MPESA' } })
      }
      await tx.pOEvent.create({
        data: {
          orderId: current.orderId,
          type: 'PAYMENT',
          actorName: 'M-Pesa callback',
          actorSide: 'SYSTEM',
          note: `Provider confirmed payment${parsed.receipt ? ` (receipt ${parsed.receipt})` : ''}. Funds protected pending inspection.`,
        },
      })
      await auditTx(tx, { actorName: 'M-Pesa callback', action: 'ORDER_PAYMENT_PROTECTED', targetType: 'PURCHASE_ORDER', targetId: current.orderId, metadata: { receipt: parsed.receipt, amount: parsed.amount } })
      return { kind: 'protected' as const }
    }

    // Failure callback: conditional guard as well — a failure can never
    // clobber a payment that concurrently went PROTECTED/terminal.
    const failedNow = await tx.paymentAuthorization.updateMany({
      where: { id: current.id, status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'FAILED', resultDesc: parsed.resultDesc ?? 'Payment failed', webhookEvents: JSON.stringify([...processed, eventKey]) },
    })
    if (failedNow.count === 0) return { kind: 'noop' as const, desc: 'Escrow state moved concurrently; callback ignored' }
    await tx.purchaseOrder.updateMany({ where: { id: current.orderId, paymentStatus: { in: ['PENDING_PAYMENT', 'PROCESSING'] } }, data: { paymentStatus: 'FAILED' } })
    await auditTx(tx, { actorName: 'M-Pesa callback', action: 'ORDER_PAYMENT_FAILED', targetType: 'PURCHASE_ORDER', targetId: current.orderId, metadata: { desc: parsed.resultDesc } })
    return { kind: 'failed' as const }
  })

  // The provider only needs an acknowledgement; the honest ResultDesc records
  // no-ops explicitly so reconciliation can see what was (not) processed.
  return ok({ ResultCode: 0, ResultDesc: outcome.kind === 'noop' ? `Accepted (${outcome.desc})` : 'Accepted' })
}
