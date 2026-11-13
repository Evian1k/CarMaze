import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, requireRole } from '@/lib/api'
import { assertNotDemoStaffRead } from '@/lib/demo'

/**
 * GET /api/billing/mpesa/attempts — payment attempt ledger for FINANCE
 * reconciliation. Shows every STK push attempt with its provider references
 * and final state, newest first, so missed callbacks can be spotted and
 * reconciled against the provider's own records.
 */
export const GET = route(async (_req: NextRequest) => {
  const user = await requireRole('FINANCE', 'ADMIN', 'FOUNDER')
  // Real payment attempt ledger (phones, provider refs, statuses) is a
  // financial record: closed to demo sessions.
  assertNotDemoStaffRead(user, 'the M-Pesa payment attempt ledger')

  const attempts = await db.paymentAttempt.findMany({
    include: { invoice: { select: { refCode: true, status: true, type: true, amountMinor: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return ok({ attempts })
})
