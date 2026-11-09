import { db } from '@/lib/db'
import { ApiError } from '@/lib/api'

/**
 * Central entitlement service (Phase 11).
 *
 * Every plan-based limit is resolved HERE — never ad-hoc in route handlers —
 * so the numbers always come from the seeded Plan rows (the real commercial
 * terms) rather than hardcoded per-endpoint guesses.
 *
 * Supplier plans encode their product/warehouse limits in the seeded
 * `features` strings ("Up to 50 products", "5 warehouses", "Unlimited …");
 * dealer/garage plans use the Plan columns (listingLimit/featuredLimit/
 * staffLimit). Anything unparseable falls back to the smallest documented
 * tier — a missing number must never silently grant unlimited capacity.
 *
 * Grace: an ACTIVE subscription stays fully entitled for 3 days past
 * currentPeriodEnd (renewal window); after that it is treated as PAST_DUE and
 * new paid features (featured slots, campaigns) are blocked while the base
 * limits keep protecting the platform.
 */

export type Entitlements = {
  planCode: string | null
  planName: string | null
  status: 'ACTIVE' | 'PAST_DUE' | 'NONE'
  periodEnd: string | null
  listingLimit: number | null // null = unlimited
  featuredLimit: number | null
  staffLimit: number | null
  productLimit: number | null
  warehouseLimit: number | null
}

const GRACE_MS = 3 * 24 * 60 * 60 * 1000

/** Audience defaults without any subscription (deny-by-default free tier). */
const DEFAULTS: Record<string, { listing: number | null; featured: number | null; staff: number | null; product: number | null; warehouse: number | null }> = {
  DEALER: { listing: 2, featured: 0, staff: 2, product: null, warehouse: null },
  GARAGE: { listing: 5, featured: 0, staff: 3, product: null, warehouse: null },
  SUPPLIER: { listing: null, featured: 0, staff: 2, product: 10, warehouse: 1 },
  LOGISTICS: { listing: null, featured: 0, staff: 2, product: null, warehouse: null },
}

function parseFeatures(features: string | null): string[] {
  if (!features) return []
  try {
    const parsed = JSON.parse(features)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function limitFromFeatures(featureList: string[], kind: 'products' | 'warehouses'): number | null | undefined {
  for (const f of featureList) {
    const lower = f.toLowerCase()
    if (!lower.includes(kind)) continue
    if (lower.includes('unlimited')) return null
    const m = /up to (\d+)/i.exec(f) ?? /(\d+)\s+(?:products|warehouses)/i.exec(f)
    if (m) return Math.max(0, parseInt(m[1], 10))
  }
  return undefined // not mentioned in features
}

export async function getEntitlements(orgId: string): Promise<Entitlements> {
  const org = await db.org.findUnique({ where: { id: orgId }, select: { type: true } })
  const fallback = DEFAULTS[org?.type ?? ''] ?? DEFAULTS.DEALER

  const sub = await db.subscription.findUnique({ where: { orgId } })
  if (!sub || sub.status !== 'ACTIVE') {
    return {
      planCode: null, planName: null,
      status: sub?.status === 'PAST_DUE' ? 'PAST_DUE' : 'NONE',
      periodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
      listingLimit: fallback.listing, featuredLimit: fallback.featured, staffLimit: fallback.staff,
      productLimit: fallback.product, warehouseLimit: fallback.warehouse,
    }
  }

  // Grace window: still ACTIVE for 3 days past the period end, then PAST_DUE.
  const pastDue = sub.currentPeriodEnd.getTime() + GRACE_MS < Date.now()

  const plan = await db.plan.findUnique({ where: { code: sub.planCode } })
  const featureList = parseFeatures(plan?.features ?? null)
  const productFromFeatures = limitFromFeatures(featureList, 'products')
  const warehouseFromFeatures = limitFromFeatures(featureList, 'warehouses')

  return {
    planCode: plan?.code ?? sub.planCode,
    planName: plan?.name ?? null,
    status: pastDue ? 'PAST_DUE' : 'ACTIVE',
    periodEnd: sub.currentPeriodEnd.toISOString(),
    listingLimit: plan?.listingLimit ?? fallback.listing,
    featuredLimit: pastDue ? 0 : (plan?.featuredLimit ?? fallback.featured),
    staffLimit: plan?.staffLimit ?? fallback.staff,
    productLimit: productFromFeatures !== undefined ? productFromFeatures : (plan?.listingLimit ?? fallback.product ?? 50),
    warehouseLimit: warehouseFromFeatures !== undefined ? warehouseFromFeatures : fallback.warehouse,
  }
}

/**
 * Enforce a limit at the API level. `current` is the count already used;
 * the entity being created must still fit. Throws 403 PLAN_LIMIT_REACHED
 * with a concrete upgrade message — never a silent success.
 */
export function assertWithinLimit(params: {
  current: number
  limit: number | null
  label: string
  planName: string | null
  upgradeLink: string
}): void {
  if (params.limit === null) return // unlimited
  if (params.current < params.limit) return
  throw new ApiError(
    403,
    'PLAN_LIMIT_REACHED',
    `${params.label} limit reached${params.planName ? ` on ${params.planName}` : ''} (${params.limit}). Archive items or upgrade your plan to add more.`,
    { limit: params.limit, upgradeLink: params.upgradeLink }
  )
}
