import { db } from '@/lib/db'

export async function audit(params: {
  actorId?: string | null
  actorName?: string | null
  action: string
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        actorName: params.actorName ?? null,
        action: params.action,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      },
    })
  } catch (e) {
    console.error('[audit] failed to record', e)
  }
}
