import { NextRequest } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireRole } from '@/lib/api'
import { demoStaffMutationGuard } from '@/lib/demo'
import { audit } from '@/lib/audit'
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
    const updated = await db.settlement.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        provider: 'MPESA_B2C',
        attempts: { increment: 1 },
        lastError: null,
        events: { create: { type: 'PAYOUT_ATTEMPT', actorId: user.id, actorName: user.name, actorSide: 'FINANCE', note: `Daraja B2C payout initiated (${originator})` } },
      },
    })
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
      await db.settlement.update({
        where: { id },
        data: { status: 'FAILED', lastError: message.slice(0, 300), events: { create: { type: 'FAILED', actorSide: 'SYSTEM', note: message.slice(0, 300) } } },
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'SETTLEMENT_PAYOUT_FAILED', targetType: 'SETTLEMENT', targetId: id, metadata: { ref: settlement.refCode, error: message.slice(0, 200) } })
      return fail(502, 'PAYOUT_FAILED', `The provider rejected the payout request: ${message}`)
    }
  }

  if (body.action === 'reconcile') {
    if (['SETTLED', 'CANCELLED'].includes(settlement.status)) {
      return fail(409, 'INVALID_STATE', `Settlement is already ${settlement.status}.`)
    }
    const updated = await db.settlement.update({
      where: { id },
      data: {
        status: 'SETTLED',
        provider: 'MANUAL',
        providerRef: body.reference,
        reconciledById: user.id,
        reconciledByName: user.name,
        reconciledNote: body.note ?? null,
        settledAt: new Date(),
        lastError: null,
        events: { create: { type: 'SETTLED', actorId: user.id, actorName: user.name, actorSide: 'FINANCE', note: `Manually reconciled with external reference ${body.reference}${body.note ? `: ${body.note}` : ''}` } },
      },
    })
    await audit({ actorId: user.id, actorName: user.name, action: 'SETTLEMENT_RECONCILED', targetType: 'SETTLEMENT', targetId: id, metadata: { ref: settlement.refCode, providerRef: body.reference, netMinor: settlement.netMinor } })
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
