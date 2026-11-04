import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'
import { notifyMany } from '@/lib/notify'
import { getMembership } from '@/lib/orgs'
import { jsonParse } from '@/lib/supply'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), note: z.string().max(300).optional() }),
  z.object({ action: z.literal('reject'), note: z.string().max(300).optional() }),
  z.object({
    action: z.literal('dispatch'),
    dispatchRef: z.string().max(60).optional(),
    odometerKm: z.number().int().min(0).optional(),
    conditionNotes: z.string().max(1000).optional(),
    photos: z.array(z.string().max(300)).max(6).default([]),
  }),
  z.object({
    action: z.literal('receive'),
    receivedByName: z.string().trim().min(2).max(80),
    odometerKm: z.number().int().min(0).optional(),
    conditionNotes: z.string().max(1000).optional(),
    photos: z.array(z.string().max(300)).max(6).default([]),
  }),
  z.object({ action: z.literal('cancel'), note: z.string().max(300).optional() }),
])

/**
 * POST — transfer lifecycle. Approve (owner/GM) → dispatch from source branch
 * (condition report out) → receive at destination (condition report in) →
 * vehicle.branchId moves to the destination (one authoritative inventory
 * record). Every step writes an immutable event.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const body = await parseBody(req, schema)
  const transfer = await db.vehicleTransfer.findUnique({ where: { id }, include: { vehicle: true, toBranch: true, fromBranch: true } })
  if (!transfer) return fail(404, 'NOT_FOUND', 'Transfer not found.')
  const membership = await getMembership(transfer.orgId, user.id)
  if (!membership) return fail(403, 'FORBIDDEN', 'Not a member of this company.')

  const approver = ['OWNER', 'GM', 'MANAGER'].includes(membership.role)
  const notifyCompany = async (text: string) => {
    const members = await db.orgMember.findMany({ where: { orgId: transfer.orgId, role: { in: ['OWNER', 'GM', 'MANAGER', 'INVENTORY'] } }, select: { userId: true } })
    await notifyMany(members.map((m) => m.userId), { type: 'VEHICLE_TRANSFER', title: `Transfer ${transfer.refCode}`, body: text, link: '/dealer?tab=branches' })
  }

  switch (body.action) {
    case 'approve': {
      if (!approver) return fail(403, 'PERMISSION_DENIED', 'Only management authorises transfers.')
      if (transfer.status !== 'REQUESTED') return fail(409, 'INVALID_STATE', `Transfer is ${transfer.status}.`)
      await db.vehicleTransfer.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.id, events: { create: { type: 'APPROVED', actorId: user.id, actorName: user.name, note: body.note ?? 'Authorised.' } } } })
      await notifyCompany(`${transfer.refCode} approved — prepare dispatch from ${transfer.fromBranch.name}.`)
      await audit({ actorId: user.id, actorName: user.name, action: 'TRANSFER_APPROVED', targetType: 'VEHICLE_TRANSFER', targetId: id })
      return ok({ message: 'Transfer authorised.' })
    }
    case 'reject': {
      if (!approver) return fail(403, 'PERMISSION_DENIED', 'Only management can reject transfers.')
      if (!['REQUESTED', 'APPROVED'].includes(transfer.status)) return fail(409, 'INVALID_STATE', `Transfer is ${transfer.status}.`)
      await db.vehicleTransfer.update({ where: { id }, data: { status: 'REJECTED', events: { create: { type: 'REJECTED', actorId: user.id, actorName: user.name, note: body.note ?? 'Rejected.' } } } })
      return ok({ message: 'Transfer rejected.' })
    }
    case 'dispatch': {
      if (!['APPROVED'].includes(transfer.status)) return fail(409, 'INVALID_STATE', `Transfer is ${transfer.status}.`)
      const conditionOut = { odometerKm: body.odometerKm ?? null, notes: body.conditionNotes ?? null, photos: body.photos, recordedAt: new Date().toISOString(), by: user.name }
      await db.vehicleTransfer.update({
        where: { id },
        data: {
          status: 'DISPATCHED', dispatchedAt: new Date(),
          dispatchRef: body.dispatchRef ?? `DSP-${transfer.refCode}`,
          conditionOutJson: JSON.stringify(conditionOut),
          events: { create: { type: 'DISPATCHED', actorId: user.id, actorName: user.name, note: body.conditionNotes ? `Dispatched. Condition: ${body.conditionNotes.slice(0, 200)}` : 'Dispatched with condition report.' } },
        },
      })
      await notifyCompany(`${transfer.refCode} dispatched from ${transfer.fromBranch.name} — expect arrival at ${transfer.toBranch.name}.`)
      await audit({ actorId: user.id, actorName: user.name, action: 'TRANSFER_DISPATCHED', targetType: 'VEHICLE_TRANSFER', targetId: id })
      return ok({ message: 'Dispatch recorded with condition report.' })
    }
    case 'receive': {
      if (transfer.status !== 'DISPATCHED') return fail(409, 'INVALID_STATE', `Transfer is ${transfer.status}.`)
      const conditionIn = { odometerKm: body.odometerKm ?? null, notes: body.conditionNotes ?? null, photos: body.photos, receivedAt: new Date().toISOString(), by: body.receivedByName }
      await db.vehicleTransfer.update({
        where: { id },
        data: {
          status: 'RECEIVED', receivedAt: new Date(), receivedByName: body.receivedByName,
          conditionInJson: JSON.stringify(conditionIn),
          events: { create: { type: 'RECEIVED', actorId: user.id, actorName: user.name, note: `Received by ${body.receivedByName}. ${body.conditionNotes ? `Condition: ${body.conditionNotes.slice(0, 200)}` : ''}` } },
        },
      })
      // single authoritative inventory record moves to the destination branch
      await db.vehicle.update({ where: { id: transfer.vehicleId }, data: { branchId: transfer.toBranchId } })
      await notifyCompany(`${transfer.refCode} received at ${transfer.toBranch.name} — custody complete.`)
      await audit({ actorId: user.id, actorName: user.name, action: 'TRANSFER_RECEIVED', targetType: 'VEHICLE_TRANSFER', targetId: id })
      return ok({ message: 'Vehicle received. Inventory record updated.' })
    }
    case 'cancel': {
      if (!['REQUESTED', 'APPROVED'].includes(transfer.status)) return fail(409, 'INVALID_STATE', `Transfer is ${transfer.status}.`)
      if (!approver && membership.role !== 'BRANCH_MANAGER' && membership.role !== 'INVENTORY') {
        return fail(403, 'PERMISSION_DENIED', 'Not authorised to cancel.')
      }
      await db.vehicleTransfer.update({ where: { id }, data: { status: 'CANCELLED', events: { create: { type: 'CANCELLED', actorId: user.id, actorName: user.name, note: body.note ?? 'Cancelled.' } } } })
      return ok({ message: 'Transfer cancelled.' })
    }
  }
  return fail(400, 'UNKNOWN_ACTION', 'Unsupported action.')
})
