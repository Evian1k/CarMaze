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
  type: z.enum(['DEALER', 'GARAGE']),
  status: z.enum(['DRAFT', 'SUBMITTED']).default('SUBMITTED'),
  orgName: z.string().trim().min(2, 'Business name is required').max(120),
  regNo: z.string().trim().max(60).optional().or(z.literal('')),
  county: z.string().trim().min(2, 'County is required').max(60),
  town: z.string().trim().max(60).optional().or(z.literal('')),
  physicalAddress: z.string().trim().max(200).optional().or(z.literal('')),
  phone: z.string().trim().min(9, 'Business phone is required').max(20),
  email: z.string().trim().email('Enter a valid business email').optional().or(z.literal('')),
  representative: z.string().trim().min(2, 'Authorised representative is required').max(80),
  accountType: z.string().trim().max(40).optional().or(z.literal('')),
  categories: z.string().trim().max(300).optional().or(z.literal('')),
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
    return fail(400, 'CONSENT_REQUIRED', 'You must accept the dealer/provider terms and privacy notice.')
  }
  if (body.type === 'GARAGE' && body.status === 'SUBMITTED' && !body.categories) {
    return fail(400, 'CATEGORIES_REQUIRED', 'Select at least one service category.')
  }

  const existingActive = await db.application.findFirst({
    where: { userId: user.id, type: body.type, status: { in: REVIEWABLE } },
  })
  if (existingActive && body.status === 'SUBMITTED') {
    return fail(409, 'APPLICATION_EXISTS', `You already have a ${body.type === 'DEALER' ? 'dealer' : 'garage'} application in progress (ref ${existingActive.refCode}).`)
  }

  const app = await db.application.create({
    data: {
      refCode: refCode(body.type === 'DEALER' ? 'DLA' : 'GRA', 6),
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
    await notify({
      userId: user.id,
      type: 'APPLICATION_RECEIVED',
      title: `Application received — ${app.refCode}`,
      body: `Thank you. Your ${body.type === 'DEALER' ? 'dealership' : 'garage'} application is in the review queue. Initial review target: within ${app.reviewSlaHours} business hours.`,
      link: body.type === 'DEALER' ? '/dealer' : '/garage-dashboard',
    })
    await notifyMany(await reviewerIds(), {
      type: 'APPLICATION_REVIEW_REQUESTED',
      title: `New ${body.type.toLowerCase()} application to review`,
      body: `${body.orgName} (${app.refCode}) submitted from ${body.county}. SLA: ${app.reviewSlaHours}h.`,
      link: '/admin?tab=applications',
    })
    await audit({ actorId: user.id, actorName: user.name, action: 'APPLICATION_SUBMITTED', targetType: 'APPLICATION', targetId: app.id, metadata: { ref: app.refCode, type: body.type } })
  }

  return ok({ application: app }, { status: 201 })
})
