import { db } from '@/lib/db'
import { refCode } from '@/lib/ids'

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
 */

export async function createSettlementForRelease(params: {
  supplierOrgId: string
  orderId: string
  releasedMinor: number
  commissionMinor: number
  note?: string
}): Promise<string> {
  const settlement = await db.settlement.create({
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
}

/** Put every non-final settlement of an order on hold while a dispute is open. */
export async function holdSettlementsForOrder(orderId: string, reason: string): Promise<number> {
  const pending = await db.settlement.findMany({
    where: { orderId, status: { in: ['PENDING', 'PROCESSING'] } },
    select: { id: true },
  })
  for (const s of pending) {
    await db.settlement.update({
      where: { id: s.id },
      data: {
        status: 'ON_HOLD',
        holdReason: reason.slice(0, 300),
        events: { create: { type: 'HOLD', actorSide: 'SYSTEM', note: `Funds held pending dispute resolution: ${reason.slice(0, 200)}` } },
      },
    })
  }
  return pending.length
}
