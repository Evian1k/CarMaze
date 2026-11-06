import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'
import { notifyOrgMembers } from '@/lib/orgs'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/campaigns/[id]/cancel: OWNER/MANAGER of the promotion's org only.
 * Only PENDING_PAYMENT campaigns can be cancelled (an ACTIVE campaign is paid
 * for and running; a CANCELLED/ENDED one is already closed → 409).
 *
 * Transaction: campaign → CANCELLED and the linked invoice → CANCELLED while
 * it is still unpaid. If the invoice were already PAID the campaign could not
 * have been PENDING_PAYMENT, so an invoice is never orphaned as paid here.
 */
export const POST = route(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params

  const campaign = await db.campaign.findUnique({
    where: { id },
    select: {
      id: true,
      refCode: true,
      orgId: true,
      status: true,
      invoiceId: true,
      vehicle: { select: { make: true, model: true, year: true } },
    },
  })
  if (!campaign) throw new ApiError(404, 'NOT_FOUND', 'Promotion not found.')

  const membership = await db.orgMember.findFirst({
    where: { orgId: campaign.orgId, userId: user.id, role: { in: ['OWNER', 'MANAGER'] } },
    select: { id: true },
  })
  if (!membership) {
    return fail(403, 'FORBIDDEN', 'Only the owner or a manager of the organisation can cancel a promotion.')
  }

  if (campaign.status !== 'PENDING_PAYMENT') {
    const label =
      campaign.status === 'ACTIVE' ? 'already running'
      : campaign.status === 'ENDED' ? 'already ended'
      : 'already cancelled'
    return fail(409, 'INVALID_STATE', `This promotion is ${label} and can no longer be cancelled.`)
  }

  const title = `${campaign.vehicle.make} ${campaign.vehicle.model} ${campaign.vehicle.year}`

  const { invoiceRef } = await db.$transaction(async (tx) => {
    await tx.campaign.update({ where: { id: campaign.id }, data: { status: 'CANCELLED' } })
    if (campaign.invoiceId) {
      const invoice = await tx.invoice.findUnique({
        where: { id: campaign.invoiceId },
        select: { id: true, refCode: true, status: true },
      })
      if (invoice && invoice.status === 'PENDING') {
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED' } })
        return { invoiceRef: invoice.refCode }
      }
    }
    return { invoiceRef: null as string | null }
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'CAMPAIGN_CANCELLED',
    targetType: 'CAMPAIGN',
    targetId: campaign.id,
    metadata: { refCode: campaign.refCode, orgId: campaign.orgId, cancelledInvoice: invoiceRef },
  })

  await notifyOrgMembers(campaign.orgId, {
    type: 'CAMPAIGN_CANCELLED',
    title: 'Promotion cancelled',
    body: `${title} (${campaign.refCode}) was cancelled before payment${invoiceRef ? `: invoice ${invoiceRef} is now cancelled` : ''}.`,
    link: '/dealer?tab=billing',
  })

  return ok({ campaign: { id: campaign.id, refCode: campaign.refCode, status: 'CANCELLED' }, cancelledInvoice: invoiceRef })
})
