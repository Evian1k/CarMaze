import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, ApiError, parseBody, requireRole } from '@/lib/api'
import { demoStaffMutationGuard } from '@/lib/demo'
import { audit } from '@/lib/audit'

/**
 * GET /api/admin/campaigns: all campaigns with org, vehicle, package and
 * linked invoice payment state (real impressions/clicks).
 */
export const GET = route(async () => {
  await requireRole('SUPPORT', 'REVIEWER', 'MODERATOR', 'FINANCE', 'ADMIN', 'FOUNDER')

  const [campaigns, packages] = await Promise.all([
    db.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        org: { select: { name: true, type: true } },
        vehicle: { select: { refCode: true, make: true, model: true, year: true, status: true } },
      },
    }),
    db.campaignPackage.findMany(),
  ])
  const pkgMap = new Map(packages.map((p) => [p.code, p]))
  const invoiceIds = campaigns.map((c) => c.invoiceId).filter((v): v is string => Boolean(v))
  const invoices = invoiceIds.length
    ? await db.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, refCode: true, status: true, amountMinor: true } })
    : []
  const invMap = new Map(invoices.map((i) => [i.id, i]))

  return ok({
    campaigns: campaigns.map((c) => {
      const pkg = pkgMap.get(c.packageCode)
      const inv = c.invoiceId ? invMap.get(c.invoiceId) : undefined
      return {
        id: c.id,
        refCode: c.refCode,
        org: c.org,
        vehicle: c.vehicle,
        packageCode: c.packageCode,
        packageName: pkg?.name ?? c.packageCode,
        packageDays: pkg?.days ?? null,
        packagePriceMinor: pkg?.priceMinor ?? null,
        status: c.status,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        impressions: c.impressions,
        clicks: c.clicks,
        createdAt: c.createdAt,
        invoice: inv ? { refCode: inv.refCode, status: inv.status, amountMinor: inv.amountMinor } : null,
      }
    }),
  })
})

const patchSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['activate', 'end', 'cancel']),
})

/**
 * PATCH /api/admin/campaigns: lifecycle control.
 * activate: ONLY allowed when the linked invoice is genuinely PAID (or none is
 * linked, which is rejected). A campaign is never activated on hope.
 */
export const PATCH = route(async (req: NextRequest) => {
  const user = await requireRole('SUPPORT', 'REVIEWER', 'MODERATOR', 'FINANCE', 'ADMIN', 'FOUNDER')
  const body = await parseBody(req, patchSchema)

  const campaign = await db.campaign.findUnique({ where: { id: body.id } })
  if (!campaign) throw new ApiError(404, 'NOT_FOUND', 'Campaign not found.')
  // DEMO SANDBOX: demo staff may only manage demo businesses' campaigns.
  await demoStaffMutationGuard(user, { subjectOrgId: campaign.orgId })

  switch (body.action) {
    case 'activate': {
      if (campaign.status !== 'PENDING_PAYMENT') {
        throw new ApiError(409, 'INVALID_STATE', `Only campaigns awaiting payment can be activated (current status: ${campaign.status}).`)
      }
      if (!campaign.invoiceId) {
        throw new ApiError(409, 'INVOICE_REQUIRED', 'No invoice is linked to this campaign. Payment must be recorded before activation.')
      }
      const invoice = await db.invoice.findUnique({ where: { id: campaign.invoiceId } })
      if (!invoice) throw new ApiError(409, 'INVOICE_REQUIRED', 'The linked invoice no longer exists: payment cannot be verified.')
      if (invoice.status !== 'PAID') {
        throw new ApiError(409, 'INVOICE_UNPAID', `Cannot activate: invoice ${invoice.refCode} is ${invoice.status}. Confirm payment first (mark-paid with a reconciliation note, or M-Pesa callback).`)
      }
      const pkg = await db.campaignPackage.findUnique({ where: { code: campaign.packageCode } })
      const days = pkg?.days ?? 7
      const now = new Date()
      const updated = await db.campaign.update({
        where: { id: campaign.id },
        data: { status: 'ACTIVE', startsAt: now, endsAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000) },
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'CAMPAIGN_ACTIVATED', targetType: 'CAMPAIGN', targetId: campaign.id, metadata: { ref: campaign.refCode, invoice: invoice.refCode } })
      return ok({ campaign: updated })
    }
    case 'end': {
      if (campaign.status !== 'ACTIVE') {
        throw new ApiError(409, 'INVALID_STATE', `Only active campaigns can be ended (current status: ${campaign.status}).`)
      }
      const updated = await db.campaign.update({ where: { id: campaign.id }, data: { status: 'ENDED', endsAt: new Date() } })
      await audit({ actorId: user.id, actorName: user.name, action: 'CAMPAIGN_ENDED', targetType: 'CAMPAIGN', targetId: campaign.id, metadata: { ref: campaign.refCode } })
      return ok({ campaign: updated })
    }
    case 'cancel': {
      if (campaign.status === 'ENDED' || campaign.status === 'CANCELLED') {
        throw new ApiError(409, 'INVALID_STATE', `Campaign is already ${campaign.status}.`)
      }
      const updated = await db.campaign.update({ where: { id: campaign.id }, data: { status: 'CANCELLED' } })
      await audit({ actorId: user.id, actorName: user.name, action: 'CAMPAIGN_CANCELLED', targetType: 'CAMPAIGN', targetId: campaign.id, metadata: { ref: campaign.refCode } })
      return ok({ campaign: updated })
    }
    default:
      throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown action.')
  }
})
