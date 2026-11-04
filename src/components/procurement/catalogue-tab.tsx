'use client'

/* Catalogue tab — real product search across the Automotive Supply Network
 * (GET /api/supply/catalogue). Filters: q, category, condition, in-stock
 * toggle, optional vehicle fitment (make/model/year — the route resolves
 * real compatibility records only), sort + pagination. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Search, SlidersHorizontal, ShieldCheck, BadgeCheck, PackageSearch, ShoppingCart, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { apiGet, buildQuery, ClientApiError } from '@/lib/client'
import { money, VEHICLE_MAKES } from '@/lib/format'
import { useCart } from '@/stores/cart'
import { cn } from '@/lib/utils'
import {
  Img, QtyStepper, EmptyState, CardGridSkeleton, type CatalogueProduct, type CategoryRow,
} from './shared'

const CONDITIONS = [
  { value: 'NEW', label: 'Brand new' },
  { value: 'REFURBISHED', label: 'Refurbished' },
  { value: 'USED', label: 'Used / salvaged' },
]

const SORTS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'price_asc', label: 'Price: low → high' },
  { value: 'price_desc', label: 'Price: high → low' },
  { value: 'newest', label: 'Newest' },
  { value: 'rating', label: 'Supplier rating' },
]

export function CatalogueTab({ role }: { role: string }) {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [condition, setCondition] = useState('')
  const [inStock, setInStock] = useState(true)
  const [sort, setSort] = useState('relevance')
  const [page, setPage] = useState(1)
  const [fitOpen, setFitOpen] = useState(false)
  const [fitMake, setFitMake] = useState('')
  const [fitModel, setFitModel] = useState('')
  const [fitYear, setFitYear] = useState('')

  const [categories, setCategories] = useState<CategoryRow[] | null>(null)
  const [result, setResult] = useState<{ key: string; data: { total: number; page: number; pageSize: number; products: CatalogueProduct[] } | null } | null>(null)

  // debounce the free-text search into the applied query
  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1) }, 400)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    let stale = false
    apiGet<{ categories: CategoryRow[] }>('/api/supply/categories')
      .then((d) => { if (!stale) setCategories(d.categories) })
      .catch(() => { if (!stale) setCategories([]) })
    return () => { stale = true }
  }, [])

  const requestKey = buildQuery('/api/supply/catalogue', {
    q, category, condition, sort, page,
    inStock: inStock ? 1 : undefined,
    make: fitOpen && fitMake ? fitMake : undefined,
    model: fitOpen && fitModel ? fitModel : undefined,
    year: fitOpen && fitYear ? fitYear : undefined,
  })

  useEffect(() => {
    let stale = false
    apiGet<{ total: number; page: number; pageSize: number; products: CatalogueProduct[] }>(requestKey)
      .then((d) => { if (!stale) setResult({ key: requestKey, data: d }) })
      .catch((e: unknown) => {
        if (stale) return
        setResult({ key: requestKey, data: null })
        toast.error(e instanceof ClientApiError ? e.message : 'Could not load the catalogue.')
      })
    return () => { stale = true }
  }, [requestKey])

  const loading = result === null || result.key !== requestKey
  const data = loading ? null : result.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-4">
      {/* Filters row */}
      <Card className="border-border bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search parts, brands, SKUs, OEM refs…"
              className="pl-9"
              aria-label="Search catalogue"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-auto">
            <Select value={category} onValueChange={(v) => { setCategory(v === 'all-none' ? '' : v); setPage(1) }}>
              <SelectTrigger className="lg:w-44" aria-label="Category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent className="max-h-72 scrollbar-thin">
                <SelectItem value="all-none">All categories</SelectItem>
                {(categories ?? []).map((c) => (
                  <SelectItem key={c.slug} value={c.slug} className={cn(c.parentSlug && 'pl-6 text-muted-foreground')}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={condition} onValueChange={(v) => { setCondition(v === 'all-none' ? '' : v); setPage(1) }}>
              <SelectTrigger className="lg:w-40" aria-label="Condition">
                <SelectValue placeholder="Any condition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all-none">Any condition</SelectItem>
                {CONDITIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="lg:w-44" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 sm:justify-center">
              <Label htmlFor="instock-toggle" className="text-xs text-muted-foreground">In stock</Label>
              <Switch id="instock-toggle" checked={inStock} onCheckedChange={(v) => { setInStock(v); setPage(1) }} />
            </div>
          </div>
        </div>

        {/* Vehicle fitment toggle */}
        <div className="mt-3 border-t border-border pt-3">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => { setFitOpen((v) => !v); setPage(1) }}
            aria-expanded={fitOpen}
          >
            <SlidersHorizontal className={cn('h-3.5 w-3.5 transition-transform', fitOpen && 'text-primary')} aria-hidden="true" />
            Vehicle fitment filter {fitOpen ? '— on' : '— off'}
            <span className="text-[11px]">(only products listing a real compatibility record)</span>
          </button>
          {fitOpen && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:w-2/3">
              <Select value={fitMake} onValueChange={(v) => { setFitMake(v === 'all-none' ? '' : v); setPage(1) }}>
                <SelectTrigger aria-label="Vehicle make"><SelectValue placeholder="Make (required)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all-none">Any make</SelectItem>
                  {VEHICLE_MAKES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input value={fitModel} onChange={(e) => { setFitModel(e.target.value); setPage(1) }} placeholder="Model (optional)" aria-label="Vehicle model" />
              <Input
                value={fitYear} onChange={(e) => { setFitYear(e.target.value.replace(/\D/g, '').slice(0, 4)); setPage(1) }}
                placeholder="Year (optional)" inputMode="numeric" aria-label="Vehicle year"
              />
            </div>
          )}
        </div>
      </Card>

      {/* Result meta */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{loading ? 'Searching…' : `${data?.total ?? 0} product${(data?.total ?? 0) === 1 ? '' : 's'} found`}</span>
        <span>Page {data?.page ?? page} of {totalPages}</span>
      </div>

      {loading ? (
        <CardGridSkeleton />
      ) : !data || data.products.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No products match these filters"
          description="Try a broader search term, clear the fitment filter, or request the part from suppliers via Request a Part."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.products.map((p) => <ProductCard key={p.id} product={p} role={role} />)}
        </div>
      )}

      {/* Pagination */}
      {!loading && data && data.products.length > 0 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  )
}

function ProductCard({ product: p, role }: { product: CatalogueProduct; role: string }) {
  const add = useCart((s) => s.add)
  const items = useCart((s) => s.items)
  const [qty, setQty] = useState(1)
  const inCart = items.find((i) => i.productId === p.id)?.qty ?? 0
  const outOfStock = p.availableQty <= 0
  const wholesaleUnlocks = Boolean(p.wholesalePriceMinor && p.wholesaleMinQty > 0)

  const addToCart = useCallback(() => {
    add({
      productId: p.id, name: p.name, sku: p.sku,
      unitPriceMinor: p.unitPriceMinor,
      wholesalePriceMinor: p.wholesalePriceMinor,
      wholesaleMinQty: p.wholesaleMinQty,
      supplierId: p.supplier.id, supplierName: p.supplier.name,
      image: p.image, availableQty: p.availableQty,
    }, qty)
    toast.success(`${qty} × ${p.name} added to cart`, { description: `Supplier: ${p.supplier.name}` })
  }, [add, p, qty])

  return (
    <Card className="flex flex-col gap-0 overflow-hidden border-border bg-card p-0 transition-colors hover:border-primary/40">
      <div className="relative">
        <Img src={p.image} alt={p.name} className="h-36 w-full border-b border-border" />
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {p.authenticityVerified && (
            <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" variant="outline">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Authentic
            </Badge>
          )}
          {p.featured && <Badge variant="secondary" className="text-[10px]">Featured</Badge>}
        </div>
        {outOfStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400">Out of stock</Badge>
          </div>
        )}
      </div>
      <CardContent className="flex flex-1 flex-col gap-2 p-4">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug" title={p.name}>{p.name}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {[p.brand, p.sku, p.category.name].filter(Boolean).join(' · ')}
          </p>
        </div>

        <div className="mt-auto space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-base font-bold tabular-nums">{money(p.unitPriceMinor)}</span>
            {p.ratingAvg != null && p.ratingCount > 0 && (
              <span className="text-xs text-muted-foreground">★ {p.ratingAvg.toFixed(1)} ({p.ratingCount})</span>
            )}
          </div>
          {wholesaleUnlocks && (
            <p className="text-xs text-primary">
              Wholesale {money(p.wholesalePriceMinor!)} at {p.wholesaleMinQty}+ units
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span className="truncate">{p.supplier.name}</span>
            {p.supplier.verified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Verified supplier" />}
            <span aria-hidden="true">·</span>
            <span>{p.supplier.county}</span>
          </div>
          <p className={cn('text-xs', outOfStock ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>
            {outOfStock ? 'No stock available' : `${p.availableQty} in stock`}
            {p.condition !== 'NEW' && ` · ${CONDITIONS.find((c) => c.value === p.condition)?.label ?? p.condition}`}
          </p>

          <div className="flex items-center gap-2 pt-1">
            <QtyStepper value={qty} onChange={setQty} max={outOfStock ? 1 : Math.max(1, p.availableQty)} disabled={outOfStock} />
            <Button className="flex-1" onClick={addToCart} disabled={outOfStock}>
              <ShoppingCart className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Add{inCart > 0 ? ` (${inCart} in cart)` : ''}
            </Button>
          </div>
          {!outOfStock && role === 'MECHANIC' && (
            <p className="text-[11px] text-muted-foreground">Mechanic view — a manager or procurement can check out.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
