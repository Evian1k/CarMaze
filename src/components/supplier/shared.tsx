'use client'

/* SupplierOS shared module — types, permission mirror, fetch hook and small
 * UI atoms reused across every supplier tab. Server-side permissions live in
 * src/lib/supply.ts; this mirror only shapes the UI honestly (the API is the
 * single source of truth and re-checks every action). */

import { useCallback, useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Loader2, RefreshCw } from 'lucide-react'
import { apiGet, apiUpload } from '@/lib/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// ───────────────────────────── Types ─────────────────────────────

export type FetchError = { status: number; message: string }

export type Membership = {
  orgId: string
  role: string
  org: { id: string; name: string; type: string; status: string; county: string; town: string | null }
}

export type MePayload = { memberships: Membership[]; application: unknown | null }

export type ProductStockMini = { branchId: string; qtyOnHand: number; qtyReserved: number }

export type ProductItem = {
  id: string
  refCode: string
  supplierOrgId: string
  categoryId: string
  name: string
  sku: string
  mpn: string | null
  oemRef: string | null
  brand: string | null
  description: string
  condition: 'NEW' | 'REFURBISHED' | 'USED'
  unitPriceMinor: number
  wholesalePriceMinor: number | null
  wholesaleMinQty: number
  currency: string
  taxRatePct: number
  warrantyMonths: number
  returnable: boolean
  images: string[]
  tags: string[]
  vehicleMakes: string[]
  batchTracked: boolean
  serialTracked: boolean
  provenance: string | null
  authenticityVerified: boolean
  status: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'REJECTED'
  featured: boolean
  ratingAvg: number | null
  ratingCount: number
  createdAt: string
  updatedAt: string
  category: { slug: string; name: string }
  stocks: ProductStockMini[]
  _count?: { poItems: number; reviews: number }
}

export type ProductCategory = { slug: string; name: string; parentSlug: string | null; sortOrder: number }

export type CompatibilityRow = {
  id: string
  productId: string
  make: string
  model: string | null
  yearFrom: number | null
  yearTo: number | null
  engine: string | null
  trim: string | null
  chassis: string | null
  source: string
  verified: boolean
  note: string | null
}

export type OrderItemLine = {
  id: string
  productId: string
  name: string
  sku: string
  qty: number
  unitPriceMinor: number
  lineTotalMinor: number
  qtyAccepted: number | null
  note: string | null
  image: string | null
}

export type OrderListItem = {
  id: string
  refCode: string
  status: string
  paymentStatus: string
  inspectionStatus?: string | null
  garage: { id: string; name: string; county: string; verified: boolean }
  destinationBranch: { id: string; name: string; code: string; town: string } | null
  itemCount: number
  items: OrderItemLine[]
  totalMinor: number
  subtotalMinor: number
  deliveryFeeMinor: number
  taxMinor: number
  currency: string
  delivery: {
    id: string
    refCode: string
    method: string
    status: string
    scheduledFor: string | null
    otpHint: string | null
    windowLabel?: string | null
  } | null
  payment: { id: string; refCode: string; status: string; amountMinor: number; provider: string | null; protectedAt: string | null } | null
  disputeCount: number
  revisedBySupplier: boolean
  createdAt: string
  updatedAt: string
}

export type PoEvent = { id: string; type: string; actorName?: string | null; actorSide?: string | null; note?: string | null; createdAt: string }

export type OrderDetailItem = OrderItemLine & {
  mpn: string | null
  brand: string | null
  condition: string
  warrantyMonths: number
  returnable: boolean
  authenticityVerified: boolean
  fulfilBranchId: string | null
  qtyDelivered: number | null
}

export type OrderDetail = {
  side: string
  role: string
  order: {
    id: string
    refCode: string
    status: string
    paymentStatus: string
    inspectionStatus: string | null
    garage: { id: string; name: string; county: string; town: string; verified: boolean }
    destinationBranch: { id: string; name: string; code: string; address: string; town: string; county: string } | null
    items: OrderDetailItem[]
    revisions: { id: string; changes: unknown[]; newTotalMinor: number; note: string | null; status: string; createdAt: string }[]
    subtotalMinor: number
    deliveryFeeMinor: number
    taxMinor: number
    platformFeeMinor: number | null
    totalMinor: number
    acceptedTotalMinor: number | null
    currency: string
    supplierNote: string | null
    deliveryMethod: string | null
    delivery: {
      id: string
      refCode: string
      method: string
      status: string
      scheduledFor: string | null
      windowLabel: string | null
      courierName: string | null
      driverName: string | null
      driverPhone: string | null
      vehicleReg: string | null
      deliveryRef: string | null
      dispatchEvidence: string[]
      dispatchedAt: string | null
      expectedAt: string | null
      otpHint: string | null
      qrToken: string | null
      supplierBranch: { id: string; name: string; code: string; town: string; county: string } | null
      meetup: { lat?: number; lng?: number; address?: string } | null
      deliveredAt: string | null
      supplierConfirmAt: string | null
      garageConfirmAt: string | null
      events: PoEvent[]
    } | null
    payment: { id: string; refCode: string; status: string; amountMinor: number; provider: string | null; protectedAt: string | null } | null
    disputes: { id: string; refCode: string; reason: string; details: string; status: string; openedBySide: string; createdAt: string }[]
    events: PoEvent[]
    createdAt: string
    updatedAt: string
  }
}

export type QuoteRequestItem = {
  id: string
  refCode: string
  title: string
  description: string
  partNumber: string | null
  photoUrl: string | null
  vehicle: Record<string, unknown> | null
  budgetMinor: number | null
  deliveryCounty: string | null
  status: string
  garage: { id: string; name: string; county: string; verified: boolean } | null
  offerCount: number
  myOffer: { id: string; amountMinor: number; leadDays: number | null; note: string | null; status: string } | null
  createdAt: string
  expiresAt?: string | null
}

export type BranchItem = {
  id: string
  orgId: string
  name: string
  code: string
  kind: 'BRANCH' | 'WAREHOUSE'
  isPrimary: boolean
  address: string | null
  county: string
  town: string | null
  lat: number | null
  lng: number | null
  phone: string | null
  managerName: string | null
  status: string
  deliveryAreas: string[]
  _count?: { productStocks: number; vehicles: number }
}

export type InventoryRow = {
  id: string
  productId: string
  productName: string
  sku: string
  refCode: string
  unitPriceMinor: number
  branchId: string
  branchName: string
  branchCode: string
  branchKind: string
  qtyOnHand: number
  qtyReserved: number
  available: number
  reorderLevel: number
  low: boolean
}

export type SupplierProfile = {
  supplier: {
    id: string
    name: string
    verified: boolean
    county: string
    town: string | null
    description: string | null
    rating: number | null
    reviewCount: number
    productCount: number
    memberSince: string
  }
  branches: { id: string; name: string; kind: string; county: string; town: string }[]
  categories: { slug: string; name: string }[]
}

export type PlanItem = {
  code: string
  name: string
  audience: string
  priceMinor: number
  currency: string
  intervalMonths: number
  listingLimit: number
  featuredLimit: number
  staffLimit: number
  features: string[]
  active: boolean
}

export type InvoiceItem = {
  id: string
  refCode: string
  type: string
  description: string
  amountMinor: number
  currency: string
  status: string
  issuedAt: string
  dueDate?: string | null
  paidAt?: string | null
  payments?: { id: string; status: string; provider: string; createdAt: string }[]
  org?: { name: string; type: string }
}

// ───────────────────────────── Permission mirror (supplier side) ─────────────────────────────
// Mirrors src/lib/supply.ts for honest UI gating. The API enforces the real
// matrix on every request — disabling a button here is a courtesy, never the guard.

export type SupplierAction = 'catalogue.write' | 'stock.write' | 'order.respond' | 'delivery.arrange' | 'dispute.open' | 'finance.read'

const SUPPLIER_MATRIX: Record<SupplierAction, string[]> = {
  'catalogue.write': ['OWNER', 'OPERATIONS'],
  'stock.write': ['OWNER', 'OPERATIONS', 'WAREHOUSE'],
  'order.respond': ['OWNER', 'OPERATIONS', 'WAREHOUSE'],
  'delivery.arrange': ['OWNER', 'OPERATIONS', 'WAREHOUSE'],
  'dispute.open': ['OWNER', 'OPERATIONS'],
  'finance.read': ['OWNER', 'OPERATIONS', 'ACCOUNTANT'],
}

export function supplierRoleCan(role: string, action: SupplierAction): boolean {
  return SUPPLIER_MATRIX[action]?.includes(role) ?? false
}

// ───────────────────────────── Status maps ─────────────────────────────

export const PO_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Awaiting your response',
  AWAITING_APPROVAL: 'Awaiting garage approval',
  ACCEPTED: 'Accepted',
  REVISED: 'Revision proposed',
  REJECTED: 'Rejected',
  CONFIRMED: 'Confirmed',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  INSPECTED: 'Inspected',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  DISPUTED: 'Under dispute',
}

export const PO_BADGE_CLASS: Record<string, string> = {
  SUBMITTED: 'bg-accent/40 text-accent-foreground',
  AWAITING_APPROVAL: 'bg-muted text-muted-foreground',
  ACCEPTED: 'bg-primary/15 text-primary',
  REVISED: 'bg-accent/50 text-accent-foreground',
  REJECTED: 'bg-destructive/15 text-destructive',
  CONFIRMED: 'bg-primary/15 text-primary',
  DISPATCHED: 'bg-secondary text-secondary-foreground',
  IN_TRANSIT: 'bg-secondary text-secondary-foreground',
  DELIVERED: 'bg-primary text-primary-foreground',
  INSPECTED: 'bg-primary text-primary-foreground',
  COMPLETED: 'bg-primary text-primary-foreground',
  CANCELLED: 'bg-muted text-muted-foreground',
  DISPUTED: 'bg-destructive/15 text-destructive',
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Not paid',
  PENDING: 'Payment initiating',
  PROTECTED: 'Funds protected',
  RELEASED: 'Released to you',
  PARTIALLY_RELEASED: 'Partially released',
  REFUNDED: 'Refunded',
  FAILED: 'Failed',
}

export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  NONE: 'Not arranged',
  ARRANGING: 'Being arranged',
  AGREED: 'Agreed',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
}

export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  SUSPENDED: 'Suspended',
  REJECTED: 'Rejected',
}

export const PRODUCT_BADGE_CLASS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PUBLISHED: 'bg-primary text-primary-foreground',
  SUSPENDED: 'bg-destructive/15 text-destructive',
  REJECTED: 'bg-destructive/15 text-destructive',
}

export const OFFER_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Awaiting garage decision',
  ACCEPTED: 'Accepted by garage',
  DECLINED: 'Declined',
}

export const INVOICE_BADGE_CLASS: Record<string, string> = {
  PENDING: 'bg-accent/40 text-accent-foreground',
  PAID: 'bg-primary text-primary-foreground',
  OVERDUE: 'bg-destructive/15 text-destructive',
  CANCELLED: 'bg-muted text-muted-foreground',
  REFUNDED: 'bg-secondary text-secondary-foreground',
}

export const CONDITION_LABELS: Record<string, string> = {
  NEW: 'New',
  REFURBISHED: 'Refurbished',
  USED: 'Used / second-hand',
}

export const DISPUTE_REASONS = ['MISSING_ITEMS', 'DAMAGED', 'WRONG_ITEM', 'COUNTERFEIT', 'NOT_RECEIVED', 'OTHER'] as const

export const DISPUTE_REASON_LABELS: Record<string, string> = {
  MISSING_ITEMS: 'Missing items',
  DAMAGED: 'Damaged goods',
  WRONG_ITEM: 'Wrong item supplied',
  COUNTERFEIT: 'Suspected counterfeit',
  NOT_RECEIVED: 'Delivery not received',
  OTHER: 'Other issue',
}

/** Statuses where the order is still live (not closed/rejected/completed). */
export const OPEN_ORDER_STATUSES = ['SUBMITTED', 'ACCEPTED', 'REVISED', 'CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED']

// ───────────────────────────── Fetch hook ─────────────────────────────

export type FetchState<T> = { data: T | null; error: FetchError | null; loading: boolean; reload: () => void }

/** GET hook — all state updates happen in async callbacks (lint-safe). */
export function useFetch<T>(url: string | null): FetchState<T> {
  const [completed, setCompleted] = useState<{ key: string; data: T | null; error: FetchError | null } | null>(null)
  const [tick, setTick] = useState(0)
  const key = `${url ?? ''}|${tick}`

  useEffect(() => {
    if (!url) return
    let cancelled = false
    apiGet<T>(url)
      .then((d) => {
        if (!cancelled) setCompleted({ key, data: d, error: null })
      })
      .catch((e: { status?: number; message?: string }) => {
        if (!cancelled) {
          setCompleted({ key, data: null, error: { status: typeof e?.status === 'number' ? e.status : 0, message: e?.message ?? 'Request failed' } })
        }
      })
    return () => {
      cancelled = true
    }
  }, [url, tick, key])

  const loading = Boolean(url) && (!completed || completed.key !== key)
  const fresh = completed && url && completed.key.split('|')[0] === url ? completed : null
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data: fresh?.data ?? null, error: fresh && fresh.key === key ? fresh.error : null, loading, reload }
}

// ───────────────────────────── Helpers ─────────────────────────────

export function jsonParseSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** KES string → minor units, or null when not a valid amount. */
export function kesToMinor(s: string): number | null {
  const cleaned = s.replace(/[,\s]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/** Minor units → editable KES string. */
export function minorToKesInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return ''
  return String(minor / 100)
}

export function splitComma(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean)
}

export function availableAcrossStocks(stocks: ProductStockMini[]): number {
  return stocks.reduce((sum, s) => sum + Math.max(0, (s.qtyOnHand ?? 0) - (s.qtyReserved ?? 0)), 0)
}

export function uploadOne(file: File): Promise<{ url: string; name: string }> {
  const fd = new FormData()
  fd.append('file', file)
  return apiUpload<{ url: string; name: string }>('/api/upload', fd)
}

export async function errMessage(e: unknown, fallback: string): Promise<string> {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message || fallback
  }
  return fallback
}

// ───────────────────────────── UI atoms ─────────────────────────────

export function StatusBadge({ status, labels, classes }: { status: string; labels: Record<string, string>; classes: Record<string, string> | string }) {
  return (
    <Badge variant="secondary" className={cn('border-transparent font-medium', typeof classes === 'string' ? classes : (classes[status] ?? 'bg-muted text-muted-foreground'))}>
      {labels[status] ?? status}
    </Badge>
  )
}

export function StatCard({ label, value, icon, hint, onClick }: { label: string; value: string | number; icon: React.ReactNode; hint?: string; onClick?: () => void }) {
  return (
    <Card className={cn('py-4', onClick && 'cursor-pointer transition-colors hover:border-primary/40')} onClick={onClick} role={onClick ? 'button' : undefined}>
      <CardContent className="flex items-center gap-3 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold leading-tight">{value}</p>
          {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {label}
      </div>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

export function ModuleNotice({ title, detail, retry, loading }: { title: string; detail?: string; retry?: () => void; loading?: boolean }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <RefreshCw className={cn('h-6 w-6 text-muted-foreground', loading && 'animate-spin')} />
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="max-w-md text-xs text-muted-foreground">{detail}</p>}
        {retry && (
          <Button variant="outline" size="sm" className="mt-2" onClick={retry}>
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export function EmptyState({ icon, title, detail }: { icon: React.ReactNode; title: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      {detail && <p className="max-w-md text-xs text-muted-foreground">{detail}</p>}
    </div>
  )
}

/** Soft fade/rise for tab panels. */
export function FadeIn({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}

export function VerifiedMark({ verified, label }: { verified: boolean | null | undefined; label?: string }) {
  if (verified) {
    return (
      <Badge variant="secondary" className="gap-1 border-transparent bg-primary/10 text-primary">
        {label ?? 'Verified garage'}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground">
      {label ? `Not verified — ${label}` : 'Unverified garage'}
    </Badge>
  )
}
