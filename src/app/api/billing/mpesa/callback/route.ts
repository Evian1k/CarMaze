import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok } from '@/lib/api'
import { parseCallback, type DarajaCallback } from '@/lib/mpesa'
import { activatePaidInvoice, auditPaymentConfirmed } from '../../_activate'
import { audit } from '@/lib/audit'

/**
 * POST /api/billing/mpesa/callback — PUBLIC endpoint called by Safaricom Daraja.
 *
 * SECURITY NOTE (documented limitation): production deployments should verify
 * the callback source (Safaricom IP allow-listing at the edge / mutual TLS)
 * before trusting the payload. This deployment accepts the callback without
 * source validation; tampering is mitigated by the fact that a callback can
 * only resolve attempts that were genuinely initiated through stkpush.
 *
 * Daraja requires a fast 200 {ResultCode: 0} acknowledgement regardless of the
 * business outcome, so every branch below responds Accepted.
 */
export const POST = route(async (req: NextRequest) => {
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
