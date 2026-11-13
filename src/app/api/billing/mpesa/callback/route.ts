import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok } from '@/lib/api'
import { parseCallback, type DarajaCallback } from '@/lib/mpesa'
import { activatePaidInvoice, auditPaymentConfirmed } from '../../_activate'
import { audit } from '@/lib/audit'
import { verifyWebhookSignature, webhookRejected } from '@/lib/webhook-auth'

/**
 * POST /api/billing/mpesa/callback: PUBLIC endpoint called by Safaricom Daraja.
 *
 * SECURITY: when MPESA_WEBHOOK_SECRET is configured, callbacks must present it
 * in the x-carmaze-signature header (timing-safe compare). Without the secret
 * the callback is accepted without source validation; a documented limitation
 * mitigated by the fact that a callback can only resolve attempts that were
 * genuinely initiated through stkpush, and every unsigned acceptance is
 * audit-logged.
 *
 * Daraja requires a fast 200 {ResultCode: 0} acknowledgement regardless of the
 * business outcome, so every branch below responds Accepted.
 */
export const POST = route(async (req: NextRequest) => {
  const sig = verifyWebhookSignature(req)
  if (!sig.ok) {
    await audit({ action: 'MPESA_CALLBACK_SIGNATURE_REJECTED', targetType: 'PAYMENT' })
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
    await audit({ action: 'MPESA_CALLBACK_UNKNOWN', targetType: 'PAYMENT', metadata: { reason: 'unparseable payload' } })
    return ok({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  const attempt = await db.paymentAttempt.findUnique({ where: { checkoutRequestId: parsed.checkoutRequestId } })
  if (!attempt) {
    await audit({
      action: 'MPESA_CALLBACK_UNKNOWN',
      targetType: 'PAYMENT',
      targetId: parsed.checkoutRequestId,
      metadata: { resultDesc: parsed.resultDesc },
    })
    return ok({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  // Idempotency: Daraja may retry callbacks; a settled attempt is ignored.
  if (attempt.status === 'SUCCESS') {
    return ok({ ResultCode: 0, ResultDesc: 'Accepted' })
  }
  if (attempt.status === 'FAILED' || attempt.status === 'CANCELLED') {
    return ok({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  if (parsed.resultCode === 0) {
    // Amount integrity check: the callback amount (KES) must match what was
    // actually initiated for this attempt. A MISSING amount is unverifiable
    // and is treated as a mismatch (fail-closed) — we never activate a payment
    // whose value the provider did not state. A mismatch means a tampered or
    // mismatched callback: we refuse activation and flag it for ops.
    if (parsed.amount == null || Math.round(parsed.amount) !== Math.round(attempt.amountMinor / 100)) {
      await db.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'FAILED',
          resultCode: parsed.resultCode,
          resultDesc: `Amount mismatch: callback KES ${parsed.amount} vs initiated KES ${attempt.amountMinor / 100}`,
          callbackRaw: JSON.stringify(payload ?? {}),
        },
      })
      await audit({
        action: 'MPESA_CALLBACK_AMOUNT_MISMATCH',
        targetType: 'PAYMENT',
        targetId: attempt.id,
        metadata: { callbackAmount: parsed.amount, initiatedAmountMinor: attempt.amountMinor },
      })
      return ok({ ResultCode: 0, ResultDesc: 'Accepted' })
    }

    await db.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'SUCCESS',
        resultCode: parsed.resultCode,
        resultDesc: parsed.resultDesc ?? 'Payment received',
        callbackRaw: JSON.stringify(payload ?? {}),
      },
    })
    const result = await activatePaidInvoice(attempt.invoiceId, 'MPESA')
    await auditPaymentConfirmed({
      refCode: result.invoice.refCode,
      amountMinor: attempt.amountMinor,
      paidVia: 'MPESA',
      note: parsed.receipt ? `M-Pesa receipt ${parsed.receipt}` : undefined,
      campaignActivated: result.activatedCampaign,
      subscriptionActivated: result.activatedSubscription,
    })
    await audit({
      action: 'MPESA_CALLBACK_SUCCESS',
      targetType: 'PAYMENT',
      targetId: attempt.id,
      metadata: { invoice: result.invoice.refCode, receipt: parsed.receipt },
    })
    return ok({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  // User cancelled / insufficient funds / timeout etc.
  await db.paymentAttempt.update({
    where: { id: attempt.id },
    data: {
      status: 'FAILED',
      resultCode: parsed.resultCode,
      resultDesc: parsed.resultDesc ?? 'Payment not completed',
      callbackRaw: JSON.stringify(payload ?? {}),
    },
  })
  await audit({
    action: 'MPESA_CALLBACK_FAILED',
    targetType: 'PAYMENT',
    targetId: attempt.id,
    metadata: { resultCode: parsed.resultCode, resultDesc: parsed.resultDesc },
  })
  return ok({ ResultCode: 0, ResultDesc: 'Accepted' })
})
