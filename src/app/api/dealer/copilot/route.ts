import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, ApiError, requireUser } from '@/lib/api'
import { money, dateLabel, timeAgo } from '@/lib/format'

type Severity = 'urgent' | 'warning' | 'info'

type Insight = {
  id: string
  severity: Severity
  title: string
  detail: string
  actionLink?: string
}

const SEVERITY_ORDER: Record<Severity, number> = { urgent: 0, warning: 1, info: 2 }
const HOUR = 3600 * 1000
const DAY = 24 * HOUR

/**
 * GET /api/dealer/copilot?orgId=
 * Dealer Copilot — deterministic, rule-based insights computed from REAL data.
 * No AI, no invented numbers: every insight carries actual counts, refCodes
 * and dates from live queries. Urgent insights are sorted first.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const requestedOrgId = new URL(req.url).searchParams.get('orgId')

  const memberships = await db.orgMember.findMany({
    where: { userId: user.id, org: { type: 'DEALER' } },
    orderBy: { createdAt: 'asc' },
    include: { org: { select: { id: true, name: true } } },
  })
  if (memberships.length === 0) {
    throw new ApiError(403, 'NO_DEALER_ORG', 'You are not a member of a dealership yet.')
  }
  const membership = requestedOrgId ? memberships.find((m) => m.orgId === requestedOrgId) : memberships[0]
  if (!membership) throw new ApiError(403, 'FORBIDDEN', 'You are not a member of that dealership.')
  const orgId = membership.orgId
  const now = Date.now()

  const [
    openEnquiries,
    draftVehicles,
    oldPublished,
    pendingOffers,
    subscription,
    pendingInvoices,
    openBuyingRequests,
    activeListingCount,
  ] = await Promise.all([
    db.enquiry.findMany({
      where: { vehicle: { orgId }, status: 'OPEN' },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        vehicle: { select: { make: true, model: true, year: true, refCode: true } },
      },
    }),
    db.vehicle.findMany({
      where: { orgId, status: 'DRAFT', createdAt: { lt: new Date(now - 7 * DAY) } },
      select: { make: true, model: true, year: true, refCode: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.vehicle.findMany({
      where: { orgId, status: 'PUBLISHED', createdAt: { lt: new Date(now - 45 * DAY) } },
      select: { make: true, model: true, year: true, refCode: true, _count: { select: { enquiries: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.offer.findMany({
      where: { orgId, status: 'PENDING' },
      include: { vehicle: { select: { make: true, model: true, year: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.subscription.findUnique({ where: { orgId } }),
    db.invoice.findMany({
      where: { orgId, status: { in: ['PENDING', 'OVERDUE'] } },
      orderBy: { issuedAt: 'asc' },
    }),
    db.buyingRequest.findMany({
      where: { orgId, status: 'OPEN', createdAt: { lt: new Date(now - 30 * DAY) } },
      orderBy: { createdAt: 'asc' },
    }),
    db.vehicle.count({ where: { orgId, status: { in: ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'RESERVED'] } } }),
  ])

  const plan = subscription ? await db.plan.findUnique({ where: { code: subscription.planCode } }) : null

  const insights: Insight[] = []

  // 1) Enquiries OPEN >24h with no seller reply → urgent; awaiting first reply → info.
  const awaiting = openEnquiries.filter((e) => {
    const last = e.messages[e.messages.length - 1]
    return !last || last.senderSide !== 'SELLER'
  })
  const overdueEnquiries = awaiting.filter((e) => {
    const last = e.messages[e.messages.length - 1]
    return now - (last ? last.createdAt : e.createdAt).getTime() > 24 * HOUR
  })
  if (overdueEnquiries.length > 0) {
    const refs = overdueEnquiries
      .slice(0, 3)
      .map((e) => {
        const last = e.messages[e.messages.length - 1]
        const waitedSince = last ? last.createdAt : e.createdAt
        return `${e.refCode} (${e.vehicle.make} ${e.vehicle.model} ${e.vehicle.year} — waiting since ${timeAgo(waitedSince)})`
      })
      .join(', ')
    insights.push({
      id: 'enquiries-urgent',
      severity: 'urgent',
      title: `${overdueEnquiries.length} ${overdueEnquiries.length === 1 ? 'enquiry' : 'enquiries'} awaiting response`,
      detail: `${refs} — unanswered for over 24 hours. Response speed is the strongest driver of conversion.`,
      actionLink: '/dealer?tab=enquiries',
    })
  } else if (awaiting.length > 0) {
    const refs = awaiting.slice(0, 3).map((e) => `${e.refCode} (${e.vehicle.make} ${e.vehicle.model})`).join(', ')
    insights.push({
      id: 'enquiries-info',
      severity: 'info',
      title: `${awaiting.length} ${awaiting.length === 1 ? 'enquiry' : 'enquiries'} awaiting your response`,
      detail: `${refs}. Aim to reply within 24 business hours to keep your response SLA.`,
      actionLink: '/dealer?tab=enquiries',
    })
  }

  // 2) Drafts older than 7 days.
  if (draftVehicles.length > 0) {
    const refs = draftVehicles.slice(0, 3).map((v) => `${v.refCode} (${v.make} ${v.model} ${v.year})`).join(', ')
    insights.push({
      id: 'drafts-stale',
      severity: 'warning',
      title: `${draftVehicles.length} ${draftVehicles.length === 1 ? 'draft' : 'drafts'} never submitted`,
      detail: `${refs} — ${draftVehicles.length === 1 ? 'it has' : 'they have'} been sitting as draft${draftVehicles.length === 1 ? '' : 's'} for over 7 days. Complete and submit ${draftVehicles.length === 1 ? 'it' : 'them'} for review to start earning views.`,
      actionLink: '/dealer?tab=inventory',
    })
  }

  // 3) Published >45 days with zero enquiries.
  const stalePublished = oldPublished.filter((v) => v._count.enquiries === 0)
  if (stalePublished.length > 0) {
    const refs = stalePublished.slice(0, 3).map((v) => `${v.refCode} (${v.make} ${v.model} ${v.year})`).join(', ')
    insights.push({
      id: 'listings-stale',
      severity: 'info',
      title: `${stalePublished.length} stale ${stalePublished.length === 1 ? 'listing' : 'listings'} — consider refreshing or a promotion`,
      detail: `${refs} — live for over 45 days without a single enquiry. Fresh photos, a price adjustment or a Spotlight campaign can revive interest.`,
      actionLink: '/dealer?tab=inventory',
    })
  }

  // 4) Offers sent that are still PENDING on the seller side.
  if (pendingOffers.length > 0) {
    const refs = pendingOffers
      .slice(0, 3)
      .map((o) => `${money(o.amountMinor)} on ${o.vehicle.make} ${o.vehicle.model} ${o.vehicle.year}${o.expiresAt ? ` (expires ${dateLabel(o.expiresAt)})` : ''}`)
      .join(', ')
    insights.push({
      id: 'offers-pending',
      severity: 'info',
      title: `${pendingOffers.length} ${pendingOffers.length === 1 ? 'offer' : 'offers'} awaiting seller response`,
      detail: `Sent offers still pending: ${refs}.`,
      actionLink: '/dealer?tab=offers',
    })
  }

  // 5) Subscription renewal window / past due + overdue invoices.
  if (subscription && subscription.status === 'ACTIVE') {
    const msLeft = subscription.currentPeriodEnd.getTime() - now
    if (msLeft > 0 && msLeft <= 5 * DAY) {
      insights.push({
        id: 'subscription-renewal',
        severity: 'warning',
        title: `Subscription renews ${dateLabel(subscription.currentPeriodEnd)}`,
        detail: `Your ${plan?.name ?? subscription.planCode} subscription renews on ${dateLabel(subscription.currentPeriodEnd)}. Ensure your M-Pesa line is reachable to avoid interruption.`,
        actionLink: '/dealer?tab=billing',
      })
    }
  } else if (subscription && subscription.status === 'PAST_DUE') {
    insights.push({
      id: 'subscription-past-due',
      severity: 'warning',
      title: 'Subscription is past due',
      detail: `Your ${plan?.name ?? subscription.planCode} subscription is past due (period ended ${dateLabel(subscription.currentPeriodEnd)}). Settle the outstanding invoice to keep your listings active.`,
      actionLink: '/dealer?tab=billing',
    })
  }

  const now7dAgo = now - 7 * DAY
  const overdueInvoices = pendingInvoices.filter(
    (inv) => inv.status === 'OVERDUE' || inv.issuedAt.getTime() < now7dAgo
  )
  if (overdueInvoices.length > 0) {
    const oldest = overdueInvoices[0]
    insights.push({
      id: 'invoice-overdue',
      severity: 'urgent',
      title: `Invoice ${oldest.refCode} overdue`,
      detail: `${overdueInvoices.length === 1 ? 'Invoice' : `${overdueInvoices.length} invoices, oldest`} pending since ${dateLabel(oldest.issuedAt)} — ${money(oldest.amountMinor, oldest.currency)}. Pay via M-Pesa to avoid service interruption.`,
      actionLink: '/dealer?tab=billing',
    })
  }

  // 6) Buying requests open >30 days.
  if (openBuyingRequests.length > 0) {
    const makes = openBuyingRequests.slice(0, 3).map((r) => `${r.make}${r.model ? ` ${r.model}` : ''}`).join(', ')
    insights.push({
      id: 'buying-requests-stale',
      severity: 'info',
      title: `${openBuyingRequests.length} buying ${openBuyingRequests.length === 1 ? 'request' : 'requests'} stale — close or refresh them`,
      detail: `Open for over 30 days: ${makes}. Close fulfilled requests so the dealer board reflects current demand.`,
      actionLink: '/dealer?tab=buying',
    })
  }

  // 7) Listing limit reached.
  if (plan && activeListingCount >= plan.listingLimit) {
    insights.push({
      id: 'listing-limit',
      severity: 'urgent',
      title: 'Listing limit reached — upgrade',
      detail: `${activeListingCount} of ${plan.listingLimit} active listings used on ${plan.name}. Archive a listing or upgrade your plan to list more vehicles.`,
      actionLink: '/dealer?tab=billing',
    })
  }

  insights.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  if (insights.length === 0) {
    insights.push({
      id: 'all-clear',
      severity: 'info',
      title: 'All clear — no pending follow-ups',
      detail: 'Enquiries answered, listings fresh, invoices settled. Check back after new customer activity.',
    })
  }

  return ok({ insights, generatedAt: new Date().toISOString() })
})
