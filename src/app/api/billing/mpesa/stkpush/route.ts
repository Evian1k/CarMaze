import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireUser, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { stkPush, mpesaConfigured, MpesaNotConfiguredError } from '@/lib/mpesa'
import { audit } from '@/lib/audit'
import { assertNotDemoActor } from '@/lib/demo'

const bodySchema = z.object({
  invoiceId: z.string().min(1),
  phone: z.string().trim().regex(/^(\+?254|0)(1|7)\d{8}$/, 'Enter a valid Kenyan phone number (e.g. 0712 345 678)'),
})

/**
 * POST /api/billing/mpesa/stkpush: initiate an STK push for a PENDING invoice
 * the caller owns (invoice owner or member of the invoiced org).
 *
 * HONEST PAYMENT STATES:
 *  - M-Pesa not configured on this deployment → 501 MPESA_NOT_CONFIGURED,
 *    the attempt is recorded as FAILED. We NEVER simulate a payment.
 *  - Daraja rejects/network error → 502 MPESA_REQUEST_FAILED, attempt FAILED.
 *  - Success → attempt PENDING until the Daraja callback resolves it
 *    (POST /api/billing/mpesa/callback is the only thing that marks PAID).
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`stkpush:${user.id}:${getIp(req)}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many payment requests. Please wait a minute and try again.')

  const body = await parseBody(req, bodySchema)

  // DEMO SANDBOX: demo accounts never trigger real M-Pesa transactions:
  // enforced before any payment attempt is recorded.
  assertNotDemoActor(user, 'real M-Pesa payment')

  const invoice = await db.invoice.findUnique({ where: { id: body.invoiceId } })
  if (!invoice) throw new ApiError(404, 'NOT_FOUND', 'Invoice not found.')

  // Ownership: personal invoice owner or member of the invoiced org.
  let authorised = invoice.userId === user.id
  if (!authorised && invoice.orgId) {
    const membership = await db.orgMember.findFirst({ where: { orgId: invoice.orgId, userId: user.id } })
    authorised = Boolean(membership)
  }
  if (!authorised) throw new ApiError(403, 'FORBIDDEN', 'You can only pay invoices issued to your account or organisation.')
  if (invoice.status === 'PAID') return fail(409, 'ALREADY_PAID', `Invoice ${invoice.refCode} is already paid.`)
  if (invoice.status !== 'PENDING' && invoice.status !== 'OVERDUE') {
    return fail(409, 'INVALID_STATE', `Invoice ${invoice.refCode} is ${invoice.status} and cannot be paid.`)
  }

  const attempt = await db.paymentAttempt.create({
    data: {
      invoiceId: invoice.id,
      provider: 'MPESA_DARAJA',
      phone: body.phone,
      amountMinor: invoice.amountMinor,
      status: 'INITIATED',
    },
  })

  if (!mpesaConfigured()) {
    const reason = 'M-Pesa not configured on this deployment'
    await db.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED', resultDesc: reason } })
    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'PAYMENT_STK_FAILED_NOT_CONFIGURED',
      targetType: 'INVOICE',
      targetId: invoice.refCode,
      metadata: { attemptId: attempt.id },
    })
    return fail(501, 'MPESA_NOT_CONFIGURED',
      'M-Pesa (Safaricom Daraja) is not configured on this deployment. The integration is implemented and activates automatically once MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY and MPESA_CALLBACK_URL are set. No simulated payments are performed.',
      { attemptId: attempt.id })
  }

  try {
    const push = await stkPush({
      phone: body.phone,
      amountMinor: invoice.amountMinor,
      accountReference: invoice.refCode,
      description: invoice.description.slice(0, 60),
    })
    await db.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'PENDING',
        merchantRequestId: push.merchantRequestId,
        checkoutRequestId: push.checkoutRequestId,
      },
    })
    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'PAYMENT_STK_INITIATED',
      targetType: 'INVOICE',
      targetId: invoice.refCode,
      metadata: { attemptId: attempt.id, amountMinor: invoice.amountMinor },
    })
    return ok({ status: 'PENDING', attemptId: attempt.id, message: push.customerMessage })
  } catch (e) {
    const message = e instanceof MpesaNotConfiguredError
      ? e.message
      : e instanceof Error ? e.message : 'Daraja request failed'
    await db.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED', resultDesc: message } })
    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'PAYMENT_STK_ERROR',
      targetType: 'INVOICE',
      targetId: invoice.refCode,
      metadata: { attemptId: attempt.id, error: message },
    })
    return fail(502, 'MPESA_REQUEST_FAILED', `Could not start the M-Pesa payment: ${message}`, { attemptId: attempt.id })
  }
})
