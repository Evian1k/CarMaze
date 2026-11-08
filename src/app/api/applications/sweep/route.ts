import { NextRequest } from 'next/server'
import { route, ok, requireRole } from '@/lib/api'
import { demoStaffMutationGuard } from '@/lib/demo'
import { audit } from '@/lib/audit'
import { runApplicationSweep } from '@/lib/sweeps'

/**
 * POST /api/applications/sweep — on-demand SLA sweep from the admin Control
 * Center. The SAME rules also run automatically from the scheduled-job runner
 * (src/lib/jobs.ts): this endpoint exists for immediate manual checks and
 * keeps one shared implementation (src/lib/sweeps.ts).
 */
export const POST = route(async () => {
  const staffUser = await requireRole('REVIEWER', 'ADMIN', 'FOUNDER', 'SUPPORT')
  // DEMO SANDBOX: SLA automation is a platform-wide operation.
  await demoStaffMutationGuard(staffUser, { platformWide: true })

  const stats = await runApplicationSweep()
  await audit({ action: 'APPLICATION_SWEEP', metadata: stats })
  return ok(stats)
})
