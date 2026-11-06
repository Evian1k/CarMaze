'use client'

/* CARMAZE: Business Memberships (#/memberships)
 * Public discovery of membership programmes run by verified garages and
 * showrooms. Subscribing is honest billing: it creates a PENDING membership
 * plus a PENDING invoice: benefits only unlock once M-Pesa payment is
 * actually confirmed. A membership from one business never applies to
 * another business, and branch applicability is always explicit.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck, CalendarClock, CarFront, Gauge, HandCoins, MapPin, Percent,
  Search, Store, Users, Wrench, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal'
import { useAuth } from '@/stores/auth'
import { useHashRoute } from '@/hooks/use-hash-route'
import { apiGet, apiSend, navigate } from '@/lib/client'
import { money } from '@/lib/format'
import { cn } from '@/lib/utils'

// ───────────────────────────── types ─────────────────────────────

type OrgInfo = {
  id: string; name: string; type: string; county: string | null; town: string | null
  logoUrl: string | null; coverUrl: string | null; verified: boolean
}
type BranchRef = { id: string; name: string; code: string; town: string | null; county: string | null }
type Tier = {
  id: string; name: string; description: string | null
  priceMonthlyMinor: number; priceYearlyMinor: number | null
  benefits: string[]; memberLimit: number | null; discountCapPct: number | null
  branchScope: 'ALL' | 'SELECTED'; branches: string[] | null; terms: string | null
}
type Programme = { org: OrgInfo; branches: BranchRef[]; tiers: Tier[] }

type BillingPeriod = 'MONTHLY' | 'YEARLY'
type SubscribeResult = {
  membership: { id: string; refCode: string; status: string }
  invoice: { id: string; refCode: string; amountMinor: number }
  message: string
}

const TYPE_TABS = [
  { value: 'ALL', label: 'All businesses', icon: Store },
  { value: 'GARAGE', label: 'Garages', icon: Wrench },
  { value: 'DEALER', label: 'Showrooms', icon: CarFront },
] as const

// ───────────────────────────── view ─────────────────────────────

export default function View() {
  const route = useHashRoute()
  const { user } = useAuth()

  const [query, setQuery] = useState('')
  const [type, setType] = useState<'ALL' | 'GARAGE' | 'DEALER'>('ALL')
  const [nonce, setNonce] = useState(0)
  const [programmes, setProgrammes] = useState<Programme[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTier, setActiveTier] = useState<{ programme: Programme; tier: Tier } | null>(null)

  // Debounced search: refetch whenever the query/type settles.
  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams()
      if (type !== 'ALL') qs.set('type', type)
      if (query.trim()) qs.set('q', query.trim())
      const suffix = qs.toString()
      apiGet<{ programmes: Programme[] }>(`/api/memberships${suffix ? `?${suffix}` : ''}`)
        .then((d) => { setProgrammes(d.programmes); setError(null) })
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load memberships'))
    }, 300)
    return () => clearTimeout(t)
  }, [query, type, nonce, route.view])

  const tierCount = useMemo(() => programmes?.reduce((n, p) => n + p.tiers.length, 0) ?? 0, [programmes])

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <Reveal>
        <header className="mb-6">
          <Badge variant="outline" className="mb-3 gap-1 text-primary">
            <HandCoins className="h-3.5 w-3.5" /> Membership programmes
          </Badge>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Business Memberships</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Join a garage or showroom membership programme: predictable service perks, member
            discounts and priority treatment: with the real terms and limits published up front.
          </p>
        </header>
      </Reveal>

      {/* Search + type filter */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search businesses by name…"
            aria-label="Search membership programmes"
            className="h-11 pl-9 pr-9"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div role="tablist" aria-label="Business type" className="flex gap-1.5">
          {TYPE_TABS.map((t) => (
            <button
              key={t.value}
              role="tab"
              aria-selected={type === t.value}
              onClick={() => setType(t.value)}
              className={cn(
                'inline-flex h-11 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors',
                type === t.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Store className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">Could not load membership programmes</p>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" className="mt-2 h-11 px-6" onClick={() => { setError(null); setProgrammes(null); setNonce((n) => n + 1) }}>Reload</Button>
          </CardContent>
        </Card>
      ) : !programmes ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-6">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-12 w-12 rounded-lg" />
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-44" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                </div>
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-9 w-36" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : programmes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Search className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No membership programmes match</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {query || type !== 'ALL'
                ? 'Try a different name or widen the filter; verified garages and showrooms publish programmes as they launch them.'
                : 'No verified business has published a membership programme yet. Check back soon.'}
            </p>
            {(query || type !== 'ALL') && (
              <Button variant="outline" className="mt-1 h-11" onClick={() => { setQuery(''); setType('ALL') }}>Clear filters</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">
            {programmes.length} {programmes.length === 1 ? 'business' : 'businesses'} · {tierCount} {tierCount === 1 ? 'tier' : 'tiers'} published
          </p>
          <Stagger className="grid gap-4 lg:grid-cols-2">
            {programmes.map((p) => (
              <StaggerItem key={p.org.id}>
                <ProgrammeCard programme={p} onViewTier={(tier) => setActiveTier({ programme: p, tier })} />
              </StaggerItem>
            ))}
          </Stagger>
        </>
      )}

      {/* One dialog instance driven by state; survives card re-renders. */}
      {activeTier && (
        <TierDialog
          programme={activeTier.programme}
          tier={activeTier.tier}
          signedIn={Boolean(user)}
          onClose={() => setActiveTier(null)}
        />
      )}

      <footer className="mt-10 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">How CARMAZE memberships work</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>Membership activates when payment is confirmed: never on a promise. Pay the invoice via M-Pesa from your subscriptions dashboard.</li>
          <li><strong className="text-foreground">A membership from one business never applies to another.</strong> Benefits, discounts and credit treatment stay entirely with the business you joined.</li>
          <li>Branch applicability is shown per tier: some tiers are valid only at selected branches.</li>
        </ul>
      </footer>
    </div>
  )
}

// ─────────────────────── programme card ───────────────────────

function ProgrammeCard({ programme, onViewTier }: { programme: Programme; onViewTier: (tier: Tier) => void }) {
  const { org, branches, tiers } = programme
  const place = [org.town, org.county].filter(Boolean).join(', ')
  return (
    <Card className="cmz-gloss flex h-full flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
      <CardContent className="flex flex-1 flex-col gap-4 p-6">
        <div className="flex items-start gap-3">
          <OrgAvatar name={org.name} url={org.logoUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold">{org.name}</h2>
              <Badge variant="outline" className="gap-1 text-primary"><BadgeCheck className="h-3.5 w-3.5" /> Verified</Badge>
              <Badge variant="secondary" className="gap-1">
                {org.type === 'GARAGE' ? <Wrench className="h-3 w-3" /> : <CarFront className="h-3 w-3" />}
                {org.type === 'GARAGE' ? 'Garage' : 'Showroom'}
              </Badge>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" /> {place || 'Kenya'}
              {branches.length > 0 && <> · {branches.length} {branches.length === 1 ? 'branch' : 'branches'}</>}
            </p>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          {tiers.map((tier) => (
            <TierRow key={tier.id} tier={tier} branchCount={branches.length} onView={() => onViewTier(tier)} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function TierRow({ tier, branchCount, onView }: { tier: Tier; branchCount: number; onView: () => void }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{tier.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{tier.memberLimit ? `limit ${tier.memberLimit}` : 'unlimited members'}</span>
            {tier.discountCapPct !== null && (
              <span className="inline-flex items-center gap-1"><Percent className="h-3 w-3" />up to {tier.discountCapPct}% off</span>
            )}
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {tier.branchScope === 'ALL' ? `all ${branchCount} branches` : 'selected branches'}
            </span>
          </p>
        </div>
        <div className="text-right">
          <p className="font-bold text-primary">{money(tier.priceMonthlyMinor)}<span className="text-xs font-normal text-muted-foreground">/mo</span></p>
          {tier.priceYearlyMinor !== null && (
            <p className="text-xs text-muted-foreground">{money(tier.priceYearlyMinor)}/yr</p>
          )}
        </div>
      </div>
      {tier.benefits.length > 0 && (
        <ul className="mt-2 space-y-1">
          {tier.benefits.slice(0, 3).map((b, i) => (
            <li key={i} className="flex items-start gap-1.5 text-sm text-foreground/85">
              <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /> <span className="line-clamp-1">{b}</span>
            </li>
          ))}
          {tier.benefits.length > 3 && <li className="pl-5 text-xs text-muted-foreground">+{tier.benefits.length - 3} more benefits</li>}
        </ul>
      )}
      <Button variant="outline" size="sm" className="mt-3 min-h-11 w-full sm:w-auto" onClick={onView}>
        View details &amp; subscribe
      </Button>
    </div>
  )
}

function OrgAvatar({ name, url, size = 'sm' }: { name: string; url: string | null; size?: 'sm' | 'lg' }) {
  const dims = size === 'lg' ? 'h-12 w-12 text-lg' : 'h-10 w-10 text-sm'
  if (url) {
    return (
      <span className={cn('relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-card', dims)}>
        <img src={url} alt={`${name} logo`} className="h-full w-full object-cover" loading="lazy" />
      </span>
    )
  }
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center rounded-lg border bg-muted font-bold text-muted-foreground', dims)}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  )
}

// ─────────────────────── tier dialog ───────────────────────

function TierDialog({ programme, tier, signedIn, onClose }: {
  programme: Programme
  tier: Tier
  signedIn: boolean
  onClose: () => void
}) {
  const [period, setPeriod] = useState<BillingPeriod>('MONTHLY')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState<SubscribeResult | null>(null)
  const [alreadyMember, setAlreadyMember] = useState<string | null>(null)

  const monthly = tier.priceMonthlyMinor
  const yearly = tier.priceYearlyMinor
  const saving = yearly !== null ? Math.max(0, monthly * 12 - yearly) : null
  const savingPct = saving !== null && monthly > 0 ? Math.round((saving / (monthly * 12)) * 100) : null

  const selectedBranchNames = useMemo(() => {
    if (tier.branchScope !== 'SELECTED' || !tier.branches) return []
    const byId = new Map(programme.branches.map((b) => [b.id, b]))
    return tier.branches.map((id) => byId.get(id)).filter((b): b is BranchRef => Boolean(b))
  }, [tier, programme.branches])

  async function subscribe() {
    if (!signedIn) {
      navigate('signin?mode=register')
      return
    }
    setBusy(true)
    try {
      const d = await apiSend<SubscribeResult>('/api/memberships/subscribe', 'POST', { tierId: tier.id, billingPeriod: period })
      setSuccess(d)
    } catch (e) {
      const code = (e as { code?: string }).code
      const message = e instanceof Error ? e.message : 'Could not subscribe'
      if (code === 'ALREADY_MEMBER' || code === 'TIER_FULL') {
        setAlreadyMember(message)
      } else {
        toast.error(message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-lg">
        {success ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-primary" /> Subscription created
              </DialogTitle>
              <DialogDescription>
                {programme.org.name} · {tier.name} · {success.membership.refCode}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/50 p-4 text-sm">
                <p className="font-medium">Invoice {success.invoice.refCode}: {money(success.invoice.amountMinor)}</p>
                <p className="mt-1 text-muted-foreground">{success.message}</p>
              </div>
              <p className="rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:text-amber-200">
                Membership activates when payment is confirmed: pay the invoice via M-Pesa from your
                subscriptions dashboard. Benefits unlock only after confirmation.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button onClick={() => navigate('account?tab=subscriptions')}>Open subscriptions</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{tier.name}</DialogTitle>
              <DialogDescription>
                {programme.org.name} · {[programme.org.town, programme.org.county].filter(Boolean).join(', ') || 'Kenya'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {tier.description && <p className="text-sm text-foreground/85">{tier.description}</p>}

              {/* Terms: prominent, exactly as the business published them */}
              {tier.terms && (
                <div className="rounded-lg border border-amber-300 bg-amber-500/10 p-3 dark:border-amber-500/40">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">Terms: read before subscribing</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900 dark:text-amber-200">{tier.terms}</p>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold">Benefits</h4>
                <ul className="mt-2 space-y-1.5">
                  {tier.benefits.map((b, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> {b}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-2">
                <p className="flex items-center gap-1.5"><Gauge className="h-4 w-4 text-muted-foreground" /> Discount cap: {tier.discountCapPct !== null ? `${tier.discountCapPct}%` : 'none published'}</p>
                <p className="flex items-center gap-1.5"><Users className="h-4 w-4 text-muted-foreground" /> Member limit: {tier.memberLimit ?? 'unlimited'}</p>
                <div className="sm:col-span-2">
                  <p className="flex items-start gap-1.5">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>
                      Valid at:{' '}
                      {tier.branchScope === 'ALL'
                        ? `all branches of ${programme.org.name}${programme.branches.length > 0 ? ` (${programme.branches.map((b) => b.name).join(', ')})` : ''}`
                        : selectedBranchNames.length > 0
                          ? selectedBranchNames.map((b) => b.name).join(', ')
                          : 'selected branches (ask the business for the current list)'}
                    </span>
                  </p>
                </div>
              </div>

              {/* Billing period */}
              <div className="space-y-2">
                <Label htmlFor="billing-period">Billing period</Label>
                <Select value={period} onValueChange={(v) => setPeriod(v as BillingPeriod)}>
                  <SelectTrigger id="billing-period" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTHLY">Monthly: {money(monthly)}</SelectItem>
                    <SelectItem value="YEARLY">
                      Yearly: {money(yearly ?? monthly * 10)}
                      {saving !== null && savingPct !== null && savingPct > 0 ? ` · save ${savingPct}%` : ''}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {period === 'YEARLY' && (
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    {saving !== null && saving > 0
                      ? `Yearly saves you ${money(saving)} versus paying monthly for 12 months.`
                      : yearly === null
                        ? 'This business has not published a yearly price; yearly is billed as 10× the monthly price (2 months free).'
                        : 'Same price as 12 monthly payments.'}
                  </p>
                )}
              </div>

              {alreadyMember && (
                <div className="rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:text-amber-200" role="alert">
                  {alreadyMember}
                  <Button variant="link" className="h-auto p-0 pl-1 text-amber-800 underline dark:text-amber-200" onClick={() => navigate('account?tab=subscriptions')}>
                    Open your subscriptions dashboard
                  </Button>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={subscribe} disabled={busy} className="min-h-11">
                {busy ? 'Creating subscription…' : signedIn ? `Subscribe: ${money(period === 'YEARLY' ? yearly ?? monthly * 10 : monthly)}` : 'Sign in to subscribe'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
