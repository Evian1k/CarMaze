import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireUser, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notify, notifyMany } from '@/lib/notify'

// ───────────────────────── helpers ─────────────────────────

const vehicleSelect = {
  id: true,
  make: true,
  model: true,
  year: true,
  priceMinor: true,
  currency: true,
  refCode: true,
  ownerId: true,
  orgId: true,
  status: true,
} as const

function includeForList() {
  return {
    vehicle: { select: vehicleSelect },
    messages: { orderBy: { createdAt: 'asc' as const } },
  } as const
}

/** Org members allowed to see & answer enquiries for a dealer listing. */
function sellerSideFilter(): { roles: string[] } {
  return { roles: ['OWNER', 'MANAGER', 'SALES'] }
}

async function orgIdsOf(userId: string): Promise<string[]> {
  const memberships = await db.orgMember.findMany({ where: { userId }, select: { orgId: true } })
  return memberships.map((m) => m.orgId)
}

// ───────────────────────── GET /api/enquiries ─────────────────────────
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const params = new URL(req.url).searchParams

  let where: Record<string, unknown>
  if (params.get('forOrg') === '1') {
    // Dealer org member: enquiries on their org's vehicles.
    const myOrgIds = await orgIdsOf(user.id)
    if (myOrgIds.length === 0) return ok({ enquiries: [] })
    where = { vehicle: { orgId: { in: myOrgIds } } }
  } else if (params.get('selling') === '1') {
    // Seller side: enquiries on vehicles I own privately or via my orgs.
    const myOrgIds = await orgIdsOf(user.id)
    where = { vehicle: { OR: [{ ownerId: user.id }, { orgId: { in: myOrgIds } }] } }
  } else {
    // Default / mine=1: the customer's own enquiries.
    where = { userId: user.id }
  }

  const enquiries = await db.enquiry.findMany({
    where,
    include: includeForList(),
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return ok({ enquiries })
})

// ───────────────────────── POST /api/enquiries ─────────────────────────
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`enquiry:${user.id}:${getIp(req)}`, 20, 60 * 60 * 1000)
  if (!rl.allowed) {
    return fail(429, 'RATE_LIMITED', `Too many enquiries sent. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)
  }

  const body = await parseBody(
    req,
    z.object({
      vehicleId: z.string().min(1),
      message: z.string().trim().min(5, 'Message is too short').max(2000),
      phoneShare: z.boolean().optional().default(true),
      phone: z.string().trim().max(20).optional(),
    })
  )

  const vehicle = await db.vehicle.findUnique({ where: { id: body.vehicleId }, select: vehicleSelect })
  if (!vehicle || vehicle.status !== 'PUBLISHED') {
    throw new ApiError(404, 'NOT_FOUND', 'This listing is not available for enquiries.')
  }

  // Not on your own listing (private or dealer-side).
  if (vehicle.ownerId === user.id) {
    return fail(400, 'OWN_LISTING', 'You can\u2019t enquire on your own listing.')
  }
  if (vehicle.orgId) {
    const membership = await db.orgMember.findFirst({ where: { orgId: vehicle.orgId, userId: user.id }, select: { id: true } })
    if (membership) return fail(400, 'OWN_LISTING', 'You can\u2019t enquire on your own dealership\u2019s listing.')
  }

  const phone = body.phoneShare ? body.phone?.trim() || user.phone || null : null

  const enquiry = await db.enquiry.create({
    data: {
      refCode: refCode('ENQ', 6),
      vehicleId: vehicle.id,
      userId: user.id,
      message: body.message,
      phoneShare: body.phoneShare,
      phone,
      status: 'OPEN',
      messages: {
        create: { senderId: user.id, senderName: user.name, senderSide: 'CUSTOMER', body: body.message },
      },
    },
    include: { messages: true, vehicle: { select: vehicleSelect } },
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'enquiry.created',
    targetType: 'VEHICLE',
    targetId: vehicle.id,
    metadata: { enquiryId: enquiry.id, refCode: enquiry.refCode, phoneShare: body.phoneShare },
  })

  // Notify the seller side — dealer members or the private owner.
  if (vehicle.orgId) {
    const members = await db.orgMember.findMany({
      where: { orgId: vehicle.orgId, ...sellerSideFilter() },
      select: { userId: true },
    })
    await notifyMany(
      members.map((m) => m.userId),
      {
        type: 'ENQUIRY',
        title: 'New buyer enquiry',
        body: `${vehicle.make} ${vehicle.model} ${vehicle.year} (${vehicle.refCode}) — from ${user.name}.`,
        link: '/dealer',
      }
    )
  } else {
    await notify({
      userId: vehicle.ownerId,
      type: 'ENQUIRY',
      title: 'New buyer enquiry',
      body: `${vehicle.make} ${vehicle.model} ${vehicle.year} (${vehicle.refCode}) — from ${user.name}.`,
      link: '/my-listings',
    })
  }

  return ok({ enquiry: { id: enquiry.id, refCode: enquiry.refCode, status: enquiry.status } }, { status: 201 })
})
