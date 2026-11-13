import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, requireRole } from '@/lib/api'
import { ROLE } from '@/lib/auth'
import { assertNotDemoStaffRead } from '@/lib/demo'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/uploads — staff console for the upload malware workflow.
 * REVIEWER/MODERATOR/ADMIN/FOUNDER only, and NEVER a demo session: the queue
 * carries real users' file metadata (owner identity), which is closed to demo
 * sessions like every other real-data admin surface.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireRole(ROLE.REVIEWER, ROLE.MODERATOR, ROLE.ADMIN, ROLE.FOUNDER)
  assertNotDemoStaffRead(user, 'the upload review queue (real users file metadata)')
  const sp = req.nextUrl.searchParams
  const filter = sp.get('filter') ?? 'pending' // pending | all | infected
  const take = Math.min(Number(sp.get('take') ?? 100), 200)

  const where =
    filter === 'infected'
      ? { scanStatus: 'INFECTED' }
      : filter === 'all'
        ? {}
        : {
            OR: [
              { quarantined: true, scanStatus: { notIn: ['CLEAN', 'APPROVED_MANUAL'] } },
              { scanStatus: { in: ['UNSCANNED', 'SCANNER_UNAVAILABLE'] } },
            ],
          }

  const [records, pendingCount, infectedCount] = await Promise.all([
    db.uploadRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, fileName: true, url: true, kind: true, accessKind: true, visibility: true,
        mimeType: true, sizeBytes: true, purpose: true, scanStatus: true, scannedAt: true,
        quarantined: true, expiresAt: true, createdAt: true,
        owner: { select: { id: true, name: true, email: true, isDemo: true } },
      },
    }),
    db.uploadRecord.count({ where: { quarantined: true, scanStatus: { notIn: ['CLEAN', 'APPROVED_MANUAL'] } } }),
    db.uploadRecord.count({ where: { scanStatus: 'INFECTED' } }),
  ])

  return ok({
    records,
    counts: { pending: pendingCount, infected: infectedCount },
    note:
      'Files listed here are stored but NOT viewable until a malware scan reports clean or you approve them after human review (POST /api/admin/uploads/[name]/action). Approvals are audited with your identity.',
  })
})
