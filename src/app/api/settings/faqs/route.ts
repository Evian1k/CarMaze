import { db } from '@/lib/db'
import { route, ok } from '@/lib/api'

export const GET = route(async () => {
  const rows = await db.systemSetting.findMany({ where: { key: { in: ['faqs', 'policies'] } } })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value ? JSON.parse(r.value) : null]))
  return ok({ faqs: map.faqs ?? [], policies: map.policies ?? {} })
})
