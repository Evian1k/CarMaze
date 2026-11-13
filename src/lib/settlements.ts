import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { refCode } from '@/lib/ids'

type TxClient = Prisma.TransactionClient

/**
 * Supplier settlement ledger helpers.
 *
 * An auditable payout process for released protected payments:
 *  - CREATED when a PO payment is RELEASED (PENDING — money owed, not moved)
 *  - ON_HOLD automatically when a dispute opens on the order
 *  - SETTLED only when a payout provider confirms the transfer, or when
 *    FINANCE records a manual reconciliation with an external reference
 *
 * Nothing here simulates a money transfer: states only change on real
 * provider confirmation or an explicit, audited human reconciliation.
 *
 * One-payout-per-order idempotency is enforced by the DATABASE
 * (Settlement @@unique([orderId, kind])), not by a racy findFirst. When
 * called inside a release transaction, pass the transaction client so the
 * uniqueness check and the release land atomically.
 */

export async function createSettlementForRelease(
  params: {
    supplierOrgId: string
    orderId: string
    releasedMinor: number
    commissionMinor: number
    note?: string
  },
  tx?: TxClient,
): Promise<string> {
  const client = tx ?? db
  try {
    const settlement = await client.settlement.create({
      data: {
        refCode: refCode('STL', 6),
        orgId: params.supplierOrgId,
        orderId: params.orderId,
        kind: 'PO_RELEASE',
        amountMinor: params.releasedMinor,
        commissionMinor: params.commissionMinor,
        netMinor: Math.max(0, params.releasedMinor - params.commissionMinor),
        currency: 'KES',
        status: 'PENDING',
        events: {
          create: {
            type: 'CREATED',
            actorSide: 'SYSTEM',
            note: params.note
              ?? `Payout owed after protected payment release (net ${(Math.max(0, params.releasedMinor - params.commissionMinor) / 100).toLocaleString('en-KE')} KES). Settlement requires provider confirmation or manual reconciliation.`,
          },
        },
      },
    })
    return settlement.id
  } catch (e) {
    // Unique violation on (orderId, kind): a settlement for this order already
    // exists — the concurrent/second release must NOT mint a second payout.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await client.settlement.findFirst({ where: { orderId: params.orderId, kind: 'PO_RELEASE' }, select: { id: true } })
      if (existing) return existing.id
    }
    throw e
  }
}

/** Put every non-final settlement of an order on hold while a dispute is open. */
export async function holdSettlementsForOrder(orderId: string, reason: string): Promise<number> {
  const candidates = await db.settlement.findMany({
    where: { orderId, status: { in: ['PENDING', 'PROCESSING'] } },
    select: { id: true },
  })
  let held = 0
  for (const s of candidates) {
    // Conditional guard per row: a settlement that concurrently moved to
    // SETTLED is never dragged backwards by a dispute opening.
    const r = await db.settlement.updateMany({
      where: { id: s.id, status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'ON_HOLD', holdReason: reason.slice(0, 300) },
    })
    if (r.count > 0) {
      held++
      await db.settlementEvent.create({
        data: { settlementId: s.id, type: 'HOLD', actorSide: 'SYSTEM', note: `Funds held pending dispute resolution: ${reason.slice(0, 200)}` },
      }).catch(() => null)
    }
  }
  return held
}
