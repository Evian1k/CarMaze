import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody, type RouteCtx } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { notifyMany, notify } from '@/lib/notify'
import { INBOX_NOTIFY_ROLES, getMembership, orgInboxLink } from '@/lib/orgs'
import { parseJson } from '@/lib/json'

export const dynamic = 'force-dynamic'

type Ctx = RouteCtx

async function loadConversation(id: string) {
  const conversation = await db.conversation.findUnique({
    where: { id },
    include: {
      org: { select: { id: true, name: true, type: true, phone: true, whatsappEnabled: true, callEnabled: true } },
      customer: { select: { id: true, name: true } },
      vehicle: {
        select: {
          id: true,
          make: true,
          model: true,
          year: true,
          priceMinor: true,
          currency: true,
          photos: { orderBy: { order: 'asc' }, take: 1, select: { url: true } },
        },
      },
    },
  })
  if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation not found.')
  return conversation
}

async function participantSide(conversation: { orgId: string; customerId: string }, userId: string): Promise<'CUSTOMER' | 'ORG'> {
  if (conversation.customerId === userId) return 'CUSTOMER'
  const membership = await getMembership(conversation.orgId, userId)
  if (membership) return 'ORG'
  throw new ApiError(403, 'FORBIDDEN', 'You are not part of this conversation.')
}

/** GET: full thread for participants; clears the requester's unread flag. */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params
  const conversation = await loadConversation(id)
  const side = await participantSide(conversation, user.id)

  if (side === 'CUSTOMER' && conversation.unreadForCustomer) {
    await db.conversation.update({ where: { id }, data: { unreadForCustomer: false } })
  }
  if (side === 'ORG' && conversation.unreadForOrg) {
    await db.conversation.update({ where: { id }, data: { unreadForOrg: false } })
  }

  // Long threads are capped: the newest 500 messages, re-ordered chronologically.
  const messageRows = await db.conversationMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  const messages = [...messageRows].reverse()

  // serviceId is a plain reference (no Prisma relation): resolve the title manually.
  const service = conversation.serviceId
    ? await db.garageService.findUnique({ where: { id: conversation.serviceId }, select: { title: true } })
    : null

  return ok({
    conversation: {
      id: conversation.id,
      orgId: conversation.orgId,
      orgName: conversation.org.name,
      orgType: conversation.org.type,
      orgPhone: conversation.org.phone,
      whatsappEnabled: conversation.org.whatsappEnabled,
      callEnabled: conversation.org.callEnabled,
      customerId: conversation.customerId,
      customerName: conversation.customer.name,
      subject: conversation.subject,
      kind: conversation.kind,
      status: conversation.status,
      vehicle: conversation.vehicle
        ? {
            id: conversation.vehicle.id,
            make: conversation.vehicle.make,
            model: conversation.vehicle.model,
            year: conversation.vehicle.year,
            priceMinor: conversation.vehicle.priceMinor,
            currency: conversation.vehicle.currency,
            photo: conversation.vehicle.photos[0]?.url ?? null,
          }
        : null,
      serviceTitle: service?.title ?? null,
    },
    messages: messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      senderName: m.senderName,
      senderSide: m.senderSide,
      body: m.body,
      attachments: parseJson<string[]>(m.attachments, []),
      refType: m.refType,
      refId: m.refId,
      createdAt: m.createdAt.toISOString(),
    })),
  })
})

const messageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  attachments: z
    .array(z.string().trim().max(500).refine((v) => v.startsWith('/api/media/'), { message: 'Attachments must be /api/media/ URLs' }))
    .max(5)
    .optional(),
})

function previewOf(body: string): string {
  return body.length > 140 ? `${body.slice(0, 137)}…` : body
}

/** POST: send a message as CUSTOMER or ORG side. */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const rl = rateLimit(`conversation-msg:${user.id}`, 30, 5 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'You are sending messages too quickly. Try again shortly.')

  const { id } = await ctx.params
  const conversation = await loadConversation(id)
  const side = await participantSide(conversation, user.id)
  const body = await parseBody(req, messageSchema)
  const now = new Date()

  const message = await db.conversationMessage.create({
    data: {
      conversationId: id,
      senderId: user.id,
      senderName: user.name,
      senderSide: side,
      body: body.body,
      ...(body.attachments ? { attachments: JSON.stringify(body.attachments) } : {}),
    },
  })

  await db.conversation.update({
    where: { id },
    data: {
      lastMessageAt: now,
      lastMessagePreview: previewOf(body.body),
      ...(side === 'CUSTOMER' ? { unreadForOrg: true } : { unreadForCustomer: true }),
    },
  })

  if (side === 'CUSTOMER') {
    await notifyMany(
      (
        await db.orgMember.findMany({
          where: { orgId: conversation.orgId, role: { in: [...INBOX_NOTIFY_ROLES] } },
          select: { userId: true },
        })
      ).map((m) => m.userId),
      {
        type: 'CONVERSATION_MESSAGE',
        title: `New message from ${user.name}`,
        body: previewOf(body.body),
        link: orgInboxLink(conversation.org.type),
      }
    )
  } else {
    await notify({
      userId: conversation.customerId,
      type: 'CONVERSATION_MESSAGE',
      title: `New message from ${conversation.org.name}`,
      body: previewOf(body.body),
      link: '/account?tab=messages',
    })
  }

  return ok({
    message: {
      id: message.id,
      senderId: message.senderId,
      senderName: message.senderName,
      senderSide: message.senderSide,
      body: message.body,
      attachments: parseJson<string[]>(message.attachments, []),
      refType: message.refType,
      refId: message.refId,
      createdAt: message.createdAt.toISOString(),
    },
  })
})

const patchSchema = z.object({
  action: z.enum(['close', 'reopen', 'archive', 'unarchive']),
})

/** PATCH: close/reopen (either side), archive/unarchive (per side). */
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params
  const conversation = await loadConversation(id)
  const side = await participantSide(conversation, user.id)
  const body = await parseBody(req, patchSchema)

  const data: { status?: string; customerArchived?: boolean; orgArchived?: boolean } = {}
  if (body.action === 'close') data.status = 'CLOSED'
  if (body.action === 'reopen') data.status = 'OPEN'
  if (body.action === 'archive') {
    if (side === 'CUSTOMER') data.customerArchived = true
    else data.orgArchived = true
  }
  if (body.action === 'unarchive') {
    if (side === 'CUSTOMER') data.customerArchived = false
    else data.orgArchived = false
  }

  const updated = await db.conversation.update({ where: { id }, data })

  return ok({
    conversation: {
      id: updated.id,
      status: updated.status,
      customerArchived: updated.customerArchived,
      orgArchived: updated.orgArchived,
    },
  })
})
