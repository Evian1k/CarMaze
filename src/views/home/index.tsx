'use client'

/* CARMAZE homepage: hero, search, module showcases. All sections link into
 * the connected platform views; recent/featured listings are real DB data.
 * Motion: parallax hero, scroll-reveal sections, animated counters and a
 * trust marquee: all reduced-motion aware. */

import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { Search, ShieldCheck, Wrench, LifeBuoy, Boxes, Users, Car, KeyRound, ArrowRight, Sparkles, GitCompareArrows, FolderKanban, BadgeCheck, Camera, Timer, HeartHandshake, Fuel, LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { VehicleCard, type VehicleCardData } from '@/components/marketplace/vehicle-card'
import { CountUp, Reveal, Stagger, StaggerItem, WordRise } from '@/components/motion/reveal'
import { navigate, buildQuery, apiGet } from '@/lib/client'
import { BODY_TYPES, KENYA_COUNTIES } from '@/lib/format'

type HomeData = {
  recent: VehicleCardData[]
  featured: VehicleCardData[]
  stats: { publishedListings: number; verifiedDealers: number; garages: number }
}

/** Admin-configurable hero copy (SystemSetting "home_hero"). */
type HeroCopy = { headline: string; subheadline: string; ctaLabel?: string; ctaHref?: string }

/** Built-in copy: shown verbatim whenever no admin has configured the hero. */
const DEFAULT_HERO: HeroCopy = {
  headline: 'Find your next car with confidence.',
  subheadline: 'Verified dealers, honest listings, trusted garages and real ownership tools: one ecosystem, built for Kenya.',
}

const MODULES = [
  { icon: GitCompareArrows, title: 'Sell your car', desc: 'Free private listings with optional dealer matching; compare real offers.', href: '/sell', cta: 'List your car' },
  { icon: GitCompareArrows, title: 'Compare vehicles', desc: 'Shortlist and compare up to 3 vehicles side by side; specs, price and mileage.', href: '/cars', cta: 'Compare cars' },
  { icon: FolderKanban, title: 'DealerOS', desc: 'Dealers get inventory, enquiries, staff and follow-up tools in one dashboard.', href: '/dealer', cta: 'Dealer portal' },
  { icon: Wrench, title: 'Trusted garages', desc: 'Quotes, bookings and reviews from verified service providers.', href: '/garages', cta: 'Find a garage' },
  { icon: Sparkles, title: '3D customizer', desc: 'Visualise paint, wheels and accessories in real time: then request quotes.', href: '/customizer', cta: 'Customise now' },
  { icon: Users, title: 'Community', desc: 'Advice, owner experiences, events and showcases from Kenyan drivers.', href: '/community', cta: 'Join in' },
  { icon: LifeBuoy, title: 'Roadside help', desc: 'Connect with nearby towing and roadside providers when you are stuck.', href: '/roadside', cta: 'Get help' },
  { icon: Car, title: 'My Garage', desc: 'Your ownership records, service history and maintenance reminders.', href: '/my-garage', cta: 'Open My Garage' },
]

const TRUST_POINTS = [
  { icon: BadgeCheck, label: 'Verification is earned, never bought' },
  { icon: Camera, label: 'Real photos, real listings' },
  { icon: ShieldCheck, label: 'Dealer & garage document review' },
  { icon: HeartHandshake, label: 'Your contacts stay private' },
  { icon: Timer, label: 'Follow-ups that never go quiet' },
  { icon: Fuel, label: 'Honest prices in KES' },
]

export default function HomeView() {
  const [q, setQ] = useState('')
  const [bodyType, setBodyType] = useState('')
  const [county, setCounty] = useState('')
  const [data, setData] = useState<HomeData | null>(null)
  const [hero, setHero] = useState<HeroCopy>(DEFAULT_HERO)
  const heroRef = useRef<HTMLElement>(null)
  const reduce = useReducedMotion()

  // Hero parallax: background drifts slower than content as you scroll.
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] })
  const bgY = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '18%'])
  const fgY = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '36%'])
  const fgFade = useTransform(scrollYProgress, [0, 0.85], [1, 0.15])

  useEffect(() => {
    apiGet<HomeData>('/api/vehicles/home')
      .then(setData)
      .catch(() => setData({ recent: [], featured: [], stats: { publishedListings: 0, verifiedDealers: 0, garages: 0 } }))
    // Optional admin-configured hero copy: falls back to DEFAULT_HERO when unset.
    apiGet<{ hero: HeroCopy | null }>('/api/settings/home-hero')
      .then((d) => {
        if (d.hero) setHero(d.hero)
      })
      .catch(() => {})
  }, [])

  // Two-tone headline: every word except the last rises in white, the final
  // word is the gold accent (same pattern as the built-in hero).
  const headlineWords = hero.headline.split(' ')
  const headlineMain = headlineWords.slice(0, -1).join(' ')
  const headlineAccent = headlineWords[headlineWords.length - 1] ?? ''

  function search(e?: React.FormEvent) {
    e?.preventDefault()
    navigate(buildQuery('cars', { q, bodyType: bodyType || undefined, county: county || undefined }))
  }

  return (
    <div>
      {/* ── Hero ── */}
      <section ref={heroRef} className="cmz-aurora relative isolate overflow-hidden bg-[#141613]">
        <motion.div
          className="cmz-img-reveal absolute inset-0 bg-cover bg-center opacity-70 will-change-transform"
          style={{ backgroundImage: 'url(/images/hero.png)', y: bgY, scale: reduce ? 1 : 1.08 }}
          role="img"
          aria-label="Luxury SUV driving on a night road in Kenya"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#141613]/95 via-[#141613]/55 to-transparent" />
        {/* slow headlight sweep across the hero */}
        {!reduce && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            <div className="cmz-headlight absolute -top-1/4 left-0 h-[150%] w-48 bg-gradient-to-r from-transparent via-white/6 to-transparent blur-lg" />
          </div>
        )}
        <motion.div style={{ y: fgY, opacity: fgFade }} className="relative mx-auto flex w-full max-w-7xl flex-col justify-center px-4 py-16 sm:px-6 sm:py-24 lg:py-32">
          <Badge className="cmz-float w-fit border-none bg-accent/90 text-accent-foreground">Kenya&apos;s connected automotive ecosystem</Badge>
          <h1 className="mt-4 max-w-2xl text-3xl font-bold leading-tight text-white sm:text-5xl">
            {headlineMain ? <WordRise text={headlineMain} delay={0.12} /> : null}
            {headlineMain ? ' ' : null}
            <span className="text-[#D9B878]">
              <WordRise text={headlineAccent} delay={0.12 + (headlineWords.length - 1) * 0.055} />
            </span>
          </h1>
          <motion.p
            className="mt-3 max-w-xl text-sm text-white/70 sm:text-base"
            initial={reduce ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
          >
            {hero.subheadline}
          </motion.p>

          {hero.ctaLabel && hero.ctaHref ? (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
            >
              <Button
                size="lg"
                className="mt-4 h-11 bg-accent text-accent-foreground transition-transform hover:bg-accent/90 active:scale-[0.97]"
                onClick={() => navigate(hero.ctaHref as string)}
              >
                {hero.ctaLabel} <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </motion.div>
          ) : null}

          {/* Prominent search */}
          <motion.form
            onSubmit={search}
            className="mt-7 w-full max-w-3xl"
            role="search"
            aria-label="Vehicle search"
            initial={reduce ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className="grid grid-cols-1 gap-2 rounded-xl border border-white/15 bg-black/45 p-2 backdrop-blur-md sm:grid-cols-[1fr_auto_auto_auto]">
              <label className="sr-only" htmlFor="hero-q">Search make or model</label>
              <Input
                id="hero-q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search make or model: e.g. Prado, Demio…"
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
              <Button type="submit" size="lg" className="cmz-sheen h-11 gap-2 bg-primary text-primary-foreground transition-transform hover:bg-primary/90 active:scale-[0.97]">
                <Search className="h-4 w-4" /> Search
              </Button>
            </div>
          </motion.form>

          {data && (
            <motion.dl
              className="mt-6 flex flex-wrap gap-x-8 gap-y-3"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55, duration: 0.7 }}
            >
              {[
                { label: 'live listings', value: data.stats.publishedListings, icon: Car },
                { label: 'verified showrooms', value: data.stats.verifiedDealers, icon: ShieldCheck },
                { label: 'garages on board', value: data.stats.garages, icon: Wrench },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-2 text-white/85">
                  <s.icon className="h-4 w-4 text-[#D9B878]" aria-hidden />
                  <span className="text-lg font-bold">
                    <CountUp value={s.value} />
                  </span>
                  <span className="text-xs text-white/55">{s.label}</span>
                </div>
              ))}
            </motion.dl>
          )}
        </motion.div>
      </section>

      {/* ── Trust marquee ── */}
      <section className="border-y border-border bg-card/80 py-3.5" aria-label="Our promises">
        <div className="cmz-marquee-paused relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
          <div className="cmz-marquee-track flex w-max items-center gap-10 pr-10">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex items-center gap-10" aria-hidden={copy === 1}>
                {TRUST_POINTS.map((t) => (
                  <span key={t.label} className="flex items-center gap-2 whitespace-nowrap text-xs font-medium text-muted-foreground">
                    <t.icon className="h-4 w-4 text-primary" aria-hidden /> {t.label}
                    <span className="ml-6 h-1 w-1 rounded-full bg-[#D9B878]" aria-hidden />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Featured ── */}
      <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6" aria-labelledby="featured-heading">
        <Reveal>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="featured-heading" className="text-xl font-bold sm:text-2xl">Featured vehicles</h2>
              <p className="mt-1 text-sm text-muted-foreground">Promoted listings are always clearly labelled.</p>
            </div>
            <Button variant="ghost" onClick={() => navigate('cars')}>View all <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </Reveal>
        {/* key forces a fresh mount once data lands; variants propagate to real cards */}
        <Stagger key={data ? 'featured-loaded' : 'featured-loading'} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {!data
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="cmz-shimmer aspect-[16/10] rounded-xl" />)
            : data.featured.length === 0
              ? <p className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No featured vehicles right now.</p>
              : data.featured.slice(0, 4).map((v) => (
                  <StaggerItem key={v.id}><VehicleCard v={v} /></StaggerItem>
                ))}
        </Stagger>
      </section>

      {/* ── Recently added ── */}
      <section className="bg-card/60 py-12" aria-labelledby="recent-heading">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <Reveal>
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 id="recent-heading" className="text-xl font-bold sm:text-2xl">Recently added</h2>
                <p className="mt-1 text-sm text-muted-foreground">Fresh listings from verified showrooms and private sellers.</p>
              </div>
              <Button variant="ghost" onClick={() => navigate('cars')}>Browse all <ArrowRight className="ml-1 h-4 w-4" /></Button>
            </div>
          </Reveal>
          <Stagger key={data ? 'recent-loaded' : 'recent-loading'} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {!data
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="cmz-shimmer aspect-[16/10] rounded-xl" />)
              : data.recent.length === 0
                ? <p className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No new listings yet. Check back soon or browse the full marketplace.</p>
                : data.recent.slice(0, 8).map((v) => (
                    <StaggerItem key={v.id}><VehicleCard v={v} /></StaggerItem>
                  ))}
          </Stagger>
        </div>
      </section>

      {/* ── Modules ── */}
      <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6" aria-labelledby="modules-heading">
        <Reveal>
          <h2 id="modules-heading" className="text-xl font-bold sm:text-2xl">More than a marketplace</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every CARMAZE module is connected: a configuration from the customizer can become a garage quote; a private listing can receive verified dealer offers.
          </p>
        </Reveal>
        <Stagger className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m) => (
            <StaggerItem key={m.title}>
              <Card className="cmz-gloss group flex h-full flex-col border-border transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                <CardContent className="flex flex-1 flex-col p-5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                    <m.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-3 text-[15px] font-semibold">{m.title}</h3>
                  <p className="mt-1 flex-1 text-sm text-muted-foreground">{m.desc}</p>
                  <Button variant="link" className="mt-3 h-auto w-fit p-0 text-primary" onClick={() => navigate(m.href)}>
                    {m.cta} <ArrowRight className="ml-1 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </Button>
                </CardContent>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
        <Reveal delay={0.08}>
          <div className="mt-6 flex justify-center">
            <Button variant="outline" onClick={() => navigate('platforms')} className="gap-2">
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              Explore all nine platforms
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </Reveal>
      </section>

      {/* ── Sell / Dealer / Trust strips ── */}
      <section className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6" aria-label="Key platform promises">
        <Stagger className="grid gap-4 md:grid-cols-3">
          <StaggerItem>
            <div className="cmz-gloss h-full rounded-xl bg-[#202421] p-6 text-white transition-transform duration-300 hover:-translate-y-1">
              <KeyRound className="h-6 w-6 text-accent" />
              <h3 className="mt-3 font-semibold">Selling? Get dealer offers</h3>
              <p className="mt-1 text-sm text-white/65">List free, opt into dealer matching, and compare real offers side by side. Your contacts stay private until you decide.</p>
              <Button size="sm" className="mt-4 bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => navigate('sell')}>Start selling</Button>
            </div>
          </StaggerItem>
          <StaggerItem>
            <div className="cmz-gloss h-full rounded-xl bg-brand-deep p-6 text-brand-deep-foreground transition-transform duration-300 hover:-translate-y-1">
              <ShieldCheck className="h-6 w-6" />
              <h3 className="mt-3 font-semibold">Verification is earned</h3>
              <p className="mt-1 text-sm text-brand-deep-foreground/80">Dealers and garages pass document and premises review before any &quot;Verified&quot; badge appears. It is never a subscription perk.</p>
              <Button size="sm" variant="outline" className="mt-4 border-brand-deep-foreground/30 bg-transparent text-brand-deep-foreground hover:bg-brand-deep-foreground/10 hover:text-brand-deep-foreground" onClick={() => navigate('info?view=safety')}>How trust works</Button>
            </div>
          </StaggerItem>
          <StaggerItem>
            <div className="h-full rounded-xl border border-border bg-card p-6 transition-transform duration-300 hover:-translate-y-1">
              <Boxes className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-semibold">Run a dealership on DealerOS</h3>
              <p className="mt-1 text-sm text-muted-foreground">Inventory, enquiries, offers, staff permissions, subscriptions and follow-up automation: with real analytics from your data.</p>
              <Button size="sm" variant="outline" className="mt-4" onClick={() => navigate('dealer')}>Apply as a dealer</Button>
            </div>
          </StaggerItem>
        </Stagger>
      </section>
    </div>
  )
}
