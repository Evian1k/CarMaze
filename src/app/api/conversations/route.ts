import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { notifyMany } from '@/lib/notify'
import { INBOX_NOTIFY_ROLES, orgInboxLink } from '@/lib/orgs'
import { assertDemoResourceGuard } from '@/lib/demo'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  orgId: z.string().min(1),
  subject: z.string().trim().max(200).optional(),
  vehicleId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  kind: z.enum(['GENERAL', 'QUOTE', 'BOOKING', 'VEHICLE_ENQUIRY', 'SUPPORT']).optional(),
  message: z.string().trim().min(2).max(4000),
})

function previewOf(body: string): string {
  return body.length > 140 ? `${body.slice(0, 137)}…` : body
}

/**
 * POST — start a conversation with an org (customer side only).
 * Reuses the customer's existing OPEN conversation for the same
 * org + vehicle combination instead of creating a new thread.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`conversation-create:${user.id}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'You are sending too many messages. Try again later.')

  const body = await parseBody(req, createSchema)

  const org = await db.org.findUnique({ where: { id: body.orgId } })
  if (!org) throw new ApiError(404, 'NOT_FOUND', 'Business not found.')
  if (org.status !== 'ACTIVE') {
    throw new ApiError(400, 'ORG_INACTIVE', 'This business is not currently accepting messages.')
  }

  // DEMO SANDBOX: demo users may only open conversations with demo businesses.
  await assertDemoResourceGuard(user, { orgId: org.id })

  // A vehicle/service attached to the thread must actually belong to this org —
  // otherwise a foreign listing could be spoofed as context in the inbox.
  if (body.vehicleId) {
    const vehicle = await db.vehicle.findUnique({ where: { id: body.vehicleId }, select: { id: true, orgId: true, ownerId: true } })
    if (!vehicle) throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found.')
    if (vehicle.orgId !== org.id) {
      throw new ApiError(400, 'VEHICLE_MISMATCH', 'That vehicle does not belong to this business.')
    }
  }
  if (body.serviceId) {
    const service = await db.garageService.findUnique({ where: { id: body.serviceId }, select: { id: true, orgId: true } })
    if (!service) throw new ApiError(404, 'NOT_FOUND', 'Service not found.')
    if (service.orgId !== org.id) {
      throw new ApiError(400, 'SERVICE_MISMATCH', 'That service does not belong to this business.')
    }
  }

  const kind = body.kind ?? 'GENERAL'
  const now = new Date()

  // Reuse an existing OPEN thread for the same org + vehicle (null-safe).
  const conversation = await db.conversation.findFirst({
    where: {
      orgId: org.id,
      customerId: user.id,
      vehicleId: body.vehicleId ?? null,
      status: 'OPEN',
    },
    orderBy: { lastMessageAt: 'desc' },
  })

  if (conversation) {
    const [message] = await db.$transaction([
      db.conversationMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: user.id,
          senderName: user.name,
          senderSide: 'CUSTOMER',
          body: body.message,
        },
      }),
      db.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: now,
          lastMessagePreview: previewOf(body.message),
          unreadForOrg: true,
          ...(conversation.subject === null && body.subject ? { subject: body.subject } : {}),
        },
      }),
    ])

    await notifyMany(
      (
        await db.orgMember.findMany({
          where: { orgId: org.id, role: { in: [...INBOX_NOTIFY_ROLES] } },
          select: { userId: true },
        })
      ).map((m) => m.userId),
      {
        type: 'CONVERSATION_MESSAGE',
        title: `New message from ${user.name}`,
        body: previewOf(body.message),
        link: orgInboxLink(org.type),
      }
    )

    return ok({ conversation: { ...shape(conversation), lastMessageAt: now.toISOString(), lastMessagePreview: previewOf(body.message), unreadForOrg: true }, message })
  }

  const created = await db.conversation.create({
    data: {
      orgId: org.id,
      customerId: user.id,
      subject: body.subject ?? null,
      vehicleId: body.vehicleId ?? null,
      serviceId: body.serviceId ?? null,
      kind,
      lastMessageAt: now,
      lastMessagePreview: previewOf(body.message),
      unreadForOrg: true,
      messages: {
        create: {
          senderId: user.id,
          senderName: user.name,
          senderSide: 'CUSTOMER',
          body: body.message,
        },
      },
    },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 1 } },
  })

  await notifyMany(
    (
      await db.orgMember.findMany({
        where: { orgId: org.id, role: { in: [...INBOX_NOTIFY_ROLES] } },
        select: { userId: true },
      })
    ).map((m) => m.userId),
    {
      type: 'CONVERSATION_MESSAGE',
      title: `New message from ${user.name}`,
      body: previewOf(body.message),
      link: orgInboxLink(org.type),
    }
  )

  return ok({ conversation: shape(created), message: created.messages[0] })
})

type ConversationRow = {
  id: string
  orgId: string
  customerId: string
  subject: string | null
  vehicleId: string | null
  serviceId: string | null
  kind: string
  status: string
  lastMessageAt: Date
  lastMessagePreview: string | null
  unreadForOrg: boolean
  unreadForCustomer: boolean
  customerArchived: boolean
  orgArchived: boolean
  createdAt: Date
}

function shape(c: ConversationRow) {
  return {
    id: c.id,
    orgId: c.orgId,
    customerId: c.customerId,
    subject: c.subject,
    vehicleId: c.vehicleId,
    serviceId: c.serviceId,
    kind: c.kind,
    status: c.status,
    lastMessageAt: c.lastMessageAt.toISOString(),
    lastMessagePreview: c.lastMessagePreview,
    unreadForOrg: c.unreadForOrg,
    unreadForCustomer: c.unreadForCustomer,
    createdAt: c.createdAt.toISOString(),
  }
}

/** GET ?scope=mine | ?scope=org (&includeArchived=1) */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope')
  const includeArchived = url.searchParams.get('includeArchived') === '1'

  if (scope === 'mine') {
    const conversations = await db.conversation.findMany({
      where: { customerId: user.id, ...(includeArchived ? {} : { customerArchived: false }) },
      orderBy: { lastMessageAt: 'desc' },
      include: { org: { select: { name: true, type: true } } },
    })
    return ok({
      conversations: conversations.map((c) => ({
        ...shape(c),
        orgName: c.org.name,
        orgType: c.org.type,
      })),
    })
  }

  if (scope === 'org') {
    const memberships = await db.orgMember.findMany({
      where: { userId: user.id },
      select: { orgId: true },
    })
    const orgIds = memberships.map((m) => m.orgId)
    const conversations = await db.conversation.findMany({
      where: { orgId: { in: orgIds }, ...(includeArchived ? {} : { orgArchived: false }) },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        org: { select: { name: true, type: true } },
        customer: { select: { name: true } },
      },
    })
    return ok({
      conversations: conversations.map((c) => ({
        ...shape(c),
        orgName: c.org.name,
        orgType: c.org.type,
        customerName: c.customer.name,
      })),
    })
  }

  return fail(400, 'VALIDATION_ERROR', 'Provide ?scope=mine or ?scope=org.')
})
