'use client'

/* MembershipsManager: business-side manager for its customer membership
 * programme (GarageOS / DealerOS). Includes the tier builder, the members
 * table with benefit-redemption recording, and: via internal tabs: the
 * Trust Programme and Credit Facility managers. Only garages and showrooms
 * offer customer memberships, so the component renders nothing otherwise. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive, BadgeCheck, CalendarClock, CircleAlert, Gift, HandCoins, MapPin,
  Pencil, Percent, Plus, RefreshCw, Stamp, Store, Users, Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { TrustManager, CreditManager } from '@/components/biz/trust-credit-manager'
import { apiGet, apiSend } from '@/lib/client'
import { dateLabel, money, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

// ───────────────────────────── types ─────────────────────────────

type Tier = {
  id: string; orgId: string; name: string; description: string | null
  priceMonthlyMinor: number; priceYearlyMinor: number | null
  benefits: string[]; memberLimit: number | null; discountCapPct: number | null
  branchScope: 'ALL' | 'SELECTED'; branches: string[] | null; terms: string | null
  active: boolean; createdAt: string; updatedAt: string
  memberCount: number
}
type MemberRedemption = { id: string; benefit: string; periodKey: string; refType: string | null; createdAt: string }
type Member = {
  id: string; refCode: string; status: string; tier: string
  customer: { id: string; name: string; phone: string | null }
  billingPeriod: string; startedAt: string | null; currentPeriodEnd: string | null
  redemptions: MemberRedemption[]
}
type BranchRow = { id: string; name: string; code: string; kind: string; status: string; town: string | null; county: string }
type ManagerData = {
  tiers: Tier[]
  members: Member[]
  revenue: { grossMinor: number; paidCount: number; pendingCount: number; platformFeePct: number }
  activeCount: number
}

const MEMBER_BADGE: Record<string, string> = {
  ACTIVE: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-300',
  PENDING_PAYMENT: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  EXPIRED: 'border-border bg-muted text-muted-foreground',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
}

function kesToMinor(input: string): number | null {
  const n = Number(input)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

// ───────────────────────────── manager ─────────────────────────────

export function MembershipsManager({ orgId, orgType }: { orgId: string; orgType: string }) {
  if (orgType !== 'GARAGE' && orgType !== 'DEALER') {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
          <Store className="h-5 w-5 shrink-0" />
          Customer memberships are offered by garages and showrooms. Suppliers manage customer terms elsewhere.
        </CardContent>
      </Card>
    )
  }
  return <MembershipsTabs orgId={orgId} />
}

function MembershipsTabs({ orgId }: { orgId: string }) {
  return (
    <Tabs defaultValue="programme" className="mt-2">
      <TabsList className="scrollbar-thin h-auto w-full justify-start overflow-x-auto py-0.5">
        <TabsTrigger value="programme" className="gap-1.5"><HandCoins className="h-4 w-4" /> Tiers &amp; members</TabsTrigger>
        <TabsTrigger value="trust" className="gap-1.5"><BadgeCheck className="h-4 w-4" /> Trust programme</TabsTrigger>
        <TabsTrigger value="credit" className="gap-1.5"><Percent className="h-4 w-4" /> Credit facilities</TabsTrigger>
      </TabsList>
      <TabsContent value="programme" className="mt-4">
        <ProgrammeTab orgId={orgId} />
      </TabsContent>
      <TabsContent value="trust" className="mt-4">
        <TrustManager orgId={orgId} />
      </TabsContent>
      <TabsContent value="credit" className="mt-4">
        <CreditManager orgId={orgId} />
      </TabsContent>
    </Tabs>
  )
}

// ─────────────────────────── programme tab ───────────────────────────

function ProgrammeTab({ orgId }: { orgId: string }) {
  const [data, setData] = useState<ManagerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [editTier, setEditTier] = useState<Tier | null>(null)
  const [archiveTier, setArchiveTier] = useState<Tier | null>(null)
  const [redeemFor, setRedeemFor] = useState<Member | null>(null)

  const load = useCallback(() => {
    apiGet<ManagerData>(`/api/org/memberships?orgId=${orgId}`)
      .then((d) => { setData(d); setError(null) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the membership programme'))
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function toggleTierActive(tier: Tier, active: boolean) {
    try {
      await apiSend(`/api/org/memberships/${tier.id}`, 'PATCH', { active })
      toast.success(active ? `${tier.name} is live again` : `${tier.name} hidden from discovery`)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the tier')
    }
  }

  async function doArchive(tier: Tier) {
    try {
      await apiSend(`/api/org/memberships/${tier.id}`, 'DELETE')
      toast.success(`${tier.name} archived: existing members keep their terms`)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not archive the tier')
    }
  }

  async function recordRedemption(membershipId: string, benefit: string, refType?: string) {
    try {
      await apiSend('/api/org/memberships/redeem', 'POST', { membershipId, benefit, ...(refType ? { refType } : {}) })
      toast.success('Benefit redemption recorded')
      load()
      return true
    } catch (e) {
      const code = (e as { code?: string }).code
      toast.error(e instanceof Error ? e.message : 'Could not record the redemption', {
        description: code === 'ALREADY_REDEEMED' ? 'This benefit was already redeemed for the current period.' : undefined,
      })
      return false
    }
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CircleAlert className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">Could not load the membership programme</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="min-h-11" onClick={() => { setData(null); load() }}><RefreshCw className="h-4 w-4" /> Try again</Button>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Revenue stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<HandCoins className="h-5 w-5" />} label="Gross revenue (paid)" value={money(data.revenue.grossMinor)} />
        <StatCard icon={<BadgeCheck className="h-5 w-5" />} label="Paid invoices" value={String(data.revenue.paidCount)} />
        <StatCard icon={<CalendarClock className="h-5 w-5" />} label="Pending payments" value={String(data.revenue.pendingCount)} hint="Activate after M-Pesa confirmation" />
        <StatCard icon={<Users className="h-5 w-5" />} label="Active members" value={String(data.activeCount)} />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        CARMAZE charges a {data.revenue.platformFeePct}% platform fee on membership payments. Members only become active when their invoice is actually paid.
      </p>

      {/* Tiers */}
      <section aria-label="Membership tiers" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">Membership tiers</h3>
          <Button className="min-h-11" onClick={() => setBuilderOpen(true)}><Plus className="h-4 w-4" /> New tier</Button>
        </div>
        {data.tiers.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <Gift className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 font-medium">No tiers yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Build your first tier: name it, set the price and benefits, and it appears instantly on the public
              Business Memberships page for customers to subscribe to.
            </p>
            <Button variant="outline" className="mt-4 min-h-11" onClick={() => setBuilderOpen(true)}>Create a tier</Button>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.tiers.map((t) => (
              <Card key={t.id} className={cn(!t.active && 'opacity-70')}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">{t.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant={t.active ? 'default' : 'outline'}>{t.active ? 'Live' : 'Archived'}</Badge>
                      <Badge variant="outline" className="gap-1"><Users className="h-3 w-3" /> {t.memberCount}</Badge>
                    </div>
                  </div>
                  <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold text-foreground">{money(t.priceMonthlyMinor)}/mo</span>
                    {t.priceYearlyMinor !== null && <span>{money(t.priceYearlyMinor)}/yr</span>}
                    {t.memberLimit !== null && <span>· limit {t.memberLimit}</span>}
                    {t.discountCapPct !== null && <span>· discount cap {t.discountCapPct}%</span>}
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{t.branchScope === 'ALL' ? 'all branches' : `${t.branches?.length ?? 0} selected branches`}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
                  <ul className="space-y-1">
                    {t.benefits.map((b, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-sm">
                        <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /> {b}
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={t.active}
                        onCheckedChange={(v) => toggleTierActive(t, v)}
                        aria-label={t.active ? 'Hide from discovery' : 'Publish to discovery'}
                      />
                      <span className="text-xs text-muted-foreground">{t.active ? 'On public discovery' : 'Hidden'}</span>
                    </div>
                    <div className="flex gap-1.5">
                      <Button variant="outline" size="sm" className="min-h-11" onClick={() => setEditTier(t)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="min-h-11 text-muted-foreground hover:text-destructive" onClick={() => setArchiveTier(t)}>
                        <Archive className="h-3.5 w-3.5" /> Archive
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Members */}
      <section aria-label="Members" className="space-y-3">
        <h3 className="text-lg font-semibold">Members</h3>
        {data.members.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 font-medium">No members yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              When customers subscribe to your tiers, they appear here with their billing status and benefit usage.
            </p>
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto scrollbar-thin">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Period end</TableHead>
                      <TableHead>Recent redemptions</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.members.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <p className="font-medium">{m.customer.name}</p>
                          <p className="text-xs text-muted-foreground">{m.customer.phone ?? 'Not provided'}</p>
                        </TableCell>
                        <TableCell>
                          <p>{m.tier}</p>
                          <p className="text-xs text-muted-foreground">{m.billingPeriod.toLowerCase()} · {m.refCode}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(MEMBER_BADGE[m.status] ?? MEMBER_BADGE.CANCELLED)}>
                            {m.status === 'PENDING_PAYMENT' ? 'Pending' : m.status.charAt(0) + m.status.slice(1).toLowerCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{dateLabel(m.currentPeriodEnd)}</TableCell>
                        <TableCell>
                          {m.redemptions.length === 0 ? (
                            <span className="text-xs text-muted-foreground">None this period</span>
                          ) : (
                            <div className="space-y-0.5">
                              {m.redemptions.slice(0, 2).map((r) => (
                                <p key={r.id} className="max-w-52 truncate text-xs">
                                  <Stamp className="mr-1 inline h-3 w-3 text-primary" aria-hidden />
                                  {r.benefit} <span className="text-muted-foreground">({r.periodKey})</span>
                                </p>
                              ))}
                              {m.redemptions.length > 2 && (
                                <p className="text-xs text-muted-foreground">+{m.redemptions.length - 2} earlier</p>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11"
                            disabled={m.status !== 'ACTIVE'}
                            onClick={() => setRedeemFor(m)}
                          >
                            <Gift className="h-3.5 w-3.5" /> Record redemption
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Dialogs */}
      {builderOpen && (
        <TierBuilderDialog
          orgId={orgId}
          onClose={() => setBuilderOpen(false)}
          onSaved={() => { setBuilderOpen(false); load() }}
        />
      )}
      {editTier && (
        <TierBuilderDialog
          orgId={orgId}
          tier={editTier}
          onClose={() => setEditTier(null)}
          onSaved={() => { setEditTier(null); load() }}
        />
      )}
      {archiveTier && (
        <AlertDialog open onOpenChange={(o) => { if (!o) setArchiveTier(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive “{archiveTier.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                The tier disappears from public discovery immediately. Existing members keep their
                benefits for the period they paid for. You can re-publish it any time by switching
                the archived tier back on.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep tier</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={async (e) => { e.preventDefault(); await doArchive(archiveTier); setArchiveTier(null) }}
              >
                Archive tier
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {redeemFor && data.tiers.length > 0 && (
        <RedeemDialog
          member={redeemFor}
          tier={data.tiers.find((t) => t.name === redeemFor.tier) ?? null}
          onClose={() => setRedeemFor(null)}
          onSubmit={async (benefit, refType) => {
            const okResult = await recordRedemption(redeemFor.id, benefit, refType)
            if (okResult) setRedeemFor(null)
          }}
        />
      )}
    </div>
  )
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="truncate text-xl font-bold tabular-nums">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

// ───────────────────────── tier builder dialog ─────────────────────────

type BuilderForm = {
  name: string
  description: string
  priceMonthly: string
  priceYearly: string
  benefitsText: string
  memberLimit: string
  discountCapPct: string
  branchScope: 'ALL' | 'SELECTED'
  branchIds: string[]
  terms: string
}

function TierBuilderDialog({ orgId, tier, onClose, onSaved }: {
  orgId: string
  tier?: Tier
  onClose: () => void
  onSaved: () => void
}) {
  const editing = Boolean(tier)
  const [form, setForm] = useState<BuilderForm>({
    name: tier?.name ?? '',
    description: tier?.description ?? '',
    priceMonthly: tier ? String(tier.priceMonthlyMinor / 100) : '',
    priceYearly: tier?.priceYearlyMinor != null ? String(tier.priceYearlyMinor / 100) : '',
    benefitsText: tier ? tier.benefits.join('\n') : '',
    memberLimit: tier?.memberLimit != null ? String(tier.memberLimit) : '',
    discountCapPct: tier?.discountCapPct != null ? String(tier.discountCapPct) : '',
    branchScope: tier?.branchScope ?? 'ALL',
    branchIds: tier?.branches ?? [],
    terms: tier?.terms ?? '',
  })
  const [branches, setBranches] = useState<BranchRow[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    apiGet<{ branches: BranchRow[] }>(`/api/supply/branches?orgId=${orgId}`)
      .then((d) => setBranches(d.branches))
      .catch(() => setBranches([]))
  }, [orgId])

  const benefits = useMemo(
    () => form.benefitsText.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 12),
    [form.benefitsText]
  )
  const monthlyMinor = kesToMinor(form.priceMonthly)
  const yearlyMinor = form.priceYearly.trim() === '' ? null : kesToMinor(form.priceYearly)
  const limitNum = form.memberLimit.trim() === '' ? null : Number(form.memberLimit)
  const capNum = form.discountCapPct.trim() === '' ? null : Number(form.discountCapPct)
  const valid =
    form.name.trim().length >= 2 &&
    monthlyMinor !== null &&
    benefits.length >= 1 &&
    (limitNum === null || (Number.isInteger(limitNum) && limitNum >= 1)) &&
    (capNum === null || (Number.isInteger(capNum) && capNum >= 0 && capNum <= 80)) &&
    (form.branchScope === 'ALL' || form.branchIds.length > 0)

  async function save() {
    if (monthlyMinor === null) return
    setBusy(true)
    try {
      if (editing && tier) {
        await apiSend(`/api/org/memberships/${tier.id}`, 'PATCH', {
          name: form.name.trim(),
          description: form.description.trim() || null,
          priceMonthlyMinor: monthlyMinor,
          priceYearlyMinor: yearlyMinor,
          benefits,
          memberLimit: limitNum,
          discountCapPct: capNum,
          branchScope: form.branchScope,
          branches: form.branchScope === 'SELECTED' ? form.branchIds : null,
          terms: form.terms.trim() || null,
        })
        toast.success(`${form.name.trim()} updated`)
      } else {
        await apiSend('/api/org/memberships', 'POST', {
          orgId,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          priceMonthlyMinor: monthlyMinor,
          priceYearlyMinor: yearlyMinor ?? undefined,
          benefits,
          memberLimit: limitNum ?? undefined,
          discountCapPct: capNum ?? undefined,
          branchScope: form.branchScope,
          branches: form.branchScope === 'SELECTED' ? form.branchIds : undefined,
          terms: form.terms.trim() || undefined,
        })
        toast.success(`${form.name.trim()} published: customers can subscribe now`)
      }
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the tier')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${tier?.name}` : 'New membership tier'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Changes apply to new subscribers. Existing members keep the terms they paid for.'
              : 'Publish a tier to the public Business Memberships page. Be honest about limits: they are shown to customers exactly as entered.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tier-name">Tier name</Label>
              <Input id="tier-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Service Club" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tier-monthly">Monthly (KES)</Label>
                <Input id="tier-monthly" inputMode="decimal" value={form.priceMonthly} onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })} placeholder="2500" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tier-yearly">Yearly (KES)</Label>
                <Input id="tier-yearly" inputMode="decimal" value={form.priceYearly} onChange={(e) => setForm({ ...form, priceYearly: e.target.value })} placeholder="optional" />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tier-desc">Description</Label>
            <Input id="tier-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="One line explaining who this tier is for" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tier-benefits">Benefits: one per line ({benefits.length}/12)</Label>
            <Textarea
              id="tier-benefits"
              rows={4}
              value={form.benefitsText}
              onChange={(e) => setForm({ ...form, benefitsText: e.target.value })}
              placeholder={'2 free oil changes per month\n10% off all parts\nPriority booking'}
            />
            {benefits.length === 0 && <p className="text-xs text-rose-600 dark:text-rose-400">At least one benefit is required.</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="tier-limit">Member limit</Label>
              <Input id="tier-limit" inputMode="numeric" value={form.memberLimit} onChange={(e) => setForm({ ...form, memberLimit: e.target.value })} placeholder="unlimited" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tier-cap">Discount cap (%)</Label>
              <Input id="tier-cap" inputMode="numeric" value={form.discountCapPct} onChange={(e) => setForm({ ...form, discountCapPct: e.target.value })} placeholder="e.g. 15" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Branch applicability</Label>
            <Select value={form.branchScope} onValueChange={(v) => setForm({ ...form, branchScope: v as 'ALL' | 'SELECTED' })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All branches</SelectItem>
                <SelectItem value="SELECTED">Selected branches only</SelectItem>
              </SelectContent>
            </Select>
            {form.branchScope === 'SELECTED' && (
              branches === null ? (
                <Skeleton className="h-20 rounded-lg" />
              ) : branches.length === 0 ? (
                <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                  No active branches yet: create branches first, or keep the scope on “All branches”.
                </p>
              ) : (
                <div className="max-h-44 space-y-1.5 overflow-y-auto scrollbar-thin rounded-lg border p-2.5">
                  {branches.map((b) => (
                    <label key={b.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.branchIds.includes(b.id)}
                        onCheckedChange={(v) =>
                          setForm((f) => ({ ...f, branchIds: v ? [...f.branchIds, b.id] : f.branchIds.filter((id) => id !== b.id) }))
                        }
                      />
                      {b.name} <span className="text-xs text-muted-foreground">{b.code} · {b.town ?? b.county}</span>
                    </label>
                  ))}
                </div>
              )
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tier-terms">Terms (shown prominently to customers)</Label>
            <Textarea
              id="tier-terms"
              rows={3}
              value={form.terms}
              onChange={(e) => setForm({ ...form, terms: e.target.value })}
              placeholder="e.g. Benefits are valid at participating branches only. Discounts cannot be combined with other promotions."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="min-h-11" disabled={!valid || busy} onClick={save}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Publish tier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────── redeem dialog ─────────────────────────

function RedeemDialog({ member, tier, onClose, onSubmit }: {
  member: Member
  tier: Tier | null
  onClose: () => void
  onSubmit: (benefit: string, refType?: string) => Promise<void>
}) {
  const [benefit, setBenefit] = useState('')
  const [refType, setRefType] = useState('')
  const [busy, setBusy] = useState(false)

  const periodKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const alreadyThisPeriod = new Set(member.redemptions.filter((r) => r.periodKey === periodKey).map((r) => r.benefit))
  const available = tier ? tier.benefits.filter((b) => !alreadyThisPeriod.has(b)) : []

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record redemption: {member.customer.name}</DialogTitle>
          <DialogDescription>
            {member.tier} · {member.refCode}. One redemption per benefit per billing period is
            enforced by the ledger: duplicates are rejected.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {tier === null ? (
            <p className="rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:text-amber-200">
              The tier “{member.tier}” no longer exists in your programme (it may have been archived).
              Redemptions can only be recorded against current tier benefits.
            </p>
          ) : available.length === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              All benefits of this tier have already been redeemed for the current period ({periodKey}).
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Benefit</Label>
                <Select value={benefit} onValueChange={setBenefit}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select the benefit being used" /></SelectTrigger>
                  <SelectContent>
                    {available.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="redeem-ref">Reference (optional)</Label>
                <Input id="redeem-ref" value={refType} onChange={(e) => setRefType(e.target.value)} placeholder="e.g. booking ref, invoice ref" />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="min-h-11"
            disabled={benefit === '' || busy}
            onClick={async () => { setBusy(true); try { await onSubmit(benefit, refType.trim() || undefined) } finally { setBusy(false) } }}
          >
            {busy ? 'Recording…' : 'Record redemption'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
