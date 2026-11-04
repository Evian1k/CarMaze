import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { staffUserIds } from '@/lib/orgs'
import { notifyMany } from '@/lib/notify'
import { getFees } from '@/lib/supply'

export const dynamic = 'force-dynamic'

/**
 * GET /api/suppliers — public directory of verified suppliers on the
 * Automotive Supply Network. Only organisations with type=SUPPLIER,
 * status=ACTIVE and verified=true are listed publicly. Unverified suppliers
 * are never shown as verified.
 */
export const GET = route(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams
  const q = sp.get('q')?.trim()
  const county = sp.get('county')
  const category = sp.get('category') // product category slug filter
  const page = Math.max(1, Number(sp.get('page') || 1))
  const pageSize = Math.min(36, Number(sp.get('pageSize') || 18))

  const AND: Record<string, unknown>[] = [{ type: 'SUPPLIER', status: 'ACTIVE' }]
  // Only show verified suppliers publicly; platform staff can see pending ones via admin
  if (sp.get('includePending') !== '1') AND.push({ verified: true })
  if (q) AND.push({ OR: [{ name: { contains: q } }, { description: { contains: q } }] })
  if (county) AND.push({ county: { equals: county } })
  if (category) {
    AND.push({ products: { some: { status: 'PUBLISHED', category: { slug: category } } } })
  }

  const [total, suppliers] = await Promise.all([
    db.org.count({ where: { AND } }),
    db.org.findMany({
      where: { AND },
      select: {
        id: true, name: true, county: true, town: true, location: true, description: true,
        logoUrl: true, coverUrl: true, verified: true, supplierRating: true, specialities: true,
        createdAt: true,
        _count: { select: { products: true, branches: true, reviews: true } },
      },
      orderBy: [{ supplierRating: 'desc' }, { name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return ok({
    total,
    page,
    pageSize,
    suppliers: suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      county: s.county,
      town: s.town,
      location: s.location,
      description: s.description,
      logoUrl: s.logoUrl,
      coverUrl: s.coverUrl,
      verified: s.verified,
      rating: s.supplierRating,
      specialities: s.specialities ? JSON.parse(s.specialities) : [],
      productCount: s._count.products,
      branchCount: s._count.branches,
      reviewCount: s._count.reviews,
      memberSince: s.createdAt,
    })),
  })
})

const applySchema = z.object({
  orgName: z.string().trim().min(3).max(120),
  regNo: z.string().trim().max(60).optional().nullable(),
  county: z.string().trim().min(2).max(60),
  town: z.string().trim().max(60).optional().nullable(),
  physicalAddress: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().min(9).max(20),
  email: z.string().trim().max(120).optional().nullable(),
  representative: z.string().trim().min(2).max(80),
  categories: z.string().trim().max(300).optional().nullable(), // comma separated supply categories
  description: z.string().trim().max(2000).optional().nullable(),
  documents: z.array(z.object({ name: z.string().max(120), url: z.string().max(300) })).max(8).default([]),
  consent: z.literal(true),
})

/**
 * POST /api/suppliers — submit a supplier business application. Creates an
 * Application (type=SUPPLIER) for admin review. A supplier is NEVER verified
 * automatically — verification requires document review and admin approval.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`supplier-apply:${user.id}`, 5, 24 * 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'You have submitted several applications recently. Please wait before trying again.')
  const body = await parseBody(req, applySchema)

  // one open application per user
  const open = await db.application.findFirst({
    where: { userId: user.id, type: 'SUPPLIER', status: { in: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'RESUBMITTED'] } },
  })
  if (open) return fail(409, 'APPLICATION_EXISTS', 'You already have a supplier application under review.')

  const app = await db.application.create({
    data: {
      refCode: refCode('SUP', 6),
      type: 'SUPPLIER',
      userId: user.id,
      orgName: body.orgName,
      regNo: body.regNo ?? null,
      county: body.county,
      town: body.town ?? null,
      physicalAddress: body.physicalAddress ?? null,
      phone: body.phone,
      email: body.email ?? null,
      representative: body.representative,
      categories: body.categories ?? null,
      documents: JSON.stringify(body.documents),
      consent: true,
      notes: body.description ?? null,
      status: 'SUBMITTED',
      submittedAt: new Date(),
      events: { create: { type: 'SUBMITTED', actorId: user.id, actorName: user.name, note: 'Supplier application submitted for verification.' } },
    },
  })

  await notifyMany(await staffUserIds('REVIEWER', 'ADMIN', 'FOUNDER'), {
    type: 'SUPPLIER_APPLICATION',
    title: `Supplier application ${app.refCode}`,
    body: `${body.orgName} applied to join the Automotive Supply Network. Document review required.`,
    link: '/admin?tab=supply',
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'SUPPLIER_APPLICATION_SUBMITTED', targetType: 'APPLICATION', targetId: app.id, metadata: { ref: app.refCode } })

  const fees = await getFees()
  return ok({
    application: { id: app.id, refCode: app.refCode, status: app.status },
    message: 'Application received. Our verification team reviews business registration documents before any supplier is verified.',
    suggestedPlans: { note: 'Supplier subscription plans become available after verification.', commission: fees.supplyCommissionPct },
  }, { status: 201 })
})
