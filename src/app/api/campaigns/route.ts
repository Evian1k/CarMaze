import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireUser, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notifyOrgMembers } from '@/lib/orgs'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  vehicleId: z.string().min(1),
  packageCode: z.string().trim().min(1).max(40),
})

/**
 * GET /api/campaigns?mine=1: promotions of the organisations the caller
 * belongs to (any role: SALES/STAFF may view; only OWNER/MANAGER can buy or
 * cancel). Also returns the active promotion packages so the purchase form
 * has one source of truth. Org scoping mirrors /api/billing/invoices.
 *
 * Opportunistic expiry sweep: campaigns whose endsAt has passed are marked
 * ENDED so the portal shows honest statuses (same pattern as the view-event
 * prune: real data maintenance, no fake numbers).
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const url = new URL(req.url)
  if (url.searchParams.get('mine') !== '1') {
    return fail(400, 'SCOPE_REQUIRED', 'Specify ?mine=1 to list your organisation’s promotions.')
  }

  await db.campaign.updateMany({
    where: { status: 'ACTIVE', endsAt: { lt: new Date() } },
    data: { status: 'ENDED' },
  })

  const memberships = await db.orgMember.findMany({
    where: { userId: user.id },
    select: { orgId: true },
  })
  const orgIds = memberships.map((m) => m.orgId)
  if (orgIds.length === 0) {
    return fail(403, 'NO_ORG_MEMBERSHIP', 'You do not belong to a dealership or garage organisation.')
  }

  const [campaignRows, allPackages] = await Promise.all([
    db.campaign.findMany({
      where: { orgId: { in: orgIds } },
      orderBy: { createdAt: 'desc' },
      include: {
        vehicle: { select: { id: true, refCode: true, make: true, model: true, year: true, status: true } },
      },
      take: 100,
    }),
    db.campaignPackage.findMany({ orderBy: { priceMinor: 'asc' } }),
  ])

  const invoiceIds = campaignRows
    .map((c) => c.invoiceId)
    .filter((x): x is string => Boolean(x))
  const invoices = invoiceIds.length
    ? await db.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, refCode: true, status: true, amountMinor: true, currency: true, dueDate: true, paidAt: true },
      })
    : []
  const invoiceById = new Map(invoices.map((i) => [i.id, i]))
  const packageByCode = new Map(allPackages.map((p) => [p.code, p]))

  const campaigns = campaignRows.map((c) => ({
    id: c.id,
    refCode: c.refCode,
    orgId: c.orgId,
    packageCode: c.packageCode,
    status: c.status,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    impressions: c.impressions,
    clicks: c.clicks,
    createdAt: c.createdAt,
    vehicle: {
      id: c.vehicle.id,
      refCode: c.vehicle.refCode,
      title: `${c.vehicle.make} ${c.vehicle.model} ${c.vehicle.year}`,
      status: c.vehicle.status,
    },
    package: packageByCode.get(c.packageCode)
      ? {
          code: c.packageCode,
          name: packageByCode.get(c.packageCode)!.name,
          days: packageByCode.get(c.packageCode)!.days,
        }
      : null,
    invoice: c.invoiceId ? invoiceById.get(c.invoiceId) ?? null : null,
  }))

  const packages = allPackages
    .filter((p) => p.active)
    .map((p) => ({
      code: p.code,
      name: p.name,
      days: p.days,
      priceMinor: p.priceMinor,
      currency: p.currency,
      description: p.description,
    }))

  return ok({ campaigns, packages })
})

/**
 * POST /api/campaigns: purchase a promotion for one of the caller's PUBLISHED
 * listings. OWNER/MANAGER of a DEALER or GARAGE org only.
 *
 * HONEST BILLING (same contract as /api/billing/subscribe): this creates a
 * PENDING_PAYMENT campaign + a PENDING CAMPAIGN invoice only. The campaign is
 * NOT activated here: it is activated exclusively when the invoice is paid
 * (M-Pesa Daraja callback or FINANCE manual reconciliation), via
 * /api/billing/_activate.ts.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`campaign-create:${user.id}:${getIp(req)}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many promotion purchases. Please try later.')

  const body = await parseBody(req, bodySchema)

  const managed = await db.orgMember.findMany({
    where: {
      userId: user.id,
      role: { in: ['OWNER', 'MANAGER'] },
      org: { status: 'ACTIVE' },
    },
    include: { org: { select: { id: true, type: true } } },
  })
  if (managed.length === 0) {
    return fail(403, 'ROLE_REQUIRED', 'Only the owner or a manager of a verified dealership or garage can purchase promotions.')
  }
  const managedOrgIds = managed.map((m) => m.orgId)

  const [vehicle, pkg] = await Promise.all([
    db.vehicle.findUnique({
      where: { id: body.vehicleId },
      select: { id: true, orgId: true, status: true, make: true, model: true, year: true },
    }),
    db.campaignPackage.findUnique({ where: { code: body.packageCode } }),
  ])
  if (!vehicle) throw new ApiError(404, 'VEHICLE_NOT_FOUND', 'That listing does not exist.')
  if (!vehicle.orgId || !managedOrgIds.includes(vehicle.orgId)) {
    return fail(400, 'VEHICLE_NOT_YOURS', 'You can only promote vehicles listed by your own organisation.')
  }
  if (vehicle.status !== 'PUBLISHED') {
    return fail(400, 'VEHICLE_NOT_PUBLISHED', 'Only published listings can be promoted. Submit the listing for review and publish it first.')
  }
  if (!pkg || !pkg.active) {
    return fail(404, 'PACKAGE_NOT_FOUND', 'That promotion package does not exist or is no longer offered.')
  }

  const orgId = vehicle.orgId
  const orgType = managed.find((m) => m.org.id === orgId)?.org.type ?? 'DEALER'
  const title = `${vehicle.make} ${vehicle.model} ${vehicle.year}`
  const now = new Date()
  const dueDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
  const dashboardLink = orgType === 'GARAGE' ? '/garage-dashboard?tab=profile' : '/dealer?tab=billing'

  // One transaction: the one-promotion-per-listing check is INSIDE the
  // transaction, so two concurrent "promote" clicks can never both pass and
  // both mint payable invoices for the same slot.
  const { campaign, invoice } = await db.$transaction(async (tx) => {
    const existing = await tx.campaign.findFirst({
      where: { vehicleId: vehicle.id, status: { in: ['PENDING_PAYMENT', 'ACTIVE'] } },
      select: { refCode: true, status: true },
    })
    if (existing) {
      throw new ApiError(
        409,
        'CAMPAIGN_EXISTS',
        existing.status === 'PENDING_PAYMENT'
          ? `This listing already has an unpaid promotion (${existing.refCode}): complete or cancel it first.`
          : `This listing already has an active promotion (${existing.refCode}).`,
      )
    }
    const invoice = await tx.invoice.create({
      data: {
        refCode: refCode('INV', 6),
        orgId,
        userId: user.id,
        type: 'CAMPAIGN',
        description: `Promotion: ${pkg.name} for ${title}`,
        amountMinor: pkg.priceMinor,
        currency: pkg.currency,
        status: 'PENDING',
        dueDate,
      },
    })
    const campaign = await tx.campaign.create({
      data: {
        refCode: refCode('CMP', 6),
        orgId,
        vehicleId: vehicle.id,
        packageCode: pkg.code,
        status: 'PENDING_PAYMENT',
        invoiceId: invoice.id,
      },
    })
    return { campaign, invoice }
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'CAMPAIGN_CREATED',
    targetType: 'CAMPAIGN',
    targetId: campaign.id,
    metadata: {
      refCode: campaign.refCode,
      package: pkg.code,
      vehicleId: vehicle.id,
      invoiceRef: invoice.refCode,
      amountMinor: invoice.amountMinor,
      orgId,
    },
  })

  await notifyOrgMembers(orgId, {
    type: 'CAMPAIGN_CREATED',
    title: 'Promotion created: complete payment to activate',
    body: `${pkg.name} for ${title} (${campaign.refCode}). Invoice ${invoice.refCode} is due ${dueDate.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}. Pay via M-Pesa to start the promotion.`,
    link: dashboardLink,
  })

  return ok(
    {
      campaign: {
        id: campaign.id,
        refCode: campaign.refCode,
        status: campaign.status,
        packageCode: campaign.packageCode,
      },
      invoice: {
        id: invoice.id,
        refCode: invoice.refCode,
        description: invoice.description,
        amountMinor: invoice.amountMinor,
        currency: invoice.currency,
        status: invoice.status,
        dueDate: invoice.dueDate,
      },
    },
    { status: 201 }
  )
})
