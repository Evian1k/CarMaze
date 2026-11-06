'use client'

/* CARMAZE: Automotive Supply Network shared bits.
 * Types mirror the real API routes exactly (verified against the handlers):
 *  - /api/supply/catalogue          → supplier.rating
 *  - /api/supply/fitment            → supplier.supplierRating
 *  - /api/supply/products/[id]      → supplier.supplierRating
 *  - /api/suppliers, /api/suppliers/[id]
 * Presentational helpers: stars, verified badge (never faked), supplier
 * avatar with initials fallback, fitment verdict badges, debounce hook.
 */

import { useEffect, useState } from 'react'
import { ShieldCheck, BadgeCheck, Star, PackageCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// ───────────────────────────────── API types ─────────────────────────────────

export type CategoryRow = { slug: string; name: string; parentSlug: string | null; sortOrder: number }

export type CatalogueSupplier = {
  id: string
  name: string
  county: string
  town: string | null
  verified: boolean
  rating: number | null
  logoUrl: string | null
}

/** Shape returned by GET /api/supply/catalogue (also used for storefront grids). */
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
  category: { slug: string; name: string } | null
  supplier: CatalogueSupplier
  authenticityVerified: boolean
  featured: boolean
  ratingAvg: number | null
  ratingCount: number
  availableQty: number
  inStock: boolean
  createdAt?: string
}

export type CatalogueResponse = {
  total: number
  page: number
  pageSize: number
  products: CatalogueProduct[]
}

/** Shape returned by GET /api/suppliers (public verified directory). */
export type SupplierListItem = {
  id: string
  name: string
  county: string
  town: string | null
  location: string | null
  description: string | null
  logoUrl: string | null
  coverUrl: string | null
  verified: boolean
  rating: number | null
  specialities: string[]
  productCount: number
  branchCount: number
  reviewCount: number
  memberSince: string
}

export type SuppliersResponse = {
  total: number
  page: number
  pageSize: number
  suppliers: SupplierListItem[]
}

export type FitVerdict = 'MATCH' | 'POSSIBLE' | 'NO_FITMENT'

export type FitmentRecord = {
  make: string
  model: string | null
  yearFrom: number | null
  yearTo: number | null
  engine: string | null
  verified: boolean
}

/** Shape returned by GET /api/supply/fitment: note supplierRating field name. */
export type FitmentProduct = {
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
  category: { slug: string; name: string } | null
  supplier: {
    id: string
    name: string
    county: string
    town: string | null
    verified: boolean
    supplierRating: number | null
  }
  fit: FitVerdict
  fitRecords: FitmentRecord[]
  availableQty: number
}

export type FitmentResponse = {
  products: FitmentProduct[]
  summary?: { matches: number; note: string }
  message?: string
}

// ─────────────────────────────── Small helpers ───────────────────────────────

/** Debounce any value (used for search inputs before hitting the API). */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export const SUPPLY_CONDITION_LABELS: Record<string, string> = {
  NEW: 'New',
  REFURBISHED: 'Refurbished',
  USED: 'Used',
}

export const PRICE_REASON_LABELS: Record<string, string> = {
  LIST: 'Listed',
  UPDATE: 'Price update',
  PROMO: 'Promotion',
}

/** Normalise any supplier shape into the fields ProductCard needs. */
export function toCardSupplier(
  s: { id: string; name: string; county: string; town: string | null; verified: boolean; logoUrl?: string | null },
  rating: number | null
): CatalogueSupplier {
  return { ...s, rating, logoUrl: s.logoUrl ?? null }
}

// ───────────────────────────── Presentational bits ────────────────────────────

/** Gold rating stars: honest: renders nothing when there are no ratings. */
export function Stars({ avg, className, size = 'sm' }: { avg: number; className?: string; size?: 'sm' | 'md' }) {
  if (!avg || avg <= 0) return null
  const rounded = Math.round(avg)
  return (
    <span className={cn('flex items-center', className)} role="img" aria-label={`Rated ${avg.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4',
            i <= rounded ? 'fill-gold text-gold' : 'text-muted-foreground/40'
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}

/**
 * Verified badge: renders ONLY when the supplier is actually verified.
 * An unverified supplier must never display a shield.
 */
export function VerifiedBadge({ verified, className }: { verified: boolean; className?: string }) {
  if (!verified) return null
  return (
    <Badge variant="outline" className={cn('gap-1 border-primary/40 text-primary', className)}>
      <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Verified supplier
    </Badge>
  )
}

/** Compact inline verified tick for tight spaces (product cards, rows). */
export function VerifiedTick({ verified, name }: { verified: boolean; name: string }) {
  if (!verified) return null
  return (
    <span className="inline-flex items-center gap-0.5 text-primary" title={`${name} is a verified supplier`}>
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">Verified supplier</span>
    </span>
  )
}

/** Supplier logo with initials fallback: resilient to broken image URLs. */
export function SupplierAvatar({
  name,
  logoUrl,
  className,
  textClassName,
}: {
  name: string
  logoUrl?: string | null
  className?: string
  textClassName?: string
}) {
  const [broken, setBroken] = useState(false)
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-brand-deep text-brand-deep-foreground',
        className ?? 'h-11 w-11'
      )}
      aria-hidden="true"
    >
      {logoUrl && !broken ? (
        <img
          src={logoUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className={cn('font-bold tracking-tight', textClassName ?? 'text-sm')}>{initials || 'CS'}</span>
      )}
    </span>
  )
}

/** Honest fitment verdict badges: wording never overstates the data. */
export function FitBadge({ fit, className }: { fit: FitVerdict; className?: string }) {
  if (fit === 'MATCH') {
    return (
      <Badge className={cn('gap-1 bg-primary text-primary-foreground', className)}>
        <BadgeCheck className="h-3 w-3" aria-hidden="true" /> Fits your vehicle
      </Badge>
    )
  }
  if (fit === 'POSSIBLE') {
    return (
      <Badge className={cn('gap-1 bg-gold text-gold-foreground', className)}>
        <PackageCheck className="h-3 w-3" aria-hidden="true" /> Possible fit
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className={cn('gap-1 text-muted-foreground', className)}>
      No fitment record
    </Badge>
  )
}

export function FitHint({ fit, make, model }: { fit: FitVerdict; make: string; model?: string }) {
  if (fit === 'MATCH') {
    return (
      <p className="text-xs text-primary">
        Fitment record matches {make}
        {model ? ` ${model}` : ''}
      </p>
    )
  }
  if (fit === 'POSSIBLE') {
    return <p className="text-xs text-gold-ink">Brand-level match: confirm fitment before purchase</p>
  }
  return <p className="text-xs text-muted-foreground">No fitment record: verify with the supplier before purchase</p>
}

/** Stock status line with semantic colouring. */
export function StockStatus({ qty, className }: { qty: number; className?: string }) {
  if (qty > 0) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs text-primary', className)}>
        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
        In stock · {qty} {qty === 1 ? 'unit' : 'units'}
      </span>
    )
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-destructive', className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" />
      Out of stock
    </span>
  )
}

/** Common Kenyan vehicle makes for the fitment finder datalist. */
export const COMMON_MAKES = [
  'Toyota', 'Nissan', 'Mazda', 'Subaru', 'Mitsubishi', 'Honda', 'Volkswagen',
  'Isuzu', 'Ford', 'Mercedes-Benz', 'BMW', 'Lexus',
]
