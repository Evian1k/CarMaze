import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, fail, requireRole, getIp } from '@/lib/api'
import { STAFF_ROLES } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { PARTNER_STATUSES, parsePartnerNotes, parseServiceAreas } from '@/lib/partners'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/partners?status= — full partner list for staff, every status
 * included (PENDING / APPROVED / SUSPENDED / REJECTED), newest first, plus
 * live counts grouped by status.
 *
 * Staff-only fields appear here and nowhere else: contactName, email, notes
 * (returned both raw as `notes` and parsed as `notesList` [{by, at, text}]),
 * rejectionReason, serviceAreas (parsed string[]).
 */
export const GET = route(async (req: NextRequest) => {
  await requireRole(...STAFF_ROLES)
  const rl = rateLimit(`admin-partners:${getIp(req)}`, 60, 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many requests. Slow down.')

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const where =
    status && (PARTNER_STATUSES as readonly string[]).includes(status) ? { status } : {}

  const [partners, grouped] = await Promise.all([
    db.partner.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
    }),
    db.partner.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  const counts: Record<string, number> = { PENDING: 0, APPROVED: 0, SUSPENDED: 0, REJECTED: 0 }
  for (const g of grouped) counts[g.status] = g._count._all
  counts.ALL = Object.values(counts).reduce((sum, n) => sum + n, 0)

  return ok({
    partners: partners.map((p) => ({
      ...p,
      serviceAreas: parseServiceAreas(p.serviceAreas),
      notesList: parsePartnerNotes(p.notes),
    })),
    counts,
  })
})
