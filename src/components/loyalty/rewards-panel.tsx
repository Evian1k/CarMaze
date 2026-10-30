'use client'

/* Rewards — the customer-facing view of CARMAZE Loyalty & Referrals.
 * Everything shown comes straight from /api/loyalty/summary: the points
 * balance, the transparent earning rules, the personal referral code/link
 * and the real points ledger. No invented balances, no purchasable points. */

import { useCallback, useEffect, useState } from 'react'
import { Gift, UserPlus, Star, Wrench, Scale, Users, Info, Copy, RefreshCw, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CountUp } from '@/components/motion/reveal'
import { apiGet } from '@/lib/client'
import { timeAgo } from '@/lib/format'

type RewardRule = { title: string; detail: string; points: number }
type LedgerEntry = {
  id: string
  points: number
  reason: string
  refType: string | null
  refId: string | null
  note: string | null
  createdAt: string
}
type LoyaltySummary = {
  points: number
  referralCode: string
  referralCount: number
  referralsAvailable: number
  entries: LedgerEntry[]
  rules: RewardRule[]
  finePrint: string
}

/** Which rule earns which icon — matched on the server's rule titles. */
const RULE_ICONS: Record<string, LucideIcon> = {
  'Invite a friend': UserPlus,
  'Share a verified garage review': Star,
  'Complete a garage service': Wrench,
}

/** Ledger reason → honest human label + icon. */
const REASON_META: Record<string, { label: string; icon: LucideIcon }> = {
  REFERRAL_SIGNUP: { label: 'Friend signed up', icon: Users },
  REVIEW_EARNED: { label: 'Review published', icon: Star },
  SERVICE_COMPLETED: { label: 'Service completed', icon: Wrench },
  ADJUSTMENT: { label: 'Adjustment', icon: Scale },
}

function reasonMeta(reason: string): { label: string; icon: LucideIcon } {
  return REASON_META[reason] ?? { label: reason.replaceAll('_', ' ').toLowerCase(), icon: Info }
}

export function RewardsPanel() {
  // Retry remounts the content component below — a fresh fetch with clean state,
  // without synchronously resetting state inside an effect.
  const [tick, setTick] = useState(0)
  const retry = useCallback(() => setTick((t) => t + 1), [])
  return <RewardsContent key={tick} onRetry={retry} />
}

function RewardsContent({ onRetry }: { onRetry: () => void }) {
  const [data, setData] = useState<LoyaltySummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<LoyaltySummary>('/api/loyalty/summary')
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your rewards') })
    return () => { cancelled = true }
  }, [])

  async function copyText(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(successMessage)
    } catch {
      toast.error('Could not copy — please copy it manually')
    }
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Gift className="h-6 w-6" />
          </span>
          <div>
            <p className="font-semibold">Rewards are unavailable right now</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
          <Button variant="outline" onClick={onRetry} className="mt-1 min-h-11">
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading rewards">
        <Skeleton className="h-40 rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    )
  }

  const shareLink = `${window.location.origin}/#/signin?ref=${encodeURIComponent(data.referralCode)}`

  return (
    <div className="space-y-4">
      {/* Points balance — deep green hero with the gold balance */}
      <Card className="overflow-hidden border-none bg-[#315E4B] text-white shadow-md">
        <CardContent className="flex flex-wrap items-center justify-between gap-6 p-6">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/10">
              <Gift className="h-7 w-7 text-[#D9B878]" aria-hidden />
            </span>
            <div>
              <p className="text-sm text-white/70">Reward points balance</p>
              <p className="text-4xl font-bold tabular-nums text-[#D9B878] sm:text-5xl">
                <CountUp value={data.points} />
              </p>
              <p className="mt-1 text-xs text-white/60">Earned through real activity on CARMAZE — never bought.</p>
            </div>
          </div>
          <div className="rounded-lg bg-white/10 px-4 py-3 text-sm">
            <p className="text-white/70">Friends who joined with your link</p>
            <p className="text-2xl font-bold tabular-nums">{data.referralCount}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* How to earn — the transparent rules served by the API */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">How to earn</CardTitle>
            <CardDescription>The complete list — there are no hidden ways to earn.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.rules.map((rule) => {
              const Icon = RULE_ICONS[rule.title] ?? Info
              return (
                <div key={rule.title} className="flex items-start gap-3 rounded-lg border p-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/30 text-primary">
                    <Icon className="h-4.5 w-4.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{rule.title}</p>
                      <Badge className="bg-accent/40 text-primary hover:bg-accent/40">+{rule.points} pts</Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{rule.detail}</p>
                  </div>
                </div>
              )
            })}
            <p className="flex items-start gap-2 pt-1 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {data.finePrint}
            </p>
          </CardContent>
        </Card>

        {/* Referral — your code, your link, honest numbers */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Invite friends</CardTitle>
            <CardDescription>
              Share your link — you earn 500 points when a friend signs up ({data.referralsAvailable} of 50 referral bonuses remaining).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your referral code</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg border bg-muted/60 px-3 py-2.5 font-mono text-lg font-bold tracking-widest">
                  {data.referralCode}
                </code>
                <Button
                  variant="outline"
                  onClick={() => copyText(shareLink, 'Invite link copied')}
                  className="min-h-11 gap-1.5"
                  aria-label="Copy invite link"
                >
                  <Copy className="h-4 w-4" /> Copy link
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your invite link</p>
              <p className="break-all rounded-lg bg-muted/60 p-3 font-mono text-xs text-muted-foreground">{shareLink}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{data.referralCount}</span>{' '}
              {data.referralCount === 1 ? 'friend has' : 'friends have'} joined with your link so far.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Ledger — every point ever earned or spent, newest first */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Points history</CardTitle>
          <CardDescription>Every point you have earned, with the reason — newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Gift className="h-6 w-6" />
              </span>
              <h3 className="mt-3 font-semibold">No points yet</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Invite a friend with your link, review a garage after a completed service, or finish a booked job — points will show up here.
              </p>
            </div>
          ) : (
            <ul className="scrollbar-thin max-h-96 space-y-2 overflow-y-auto pr-1">
              {data.entries.map((entry) => {
                const meta = reasonMeta(entry.reason)
                const positive = entry.points >= 0
                const Icon = meta.icon
                return (
                  <li key={entry.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{entry.note ?? meta.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {meta.label} · {timeAgo(entry.createdAt)}
                      </p>
                    </div>
                    <span className={`shrink-0 text-sm font-bold tabular-nums ${positive ? 'text-primary' : 'text-destructive'}`}>
                      {positive ? '+' : ''}
                      {entry.points.toLocaleString()}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
