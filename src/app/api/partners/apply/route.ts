import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, getIp } from '@/lib/api'
import { getSessionUser, STAFF_ROLES } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { notify, notifyMany } from '@/lib/notify'
import { audit } from '@/lib/audit'
import { PARTNER_CATEGORY_VALUES, partnerCategoryLabel } from '@/lib/partners'
import { KENYA_COUNTIES } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * POST /api/partners/apply — public partner application (no account needed).
 * Rate limit: 5 applications per hour per IP. Applications land as PENDING
 * and go live only after human business verification by CARMAZE staff.
 */
const schema = z.object({
  name: z.string().trim().min(2, 'Business name is required').max(120),
  category: z.enum(PARTNER_CATEGORY_VALUES),
  county: z
    .string()
    .refine((c) => (KENYA_COUNTIES as string[]).includes(c), 'Choose a valid county'),
  serviceAreas: z.array(z.string().trim().min(1).max(60)).max(20).optional().default([]),
  description: z
    .string()
    .trim()
    .min(20, 'Tell us about the business (at least 20 characters)')
    .max(2000),
  contactName: z.string().trim().min(2, 'Contact person is required').max(80),
  phone: z.string().trim().min(9, 'A reachable business phone is required').max(20),
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),
  website: z
    .string()
    .trim()
    .url('Enter a valid URL, e.g. https://example.co.ke')
    .optional()
    .or(z.literal('')),
})

export const POST = route(async (req: NextRequest) => {
  const rl = rateLimit(`partner-apply:${getIp(req)}`, 5, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many applications from this network. Please try again later.')

  const body = await parseBody(req, schema)
  const user = await getSessionUser()

  const partner = await db.partner.create({
    data: {
      refCode: refCode('PRT', 6),
      name: body.name,
      category: body.category,
      county: body.county,
      serviceAreas: body.serviceAreas.length
        ? JSON.stringify([...new Set(body.serviceAreas)])
        : null,
      description: body.description,
      phone: body.phone,
      email: body.email || null,
      website: body.website || null,
      contactName: body.contactName,
      status: 'PENDING',
      verified: false,
    },
  })

  await audit({
    actorId: user?.id ?? null,
    actorName: user?.name ?? body.contactName,
    action: 'PARTNER_APPLICATION',
    targetType: 'PARTNER',
    targetId: partner.id,
    metadata: { ref: partner.refCode, category: body.category, county: body.county },
  })

  // Staff heads-up — same pattern as dealer/garage applications.
  const staff = await db.user.findMany({
    where: { OR: STAFF_ROLES.map((r) => ({ roles: { contains: r } })), status: 'ACTIVE' },
    select: { id: true },
  })
  await notifyMany(staff.map((s) => s.id), {
    type: 'PARTNER_APPLICATION_REVIEW_REQUESTED',
    title: 'New partner application to review',
    body: `${body.name} (${partner.refCode}) applied from ${body.county} as ${partnerCategoryLabel(body.category)}.`,
    link: '/admin?tab=partners',
  })

  // Acknowledge the applicant in-app when they applied from an account.
  if (user) {
    await notify({
      userId: user.id,
      type: 'PARTNER_APPLICATION_RECEIVED',
      title: `Partner application received — ${partner.refCode}`,
      body: 'Thanks for applying. The CARMAZE team reviews every application by hand — listings go live only after business verification is complete. No payment is charged for applying.',
      link: '/partners',
    })
  }

  return ok(
    {
      refCode: partner.refCode,
      message:
        'Application received. Every application is reviewed by the CARMAZE team, and a listing appears only after business verification is complete. No payment is charged for applying.',
    },
    { status: 201 },
  )
})
