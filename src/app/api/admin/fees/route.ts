import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireRole } from '@/lib/api'
import { demoStaffMutationGuard } from '@/lib/demo'
import { ROLE } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getFees, setFees } from '@/lib/supply'

export const dynamic = 'force-dynamic'

/** GET /api/admin/fees: central fee & commission configuration. */
export const GET = route(async () => {
  await requireRole(ROLE.FINANCE, ROLE.ADMIN, ROLE.FOUNDER)
  const fees = await getFees()
  return ok({ fees })
})

const schema = z.object({
  supplyCommissionPct: z.number().min(0).max(30),
  deliveryCommissionPct: z.number().min(0).max(30),
  minCommissionMinor: z.number().int().min(0).max(1_000_000),
  vehicleSaleCommissionPct: z.number().min(0).max(30),
  bookingCommissionPct: z.number().min(0).max(30),
  membershipPlatformFeePct: z.number().min(0).max(30),
})

/** PUT: update fee configuration (fully audited). */
export const PUT = route(async (req: NextRequest) => {
  const user = await requireRole(ROLE.FINANCE, ROLE.ADMIN, ROLE.FOUNDER)
  // DEMO SANDBOX: platform-wide economics are never configurable from a demo session.
  await demoStaffMutationGuard(user, { platformWide: true })
  const body = await parseBody(req, schema)
  await setFees(body)
  await audit({
    actorId: user.id, actorName: user.name,
    action: 'PLATFORM_FEES_UPDATED', targetType: 'SYSTEM_SETTING', targetId: 'platform_fees',
    metadata: body,
  })
  return ok({ fees: body, message: 'Fee configuration saved. New orders use the updated rates immediately.' })
})
