'use client'

/* Spend analytics: computed client-side from the real purchase-order feed.
 * These are PURCHASES (garage spend on parts), never revenue. Monthly bars
 * are plain CSS divs; CSV export is a client-side blob download. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Download, Wallet, Receipt, TrendingUp, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { apiGet, ClientApiError } from '@/lib/client'
import { money, compactMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  EmptyState, type OrdersResponse, type OrderListItem,
} from './shared'

const SPEND_EXCLUDED = ['CANCELLED', 'REJECTED']
const MONTHS_SHOWN = 12

export function SpendTab({ orgId }: { orgId: string }) {
  const [orders, setOrders] = useState<OrderListItem[] | null>(null)

  const load = useCallback(() => {
    let stale = false
    apiGet<OrdersResponse>(`/api/supply/orders?orgId=${encodeURIComponent(orgId)}`)
      .then((d) => { if (!stale) setOrders(d.orders) })
      .catch((e: unknown) => {
        if (stale) return
        setOrders([])
        toast.error(e instanceof ClientApiError ? e.message : 'Could not load spend data.')
      })
    return () => { stale = true }
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    return load()
  }, [orgId, load])

  const analysis = useMemo(() => analyse(orders ?? []), [orders])

  function exportCsv() {
    if (!orders) return
    const header = ['refCode', 'createdAt', 'supplier', 'status', 'paymentStatus', 'lines', 'subtotalMinor', 'taxMinor', 'deliveryFeeMinor', 'totalMinor', 'currency']
    const rows = orders.map((o) => [
      o.refCode,
      new Date(o.createdAt).toISOString(),
      `"${o.supplier.name.replaceAll('"', '""')}"`,
      o.status,
      o.paymentStatus,
      String(o.itemCount),
      String(o.subtotalMinor),
      String(o.taxMinor),
      String(o.deliveryFeeMinor),
      String(o.totalMinor),
      o.currency,
    ].join(','))
    const csv = [header.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `procurement-spend-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success('CSV exported: amounts are in minor units (cents).')
  }

  return (
    <div className="space-y-4">
      <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200 [&>svg]:text-amber-500">
        <Info className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Purchases, not revenue</AlertTitle>
        <AlertDescription>
          Everything on this page is money the garage <span className="font-semibold">spends</span> on parts and services; your outbound procurement spend. Cancelled and rejected orders are excluded.
        </AlertDescription>
      </Alert>

      {orders === null ? (
        <div className="space-y-3">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No spend recorded yet"
          description="Once purchase orders are created, monthly spend, supplier breakdown and averages appear here."
        />
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="border-border bg-card p-4">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Receipt className="h-3.5 w-3.5" aria-hidden="true" /> Total purchases</span>
              <span className="mt-1 block text-2xl font-bold tabular-nums">{money(analysis.totalSpend)}</span>
              <span className="text-xs text-muted-foreground">{analysis.countedOrders} purchase order{analysis.countedOrders === 1 ? '' : 's'} counted</span>
            </Card>
            <Card className="border-border bg-card p-4">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> Average order value</span>
              <span className="mt-1 block text-2xl font-bold tabular-nums">{money(analysis.avgOrder)}</span>
              <span className="text-xs text-muted-foreground">across counted orders</span>
            </Card>
            <Card className="border-border bg-card p-4">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Wallet className="h-3.5 w-3.5" aria-hidden="true" /> Busiest supplier</span>
              <span className="mt-1 block truncate text-lg font-bold">{analysis.topSupplier?.name ?? 'Not set'}</span>
              <span className="text-xs text-muted-foreground">{analysis.topSupplier ? `${money(analysis.topSupplier.total)} · ${analysis.topSupplier.count} order(s)` : ''}</span>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* Monthly bars */}
            <Card className="border-border bg-card">
              <CardHeader className="p-4 sm:pb-3">
                <CardTitle className="text-base">Monthly spend</CardTitle>
                <CardDescription>Last {MONTHS_SHOWN} months (order totals incl. tax & delivery)</CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="flex h-48 items-end gap-1.5" role="img" aria-label="Monthly purchase spend bar chart">
                  {analysis.months.map((m) => {
                    const pct = analysis.maxMonth > 0 ? Math.max(2, Math.round((m.total / analysis.maxMonth) * 100)) : 0
                    return (
                      <div key={m.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                        <span className="text-[10px] tabular-nums text-muted-foreground" title={money(m.total)}>{m.total > 0 ? compactMoney(m.total) : ''}</span>
                        <div
                          className={cn('w-full rounded-t-md transition-all', m.total > 0 ? 'bg-primary/70 hover:bg-primary' : 'bg-muted')}
                          style={{ height: `${pct}%` }}
                          title={`${m.label}: ${money(m.total)}`}
                        />
                        <span className="text-[10px] text-muted-foreground">{m.label}</span>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Spend by supplier */}
            <Card className="border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between p-4 sm:pb-3">
                <div>
                  <CardTitle className="text-base">Spend by supplier</CardTitle>
                  <CardDescription>Where the parts money goes</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={exportCsv}>
                  <Download className="mr-1.5 h-4 w-4" aria-hidden="true" /> Export CSV
                </Button>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <ScrollArea className="max-h-56 scrollbar-thin pr-2">
                  <ul className="space-y-2.5">
                    {analysis.bySupplier.map((s) => {
                      const pct = analysis.totalSpend > 0 ? Math.round((s.total / analysis.totalSpend) * 100) : 0
                      return (
                        <li key={s.id}>
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate">{s.name}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">{money(s.total)} · {s.count}×</span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function analyse(orders: OrderListItem[]) {
  const counted = orders.filter((o) => !SPEND_EXCLUDED.includes(o.status))
  const totalSpend = counted.reduce((s, o) => s + o.totalMinor, 0)
  const countedOrders = counted.length
  const avgOrder = countedOrders > 0 ? Math.round(totalSpend / countedOrders) : 0

  // monthly buckets: oldest first, 12 buckets ending this month
  const now = new Date()
  const months: { key: string; label: string; total: number }[] = []
  for (let i = MONTHS_SHOWN - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-KE', { month: 'short' }), total: 0 })
  }
  const monthIndex = new Map(months.map((m) => [m.key, m]))
  for (const o of counted) {
    const d = new Date(o.createdAt)
    const m = monthIndex.get(`${d.getFullYear()}-${d.getMonth()}`)
    if (m) m.total += o.totalMinor
  }
  const maxMonth = Math.max(...months.map((m) => m.total), 0)

  const supplierMap = new Map<string, { id: string; name: string; total: number; count: number }>()
  for (const o of counted) {
    const s = supplierMap.get(o.supplier.id) ?? { id: o.supplier.id, name: o.supplier.name, total: 0, count: 0 }
    s.total += o.totalMinor
    s.count += 1
    supplierMap.set(o.supplier.id, s)
  }
  const bySupplier = [...supplierMap.values()].sort((a, b) => b.total - a.total)

  return { totalSpend, countedOrders, avgOrder, months, maxMonth, bySupplier, topSupplier: bySupplier[0] ?? null }
}
