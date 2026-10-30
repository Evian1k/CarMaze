'use client'

/* Garages — public directory of verified garages & specialists with
 * category/county filters and a quote-request flow. Data: /api/garages.
 * #/garages/<orgId> renders the shared OrgStorefront business page. */

import { useEffect, useMemo, useState } from 'react'
import { MapPin, ShieldCheck, Star, Wrench, Sparkles, ClipboardList, Search, ArrowRight, Store } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GarageAssistant } from '@/components/ai/garage-assistant'
import OrgStorefront from '@/views/org-storefront'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useAuth } from '@/stores/auth'
import { apiGet, apiSend, navigate, buildQuery } from '@/lib/client'
import { money, KENYA_COUNTIES, SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS } from '@/lib/format'

type GarageServiceItem = { id: string; category: string; title: string; description: string | null; priceFromMinor: number | null }
type Garage = {
  org: { id: string; name: string; county: string; town: string | null; location: string | null; description: string | null; phone: string | null }
  services: GarageServiceItem[]
  rating: { avg: number; count: number }
  reviewCount: number
}

const CATEGORY_CHIPS = SERVICE_CATEGORIES.filter((c) => c !== 'OTHER')

export default function GaragesView() {
  const route = useHashRoute()
  const routeOrgId = route.segments[1]
  const { user, loading } = useAuth()
  const [category, setCategory] = useState<string>('')
  const [county, setCounty] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [visible, setVisible] = useState(6)
  const [feed, setFeed] = useState<{ key: string; garages: Garage[] } | null>(null)

  // Quote-request dialog state
  const [quoteFor, setQuoteFor] = useState<Garage | null>(null)
  const [formCategory, setFormCategory] = useState<string>('GENERAL_SERVICE')
  const [vehicleDesc, setVehicleDesc] = useState('')
  const [description, setDescription] = useState('')
  const [fCounty, setFCounty] = useState('Nairobi')
  const [town, setTown] = useState('')
  const [sending, setSending] = useState(false)
  const [createdRef, setCreatedRef] = useState<string | null>(null)

  const feedKey = `${category}|${county}`
  useEffect(() => {
    let cancelled = false
    apiGet<{ garages: Garage[] }>(buildQuery('/api/garages', { category: category || undefined, county: county === 'all' ? undefined : county }))
      .then((d) => { if (!cancelled) setFeed({ key: feedKey, garages: d.garages }) })
      .catch((e) => {
        if (!cancelled) {
          setFeed({ key: feedKey, garages: [] })
          toast.error(e instanceof Error ? e.message : 'Could not load garages')
        }
      })
    return () => { cancelled = true }
  }, [category, county, feedKey])

  const garages = feed && feed.key === feedKey ? feed.garages : null

  const filtered = useMemo(() => {
    if (!garages) return null
    const q = search.trim().toLowerCase()
    if (!q) return garages
    return garages.filter(
      (g) =>
        g.org.name.toLowerCase().includes(q) ||
        (g.org.town ?? '').toLowerCase().includes(q) ||
        g.services.some((s) => s.title.toLowerCase().includes(q))
    )
  }, [garages, search])

  function openQuoteDialog(garage: Garage, presetCategory?: string) {
    if (!user) {
      toast.info('Sign in to request a quote')
      navigate('signin')
      return
    }
    const firstActive = garage.services[0]?.category ?? 'GENERAL_SERVICE'
    setFormCategory(presetCategory && garage.services.some((s) => s.category === presetCategory) ? presetCategory : firstActive)
    setVehicleDesc('')
    setDescription('')
    setFCounty(garage.org.county || 'Nairobi')
    setTown('')
    setCreatedRef(null)
    setQuoteFor(garage)
  }

  function submitQuoteRequest() {
    if (!quoteFor) return
    if (description.trim().length < 15) {
      toast.error('Describe the work in at least 15 characters')
      return
    }
    setSending(true)
    apiSend<{ request: { refCode: string } }>('/api/service-requests', 'POST', {
      category: formCategory,
      vehicleDesc: vehicleDesc.trim() || undefined,
      description: description.trim(),
      county: fCounty,
      town: town.trim() || undefined,
    })
      .then((d) => {
        setCreatedRef(d.request.refCode)
        toast.success(`Request ${d.request.refCode} sent`)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not send request'))
      .finally(() => setSending(false))
  }

  // ── Storefront detail route: #/garages/<orgId> ──
  if (routeOrgId) return <OrgStorefront key={routeOrgId} orgId={routeOrgId} />

  return (
    <div className="min-h-screen bg-background">
      {/* Hero strip */}
      <section className="relative overflow-hidden border-b">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url(/images/garage.png)' }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#10130f]/90 via-[#10130f]/70 to-[#10130f]/30" aria-hidden="true" />
        <div className="relative mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <Badge className="mb-3 gap-1 bg-[#c9a45c] text-[#10130f] hover:bg-[#c9a45c]">
            <ShieldCheck className="h-3.5 w-3.5" /> Verified garages
          </Badge>
          <h1 className="max-w-xl text-3xl font-bold text-white sm:text-4xl">Trusted garages &amp; specialists</h1>
          <p className="mt-2 max-w-xl text-sm text-white/80 sm:text-base">
            Compare approved garages by service and county, then request quotes — real workshops, honest pricing, no obligation.
          </p>
          {user ? (
            <Button className="mt-5 gap-2" onClick={() => navigate('account?tab=requests')}>
              <ClipboardList className="h-4 w-4" /> My quote requests
            </Button>
          ) : (
            <Button className="mt-5 gap-2" variant="secondary" onClick={() => navigate('signin')}>
              Sign in to request quotes
            </Button>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* AI assistant (from the parallel agent) */}
        <GarageAssistant onSelect={(cat) => { setCategory(cat); document.getElementById('garage-list')?.scrollIntoView({ behavior: 'smooth' }) }} />

        {/* Filters */}
        <div className="mt-6 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setCategory('')}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${category === '' ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
            >
              All services
            </button>
            {CATEGORY_CHIPS.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${category === c ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
              >
                {SERVICE_CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={county} onValueChange={setCounty}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Filter by county">
                <SelectValue placeholder="County" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All counties</SelectItem>
                {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                className="pl-9"
                placeholder="Search garages or services…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search garages"
              />
            </div>
          </div>
        </div>

        {/* Garage cards */}
        <div id="garage-list" className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered === null ? (
            [0, 1, 2].map((i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="mt-2 h-4 w-1/3" />
                <Skeleton className="mt-4 h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-4/5" />
                <Skeleton className="mt-4 h-9 w-full" />
              </Card>
            ))
          ) : filtered.length === 0 ? (
            <div className="col-span-full">
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><Wrench className="h-6 w-6" /></span>
                <h3 className="mt-3 font-semibold">No garages match these filters</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Try another service category or county — or send an open request and garages will come to you.
                </p>
                <Button className="mt-4" variant="outline" onClick={() => { setCategory(''); setCounty('all'); setSearch('') }}>Clear filters</Button>
              </div>
            </div>
          ) : (
            filtered.slice(0, visible).map((g) => (
              <Card
                key={g.org.id}
                className="flex cursor-pointer flex-col p-4 transition-shadow hover:shadow-md sm:p-6"
                onClick={() => navigate(`garages/${g.org.id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`garages/${g.org.id}`) }}
                      className="text-left font-semibold leading-tight hover:underline"
                    >
                      {g.org.name}
                    </button>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      {[g.org.town, g.org.county].filter(Boolean).join(', ') || g.org.county}
                      {g.org.location ? ` · ${g.org.location}` : ''}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 gap-1 border-[#315e4b]/40 text-[#315e4b]">
                    <ShieldCheck className="h-3 w-3" /> Approved
                  </Badge>
                </div>

                <div className="mt-2 flex items-center gap-1.5">
                  <Stars avg={g.rating.avg} />
                  <span className="text-xs text-muted-foreground">
                    {g.rating.count > 0 ? `${g.rating.avg.toFixed(1)} (${g.rating.count})` : 'No reviews yet'}
                  </span>
                </div>

                {g.org.description && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{g.org.description}</p>}

                {g.services.length > 0 ? (
                  <div className="scrollbar-thin mt-3 max-h-28 space-y-1.5 overflow-y-auto pr-1">
                    {g.services.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs">
                        <span className="truncate font-medium">{s.title}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {s.priceFromMinor ? `from ${money(s.priceFromMinor)}` : SERVICE_CATEGORY_LABELS[s.category] ?? s.category}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">Service menu coming soon — you can still request a quote.</p>
                )}

                <div className="mt-auto flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={(e) => { e.stopPropagation(); openQuoteDialog(g) }}
                  >
                    Request a quote
                  </Button>
                  <Button
                    className="shrink-0 gap-1.5"
                    onClick={(e) => { e.stopPropagation(); navigate(`garages/${g.org.id}`) }}
                    aria-label={`View ${g.org.name} storefront`}
                  >
                    <Store className="h-4 w-4 sm:hidden" aria-hidden="true" />
                    <span className="hidden sm:inline">View storefront</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>

        {filtered && filtered.length > visible && (
          <div className="mt-6 text-center">
            <Button variant="outline" onClick={() => setVisible((v) => v + 6)}>Show more garages ({filtered.length - visible})</Button>
          </div>
        )}

        {!loading && user && (
          <p className="mt-8 text-center text-xs text-muted-foreground">
            Tip: requests you send — including from the 3D customizer — are tracked under{' '}
            <button className="underline hover:text-foreground" onClick={() => navigate('account?tab=requests')}>Account → Requests</button>.
          </p>
        )}
      </div>

      {/* Quote request dialog */}
      <Dialog open={quoteFor !== null} onOpenChange={(open) => { if (!open) setQuoteFor(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request a quote{quoteFor ? ` — ${quoteFor.org.name}` : ''}</DialogTitle>
            <DialogDescription>
              Describe the work. The garage replies with a quote in your account — you are under no obligation.
            </DialogDescription>
          </DialogHeader>
          {createdRef ? (
            <div className="space-y-4 py-2 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#315e4b]/10 text-[#315e4b]">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold">Request sent</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Reference <span className="font-mono font-semibold text-foreground">{createdRef}</span> · quotes will appear in your account.
                </p>
              </div>
              <div className="flex justify-center gap-2">
                <Button onClick={() => navigate('account?tab=requests')}>View my requests</Button>
                <Button variant="outline" onClick={() => setQuoteFor(null)}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="qr-category">Service category</Label>
                  <Select value={formCategory} onValueChange={setFormCategory}>
                    <SelectTrigger id="qr-category"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SERVICE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{SERVICE_CATEGORY_LABELS[c]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qr-vehicle">Vehicle</Label>
                  <Input id="qr-vehicle" value={vehicleDesc} onChange={(e) => setVehicleDesc(e.target.value)} placeholder="e.g. Toyota Prado 2018" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qr-desc">What do you need?</Label>
                <Textarea
                  id="qr-desc"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the work — symptoms, parts, preferences. Minimum 15 characters."
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="qr-county">County</Label>
                  <Select value={fCounty} onValueChange={setFCounty}>
                    <SelectTrigger id="qr-county"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qr-town">Town / area (optional)</Label>
                  <Input id="qr-town" value={town} onChange={(e) => setTown(e.target.value)} placeholder="e.g. Westlands" />
                </div>
              </div>
            </div>
          )}
          {!createdRef && (
            <DialogFooter>
              <Button variant="ghost" onClick={() => setQuoteFor(null)}>Cancel</Button>
              <Button onClick={submitQuoteRequest} disabled={sending || description.trim().length < 15}>
                <Sparkles className="mr-1 h-4 w-4" /> {sending ? 'Sending…' : 'Send request'}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Stars({ avg }: { avg: number }) {
  const rounded = Math.round(avg)
  return (
    <span className="flex" aria-label={`Rated ${avg.toFixed(1)} out of 5`} role="img">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i <= rounded ? 'fill-[#c9a45c] text-[#c9a45c]' : 'text-muted-foreground/40'}`}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}
