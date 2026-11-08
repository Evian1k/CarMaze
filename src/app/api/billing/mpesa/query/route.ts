import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireRole } from '@/lib/api'
import { audit } from '@/lib/audit'
import { stkQuery, mpesaConfigured, MpesaNotConfiguredError } from '@/lib/mpesa'

const schema = z.object({
  checkoutRequestId: z.string().trim().min(6).max(60),
})

/**
 * POST /api/billing/mpesa/query — ask Daraja for the true status of an STK
 * push (reconciliation when a callback was missed). The provider's answer is
 * recorded on the PaymentAttempt and returned verbatim; if it confirms
 * success the linked invoice still goes through the normal activation path
 * (FINANCE mark-paid), never an automatic state jump.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireRole('FINANCE', 'ADMIN', 'FOUNDER')
  const body = await parseBody(req, schema)

  if (!mpesaConfigured()) {
    return fail(501, 'MPESA_NOT_CONFIGURED', 'M-Pesa Daraja is not configured on this deployment; there is no provider to query.')
  }

  const attempt = await db.paymentAttempt.findUnique({ where: { checkoutRequestId: body.checkoutRequestId } })
  if (!attempt) return fail(404, 'ATTEMPT_NOT_FOUND', 'No payment attempt with that provider reference.')

  try {
    const result = await stkQuery(body.checkoutRequestId)
    await db.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        resultCode: result.resultCode,
        resultDesc: `${result.resultDesc ?? ''} (via provider query)`.trim().slice(0, 300) || attempt.resultDesc,
        status: result.resultCode === 0 ? 'SUCCESS' : attempt.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      },
    })
    await audit({ actorId: user.id, actorName: user.name, action: 'MPESA_STATUS_QUERIED', targetType: 'PAYMENT_ATTEMPT', targetId: attempt.id, metadata: { checkoutRequestId: body.checkoutRequestId, resultCode: result.resultCode } })
    return ok({ query: result, note: result.resultCode === 0
      ? 'Provider confirms payment succeeded. Complete reconciliation via invoice mark-paid with the receipt reference.'
      : 'Provider reports the transaction was not completed.' })
  } catch (e) {
    if (e instanceof MpesaNotConfiguredError) return fail(501, 'MPESA_NOT_CONFIGURED', e.message)
    return fail(502, 'PROVIDER_ERROR', e instanceof Error ? e.message : 'Provider query failed.')
  }
})
