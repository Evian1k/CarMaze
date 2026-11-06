'use client'

/* SubscriptionsPanel: the customer's centralised subscription dashboard
 * section (Account ▸ Subscriptions). Shows business memberships with live
 * per-benefit redemption state, Trusted Customer Programme labels (with the
 * honest privacy story), credit facilities with a real ledger, and every
 * membership invoice/receipt. All numbers come from
 * GET /api/account/subscriptions: nothing is invented client-side. */

import { useCallback, useEffect, useState } from 'react'
import {
  BadgeCheck, CalendarClock, ChevronDown, CircleAlert, FileText,
  HandCoins, Landmark, Lock, RefreshCw, ShieldCheck, Smartphone, Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useAuth } from '@/stores/auth'
import { apiGet, apiSend, navigate } from '@/lib/client'
import { dateLabel, money, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

// ───────────────────────────── types ─────────────────────────────

type BizRef = { id: string; name: string; type: string; county: string | null; town: string | null; logoUrl: string | null }
type Redemption = { id: string; benefit: string; periodKey: string; refType: string | null; createdAt: string }
type MembershipItem = {
  id: string; refCode: string; status: string
  tierName: string; description: string | null; benefits: string[]; terms: string | null
  discountCapPct: number | null; branchScope: string
  business: BizRef
  billingPeriod: string; startedAt: string | null; currentPeriodEnd: string | null
  redemptions: Redemption[]
  invoice: { id: string; refCode: string; amountMinor: number; status: string } | null
}
type TrustProgrammeItem = {
  id: string; label: string
  programme: { name: string; description: string | null; terms: string | null }
  business: BizRef
  termsAcceptedAt: string | null
  createdAt: string
}
type CreditEntry = {
  id: string; kind: string; amountMinor: number; balanceAfterMinor: number
  refType: string | null; dueDate: string | null; paidAt: string | null; note: string | null; createdAt: string
}
type CreditFacilityItem = {
  id: string; refCode: string; status: string
  business: BizRef
  limitMinor: number; depositMinor: number
  outstandingMinor: number; availableMinor: number
  terms: string | null; termsAcceptedAt: string | null
  entries: CreditEntry[]
}
type InvoiceItem = {
  id: string; refCode: string; description: string; amountMinor: number; currency: string
  status: string; issuedAt: string; dueDate: string | null; paidAt: string | null; paidVia: string | null
}
type SubscriptionsData = {
  memberships: MembershipItem[]
  trustProgrammes: TrustProgrammeItem[]
  creditFacilities: CreditFacilityItem[]
  invoices: InvoiceItem[]
  summary: { activeMemberships: number; pendingPayments: number; totalOutstandingCredit: number }
}

// ───────────────────────── status badge colours ─────────────────────────

const MEMBERSHIP_BADGE: Record<string, string> = {
  ACTIVE: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-300',
  PENDING_PAYMENT: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  EXPIRED: 'border-border bg-muted text-muted-foreground',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
}
const INVOICE_BADGE: Record<string, string> = {
  PENDING: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  OVERDUE: 'border-rose-300 bg-rose-500/15 text-rose-800 dark:border-rose-500/40 dark:text-rose-300',
  PAID: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-300',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
  REFUNDED: 'border-border bg-muted text-muted-foreground',
}
const FACILITY_BADGE: Record<string, string> = {
  PENDING_APPLICATION: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  OFFERED: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  ACTIVE: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-300',
  SUSPENDED: 'border-rose-300 bg-rose-500/15 text-rose-800 dark:border-rose-500/40 dark:text-rose-300',
  CLOSED: 'border-border bg-muted text-muted-foreground',
  REJECTED: 'border-border bg-muted text-muted-foreground',
}
const LABEL_BADGE: Record<string, string> = {
  NEW: 'border-border bg-muted text-muted-foreground',
  REGULAR: 'border-border bg-secondary text-secondary-foreground',
  LOYAL: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  PREFERRED: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  TRUSTED: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-300',
  SUSPENDED: 'border-rose-300 bg-rose-500/15 text-rose-800 dark:border-rose-500/40 dark:text-rose-300',
}

/** Current period key as the server writes it, e.g. "2025-11". */
function currentPeriodKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// ───────────────────────────── panel ─────────────────────────────

export function SubscriptionsPanel() {
  const [data, setData] = useState<SubscriptionsData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    apiGet<SubscriptionsData>('/api/account/subscriptions')
      .then((d) => { setData(d); setError(null) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your subscriptions'))
  }, [])

  useEffect(() => { load() }, [load])

  async function cancelMembership(membershipId: string) {
    try {
      const d = await apiSend<{ message: string }>('/api/memberships/manage', 'PATCH', { membershipId })
      toast.info(d.message)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not cancel the membership')
    }
  }

  async function acceptCreditTerms(facilityId: string) {
    try {
      const d = await apiSend<{ message?: string }>(`/api/org/credit/${facilityId}`, 'PATCH', { action: 'accept-terms' })
      toast.success(d.message ?? 'Facility activated')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not accept the terms')
    }
  }

  async function repay(facilityId: string, amountMinor: number) {
    try {
      const d = await apiSend<{ outstandingMinor: number }>(`/api/org/credit/${facilityId}`, 'POST', { kind: 'REPAYMENT', amountMinor })
      toast.success(`Repayment recorded: outstanding balance ${money(d.outstandingMinor)}`)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the repayment')
    }
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><Wallet className="h-6 w-6" /></span>
          <p className="font-semibold">Subscriptions are unavailable right now</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-1 min-h-11" onClick={() => { setData(null); load() }}><RefreshCw className="h-4 w-4" /> Try again</Button>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    )
  }

  const pendingInvoiceCount = data.invoices.filter((i) => i.status === 'PENDING').length

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={<BadgeCheck className="h-5 w-5" />} label="Active memberships" value={String(data.summary.activeMemberships)} hint="Paid & valid right now" />
        <StatCard
          icon={<CircleAlert className="h-5 w-5" />}
          label="Pending payments"
          value={money(data.summary.pendingPayments)}
          hint={pendingInvoiceCount > 0 ? `${pendingInvoiceCount} unpaid invoice${pendingInvoiceCount === 1 ? '' : 's'}: pay via M-Pesa` : 'Nothing due'}
        />
        <StatCard icon={<Landmark className="h-5 w-5" />} label="Outstanding credit" value={money(data.summary.totalOutstandingCredit)} hint="Across all facilities" />
      </div>

      <MembershipsSection items={data.memberships} onCancel={cancelMembership} />

      {data.trustProgrammes.length > 0 && <TrustSection items={data.trustProgrammes} />}

      {data.creditFacilities.length > 0 && (
        <CreditSection items={data.creditFacilities} onAccept={acceptCreditTerms} onRepay={repay} />
      )}

      <InvoicesSection invoices={data.invoices} onPaid={load} />
    </div>
  )
}

// ───────────────────────────── summary ─────────────────────────────

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="truncate text-xl font-bold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────── memberships ───────────────────────────

function MembershipsSection({ items, onCancel }: { items: MembershipItem[]; onCancel: (id: string) => Promise<void> }) {
  const [pendingCancel, setPendingCancel] = useState<MembershipItem | null>(null)
  const periodKey = currentPeriodKey()

  return (
    <section aria-label="Business memberships" className="space-y-3">
      <h3 className="flex items-center gap-2 text-lg font-semibold"><HandCoins className="h-5 w-5 text-primary" /> Business memberships</h3>
      {items.length === 0 ? (
        <EmptyBlock
          icon={<HandCoins className="h-6 w-6" />}
          title="No business memberships yet"
          desc="Join a garage or showroom programme for service perks and member discounts."
          action="Browse memberships"
          onAction={() => navigate('memberships')}
        />
      ) : (
        items.map((m) => {
          const redeemedBenefits = new Set(m.redemptions.filter((r) => r.periodKey === periodKey).map((r) => r.benefit))
          const invoicePending = m.status === 'PENDING_PAYMENT' || (m.invoice && m.invoice.status === 'PENDING' && m.status !== 'CANCELLED')
          return (
            <Card key={m.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {m.tierName}
                      <Badge variant="outline" className={cn(MEMBERSHIP_BADGE[m.status] ?? MEMBERSHIP_BADGE.CANCELLED)}>
                        {m.status === 'PENDING_PAYMENT' ? 'Pending payment' : m.status.charAt(0) + m.status.slice(1).toLowerCase()}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {m.business.name} · {m.business.type === 'GARAGE' ? 'Garage' : 'Showroom'}
                      {[m.business.town, m.business.county].filter(Boolean).length > 0 && ` · ${[m.business.town, m.business.county].filter(Boolean).join(', ')}`}
                      {' '}· {m.refCode} · {m.billingPeriod.toLowerCase()} billing
                    </CardDescription>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>Started {dateLabel(m.startedAt)}</p>
                    <p>Renews {dateLabel(m.currentPeriodEnd)}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {m.description && <p className="text-sm text-muted-foreground">{m.description}</p>}

                {invoicePending && m.invoice && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:text-amber-200">
                    <Smartphone className="h-4 w-4 shrink-0" />
                    <span>
                      Invoice <strong>{m.invoice.refCode}</strong> for {money(m.invoice.amountMinor)} is awaiting payment: pay via M-Pesa to
                      activate this membership. Benefits unlock only after payment is confirmed.
                    </span>
                  </div>
                )}

                {m.benefits.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-sm font-medium">Benefits this period</p>
                    <ul className="grid gap-1.5 sm:grid-cols-2">
                      {m.benefits.map((b) => {
                        const used = redeemedBenefits.has(b)
                        const lastUsed = m.redemptions.find((r) => r.benefit === b)
                        return (
                          <li key={b} className="flex items-start justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                            <span className="flex items-start gap-1.5">
                              <BadgeCheck className={cn('mt-0.5 h-4 w-4 shrink-0', used ? 'text-primary' : 'text-muted-foreground/50')} aria-hidden />
                              {b}
                            </span>
                            <span className="shrink-0 text-right text-[11px] leading-4 text-muted-foreground">
                              {used ? 'used this period' : lastUsed ? `last used ${timeAgo(lastUsed.createdAt)}` : 'available'}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {m.discountCapPct !== null && <span>Member discount capped at {m.discountCapPct}%</span>}
                  <span>{m.branchScope === 'ALL' ? 'Valid at all branches' : 'Valid at selected branches'}</span>
                </div>

                {m.terms && (
                  <Collapsible>
                    <CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm text-primary hover:underline">
                      Membership terms <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <p className="mt-2 whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">{m.terms}</p>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {(m.status === 'ACTIVE' || m.status === 'PENDING_PAYMENT') && (
                  <>
                    <Separator />
                    <div className="flex justify-end">
                      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setPendingCancel(m)}>
                        Cancel membership
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )
        })
      )}

      <AlertDialog open={pendingCancel !== null} onOpenChange={(o) => { if (!o) setPendingCancel(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {pendingCancel?.tierName} at {pendingCancel?.business.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Benefits end immediately. Any period you have already paid for is not refunded
              automatically: the business&apos;s cancellation terms apply. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep membership</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault()
                if (pendingCancel) await onCancel(pendingCancel.id)
                setPendingCancel(null)
              }}
            >
              Cancel membership
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// ───────────────────── trusted customer programmes ─────────────────────

function TrustSection({ items }: { items: TrustProgrammeItem[] }) {
  return (
    <section aria-label="Trusted customer programmes" className="space-y-3">
      <h3 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5 text-primary" /> Trusted Customer Programmes</h3>
      {items.map((t) => (
        <Card key={t.id}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{t.programme.name}</CardTitle>
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className={cn('cursor-help', LABEL_BADGE[t.label] ?? LABEL_BADGE.NEW)}>
                      <Lock className="h-3 w-3" /> {t.label}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-64">
                    Internal relationship label set by this business; not a credit rating, never shared with other businesses.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <CardDescription>With {t.business.name} · added {timeAgo(t.createdAt)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {t.programme.description && <p className="text-sm text-muted-foreground">{t.programme.description}</p>}
            {t.programme.terms && (
              <Collapsible>
                <CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm text-primary hover:underline">
                  Programme terms <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="mt-2 whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">{t.programme.terms}</p>
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  )
}

// ───────────────────────── credit facilities ─────────────────────────

function CreditSection({ items, onAccept, onRepay }: {
  items: CreditFacilityItem[]
  onAccept: (facilityId: string) => Promise<void>
  onRepay: (facilityId: string, amountMinor: number) => Promise<void>
}) {
  const [repayTarget, setRepayTarget] = useState<CreditFacilityItem | null>(null)

  return (
    <section aria-label="Credit facilities" className="space-y-3">
      <h3 className="flex items-center gap-2 text-lg font-semibold"><Landmark className="h-5 w-5 text-primary" /> Payment facilities</h3>

      <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        Credit facilities are offered by businesses you work with. Ask your garage or showroom to send
        an offer; it appears here to accept. Applying never grants credit, and a membership never
        guarantees credit.
      </div>

      {items.map((f) => {
        const overdue = f.entries.some((e) => e.amountMinor > 0 && !e.paidAt && e.dueDate && new Date(e.dueDate) < new Date())
        const canRepay = (f.status === 'ACTIVE' || f.status === 'SUSPENDED') && f.outstandingMinor > 0
        return (
          <Card key={f.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {f.business.name}
                    <Badge variant="outline" className={cn(FACILITY_BADGE[f.status] ?? FACILITY_BADGE.CLOSED)}>
                      {f.status === 'PENDING_APPLICATION' ? 'Application pending' : f.status === 'OFFERED' ? 'Offer: awaiting your acceptance' : f.status.charAt(0) + f.status.slice(1).toLowerCase()}
                    </Badge>
                    {overdue && (
                      <Badge variant="outline" className="border-rose-300 bg-rose-500/15 text-rose-800 dark:border-rose-500/40 dark:text-rose-300">
                        <CircleAlert className="h-3 w-3" /> Overdue payment
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">{f.refCode} · {f.business.type === 'GARAGE' ? 'Garage' : 'Showroom'} facility</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MoneyStat label="Limit" value={f.limitMinor} />
                <MoneyStat label="Outstanding" value={f.outstandingMinor} strong />
                <MoneyStat label="Available" value={f.availableMinor} />
                <div className="rounded-lg border p-2.5">
                  <p className="text-xs text-muted-foreground">Deposit held</p>
                  <p className="truncate font-semibold tabular-nums">{money(f.depositMinor)}</p>
                </div>
              </div>

              {f.status === 'OFFERED' && (
                <div className="rounded-lg border border-amber-300 bg-amber-500/10 p-3 dark:border-amber-500/40">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">This business approved a facility for you</p>
                  {f.terms && <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900 dark:text-amber-200">{f.terms}</p>}
                  <p className="mt-2 text-xs text-amber-800/80 dark:text-amber-200/80">
                    Accept the repayment terms to activate it. Nothing is charged until the business records a charge, and you always see it in the ledger below.
                  </p>
                  <Button size="sm" className="mt-2 min-h-11" onClick={() => onAccept(f.id)}>Accept terms</Button>
                </div>
              )}

              {f.terms && f.status !== 'OFFERED' && (
                <Collapsible>
                  <CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    Agreed terms <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <p className="mt-2 whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">{f.terms}</p>
                  </CollapsibleContent>
                </Collapsible>
              )}

              <LedgerTable entries={f.entries.slice(0, 10)} />

              {canRepay && (
                <div className="flex justify-end">
                  <Button size="sm" className="min-h-11" onClick={() => setRepayTarget(f)}>
                    <Wallet className="h-4 w-4" /> Record a repayment
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}

      {/* Repay dialog: honest, ledger-backed */}
      {repayTarget && (
        <RepayDialog
          facility={repayTarget}
          onClose={() => setRepayTarget(null)}
          onSubmit={async (amountMinor) => {
            await onRepay(repayTarget.id, amountMinor)
            setRepayTarget(null)
          }}
        />
      )}
    </section>
  )
}

function MoneyStat({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg border p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('truncate font-semibold tabular-nums', strong && 'text-primary')}>{money(value)}</p>
    </div>
  )
}

function LedgerTable({ entries }: { entries: CreditEntry[] }) {
  if (entries.length === 0) {
    return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No ledger entries yet.</p>
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Paid</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => {
            const charge = e.kind === 'CHARGE' || e.kind === 'FEE' || e.amountMinor > 0
            return (
              <TableRow key={e.id}>
                <TableCell>
                  <span className={cn('font-medium', charge ? 'text-foreground' : 'text-emerald-700 dark:text-emerald-400')}>
                    {e.kind === 'CHARGE' ? 'Charge' : e.kind === 'REPAYMENT' ? 'Repayment' : e.kind}
                  </span>
                  {e.note && <p className="max-w-52 truncate text-xs text-muted-foreground">{e.note}</p>}
                </TableCell>
                <TableCell className={cn('text-right tabular-nums', charge ? '' : 'text-emerald-700 dark:text-emerald-400')}>
                  {charge ? '' : '−'}{money(Math.abs(e.amountMinor))}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(e.balanceAfterMinor)}</TableCell>
                <TableCell className="text-sm">{e.dueDate ? dateLabel(e.dueDate) : 'Not provided'}</TableCell>
                <TableCell className="text-sm">{e.paidAt ? dateLabel(e.paidAt) : charge ? <span className="text-amber-700 dark:text-amber-400">unpaid</span> : 'Not provided'}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function RepayDialog({ facility, onClose, onSubmit }: {
  facility: CreditFacilityItem
  onClose: () => void
  onSubmit: (amountMinor: number) => Promise<void>
}) {
  const [kes, setKes] = useState('')
  const [busy, setBusy] = useState(false)
  const parsed = Math.round(Number(kes) * 100)
  const valid = Number.isFinite(parsed) && parsed >= 100 && parsed <= facility.outstandingMinor

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a repayment: {facility.business.name}</DialogTitle>
          <DialogDescription>
            Outstanding balance {money(facility.outstandingMinor)}. Entries are appended to the ledger
            and never edited, so your statement stays verifiable.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="repay-amount">Amount (KES)</Label>
          <Input
            id="repay-amount"
            inputMode="decimal"
            value={kes}
            onChange={(e) => setKes(e.target.value)}
            placeholder={`Max ${(facility.outstandingMinor / 100).toLocaleString()}`}
          />
          {!valid && kes !== '' && (
            <p className="text-xs text-rose-600 dark:text-rose-400">Enter an amount between 1 and {(facility.outstandingMinor / 100).toLocaleString()} KES.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!valid || busy}
            className="min-h-11"
            onClick={async () => {
              setBusy(true)
              try { await onSubmit(parsed) } finally { setBusy(false) }
            }}
          >
            {busy ? 'Recording…' : `Record ${valid ? money(parsed) : 'repayment'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────────── invoices ─────────────────────────────

function InvoicesSection({ invoices, onPaid }: { invoices: InvoiceItem[]; onPaid: () => void }) {
  const { user } = useAuth()
  const [payTarget, setPayTarget] = useState<InvoiceItem | null>(null)

  return (
    <section aria-label="Invoices and receipts" className="space-y-3">
      <h3 className="flex items-center gap-2 text-lg font-semibold"><FileText className="h-5 w-5 text-primary" /> Invoices &amp; receipts</h3>
      {invoices.length === 0 ? (
        <EmptyBlock icon={<FileText className="h-6 w-6" />} title="No invoices yet" desc="Membership invoices and receipts appear here." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {invoices.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {inv.refCode}
                      <Badge variant="outline" className={cn(INVOICE_BADGE[inv.status] ?? INVOICE_BADGE.CANCELLED)}>{inv.status.charAt(0) + inv.status.slice(1).toLowerCase()}</Badge>
                    </p>
                    <p className="max-w-md truncate text-xs text-muted-foreground">{inv.description}</p>
                    <p className="text-xs text-muted-foreground">
                      Issued {dateLabel(inv.issuedAt)}{inv.dueDate ? ` · due ${dateLabel(inv.dueDate)}` : ''}{inv.paidAt ? ` · paid ${dateLabel(inv.paidAt)}${inv.paidVia ? ` via ${inv.paidVia}` : ''}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{money(inv.amountMinor, inv.currency)}</p>
                    {inv.status === 'PENDING' && (
                      <Button variant="outline" size="sm" className="mt-1 min-h-11" onClick={() => setPayTarget(inv)}>
                        <Smartphone className="h-4 w-4" /> Pay via M-Pesa
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Memberships activate only when their invoice is actually paid; pending invoices never grant benefits.
      </p>

      {payTarget && (
        <PayInvoiceDialog
          invoice={payTarget}
          defaultPhone={user?.phone ?? ''}
          onClose={() => setPayTarget(null)}
          onInitiated={() => { setPayTarget(null); onPaid() }}
        />
      )}
    </section>
  )
}

/** Real M-Pesa STK push for a pending invoice; POST /api/billing/mpesa/stkpush.
 * The callback (not this UI) marks the invoice paid; we simply tell the user
 * honestly what happened and reload. */
function PayInvoiceDialog({ invoice, defaultPhone, onClose, onInitiated }: {
  invoice: InvoiceItem
  defaultPhone: string
  onClose: () => void
  onInitiated: () => void
}) {
  const [phone, setPhone] = useState(defaultPhone)
  const [busy, setBusy] = useState(false)
  const valid = /^(\+?254|0)(1|7)\d{8}$/.test(phone.trim())

  async function pay() {
    setBusy(true)
    try {
      const d = await apiSend<{ message: string }>('/api/billing/mpesa/stkpush', 'POST', { invoiceId: invoice.id, phone: phone.trim() })
      toast.success(d.message || 'STK push sent: enter your M-Pesa PIN to complete the payment.')
      onInitiated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the M-Pesa payment')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pay {invoice.refCode}: {money(invoice.amountMinor, invoice.currency)}</DialogTitle>
          <DialogDescription>
            We send an M-Pesa STK push to your phone. The payment is only confirmed by the Safaricom
            callback: the invoice stays pending until then.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="pay-phone">M-Pesa phone number</Label>
          <Input
            id="pay-phone"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0712 345 678"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="min-h-11" disabled={!valid || busy} onClick={pay}>
            {busy ? 'Sending push…' : 'Send STK push'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────────── shared bits ─────────────────────────────

function EmptyBlock({ icon, title, desc, action, onAction }: {
  icon: React.ReactNode; title: string; desc: string; action?: string; onAction?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</span>
      <h4 className="mt-3 font-semibold">{title}</h4>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{desc}</p>
      {action && onAction && <Button className="mt-4" variant="outline" onClick={onAction}>{action}</Button>}
    </div>
  )
}
