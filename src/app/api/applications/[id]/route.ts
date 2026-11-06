import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, ApiError } from '@/lib/api'
import { hasRole, STAFF_ROLES } from '@/lib/auth'
import { refCode } from '@/lib/ids'
import { notify, notifyMany } from '@/lib/notify'
import { audit } from '@/lib/audit'

type Ctx = { params: Promise<{ id: string }> }

async function loadApp(id: string) {
  // NOTE (agent 6-f repair): the schema has no `org` relation on Application
  // (only the orgId string) — including `org: true` here made every detail
  // fetch fail with a Prisma validation error. The org, when present, is
  // attached below via a plain lookup.
  const app = await db.application.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: 'asc' } } } })
  if (!app) throw new ApiError(404, 'NOT_FOUND', 'Application not found.')
  const org = app.orgId ? await db.org.findUnique({ where: { id: app.orgId } }) : null
  return { ...app, org }
}

export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params
  const app = await loadApp(id)
  if (app.userId !== user.id && !hasRole(user, ...STAFF_ROLES)) {
    throw new ApiError(403, 'FORBIDDEN', 'You cannot view this application.')
  }
  return ok({ application: app })
})

const patchSchema = z.object({
  action: z.enum(['resubmit', 'assign', 'start_review', 'request_info', 'approve', 'reject', 'suspend', 'revoke', 'note']),
  // resubmit
  documents: z.array(z.object({ name: z.string().max(200), url: z.string().max(300) })).max(10).optional(),
  notes: z.string().trim().max(2000).optional(),
  // staff
  reviewOwnerId: z.string().optional(),
  reviewOwnerName: z.string().optional(),
  infoMessage: z.string().trim().max(2000).optional(),
  correctionDays: z.number().int().min(1).max(60).default(7),
  decisionNote: z.string().trim().max(2000).optional(),
})

const REVIEWABLE = ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'RESUBMITTED']

export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params
  const app = await loadApp(id)
  const body = await parseBody(req, patchSchema)
  const isOwner = app.userId === user.id
  const isReviewer = hasRole(user, ...STAFF_ROLES)

  // ── Owner: resubmit after an information request ──
  if (body.action === 'resubmit') {
    if (!isOwner) throw new ApiError(403, 'FORBIDDEN', 'Only the applicant can resubmit.')
    if (app.status !== 'MORE_INFO_REQUIRED') {
      throw new ApiError(409, 'INVALID_STATE', 'This application is not awaiting corrections.')
    }
    const updated = await db.application.update({
      where: { id },
      data: {
        status: 'RESUBMITTED',
        documents: body.documents ? JSON.stringify(body.documents) : app.documents,
        notes: body.notes ?? app.notes,
        events: { create: { type: 'RESUBMITTED', actorId: user.id, actorName: user.name, note: body.notes || 'Applicant resubmitted the requested information.' } },
      },
    })
    await notifyMany(await reviewerIdsFor(app.type), {
      type: 'APPLICATION_RESUBMITTED',
      title: `${app.orgName} resubmitted ${app.refCode}`,
      body: 'The applicant provided the requested information. Review to continue.',
      link: '/admin?tab=applications',
    })
    await audit({ actorId: user.id, actorName: user.name, action: 'APPLICATION_RESUBMITTED', targetType: 'APPLICATION', targetId: id })
    return ok({ application: updated })
  }

  // ── Staff actions ──
  if (!isReviewer) throw new ApiError(403, 'FORBIDDEN', 'Reviewer access required.')
  if (!REVIEWABLE.includes(app.status) && body.action !== 'note' && body.action !== 'revoke' && body.action !== 'suspend') {
    throw new ApiError(409, 'INVALID_STATE', `Action "${body.action}" is not allowed while the application is ${app.status}.`)
  }

  switch (body.action) {
    case 'assign': {
      if (!body.reviewOwnerId) throw new ApiError(400, 'VALIDATION_ERROR', 'reviewOwnerId is required.')
      const updated = await db.application.update({
        where: { id },
        data: {
          reviewOwnerId: body.reviewOwnerId,
          reviewOwnerName: body.reviewOwnerName ?? null,
          status: app.status === 'SUBMITTED' || app.status === 'RESUBMITTED' ? 'UNDER_REVIEW' : app.status,
          events: { create: { type: 'REVIEW_ASSIGNED', actorId: user.id, actorName: user.name, note: `Review assigned to ${body.reviewOwnerName ?? body.reviewOwnerId}.` } },
        },
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'APPLICATION_ASSIGNED', targetType: 'APPLICATION', targetId: id, metadata: { to: body.reviewOwnerId } })
      return ok({ application: updated })
    }
    case 'start_review': {
      const updated = await db.application.update({
        where: { id },
        data: {
          status: 'UNDER_REVIEW',
          events: { create: { type: 'STATUS_CHANGED', actorId: user.id, actorName: user.name, note: 'Review started.' } },
        },
      })
      return ok({ application: updated })
    }
    case 'request_info': {
      if (!body.infoMessage || body.infoMessage.trim().length < 5) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Explain what information or documents are required.')
      }
      const due = new Date(Date.now() + body.correctionDays * 24 * 60 * 60 * 1000)
      const updated = await db.application.update({
        where: { id },
        data: {
          status: 'MORE_INFO_REQUIRED',
          infoRequestedAt: new Date(),
          correctionsDueAt: due,
          escalated: false,
          events: { create: { type: 'INFO_REQUESTED', actorId: user.id, actorName: user.name, note: body.infoMessage } },
        },
      })
      await notify({
        userId: app.userId,
        type: 'APPLICATION_INFO_REQUIRED',
        title: `Action required on ${app.refCode}`,
        body: `${body.infoMessage} Please respond before ${due.toLocaleDateString('en-KE')}.`,
        link: app.type === 'DEALER' ? '/dealer' : app.type === 'SELLER' ? '/sell' : app.type === 'LOGISTICS' ? '/logistics' : '/garage-dashboard',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'APPLICATION_INFO_REQUESTED', targetType: 'APPLICATION', targetId: id })
      return ok({ application: updated })
    }
    case 'approve': {
      // ── Document verification enforcement ──
      // An application can never be approved while its documents have not
      // been through the Verification Engine. Uploading ≠ verification:
      // every attached document must reach VERIFIED by an explicit reviewer
      // decision first. Legacy applications whose documents were only stored
      // as JSON get those documents imported as UNDER_REVIEW — they must be
      // genuinely reviewed in the Verification Center before approval.
      const appDocs = await db.verificationDocument.findMany({ where: { applicationId: id } })
      if (appDocs.length === 0) {
        let legacy: { name: string; url: string }[] = []
        try { legacy = JSON.parse(app.documents || '[]') } catch { legacy = [] }
        if (legacy.length > 0) {
          await db.verificationDocument.createMany({
            data: legacy.map((d, i) => ({
              refCode: refCode('DOC', 6),
              ownerUserId: app.userId,
              applicationId: id,
              kind: app.type === 'SELLER' ? (i === 0 ? 'ID_FRONT' : 'ID_BACK') : app.type === 'LOGISTICS' ? (i === 0 ? 'DRIVER_LICENSE' : 'INSURANCE') : i === 0 ? 'BUSINESS_LICENSE' : 'PIN_CERTIFICATE',
              label: d.name,
              fileUrl: d.url,
              fileName: d.name,
              status: 'UNDER_REVIEW',
            })),
          })
        }
      }
      const docsNow = await db.verificationDocument.findMany({ where: { applicationId: id } })
      if (docsNow.length === 0) {
        throw new ApiError(400, 'DOCUMENTS_REQUIRED', 'No verification documents are attached to this application. Request the required documents from the applicant before approving.')
      }
      const pending = docsNow.filter((d) => ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED'].includes(d.status))
      if (pending.length > 0) {
        throw new ApiError(400, 'DOCS_PENDING', `${pending.length} document(s) have not completed verification (${pending.map((d) => d.refCode).join(', ')}). Review them in the Verification Center first — unfinished checks can never be marked approved.`)
      }
      const rejectedDocs = docsNow.filter((d) => d.status === 'REJECTED')
      if (rejectedDocs.length > 0) {
        throw new ApiError(400, 'DOCS_REJECTED', `Rejected documents must be replaced before approval: ${rejectedDocs.map((d) => d.refCode).join(', ')}.`)
      }
      const verified = docsNow.filter((d) => d.status === 'VERIFIED')
      if (verified.length === 0) {
        throw new ApiError(400, 'NOT_VERIFIED', 'At least one document must be VERIFIED before this application can be approved.')
      }

      // ── SELLER (individual KYC): grant the verified-seller role — no org ──
      if (app.type === 'SELLER') {
        const dbUser = await db.user.findUnique({ where: { id: app.userId } })
        if (dbUser && !dbUser.roles.split(',').includes('SELLER_VERIFIED')) {
          await db.user.update({ where: { id: app.userId }, data: { roles: `${dbUser.roles},SELLER_VERIFIED` } })
        }
        const updated = await db.application.update({
          where: { id },
          data: {
            status: 'APPROVED',
            decisionNote: body.decisionNote ?? null,
            events: { create: { type: 'APPROVED', actorId: user.id, actorName: user.name, note: body.decisionNote || 'Identity and authority-to-sell documents verified.' } },
          },
        })
        await notify({
          userId: app.userId,
          type: 'APPLICATION_APPROVED',
          title: `Seller verification approved — ${app.refCode}`,
          body: 'Your identity verification is complete. Your listings now carry the verified-seller trust marker.',
          link: '/sell',
        })
        await audit({ actorId: user.id, actorName: user.name, action: 'APPLICATION_APPROVED', targetType: 'APPLICATION', targetId: id, metadata: { type: 'SELLER' } })
        return ok({ application: updated })
      }

      // ── LOGISTICS: create the approved delivery partner — no dealer org ──
      if (app.type === 'LOGISTICS') {
        if (app.orgId) throw new ApiError(409, 'ALREADY_APPROVED', 'This application already resulted in a delivery partner.')
        const partner = await db.logisticsPartner.create({
          data: {
            refCode: refCode('LGP', 6),
            ownerUserId: app.userId,
            name: app.orgName,
            partnerType: app.accountType === 'INDEPENDENT' ? 'INDEPENDENT' : 'COMPANY',
            regNo: app.regNo,
            county: app.county,
            town: app.town,
            phone: app.phone,
            email: app.email,
            representative: app.representative,
            capabilities: app.categories || null,
            documents: app.documents,
            consent: true,
            status: 'APPROVED',
            verified: true,
            appliedAt: app.submittedAt,
            reviewedAt: new Date(),
            reviewedByName: user.name,
            events: { create: { type: 'APPROVED', actorId: user.id, actorName: user.name, note: body.decisionNote || 'Delivery partner approved after document review.' } },
          },
        })
        const dbUser = await db.user.findUnique({ where: { id: app.userId } })
        if (dbUser && !dbUser.roles.split(',').includes('LOGISTICS_OWNER')) {
          await db.user.update({ where: { id: app.userId }, data: { roles: `${dbUser.roles},LOGISTICS_OWNER` } })
        }
        const updated = await db.application.update({
          where: { id },
          data: {
            status: 'APPROVED',
            orgId: partner.id,
            decisionNote: body.decisionNote ?? null,
            events: { create: { type: 'APPROVED', actorId: user.id, actorName: user.name, note: body.decisionNote || 'Application approved after review.' } },
          },
        })
        await notify({
          userId: app.userId,
          type: 'APPLICATION_APPROVED',
          title: `Delivery partner approved — welcome to the network`,
          body: `${partner.name} is now a verified delivery partner. Your LogisticsOS dashboard is ready.`,
          link: '/logistics',
        })
        await audit({ actorId: user.id, actorName: user.name, action: 'APPLICATION_APPROVED', targetType: 'APPLICATION', targetId: id, metadata: { type: 'LOGISTICS', partnerId: partner.id } })
        return ok({ application: updated, partner })
      }

      // ── DEALER / GARAGE: create the business org ──
      if (app.orgId) throw new ApiError(409, 'ALREADY_APPROVED', 'This application already resulted in an organisation.')
      const org = await db.org.create({
        data: {
          type: app.type,
          name: app.orgName,
          regNo: app.regNo,
          county: app.county,
          town: app.town,
          location: app.physicalAddress,
          phone: app.phone,
          email: app.email,
          description: app.type === 'GARAGE' && app.categories ? `Services: ${app.categories.split(',').join(', ')}` : null,
          status: 'ACTIVE',
          members: { create: { userId: app.userId, role: 'OWNER' } },
        },
      })
      const roleAdd = app.type === 'DEALER' ? 'DEALER_OWNER' : 'GARAGE_OWNER'
      const dbUser = await db.user.findUnique({ where: { id: app.userId } })
      if (dbUser && !dbUser.roles.includes(roleAdd)) {
        await db.user.update({ where: { id: app.userId }, data: { roles: `${dbUser.roles},${roleAdd}` } })
      }
      const updated = await db.application.update({
        where: { id },
        data: {
          status: 'APPROVED',
          orgId: org.id,
          decisionNote: body.decisionNote ?? null,
          events: { create: { type: 'APPROVED', actorId: user.id, actorName: user.name, note: body.decisionNote || 'Application approved after review.' } },
        },
      })
      await notify({
        userId: app.userId,
        type: 'APPLICATION_APPROVED',
        title: `${app.type === 'DEALER' ? 'Dealership' : 'Garage'} approved — welcome to CARMAZE`,
        body: `${org.name} is now verified on CARMAZE. Your ${app.type === 'DEALER' ? 'DealerOS dashboard' : 'garage dashboard'} is ready.`,
        link: app.type === 'DEALER' ? '/dealer' : '/garage-dashboard',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'APPLICATION_APPROVED', targetType: 'APPLICATION', targetId: id, metadata: { orgId: org.id } })
      return ok({ application: updated, org })
    }
    case 'reject': {
      if (!body.decisionNote || body.decisionNote.trim().length < 10) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Provide a clear rejection reason (at least 10 characters).')
      }
      const updated = await db.application.update({
        where: { id },
        data: {
          status: 'REJECTED',
          decisionNote: body.decisionNote,
          events: { create: { type: 'REJECTED', actorId: user.id, actorName: user.name, note: body.decisionNote } },
        },
      })
      await notify({
        userId: app.userId,
        type: 'APPLICATION_REJECTED',
        title: `Application ${app.refCode} was not approved`,
        body: body.decisionNote,
        link: app.type === 'DEALER' ? '/dealer' : app.type === 'SELLER' ? '/sell' : app.type === 'LOGISTICS' ? '/logistics' : '/garage-dashboard',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'APPLICATION_REJECTED', targetType: 'APPLICATION', targetId: id })
      return ok({ application: updated })
    }
    case 'suspend':
    case 'revoke': {
      if (!body.decisionNote) throw new ApiError(400, 'VALIDATION_ERROR', 'Provide the reason for this decision.')
      const updated = await db.application.update({
        where: { id },
        data: {
          status: body.action === 'suspend' ? 'SUSPENDED' : 'REVOKED',
          decisionNote: body.decisionNote,
          events: { create: { type: 'STATUS_CHANGED', actorId: user.id, actorName: user.name, note: `${body.action}: ${body.decisionNote}` } },
        },
      })
      await notify({
        userId: app.userId,
        type: `APPLICATION_${body.action.toUpperCase()}`,
        title: `Application ${app.refCode} ${body.action === 'suspend' ? 'suspended' : 'revoked'}`,
        body: body.decisionNote,
        link: app.type === 'DEALER' ? '/dealer' : app.type === 'SELLER' ? '/sell' : app.type === 'LOGISTICS' ? '/logistics' : '/garage-dashboard',
      })
      await audit({ actorId: user.id, actorName: user.name, action: `APPLICATION_${body.action.toUpperCase()}`, targetType: 'APPLICATION', targetId: id })
      return ok({ application: updated })
    }
    case 'note': {
      const updated = await db.application.update({
        where: { id },
        data: { events: { create: { type: 'NOTE', actorId: user.id, actorName: user.name, note: body.notes || 'Reviewer note.' } } },
      })
      return ok({ application: updated })
    }
    default:
      throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown action.')
  }
})

async function reviewerIdsFor(_type: string): Promise<string[]> {
  const staff = await db.user.findMany({
    where: { OR: [{ roles: { contains: 'REVIEWER' } }, { roles: { contains: 'ADMIN' } }, { roles: { contains: 'FOUNDER' } }], status: 'ACTIVE' },
    select: { id: true },
  })
  return staff.map((s) => s.id)
}
