'use client'

/* Catalogue section for the Automotive Supply Network landing.
 * Debounced search, category/condition filters, in-stock switch, sort and
 * server-side pagination via GET /api/supply/catalogue. Also reused (with a
 * fixed supplier filter) for supplier storefronts.
 */

import { useEffect, useMemo, useState } from 'react'
import { Search, ChevronLeft, ChevronRight, PackageSearch, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { apiGet, buildQuery } from '@/lib/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProductCard } from '@/components/supply/product-card'
import {
  useDebounced,
  SUPPLY_CONDITION_LABELS,
  type CatalogueResponse,
  type CategoryRow,
} from '@/components/supply/shared'

const SORTS: { value: string; label: string }[] = [
  { value: 'relevance', label: 'Featured first' },
  { value: 'price_asc', label: 'Price: low → high' },
  { value: 'price_desc', label: 'Price: high → low' },
  { value: 'newest', label: 'Newest' },
  { value: 'rating', label: 'Top rated' },
]

export type CatalogueFilters = {
  q: string
  category: string // slug or ''
  condition: string // NEW | REFURBISHED | USED | ''
  brand: string // exact brand or ''
  inStock: boolean
  sort: string
  page: number
}

export function ProductCatalogue({
  categories,
  fixedSupplierId,
  fixedSupplierName,
  initialFilters,
  pageSize = 24,
  showHeader = true,
}: {
  categories: CategoryRow[]
  /** When set, the grid is locked to one supplier (storefront mode). */
  fixedSupplierId?: string
  fixedSupplierName?: string
  initialFilters?: Partial<CatalogueFilters>
  pageSize?: number
  showHeader?: boolean
}) {
  const [q, setQ] = useState(initialFilters?.q ?? '')
  const [category, setCategory] = useState(initialFilters?.category ?? '')
  const [condition, setCondition] = useState(initialFilters?.condition ?? '')
  const [brand, setBrand] = useState(initialFilters?.brand ?? '')
  const [inStock, setInStock] = useState(initialFilters?.inStock ?? false)
  const [sort, setSort] = useState(initialFilters?.sort ?? 'relevance')
  const [page, setPage] = useState(initialFilters?.page ?? 1)

  const dq = useDebounced(q, 350)

  // Loading + error are derived from a fetch key so no setState is needed
  // synchronously inside effects (stale-while-revalidate keeps the grid up).
  const [state, setState] = useState<{ key: string; data: CatalogueResponse } | null>(null)
  const [errState, setErrState] = useState<{ key: string; message: string } | null>(null)
  const fetchKey = [dq, category, condition, brand, inStock, sort, page, pageSize, fixedSupplierId ?? ''].join('|')

  useEffect(() => {
    let active = true
    const url = buildQuery('/api/supply/catalogue', {
      q: dq.trim() || undefined,
      category: category || undefined,
      condition: condition || undefined,
      brand: brand || undefined,
      inStock: inStock ? 1 : undefined,
      sort,
      page,
      pageSize,
      supplier: fixedSupplierId,
    })
    apiGet<CatalogueResponse>(url)
      .then((d) => { if (active) { setState({ key: fetchKey, data: d }); setErrState(null) } })
      .catch((e: Error) => { if (active) setErrState({ key: fetchKey, message: e.message }) })
    return () => { active = false }
  }, [dq, category, condition, brand, inStock, sort, page, pageSize, fixedSupplierId, fetchKey])

  const loading = state?.key !== fetchKey
  const error = errState?.key === fetchKey ? errState.message : null
  const data = state?.data ?? null

  const categoriesSorted = useMemo(() => {
    const parents = categories.filter((c) => !c.parentSlug).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    const out: { slug: string; name: string; depth: number }[] = []
    for (const parent of parents) {
      out.push({ slug: parent.slug, name: parent.name, depth: 0 })
      for (const child of categories.filter((c) => c.parentSlug === parent.slug).sort((a, b) => a.name.localeCompare(b.name))) {
        out.push({ slug: child.slug, name: child.name, depth: 1 })
      }
    }
    // orphans (parent missing) just in case
    for (const c of categories) {
      if (c.parentSlug && !categories.some((x) => x.slug === c.parentSlug)) out.push({ slug: c.slug, name: c.name, depth: 0 })
    }
    return out
  }, [categories])

  const total = data?.total ?? 0
  const pageCount = data ? Math.max(1, Math.ceil(total / (data.pageSize || pageSize))) : 1
  const rangeStart = data && total > 0 ? (data.page - 1) * (data.pageSize || pageSize) + 1 : 0
  const rangeEnd = data ? Math.min(total, (data.page - 1) * (data.pageSize || pageSize) + (data.products?.length ?? 0)) : 0

  function clearFilters() {
    setQ(''); setCategory(''); setCondition(''); setBrand(''); setInStock(false); setSort('relevance'); setPage(1)
  }

  return (
    <section aria-label={fixedSupplierName ? `${fixedSupplierName} parts catalogue` : 'Parts catalogue'}>
      {showHeader && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Parts catalogue</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Genuine listings from verified suppliers: wholesale pricing for garages and fleets.
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              className="h-11 pl-9"
              placeholder="Search parts, SKU, MPN, brand…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1) }}
              aria-label="Search the parts catalogue"
            />
          </div>
          <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1) }}>
            <SelectTrigger className="h-11 w-full sm:w-48" aria-label="Sort results">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={category || 'all'} onValueChange={(v) => { setCategory(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="h-11 w-full sm:w-56" aria-label="Filter by category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categoriesSorted.map((c) => (
                <SelectItem key={c.slug} value={c.slug}>
                  {c.depth > 0 ? `- ${c.name}` : c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={condition || 'all'} onValueChange={(v) => { setCondition(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="h-11 w-full sm:w-44" aria-label="Filter by condition">
              <SelectValue placeholder="Condition" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any condition</SelectItem>
              {Object.entries(SUPPLY_CONDITION_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex h-11 items-center gap-2 rounded-md border border-border px-3">
            <Switch id="in-stock-only" checked={inStock} onCheckedChange={(v) => { setInStock(v); setPage(1) }} />
            <Label htmlFor="in-stock-only" className="cursor-pointer text-sm">In stock only</Label>
          </div>
          {(q || category || condition || brand || inStock || sort !== 'relevance') && (
            <Button variant="ghost" size="sm" className="h-11 gap-1.5 sm:ml-auto" onClick={clearFilters}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset
            </Button>
          )}
        </div>
      </div>

      {/* Status line */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2" aria-live="polite">
        <p className="text-sm text-muted-foreground">
          {loading
            ? 'Searching the catalogue…'
            : error
              ? 'Catalogue unavailable'
              : total === 0
                ? 'No parts match these filters'
                : `Showing ${rangeStart}–${rangeEnd} of ${total} ${total === 1 ? 'part' : 'parts'}`}
        </p>
        {brand && <Badge variant="secondary">Brand: {brand}</Badge>}
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed py-10 text-center">
          <SlidersHorizontal className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => setPage((p) => p)}>Try again</Button>
        </div>
      )}

      {/* Grid */}
      {loading && !data ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border p-4">
              <Skeleton className="aspect-[4/3] w-full rounded-lg" />
              <Skeleton className="mt-3 h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
              <Skeleton className="mt-3 h-5 w-1/3" />
              <Skeleton className="mt-3 h-9 w-full" />
            </div>
          ))}
        </div>
      ) : !error && total === 0 && !loading ? (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
          <PackageSearch className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <p className="font-semibold">No parts match these filters</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Try a broader search, clear the category or condition filter: or use the fitment finder below to search by vehicle.
          </p>
          <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
        </div>
      ) : (
        <>
          <div className={`mt-4 grid grid-cols-1 gap-4 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${loading ? 'opacity-60' : ''}`}>
            {(data?.products ?? []).map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
          {total > 0 && (
            <nav className="mt-6 flex items-center justify-between gap-2" aria-label="Catalogue pages">
              <Button
                variant="outline"
                className="h-11 gap-1"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Prev
              </Button>
              <p className="text-sm text-muted-foreground">Page {data?.page ?? page} of {pageCount}</p>
              <Button
                variant="outline"
                className="h-11 gap-1"
                disabled={page >= pageCount || loading}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </nav>
          )}
        </>
      )}
    </section>
  )
}
