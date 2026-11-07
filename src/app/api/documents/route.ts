import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, requireUser, ApiError, parseBody } from '@/lib/api'
import { hasRole, STAFF_ROLES } from '@/lib/auth'
import { assertNotDemoStaffRead } from '@/lib/demo'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Document Verification Engine: collection endpoint.
 *
 * State machine (documented in prisma/schema.prisma):
 *   SUBMITTED → UNDER_REVIEW → VERIFIED
 *                            → REJECTED
 *                            → MORE_INFO_REQUIRED → (owner re-submits replacement)
 *   VERIFIED → EXPIRED (validity lapses) | SUPERSEDED (replaced by a newer doc)
 *
 * Uploading a document NEVER marks it verified. Only a staff reviewer can
 * move a document through the machine, and every decision records the actor,
 * time and reason (reviewNote + DocumentAccessLog/audit trail).
 */

export const DOC_KINDS = [
  'ID_FRONT', 'ID_BACK', 'PASSPORT', 'PIN_CERTIFICATE', 'BUSINESS_LICENSE',
  'DIRECTOR_ID', 'LOGBOOK', 'OWNERSHIP_AUTH', 'DRIVER_LICENSE', 'INSURANCE',
  'VEHICLE_REG', 'REGISTRATION_CERT', 'SUPPORTING', 'OTHER',
] as const

const ACTIVE_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED']
const TERMINAL_STATUSES = ['VERIFIED', 'REJECTED', 'EXPIRED', 'SUPERSEDED']

const submitSchema = z.object({
  kind: z.enum(DOC_KINDS),
  fileUrl: z.string().min(5).max(300).startsWith('/api/files/'),
  fileName: z.string().min(1).max(200),
  label: z.string().max(120).optional(),
  applicationId: z.string().max(40).optional(),
  orgId: z.string().max(40).optional(),
  replacesId: z.string().max(40).optional(),
  expiresAt: z.string().datetime().optional(),
})

/** GET /api/documents: owner's own documents, or the staff review queue. */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope') ?? 'mine'
  const status = url.searchParams.get('status')
  const kind = url.searchParams.get('kind')
  const applicationId = url.searchParams.get('applicationId')
  const q = url.searchParams.get('q')?.trim()

  // Lazy expiry: a VERIFIED document whose validity has lapsed is surfaced as
  // EXPIRED (and persisted): we never present an expired document as verified.
  if (user && scope === 'queue') {
    if (!hasRole(user, ...STAFF_ROLES)) throw new ApiError(403, 'FORBIDDEN', 'Staff only.')
    // Identity documents are closed to demo sessions (see assertNotDemoStaffRead).
    assertNotDemoStaffRead(user, 'the verification document queue')
    await db.verificationDocument.updateMany({
      where: { status: 'VERIFIED', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED', reviewNote: 'Validity lapsed: document expired automatically.' },
    })
  }

  const where: Record<string, unknown> = {}
  if (scope === 'queue') {
    if (!hasRole(user, ...STAFF_ROLES)) throw new ApiError(403, 'FORBIDDEN', 'Staff only.')
    assertNotDemoStaffRead(user, 'the verification document queue')
  } else {
    where.ownerUserId = user.id
  }
  if (status && [...ACTIVE_STATUSES, ...TERMINAL_STATUSES].includes(status)) where.status = status
  if (kind && (DOC_KINDS as readonly string[]).includes(kind)) where.kind = kind
  if (applicationId) where.applicationId = applicationId
  if (q) {
    where.OR = [
      { refCode: { contains: q } },
      { fileName: { contains: q } },
      { label: { contains: q } },
      { owner: { is: { name: { contains: q } } } },
      { owner: { is: { email: { contains: q } } } },
    ]
  }

  const docs = await db.verificationDocument.findMany({
    where,
    include: {
      owner: { select: { id: true, name: true, email: true, phone: true } },
      application: { select: { id: true, refCode: true, type: true, orgName: true, status: true } },
      org: { select: { id: true, name: true, type: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const counts = {
    total: scope === 'queue'
      ? await db.verificationDocument.count()
      : await db.verificationDocument.count({ where: { ownerUserId: user.id } }),
    pending: await db.verificationDocument.count({ where: { ...where, status: { in: ACTIVE_STATUSES } } }),
  }

  return ok({ documents: docs, counts, activeStatuses: ACTIVE_STATUSES })
})

/** POST /api/documents: submit a document into the verification pipeline. */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, submitSchema)

  // The private files endpoint is the ONLY permitted storage location; a
  // public /api/media URL would leak the document to everyone.
  if (!body.fileUrl.startsWith('/api/files/')) {
    return fail(400, 'INVALID_LOCATION', 'Verification documents must be stored as private files (upload with kind=document).')
  }

  let application: { orgId: string | null; userId: string } | null = null
  if (body.applicationId) {
    const found = await db.application.findUnique({ where: { id: body.applicationId } })
    if (!found) throw new ApiError(404, 'NOT_FOUND', 'Application not found.')
    if (found.userId !== user.id && !hasRole(user, ...STAFF_ROLES)) {
      throw new ApiError(403, 'FORBIDDEN', 'You can only attach documents to your own application.')
    }
    application = { orgId: found.orgId, userId: found.userId }
  }

  if (body.orgId) {
    const membership = await db.orgMember.findFirst({ where: { orgId: body.orgId, userId: user.id } })
    if (!membership && !hasRole(user, ...STAFF_ROLES)) {
      throw new ApiError(403, 'FORBIDDEN', 'You are not a member of that organisation.')
    }
  }

  // Replacement: the doc being replaced must belong to the same owner and
  // must not already be VERIFIED (a verified doc can only be superseded by a
  // reviewer-initiated re-verification, not silently swapped by the owner).
  if (body.replacesId) {
    const previous = await db.verificationDocument.findUnique({ where: { id: body.replacesId } })
    if (!previous) throw new ApiError(404, 'NOT_FOUND', 'Document to replace not found.')
    if (previous.ownerUserId !== user.id) throw new ApiError(403, 'FORBIDDEN', 'You can only replace your own documents.')
    if (previous.status === 'VERIFIED') {
      return fail(409, 'VERIFIED_DOC', 'This document is already verified. Contact support if your details changed.')
    }
  }

  const doc = await db.$transaction(async (tx) => {
    if (body.replacesId) {
      await tx.verificationDocument.update({
        where: { id: body.replacesId },
        data: { status: 'SUPERSEDED', reviewNote: 'Replaced by a newly submitted document.' },
      })
    }
    return tx.verificationDocument.create({
      data: {
        refCode: refCode('DOC', 6),
        ownerUserId: user.id,
        orgId: body.orgId ?? application?.orgId ?? null,
        applicationId: body.applicationId ?? null,
        kind: body.kind,
        label: body.label ?? null,
        fileUrl: body.fileUrl,
        fileName: body.fileName,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        status: 'SUBMITTED',
      },
    })
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'DOCUMENT_SUBMITTED',
    targetType: 'DOCUMENT',
    targetId: doc.id,
    metadata: { refCode: doc.refCode, kind: doc.kind, applicationId: body.applicationId ?? null },
  })

  return ok({ document: doc }, { status: 201 })
})
