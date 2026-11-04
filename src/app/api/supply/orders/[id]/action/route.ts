import { NextRequest } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { refCode, shareId, sixDigitCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notify, notifyMany } from '@/lib/notify'
import { getMembership } from '@/lib/orgs'
import {
  requireOrgMember, roleCan, poEvent, deliveryEvent,
  releaseReservation, fulfillStock, computeCommission, getFees, jsonParse,
} from '@/lib/supply'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const schema = z.discriminatedUnion('action', [
  // STEP 2 — supplier response
  z.object({
    action: z.literal('respond'),
    decision: z.enum(['ACCEPT', 'REJECT', 'REVISE']),
    note: z.string().max(500).optional().nullable(),
    revision: z.object({
      changes: z.array(z.object({
        itemId: z.string().optional(),
        productId: z.string(),
        action: z.enum(['UPDATE', 'REMOVE', 'ADD']),
        qty: z.number().int().min(1).max(10_000).optional(),
        unitPriceMinor: z.number().int().min(100).optional(),
      })).min(1),
    }).optional(),
  }),
  // garage internal approval gate
  z.object({ action: z.literal('approve'), note: z.string().max(300).optional() }),
  // garage decision on supplier revision
  z.object({ action: z.literal('revision-decision'), decision: z.enum(['APPROVED', 'DECLINED']), revisionId: z.string(), note: z.string().max(300).optional() }),
  // garage cancels before dispatch
  z.object({ action: z.literal('cancel'), reason: z.string().min(3).max(300) }),
  // STEP 3 — delivery arrangement
  z.object({
    action: z.literal('arrange'),
    method: z.enum(['DIRECT', 'COLLECTION', 'MEETUP']),
    supplierBranchId: z.string().optional(),
    meetup: z.object({ lat: z.number(), lng: z.number(), address: z.string().min(4).max(200) }).optional(),
    scheduledFor: z.string().optional(),
    windowLabel: z.string().max(60).optional(),
    feeMinor: z.number().int().min(0).max(1_000_000).default(0),
    courierName: z.string().max(80).optional().nullable(),
  }),
  z.object({ action: z.literal('agree-location'), note: z.string().max(300).optional() }),
  // STEP 5 — supplier dispatch
  z.object({
    action: z.literal('dispatch'),
    supplierBranchId: z.string().optional(),
    courierName: z.string().max(80).optional().nullable(),
    driverName: z.string().max(80).optional().nullable(),
    driverPhone: z.string().max(20).optional().nullable(),
    vehicleReg: z.string().max(20).optional().nullable(),
    deliveryRef: z.string().max(60).optional().nullable(),
    expectedHours: z.number().int().min(1).max(720).optional(),
    evidence: z.array(z.string().max(300)).max(6).default([]),
  }),
  // STEP 6 — handover confirmation (supplier marks handed over; garage verifies OTP/QR)
  z.object({ action: z.literal('handover'), otp: z.string().length(6).optional(), qrToken: z.string().max(20).optional(), captureLocation: z.boolean().default(false), location: z.object({ lat: z.number(), lng: z.number() }).optional(), photos: z.array(z.string().max(300)).max(6).default([]) }),
  z.object({ action: z.literal('handover-confirm') }),
  // STEP 7 — inspection
  z.object({
    action: z.literal('inspect'),
    result: z.enum(['ACCEPT', 'PARTIAL', 'ISSUES']),
    items: z.array(z.object({ itemId: z.string(), qtyAccepted: z.number().int().min(0), note: z.string().max(300).optional() })).default([]),
    note: z.string().max(1000).optional(),
    photos: z.array(z.string().max(300)).max(6).default([]),
  }),
  // STEP 8 — payment release request (executed against protected funds)
  z.object({ action: z.literal('release'), note: z.string().max(300).optional() }),
  // STEP 9 — dispute
  z.object({
    action: z.literal('dispute'),
    reason: z.enum(['MISSING_ITEMS', 'DAMAGED', 'WRONG_ITEM', 'COUNTERFEIT', 'NOT_RECEIVED', 'OTHER']),
    details: z.string().min(10).max(2000),
    evidence: z.array(z.object({ url: z.string().max(300), name: z.string().max(120) })).max(6).default([]),
  }),
  z.object({ action: z.literal('request-return'), reason: z.string().min(5).max(300), items: z.array(z.object({ productId: z.string(), qty: z.number().int().min(1) })).min(1) }),
  z.object({ action: z.literal('warranty'), productId: z.string(), issue: z.string().min(10).max(1000) }),
])

/** POST /api/supply/orders/[id]/action — every state transition of the
 * protected supplier→garage order workflow. Permissions and allowed source
 * states are enforced here for BOTH sides — the UI merely reflects them. */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const body = await parseBody(req, schema)

  const order = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      garage: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      items: { include: { product: true } }, delivery: true, payment: true,
    },
  })
  if (!order) return fail(404, 'NOT_FOUND', 'Order not found.')

  // resolve side + membership
  const garageMember = await getMembership(order.garageOrgId, user.id)
  const supplierMember = await getMembership(order.supplierOrgId, user.id)
  const isStaff = user.roles.some((r) => ['FINANCE', 'ADMIN', 'FOUNDER'].includes(r))
  if (!garageMember && !supplierMember && !isStaff) return fail(403, 'FORBIDDEN', 'You are not authorised on this order.')
  const side: 'GARAGE' | 'SUPPLIER' = supplierMember ? 'SUPPLIER' : 'GARAGE'
  const memberRole = side === 'SUPPLIER' ? supplierMember!.role : garageMember!.role

  // permission matrix check per action
  const actionPerm: Record<string, Parameters<typeof roleCan>[2]> = {
    respond: 'order.respond', approve: 'order.approve', 'revision-decision': 'order.approve',
    cancel: 'order.create', arrange: 'delivery.arrange', 'agree-location': 'delivery.arrange',
    dispatch: 'order.respond', handover: 'order.read', 'handover-confirm': 'order.respond',
    inspect: 'order.approve', release: 'payment.initiate', dispute: 'dispute.open',
    'request-return': 'order.create', warranty: 'order.create',
  }
  const needed = actionPerm[body.action]
  if (needed && !roleCan(side, memberRole, needed) && !isStaff) {
    return fail(403, 'PERMISSION_DENIED', `Your role (${memberRole}) cannot perform "${body.action}" on this order.`)
  }

  const supplierCtx = { orgId: order.supplierOrgId, side: 'SUPPLIER' as const }
  const garageCtx = { orgId: order.garageOrgId, side: 'GARAGE' as const }
  const actorCtx = side === 'SUPPLIER' ? supplierCtx : garageCtx

  switch (body.action) {
    // ─────────── STEP 2: supplier response ───────────
    case 'respond': {
      if (side !== 'SUPPLIER') return fail(403, 'PERMISSION_DENIED', 'Only the supplier responds to orders.')
      if (order.status !== 'SUBMITTED') return fail(409, 'INVALID_STATE', `Order is ${order.status}; expected SUBMITTED.`)
      if (body.decision === 'ACCEPT') {
        await db.purchaseOrder.update({ where: { id }, data: { status: 'ACCEPTED', supplierNote: body.note ?? null } })
        await poEvent(id, { type: 'ACCEPTED', actorId: user.id, actorName: user.name, actorSide: 'SUPPLIER', note: body.note ?? 'Supplier accepted the order.' })
        await notifyGarageMembers(order.garageOrgId, id, order.refCode, `Supplier accepted order ${order.refCode}. Arrange delivery and payment.`, 'PO_ACCEPTED')
      } else if (body.decision === 'REJECT') {
        await db.purchaseOrder.update({ where: { id }, data: { status: 'REJECTED', supplierNote: body.note ?? 'Rejected by supplier' } })
        for (const item of order.items) {
          if (item.fulfilBranchId) await releaseReservation(item.productId, item.fulfilBranchId, item.qty, { type: 'PURCHASE_ORDER', id, actorName: user.name })
        }
        await poEvent(id, { type: 'CANCELLED', actorId: user.id, actorName: user.name, actorSide: 'SUPPLIER', note: body.note ?? 'Order rejected by supplier.' })
        await notifyGarageMembers(order.garageOrgId, id, order.refCode, `Supplier rejected order ${order.refCode}. ${body.note ?? ''}`, 'PO_REJECTED')
      } else {
        if (!body.revision) return fail(400, 'VALIDATION_ERROR', 'A revision proposal is required.')
        // recompute totals from proposed changes
        const proposed = new Map<string, { qty: number; unit: number }>()
        for (const it of order.items) proposed.set(it.productId, { qty: it.qty, unit: it.unitPriceMinor })
        for (const ch of body.revision.changes) {
          if (ch.action === 'REMOVE') proposed.delete(ch.productId)
          else proposed.set(ch.productId, { qty: ch.qty ?? proposed.get(ch.productId)?.qty ?? 1, unit: ch.unitPriceMinor ?? proposed.get(ch.productId)?.unit ?? 0 })
        }
        const newSubtotal = [...proposed.values()].reduce((s, v) => s + v.qty * v.unit, 0)
        const revision = await db.pORevision.create({
          data: {
            orderId: id,
            proposedBy: 'SUPPLIER',
            changesJson: JSON.stringify(body.revision.changes),
            newTotalMinor: newSubtotal,
            note: body.note ?? null,
          },
        })
        await db.purchaseOrder.update({ where: { id }, data: { status: 'REVISED', supplierNote: body.note ?? null, revisedBySupplier: true } })
        await poEvent(id, { type: 'REVISED', actorId: user.id, actorName: user.name, actorSide: 'SUPPLIER', note: body.note ?? `Supplier proposed changes (new subtotal ${newSubtotal / 100} KES).` })
        await notifyGarageMembers(order.garageOrgId, id, order.refCode, `Supplier proposed changes on ${order.refCode}. Your approval is required before the order is final.`, 'PO_REVISED')
        return ok({ revisionId: revision.id, message: 'Revision proposed. The garage must approve before the order is final.' })
      }
      return ok({ message: 'Response recorded.' })
    }

    // ─────────── garage internal approval ───────────
    case 'approve': {
      if (side !== 'GARAGE') return fail(403, 'PERMISSION_DENIED', 'Only the garage approves internally.')
      if (order.status !== 'AWAITING_APPROVAL') return fail(409, 'INVALID_STATE', `Order is ${order.status}; expected AWAITING_APPROVAL.`)
      await db.purchaseOrder.update({ where: { id }, data: { status: 'SUBMITTED' } })
      await poEvent(id, { type: 'APPROVED', actorId: user.id, actorName: user.name, actorSide: 'GARAGE', note: body.note ?? 'Approved by management — sent to supplier.' })
      await notifySupplierMembers(order.supplierOrgId, order.refCode, `${order.garage.name} approved order ${order.refCode}. It now awaits your response.`, 'PO_NEW')
      return ok({ message: 'Order approved and sent to the supplier.' })
    }

    case 'revision-decision': {
      if (side !== 'GARAGE') return fail(403, 'PERMISSION_DENIED', 'Only the garage decides on revisions.')
      if (order.status !== 'REVISED') return fail(409, 'INVALID_STATE', `Order is ${order.status}; expected REVISED.`)
      const revision = await db.pORevision.findUnique({ where: { id: body.revisionId } })
      if (!revision || revision.orderId !== id) return fail(404, 'NOT_FOUND', 'Revision not found.')
      if (revision.status !== 'PENDING') return fail(409, 'INVALID_STATE', 'Revision already decided.')

      if (body.decision === 'APPROVED') {
        // apply changes to items & totals; adjust reservations
        const changes = jsonParse<{ action: string; productId: string; itemId?: string; qty?: number; unitPriceMinor?: number }[]>(revision.changesJson, [])
        for (const ch of changes) {
          const item = order.items.find((i) => i.id === ch.itemId || i.productId === ch.productId)
          if (ch.action === 'REMOVE' && item) {
            if (item.fulfilBranchId) await releaseReservation(item.productId, item.fulfilBranchId, item.qty, { type: 'PURCHASE_ORDER', id, actorName: user.name })
            await db.pOItem.delete({ where: { id: item.id } })
          } else if (item && ch.qty && ch.unitPriceMinor) {
            await db.pOItem.update({ where: { id: item.id }, data: { qty: ch.qty, unitPriceMinor: ch.unitPriceMinor, lineTotalMinor: ch.qty * ch.unitPriceMinor } })
          } else if (ch.action === 'ADD' && ch.qty && ch.unitPriceMinor) {
            const product = await db.product.findFirst({ where: { id: ch.productId, supplierOrgId: order.supplierOrgId, status: 'PUBLISHED' } })
            if (!product) return fail(400, 'INVALID_PRODUCT', 'Proposed product is unavailable.')
            await db.pOItem.create({ data: { orderId: id, productId: ch.productId, qty: ch.qty, unitPriceMinor: ch.unitPriceMinor, lineTotalMinor: ch.qty * ch.unitPriceMinor } })
          }
        }
        const items = await db.pOItem.findMany({ where: { orderId: id } })
        const subtotal = items.reduce((s, i) => s + i.lineTotalMinor, 0)
        await db.purchaseOrder.update({ where: { id }, data: { status: 'ACCEPTED', subtotalMinor: subtotal, totalMinor: subtotal + order.taxMinor, garageApprovedRevision: true } })
        await db.pORevision.update({ where: { id: revision.id }, data: { status: 'APPROVED' } })
        await poEvent(id, { type: 'REVISION_DECISION', actorId: user.id, actorName: user.name, actorSide: 'GARAGE', note: body.note ?? 'Garage approved the revised quotation.' })
        await notifySupplierMembers(order.supplierOrgId, order.refCode, `${order.garage.name} approved your revision on ${order.refCode}.`, 'PO_ACCEPTED')
        return ok({ message: 'Revision approved — order finalised at the revised terms.' })
      } else {
        await db.pORevision.update({ where: { id: revision.id }, data: { status: 'DECLINED' } })
        await db.purchaseOrder.update({ where: { id }, data: { status: 'SUBMITTED' } })
        await poEvent(id, { type: 'REVISION_DECISION', actorId: user.id, actorName: user.name, actorSide: 'GARAGE', note: body.note ?? 'Garage declined the revision — original terms stand.' })
        await notifySupplierMembers(order.supplierOrgId, order.refCode, `${order.garage.name} declined your revision on ${order.refCode}. Original terms stand.`, 'PO_REVISED')
        return ok({ message: 'Revision declined. The supplier may respond again on the original terms.' })
      }
    }

    // ─────────── cancel ───────────
    case 'cancel': {
      if (side !== 'GARAGE') return fail(403, 'PERMISSION_DENIED', 'Only the garage cancels orders.')
      if (!['SUBMITTED', 'AWAITING_APPROVAL', 'ACCEPTED', 'REVISED', 'CONFIRMED'].includes(order.status)) {
        return fail(409, 'INVALID_STATE', `Order cannot be cancelled at ${order.status}.`)
      }
      if (order.paymentStatus === 'PROTECTED') return fail(409, 'PAYMENT_PROTECTED', 'Payment is protected — open a dispute instead.')
      for (const item of order.items) {
        if (item.fulfilBranchId) await releaseReservation(item.productId, item.fulfilBranchId, item.qty, { type: 'PURCHASE_ORDER', id, actorName: user.name })
      }
      await db.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelledReason: body.reason } })
      await poEvent(id, { type: 'CANCELLED', actorId: user.id, actorName: user.name, actorSide: 'GARAGE', note: body.reason })
      await notifySupplierMembers(order.supplierOrgId, order.refCode, `${order.garage.name} cancelled order ${order.refCode}. Reason: ${body.reason}`, 'PO_CANCELLED')
      await audit({ actorId: user.id, actorName: user.name, action: 'PO_CANCELLED', targetType: 'PURCHASE_ORDER', targetId: id, metadata: { reason: body.reason } })
      return ok({ message: 'Order cancelled and stock reservations released.' })
    }

    // ─────────── STEP 3: delivery arrangement ───────────
    case 'arrange': {
      if (order.status !== 'ACCEPTED' && order.status !== 'CONFIRMED' && order.status !== 'REVISED') {
        return fail(409, 'INVALID_STATE', `Delivery is arranged after acceptance (current: ${order.status}).`)
      }
      const method = body.method
      let supplierBranchId: string | null = order.delivery?.supplierBranchId ?? null
      let meetupJson: string | null = order.delivery?.meetupJson ?? null
      let agreedByGarage = order.delivery?.meetupAgreedByGarage ?? false
      let agreedBySupplier = order.delivery?.meetupAgreedBySupplier ?? false
      let status = 'ARRANGING'
      let message = ''
      let changed = false

      if (method === 'DIRECT') {
        if (!order.destinationBranchId) return fail(400, 'NO_DESTINATION', 'Choose the garage branch receiving this delivery.')
        status = 'AGREED'
        message = 'Direct delivery to your branch arranged.'
      } else if (method === 'COLLECTION') {
        if (!body.supplierBranchId) return fail(400, 'NO_BRANCH', 'Choose the supplier warehouse for collection.')
        const wb = await db.orgBranch.findFirst({ where: { id: body.supplierBranchId, orgId: order.supplierOrgId, status: 'ACTIVE' } })
        if (!wb) return fail(400, 'NO_BRANCH', 'Warehouse does not belong to the supplier.')
        supplierBranchId = wb.id
        status = 'AGREED'
        message = 'Collection from the supplier warehouse arranged.'
      } else {
        // MEETUP — proposed location requires BOTH parties' agreement; a new
        // proposal resets the counterparty's consent.
        if (!body.meetup) return fail(400, 'NO_LOCATION', 'Propose a handover location on the map.')
        changed = !meetupJson || jsonParse<{ address?: string }>(meetupJson, {}).address !== body.meetup.address
        if (changed) {
          meetupJson = JSON.stringify(body.meetup)
          if (side === 'GARAGE') { agreedByGarage = true; agreedBySupplier = false }
          else { agreedBySupplier = true; agreedByGarage = false }
        }
        message = agreedByGarage && agreedBySupplier ? 'Handover location agreed by both parties.' : 'Location proposed — awaiting the other party\'s agreement.'
        status = agreedByGarage && agreedBySupplier ? 'AGREED' : 'ARRANGING'
      }

      const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null
      const delivery = await db.delivery.upsert({
        where: { orderId: id },
        create: {
          refCode: refCode('DLV', 6),
          orderId: id, method, status, supplierBranchId, meetupJson,
          meetupAgreedByGarage: agreedByGarage, meetupAgreedBySupplier: agreedBySupplier,
          scheduledFor, windowLabel: body.windowLabel ?? null, feeMinor: body.feeMinor,
          events: { create: { type: 'ARRANGED', actorId: user.id, actorName: user.name, actorSide: side, note: `${method} delivery arranged.` } },
        },
        update: {
          method, status, supplierBranchId, meetupJson,
          meetupAgreedByGarage: agreedByGarage, meetupAgreedBySupplier: agreedBySupplier,
          scheduledFor, windowLabel: body.windowLabel !== undefined ? (body.windowLabel ?? null) : (order.delivery?.windowLabel ?? null),
          feeMinor: body.feeMinor,
        },
      })
      await db.purchaseOrder.update({
        where: { id },
        data: {
          deliveryMethod: method,
          deliveryFeeMinor: body.feeMinor,
          totalMinor: order.subtotalMinor + order.taxMinor + body.feeMinor,
          status: status === 'AGREED' ? 'CONFIRMED' : order.status,
        },
      })
      await deliveryEvent(delivery.id, { type: changed ? 'LOCATION_PROPOSED' : 'ARRANGED', actorId: user.id, actorName: user.name, actorSide: side, note: `${method} — ${message}` })
      await poEvent(id, { type: 'NOTE', actorId: user.id, actorName: user.name, actorSide: side, note: `Delivery arrangement: ${message}` })
      await notifyOtherSide(actorCtx, order, `${order.refCode}: ${message}`, 'PO_DELIVERY')
      return ok({ delivery, message })
    }

    case 'agree-location': {
      const delivery = order.delivery
      if (!delivery || delivery.method !== 'MEETUP') return fail(409, 'INVALID_STATE', 'No meetup location to agree on.')
      if (delivery.status === 'AGREED') return ok({ message: 'Location already agreed.' })
      const updated = await db.delivery.update({
        where: { id: delivery.id },
        data: side === 'GARAGE' ? { meetupAgreedByGarage: true } : { meetupAgreedBySupplier: true },
      })
      const both = updated.meetupAgreedByGarage && updated.meetupAgreedBySupplier
      if (both) {
        await db.delivery.update({ where: { id: delivery.id }, data: { status: 'AGREED' } })
        await db.purchaseOrder.update({ where: { id }, data: { status: 'CONFIRMED' } })
      }
      await deliveryEvent(delivery.id, { type: 'LOCATION_AGREED', actorId: user.id, actorName: user.name, actorSide: side, note: body.note ?? 'Agreed to the handover location.' })
      await notifyOtherSide(actorCtx, order, `${order.refCode}: ${side === 'GARAGE' ? 'Garage' : 'Supplier'} agreed to the handover location${both ? ' — delivery is now locked. Location changes require a new mutual agreement.' : ''}`, 'PO_DELIVERY')
      return ok({ agreed: both, message: both ? 'Both parties agreed. Location is locked.' : 'Your agreement is recorded — awaiting the other party.' })
    }

    // ─────────── STEP 5: dispatch ───────────
    case 'dispatch': {
      if (side !== 'SUPPLIER') return fail(403, 'PERMISSION_DENIED', 'Only the supplier dispatches.')
      if (order.status !== 'CONFIRMED') return fail(409, 'INVALID_STATE', `Order is ${order.status}; dispatch requires CONFIRMED.`)
      if (order.paymentStatus !== 'PROTECTED') {
        return fail(409, 'PAYMENT_REQUIRED', 'Payment must be protected before dispatch. Funds are only released after the garage accepts the delivery.')
      }
      const delivery = order.delivery
      if (!delivery || delivery.status !== 'AGREED') return fail(409, 'INVALID_STATE', 'Arrange and agree the delivery first.')
      if (body.supplierBranchId) {
        const wb = await db.orgBranch.findFirst({ where: { id: body.supplierBranchId, orgId: order.supplierOrgId, status: 'ACTIVE' } })
        if (!wb) return fail(400, 'NO_BRANCH', 'Warehouse does not belong to your business.')
        await db.delivery.update({ where: { id: delivery.id }, data: { supplierBranchId: wb.id } })
      }
      const otp = sixDigitCode()
      const otpHash = await bcrypt.hash(otp, 10)
      const expectedAt = new Date(Date.now() + (body.expectedHours ?? 24) * 3600 * 1000)
      await db.delivery.update({
        where: { id: delivery.id },
        data: {
          status: 'DISPATCHED',
          courierName: body.courierName ?? delivery.courierName ?? 'Supplier-owned delivery',
          driverName: body.driverName ?? null,
          driverPhone: body.driverPhone ?? null,
          vehicleReg: body.vehicleReg ?? null,
          deliveryRef: body.deliveryRef ?? `DSP-${order.refCode}`,
          dispatchEvidence: body.evidence.length ? JSON.stringify(body.evidence) : delivery.dispatchEvidence,
          dispatchedAt: new Date(),
          expectedAt,
          otpHash,
          otpHint: otp.slice(-2),
          qrToken: shareId(14),
        },
      })
      await db.purchaseOrder.update({ where: { id }, data: { status: 'DISPATCHED' } })
      await deliveryEvent(delivery.id, { type: 'DISPATCHED', actorId: user.id, actorName: user.name, actorSide: 'SUPPLIER', note: `Dispatched${body.driverName ? ` — driver ${body.driverName}` : ''}. Expected ${expectedAt.toISOString()}` })
      await poEvent(id, { type: 'DISPATCH', actorId: user.id, actorName: user.name, actorSide: 'SUPPLIER', note: body.deliveryRef ? `Delivery reference ${body.deliveryRef}` : 'Order dispatched.' })
      // OTP delivered through in-app notification (SMS channel is recorded but not configured)
      await notifyGarageMembers(order.garageOrgId, id, order.refCode, `Order ${order.refCode} dispatched. Handover verification code: ${otp} (valid at delivery). Do not share before handover.`, 'PO_DISPATCHED')
      await audit({ actorId: user.id, actorName: user.name, action: 'PO_DISPATCHED', targetType: 'PURCHASE_ORDER', targetId: id })
      return ok({ message: 'Dispatch recorded. The garage received the handover verification code.' })
    }

    // ─────────── STEP 6: handover ───────────
    case 'handover': {
      const delivery = order.delivery
      if (!delivery || !['DISPATCHED', 'IN_TRANSIT'].includes(delivery.status)) {
        return fail(409, 'INVALID_STATE', 'Handover verification is available after dispatch.')
      }
      if (side !== 'GARAGE') return fail(403, 'PERMISSION_DENIED', 'The receiving party verifies the handover.')
      let verified = false
      if (body.otp && delivery.otpHash) verified = await bcrypt.compare(body.otp, delivery.otpHash)
      else if (body.qrToken && delivery.qrToken) verified = body.qrToken === delivery.qrToken
      if (!verified) return fail(403, 'BAD_CODE', 'That verification code does not match this delivery.')

      const handover = {
        ...(jsonParse<Record<string, unknown>>(delivery.handoverJson ?? '{}', {})),
        garageConfirmedAt: new Date().toISOString(),
        captureLocation: body.captureLocation,
        location: body.captureLocation && body.location ? body.location : undefined,
        photos: body.photos,
      }
      await db.delivery.update({
        where: { id: delivery.id },
        data: { garageConfirmAt: new Date(), handoverJson: JSON.stringify(handover) },
      })
      await finaliseHandoverIfBoth(id)
      await deliveryEvent(delivery.id, { type: 'DELIVERED', actorId: user.id, actorName: user.name, actorSide: 'GARAGE', note: `Handover verified by garage${body.captureLocation && body.location ? ' (location shared)' : ''}.` })
      return ok({ message: 'Handover verified. Record the inspection result to release payment.' })
    }

    case 'handover-confirm': {
      if (side !== 'SUPPLIER') return fail(403, 'PERMISSION_DENIED', 'Only the supplier confirms handover.')
      const delivery = order.delivery
      if (!delivery || !['DISPATCHED', 'IN_TRANSIT'].includes(delivery.status)) {
        return fail(409, 'INVALID_STATE', 'Handover is available after dispatch.')
      }
      await db.delivery.update({ where: { id: delivery.id }, data: { supplierConfirmAt: new Date() } })
      await finaliseHandoverIfBoth(id)
      await deliveryEvent(delivery.id, { type: 'DELIVERED', actorId: user.id, actorName: user.name, actorSide: 'SUPPLIER', note: 'Supplier confirmed handover.' })
      return ok({ message: 'Handover confirmation recorded.' })
    }

    // ─────────── STEP 7: inspection ───────────
    case 'inspect': {
      if (side !== 'GARAGE') return fail(403, 'PERMISSION_DENIED', 'Only the receiving garage inspects.')
      const delivery = order.delivery
      if (!delivery || delivery.status !== 'DELIVERED') return fail(409, 'INVALID_STATE', 'Inspection opens after verified handover.')
      const items = await db.pOItem.findMany({ where: { orderId: id } })
      const acceptedMap = new Map(body.items.map((i) => [i.itemId, i]))

      for (const item of items) {
        const reported = acceptedMap.get(item.id)
        const qtyAccepted = body.result === 'ACCEPT' ? item.qty : Math.min(reported?.qtyAccepted ?? 0, item.qty)
        await db.pOItem.update({
          where: { id: item.id },
          data: { qtyAccepted, qtyDelivered: body.result === 'ACCEPT' ? item.qty : qtyAccepted, note: reported?.note ?? (body.result === 'ACCEPT' ? null : 'Shortfall/damage reported at inspection') },
        })
        if (qtyAccepted > 0 && item.fulfilBranchId) {
          await fulfillStock(item.productId, item.fulfilBranchId, qtyAccepted, { type: 'PURCHASE_ORDER', id, actorName: user.name })
        } else if (qtyAccepted < item.qty && item.fulfilBranchId) {
          await releaseReservation(item.productId, item.fulfilBranchId, item.qty - qtyAccepted, { type: 'PURCHASE_ORDER', id, actorName: user.name })
        }
      }
      const freshItems = await db.pOItem.findMany({ where: { orderId: id } })
      const acceptedSubtotal = freshItems.reduce((s, i) => s + (i.qtyAccepted ?? 0) * i.unitPriceMinor, 0)
      const acceptedTotal = acceptedSubtotal + order.taxMinor + order.deliveryFeeMinor
      const inspectionStatus = body.result === 'ACCEPT' ? 'ACCEPTED' : body.result === 'PARTIAL' ? 'PARTIAL' : 'ISSUES'
      await db.purchaseOrder.update({
        where: { id },
        data: { status: 'INSPECTED', inspectionStatus, acceptedTotalMinor: acceptedTotal },
      })
      // refund due for unaccepted goods
      if (acceptedTotal < order.totalMinor) {
        const existing = await db.refund.findFirst({ where: { orderId: id, status: { in: ['REQUESTED', 'APPROVED'] } } })
        if (!existing) {
          await db.refund.create({
            data: {
              refCode: refCode('RFD', 6),
              orderId: id,
              paymentAuthId: order.payment?.id ?? null,
              amountMinor: order.totalMinor - acceptedTotal,
              kind: 'PARTIAL',
              reason: 'Partial acceptance at inspection',
              requestedById: user.id,
            },
          })
        }
      }
      await poEvent(id, { type: 'INSPECTED', actorId: user.id, actorName: user.name, actorSide: 'GARAGE', note: `${body.note ?? `Inspection result: ${inspectionStatus}.`} Accepted value: ${(acceptedTotal / 100).toLocaleString()} KES. Photos: ${body.photos.length}` })
      await notifySupplierMembers(order.supplierOrgId, order.refCode, `Garage inspected ${order.refCode}: ${inspectionStatus}. Accepted ${(acceptedTotal / 100).toLocaleString()} KES.`, 'PO_INSPECTED')
      return ok({ acceptedTotalMinor: acceptedTotal, inspectionStatus, message: 'Inspection recorded. Payment release can now be requested for the accepted amount.' })
    }

    // ─────────── STEP 8: payment release ───────────
    case 'release': {
      if (!['GARAGE'].includes(side) && !isStaff) return fail(403, 'PERMISSION_DENIED', 'The receiving garage requests the release.')
      if (order.status !== 'INSPECTED') return fail(409, 'INVALID_STATE', 'Release requires a recorded inspection.')
      const payment = order.payment
      if (!payment || payment.status !== 'PROTECTED') {
        return fail(409, 'NOT_PROTECTED', 'Funds are not in a protected state. Release follows the payment provider\'s protection confirmation only.')
      }
      const accepted = order.acceptedTotalMinor ?? order.totalMinor
      const fees = await getFees()
      const commission = computeCommission(order.subtotalMinor, fees.supplyCommissionPct, fees.minCommissionMinor)
      await db.paymentAuthorization.update({
        where: { id: payment.id },
        data: {
          status: accepted < order.totalMinor ? 'PARTIALLY_RELEASED' : 'RELEASED',
          releasedAmountMinor: accepted,
          releasedAt: new Date(),
        },
      })
      await db.purchaseOrder.update({
        where: { id },
        data: {
          paymentStatus: accepted < order.totalMinor ? 'PARTIALLY_RELEASED' : 'RELEASED',
          platformFeeMinor: commission,
          commissionRatePct: fees.supplyCommissionPct,
          status: 'COMPLETED',
        },
      })
      if (order.invoiceId) {
        await db.invoice.update({ where: { id: order.invoiceId }, data: { status: 'PAID', paidAt: new Date() } })
      }
      await poEvent(id, { type: 'RELEASED', actorId: user.id, actorName: user.name, actorSide: side, note: `Released ${(accepted / 100).toLocaleString()} KES to supplier. Platform commission: ${(commission / 100).toLocaleString()} KES recorded separately.` })
      await audit({
        actorId: user.id, actorName: user.name,
        action: 'PAYMENT_RELEASED', targetType: 'PURCHASE_ORDER', targetId: id,
        metadata: { released: accepted, commission, ref: order.refCode },
      })
      await notifySupplierMembers(order.supplierOrgId, order.refCode, `Payment released for ${order.refCode}: ${(accepted / 100).toLocaleString()} KES (commission ${(commission / 100).toLocaleString()} KES).`, 'PO_RELEASED')
      return ok({ releasedMinor: accepted, commissionMinor: commission, message: 'Payment released. Receipt generated in Billing.' })
    }

    // ─────────── STEP 9: dispute ───────────
    case 'dispute': {
      const existing = await db.dispute.findFirst({ where: { orderId: id, status: { in: ['OPEN', 'UNDER_REVIEW'] } } })
      if (existing) return fail(409, 'DISPUTE_EXISTS', 'An open dispute already exists for this order.')
      const disputed = order.paymentStatus === 'PROTECTED' || order.paymentStatus === 'PARTIALLY_RELEASED'
      const dispute = await db.dispute.create({
        data: {
          refCode: refCode('DSP', 6),
          orderId: id,
          openedById: user.id,
          openedBySide: side,
          reason: body.reason,
          details: body.details,
          evidence: body.evidence.length ? JSON.stringify(body.evidence) : null,
          amountFrozenMinor: disputed ? (order.acceptedTotalMinor !== null ? order.totalMinor - order.acceptedTotalMinor : order.totalMinor) : null,
          status: 'OPEN',
          events: { create: { type: 'CREATED', actorId: user.id, actorName: user.name, note: `Dispute opened: ${body.reason}` } },
        },
      })
      await db.purchaseOrder.update({ where: { id }, data: { status: 'DISPUTED' } })
      await poEvent(id, { type: 'NOTE', actorId: user.id, actorName: user.name, actorSide: side, note: `Dispute ${dispute.refCode} opened (${body.reason}). Amount frozen where supported.` })
      await audit({ actorId: user.id, actorName: user.name, action: 'DISPUTE_OPENED', targetType: 'DISPUTE', targetId: dispute.id, metadata: { order: order.refCode, reason: body.reason } })
      const { staffUserIds } = await import('@/lib/orgs')
      await notifyMany(await staffUserIds('ADMIN', 'FOUNDER', 'SUPPORT'), {
        type: 'DISPUTE_OPENED', title: `Dispute ${dispute.refCode} — ${order.refCode}`, body: `${body.reason}: ${body.details.slice(0, 120)}`, link: '/admin?tab=disputes',
      })
      return ok({ dispute, message: 'Dispute filed. Platform admins will investigate with all order, payment and delivery evidence.' }, { status: 201 })
    }

    case 'request-return': {
      if (side !== 'GARAGE') return fail(403, 'PERMISSION_DENIED', 'The garage requests returns.')
      const ret = await db.partReturn.create({
        data: {
          refCode: refCode('RTN', 6),
          orderId: id,
          reason: body.reason,
          itemsJson: JSON.stringify(body.items),
        },
      })
      await poEvent(id, { type: 'NOTE', actorId: user.id, actorName: user.name, actorSide: 'GARAGE', note: `Return requested ${ret.refCode}: ${body.reason}` })
      await notifySupplierMembers(order.supplierOrgId, order.refCode, `Return request ${ret.refCode} on ${order.refCode}: ${body.reason}`, 'PO_RETURN')
      return ok({ ret }, { status: 201 })
    }

    case 'warranty': {
      const product = order.items.find((i) => i.productId === body.productId)?.product
      if (!product) return fail(404, 'NOT_FOUND', 'Product is not part of this order.')
      if (product.warrantyMonths <= 0) return fail(409, 'NO_WARRANTY', 'This product was supplied without a warranty.')
      const claim = await db.warrantyClaim.create({
        data: {
          refCode: refCode('WRT', 6),
          orderId: id, productId: body.productId,
          garageOrgId: order.garageOrgId, supplierOrgId: order.supplierOrgId,
          issue: body.issue,
        },
      })
      await poEvent(id, { type: 'NOTE', actorId: user.id, actorName: user.name, actorSide: 'GARAGE', note: `Warranty claim ${claim.refCode}: ${body.issue.slice(0, 120)}` })
      await notifySupplierMembers(order.supplierOrgId, order.refCode, `Warranty claim ${claim.refCode} on ${order.refCode}.`, 'PO_WARRANTY')
      return ok({ claim }, { status: 201 })
    }
  }

  return fail(400, 'UNKNOWN_ACTION', 'Unsupported action.')
})

async function finaliseHandoverIfBoth(orderId: string): Promise<void> {
  const delivery = await db.delivery.findUnique({ where: { orderId } })
  if (!delivery) return
  if (delivery.garageConfirmAt && delivery.supplierConfirmAt && delivery.status !== 'DELIVERED') {
    await db.delivery.update({ where: { id: delivery.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } })
    await db.purchaseOrder.update({ where: { id: orderId }, data: { status: 'DELIVERED' } })
  } else if (delivery.status === 'DISPATCHED') {
    await db.delivery.update({ where: { id: delivery.id }, data: { status: 'IN_TRANSIT' } })
    await db.purchaseOrder.update({ where: { id: orderId }, data: { status: 'IN_TRANSIT' } })
  }
}

async function notifyGarageMembers(orgId: string, orderId: string, ref: string, body: string, type: string): Promise<void> {
  const members = await db.orgMember.findMany({ where: { orgId, role: { in: ['OWNER', 'GM', 'PROCUREMENT'] } }, select: { userId: true } })
  await notifyMany(members.map((m) => m.userId), { type, title: `Order ${ref}`, body, link: `/procurement?tab=orders&order=${orderId}` })
}

async function notifySupplierMembers(orgId: string, ref: string, body: string, type: string): Promise<void> {
  const members = await db.orgMember.findMany({ where: { orgId, role: { in: ['OWNER', 'OPERATIONS', 'WAREHOUSE'] } }, select: { userId: true } })
  await notifyMany(members.map((m) => m.userId), { type, title: `Order ${ref}`, body, link: '/supplier?tab=orders' })
}

async function notifyOtherSide(actor: { orgId: string; side: 'GARAGE' | 'SUPPLIER' }, order: { id: string; refCode: string; garageOrgId: string; supplierOrgId: string }, body: string, type: string): Promise<void> {
  if (actor.side === 'GARAGE') await notifySupplierMembers(order.supplierOrgId, order.refCode, body, type)
  else await notifyGarageMembers(order.garageOrgId, order.id, order.refCode, body, type)
}
