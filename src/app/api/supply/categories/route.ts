import { db } from '@/lib/db'
import { route, ok } from '@/lib/api'

export const dynamic = 'force-dynamic'

/** GET /api/supply/categories — public category tree for the supply catalogue. */
export const GET = route(async () => {
  const categories = await db.productCategory.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { slug: true, name: true, parentSlug: true, sortOrder: true },
  })
  return ok({ categories })
})
