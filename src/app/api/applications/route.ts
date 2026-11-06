import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { notify, notifyMany } from '@/lib/notify'
import { audit } from '@/lib/audit'
import { getSessionUser, hasRole, STAFF_ROLES } from '@/lib/auth'

const submitSchema = z.object({
  type: z.enum(['DEALER', 'GARAGE', 'SELLER', 'LOGISTICS']),
  status: z.enum(['DRAFT', 'SUBMITTED']).default('SUBMITTED'),
  // For SELLER applications this is the applicant's full legal name (no business).
  orgName: z.string().trim().min(2, 'Full name is required').max(120),
  regNo: z.string().trim().max(60).optional().or(z.literal('')), // SELLER: national ID / passport number
  county: z.string().trim().min(2, 'County is required').max(60),
  town: z.string().trim().max(60).optional().or(z.literal('')),
  physicalAddress: z.string().trim().max(200).optional().or(z.literal('')),
  phone: z.string().trim().min(9, 'Phone number is required').max(20),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  representative: z.string().trim().min(2, 'Authorised representative is required').max(80),
  accountType: z.string().trim().max(40).optional().or(z.literal('')), // LOGISTICS: COMPANY | INDEPENDENT
  categories: z.string().trim().max(300).optional().or(z.literal('')), // garage: services · LOGISTICS: capabilities
  documents: z.array(z.object({ name: z.string().max(200), url: z.string().max(300) })).max(10).default([]),
  consent: z.boolean(),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
})

const REVIEWABLE = ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'RESUBMITTED']

async function reviewerIds(): Promise<string[]> {
  const staff = await db.user.findMany({
    where: { OR: [{ roles: { contains: 'REVIEWER' } }, { roles: { contains: 'ADMIN' } }, { roles: { contains: 'FOUNDER' } }], status: 'ACTIVE' },
    select: { id: true },
  })
  return staff.map((s) => s.id)
}

export const GET = route(async (req: NextRequest) => {
  const user = await getSessionUser()
  if (!user) return fail(401, 'UNAUTHENTICATED', 'Please sign in.')
  const url = new URL(req.url)

  if (url.searchParams.get('scope') === 'queue') {
    if (!hasRole(user, ...STAFF_ROLES)) return fail(403, 'FORBIDDEN', 'Reviewer access required.')
    const apps = await db.application.findMany({
      where: { status: { in: REVIEWABLE } },
      orderBy: { submittedAt: 'asc' },
      include: { user: { select: { name: true, email: true, phone: true } }, events: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    return ok({ applications: apps })
  }

  const mine = await db.application.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })
  // NOTE (agent 6-f repair): no `org` relation exists on Application — attach
  // the linked org (if any) with a plain lookup to keep the response shape.
  const orgIds = [...new Set(mine.map((a) => a.orgId).filter((v): v is string => Boolean(v)))]
  const orgs = orgIds.length ? await db.org.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true, type: true, status: true } }) : []
  const orgMap = new Map(orgs.map((o) => [o.id, o]))
  return ok({ applications: mine.map((a) => ({ ...a, org: a.orgId ? orgMap.get(a.orgId) ?? null : null })) })
})

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`application:${getIp(req)}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many submissions. Please wait before trying again.')

  const body = await parseBody(req, submitSchema)
  if (body.status === 'SUBMITTED' && !body.consent) {
    return fail(400, 'CONSENT_REQUIRED', 'You must accept the terms and privacy notice.')
  }
  if (body.type === 'GARAGE' && body.status === 'SUBMITTED' && !body.categories) {
    return fail(400, 'CATEGORIES_REQUIRED', 'Select at least one service category.')
  }
  // SELLER (individual KYC) and LOGISTICS applications require identity
  // documents before submission — uploads alone never constitute verification.
  if ((body.type === 'SELLER' || body.type === 'LOGISTICS') && body.status === 'SUBMITTED' && body.documents.length === 0) {
    return fail(400, 'DOCUMENTS_REQUIRED', 'Upload at least one identity or supporting document for review.')
  }

  const typeLabel: Record<string, string> = { DEALER: 'dealer', GARAGE: 'garage', SELLER: 'seller verification', LOGISTICS: 'delivery partner' }
  const existingActive = await db.application.findFirst({
    where: { userId: user.id, type: body.type, status: { in: REVIEWABLE } },
  })
  if (existingActive && body.status === 'SUBMITTED') {
    return fail(409, 'APPLICATION_EXISTS', `You already have a ${typeLabel[body.type]} application in progress (ref ${existingActive.refCode}).`)
  }

  const refPrefix: Record<string, string> = { DEALER: 'DLA', GARAGE: 'GRA', SELLER: 'SVA', LOGISTICS: 'LGA' }

  const app = await db.application.create({
    data: {
      refCode: refCode(refPrefix[body.type] ?? 'APP', 6),
      type: body.type,
      userId: user.id,
      orgName: body.orgName,
      regNo: body.regNo || null,
      county: body.county,
      town: body.town || null,
      physicalAddress: body.physicalAddress || null,
      phone: body.phone,
      email: body.email || null,
      representative: body.representative,
      accountType: body.accountType || null,
      categories: body.categories || null,
      documents: JSON.stringify(body.documents),
      consent: body.consent,
      notes: body.notes || null,
      status: body.status,
      submittedAt: body.status === 'SUBMITTED' ? new Date() : null,
      events: {
        create: {
          type: body.status === 'SUBMITTED' ? 'SUBMITTED' : 'NOTE',
          actorId: user.id,
          actorName: user.name,
          note: body.status === 'SUBMITTED' ? 'Application submitted for review.' : 'Application saved as draft.',
        },
      },
    },
  })

  if (body.status === 'SUBMITTED') {
    // Enter every submitted document into the Document Verification Engine as
    // SUBMITTED. Uploading is never verification — these stay pending until a
    // staff reviewer acts in the Verification Center. Kinds are inferred from
    // position where the wizard does not collect them explicitly.
    const inferredKind: Record<string, (i: number) => string> = {
      SELLER: (i) => (i === 0 ? 'ID_FRONT' : i === 1 ? 'ID_BACK' : 'SUPPORTING'),
      LOGISTICS: (i) => (i === 0 ? 'DRIVER_LICENSE' : i === 1 ? 'INSURANCE' : 'SUPPORTING'),
      DEALER: (i) => (i === 0 ? 'BUSINESS_LICENSE' : i === 1 ? 'PIN_CERTIFICATE' : 'SUPPORTING'),
      GARAGE: (i) => (i === 0 ? 'BUSINESS_LICENSE' : i === 1 ? 'PIN_CERTIFICATE' : 'SUPPORTING'),
    }
    const infer = inferredKind[body.type] ?? (() => 'SUPPORTING')
    if (body.documents.length > 0) {
      await db.verificationDocument.createMany({
        data: body.documents.map((d, i) => ({
          refCode: refCode('DOC', 6),
          ownerUserId: user.id,
          applicationId: app.id,
          kind: infer(i),
          label: d.name,
          fileUrl: d.url,
          fileName: d.name,
          status: 'SUBMITTED',
        })),
      })
    }

    const links: Record<string, string> = { DEALER: '/dealer', GARAGE: '/garage-dashboard', SELLER: '/sell', LOGISTICS: '/logistics' }
    await notify({
      userId: user.id,
      type: 'APPLICATION_RECEIVED',
      title: `Application received — ${app.refCode}`,
      body: `Thank you. Your ${typeLabel[body.type]} application is in the review queue. Initial review target: within ${app.reviewSlaHours} business hours. Verification is completed by our review team — uploading documents never self-verifies an account.`,
      link: links[body.type] ?? '/account',
    })
    await notifyMany(await reviewerIds(), {
      type: 'APPLICATION_REVIEW_REQUESTED',
      title: `New ${typeLabel[body.type]} application to review`,
      body: `${body.orgName} (${app.refCode}) submitted from ${body.county}. SLA: ${app.reviewSlaHours}h.`,
      link: '/admin?tab=applications',
    })
    await audit({ actorId: user.id, actorName: user.name, action: 'APPLICATION_SUBMITTED', targetType: 'APPLICATION', targetId: app.id, metadata: { ref: app.refCode, type: body.type } })
  }

  return ok({ application: app }, { status: 201 })
})
