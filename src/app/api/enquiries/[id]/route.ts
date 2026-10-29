import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireUser } from '@/lib/api'
import { STAFF_ROLES } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { notify, notifyMany } from '@/lib/notify'

type Ctx = { params: Promise<{ id: string }> }

// ───────────────────────── helpers ─────────────────────────

function isStaffRole(roles: string[]): boolean {
  return STAFF_ROLES.some((r) => roles.includes(r))
}

async function loadEnquiry(id: string) {
  const enquiry = await db.enquiry.findUnique({
    where: { id },
    include: {
      vehicle: {
        select: {
          id: true, make: true, model: true, year: true, priceMinor: true, currency: true,
          refCode: true, ownerId: true, orgId: true, status: true,
        },
      },
      messages: { orderBy: { createdAt: 'asc' as const } },
    },
  })
  if (!enquiry) throw new ApiError(404, 'NOT_FOUND', 'Enquiry not found.')
  return enquiry
}

/** Who receives notifications for the seller side of this enquiry. */
async function sellerSideUserIds(enquiry: Awaited<ReturnType<typeof loadEnquiry>>, excludeUserId: string): Promise<string[]> {
  const { vehicle } = enquiry
  if (vehicle.orgId) {
    const members = await db.orgMember.findMany({
      where: { orgId: vehicle.orgId, role: { in: ['OWNER', 'MANAGER', 'SALES'] } },
      select: { userId: true },
    })
    return members.map((m) => m.userId).filter((id) => id !== excludeUserId)
  }
  return vehicle.ownerId !== excludeUserId ? [vehicle.ownerId] : []
}

/** Participant = customer who raised it, seller side (owner or org member) or staff. */
async function assertParticipant(
  enquiry: Awaited<ReturnType<typeof loadEnquiry>>,
  userId: string,
  roles: string[]
): Promise<'CUSTOMER' | 'SELLER'> {
  if (isStaffRole(roles)) return 'SELLER'
  if (enquiry.userId === userId) return 'CUSTOMER'
  if (enquiry.vehicle.ownerId === userId) return 'SELLER'
  if (enquiry.vehicle.orgId) {
    const membership = await db.orgMember.findFirst({
      where: { orgId: enquiry.vehicle.orgId, userId },
      select: { id: true },
    })
    if (membership) return 'SELLER'
  }
  throw new ApiError(403, 'FORBIDDEN', 'You are not part of this enquiry.')
}

// ───────────────────────── GET /api/enquiries/[id] ─────────────────────────
export const GET = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const enquiry = await loadEnquiry(id)
  await assertParticipant(enquiry, user.id, user.roles)
  return ok({ enquiry })
})

// ───────────────────────── POST /api/enquiries/[id] ─────────────────────────
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const enquiry = await loadEnquiry(id)
  const side = await assertParticipant(enquiry, user.id, user.roles)

  const { body } = await parseBody(req, z.object({ body: z.string().trim().min(1, 'Write a message first').max(2000) }))

  const message = await db.enquiryMessage.create({
    data: { enquiryId: enquiry.id, senderId: user.id, senderName: user.name, senderSide: side, body },
  })

  if (side === 'SELLER') {
    await db.enquiry.update({ where: { id: enquiry.id }, data: { status: 'ANSWERED' } })
    if (enquiry.userId !== user.id) {
      await notify({
        userId: enquiry.userId,
        type: 'ENQUIRY_REPLY',
        title: 'Seller replied to your enquiry',
        body: `${enquiry.vehicle.make} ${enquiry.vehicle.model} ${enquiry.vehicle.year} (${enquiry.refCode}).`,
        link: '/account',
      })
    }
  } else {
    const sellers = await sellerSideUserIds(enquiry, user.id)
    await notifyMany(sellers, {
      type: 'ENQUIRY_REPLY',
      title: 'Buyer replied to your enquiry',
      body: `${enquiry.vehicle.make} ${enquiry.vehicle.model} ${enquiry.vehicle.year} (${enquiry.refCode}) — from ${user.name}.`,
      link: enquiry.vehicle.orgId ? '/dealer' : '/my-listings',
    })
  }

  return ok({ message }, { status: 201 })
})

// ───────────────────────── PATCH /api/enquiries/[id] ─────────────────────────
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const enquiry = await loadEnquiry(id)
  await assertParticipant(enquiry, user.id, user.roles)

  const { status } = await parseBody(req, z.object({ status: z.literal('CLOSED') }))

  const updated = await db.enquiry.update({
    where: { id: enquiry.id },
    data: { status },
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'enquiry.closed',
    targetType: 'ENQUIRY',
    targetId: enquiry.id,
    metadata: { refCode: enquiry.refCode },
  })

  return ok({ enquiry: { id: updated.id, status: updated.status } })
})
