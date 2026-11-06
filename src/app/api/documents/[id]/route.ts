import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { demoStaffMutationGuard } from '@/lib/demo'
import { route, ok, fail, requireUser, ApiError, parseBody } from '@/lib/api'
import { hasRole, STAFF_ROLES } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { notify } from '@/lib/notify'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Document detail + reviewer state-machine actions.
 *
 * Staff actions (every decision records actor, time and reason):
 *   start_review   SUBMITTED → UNDER_REVIEW
 *   verify         any active → VERIFIED   (note optional, expiry optional)
 *   reject         any active → REJECTED   (reason REQUIRED)
 *   request_info   any active → MORE_INFO_REQUIRED (what is missing REQUIRED)
 *   expire         VERIFIED  → EXPIRED     (reason REQUIRED)
 *
 * The owner can view their own document and its access history. The owner
 * cannot change review state — replacements go through POST /api/documents.
 */

const DOC_LINKS: Record<string, string> = {
  DEALER: '/dealer', GARAGE: '/garage-dashboard', SELLER: '/sell', LOGISTICS: '/logistics',
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start_review'), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('verify'), note: z.string().max(1000).optional(), expiresAt: z.string().datetime().optional() }),
  z.object({ action: z.literal('reject'), note: z.string().min(10).max(1000) }),
  z.object({ action: z.literal('request_info'), note: z.string().min(10).max(1000), dueDays: z.number().int().min(1).max(60).optional() }),
  z.object({ action: z.literal('expire'), note: z.string().min(5).max(1000) }),
])

async function loadDocument(id: string) {
  const doc = await db.verificationDocument.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, email: true, phone: true } },
      application: { select: { id: true, refCode: true, type: true, orgName: true, status: true } },
      org: { select: { id: true, name: true, type: true } },
    },
  })
  if (!doc) throw new ApiError(404, 'NOT_FOUND', 'Document not found.')
  return doc
}

export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params
  const doc = await loadDocument(id)

  const isOwner = doc.ownerUserId === user.id
  const isStaff = hasRole(user, ...STAFF_ROLES)
  if (!isOwner && !isStaff) throw new ApiError(403, 'FORBIDDEN', 'You are not authorised to view this document.')

  // Viewing by anyone other than the owner is an auditable access event.
  if (!isOwner) {
    await db.documentAccessLog.create({
      data: { documentId: doc.id, viewerId: user.id, viewerName: user.name, action: 'VIEWED' },
    })
  }

  const accessLogs = isStaff
    ? await db.documentAccessLog.findMany({
        where: { documentId: doc.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    : []

  return ok({ document: doc, accessLogs })
})

export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  if (!hasRole(user, ...STAFF_ROLES)) throw new ApiError(403, 'FORBIDDEN', 'Only platform reviewers can make document decisions.')
  const { id } = await ctx.params
  const doc = await loadDocument(id)
  const body = await parseBody(req, actionSchema)
  // DEMO SANDBOX: demo reviewers may only decide on demo-ecosystem documents.
  await demoStaffMutationGuard(user, { subjectUserId: doc.ownerUserId })

  const ACTIVE = ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED']

  if (doc.status === 'SUPERSEDED') {
    return fail(409, 'SUPERSEDED', 'This document was replaced and is no longer under review.')
  }

  let updated
  switch (body.action) {
    case 'start_review': {
      if (doc.status !== 'SUBMITTED') {
        return fail(409, 'INVALID_TRANSITION', `Cannot start review from ${doc.status}.`)
      }
      updated = await db.verificationDocument.update({
        where: { id },
        data: { status: 'UNDER_REVIEW', reviewNote: body.note ?? doc.reviewNote },
      })
      break
    }
    case 'verify': {
      if (!ACTIVE.includes(doc.status) && doc.status !== 'EXPIRED') {
        return fail(409, 'INVALID_TRANSITION', `Cannot verify a ${doc.status} document.`)
      }
      updated = await db.verificationDocument.update({
        where: { id },
        data: {
          status: 'VERIFIED',
          reviewNote: body.note ?? null,
          reviewedById: user.id,
          reviewedByName: user.name,
          reviewedAt: new Date(),
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : doc.expiresAt,
        },
      })
      break
    }
    case 'reject': {
      if (!ACTIVE.includes(doc.status)) {
        return fail(409, 'INVALID_TRANSITION', `Cannot reject a ${doc.status} document.`)
      }
      updated = await db.verificationDocument.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewNote: body.note,
          reviewedById: user.id,
          reviewedByName: user.name,
          reviewedAt: new Date(),
        },
      })
      break
    }
    case 'request_info': {
      if (!ACTIVE.includes(doc.status)) {
        return fail(409, 'INVALID_TRANSITION', `Cannot request info on a ${doc.status} document.`)
      }
      const due = body.dueDays ? new Date(Date.now() + body.dueDays * 24 * 3600 * 1000) : null
      updated = await db.verificationDocument.update({
        where: { id },
        data: {
          status: 'MORE_INFO_REQUIRED',
          reviewNote: body.note,
          reviewedById: user.id,
          reviewedByName: user.name,
          infoRequestedAt: new Date(),
          correctionsDueAt: due,
        },
      })
      break
    }
    case 'expire': {
      if (doc.status !== 'VERIFIED') {
        return fail(409, 'INVALID_TRANSITION', 'Only verified documents can be expired.')
      }
      updated = await db.verificationDocument.update({
        where: { id },
        data: { status: 'EXPIRED', reviewNote: body.note, reviewedById: user.id, reviewedByName: user.name, reviewedAt: new Date() },
      })
      break
    }
  }

  await db.documentAccessLog.create({
    data: { documentId: id, viewerId: user.id, viewerName: user.name, action: 'STATUS_CHANGE' },
  })

  // Notify the owner of any decision that changes their obligations.
  if (['reject', 'request_info', 'verify', 'expire'].includes(body.action)) {
    const d = await loadDocument(id)
    const link = d.application ? DOC_LINKS[d.application.type] ?? '/account' : '/account'
    const titles: Record<string, string> = {
      verify: `Document verified — ${d.refCode}`,
      reject: `Document rejected — ${d.refCode}`,
      request_info: `More information needed — ${d.refCode}`,
      expire: `Document expired — ${d.refCode}`,
    }
    await notify({
      userId: d.ownerUserId,
      type: `DOCUMENT_${body.action.toUpperCase()}`,
      title: titles[body.action],
      body: updated.reviewNote || `Status: ${updated.status}.`,
      link,
    })
  }

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: `DOCUMENT_${body.action.toUpperCase()}`,
    targetType: 'DOCUMENT',
    targetId: id,
    metadata: { refCode: doc.refCode, note: 'note' in body ? body.note : undefined },
  })

  return ok({ document: updated })
})
