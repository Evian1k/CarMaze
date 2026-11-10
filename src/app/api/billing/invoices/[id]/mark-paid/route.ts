import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireRole } from '@/lib/api'
import { assertNotDemoActor } from '@/lib/demo'
import { activatePaidInvoice, auditPaymentConfirmed } from '../../../_activate'

type Ctx = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  note: z.string().trim().min(5, 'A reconciliation note is required (at least 5 characters)').max(500),
})

/**
 * POST /api/billing/invoices/[id]/mark-paid: FINANCE / ADMIN / FOUNDER only.
 *
 * PILOT OPS TOOL: marks a PENDING invoice as PAID after real money has been
 * received outside M-Pesa (bank transfer, cash, cheque…). The note is mandatory
 * and audit-logged with the acting staff member; full traceability.
 *
 * When M-Pesa (Safaricom Daraja) credentials are configured, prefer the
 * automatic, tamper-proof callback verification at
 * POST /api/billing/mpesa/callback: manual marking bypasses provider
 * verification by design and is therefore restricted to senior roles.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireRole('FINANCE', 'ADMIN', 'FOUNDER')
  // Financial reconciliation is never available from a demo session: marking
  // an invoice PAID is a real-money statement, and demo accounts must not
  // simulate payment success even on demo-owned rows.
  assertNotDemoActor(user, 'manual invoice reconciliation (mark paid)')
  const { id } = await ctx.params
  const body = await parseBody(req, bodySchema)

  const invoice = await db.invoice.findUnique({ where: { id }, include: { payments: true } })
  if (!invoice) throw new ApiError(404, 'NOT_FOUND', 'Invoice not found.')
  if (invoice.status === 'PAID') {
    return fail(409, 'ALREADY_PAID', `Invoice ${invoice.refCode} is already marked paid (${invoice.paidVia ?? 'unknown method'}).`)
  }
  if (invoice.status === 'CANCELLED' || invoice.status === 'REFUNDED') {
    return fail(409, 'INVALID_STATE', `Invoice ${invoice.refCode} is ${invoice.status} and cannot be marked paid.`)
  }

  const result = await activatePaidInvoice(invoice.id, 'MANUAL', body.note)

  await auditPaymentConfirmed({
    actorId: user.id,
    actorName: user.name,
    refCode: invoice.refCode,
    amountMinor: invoice.amountMinor,
    paidVia: 'MANUAL',
    note: body.note,
    campaignActivated: result.activatedCampaign,
    subscriptionActivated: result.activatedSubscription,
  })

  return ok({
    invoice: result.invoice,
    activatedSubscription: result.activatedSubscription,
    activatedCampaign: result.activatedCampaign,
    warning:
      'Manual reconciliation recorded. Prefer automatic M-Pesa verification (Daraja callback) once configured: manual marking does not verify with the payment provider and relies on the audit trail.',
  })
})

// recompile trigger
