'use client'

/* Vehicle Part Compatibility Finder — "Find parts for your vehicle".
 * Queries GET /api/supply/fitment and renders an honest verdict for every
 * result: MATCH (recorded fitment), POSSIBLE (brand-level only) and
 * NO_FITMENT (no record — verify before purchase). The API's summary note is
 * shown verbatim so we never overstate fitment confidence.
 */

import { useState } from 'react'
import { CarFront, Search, Info, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet } from '@/lib/client'
import { toast } from 'sonner'
import { FitmentRow } from '@/components/supply/product-card'
import {
  COMMON_MAKES,
  FitBadge,
  FitHint,
  toCardSupplier,
  type FitmentResponse,
  type FitmentProduct,
} from '@/components/supply/shared'

export function FitmentFinder() {
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FitmentResponse | null>(null)
  const [searched, setSearched] = useState(false)
  const [showAll, setShowAll] = useState(false)

  async function run(e?: React.FormEvent) {
    e?.preventDefault()
    if (!make.trim() && !model.trim()) {
      toast.info('Enter at least the vehicle make to search fitment')
      return
    }
    setLoading(true)
    setError(null)
    setSearched(true)
    setShowAll(false)
    try {
      const data = await apiGet<FitmentResponse>(
        `/api/supply/fitment?make=${encodeURIComponent(make.trim())}` +
          `&model=${encodeURIComponent(model.trim())}` +
          (year.trim() ? `&year=${encodeURIComponent(year.trim())}` : '')
      )
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check fitment')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const products = result?.products ?? []
  const visible = showAll ? products : products.slice(0, 8)

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-deep text-brand-deep-foreground">
            <CarFront className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-bold sm:text-lg">Find parts for your vehicle</h2>
            <p className="text-xs text-muted-foreground">
              We only mark a part as fitting when a real fitment record says so — nothing is guessed.
            </p>
          </div>
        </div>

        <form onSubmit={run} className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_120px_auto]">
          <div>
            <Input
              className="h-11"
              list="supply-vehicle-makes"
              placeholder="Make (e.g. Toyota)"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              aria-label="Vehicle make"
            />
            <datalist id="supply-vehicle-makes">
              {COMMON_MAKES.map((m) => <option key={m} value={m} />)}
            </datalist>
          </div>
          <Input
            className="h-11"
            placeholder="Model (e.g. Hilux)"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label="Vehicle model"
          />
          <Input
            className="h-11"
            type="number"
            inputMode="numeric"
            min={1980}
            max={new Date().getFullYear() + 1}
            placeholder="Year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            aria-label="Vehicle year"
          />
          <Button type="submit" className="h-11 gap-1.5" disabled={loading}>
            <Search className="h-4 w-4" aria-hidden="true" /> {loading ? 'Checking…' : 'Check fitment'}
          </Button>
        </form>

        {/* Results */}
        {loading && (
          <div className="mt-4 space-y-2" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <Skeleton className="h-14 w-14 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="mt-4 flex flex-col items-start gap-2 rounded-lg border border-dashed p-4">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void run()}>Try again</Button>
          </div>
        )}

        {!loading && !error && !searched && (
          <p className="mt-4 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
            Enter your vehicle&apos;s make — model and year sharpen the result. Results marked
            <span className="mx-1 font-medium text-foreground">Possible fit</span>
            matched the brand only; always confirm with the supplier before ordering.
          </p>
        )}

        {!loading && !error && searched && result && (
          <div className="mt-4 space-y-3">
            {/* Honest summary from the API, verbatim */}
            {result.summary?.note && (
              <div
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                  result.summary.matches > 0
                    ? 'border-primary/30 bg-primary/5 text-foreground'
                    : 'border-gold/40 bg-gold/10 text-foreground'
                }`}
                role="status"
              >
                {result.summary.matches > 0 ? (
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                ) : (
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />
                )}
                <p>{result.summary.note}</p>
              </div>
            )}
            {!result.summary && result.message && (
              <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">{result.message}</p>
            )}

            {products.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-8 text-center">
                <CarFront className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  No catalogue products matched that vehicle. Try a part-number search in the catalogue below, or
                  browse suppliers and ask them directly.
                </p>
              </div>
            ) : (
              <>
                <ul className="space-y-2">
                  {visible.map((fp) => (
                    <li key={fp.id}>
                      <FitmentResultRow fp={fp} searchMake={make.trim()} searchModel={model.trim()} />
                    </li>
                  ))}
                </ul>
                {products.length > visible.length && (
                  <div className="text-center">
                    <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>
                      Show all {products.length} results
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** One fitment result: verdict badge + honest hint + normal product row. */
function FitmentResultRow({ fp, searchMake, searchModel }: { fp: FitmentProduct; searchMake: string; searchModel: string }) {
  // Normalise the fitment API's supplierRating into the card shape.
  const cardProduct = {
    id: fp.id,
    refCode: fp.refCode,
    name: fp.name,
    sku: fp.sku,
    mpn: null,
    brand: fp.brand,
    condition: fp.condition,
    unitPriceMinor: fp.unitPriceMinor,
    wholesalePriceMinor: fp.wholesalePriceMinor,
    wholesaleMinQty: 0,
    currency: fp.currency,
    image: fp.image,
    tags: [],
    category: fp.category,
    supplier: toCardSupplier(fp.supplier, fp.supplier.supplierRating),
    authenticityVerified: false,
    featured: false,
    ratingAvg: null,
    ratingCount: 0,
    availableQty: fp.availableQty,
    inStock: fp.availableQty > 0,
  }
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <FitBadge fit={fp.fit} />
        <FitHint fit={fp.fit} make={searchMake || fp.fitRecords[0]?.make || ''} model={searchModel || undefined} />
      </div>
      {fp.fitRecords.length > 0 && (
        <p className="mb-1 text-xs text-muted-foreground">
          Recorded for: {fp.fitRecords.map((r) => `${r.make}${r.model ? ` ${r.model}` : ''}${r.yearFrom || r.yearTo ? ` (${r.yearFrom ?? '…'}–${r.yearTo ?? '…'})` : ''}`).join('; ')}
        </p>
      )}
      <FitmentRow product={cardProduct} />
    </div>
  )
}
