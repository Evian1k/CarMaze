'use client'

/* Full product detail page: GET /api/supply/products/[id].
 * Real data only: spec table, recorded compatibility (with admin-verified
 * ticks or an honest "no records" message), per-warehouse availability,
 * price history, reviews with a signed-in review form, wholesale-aware
 * quantity stepper and a supplier card linking to the storefront.
 */

import { useEffect, useState } from 'react'
import {
  ArrowLeft, ShoppingCart, Bookmark, BookmarkCheck, BadgeCheck, ShieldCheck,
  Minus, Plus, Package, PackageCheck, MapPin, Star, Warehouse, History, CarFront, Info,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { apiGet, apiSend, navigate } from '@/lib/client'
import { money, dateLabel, timeAgo, KENYA_COUNTIES } from '@/lib/format'
import { useAuth, hasAnyRole } from '@/stores/auth'
import { useCart } from '@/stores/cart'
import { useSavedSupply } from '@/components/supply/saved-store'
import {
  PRICE_REASON_LABELS,
  SUPPLY_CONDITION_LABELS,
  Stars,
  StockStatus,
  SupplierAvatar,
  VerifiedBadge,
} from '@/components/supply/shared'

// ─────────────────────────── API types (route-faithful) ───────────────────────

type DetailStock = {
  branchId: string
  branchName: string
  kind: string
  county: string
  town: string | null
  available: number
  qtyOnHand?: number
  qtyReserved?: number
  reorderLevel?: number
}

type CompatRow = {
  id: string
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

type DetailReview = {
  id: string
  rating: number
  comment: string | null
  verifiedPurchase: boolean
  author: string
  createdAt: string
}

type PriceHistoryRow = { id: string; priceMinor: number; reason: string; createdAt: string }

export type ProductDetailData = {
  id: string
  refCode: string
  name: string
  sku: string
  mpn: string | null
  oemRef: string | null
  brand: string | null
  description: string
  condition: string
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
  provenance: { provenanceNote?: string } | null
  authenticityVerified: boolean
  status: string
  featured: boolean
  ratingAvg: number | null
  ratingCount: number
  createdAt: string
  stocks: DetailStock[]
  availableQty: number
  compat: CompatRow[]
  reviews: DetailReview[]
  priceHistory: PriceHistoryRow[]
  category: { slug: string; name: string } | null
  supplier: {
    id: string
    name: string
    county: string
    town: string | null
    location: string | null
    verified: boolean
    supplierRating: number | null
    logoUrl: string | null
    coverUrl: string | null
    description: string | null
    phone: string | null
    email: string | null
  }
}

type ProductResponse = { product: ProductDetailData; isOwner: boolean }

// ─────────────────────────────────── Component ────────────────────────────────

export function ProductDetail({ productId }: { productId: string }) {
  const { user } = useAuth()
  const hydrateSaved = useSavedSupply((s) => s.hydrate)
  const [state, setState] = useState<{ key: string; data: ProductResponse } | null>(null)
  const [errState, setErrState] = useState<{ key: string; message: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // Derived loading/error keyed to the current request (no sync setState in effects)
  const fetchKey = `${productId}|${reloadKey}`
  const loading = state?.key !== fetchKey
  const error = errState?.key === fetchKey ? errState.message : null
  const data = state?.data ?? null

  // Deep links skip the landing: make sure saved bookmarks are hydrated.
  useEffect(() => {
    if (user) void hydrateSaved()
  }, [user, hydrateSaved])

  useEffect(() => {
    let active = true
    const key = `${productId}|${reloadKey}`
    apiGet<ProductResponse>(`/api/supply/products/${encodeURIComponent(productId)}`)
      .then((d) => { if (active) { setState({ key, data: d }); setErrState(null) } })
      .catch((e: Error) => { if (active) setErrState({ key, message: e.message }) })
    return () => { active = false }
  }, [productId, reloadKey])

  if (loading) return <ProductDetailSkeleton />
  if (error || !data) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-20 text-center">
        <Package className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="mt-4 font-medium">Could not load this product</p>
        <p className="mt-1 text-sm text-muted-foreground">{error ?? 'It may no longer be listed.'}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" className="h-11 px-6" onClick={() => setReloadKey((k) => k + 1)}>Retry</Button>
          <Button className="h-11 px-6" onClick={() => navigate('/supply')}>Back to catalogue</Button>
        </div>
      </div>
    )
  }

  return <ProductDetailBody key={`${data.product.id}|${reloadKey}`} data={data} isOwner={data.isOwner} signedIn={Boolean(user)} onReviewed={() => setReloadKey((k) => k + 1)} />
}

function ProductDetailBody({ data, isOwner, signedIn, onReviewed }: { data: ProductResponse; isOwner: boolean; signedIn: boolean; onReviewed: () => void }) {
  const { user } = useAuth()
  const p = data.product
  const toggleSaved = useSavedSupply((s) => s.toggle)
  const savedProducts = useSavedSupply((s) => s.products)
  const saved = Boolean(savedProducts[p.id])

  const [imgIdx, setImgIdx] = useState(0)
  const [imgBroken, setImgBroken] = useState<Record<number, boolean>>({})
  const [qty, setQty] = useState(1)
  const [orderOpen, setOrderOpen] = useState(false)
  const hasWholesale = Boolean(p.wholesalePriceMinor && p.wholesaleMinQty > 0)
  const wholesaleUnlocked = hasWholesale && qty >= (p.wholesaleMinQty ?? 0)
  const maxQty = p.availableQty > 0 ? p.availableQty : 0
  // Consumer ordering: signed-in customers only: never the listing's own
  // supplier, and never supplier-platform accounts (they buy via procurement).
  const isSupplierUser = isOwner || hasAnyRole(user, 'SUPPLIER_OWNER', 'SUPPLIER_STAFF')
  const canOrder = signedIn && !isSupplierUser

  function addToCart() {
    if (maxQty <= 0) return
    const capped = Math.min(qty, maxQty)
    useCart.getState().add(
      {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        unitPriceMinor: p.unitPriceMinor,
        wholesalePriceMinor: p.wholesalePriceMinor,
        wholesaleMinQty: p.wholesaleMinQty,
        supplierId: p.supplier.id,
        supplierName: p.supplier.name,
        image: p.images[0] ?? null,
        availableQty: p.availableQty,
      },
      capped
    )
    toast.success(`Added ${capped} × ${p.name} to your procurement cart`)
  }

  function onSave() {
    if (!signedIn) {
      toast.info('Sign in to save parts for later')
      navigate('signin')
      return
    }
    void toggleSaved('PRODUCT', p.id, p.name)
  }

  const activeImage = p.images[imgIdx] ?? null

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      {/* Back */}
      <Button variant="ghost" className="mb-4 h-11 gap-1.5 px-2" onClick={() => navigate('/supply')}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All parts
      </Button>

      {isOwner && (
        <Alert className="mb-4">
          <Info className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>This is your listing</AlertTitle>
          <AlertDescription>You manage this product from your supplier dashboard.</AlertDescription>
        </Alert>
      )}

      {/* Top: gallery + purchase panel */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Gallery */}
        <div>
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-muted">
            {activeImage && !imgBroken[imgIdx] ? (
              <img src={activeImage} alt={p.name} className="h-full w-full object-cover" onError={() => setImgBroken((m) => ({ ...m, [imgIdx]: true }))} />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                <Package className="h-12 w-12" aria-hidden="true" />
              </span>
            )}
            {p.featured && <Badge className="absolute left-3 top-3 bg-gold text-gold-foreground">Featured</Badge>}
          </div>
          {p.images.length > 1 && (
            <div className="scrollbar-thin mt-3 flex gap-2 overflow-x-auto pb-1">
              {p.images.map((img, i) => (
                <button
                  key={`${img}-${i}`}
                  onClick={() => setImgIdx(i)}
                  className={`h-16 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${i === imgIdx ? 'border-primary' : 'border-transparent hover:border-border'}`}
                  aria-label={`View image ${i + 1} of ${p.name}`}
                  aria-current={i === imgIdx}
                >
                  {img && !imgBroken[i] ? (
                    <img src={img} alt="" className="h-full w-full object-cover" onError={() => setImgBroken((m) => ({ ...m, [i]: true }))} />
                  ) : (
                    <span className="flex h-full items-center justify-center bg-muted text-muted-foreground">
                      <Package className="h-4 w-4" aria-hidden="true" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Purchase panel */}
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{SUPPLY_CONDITION_LABELS[p.condition] ?? p.condition}</Badge>
            {p.category && <Badge variant="outline">{p.category.name}</Badge>}
            {p.authenticityVerified && (
              <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
                <BadgeCheck className="h-3 w-3" aria-hidden="true" /> Authenticity verified
              </Badge>
            )}
          </div>

          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{p.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {p.brand ? `${p.brand} · ` : ''}SKU {p.sku}
            {p.mpn ? ` · MPN ${p.mpn}` : ''}
            {' '}· Ref {p.refCode}
          </p>

          {(p.ratingCount > 0 && p.ratingAvg != null) ? (
            <div className="mt-2 flex items-center gap-1.5">
              <Stars avg={p.ratingAvg} size="md" />
              <span className="text-sm text-muted-foreground">{p.ratingAvg.toFixed(1)} · {p.ratingCount} review{p.ratingCount === 1 ? '' : 's'}</span>
            </div>
          ) : (
            <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
              <Star className="h-3.5 w-3.5" aria-hidden="true" /> No reviews yet
            </p>
          )}

          {/* Price */}
          <div className="mt-4 rounded-xl border border-border bg-card p-4">
            <p className="text-3xl font-bold tracking-tight">{money(p.unitPriceMinor, p.currency)}</p>
            {p.taxRatePct > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">Tax rate {p.taxRatePct}% where applicable</p>
            )}
            {hasWholesale && (
              <p className="mt-1 text-sm text-muted-foreground">
                Wholesale <span className="font-semibold text-foreground">{money(p.wholesalePriceMinor!, p.currency)}</span>{' '}
                per unit at {p.wholesaleMinQty}+ units
              </p>
            )}
            <div className="mt-2"><StockStatus qty={p.availableQty} /></div>

            {/* Qty stepper */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center rounded-lg border border-border" role="group" aria-label="Quantity">
                <button
                  className="flex h-11 w-11 items-center justify-center rounded-l-lg hover:bg-muted disabled:opacity-40"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={qty <= 1}
                  aria-label="Decrease quantity"
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </button>
                <Input
                  className="h-11 w-14 rounded-none border-x border-y-0 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  type="number"
                  min={1}
                  max={maxQty || undefined}
                  value={qty}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isNaN(n)) return
                    setQty(Math.max(1, maxQty > 0 ? Math.min(n, maxQty) : n))
                  }}
                  aria-label="Quantity"
                />
                <button
                  className="flex h-11 w-11 items-center justify-center rounded-r-lg hover:bg-muted disabled:opacity-40"
                  onClick={() => setQty((q) => (maxQty > 0 ? Math.min(maxQty, q + 1) : q + 1))}
                  disabled={maxQty > 0 && qty >= maxQty}
                  aria-label="Increase quantity"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <Button className="h-11 flex-1 gap-2" onClick={addToCart} disabled={maxQty <= 0}>
                <ShoppingCart className="h-4 w-4" aria-hidden="true" /> Add to cart
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11"
                onClick={onSave}
                aria-label={saved ? 'Remove from saved' : 'Save product'}
              >
                {saved ? <BookmarkCheck className="h-4 w-4 text-primary" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </div>
            {hasWholesale && (
              <p className={`mt-2 text-xs ${wholesaleUnlocked ? 'font-medium text-primary' : 'text-muted-foreground'}`}>
                {wholesaleUnlocked
                  ? `Wholesale price unlocked at qty ${p.wholesaleMinQty}: you save ${money((p.unitPriceMinor - (p.wholesalePriceMinor ?? 0)) * qty, p.currency)} on this line`
                  : `Add ${p.wholesaleMinQty - qty} more to unlock wholesale pricing (min qty ${p.wholesaleMinQty})`}
              </p>
            )}

            {/* Consumer order CTA: signed-in non-supplier users */}
            <div className="mt-3 border-t border-border pt-3">
              {canOrder ? (
                <>
                  <Button variant="outline" className="h-11 w-full gap-2" onClick={() => setOrderOpen(true)} disabled={maxQty <= 0}>
                    <PackageCheck className="h-4 w-4" aria-hidden="true" /> Order this part
                  </Button>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Order {qty} × {p.name} for {money(p.unitPriceMinor * qty, p.currency)} + delivery: pay by M-Pesa once the supplier accepts.
                  </p>
                </>
              ) : !signedIn ? (
                <>
                  <Button variant="outline" className="h-11 w-full gap-2" onClick={() => navigate('signin')}>
                    <PackageCheck className="h-4 w-4" aria-hidden="true" /> Sign in to order
                  </Button>
                  <p className="mt-1.5 text-xs text-muted-foreground">Sign in to order this part for delivery anywhere in Kenya.</p>
                </>
              ) : null}
            </div>
          </div>

          {/* Supplier card */}
          <Card className="mt-4">
            <CardContent className="flex items-start gap-3 p-4">
              <SupplierAvatar name={p.supplier.name} logoUrl={p.supplier.logoUrl} className="h-12 w-12" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button className="truncate font-semibold hover:underline" onClick={() => navigate(`/supply?supplier=${p.supplier.id}`)}>
                    {p.supplier.name}
                  </button>
                  <VerifiedBadge verified={p.supplier.verified} />
                </div>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {[p.supplier.town, p.supplier.county].filter(Boolean).join(', ') || p.supplier.county}
                </p>
                {/* Contact details are only shown for verified suppliers */}
                {p.supplier.verified && (p.supplier.phone || p.supplier.email) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[p.supplier.phone, p.supplier.email].filter(Boolean).join(' · ')}
                  </p>
                )}
                {p.supplier.supplierRating != null && p.supplier.supplierRating > 0 && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <Stars avg={p.supplier.supplierRating} />
                    <span className="text-xs text-muted-foreground">{p.supplier.supplierRating.toFixed(1)} supplier rating</span>
                  </div>
                )}
              </div>
              <Button variant="outline" size="sm" className="h-10 shrink-0" onClick={() => navigate(`/supply?supplier=${p.supplier.id}`)}>
                Storefront
              </Button>
            </CardContent>
          </Card>

          {/* Per-warehouse availability */}
          <Card className="mt-4">
            <CardContent className="p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Warehouse className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Availability by warehouse
              </h2>
              {p.stocks.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No stock is currently held in any warehouse.</p>
              ) : (
                <ul className="scrollbar-thin mt-2 max-h-44 space-y-1.5 overflow-y-auto pr-1">
                  {p.stocks.map((s) => (
                    <li key={s.branchId} className="flex items-center justify-between gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{s.branchName}</span>
                        <span className="text-xs text-muted-foreground">
                          {s.kind === 'WAREHOUSE' ? 'Warehouse' : 'Branch'} · {[s.town, s.county].filter(Boolean).join(', ')}
                        </span>
                      </span>
                      <span className={`shrink-0 text-sm font-semibold ${s.available > 0 ? 'text-primary' : 'text-destructive'}`}>
                        {s.available} {s.available === 1 ? 'unit' : 'units'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Description */}
      <section className="mt-8" aria-label="Product description">
        <h2 className="text-lg font-bold">About this part</h2>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/90">{p.description}</p>
        {p.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {p.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
          </div>
        )}
      </section>

      {/* Provenance */}
      {p.provenance?.provenanceNote && (
        <Alert className="mt-6">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Authenticity &amp; provenance</AlertTitle>
          <AlertDescription>{p.provenance.provenanceNote}</AlertDescription>
        </Alert>
      )}

      {/* Spec table */}
      <section className="mt-8" aria-label="Specifications">
        <h2 className="text-lg font-bold">Specifications</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/3">Attribute</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <SpecRow label="SKU" value={p.sku} mono />
              <SpecRow label="MPN (manufacturer part no.)" value={p.mpn ?? 'Not provided'} mono />
              <SpecRow label="OEM reference" value={p.oemRef ?? 'Not provided'} mono />
              <SpecRow label="Brand" value={p.brand ?? 'Not provided'} />
              <SpecRow label="Condition" value={SUPPLY_CONDITION_LABELS[p.condition] ?? p.condition} />
              <SpecRow label="Warranty" value={p.warrantyMonths > 0 ? `${p.warrantyMonths} month${p.warrantyMonths === 1 ? '' : 's'}` : 'None offered'} />
              <SpecRow label="Returns" value={p.returnable ? 'Accepted' : 'Not accepted'} />
              <SpecRow label="Batch tracked" value={p.batchTracked ? 'Yes' : 'No'} />
              <SpecRow label="Serial tracked" value={p.serialTracked ? 'Yes' : 'No'} />
              <SpecRow label="Category" value={p.category?.name ?? 'Not provided'} />
              <SpecRow label="Listed" value={dateLabel(p.createdAt)} />
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Compatibility */}
      <section className="mt-8" aria-label="Vehicle compatibility">
        <h2 className="text-lg font-bold">Vehicle compatibility</h2>
        {p.compat.length === 0 ? (
          <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed py-8 text-center">
            <CarFront className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">No fitment records provided</p>
            <p className="max-w-md text-sm text-muted-foreground">
              The supplier has not recorded specific fitment for this part. Contact the supplier to confirm fitment
              before purchasing: never assume an unlisted part fits.
            </p>
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Make</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Years</TableHead>
                  <TableHead className="hidden sm:table-cell">Engine</TableHead>
                  <TableHead>Verified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.compat.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.make}</TableCell>
                    <TableCell>{row.model ?? 'Any'}</TableCell>
                    <TableCell>
                      {row.yearFrom || row.yearTo ? `${row.yearFrom ?? '…'}–${row.yearTo ?? '…'}` : 'All years'}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{row.engine ?? 'Not provided'}</TableCell>
                    <TableCell>
                      {row.verified ? (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                          <span className="text-xs font-medium">Admin-reviewed</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Supplier-declared</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {p.vehicleMakes.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">
              Brand-level quick filter (indicative only: the table above is authoritative):
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {p.vehicleMakes.map((m) => <Badge key={m} variant="secondary">{m}</Badge>)}
            </div>
          </div>
        )}
      </section>

      {/* Price history */}
      <section className="mt-8" aria-label="Price history">
        <h2 className="flex items-center gap-1.5 text-lg font-bold">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Price history
        </h2>
        {p.priceHistory.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No price changes recorded yet.</p>
        ) : (
          <ul className="scrollbar-thin mt-3 max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {p.priceHistory.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="font-semibold">{money(h.priceMinor, p.currency)}</span>
                <span className="text-muted-foreground">{PRICE_REASON_LABELS[h.reason] ?? h.reason}</span>
                <span className="text-xs text-muted-foreground">{dateLabel(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator className="my-8" />

      {/* Reviews */}
      <ReviewsSection productId={p.id} reviews={p.reviews} ratingAvg={p.ratingAvg} ratingCount={p.ratingCount} signedIn={signedIn} onReviewed={onReviewed} />

      {/* Consumer order dialog */}
      {canOrder && (
        <OrderPartDialog
          open={orderOpen}
          product={{ id: p.id, name: p.name, unitPriceMinor: p.unitPriceMinor, currency: p.currency, availableQty: maxQty }}
          initialQty={qty}
          onClose={() => setOrderOpen(false)}
        />
      )}
    </div>
  )
}

// ───────────────────────── Order this part dialog ─────────────────────────

const ORDER_PHONE_RE = /^(\+?254|0)\d{9}$/

type OrderableProduct = { id: string; name: string; unitPriceMinor: number; currency: string; availableQty: number }

function OrderPartDialog({ open, product, initialQty, onClose }: {
  open: boolean
  product: OrderableProduct
  initialQty: number
  onClose: () => void
}) {
  const [qty, setQty] = useState(String(Math.min(Math.max(1, initialQty), 99)))
  const [deliveryMethod, setDeliveryMethod] = useState<'DIRECT' | 'COLLECTION'>('DIRECT')
  const [county, setCounty] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const qtyNum = Number(qty)
  const validQty = Number.isInteger(qtyNum) && qtyNum >= 1 && qtyNum <= 99
  const subtotal = validQty ? product.unitPriceMinor * qtyNum : 0
  const deliveryFee = deliveryMethod === 'COLLECTION' ? 0 : 25_000
  const canSubmit = validQty && county !== '' && address.trim().length >= 5 && ORDER_PHONE_RE.test(phone.trim()) && !busy

  function submit() {
    if (!canSubmit) return
    setBusy(true)
    apiSend<{ orders: { refCode: string }[]; message: string }>('/api/orders', 'POST', {
      items: [{ productId: product.id, qty: qtyNum }],
      county,
      address: address.trim(),
      phone: phone.trim(),
      notes: notes.trim() || undefined,
      deliveryMethod,
    })
      .then((res) => {
        toast.success(res.message || `Order ${res.orders.map((o) => o.refCode).join(', ')} placed`)
        onClose()
        navigate('/account?tab=orders')
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : 'Could not place the order: please try again.')
      })
      .finally(() => setBusy(false))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[94vh] overflow-y-auto scrollbar-thin sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Order this part</DialogTitle>
          <DialogDescription>
            {product.name}: {money(product.unitPriceMinor, product.currency)} per unit. The supplier confirms stock and accepts before you pay.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ord-qty">Quantity (1–99)</Label>
              <Input id="ord-qty" inputMode="numeric" value={qty} maxLength={2}
                onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ord-method">Fulfilment</Label>
              <Select value={deliveryMethod} onValueChange={(v) => setDeliveryMethod(v as 'DIRECT' | 'COLLECTION')}>
                <SelectTrigger id="ord-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DIRECT">Deliver to me (KES 250)</SelectItem>
                  <SelectItem value="COLLECTION">I collect (free)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ord-county">County</Label>
            <Select value={county || undefined} onValueChange={setCounty}>
              <SelectTrigger id="ord-county" aria-label="County"><SelectValue placeholder="Choose your county" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ord-address">Delivery address / collection point</Label>
            <Input id="ord-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. Building, street, town" maxLength={300} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ord-phone">Phone (for delivery contact)</Label>
            <Input id="ord-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" inputMode="tel" maxLength={15} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ord-notes">Notes for the supplier (optional)</Label>
            <Textarea id="ord-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500}
              placeholder="e.g. Fits a 2015 Hilux: please confirm compatibility." />
          </div>
          <div className="space-y-1 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{money(subtotal, product.currency)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Delivery</span><span>{money(deliveryFee, product.currency)}</span></div>
            <div className="flex justify-between font-semibold"><span>Total</span><span>{money(subtotal + (validQty ? deliveryFee : 0), product.currency)}</span></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button className="min-h-11" onClick={submit} disabled={!canSubmit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Place order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SpecRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <TableRow>
      <TableCell className="font-medium text-muted-foreground">{label}</TableCell>
      <TableCell className={mono ? 'font-mono text-sm' : ''}>{value}</TableCell>
    </TableRow>
  )
}

// ─────────────────────────────────── Reviews ─────────────────────────────────

function ReviewsSection({
  productId,
  reviews,
  ratingAvg,
  ratingCount,
  signedIn,
  onReviewed,
}: {
  productId: string
  reviews: DetailReview[]
  ratingAvg: number | null
  ratingCount: number
  signedIn: boolean
  onReviewed: () => void
}) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  function submit() {
    if (rating < 1) {
      toast.error('Pick a star rating first')
      return
    }
    setBusy(true)
    apiSend<{ message: string; verifiedPurchase: boolean }>('/api/supply/reviews', 'POST', {
      productId,
      rating,
      comment: comment.trim() || undefined,
    })
      .then((d) => {
        toast.success(d.verifiedPurchase ? 'Review recorded: marked as a verified purchase' : 'Review recorded. Thank you!')
        setRating(0)
        setComment('')
        onReviewed()
      })
      .catch((e) => {
        const status = (e as { status?: number }).status
        if (status === 409) toast.info('You already reviewed this product')
        else toast.error(e instanceof Error ? e.message : 'Could not record review')
      })
      .finally(() => setBusy(false))
  }

  return (
    <section aria-label="Product reviews">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">Reviews</h2>
        {ratingCount > 0 && ratingAvg != null && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Stars avg={ratingAvg} /> {ratingAvg.toFixed(1)} from {ratingCount} review{ratingCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {reviews.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No reviews yet: be the first to rate this part.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Stars avg={r.rating} />
                <span className="text-sm font-medium">{r.author}</span>
                <span className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
                {r.verifiedPurchase && (
                  <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
                    <BadgeCheck className="h-3 w-3" aria-hidden="true" /> Verified purchase
                  </Badge>
                )}
              </div>
              {r.comment && <p className="mt-2 text-sm text-foreground/90">{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}

      {signedIn ? (
        <div className="mt-5 rounded-xl border border-border p-4">
          <p className="text-sm font-semibold">Write a review</p>
          <div className="mt-2 flex items-center gap-1" role="radiogroup" aria-label="Your star rating">
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                role="radio"
                aria-checked={rating === i}
                aria-label={`${i} star${i === 1 ? '' : 's'}`}
                className="rounded p-1 hover:bg-muted"
                onClick={() => setRating(i)}
              >
                <Star className={`h-6 w-6 ${i <= rating ? 'fill-gold text-gold' : 'text-muted-foreground/50'}`} aria-hidden="true" />
              </button>
            ))}
          </div>
          <Textarea
            className="mt-3"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="How was the part, packaging, delivery? (optional)"
            maxLength={1000}
          />
          <Button className="mt-3 h-11" onClick={submit} disabled={busy || rating < 1}>
            {busy ? 'Submitting…' : 'Submit review'}
          </Button>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4">
          <p className="text-sm text-muted-foreground">Bought this part? Sign in to leave a review.</p>
          <Button variant="outline" className="h-11" onClick={() => navigate('signin')}>Sign in to review</Button>
        </div>
      )}
    </section>
  )
}

function ProductDetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6" aria-busy="true">
      <Skeleton className="mb-4 h-9 w-28" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <Skeleton className="aspect-[4/3] w-full rounded-xl" />
          <div className="mt-3 flex gap-2">
            <Skeleton className="h-16 w-20 rounded-lg" />
            <Skeleton className="h-16 w-20 rounded-lg" />
            <Skeleton className="h-16 w-20 rounded-lg" />
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}
