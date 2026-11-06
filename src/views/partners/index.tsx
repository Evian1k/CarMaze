'use client'

/* CARMAZE Partner Network (#/partners): public directory of verified
 * inspection, insurance, finance, towing, parts and transport partners.
 * Only businesses that completed CARMAZE human verification appear here.
 * Data: /api/partners (public), /api/partners/requests/mine (signed in).
 * Applications: /api/partners/apply: reviewed by hand, no fee to apply. */

import { useCallback, useEffect, useState } from 'react'
import {
  BadgeCheck, CheckCircle2, ClipboardList, Globe, Handshake, MapPin, MessageCircle,
  Phone, Search, SearchX, ShieldCheck, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { Reveal, Stagger, StaggerItem, HoverLift } from '@/components/motion/reveal'
import { Stars } from '@/components/storefront/parts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ApplyDialog, RequestServiceDialog, type PublicPartner } from '@/components/partners/partner-dialogs'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useAuth } from '@/stores/auth'
import { apiGet, navigate, buildQuery } from '@/lib/client'
import { KENYA_COUNTIES, timeAgo } from '@/lib/format'
import { partnerCategoryLabel, whatsappLink } from '@/lib/partners'

type Category = { value: string; label: string }

type MyRequest = {
  id: string
  refCode: string
  status: string
  county: string
  message: string
  createdAt: string
  partner: { id: string; name: string; refCode: string; category: string }
}

const REQUEST_STATUS: Record<string, { label: string; variant: 'secondary' | 'default' | 'outline' }> = {
  NEW: { label: 'New', variant: 'secondary' },
  CONTACTED: { label: 'Contacted', variant: 'default' },
  CLOSED: { label: 'Closed', variant: 'outline' },
}

const TRUST_POINTS = [
  { icon: ShieldCheck, title: 'Human verification', body: 'Every listing is checked by the CARMAZE team before it appears.' },
  { icon: Handshake, title: 'Direct introductions', body: 'We route your request to the partner; you agree terms directly.' },
  { icon: ClipboardList, title: 'Tracked referrals', body: 'Each request gets a reference code you can quote any time.' },
]

export default function PartnersView() {
  const route = useHashRoute()
  const { user } = useAuth()

  const [categories, setCategories] = useState<Category[]>([])
  const [category, setCategory] = useState<string>('ALL')
  const [county, setCounty] = useState<string>('ALL')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [feed, setFeed] = useState<{ key: string; partners: PublicPartner[] } | null>(null)
  const [tick, setTick] = useState(0)
  const [applyOpen, setApplyOpen] = useState(false)
  const [requestFor, setRequestFor] = useState<PublicPartner | null>(null)

  const reloadMine = useCallback(() => setTick((t) => t + 1), [])

  // Debounced search so typing does not hammer the API.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300)
    return () => clearTimeout(t)
  }, [qInput])

  const feedKey = `${category}|${county}|${q}`
  useEffect(() => {
    let cancelled = false
    apiGet<{ partners: PublicPartner[]; categories: Category[] }>(
      buildQuery('/api/partners', {
        category: category === 'ALL' ? undefined : category,
        county: county === 'ALL' ? undefined : county,
        q: q || undefined,
      }),
    )
      .then((d) => {
        if (cancelled) return
        setFeed({ key: feedKey, partners: d.partners })
        setCategories(d.categories)
      })
      .catch((e) => {
        if (cancelled) return
        setFeed({ key: feedKey, partners: [] })
        toast.error(e instanceof Error ? e.message : 'Could not load the partner network')
      })
    return () => { cancelled = true }
  }, [category, county, q, feedKey, route.view])

  const partners = feed && feed.key === feedKey ? feed.partners : null

  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero: deep brand green stays dark in both themes (bg-primary
          would flip to light sage in dark mode) ── */}
      <section className="bg-brand-deep text-brand-deep-foreground">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <Reveal>
            <Badge variant="outline" className="gap-1.5 border-gold/60 bg-gold/10 text-gold">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Verified businesses only
            </Badge>
            <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">CARMAZE Partner Network</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-brand-deep-foreground/80 sm:text-base">
              Verified inspection centres, insurers, vehicle finance providers, towing operators,
              parts suppliers and vehicle transporters across Kenya.{' '}
              <strong className="font-semibold text-gold">
                Only businesses that completed CARMAZE verification appear here.
              </strong>
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => setApplyOpen(true)} className="h-11 bg-gold px-6 text-gold-foreground hover:bg-gold/90">
                <Handshake className="h-4 w-4" aria-hidden="true" />
                Become a partner
              </Button>
              {user && (
                <Button
                  variant="outline"
                  onClick={() => document.getElementById('my-requests')?.scrollIntoView({ behavior: 'smooth' })}
                  className="h-11 border-brand-deep-foreground/30 bg-transparent px-6 text-brand-deep-foreground hover:bg-brand-deep-foreground/10 hover:text-brand-deep-foreground"
                >
                  <ClipboardList className="h-4 w-4" aria-hidden="true" />
                  My requests
                </Button>
              )}
            </div>
          </Reveal>
          <Reveal delay={0.12}>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {TRUST_POINTS.map((t) => (
                <div key={t.title} className="rounded-xl border border-brand-deep-foreground/15 bg-brand-deep-foreground/5 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <t.icon className="h-4 w-4 text-gold" aria-hidden="true" /> {t.title}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-brand-deep-foreground/70">{t.body}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Sticky filter row ── */}
      <div className="sticky top-16 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="scrollbar-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5" role="group" aria-label="Filter by category">
            <FilterChip active={category === 'ALL'} onClick={() => setCategory('ALL')}>All</FilterChip>
            {categories.map((c) => (
              <FilterChip key={c.value} active={category === c.value} onClick={() => setCategory(c.value)}>
                {c.label}
              </FilterChip>
            ))}
          </div>
          <div className="flex shrink-0 gap-2">
            <Select value={county} onValueChange={setCounty}>
              <SelectTrigger className="w-[170px]" aria-label="Filter by county">
                <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All counties</SelectItem>
                {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative flex-1 lg:w-56">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Search partners…"
                className="pl-8"
                aria-label="Search partners"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Directory ── */}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6" aria-label="Partner directory">
        {partners === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
          </div>
        ) : partners.length === 0 ? (
          <Reveal>
            <Card className="mx-auto max-w-xl p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <SearchX className="h-6 w-6" />
              </div>
              <h2 className="mt-3 text-lg font-semibold">
                {q || county !== 'ALL' || category !== 'ALL' ? 'No partners match those filters' : 'No verified partners yet'}
              </h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                {q || county !== 'ALL' || category !== 'ALL'
                  ? 'Try a different category, county or search term: new partners are added as verification completes.'
                  : 'The Partner Network is new and businesses are going through verification right now. Check back soon: or apply if you run one.'}
              </p>
              {(q || county !== 'ALL' || category !== 'ALL') && (
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => { setCategory('ALL'); setCounty('ALL'); setQInput('') }}
                >
                  Clear filters
                </Button>
              )}
              <div className="mt-4 border-t pt-4">
                <p className="text-sm text-muted-foreground">Run a business in this space?</p>
                <Button className="mt-2 bg-gold text-gold-foreground hover:bg-gold/90" onClick={() => setApplyOpen(true)}>
                  Apply to become a partner
                </Button>
              </div>
            </Card>
          </Reveal>
        ) : (
          <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" key={feedKey}>
            {partners.map((p) => (
              <StaggerItem key={p.id}>
                <PartnerCard
                  partner={p}
                  onRequest={() => {
                    if (!user) {
                      toast.info('Sign in to request service from a verified partner')
                      navigate('signin')
                      return
                    }
                    setRequestFor(p)
                  }}
                />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </main>

      {/* ── Become a partner ── */}
      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6" aria-label="Become a partner">
        <Reveal>
          <Card className="overflow-hidden border-0">
            <div className="grid lg:grid-cols-5">
              <CardContent className="p-6 lg:col-span-3 lg:p-8">
                <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary">
                  <Handshake className="h-3.5 w-3.5" aria-hidden="true" /> For businesses
                </Badge>
                <h2 className="mt-3 text-xl font-bold sm:text-2xl">Grow with the CARMAZE Partner Network</h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  Reach customers at the moment they need your service. Requests arrive with a
                  reference code, so every referral is traceable: and your listing only goes live
                  after our team verifies your business.
                </p>
                <ul className="mt-4 space-y-2.5">
                  {[
                    'Customers send you service requests straight from the platform',
                    'Referral counter and rating shown on your public listing',
                    'Call, WhatsApp and website links on your card',
                    'No payment is charged for applying',
                  ].map((point) => (
                    <li key={point} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <div className="bg-brand-deep p-6 text-brand-deep-foreground lg:col-span-2 lg:p-8">
                <h3 className="text-lg font-semibold">How it works</h3>
                <ol className="mt-4 space-y-3 text-sm text-brand-deep-foreground/85">
                  <li className="flex gap-2.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold text-[10px] font-bold text-gold-foreground">1</span> Apply with your business details; it takes two minutes.</li>
                  <li className="flex gap-2.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold text-[10px] font-bold text-gold-foreground">2</span> The CARMAZE team reviews and verifies your business by hand.</li>
                  <li className="flex gap-2.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold text-[10px] font-bold text-gold-foreground">3</span> Your verified listing goes live and requests start arriving.</li>
                </ol>
                <Button onClick={() => setApplyOpen(true)} className="mt-6 w-full bg-gold text-gold-foreground hover:bg-gold/90">
                  Apply now: it&apos;s free
                </Button>
                <p className="mt-3 text-center text-xs text-brand-deep-foreground/60">
                  Review is manual; listing follows verification.
                </p>
              </div>
            </div>
          </Card>
        </Reveal>
      </section>

      {/* ── My requests (signed in) ── */}
      {user && <MyRequests tick={tick} />}

      {/* ── Dialogs ── */}
      <ApplyDialog open={applyOpen} onOpenChange={setApplyOpen} onApplied={reloadMine} />
      {user && (
        <RequestServiceDialog
          partner={requestFor}
          open={requestFor !== null}
          onOpenChange={(v) => { if (!v) setRequestFor(null) }}
          user={user}
          onSent={reloadMine}
        />
      )}
    </div>
  )
}

// ─────────────────────────── Partner card ───────────────────────────

function PartnerCard({ partner: p, onRequest }: { partner: PublicPartner; onRequest: () => void }) {
  const initial = p.name.trim().charAt(0).toUpperCase() || 'P'
  return (
    <HoverLift className="h-full">
      <Card className="flex h-full flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {p.logoUrl ? (
              <img src={p.logoUrl} alt={`${p.name} logo`} className="h-11 w-11 rounded-full border object-cover" />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary" aria-hidden="true">
                {initial}
              </span>
            )}
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 font-semibold leading-tight">
                <span className="truncate">{p.name}</span>
                <BadgeCheck className="h-4 w-4 shrink-0 text-gold" aria-label="CARMAZE verified" />
              </h3>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{p.county}{p.serviceAreas.length > 0 ? ` · serves ${p.serviceAreas.slice(0, 2).join(', ')}${p.serviceAreas.length > 2 ? '…' : ''}` : ''}</span>
              </p>
            </div>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground/70">{p.refCode}</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            {partnerCategoryLabel(p.category)}
          </Badge>
          {p.rating != null ? (
            <span className="flex items-center gap-1.5">
              <Stars avg={p.rating} starClass="h-3.5 w-3.5" />
              <span className="text-xs font-medium tabular-nums">{p.rating.toFixed(1)}</span>
            </span>
          ) : (
            <Badge variant="outline" className="border-gold/60 text-[10px] text-gold-ink">New partner</Badge>
          )}
        </div>

        {p.description && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}

        <div className="mt-auto pt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={onRequest}>Request service</Button>
            {p.phone && (
              <Button size="sm" variant="outline" asChild>
                <a href={`tel:${p.phone}`} aria-label={`Call ${p.name}`}>
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" /> Call
                </a>
              </Button>
            )}
            {p.whatsapp && p.phone && (
              <Button size="sm" variant="outline" asChild>
                <a href={whatsappLink(p.phone)} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${p.name}`}>
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> WhatsApp
                </a>
              </Button>
            )}
            {p.website && (
              <Button size="sm" variant="ghost" asChild>
                <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-muted-foreground" aria-label={`Open ${p.name} website`}>
                  <Globe className="h-3.5 w-3.5" aria-hidden="true" /> Website
                </a>
              </Button>
            )}
          </div>
          <p className="mt-2.5 text-[10px] text-muted-foreground/70">
            {p.referrals > 0 ? `${p.referrals} referral request${p.referrals === 1 ? '' : 's'} via CARMAZE` : 'Verified by the CARMAZE team'}
          </p>
        </div>
      </Card>
    </HoverLift>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-primary'
      }`}
    >
      {children}
    </button>
  )
}

// ─────────────────────────── My requests ───────────────────────────

function MyRequests({ tick }: { tick: number }) {
  const [requests, setRequests] = useState<MyRequest[] | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<{ requests: MyRequest[] }>('/api/partners/requests/mine')
      .then((d) => { if (!cancelled) setRequests(d.requests) })
      .catch(() => { if (!cancelled) setRequests([]) })
    return () => { cancelled = true }
  }, [tick])

  return (
    <section id="my-requests" className="mx-auto max-w-6xl px-4 pb-12 sm:px-6" aria-label="My partner requests">
      <Reveal>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardList className="h-5 w-5 text-primary" aria-hidden="true" /> My partner requests
        </h2>
        {requests === null ? (
          <div className="mt-3 space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        ) : requests.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
            No partner requests yet. Use <strong>Request service</strong> on any verified partner and track it here.
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {requests.map((r) => {
              const status = REQUEST_STATUS[r.status] ?? { label: r.status, variant: 'outline' as const }
              return (
                <Card key={r.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge variant={status.variant} className={status.variant === 'default' ? 'bg-primary text-primary-foreground' : ''}>
                        {status.label}
                      </Badge>
                      <span className="truncate text-sm font-medium">{r.partner.name}</span>
                      <span className="text-xs text-muted-foreground">{partnerCategoryLabel(r.partner.category)}</span>
                      <span className="font-mono text-xs text-muted-foreground/70">{r.refCode}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{r.message}</p>
                </Card>
              )
            })}
          </div>
        )}
      </Reveal>
    </section>
  )
}


