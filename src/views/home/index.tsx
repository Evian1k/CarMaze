'use client'

/* CARMAZE homepage — hero, search, module showcases. All sections link into
 * the connected platform views; recent/featured listings are real DB data. */

import { useEffect, useState } from 'react'
import { Search, ShieldCheck, Wrench, LifeBuoy, Boxes, Users, Car, KeyRound, ArrowRight, Sparkles, GitCompareArrows, FolderKanban, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { VehicleCard, type VehicleCardData } from '@/components/marketplace/vehicle-card'
import { navigate, buildQuery, apiGet } from '@/lib/client'
import { BODY_TYPES, KENYA_COUNTIES } from '@/lib/format'

type HomeData = {
  recent: VehicleCardData[]
  featured: VehicleCardData[]
  stats: { publishedListings: number; verifiedDealers: number; garages: number }
}

const MODULES = [
  { icon: GitCompareArrows, title: 'Sell your car', desc: 'Free private listings with optional dealer matching — compare real offers.', href: '/sell', cta: 'List your car' },
  { icon: GitCompareArrows, title: 'Compare vehicles', desc: 'Shortlist and compare up to 3 vehicles side by side — specs, price and mileage.', href: '/cars', cta: 'Compare cars' },
  { icon: FolderKanban, title: 'DealerOS', desc: 'Dealers get inventory, enquiries, staff and follow-up tools in one dashboard.', href: '/dealer', cta: 'Dealer portal' },
  { icon: Wrench, title: 'Trusted garages', desc: 'Quotes, bookings and reviews from verified service providers.', href: '/garages', cta: 'Find a garage' },
  { icon: Sparkles, title: '3D customizer', desc: 'Visualise paint, wheels and accessories in real time — then request quotes.', href: '/customizer', cta: 'Customise now' },
  { icon: Users, title: 'Community', desc: 'Advice, owner experiences, events and showcases from Kenyan drivers.', href: '/community', cta: 'Join in' },
  { icon: LifeBuoy, title: 'Roadside help', desc: 'Connect with nearby towing and roadside providers when you are stuck.', href: '/roadside', cta: 'Get help' },
  { icon: Car, title: 'My Garage', desc: 'Your ownership records, service history and maintenance reminders.', href: '/my-garage', cta: 'Open My Garage' },
]

export default function HomeView() {
  const [q, setQ] = useState('')
  const [bodyType, setBodyType] = useState('')
  const [county, setCounty] = useState('')
  const [data, setData] = useState<HomeData | null>(null)

  useEffect(() => {
    apiGet<HomeData>('/api/vehicles/home')
      .then(setData)
      .catch(() => setData({ recent: [], featured: [], stats: { publishedListings: 0, verifiedDealers: 0, garages: 0 } }))
  }, [])

  function search(e?: React.FormEvent) {
    e?.preventDefault()
    navigate(buildQuery('cars', { q, bodyType: bodyType || undefined, county: county || undefined }))
  }

  return (
    <div>
      {/* ── Hero ── */}
      <section className="relative isolate overflow-hidden bg-[#141613]">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-70"
          style={{ backgroundImage: 'url(/images/hero.png)' }}
          role="img"
          aria-label="Luxury SUV driving on a night road in Kenya"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#141613]/95 via-[#141613]/55 to-transparent" />
        <div className="relative mx-auto flex w-full max-w-7xl flex-col justify-center px-4 py-16 sm:px-6 sm:py-24 lg:py-32">
          <Badge className="w-fit border-none bg-accent/90 text-accent-foreground">Kenya&apos;s connected automotive ecosystem</Badge>
          <h1 className="mt-4 max-w-2xl text-3xl font-bold leading-tight text-white sm:text-5xl">
            Find your next car with confidence.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-white/70 sm:text-base">
            Verified dealers, honest listings, trusted garages and real ownership tools — one ecosystem, built for Kenya.
          </p>

          {/* Prominent search */}
          <form onSubmit={search} className="mt-7 w-full max-w-3xl" role="search" aria-label="Vehicle search">
            <div className="grid grid-cols-1 gap-2 rounded-xl border border-white/15 bg-black/45 p-2 backdrop-blur-md sm:grid-cols-[1fr_auto_auto_auto]">
              <label className="sr-only" htmlFor="hero-q">Search make or model</label>
              <Input
                id="hero-q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search make or model — e.g. Prado, Demio…"
                className="h-11 border-none bg-white/10 text-white placeholder:text-white/45 focus-visible:ring-accent"
              />
              <label className="sr-only" htmlFor="hero-body">Body type</label>
              <select
                id="hero-body"
                value={bodyType}
                onChange={(e) => setBodyType(e.target.value)}
                className="h-11 rounded-md border-none bg-white/10 px-3 text-sm text-white outline-none [&>option]:text-foreground"
                aria-label="Body type"
              >
                <option value="">Any body</option>
                {BODY_TYPES.map((b) => <option key={b} value={b}>{b.charAt(0) + b.slice(1).toLowerCase()}</option>)}
              </select>
              <label className="sr-only" htmlFor="hero-county">Location</label>
              <select
                id="hero-county"
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                className="h-11 rounded-md border-none bg-white/10 px-3 text-sm text-white outline-none [&>option]:text-foreground"
                aria-label="Location"
              >
                <option value="">Anywhere</option>
                {KENYA_COUNTIES.slice(0, 12).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <Button type="submit" size="lg" className="h-11 gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                <Search className="h-4 w-4" /> Search
              </Button>
            </div>
          </form>

          {data && (
            <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/55">
              <span className="flex items-center gap-1"><Car className="h-3.5 w-3.5" /> {data.stats.publishedListings} live listings</span>
              <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> {data.stats.verifiedDealers} verified showrooms</span>
              <span className="flex items-center gap-1"><Wrench className="h-3.5 w-3.5" /> {data.stats.garages} garages on board</span>
            </p>
          )}
        </div>
      </section>

      {/* ── Featured ── */}
      <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6" aria-labelledby="featured-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="featured-heading" className="text-xl font-bold sm:text-2xl">Featured vehicles</h2>
            <p className="mt-1 text-sm text-muted-foreground">Promoted listings are always clearly labelled.</p>
          </div>
          <Button variant="ghost" onClick={() => navigate('cars')}>View all <ArrowRight className="ml-1 h-4 w-4" /></Button>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {!data
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="aspect-[16/10] rounded-xl" />)
            : data.featured.length === 0
              ? <p className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No featured vehicles right now.</p>
              : data.featured.slice(0, 4).map((v) => <VehicleCard key={v.id} v={v} />)}
        </div>
      </section>

      {/* ── Recently added ── */}
      <section className="bg-card/60 py-12" aria-labelledby="recent-heading">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="recent-heading" className="text-xl font-bold sm:text-2xl">Recently added</h2>
              <p className="mt-1 text-sm text-muted-foreground">Fresh listings from verified showrooms and private sellers.</p>
            </div>
            <Button variant="ghost" onClick={() => navigate('cars')}>Browse all <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {!data
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="aspect-[16/10] rounded-xl" />)
              : data.recent.slice(0, 8).map((v) => <VehicleCard key={v.id} v={v} />)}
          </div>
        </div>
      </section>

      {/* ── Modules ── */}
      <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6" aria-labelledby="modules-heading">
        <h2 id="modules-heading" className="text-xl font-bold sm:text-2xl">More than a marketplace</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Every CARMAZE module is connected — a configuration from the customizer can become a garage quote; a private listing can receive verified dealer offers.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m) => (
            <Card key={m.title} className="group flex flex-col border-border transition-shadow hover:shadow-md">
              <CardContent className="flex flex-1 flex-col p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <m.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-3 text-[15px] font-semibold">{m.title}</h3>
                <p className="mt-1 flex-1 text-sm text-muted-foreground">{m.desc}</p>
                <Button variant="link" className="mt-3 h-auto w-fit p-0 text-primary" onClick={() => navigate(m.href)}>
                  {m.cta} <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Sell / Dealer / Trust strips ── */}
      <section className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6" aria-label="Key platform promises">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl bg-[#202421] p-6 text-white">
            <KeyRound className="h-6 w-6 text-accent" />
            <h3 className="mt-3 font-semibold">Selling? Get dealer offers</h3>
            <p className="mt-1 text-sm text-white/65">List free, opt into dealer matching, and compare real offers side by side. Your contacts stay private until you decide.</p>
            <Button size="sm" className="mt-4 bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => navigate('sell')}>Start selling</Button>
          </div>
          <div className="rounded-xl bg-primary p-6 text-primary-foreground">
            <ShieldCheck className="h-6 w-6" />
            <h3 className="mt-3 font-semibold">Verification is earned</h3>
            <p className="mt-1 text-sm text-primary-foreground/80">Dealers and garages pass document and premises review before any &quot;Verified&quot; badge appears. It is never a subscription perk.</p>
            <Button size="sm" variant="outline" className="mt-4 border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground" onClick={() => navigate('info?view=safety')}>How trust works</Button>
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <Boxes className="h-6 w-6 text-primary" />
            <h3 className="mt-3 font-semibold">Run a dealership on DealerOS</h3>
            <p className="mt-1 text-sm text-muted-foreground">Inventory, enquiries, offers, staff permissions, subscriptions and follow-up automation — with real analytics from your data.</p>
            <Button size="sm" variant="outline" className="mt-4" onClick={() => navigate('dealer')}>Apply as a dealer</Button>
          </div>
        </div>
      </section>
    </div>
  )
}
