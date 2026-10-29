import { db } from '@/lib/db'
import { route, ok } from '@/lib/api'

export const GET = route(async () => {
  const row = await db.systemSetting.findUnique({ where: { key: 'contact' } })
  return ok({
    contact: row?.value
      ? JSON.parse(row.value)
      : { email: 'support@carmaze.co.ke', phone: '+254 700 000 000', location: 'Nairobi, Kenya', hours: 'Mon–Sat, 8am–6pm EAT' },
  })
})
