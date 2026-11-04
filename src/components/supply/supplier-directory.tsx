'use client'

/* Supplier directory — public listing of VERIFIED suppliers on the
 * Automotive Supply Network (GET /api/suppliers only returns verified orgs,
 * and the card renders the verified badge only when supplier.verified is
 * true). County filter options are derived from the loaded results.
 */

import { useMemo, useState } from 'react'
import { Search, MapPin, Store, Package, Warehouse, Users, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { navigate } from '@/lib/client'
import { dateLabel } from '@/lib/format'
import { BecomeSupplierDialog } from '@/components/supply/become-supplier-dialog'
import { Stars, SupplierAvatar, VerifiedBadge, type SupplierListItem } from '@/components/supply/shared'

export function SupplierDirectory({ suppliers }: { suppliers: SupplierListItem[] }) {
  const [q, setQ] = useState('')
  const [county, setCounty] = useState('all')
  const [visible, setVisible] = useState(9)
  const [applyOpen, setApplyOpen] = useState(false)

  // Counties derived from the results themselves (honest, no hardcoded list)
  const counties = useMemo(() => {
    const set = new Set<string>()
    for (const s of suppliers) if (s.county) set.add(s.county)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [suppliers])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return suppliers.filter((s) => {
      if (county !== 'all' && s.county !== county) return false
      if (!needle) return true
      return (
        s.name.toLowerCase().includes(needle) ||
        (s.description ?? '').toLowerCase().includes(needle) ||
        (s.town ?? '').toLowerCase().includes(needle) ||
        s.specialities.some((sp) => sp.toLowerCase().includes(needle))
      )
    })
  }, [suppliers, q, county])

  return (
    <section aria-label="Supplier directory">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Verified suppliers</h2>
          <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">
            Every supplier below passed CARMAZE document verification. Contact details, branches and policies are
            published on each storefront.
          </p>
        </div>
        <Button
          className="h-11 gap-1.5 bg-gold text-gold-foreground hover:bg-gold/90"
          onClick={() => setApplyOpen(true)}
        >
          <Store className="h-4 w-4" aria-hidden="true" /> Become a supplier
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={county} onValueChange={setCounty}>
          <SelectTrigger className="h-11 w-full sm:w-56" aria-label="Filter by county">
            <SelectValue placeholder="County" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All counties</SelectItem>
            {counties.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            className="h-11 pl-9"
            placeholder="Search suppliers or specialities…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setVisible(9) }}
            aria-label="Search suppliers"
          />
        </div>
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
          <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <p className="font-semibold">No suppliers match</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {suppliers.length === 0
              ? 'Verified suppliers appear here as they join the network. Check back soon — or apply to become one.'
              : 'Try a different county or clear the search.'}
          </p>
          <Button variant="outline" onClick={() => { setQ(''); setCounty('all') }}>Clear filters</Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.slice(0, visible).map((s) => (
            <Card
              key={s.id}
              className="cmz-gloss flex h-full cursor-pointer flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              onClick={() => navigate(`/supply?supplier=${s.id}`)}
            >
              <CardContent className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <SupplierAvatar name={s.name} logoUrl={s.logoUrl} className="h-12 w-12" />
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/supply?supplier=${s.id}`) }}
                      className="block max-w-full truncate text-left font-semibold leading-tight hover:underline"
                    >
                      {s.name}
                    </button>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {[s.town, s.county].filter(Boolean).join(', ') || s.county}
                    </p>
                  </div>
                  <VerifiedBadge verified={s.verified} className="shrink-0" />
                </div>

                <div className="flex items-center gap-1.5">
                  <Stars avg={s.rating ?? 0} />
                  <span className="text-xs text-muted-foreground">
                    {s.reviewCount > 0 ? `${(s.rating ?? 0).toFixed(1)} (${s.reviewCount})` : 'No reviews yet'}
                  </span>
                </div>

                {s.description && (
                  <p className="line-clamp-2 text-sm text-foreground/85">{s.description}</p>
                )}

                {s.specialities.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {s.specialities.slice(0, 3).map((sp) => (
                      <Badge key={sp} variant="secondary" className="max-w-full truncate">{sp}</Badge>
                    ))}
                    {s.specialities.length > 3 && (
                      <Badge variant="secondary">+{s.specialities.length - 3}</Badge>
                    )}
                  </div>
                )}

                <div className="mt-auto grid grid-cols-3 gap-2 pt-2 text-center">
                  <div className="rounded-md bg-muted/60 px-1 py-1.5">
                    <p className="flex items-center justify-center gap-1 text-sm font-semibold">
                      <Package className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />{s.productCount}
                    </p>
                    <p className="text-[11px] text-muted-foreground">parts</p>
                  </div>
                  <div className="rounded-md bg-muted/60 px-1 py-1.5">
                    <p className="flex items-center justify-center gap-1 text-sm font-semibold">
                      <Warehouse className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />{s.branchCount}
                    </p>
                    <p className="text-[11px] text-muted-foreground">branches</p>
                  </div>
                  <div className="rounded-md bg-muted/60 px-1 py-1.5">
                    <p className="flex items-center justify-center gap-1 text-sm font-semibold">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />{s.reviewCount}
                    </p>
                    <p className="text-[11px] text-muted-foreground">reviews</p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <p className="text-xs text-muted-foreground">Member since {dateLabel(s.memberSince)}</p>
                  <Button
                    size="sm"
                    className="h-10 gap-1"
                    onClick={(e) => { e.stopPropagation(); navigate(`/supply?supplier=${s.id}`) }}
                    aria-label={`View ${s.name} storefront`}
                  >
                    View storefront
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {filtered.length > visible && (
        <div className="mt-6 text-center">
          <Button variant="outline" className="h-11" onClick={() => setVisible((v) => v + 9)}>
            Show more suppliers ({filtered.length - visible})
          </Button>
        </div>
      )}

      <BecomeSupplierDialog open={applyOpen} onOpenChange={setApplyOpen} />
    </section>
  )
}

export function SupplierDirectorySkeleton() {
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="mt-4 h-3 w-1/3" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-4/5" />
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
          <Skeleton className="mt-4 h-10 w-full" />
        </Card>
      ))}
    </div>
  )
}
