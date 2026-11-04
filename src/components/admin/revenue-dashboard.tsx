'use client'

// Super Admin — Platform revenue dashboard + central fee configuration.
// TRANSPARENCY RULE: supplier transaction value (GMV) is shown as context but
// NEVER booked as platform revenue. Platform revenue = subscriptions +
// supply commissions + promotions + membership platform fees.

import { useCallback, useEffect, useState } from 'react'
import { BadgePercent, Loader2, RefreshCw, TrendingUp, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { apiGet, apiSend } from '@/lib/client'
import { money, compactMoney } from '@/lib/format'

type RevenueData = {
  revenue: {
    platformRevenueTotalMinor: number
    platformRevenueMonthMinor: number
    arrMinor: number
    mrrMinor: number
    subscriptions: { activeCount: number; byAudience: { DEALER: number; GARAGE: number; SUPPLIER: number }; paidInvoiceTotalMinor: number; monthMinor: number }
    commissions: { totalMinor: number; monthMinor: number; supplyGmvMinor: number; releasedOrders: number; note: string }
    promotions: { totalMinor: number; monthMinor: number; count: number }
    memberships: { grossMinor: number; platformFeeMinor: number; feePct: number; note: string }
  }
  retention: {
    activeSubscriptions: number; cancelled: number; pastDue: number; churnPct: number
    failedRenewals: { refCode: string; amountMinor: number; dueDate: string | null; org: { name: string; type: string } }[]
  }
  receivables: { pendingCount: number; pendingMinor: number }
  series: { label: string; subs: number; commission: number; promo: number }[]
  fees: {
    supplyCommissionPct: number; deliveryCommissionPct: number; minCommissionMinor: number
    vehicleSaleCommissionPct: number; bookingCommissionPct: number; membershipPlatformFeePct: number
  }
}

export function AdminRevenueDashboard() {
  const [data, setData] = useState<RevenueData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fees, setFees] = useState<RevenueData['fees'] | null>(null)
  const [savingFees, setSavingFees] = useState(false)

  const load = useCallback(() => {
    setError(null)
    apiGet<RevenueData>('/api/admin/revenue')
      .then((d) => { setData(d); setFees(d.fees) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load revenue data'))
  }, [])

  useEffect(() => { load() }, [load])

  async function saveFees() {
    if (!fees) return
    setSavingFees(true)
    try {
      await apiSend('/api/admin/fees', 'PUT', fees)
      toast.success('Fee configuration saved — new orders use the updated rates.')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save fees')
    } finally {
      setSavingFees(false)
    }
  }

  if (error) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={load}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry</Button>
      </Card>
    )
  }
  if (!data || !fees) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    )
  }

  const r = data.revenue
  const chartData = data.series.map((m) => ({
    name: m.label,
    Subscriptions: Math.round(m.subs / 100),
    Commissions: Math.round(m.commission / 100),
    Promotions: Math.round(m.promo / 100),
  }))

  return (
    <div className="space-y-6">
      <Tabs defaultValue="revenue">
        <TabsList className="h-auto w-full justify-start overflow-x-auto scrollbar-thin">
          <TabsTrigger value="revenue" className="gap-1.5"><TrendingUp className="h-4 w-4" /> Revenue</TabsTrigger>
          <TabsTrigger value="retention" className="gap-1.5"><Wallet className="h-4 w-4" /> Retention & receivables</TabsTrigger>
          <TabsTrigger value="fees" className="gap-1.5"><BadgePercent className="h-4 w-4" /> Fee configuration</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Platform revenue (total)</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-primary">{compactMoney(r.platformRevenueTotalMinor)}</p>
              <p className="text-xs text-muted-foreground">subs + commissions + promos + membership fees</p>
            </Card>
            <Card className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">This month</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{compactMoney(r.platformRevenueMonthMinor)}</p>
              <p className="text-xs text-muted-foreground">confirmed payments only</p>
            </Card>
            <Card className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">MRR</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{compactMoney(r.mrrMinor)}</p>
              <p className="text-xs text-muted-foreground">ARR ≈ {compactMoney(r.arrMinor)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Active subscriptions</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{r.subscriptions.activeCount}</p>
              <p className="text-xs text-muted-foreground">
                {r.subscriptions.byAudience.DEALER} dealers · {r.subscriptions.byAudience.GARAGE} garages · {r.subscriptions.byAudience.SUPPLIER} suppliers
              </p>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Revenue by stream (6 months, KES)</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${Number(v) >= 1000 ? `${(Number(v) / 1000).toFixed(1)}k` : v}`} />
                    <Tooltip formatter={(value) => `KES ${Number(value).toLocaleString()}`} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                    <Bar dataKey="Subscriptions" fill="#315E4B" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Commissions" fill="#D9B878" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Promotions" fill="#7FA08E" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="space-y-3">
              <Card className="p-4">
                <p className="text-sm font-semibold">Transaction commissions</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-primary">{money(r.commissions.totalMinor)}</p>
                <p className="text-xs text-muted-foreground">{money(r.commissions.monthMinor)} this month · {r.commissions.releasedOrders} completed supply orders</p>
                <p className="mt-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">{r.commissions.note}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm font-semibold">Marketplace GMV (context only — not platform revenue)</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{money(r.commissions.supplyGmvMinor)}</p>
                <p className="text-xs text-muted-foreground">Supplier transaction value flowing through completed supply orders.</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm font-semibold">Promotions</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{money(r.promotions.totalMinor)}</p>
                <p className="text-xs text-muted-foreground">{r.promotions.count} paid campaigns · {money(r.promotions.monthMinor)} this month</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm font-semibold">Business memberships</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{money(r.memberships.grossMinor)} gross</p>
                <p className="text-xs text-muted-foreground">Platform fee ({r.memberships.feePct}%): {money(r.memberships.platformFeeMinor)} — membership fees belong to the businesses.</p>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="retention" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card className="p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Churn</p><p className="mt-1 text-2xl font-semibold tabular-nums">{data.retention.churnPct}%</p></Card>
            <Card className="p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cancelled</p><p className="mt-1 text-2xl font-semibold tabular-nums">{data.retention.cancelled}</p></Card>
            <Card className="p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Past due</p><p className="mt-1 text-2xl font-semibold tabular-nums">{data.retention.pastDue}</p></Card>
            <Card className="p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Failed renewals</p><p className="mt-1 text-2xl font-semibold tabular-nums">{data.retention.failedRenewals.length}</p></Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Failed / overdue renewals</CardTitle>
              <CardDescription>Pending subscription invoices past their due date — follow up with the business.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.retention.failedRenewals.length === 0 && <p className="text-sm text-muted-foreground">No failed renewals.</p>}
              {data.retention.failedRenewals.map((f) => (
                <div key={f.refCode} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                  <div>
                    <p className="font-medium">{f.refCode} · {f.org.name} <span className="text-xs text-muted-foreground">({f.org.type})</span></p>
                    {f.dueDate && <p className="text-xs text-muted-foreground">due {new Date(f.dueDate).toLocaleDateString('en-KE')}</p>}
                  </div>
                  <p className="font-semibold tabular-nums">{money(f.amountMinor)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="p-4">
            <p className="text-sm font-semibold">Outstanding platform receivables</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{money(data.receivables.pendingMinor)}</p>
            <p className="text-xs text-muted-foreground">{data.receivables.pendingCount} pending invoices (all types)</p>
          </Card>
        </TabsContent>

        <TabsContent value="fees" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Central fee & commission configuration</CardTitle>
              <CardDescription>
                Applies to new transactions immediately. Businesses see every fee before confirming a transaction; subscriptions that include reduced commission are applied automatically at settlement.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {([
                ['supplyCommissionPct', 'Supply order commission (%)'],
                ['deliveryCommissionPct', 'Delivery fee commission (%)'],
                ['vehicleSaleCommissionPct', 'Vehicle sale commission (%)'],
                ['bookingCommissionPct', 'Garage booking commission (%)'],
                ['membershipPlatformFeePct', 'Membership platform fee (%)'],
              ] as const).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`fee-${key}`}>{label}</Label>
                  <Input
                    id={`fee-${key}`}
                    inputMode="decimal"
                    value={String(fees[key])}
                    onChange={(e) => setFees({ ...fees, [key]: Number(e.target.value) || 0 })}
                  />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label htmlFor="fee-min">Minimum commission per order (KES)</Label>
                <Input
                  id="fee-min"
                  inputMode="numeric"
                  value={String(fees.minCommissionMinor / 100)}
                  onChange={(e) => setFees({ ...fees, minCommissionMinor: Math.round((Number(e.target.value) || 0) * 100) })}
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Button onClick={saveFees} disabled={savingFees}>
                  {savingFees ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save fee configuration
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
