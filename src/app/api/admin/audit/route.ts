import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, requireRole } from '@/lib/api'

const PAGE_SIZE = 50

/** GET /api/admin/audit?action=&targetType=&page= — read-only audit trail, 50/page. */
export const GET = route(async (req: NextRequest) => {
  await requireRole('SUPPORT', 'REVIEWER', 'MODERATOR', 'FINANCE', 'ADMIN', 'FOUNDER')
  const url = new URL(req.url)
  const action = (url.searchParams.get('action') || '').trim()
  const targetType = (url.searchParams.get('targetType') || '').trim()
  const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1)

  const where = {
    ...(action ? { action: { contains: action } } : {}),
    ...(targetType ? { targetType: { contains: targetType } } : {}),
  }
  const [total, entries] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ])
  return ok({ entries, total, page, pageSize: PAGE_SIZE })
})
