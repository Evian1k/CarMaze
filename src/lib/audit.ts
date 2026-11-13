import { PrismaClient, Prisma } from '@prisma/client'
import { db } from '@/lib/db'

type TxClient = Prisma.TransactionClient | PrismaClient

/**
 * Fire-and-forget audit for NON-financial events: a failed audit write must
 * never take down the request, so failures are logged and swallowed.
 */
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

/**
 * Transactional audit for FINANCIAL events: the audit row is written in the
 * SAME database transaction as the money mutation. Money must never move
 * without its audit trail: if the audit insert fails, the whole operation
 * rolls back. Use this for payments, escrow transitions, releases, refunds,
 * settlements and reconciliations. For everything else use `audit()`.
 */
export async function auditTx(
  tx: TxClient,
  params: {
    actorId?: string | null
    actorName?: string | null
    action: string
    targetType?: string
    targetId?: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: params.actorId ?? null,
      actorName: params.actorName ?? null,
      action: params.action,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  })
}
