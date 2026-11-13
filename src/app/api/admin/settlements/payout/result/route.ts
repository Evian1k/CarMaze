import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { audit } from '@/lib/audit'
import { verifyWebhookSignature, webhookRejected } from '@/lib/webhook-auth'
import { parseB2cResult } from '@/lib/mpesa'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/settlements/payout/result — Daraja B2C Result callback.
 *
 * The payout provider's confirmation is the ONLY thing that can mark a
 * settlement SETTLED after a `process` attempt. ResultCode 0 means the
 * transfer actually completed; anything else records the failure verbatim.
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
    await audit({ action: 'SETTLEMENT_PAYOUT_RESULT_UNKNOWN', targetType: 'SETTLEMENT', metadata: { conversationId: result.conversationId, originator: result.originatorConversationId } })
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  if (result.resultCode === 0) {
    // Amount integrity: the provider-confirmed payout must match what we sent.
    // A missing or mismatched amount stays PROCESSING for FINANCE review
    // rather than being marked SETTLED.
    if (result.amount == null || Math.round(result.amount) !== Math.round(settlement.netMinor / 100)) {
      await db.settlement.update({
        where: { id: settlement.id },
        data: {
          lastError: `B2C result amount unverifiable: provider ${result.amount ?? 'missing'} vs net ${(settlement.netMinor / 100).toLocaleString()} KES — kept PROCESSING for review`,
          events: { create: { type: 'EVENT', actorSide: 'SYSTEM', note: 'Payout result amount mismatch/missing: not auto-settled. FINANCE review required.' } },
        },
      })
      await audit({ action: 'SETTLEMENT_PAYOUT_AMOUNT_MISMATCH', targetType: 'SETTLEMENT', targetId: settlement.id, metadata: { ref: settlement.refCode, providerAmount: result.amount, netMinor: settlement.netMinor } })
      return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted (flagged for review)' })
    }
    await db.settlement.update({
      where: { id: settlement.id },
      data: {
        status: 'SETTLED',
        providerRef: result.transactionId ?? result.conversationId ?? settlement.providerRef,
        settledAt: new Date(),
        lastError: null,
        events: { create: { type: 'SETTLED', actorSide: 'SYSTEM', note: `Payout confirmed by provider${result.transactionId ? ` (receipt ${result.transactionId})` : ''}: ${result.resultDesc ?? ''}` } },
      },
    })
    await audit({ action: 'SETTLEMENT_PAYOUT_CONFIRMED', targetType: 'SETTLEMENT', targetId: settlement.id, metadata: { ref: settlement.refCode, receipt: result.transactionId } })
  } else {
    await db.settlement.update({
      where: { id: settlement.id },
      data: {
        status: 'FAILED',
        lastError: `${result.resultCode}: ${result.resultDesc ?? 'Payout not completed'}`.slice(0, 300),
        events: { create: { type: 'FAILED', actorSide: 'SYSTEM', note: `Provider result: ${result.resultDesc ?? 'not completed'}` } },
      },
    })
    await audit({ action: 'SETTLEMENT_PAYOUT_NOT_COMPLETED', targetType: 'SETTLEMENT', targetId: settlement.id, metadata: { ref: settlement.refCode, resultCode: result.resultCode } })
  }

  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })
}
