import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'
import { notify, notifyMany } from '@/lib/notify'
import { getMembership } from '@/lib/orgs'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * PATCH — facility state transitions.
 *   Business: approve offer → (customer accepts) ACTIVE, suspend, close, reject.
 *   Customer: accept-terms (OFFERED → ACTIVE), close own (balance must be clear).
 * POST — ledger entries. CHARGE/FEE increases balance (validated against the
 * limit); REPAYMENT decreases and marks the entry paid. Everything is
 * appended-only; entries are never edited or deleted (audit history).
 */
const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), terms: z.string().trim().min(10).max(3000), depositMinor: z.number().int().min(0).optional() }),
  z.object({ action: z.literal('accept-terms') }),
  z.object({ action: z.literal('reject'), note: z.string().max(300).optional() }),
  z.object({ action: z.literal('suspend'), note: z.string().max(300).optional() }),
  z.object({ action: z.literal('close'), note: z.string().max(300).optional() }),
])

const entrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('CHARGE'), amountMinor: z.number().int().min(100), refType: z.string().max(40).optional(), refId: z.string().optional(), dueDate: z.string().optional(), note: z.string().max(300).optional() }),
  z.object({ kind: z.literal('REPAYMENT'), amountMinor: z.number().int().min(100), note: z.string().max(300).optional() }),
  z.object({ kind: z.literal('ADJUSTMENT'), amountMinor: z.number().int(), note: z.string().min(3).max(300) }),
])

export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const facility = await db.creditFacility.findUnique({ where: { id } })
  if (!facility) return fail(404, 'NOT_FOUND', 'Facility not found.')
  const body = await parseBody(req, patchSchema)

  const staff = await getMembership(facility.orgId, user.id)
  const isBiz = staff && ['OWNER', 'GM', 'MANAGER', 'FINANCE'].includes(staff.role)
  const isCustomer = facility.customerId === user.id

  if (body.action === 'approve') {
    if (!isBiz) return fail(403, 'PERMISSION_DENIED', 'Only the issuing business approves facilities.')
    if (facility.status !== 'PENDING_APPLICATION' && facility.status !== 'OFFERED') {
      return fail(409, 'INVALID_STATE', `Facility is ${facility.status}.`)
    }
    const updated = await db.creditFacility.update({
      where: { id },
      data: { status: 'OFFERED', terms: body.terms, ...(body.depositMinor !== undefined ? { depositMinor: body.depositMinor } : {}), approvedAt: new Date() },
    })
    await notify({ userId: facility.customerId, type: 'CREDIT_OFFER', title: 'Facility approved — accept terms', body: 'The business approved your application. Accept the repayment terms to activate the facility.', link: '/account?tab=subscriptions' })
    await audit({ actorId: user.id, actorName: user.name, action: 'CREDIT_APPROVED', targetType: 'CREDIT_FACILITY', targetId: id })
    return ok({ facility: updated, message: 'Offer sent to the customer. It activates when they accept the terms.' })
  }
  if (body.action === 'accept-terms') {
    if (!isCustomer) return fail(403, 'PERMISSION_DENIED', 'Only the customer accepts the terms.')
    if (facility.status !== 'OFFERED') return fail(409, 'INVALID_STATE', 'No active offer to accept.')
    const updated = await db.creditFacility.update({ where: { id }, data: { status: 'ACTIVE', termsAcceptedAt: new Date() } })
    const managers = await db.orgMember.findMany({ where: { orgId: facility.orgId, role: { in: ['OWNER', 'GM', 'FINANCE'] } }, select: { userId: true } })
    await notifyMany(managers.map((m) => m.userId), { type: 'CREDIT_ACTIVE', title: 'Facility activated', body: 'The customer accepted the repayment terms.', link: '/garage-dashboard?tab=credit' })
    await audit({ actorId: user.id, actorName: user.name, action: 'CREDIT_TERMS_ACCEPTED', targetType: 'CREDIT_FACILITY', targetId: id })
    return ok({ facility: updated, message: 'Facility active. Charges and repayments are now tracked in your statements.' })
  }
  if (!isBiz) return fail(403, 'PERMISSION_DENIED', 'Only the issuing business can change this facility.')
  if (body.action === 'reject' && facility.status === 'PENDING_APPLICATION') {
    await db.creditFacility.update({ where: { id }, data: { status: 'REJECTED' } })
    await notify({ userId: facility.customerId, type: 'CREDIT_REJECTED', title: 'Facility application decision', body: body.note ?? 'The business is not able to offer a facility at this time.', link: '/account?tab=subscriptions' })
    await audit({ actorId: user.id, actorName: user.name, action: 'CREDIT_REJECTED', targetType: 'CREDIT_FACILITY', targetId: id })
    return ok({ message: 'Application rejected.' })
  }
  if (body.action === 'suspend' && ['ACTIVE', 'OFFERED'].includes(facility.status)) {
    await db.creditFacility.update({ where: { id }, data: { status: 'SUSPENDED' } })
    await notify({ userId: facility.customerId, type: 'CREDIT_SUSPENDED', title: 'Facility suspended', body: body.note ?? 'Contact the business for details.', link: '/account?tab=subscriptions' })
    await audit({ actorId: user.id, actorName: user.name, action: 'CREDIT_SUSPENDED', targetType: 'CREDIT_FACILITY', targetId: id })
    return ok({ message: 'Facility suspended.' })
  }
  if (body.action === 'close') {
    const outstanding = (await db.creditEntry.findMany({ where: { facilityId: id } })).reduce((bal, e) => bal + (e.paidAt ? 0 : e.amountMinor), 0)
    if (outstanding > 0) return fail(409, 'OUTSTANDING_BALANCE', 'The balance must be cleared before closing the facility.')
    await db.creditFacility.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } })
    await audit({ actorId: user.id, actorName: user.name, action: 'CREDIT_CLOSED', targetType: 'CREDIT_FACILITY', targetId: id })
    return ok({ message: 'Facility closed.' })
  }
  return fail(409, 'INVALID_STATE', 'That transition is not valid for this facility.')
})

export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const facility = await db.creditFacility.findUnique({ where: { id } })
  if (!facility) return fail(404, 'NOT_FOUND', 'Facility not found.')
  const body = await parseBody(req, entrySchema)

  const staff = await getMembership(facility.orgId, user.id)
  const isBiz = staff && ['OWNER', 'GM', 'MANAGER', 'FINANCE', 'ACCOUNTANT'].includes(staff.role)
  const isCustomer = facility.customerId === user.id

  if (body.kind === 'REPAYMENT') {
    if (!isBiz && !isCustomer) return fail(403, 'PERMISSION_DENIED', 'Not authorised.')
    if (facility.status !== 'ACTIVE' && facility.status !== 'SUSPENDED') return fail(409, 'INVALID_STATE', 'Facility is not active.')
  } else {
    if (!isBiz) return fail(403, 'PERMISSION_DENIED', 'Only the business records charges.')
    if (facility.status !== 'ACTIVE') return fail(409, 'INVALID_STATE', 'Facility is not active — charges are only possible on an active facility.')
  }

  const entries = await db.creditEntry.findMany({ where: { facilityId: id } })
  const outstanding = entries.reduce((bal, e) => bal + (e.paidAt ? 0 : e.amountMinor), 0)

  const delta = body.kind === 'CHARGE' ? body.amountMinor : body.kind === 'REPAYMENT' ? -Math.min(body.amountMinor, Math.max(0, outstanding)) : body.amountMinor

  const newBalance = outstanding + delta
  if (body.kind === 'CHARGE' && newBalance > facility.limitMinor) {
    return fail(409, 'LIMIT_EXCEEDED', `Charge would exceed the approved limit (${((facility.limitMinor - outstanding) / 100).toLocaleString()} KES available).`)
  }
  if (newBalance < 0) return fail(409, 'OVER_REPAYMENT', 'Repayment exceeds the outstanding balance.')

  const entry = await db.creditEntry.create({
    data: {
      facilityId: id,
      kind: body.kind,
      amountMinor: body.kind === 'REPAYMENT' ? -Math.abs(delta) : delta,
      balanceAfterMinor: newBalance,
      refType: body.kind === 'CHARGE' ? body.refType ?? null : null,
      refId: body.kind === 'CHARGE' ? body.refId ?? null : null,
      dueDate: body.kind === 'CHARGE' && body.dueDate ? new Date(body.dueDate) : null,
      paidAt: body.kind === 'REPAYMENT' ? new Date() : null,
      note: body.note ?? null,
      actorId: user.id,
      actorName: user.name,
    },
  })
  await audit({ actorId: user.id, actorName: user.name, action: `CREDIT_${body.kind}`, targetType: 'CREDIT_FACILITY', targetId: id, metadata: { amount: body.amountMinor, balanceAfter: newBalance } })
  if (body.kind === 'REPAYMENT' && isCustomer) {
    const managers = await db.orgMember.findMany({ where: { orgId: facility.orgId, role: { in: ['OWNER', 'GM', 'FINANCE'] } }, select: { userId: true } })
    await notifyMany(managers.map((m) => m.userId), { type: 'CREDIT_REPAYMENT', title: 'Customer repayment recorded', body: `${user.name} repaid ${(body.amountMinor / 100).toLocaleString()} KES. Outstanding: ${(newBalance / 100).toLocaleString()} KES.`, link: '/garage-dashboard?tab=credit' })
  }
  return ok({ entry, outstandingMinor: newBalance, availableMinor: Math.max(0, facility.limitMinor - newBalance) }, { status: 201 })
})
