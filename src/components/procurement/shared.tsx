'use client'

/* Procurement portal shared primitives: API response types, role gates,
 * status chips, qty steppers and small widgets used across the
 * procurement tabs. Semantic tokens only; dark-mode-first. */

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Minus, Plus, Package, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiUpload } from '@/lib/client'
import { dateLabel, timeAgo } from '@/lib/format'

// ─────────────────────────── API types (mirror route responses) ───────────────────────────

export type GarageRole =
  | 'OWNER' | 'GM' | 'BRANCH_MANAGER' | 'PROCUREMENT' | 'MECHANIC' | 'ACCOUNTANT' | 'INVENTORY'

export type Membership = {
  orgId: string
  role: string
  createdAt: string
  org: { id: string; name: string; type: string; status: string; county: string; town: string | null }
}

export type SupplierBrief = {
  id: string
  name: string
  county: string
  town?: string | null
  verified: boolean
  supplierRating?: number | null
  rating?: number | null
}

export type CatalogueProduct = {
  id: string
  refCode: string
  name: string
  sku: string
  mpn: string | null
  brand: string | null
  condition: string
  unitPriceMinor: number
  wholesalePriceMinor: number | null
  wholesaleMinQty: number
  currency: string
  image: string | null
  tags: string[]
  category: { slug: string; name: string }
  supplier: { id: string; name: string; county: string; town: string | null; verified: boolean; rating: number | null; logoUrl: string | null }
  authenticityVerified: boolean
  featured: boolean
  ratingAvg: number | null
  ratingCount: number
  availableQty: number
  inStock: boolean
  createdAt: string
}

export type CategoryRow = { slug: string; name: string; parentSlug: string | null; sortOrder: number }

export type BranchRow = {
  id: string
  name: string
  code: string
  kind: string
  address: string | null
  county: string
  town: string | null
  isPrimary: boolean
  status: string
}

export type OrderListItem = {
  id: string
  refCode: string
  status: string
  paymentStatus: string
  inspectionStatus: string | null
  garage: { id: string; name: string; county: string; verified: boolean }
  supplier: SupplierBrief
  destinationBranch: { id: string; name: string; code: string; town: string | null } | null
  itemCount: number
  items: { id: string; productId: string; name: string; sku: string; qty: number; unitPriceMinor: number; lineTotalMinor: number; qtyAccepted: number | null; note: string | null; image: string | null }[]
  totalMinor: number
  subtotalMinor: number
  deliveryFeeMinor: number
  taxMinor: number
  platformFeeMinor: number
  currency: string
  delivery: { id: string; refCode: string; method: string; status: string; scheduledFor: string | null; otpHint: string | null; meetupJson: string | null } | null
  payment: { id: string; refCode: string; status: string; amountMinor: number; provider: string; protectedAt: string | null } | null
  disputeCount: number
  revisedBySupplier: boolean
  createdAt: string
  updatedAt: string
}

export type OrdersResponse = { side: string; orders: OrderListItem[] }

export type DeliveryEventRow = {
  id: string; type: string; actorId: string | null; actorName: string; actorSide: string; note: string | null; createdAt: string
}

export type OrderDetailData = {
  id: string
  refCode: string
  status: string
  paymentStatus: string
  inspectionStatus: string | null
  garage: { id: string; name: string; county: string; town: string | null; verified: boolean }
  supplier: SupplierBrief & { phone: string | null; email: string | null }
  destinationBranch: { id: string; name: string; code: string; address: string | null; town: string | null; county: string | null; lat: number | null; lng: number | null } | null
  items: {
    id: string; productId: string; name: string; sku: string; mpn: string | null; brand: string | null
    condition: string; image: string | null; warrantyMonths: number; returnable: boolean
    authenticityVerified: boolean; qty: number; unitPriceMinor: number; lineTotalMinor: number
    fulfilBranchId: string | null; qtyDelivered: number | null; qtyAccepted: number | null; note: string | null
  }[]
  revisions: { id: string; changes: unknown[]; newTotalMinor: number; note: string | null; status: string; createdAt: string }[]
  subtotalMinor: number
  deliveryFeeMinor: number
  taxMinor: number
  platformFeeMinor: number
  totalMinor: number
  acceptedTotalMinor: number | null
  currency: string
  supplierNote: string | null
  deliveryMethod: string | null
  delivery: {
    id: string; refCode: string; method: string; status: string
    supplierBranch: { id: string; name: string; code: string; address: string | null; town: string | null; county: string | null; lat: number | null; lng: number | null } | null
    meetup: { lat?: number; lng?: number; address?: string } | null
    meetupAgreedByGarage: boolean
    meetupAgreedBySupplier: boolean
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
    deliveredAt: string | null
    handover: Record<string, unknown> | null
    garageConfirmAt: string | null
    supplierConfirmAt: string | null
    failedReason: string | null
    feeMinor: number
    events: DeliveryEventRow[]
  } | null
  payment: {
    id: string; refCode: string; provider: string; status: string; amountMinor: number; currency: string
    checkoutRef: string | null; phone: string | null; resultDesc: string | null
    protectedAt: string | null; releasedAmountMinor: number; refundedAmountMinor: number; releasedAt: string | null; createdAt: string
  } | null
  refunds: { id: string; refCode: string; amountMinor: number; kind: string; reason: string; status: string; createdAt: string }[]
  disputes: {
    id: string; refCode: string; reason: string; details: string; status: string
    amountFrozenMinor: number | null; resolution: string | null; resolutionNote: string | null; createdAt: string
    evidence: unknown[]; events: { id: string; type: string; actorName: string; note: string | null; createdAt: string }[]
  }[]
  events: { id: string; type: string; actorId: string | null; actorName: string; actorSide: string; note: string | null; createdAt: string }[]
  createdAt: string
  updatedAt: string
}

export type OrderDetailResponse = { side: string; role: string; order: OrderDetailData }

export type QuoteOfferRow = {
  id: string
  requestId: string
  supplierOrgId: string
  supplier: { id: string; name: string; county: string; verified: boolean; supplierRating: number | null }
  amountMinor: number
  leadDays: number | null
  note: string | null
  items: { name?: string; partNumber?: string; qty?: number; unitPriceMinor?: number }[]
  status: string
  createdAt: string
}

export type QuoteRequestRow = {
  id: string
  refCode: string
  title: string
  description: string
  partNumber: string | null
  photoUrl: string | null
  vehicle: { make?: string; model?: string; year?: number; engine?: string; trim?: string } | null
  budgetMinor: number | null
  deliveryCounty: string | null
  status: string
  createdAt: string
  offers: QuoteOfferRow[]
}

export type StockAlertRow = {
  id: string
  minQty: number
  active: boolean
  product: {
    id: string; name: string; sku: string; unitPriceMinor: number; currency: string
    availableQty: number; image: string | null
    supplier: { id: string; name: string; verified: boolean }
  }
}

export type FitmentResult = {
  id: string
  refCode: string
  name: string
  sku: string
  brand: string | null
  condition: string
  unitPriceMinor: number
  wholesalePriceMinor: number | null
  currency: string
  image: string | null
  category: { slug: string; name: string }
  supplier: { id: string; name: string; county: string; town: string | null; verified: boolean; supplierRating: number | null }
  fit: 'MATCH' | 'POSSIBLE' | 'NO_FITMENT'
  fitRecords: { make: string; model: string | null; yearFrom: number | null; yearTo: number | null; engine: string | null; verified: boolean }[]
  availableQty: number
}

// ─────────────────────────── Role gates (UI mirrors server MATRIX) ───────────────────────────

export const canApprove = (role: string) => role === 'OWNER' || role === 'GM'
export const canOrder = (role: string) => canApprove(role) || role === 'PROCUREMENT'
export const canPay = (role: string) => canOrder(role) || role === 'ACCOUNTANT'
export const canDispute = (role: string) => canOrder(role)
export const isApprovalsVisible = canApprove

/** KES major-unit input → integer minor units (×100). Null when invalid. */
export function kesToMinor(input: string): number | null {
  const v = input.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null
  const minor = Math.round(parseFloat(v) * 100)
  return Number.isFinite(minor) && minor > 0 ? minor : null
}

/** POST /api/upload (FormData "file") → public media URL. */
export async function uploadOne(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await apiUpload<{ url: string; name: string }>('/api/upload', fd)
  return res.url
}

// ─────────────────────────── Status metadata ───────────────────────────

const STATUS_TONES: Record<string, string> = {
  AWAITING_APPROVAL: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  SUBMITTED: 'border-border bg-muted text-muted-foreground',
  ACCEPTED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  REVISED: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  REJECTED: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  CONFIRMED: 'border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400',
  DISPATCHED: 'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  IN_TRANSIT: 'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  DELIVERED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  INSPECTED: 'border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400',
  COMPLETED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
  DISPUTED: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
}

export const PO_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Submitted',
  AWAITING_APPROVAL: 'Awaiting approval',
  ACCEPTED: 'Accepted',
  REVISED: 'Revised',
  REJECTED: 'Rejected',
  CONFIRMED: 'Confirmed',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  INSPECTED: 'Inspected',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  DISPUTED: 'Disputed',
}

export function StatusChip({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap', STATUS_TONES[status], className)}>
      {PO_STATUS_LABELS[status] ?? status.replaceAll('_', ' ')}
    </Badge>
  )
}

const PAYMENT_TONES: Record<string, string> = {
  UNPAID: 'border-border bg-muted text-muted-foreground',
  PENDING: 'border-border bg-muted text-muted-foreground',
  PROCESSING: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  PROTECTED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  RELEASED: 'border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400',
  PARTIALLY_RELEASED: 'border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400',
  REFUNDED: 'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  FAILED: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
}

const PAYMENT_LABELS: Record<string, string> = {
  UNPAID: 'Unpaid', PENDING: 'Payment pending', PROCESSING: 'Payment processing',
  PROTECTED: 'Funds protected', RELEASED: 'Released to supplier',
  PARTIALLY_RELEASED: 'Partially released', REFUNDED: 'Refunded', FAILED: 'Payment failed', CANCELLED: 'Cancelled',
}

export function PaymentChip({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap', PAYMENT_TONES[status], className)}>
      {PAYMENT_LABELS[status] ?? status.replaceAll('_', ' ')}
    </Badge>
  )
}

/** Actor-side badge for timeline entries. */
export function SideChip({ side }: { side: string }) {
  const tone =
    side === 'GARAGE'
      ? 'border-primary/40 bg-primary/10 text-primary'
      : side === 'SUPPLIER'
        ? 'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400'
        : 'border-border bg-muted text-muted-foreground'
  return (
    <Badge variant="outline" className={cn('text-[10px] uppercase tracking-wide', tone)}>
      {side === 'SYSTEM' || side === 'ADMIN' ? 'System' : side}
    </Badge>
  )
}

export const FIT_STYLES: Record<string, { chip: string; label: string }> = {
  MATCH: { chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', label: 'Verified fit' },
  POSSIBLE: { chip: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400', label: 'Possible fit' },
  NO_FITMENT: { chip: 'border-border bg-muted text-muted-foreground', label: 'No fitment data' },
}

export const REQUEST_STATUS_TONES: Record<string, string> = {
  OPEN: 'border-border bg-muted text-muted-foreground',
  QUOTING: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  CLOSED: 'border-border bg-muted text-muted-foreground',
  PENDING: 'border-border bg-muted text-muted-foreground',
  ACCEPTED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  DECLINED: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
}

// ─────────────────────────── Widgets ───────────────────────────

/** Image with graceful fallback (never breaks the layout on dead URLs). */
export function Img({ src, alt, className }: { src?: string | null; alt: string; className?: string }) {
  const [err, setErr] = useState(false)
  if (!src || err) {
    return (
      <div className={cn('flex items-center justify-center bg-muted text-muted-foreground', className)} role="img" aria-label={alt}>
        <Package className="h-5 w-5" aria-hidden="true" />
      </div>
    )
  }
  return (
    <img src={src} alt={alt} loading="lazy" onError={() => setErr(true)} className={cn('object-cover', className)} />
  )
}

/** Compact quantity stepper used on product cards, cart lines and inspection. */
export function QtyStepper({ value, onChange, min = 1, max = 999_999, disabled }: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  disabled?: boolean
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v) || min))
  return (
    <div className={cn('inline-flex h-8 items-center rounded-md border border-border bg-background', disabled && 'opacity-50')} aria-label="Quantity">
      <Button
        type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-r-none" disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1))} aria-label="Decrease quantity"
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <Input
        type="number" inputMode="numeric" value={value} disabled={disabled}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="h-8 w-12 rounded-none border-0 border-x border-border bg-transparent px-1 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        aria-label="Quantity"
      />
      <Button
        type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-l-none" disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + 1))} aria-label="Increase quantity"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export function StatCard({ icon: Icon, label, value, sub, onClick, accent }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  onClick?: () => void
  accent?: boolean
}) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'flex w-full flex-col gap-1 rounded-xl border border-border bg-card p-4 text-left transition-colors',
        onClick && 'hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className={cn('h-3.5 w-3.5', accent ? 'text-primary' : '')} aria-hidden="true" />
        {label}
      </span>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </Wrapper>
  )
}

export function EmptyState({ icon: Icon, title, description, children }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {children ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
    </div>
  )
}

/** Skeleton grid used while catalogue/orders load. */
export function CardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4">
          <div className="h-32 w-full animate-pulse rounded-lg bg-muted" />
          <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-muted" />
          <div className="mt-4 h-8 w-full animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

/** Local date + time for event timestamps. */
export function dateTimeLabel(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return `${dateLabel(date)} · ${date.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}`
}

/** Relative time with absolute label on the title attribute. */
export function When({ at }: { at: string | Date }) {
  return <span title={dateTimeLabel(at)}>{timeAgo(at)}</span>
}

/** Busy spinner used inside buttons while a lifecycle action is in flight. */
export function BtnSpinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} aria-hidden="true" />
}

// ─────────────────────────── Order lifecycle model ───────────────────────────

export const STEPS = ['Order placed', 'Supplier accepted', 'Confirmed', 'Dispatched', 'Delivered', 'Inspected', 'Completed'] as const

export function stepIndex(status: string): number {
  switch (status) {
    case 'SUBMITTED':
    case 'AWAITING_APPROVAL': return 0
    case 'ACCEPTED':
    case 'REVISED': return 1
    case 'CONFIRMED': return 2
    case 'DISPATCHED':
    case 'IN_TRANSIT': return 3
    case 'DELIVERED': return 4
    case 'INSPECTED': return 5
    case 'COMPLETED': return 6
    default: return -1 // REJECTED | CANCELLED | DISPUTED
  }
}

/** Source states the backend accepts for cancel (garage, pre-dispatch). */
export const CANCELABLE = ['SUBMITTED', 'AWAITING_APPROVAL', 'ACCEPTED', 'REVISED', 'CONFIRMED']
/** Source states the backend accepts for delivery arrangement. */
export const ARRANGEABLE = ['ACCEPTED', 'CONFIRMED', 'REVISED']

/** Poll payload of GET /api/supply/orders/[id]/pay. */
export type PayStatus = {
  payment: { refCode: string; status: string; provider: string; amountMinor: number; phone?: string | null; resultDesc?: string | null } | null
  mpesaConfigured: boolean
  estimatedCommissionMinor: number
}

/** Label/value row used in cost breakdowns and payment panels. */
export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={cn('text-muted-foreground', strong && 'font-semibold text-foreground')}>{label}</span>
      <span className={cn('tabular-nums', strong ? 'font-bold' : 'text-foreground')}>{value}</span>
    </div>
  )
}
