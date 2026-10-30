'use client'

/* CARMAZE — Marketplace (#/cars)
 * Public listing search with shareable filter URLs, save-search, compare
 * (up to 3 vehicles) and AI Car Finder results section.
 */

import { useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal, SearchX, BookmarkPlus, Scale, X, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { VehicleCard, type VehicleCardData } from '@/components/marketplace/vehicle-card'
import { AiCarFinder } from '@/components/ai/car-finder'
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useAuth } from '@/stores/auth'
import { apiGet, apiSend, navigate, buildQuery } from '@/lib/client'
import { KENYA_COUNTIES, VEHICLE_MAKES, BODY_TYPES, FUEL_TYPES, TRANSMISSIONS, CONDITIONS, CONDITION_LABELS, money } from '@/lib/format'
import { toast } from 'sonner'

type SearchResponse = { vehicles: VehicleCardData[]; total: number; page: number; perPage: number }

type FilterDraft = {
  q: string
  make: string
  model: string
  bodyType: string
  county: string
  fuel: string
  transmission: string
  condition: string
  sellerType: string
  verified: boolean
  minPrice: string // major KES for inputs; stored minor in URL
  maxPrice: string
  minYear: string
  maxYear: string
  maxMileage: string
  sort: string
  page: string
  org: string
}

const EMPTY_DRAFT: FilterDraft = {
  q: '', make: '', model: '', bodyType: '', county: '', fuel: '', transmission: '',
  condition: '', sellerType: '', verified: false, minPrice: '', maxPrice: '',
  minYear: '', maxYear: '', maxMileage: '', sort: 'newest', page: '1', org: '',
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'mileage_asc', label: 'Mileage: lowest' },
  { value: 'views', label: 'Most viewed' },
]

const COMPARE_ROWS: { label: string; get: (v: VehicleCardData) => string }[] = [
  { label: 'Price', get: (v) => money(v.priceMinor, v.currency) },
  { label: 'Year', get: (v) => String(v.year) },
  { label: 'Mileage', get: (v) => `${v.mileageKm.toLocaleString()} km` },
  { label: 'Fuel', get: (v) => v.fuel.charAt(0) + v.fuel.slice(1).toLowerCase() },
  { label: 'Transmission', get: (v) => (v.transmission === 'AUTOMATIC' ? 'Automatic' : 'Manual') },
  { label: 'Body type', get: (v) => v.bodyType.charAt(0) + v.bodyType.slice(1).toLowerCase() },
  { label: 'Condition', get: (v) => CONDITION_LABELS[v.condition] ?? v.condition },
  { label: 'County', get: (v) => v.county },
  { label: 'Seller', get: (v) => (v.sellerType === 'DEALER' ? v.orgName || 'Dealer' : 'Private') },
]

function draftFromQuery(query: URLSearchParams): FilterDraft {
  const minor = (key: string) => {
    const raw = query.get(key)
    if (!raw) return ''
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? String(Math.round(n / 100)) : ''
  }
  return {
    q: query.get('q') ?? '',
    make: query.get('make') ?? '',
    model: query.get('model') ?? '',
    bodyType: query.get('bodyType') ?? '',
    county: query.get('county') ?? '',
    fuel: query.get('fuel') ?? '',
    transmission: query.get('transmission') ?? '',
    condition: query.get('condition') ?? '',
    sellerType: query.get('sellerType') ?? '',
    verified: query.get('verified') === '1',
    minPrice: minor('minPrice'),
    maxPrice: minor('maxPrice'),
    minYear: query.get('minYear') ?? '',
    maxYear: query.get('maxYear') ?? '',
    maxMileage: query.get('maxMileage') ?? '',
    sort: query.get('sort') || 'newest',
    page: query.get('page') || '1',
    org: query.get('org') ?? '',
  }
}

/** Convert the editable draft into URL query params (prices back to minor units). */
function draftToParams(d: FilterDraft): Record<string, string | number | undefined> {
  const num = (s: string) => {
    const n = Number(s)
    return s !== '' && Number.isFinite(n) && n > 0 ? n : undefined
  }
  return {
    q: d.q.trim() || undefined,
    make: d.make || undefined,
    model: d.model.trim() || undefined,
    bodyType: d.bodyType || undefined,
    county: d.county || undefined,
    fuel: d.fuel || undefined,
    transmission: d.transmission || undefined,
    condition: d.condition || undefined,
    sellerType: d.sellerType || undefined,
    verified: d.verified ? '1' : undefined,
    minPrice: num(d.minPrice) ? Math.round(Number(d.minPrice) * 100) : undefined,
    maxPrice: num(d.maxPrice) ? Math.round(Number(d.maxPrice) * 100) : undefined,
    minYear: num(d.minYear),
    maxYear: num(d.maxYear),
    maxMileage: num(d.maxMileage),
    sort: d.sort && d.sort !== 'newest' ? d.sort : undefined,
    org: d.org || undefined,
    // page intentionally omitted → resets to 1 whenever filters change
  }
}

export default function View() {
  const route = useHashRoute()
  const { user, loading: authLoading } = useAuth()

  const [data, setData] = useState<SearchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [aiResults, setAiResults] = useState<VehicleCardData[] | null>(null)
  const [aiMessage, setAiMessage] = useState<string>('')
  const [saveSearchOpen, setSaveSearchOpen] = useState(false)
  const [searchName, setSearchName] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromQuery(route.query))

  // ── Sync draft when the URL changes (back/forward, external nav) ──
  useEffect(() => {
    const t = setTimeout(() => setDraft(draftFromQuery(route.query)), 0)
    return () => clearTimeout(t)
  }, [route.query])

  // ── Debounced push of draft → shareable URL (400ms) ──
  // Only navigates when a filter actually differs from the current URL, so
  // deep links that carry ?page= are not rewritten back to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      const clean = (o: Record<string, string | number | undefined>) => {
        const r: Record<string, string> = {}
        for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') r[k] = String(v)
        return r
      }
      const hash = window.location.hash
      const currentQ = new URLSearchParams(hash.split('?')[1] ?? '')
      const currentParams: Record<string, string> = {}
      currentQ.forEach((v, k) => { if (k !== 'page') currentParams[k] = v })
      const nextParams = clean(draftToParams(draft))
      if (JSON.stringify(nextParams) !== JSON.stringify(currentParams)) {
        navigate(buildQuery('cars', nextParams), { replace: true })
      }
    }, 400)
    return () => clearTimeout(t)
  }, [draft])

  // ── Fetch results whenever the URL query changes ──
  const qs = route.query.toString()
  useEffect(() => {
    let active = true
    Promise.resolve().then(() => { if (active) setError(null) })
    apiGet<SearchResponse>(`/api/vehicles${qs ? `?${qs}` : ''}`)
      .then((d) => { if (active) { setData(d); setError(null) } })
      .catch((e: Error) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [qs])

  // ── Saved vehicle ids for hearts ──
  useEffect(() => {
    if (!user) {
      const t = setTimeout(() => setSavedIds(new Set()), 0)
      return () => clearTimeout(t)
    }
    let active = true
    apiGet<{ saved: { vehicle: VehicleCardData }[] }>('/api/saved-vehicles')
      .then((d) => { if (active) setSavedIds(new Set(d.saved.map((s) => s.vehicle.id))) })
      .catch(() => {})
    return () => { active = false }
  }, [user])

  const vehicles = data?.vehicles ?? []
  const total = data?.total ?? 0
  const page = data?.page ?? 1
  const perPage = data?.perPage ?? 12
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const loading = !data && !error
  const hasFilters = useMemo(() => Object.entries(draftToParams(draft)).length > 0, [draft])
  const activeFilterCount = useMemo(() => Object.keys(draftToParams(draft)).length, [draft])

  const compareVehicles = compareIds
    .map((id) => vehicles.find((v) => v.id === id))
    .filter((v): v is VehicleCardData => Boolean(v))

  function patchDraft(patch: Partial<FilterDraft>) {
    setDraft((d) => ({ ...d, ...patch }))
  }

  function goToPage(p: number) {
    const params: Record<string, string | number | undefined> = {}
    route.query.forEach((v, k) => { params[k] = v })
    params.page = p
    navigate(buildQuery('cars', params))
  }

  function clearFilters() {
    setDraft({ ...EMPTY_DRAFT })
  }

  function toggleCompare(v: VehicleCardData) {
    setCompareIds((ids) => {
      if (ids.includes(v.id)) return ids.filter((i) => i !== v.id)
      if (ids.length >= 3) { toast.warning('You can compare up to 3 vehicles'); return ids }
      return [...ids, v.id]
    })
  }

  function toggleSaved(v: VehicleCardData) {
    if (!user) {
      toast.info('Sign in to save vehicles', { description: 'Your shortlist syncs across devices.' })
      navigate('signin')
      return
    }
    const saved = savedIds.has(v.id)
    // optimistic
    setSavedIds((prev) => {
      const next = new Set(prev)
      if (saved) next.delete(v.id)
      else next.add(v.id)
      return next
    })
    const done = saved
      ? apiSend(`/api/saved-vehicles?vehicleId=${v.id}`, 'DELETE')
      : apiSend('/api/saved-vehicles', 'POST', { vehicleId: v.id })
    done
      .then(() => toast.success(saved ? 'Removed from your shortlist' : 'Saved to your shortlist'))
      .catch((e: Error) => {
        setSavedIds((prev) => {
          const next = new Set(prev)
          if (saved) next.add(v.id)
          else next.delete(v.id)
          return next
        })
        toast.error(e.message)
      })
  }

  function saveSearch() {
    const name = searchName.trim()
    if (!name) { toast.error('Give this search a name'); return }
    apiSend('/api/saved-searches', 'POST', { name, query: route.query.toString() })
      .then(() => {
        toast.success('Search saved', { description: 'You can find it under Account → Saved searches.' })
        setSaveSearchOpen(false)
        setSearchName('')
      })
      .catch((e: Error) => toast.error(e.message))
  }

  const filterFields = (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="f-q">Keyword</Label>
        <Input id="f-q" placeholder="e.g. Prado or Demio" value={draft.q} onChange={(e) => patchDraft({ q: e.target.value })} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Make</Label>
          <Select value={draft.make || 'any'} onValueChange={(v) => patchDraft({ make: v === 'any' ? '' : v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Any make" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any make</SelectItem>
              {VEHICLE_MAKES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-model">Model</Label>
          <Input id="f-model" placeholder="Any model" value={draft.model} onChange={(e) => patchDraft({ model: e.target.value })} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Body type</Label>
          <Select value={draft.bodyType || 'any'} onValueChange={(v) => patchDraft({ bodyType: v === 'any' ? '' : v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any body</SelectItem>
              {BODY_TYPES.map((b) => <SelectItem key={b} value={b}>{b.charAt(0) + b.slice(1).toLowerCase()}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>County</Label>
          <Select value={draft.county || 'any'} onValueChange={(v) => patchDraft({ county: v === 'any' ? '' : v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Anywhere" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Anywhere</SelectItem>
              {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Fuel</Label>
          <Select value={draft.fuel || 'any'} onValueChange={(v) => patchDraft({ fuel: v === 'any' ? '' : v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any fuel</SelectItem>
              {FUEL_TYPES.map((f) => <SelectItem key={f} value={f}>{f.charAt(0) + f.slice(1).toLowerCase()}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Transmission</Label>
          <Select value={draft.transmission || 'any'} onValueChange={(v) => patchDraft({ transmission: v === 'any' ? '' : v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              {TRANSMISSIONS.map((t) => <SelectItem key={t} value={t}>{t === 'AUTOMATIC' ? 'Automatic' : 'Manual'}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Condition</Label>
          <Select value={draft.condition || 'any'} onValueChange={(v) => patchDraft({ condition: v === 'any' ? '' : v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any condition</SelectItem>
              {CONDITIONS.map((c) => <SelectItem key={c} value={c}>{CONDITION_LABELS[c]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Seller</Label>
          <Select value={draft.sellerType || 'any'} onValueChange={(v) => patchDraft({ sellerType: v === 'any' ? '' : v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Anyone" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Anyone</SelectItem>
              <SelectItem value="DEALER">Verified dealers</SelectItem>
              <SelectItem value="PRIVATE">Private sellers</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="f-minp">Min price (KES)</Label>
          <Input id="f-minp" inputMode="numeric" placeholder="e.g. 500,000" value={draft.minPrice} onChange={(e) => patchDraft({ minPrice: e.target.value.replace(/[^\d]/g, '') })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-maxp">Max price (KES)</Label>
          <Input id="f-maxp" inputMode="numeric" placeholder="e.g. 4,000,000" value={draft.maxPrice} onChange={(e) => patchDraft({ maxPrice: e.target.value.replace(/[^\d]/g, '') })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-miny">Year from</Label>
          <Input id="f-miny" inputMode="numeric" placeholder="2005" value={draft.minYear} onChange={(e) => patchDraft({ minYear: e.target.value.replace(/[^\d]/g, '') })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-maxy">Year to</Label>
          <Input id="f-maxy" inputMode="numeric" placeholder="2025" value={draft.maxYear} onChange={(e) => patchDraft({ maxYear: e.target.value.replace(/[^\d]/g, '') })} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="f-mileage">Max mileage (km)</Label>
        <Input id="f-mileage" inputMode="numeric" placeholder="e.g. 100,000" value={draft.maxMileage} onChange={(e) => patchDraft({ maxMileage: e.target.value.replace(/[^\d]/g, '') })} />
      </div>

      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
        <Checkbox checked={draft.verified} onCheckedChange={(c) => patchDraft({ verified: c === true })} />
        <span className="text-sm">Verified dealers only</span>
      </label>

      {hasFilters && (
        <>
          <Separator />
          <Button variant="ghost" className="h-11 w-full" onClick={clearFilters}>
            <X className="h-4 w-4" /> Clear all filters
          </Button>
        </>
      )}
    </div>
  )

  const pageNumbers = useMemo(() => {
    const window = 2
    const out: (number | '…')[] = []
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || Math.abs(p - page) <= window) out.push(p)
      else if (out[out.length - 1] !== '…') out.push('…')
    }
    return out
  }, [page, totalPages])

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <Reveal>
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Browse cars for sale</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? 'Loading listings…' : `${total.toLocaleString()} ${total === 1 ? 'vehicle' : 'vehicles'} found`}
            {draft.org && ' — filtered by showroom'}
          </p>
        </header>
      </Reveal>

      {/* AI Car Finder */}
      {!authLoading && (
        <div className="mb-6">
          <AiCarFinder
            onResults={(results, message) => {
              setAiResults(results)
              setAiMessage(message)
            }}
          />
        </div>
      )}

      {aiResults && (
        <section className="mb-8 rounded-xl border-2 border-accent/60 bg-accent/10 p-4 sm:p-6" aria-label="AI matches">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-accent-foreground" />
              <div>
                <h2 className="text-lg font-semibold">AI matches</h2>
                {aiMessage && <p className="text-sm text-muted-foreground">{aiMessage}</p>}
              </div>
              <Badge className="ml-1 border-none bg-accent text-accent-foreground">{aiResults.length}</Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-11 px-4"
              onClick={() => { setAiResults(null); setAiMessage('') }}
            >
              Clear AI results
            </Button>
          </div>
          {aiResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matches found for that description — try being more specific.</p>
          ) : (
            <Stagger key={aiResults.map((r) => r.id).join(',')} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {aiResults.map((v) => (
                <StaggerItem key={v.id}>
                  <VehicleCard v={v} saved={savedIds.has(v.id)} onToggleSave={toggleSaved} />
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </section>
      )}

      <div className="flex gap-6">
        {/* Desktop filter sidebar */}
        <aside className="hidden w-72 shrink-0 lg:block" aria-label="Search filters">
          <Card>
            <CardContent className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">Filters</h2>
                {activeFilterCount > 0 && <Badge variant="secondary">{activeFilterCount}</Badge>}
              </div>
              {filterFields}
            </CardContent>
          </Card>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Toolbar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" className="h-11 px-4 lg:hidden">
                    <SlidersHorizontal className="h-4 w-4" /> Filters
                    {activeFilterCount > 0 && <Badge variant="secondary" className="ml-1">{activeFilterCount}</Badge>}
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-80 overflow-y-auto scrollbar-thin">
                  <SheetHeader>
                    <SheetTitle>Filters</SheetTitle>
                  </SheetHeader>
                  <div className="px-4 pb-6">{filterFields}</div>
                </SheetContent>
              </Sheet>
              <span className="text-sm text-muted-foreground">
                {loading ? 'Searching…' : `${total.toLocaleString()} results`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="h-11 px-4"
                onClick={() => {
                  if (!user) {
                    toast.info('Sign in to save this search')
                    navigate('signin')
                    return
                  }
                  setSaveSearchOpen(true)
                }}
              >
                <BookmarkPlus className="h-4 w-4" /> <span className="hidden sm:inline">Save search</span>
              </Button>
              <Select value={draft.sort} onValueChange={(v) => patchDraft({ sort: v })}>
                <SelectTrigger className="h-11 w-[170px]" aria-label="Sort results">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Results */}
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <Card key={i} className="overflow-hidden">
                  <Skeleton className="aspect-[16/10] w-full rounded-none" />
                  <CardContent className="space-y-2 p-4">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-5 w-1/2" />
                    <Skeleton className="h-3 w-2/3" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : error ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                <SearchX className="h-10 w-10 text-muted-foreground" />
                <p className="font-medium">Could not load listings</p>
                <p className="text-sm text-muted-foreground">{error}</p>
                <Button className="h-11 px-5" onClick={() => navigate('cars')}>Retry</Button>
              </CardContent>
            </Card>
          ) : vehicles.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                <SearchX className="h-10 w-10 text-muted-foreground" />
                <p className="font-medium">No vehicles match your search</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Try widening your price range, removing a filter, or searching a different make.
                </p>
                <Button className="h-11 px-5" onClick={clearFilters}>Clear all filters</Button>
              </CardContent>
            </Card>
          ) : (
            <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {vehicles.map((v) => (
                <StaggerItem key={v.id} className={`relative rounded-xl ${compareIds.includes(v.id) ? 'ring-2 ring-accent ring-offset-2 ring-offset-background' : ''}`}>
                  <VehicleCard v={v} saved={savedIds.has(v.id)} onToggleSave={toggleSaved} />
                  <button
                    onClick={() => toggleCompare(v)}
                    aria-pressed={compareIds.includes(v.id)}
                    aria-label={compareIds.includes(v.id) ? `Remove ${v.make} ${v.model} from compare` : `Add ${v.make} ${v.model} to compare`}
                    className={`absolute right-12 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
                      compareIds.includes(v.id) ? 'bg-accent text-accent-foreground' : 'bg-black/35 text-white hover:bg-black/55'
                    }`}
                  >
                    <Scale className="h-4 w-4" />
                  </button>
                </StaggerItem>
              ))}
            </Stagger>
          )}

          {/* Pagination */}
          {!loading && !error && totalPages > 1 && (
            <nav className="mt-8 flex flex-wrap items-center justify-center gap-2" aria-label="Pagination">
              <Button
                variant="outline"
                className="h-11 w-11 p-0"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
                aria-label="Previous page"
              >
                ‹
              </Button>
              {pageNumbers.map((p, i) =>
                p === '…' ? (
                  <span key={`gap-${i}`} className="px-1 text-muted-foreground">…</span>
                ) : (
                  <Button
                    key={p}
                    variant={p === page ? 'default' : 'outline'}
                    className="h-11 w-11 p-0"
                    onClick={() => goToPage(p)}
                    aria-current={p === page ? 'page' : undefined}
                  >
                    {p}
                  </Button>
                )
              )}
              <Button
                variant="outline"
                className="h-11 w-11 p-0"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
                aria-label="Next page"
              >
                ›
              </Button>
            </nav>
          )}
        </div>
      </div>

      {/* Compare bar */}
      {compareIds.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
              <Scale className="h-5 w-5 shrink-0 text-primary" />
              <span className="shrink-0 text-sm font-medium">
                {compareIds.length} of 3 selected
              </span>
              <div className="hidden items-center gap-1 sm:flex">
                {compareVehicles.map((v) => (
                  <Badge key={v.id} variant="secondary" className="max-w-44 gap-1 truncate">
                    <span className="truncate">{v.make} {v.model}</span>
                    <button onClick={() => toggleCompare(v)} aria-label={`Remove ${v.make} ${v.model} from compare`} className="rounded-full p-0.5 hover:bg-foreground/10">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" className="h-11 px-3" onClick={() => setCompareIds([])}>Clear</Button>
              <Button className="h-11 px-5" disabled={compareVehicles.length < 2} onClick={() => setCompareOpen(true)}>
                Compare {compareVehicles.length >= 2 ? `(${compareVehicles.length})` : ''}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Compare dialog */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto scrollbar-thin">
          <DialogHeader>
            <DialogTitle>Compare vehicles</DialogTitle>
            <DialogDescription>Side-by-side specification comparison.</DialogDescription>
          </DialogHeader>
          {compareVehicles.length >= 2 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr>
                    <th className="w-28 p-2 text-left font-medium text-muted-foreground">Spec</th>
                    {compareVehicles.map((v) => (
                      <th key={v.id} className="p-2 text-left font-semibold">
                        {v.make} {v.model}
                        <div className="text-xs font-normal text-muted-foreground">{v.year}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((row) => (
                    <tr key={row.label} className="border-t border-border">
                      <td className="p-2 align-top text-muted-foreground">{row.label}</td>
                      {compareVehicles.map((v) => (
                        <td key={v.id} className="p-2 align-top font-medium">{row.get(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select at least 2 vehicles to compare.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Save search dialog */}
      <Dialog open={saveSearchOpen} onOpenChange={setSaveSearchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save this search</DialogTitle>
            <DialogDescription>
              We&apos;ll keep these filters so you can rerun them anytime from your account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="search-name">Search name</Label>
            <Input
              id="search-name"
              placeholder="e.g. SUVs under 4M in Nairobi"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveSearch() }}
            />
            {route.query.toString() && (
              <p className="truncate text-xs text-muted-foreground">Filters: {route.query.toString()}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" className="h-11" onClick={() => setSaveSearchOpen(false)}>Cancel</Button>
            <Button className="h-11 px-5" onClick={saveSearch}>Save search</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
