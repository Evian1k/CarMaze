import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditTx } from '@/lib/audit'
import { verifyWebhookSignature, webhookRejected } from '@/lib/webhook-auth'
import { parseB2cResult } from '@/lib/mpesa'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/settlements/payout/result — Daraja B2C Result callback.
 *
 * The payout provider's confirmation is the ONLY thing that can mark a
 * settlement SETTLED after a `process` attempt. ResultCode 0 means the
 * transfer actually completed; anything else records the failure verbatim.
 *
 * Concurrency + dispute integrity: the state flip is a conditional updateMany
 * — only the PROCESSING settlement this callback answers can transition. A
 * settlement finance placed ON_HOLD for an open dispute is NEVER settled by a
 * late provider result: the callback is recorded for reconciliation and the
 * hold stands until the dispute resolves. A replayed result cannot flip an
 * already-SETTLED / FAILED / CANCELLED settlement again.
 *
 * Secured by MPESA_WEBHOOK_SECRET (fail-closed in production when unset).
 */
export async function POST(req: NextRequest): Promise<Response> {
  const guard = verifyWebhookSignature(req)
  if (!guard.ok) {
    const { status, body } = webhookRejected()
    return NextResponse.json(body, { status })
  }

  let payload: unknown = null
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  const result = parseB2cResult(payload as Record<string, unknown>)
  if (!result || (!result.conversationId && !result.originatorConversationId)) {
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  const settlement = await db.settlement.findFirst({
    where: {
      OR: [
        { providerRef: result.conversationId ?? '___none___' },
        { providerRef: result.originatorConversationId ?? '___none___' },
      ],
    },
  })

  if (!settlement) {
    await auditTx(db, { action: 'SETTLEMENT_PAYOUT_RESULT_UNKNOWN', targetType: 'SETTLEMENT', metadata: { conversationId: result.conversationId, originator: result.originatorConversationId } })
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  const desc = await db.$transaction(async (tx) => {
    // Re-read at write time; conditional guard carries the whole integrity
    // policy: only the in-flight PROCESSING settlement answers to a result.
    const current = await tx.settlement.findUnique({ where: { id: settlement.id } })
    if (!current) return 'Settlement no longer exists'
    if (current.status === 'ON_HOLD') {
      await tx.settlementEvent.create({
        data: { settlementId: current.id, type: 'NOTE', actorSide: 'SYSTEM', note: `Provider payout result received while ON_HOLD (dispute hold stands): resultCode ${result.resultCode}. FINANCE must reconcile manually after dispute resolution — the hold was NOT bypassed.` },
      })
      await auditTx(tx, { action: 'SETTLEMENT_PAYOUT_RESULT_ON_HOLD', targetType: 'SETTLEMENT', targetId: current.id, metadata: { ref: current.refCode, resultCode: result.resultCode } })
      return 'Accepted (settlement on dispute hold — recorded for manual reconciliation)'
    }
    if (current.status !== 'PROCESSING') {
      await tx.settlementEvent.create({
        data: { settlementId: current.id, type: 'NOTE', actorSide: 'SYSTEM', note: `Late/replayed provider payout result ignored: settlement is ${current.status} (resultCode ${result.resultCode}).` },
      })
      return `Accepted (settlement already ${current.status})`
    }

    if (result.resultCode === 0) {
      // Amount integrity: the provider-confirmed payout must match what we sent.
      // A missing or mismatched amount stays PROCESSING for FINANCE review
      // rather than being marked SETTLED.
      if (result.amount == null || Math.round(result.amount) !== Math.round(current.netMinor / 100)) {
        await tx.settlement.update({
          where: { id: current.id },
          data: {
            lastError: `B2C result amount unverifiable: provider ${result.amount ?? 'missing'} vs net ${(current.netMinor / 100).toLocaleString()} KES — kept PROCESSING for review`,
            events: { create: { type: 'NOTE', actorSide: 'SYSTEM', note: 'Payout result amount mismatch/missing: not auto-settled. FINANCE review required.' } },
          },
        })
        await auditTx(tx, { action: 'SETTLEMENT_PAYOUT_AMOUNT_MISMATCH', targetType: 'SETTLEMENT', targetId: current.id, metadata: { ref: current.refCode, providerAmount: result.amount, netMinor: current.netMinor } })
        return 'Accepted (flagged for review)'
      }
      const moved = await tx.settlement.updateMany({
        where: { id: current.id, status: 'PROCESSING' },
        data: {
          status: 'SETTLED',
          providerRef: result.transactionId ?? result.conversationId ?? current.providerRef,
          settledAt: new Date(),
          lastError: null,
        },
      })
      if (moved.count === 0) return 'Accepted (state moved concurrently)'
      await tx.settlementEvent.create({ data: { settlementId: current.id, type: 'SETTLED', actorSide: 'SYSTEM', note: `Payout confirmed by provider${result.transactionId ? ` (receipt ${result.transactionId})` : ''}: ${result.resultDesc ?? ''}` } })
      await auditTx(tx, { action: 'SETTLEMENT_PAYOUT_CONFIRMED', targetType: 'SETTLEMENT', targetId: current.id, metadata: { ref: current.refCode, receipt: result.transactionId } })
      return 'Accepted'
    }

    const failed = await tx.settlement.updateMany({
      where: { id: current.id, status: 'PROCESSING' },
      data: {
        status: 'FAILED',
        lastError: `${result.resultCode}: ${result.resultDesc ?? 'Payout not completed'}`.slice(0, 300),
      },
    })
    if (failed.count === 0) return 'Accepted (state moved concurrently)'
    await tx.settlementEvent.create({ data: { settlementId: current.id, type: 'FAILED', actorSide: 'SYSTEM', note: `Provider result: ${result.resultDesc ?? 'not completed'}` } })
    await auditTx(tx, { action: 'SETTLEMENT_PAYOUT_NOT_COMPLETED', targetType: 'SETTLEMENT', targetId: current.id, metadata: { ref: current.refCode, resultCode: result.resultCode } })
    return 'Accepted'
  })

  return NextResponse.json({ ResultCode: 0, ResultDesc: desc })
}
