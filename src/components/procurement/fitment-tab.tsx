'use client'

/* Vehicle fitment finder: GET /api/supply/fitment resolves REAL
 * compatibility records only. Verdicts: MATCH (structured record),
 * POSSIBLE (brand-level listing match), NO_FITMENT (no data: never
 * claimed to fit). Zero matches gets honest copy + Request-a-Part CTA. */

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Search, ShoppingCart, CheckCircle2, AlertTriangle, CircleSlash, CarFront, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { apiGet, ClientApiError } from '@/lib/client'
import { money, VEHICLE_MAKES } from '@/lib/format'
import { useCart } from '@/stores/cart'
import { cn } from '@/lib/utils'
import {
  Img, BtnSpinner, EmptyState, CardGridSkeleton, FIT_STYLES,
  type FitmentResult,
} from './shared'

type FitmentResponse = {
  products: FitmentResult[]
  summary: { matches: number; note: string }
}

export function FitmentTab({ onRequestPart }: { onRequestPart: () => void }) {
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [data, setData] = useState<FitmentResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const runSearch = useCallback(() => {
    if (!make) {
      toast.error('Choose the vehicle make first.')
      return
    }
    let stale = false
    setLoading(true)
    setSearched(true)
    const params = new URLSearchParams({ make })
    if (model.trim()) params.set('model', model.trim())
    if (year) params.set('year', year)
    apiGet<FitmentResponse>(`/api/supply/fitment?${params.toString()}`)
      .then((d) => { if (!stale) { setData(d); setLoading(false) } })
      .catch((e: unknown) => {
        if (stale) return
        setLoading(false)
        toast.error(e instanceof ClientApiError ? e.message : 'Fitment search failed. Please try again.')
      })
    return () => { stale = true }
  }, [make, model, year])

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <CarFront className="h-4 w-4 text-primary" aria-hidden="true" />
          Vehicle compatibility finder
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          We only report fitment backed by a compatibility record on the product; nothing is assumed.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="fit-make">Make *</Label>
            <Select value={make} onValueChange={setMake}>
              <SelectTrigger id="fit-make" aria-label="Vehicle make"><SelectValue placeholder="Select make" /></SelectTrigger>
              <SelectContent>
                {VEHICLE_MAKES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fit-model">Model</Label>
            <Input id="fit-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. Harrier" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fit-year">Year</Label>
            <Input
              id="fit-year" value={year} inputMode="numeric"
              onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="e.g. 2016"
            />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={runSearch} disabled={loading || !make}>
              {loading ? <BtnSpinner className="mr-1.5" /> : <Search className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              {loading ? 'Searching…' : 'Find parts'}
            </Button>
          </div>
        </div>
      </Card>

      {searched && data && (
        <Alert variant={data.summary.matches === 0 ? 'destructive' : 'default'}
          className={data.summary.matches === 0
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400'
            : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400'}
        >
          {data.summary.matches === 0
            ? <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
          <AlertTitle>{data.summary.matches} verified match{data.summary.matches === 1 ? '' : 'es'}</AlertTitle>
          <AlertDescription className="text-foreground/80">{data.summary.note}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <CardGridSkeleton count={6} />
      ) : !searched ? (
        <EmptyState
          icon={CarFront}
          title="Search by vehicle to see verified fitment"
          description="MATCH = a structured compatibility record names this vehicle. POSSIBLE = the supplier lists the make generally, no model-level record. NO_FITMENT = listed but never claimed to fit."
        />
      ) : !data || data.products.length === 0 ? (
        <EmptyState
          icon={CircleSlash}
          title="No verified fitment records"
          description="No verified fitment records for this vehicle; use Request a Part instead and let suppliers quote the exact part for your make, model and year."
        >
          <Button onClick={onRequestPart}>Request a Part</Button>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.products.map((p) => <FitCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  )
}

function FitCard({ product: p }: { product: FitmentResult }) {
  const add = useCart((s) => s.add)
  const fit = FIT_STYLES[p.fit] ?? FIT_STYLES.NO_FITMENT
  const outOfStock = p.availableQty <= 0

  const addToCart = () => {
    add({
      productId: p.id, name: p.name, sku: p.sku,
      unitPriceMinor: p.unitPriceMinor,
      wholesalePriceMinor: p.wholesalePriceMinor,
      wholesaleMinQty: undefined, // fitment endpoint does not expose wholesale thresholds
      supplierId: p.supplier.id, supplierName: p.supplier.name,
      image: p.image, availableQty: p.availableQty,
    })
    toast.success(`${p.name} added to cart`, { description: `Supplier: ${p.supplier.name}` })
  }

  return (
    <Card className={cn('flex gap-0 overflow-hidden border-border bg-card p-0 transition-colors', p.fit === 'MATCH' && 'hover:border-emerald-500/40')}>
      <Img src={p.image} alt={p.name} className="h-auto w-24 shrink-0 border-r border-border sm:w-28" />
      <CardContent className="flex min-w-0 flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{p.name}</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{[p.brand, p.sku, p.category.name].filter(Boolean).join(' · ')}</p>
          </div>
          <Badge variant="outline" className={cn('shrink-0 gap-1', fit.chip)}>
            {p.fit === 'MATCH' ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              : p.fit === 'POSSIBLE' ? <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                : <Info className="h-3 w-3" aria-hidden="true" />}
            {fit.label}
          </Badge>
        </div>

        {p.fitRecords.length > 0 && (
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {p.fitRecords.map((r, i) => (
              <li key={i} className="truncate">
                {r.make}{r.model ? ` ${r.model}` : ''} {r.yearFrom || r.yearTo ? `(${r.yearFrom ?? '…'}–${r.yearTo ?? '…'})` : ''}{r.engine ? ` · ${r.engine}` : ''}
                {r.verified ? <span className="ml-1 text-emerald-600 dark:text-emerald-400">✓ reviewed</span> : <span className="ml-1">(supplier listed)</span>}
              </li>
            ))}
          </ul>
        )}
        {p.fit === 'POSSIBLE' && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            The supplier lists this part for the make generally; no model-level record. Confirm with the supplier before fitting.
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <div>
            <span className="text-sm font-bold tabular-nums">{money(p.unitPriceMinor)}</span>
            <span className={cn('ml-2 text-xs', outOfStock ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>
              {outOfStock ? 'Out of stock' : `${p.availableQty} in stock`}
            </span>
            <p className="text-xs text-muted-foreground">{p.supplier.name} · {p.supplier.county}</p>
          </div>
          <Button size="sm" onClick={addToCart} disabled={outOfStock}>
            <ShoppingCart className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
