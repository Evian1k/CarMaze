import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok } from '@/lib/api'
import { parseCallback, type DarajaCallback } from '@/lib/mpesa'
import { activatePaidInvoiceTx, drainNotifyQueue, type NotifyJob } from '../../_activate'
import { auditTx } from '@/lib/audit'
import { verifyWebhookSignature, webhookRejected } from '@/lib/webhook-auth'

/**
 * POST /api/billing/mpesa/callback: PUBLIC endpoint called by Safaricom Daraja.
 *
 * SECURITY: when MPESA_WEBHOOK_SECRET is configured, callbacks must present it
 * in the x-carmaze-signature header (timing-safe compare). Without the secret
 * the callback is REJECTED in production (fail-closed, see src/lib/webhook-auth.ts);
 * only development/sandbox accepts unsigned callbacks, and every such
 * acceptance is audit-logged.
 *
 * CONCURRENCY: the attempt transition and the invoice activation run in ONE
 * transaction, and both are conditional updates — the attempt must still be
 * INITIATED/PENDING and the invoice still unpaid when the writes land. A
 * replayed callback, a duplicate delivery, or a race with a manual
 * mark-paid reconciliation resolves to an acknowledged no-op: money is
 * activated exactly once, and the audit row is written in the same
 * transaction (a rollback can never leave money moved without a trail).
 *
 * Daraja requires a fast 200 {ResultCode: 0} acknowledgement regardless of the
 * business outcome, so every branch below responds Accepted.
 */
export const POST = route(async (req: NextRequest) => {
  const sig = verifyWebhookSignature(req)
  if (!sig.ok) {
    await auditTx(db, { action: 'MPESA_CALLBACK_SIGNATURE_REJECTED', targetType: 'PAYMENT' })
    const rej = webhookRejected()
    return Response.json(rej.body, { status: rej.status })
  }

  let payload: DarajaCallback | null = null
  try {
    payload = (await req.json()) as DarajaCallback
  } catch {
    payload = null
  }

  const parsed = payload ? parseCallback(payload) : null

  // Malformed / unrecognised payload: acknowledge so Daraja stops retrying,
  // and record it for the ops dashboard.
  if (!parsed) {
    await auditTx(db, { action: 'MPESA_CALLBACK_UNKNOWN', targetType: 'PAYMENT', metadata: { reason: 'unparseable payload' } })
    return ok({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  const attempt = await db.paymentAttempt.findUnique({ where: { checkoutRequestId: parsed.checkoutRequestId } })
  if (!attempt) {
    await auditTx(db, {
      action: 'MPESA_CALLBACK_UNKNOWN',
      targetType: 'PAYMENT',
      targetId: parsed.checkoutRequestId,
      metadata: { resultDesc: parsed.resultDesc },
    })
    return ok({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  const outbox: NotifyJob[] = []
  const desc = await db.$transaction(async (tx) => {
    // Re-read INSIDE the transaction: the authoritative state at write time.
    const current = await tx.paymentAttempt.findUnique({ where: { id: attempt.id } })
    if (!current) return 'Accepted'
    // Idempotency: Daraja may retry callbacks; a settled attempt is ignored.
    if (current.status === 'SUCCESS' || current.status === 'FAILED' || current.status === 'CANCELLED') {
      return 'Accepted (already processed)'
    }

    if (parsed.resultCode === 0) {
      // Amount integrity check: the callback amount (KES) must match what was
      // actually initiated for this attempt. A MISSING amount is unverifiable
      // and is treated as a mismatch (fail-closed) — we never activate a payment
      // whose value the provider did not state. A mismatch means a tampered or
      // mismatched callback: we refuse activation and flag it for ops.
      if (parsed.amount == null || Math.round(parsed.amount) !== Math.round(current.amountMinor / 100)) {
        const flipped = await tx.paymentAttempt.updateMany({
          where: { id: current.id, status: { in: ['INITIATED', 'PENDING'] } },
          data: {
            status: 'FAILED',
            resultCode: parsed.resultCode,
            resultDesc: `Amount mismatch: callback KES ${parsed.amount} vs initiated KES ${current.amountMinor / 100}`,
            callbackRaw: JSON.stringify(payload ?? {}),
          },
        })
        if (flipped.count === 0) return 'Accepted (already processed)'
        await auditTx(tx, {
          action: 'MPESA_CALLBACK_AMOUNT_MISMATCH',
          targetType: 'PAYMENT',
          targetId: current.id,
          metadata: { callbackAmount: parsed.amount, initiatedAmountMinor: current.amountMinor },
        })
        return 'Accepted'
      }

      // THE money-critical flip: only an in-flight attempt resolves. Two
      // concurrent callbacks (or a callback racing the query poller) can only
      // win once; the loser is an acknowledged no-op.
      const flipped = await tx.paymentAttempt.updateMany({
        where: { id: current.id, status: { in: ['INITIATED', 'PENDING'] } },
        data: {
          status: 'SUCCESS',
          resultCode: parsed.resultCode,
          resultDesc: parsed.resultDesc ?? 'Payment received',
          callbackRaw: JSON.stringify(payload ?? {}),
        },
      })
      if (flipped.count === 0) return 'Accepted (already processed)'

      const result = await activatePaidInvoiceTx(tx, current.invoiceId, 'MPESA', parsed.receipt ? `M-Pesa receipt ${parsed.receipt}` : undefined, outbox)
      if (result.alreadyPaid) {
        // Attempt resolved but the invoice was concurrently activated (e.g.
        // mark-paid). The money record stays consistent: one audit row exists.
        await auditTx(tx, {
          action: 'MPESA_CALLBACK_SUCCESS',
          targetType: 'PAYMENT',
          targetId: current.id,
          metadata: { invoice: result.invoice.refCode, receipt: parsed.receipt, note: 'invoice already activated concurrently' },
        })
        return 'Accepted'
      }
      await auditTx(tx, {
        action: 'MPESA_CALLBACK_SUCCESS',
        targetType: 'PAYMENT',
        targetId: current.id,
        metadata: { invoice: result.invoice.refCode, receipt: parsed.receipt },
      })
      return 'Accepted'
    }

    // User cancelled / insufficient funds / timeout etc.
    const flipped = await tx.paymentAttempt.updateMany({
      where: { id: current.id, status: { in: ['INITIATED', 'PENDING'] } },
      data: {
        status: 'FAILED',
        resultCode: parsed.resultCode,
        resultDesc: parsed.resultDesc ?? 'Payment not completed',
        callbackRaw: JSON.stringify(payload ?? {}),
      },
    })
    if (flipped.count === 0) return 'Accepted (already processed)'
    await auditTx(tx, {
      action: 'MPESA_CALLBACK_FAILED',
      targetType: 'PAYMENT',
      targetId: current.id,
      metadata: { resultCode: parsed.resultCode, resultDesc: parsed.resultDesc },
    })
    return 'Accepted'
  })

  await drainNotifyQueue(outbox)
  return ok({ ResultCode: 0, ResultDesc: desc })
})
