import { destroySession, getSessionUser } from '@/lib/auth'
import { route, ok } from '@/lib/api'
import { audit } from '@/lib/audit'

export const POST = route(async () => {
  const user = await getSessionUser()
  await destroySession()
  if (user) await audit({ actorId: user.id, actorName: user.name, action: 'LOGOUT', targetType: 'USER', targetId: user.id })
  return ok({ success: true })
})
