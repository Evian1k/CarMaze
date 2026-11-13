import { NextRequest } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireRole, ApiError } from '@/lib/api'
import { demoStaffMutationGuard } from '@/lib/demo'
import { audit, auditTx } from '@/lib/audit'
import { b2cPayout, mpesaB2cConfigured, mpesaB2cMissingVars } from '@/lib/mpesa'

type Ctx = { params: Promise<{ id: string }> }

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('process') }),
  z.object({ action: z.literal('reconcile'), reference: z.string().trim().min(3).max(80), note: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('hold'), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal('release') }),
  z.object({ action: z.literal('cancel'), reason: z.string().trim().min(3).max(300) }),
])

/**
 * POST /api/admin/settlements/[id]/action — platform payout operations.
 *
 * FINANCE/ADMIN/FOUNDER only; demo sessions are hard-blocked. States move
 * only as far as real evidence allows:
 *  - process: initiates a REAL Daraja B2C payout; without provider credentials
 *    this returns 501 PAYOUT_NOT_CONFIGURED and the settlement stays PENDING.
 *  - reconcile: records a manual settlement with an EXTERNAL payment
 *    reference — the honest path while no payout provider is connected.
 *  - hold / release / cancel: operations controls, fully event-logged.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireRole('FINANCE', 'ADMIN', 'FOUNDER')
  await demoStaffMutationGuard(user, { platformWide: true })

  const { id } = await ctx.params
  const body = await parseBody(req, schema)
  const settlement = await db.settlement.findUnique({ where: { id }, include: { org: { select: { id: true, name: true, phone: true } } } })
  if (!settlement) return fail(404, 'NOT_FOUND', 'Settlement not found.')

  if (body.action === 'process') {
    if (!['PENDING', 'FAILED'].includes(settlement.status)) {
      return fail(409, 'INVALID_STATE', `A payout can be attempted from PENDING or FAILED (current: ${settlement.status}).`)
    }
    if (!mpesaB2cConfigured()) {
      return fail(501, 'PAYOUT_NOT_CONFIGURED',
        `Payout provider is not configured on this deployment (missing: ${mpesaB2cMissingVars().join(', ')}). Record a manual reconciliation instead — CARMAZE never simulates a money transfer.`,
        { missing: mpesaB2cMissingVars() })
    }
    if (!settlement.org.phone) {
      return fail(400, 'NO_PAYOUT_PHONE', 'The supplier organisation has no payout phone number recorded.')
    }
    const originator = `STL-${settlement.refCode}-${randomBytes(4).toString('hex')}`
    // Conditional transition: only a still-PENDING/FAILED settlement enters
    // PROCESSING. Two concurrent finance operators cannot both start a payout
    // for the same money — the second is rejected before any provider call.
    const entered = await db.settlement.updateMany({
      where: { id, status: { in: ['PENDING', 'FAILED'] } },
      data: {
        status: 'PROCESSING',
        provider: 'MPESA_B2C',
        attempts: { increment: 1 },
        lastError: null,
      },
    })
    if (entered.count === 0) {
      return fail(409, 'INVALID_STATE', 'Settlement state moved concurrently; payout not started.')
    }
    await db.settlementEvent.create({ data: { settlementId: id, type: 'PAYOUT_ATTEMPT', actorId: user.id, actorName: user.name, actorSide: 'FINANCE', note: `Daraja B2C payout initiated (${originator})` } })
    const updated = await db.settlement.findUnique({ where: { id } })
    try {
      const result = await b2cPayout({
        phone: settlement.org.phone,
        amountMinor: settlement.netMinor,
        remarks: `CARMAZE settlement ${settlement.refCode}`,
        originatorConversationId: originator,
      })
      await db.settlement.update({
        where: { id },
        data: { providerRef: result.conversationId || originator, events: { create: { type: 'NOTE', actorSide: 'SYSTEM', note: `Provider accepted payout request: ${result.responseDescription}` } } },
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'SETTLEMENT_PAYOUT_INITIATED', targetType: 'SETTLEMENT', targetId: id, metadata: { ref: settlement.refCode, conversationId: result.conversationId } })
      return ok({ settlement: updated, providerAccepted: true, message: 'Payout request accepted by provider. Status becomes SETTLED only on the provider result callback.' })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Payout request failed'
      // Failure is recorded only if the settlement is still the PROCESSING one
      // we started — never clobbering a concurrent reconcile/cancel decision.
      await db.settlement.updateMany({
        where: { id, status: 'PROCESSING' },
        data: { status: 'FAILED', lastError: message.slice(0, 300) },
      })
      await db.settlementEvent.create({ data: { settlementId: id, type: 'FAILED', actorSide: 'SYSTEM', note: message.slice(0, 300) } }).catch(() => null)
      await audit({ actorId: user.id, actorName: user.name, action: 'SETTLEMENT_PAYOUT_FAILED', targetType: 'SETTLEMENT', targetId: id, metadata: { ref: settlement.refCode, error: message.slice(0, 200) } })
      return fail(502, 'PAYOUT_FAILED', `The provider rejected the payout request: ${message}`)
    }
  }

  if (body.action === 'reconcile') {
    if (['SETTLED', 'CANCELLED'].includes(settlement.status)) {
      return fail(409, 'INVALID_STATE', `Settlement is already ${settlement.status}.`)
    }
    // Dispute integrity: a settlement held because of an OPEN dispute must not
    // be settled out from under that dispute — resolve the dispute first
    // (mirrors the ORDER_DISPUTED guard on payment reconciliation).
    if (settlement.orderId && settlement.status === 'ON_HOLD') {
      const openDispute = await db.dispute.findFirst({ where: { orderId: settlement.orderId, status: { in: ['OPEN', 'UNDER_REVIEW'] } } })
      if (openDispute) return fail(409, 'ORDER_DISPUTED', `Dispute ${openDispute.refCode} is still open on this order. Resolve the dispute first; settling now would bypass the dispute hold.`)
    }
    // Conditional transition inside one transaction: the SETTLED flip and its
    // audit row are atomic; a concurrent payout result or another operator's
    // reconcile cannot double-settle the same money.
    const updated = await db.$transaction(async (tx) => {
      const moved = await tx.settlement.updateMany({
        where: { id, status: { notIn: ['SETTLED', 'CANCELLED'] } },
        data: {
          status: 'SETTLED',
          provider: 'MANUAL',
          providerRef: body.reference,
          reconciledById: user.id,
          reconciledByName: user.name,
          reconciledNote: body.note ?? null,
          settledAt: new Date(),
          lastError: null,
        },
      })
      if (moved.count === 0) {
        throw new ApiError(409, 'INVALID_STATE', 'Settlement was settled or cancelled concurrently; this reconciliation is rejected.')
      }
      await tx.settlementEvent.create({ data: { settlementId: id, type: 'SETTLED', actorId: user.id, actorName: user.name, actorSide: 'FINANCE', note: `Manually reconciled with external reference ${body.reference}${body.note ? `: ${body.note}` : ''}` } })
      await auditTx(tx, { actorId: user.id, actorName: user.name, action: 'SETTLEMENT_RECONCILED', targetType: 'SETTLEMENT', targetId: id, metadata: { ref: settlement.refCode, providerRef: body.reference, netMinor: settlement.netMinor } })
      return tx.settlement.findUnique({ where: { id } })
    })
    return ok({ settlement: updated, message: 'Settlement reconciled with an external payment reference.' })
  }

  if (body.action === 'hold') {
    if (!['PENDING', 'PROCESSING', 'FAILED'].includes(settlement.status)) {
      return fail(409, 'INVALID_STATE', `Cannot hold a ${settlement.status} settlement.`)
    }
    const updated = await db.settlement.update({
      where: { id },
      data: { status: 'ON_HOLD', holdReason: body.reason, events: { create: { type: 'HOLD', actorId: user.id, actorName: user.name, actorSide: 'FINANCE', note: body.reason } } },
    })
    await audit({ actorId: user.id, actorName: user.name, action: 'SETTLEMENT_HELD', targetType: 'SETTLEMENT', targetId: id, metadata: { ref: settlement.refCode, reason: body.reason } })
    return ok({ settlement: updated })
  }

  if (body.action === 'release') {
    if (settlement.status !== 'ON_HOLD') return fail(409, 'INVALID_STATE', 'Only a settlement on hold can be released back to PENDING.')
    // Same dispute integrity as reconcile: an ON_HOLD settlement caused by an
    // open dispute cannot be un-held while that dispute is undecided.
    if (settlement.orderId) {
      const openDispute = await db.dispute.findFirst({ where: { orderId: settlement.orderId, status: { in: ['OPEN', 'UNDER_REVIEW'] } } })
      if (openDispute) return fail(409, 'ORDER_DISPUTED', `Dispute ${openDispute.refCode} is still open on this order; the hold stays until the dispute is resolved.`)
    }
    const updated = await db.settlement.update({
      where: { id },
      data: { status: 'PENDING', holdReason: null, events: { create: { type: 'HOLD_RELEASED', actorId: user.id, actorName: user.name, actorSide: 'FINANCE', note: 'Hold released: settlement returned to PENDING.' } } },
    })
    await audit({ actorId: user.id, actorName: user.name, action: 'SETTLEMENT_HOLD_RELEASED', targetType: 'SETTLEMENT', targetId: id, metadata: { ref: settlement.refCode } })
    return ok({ settlement: updated })
  }

  // cancel
  if (settlement.status === 'SETTLED') return fail(409, 'INVALID_STATE', 'A settled payout cannot be cancelled — process a refund instead.')
  const updated = await db.settlement.update({
    where: { id },
    data: { status: 'CANCELLED', holdReason: null, events: { create: { type: 'CANCELLED', actorId: user.id, actorName: user.name, actorSide: 'FINANCE', note: body.reason } } },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'SETTLEMENT_CANCELLED', targetType: 'SETTLEMENT', targetId: id, metadata: { ref: settlement.refCode, reason: body.reason } })
  return ok({ settlement: updated })
})
