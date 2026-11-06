'use client'

/* Overview tab: procurement workbench stats computed from the real order
 * feed, the garage's low-stock alert list, and quick reorder from the most
 * recent completed order. */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ClipboardList, Hourglass, Truck, PackageCheck, Wallet, ShoppingCart, BellRing,
  History, Trash2, PackageOpen, Store, FileQuestion,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { apiGet, apiSend, ClientApiError } from '@/lib/client'
import { money, compactMoney } from '@/lib/format'
import { useCart } from '@/stores/cart'
import { cn } from '@/lib/utils'
import {
  Img, StatCard, EmptyState, BtnSpinner, When, canApprove,
  type OrdersResponse, type OrderListItem, type StockAlertRow,
} from './shared'

const OPEN_STATUSES = ['SUBMITTED', 'AWAITING_APPROVAL', 'ACCEPTED', 'REVISED', 'CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED']
const SPEND_EXCLUDED = ['CANCELLED', 'REJECTED']

export function OverviewTab({ orgId, role, onNav, onBrowse, onRequestPart }: {
  orgId: string
  role: string
  onNav: (tab: string) => void
  onBrowse: () => void
  onRequestPart: () => void
}) {
  const [orders, setOrders] = useState<OrderListItem[] | null>(null)
  const [alerts, setAlerts] = useState<StockAlertRow[] | null>(null)
  const [removingId, setRemovingId] = useState('')

  const loadOrders = useCallback(() => {
    let stale = false
    apiGet<OrdersResponse>(`/api/supply/orders?orgId=${encodeURIComponent(orgId)}`)
      .then((d) => { if (!stale) setOrders(d.orders) })
      .catch(() => { if (!stale) setOrders([]) })
    return () => { stale = true }
  }, [orgId])

  const loadAlerts = useCallback(() => {
    let stale = false
    apiGet<{ alerts: StockAlertRow[] }>('/api/supply/alerts')
      .then((d) => { if (!stale) setAlerts(d.alerts) })
      .catch(() => { if (!stale) setAlerts([]) })
    return () => { stale = true }
  }, [])

  useEffect(() => {
    if (!orgId) return
    return loadOrders()
  }, [orgId, loadOrders])

  useEffect(() => {
    return loadAlerts()
  }, [loadAlerts])

  const stats = computeStats(orders ?? [])
  const quickReorder = (orders ?? []).find((o) => o.status === 'COMPLETED') ?? null

  async function removeAlert(productId: string, name: string) {
    setRemovingId(productId)
    try {
      await apiSend(`/api/supply/alerts?productId=${encodeURIComponent(productId)}`, 'DELETE')
      toast.success(`Stock alert removed: ${name}`)
      loadAlerts()
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Could not remove the alert.')
    } finally {
      setRemovingId('')
    }
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {orders === null ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
            <StatCard icon={ClipboardList} label="Open orders" value={stats.open} sub="active with suppliers" onClick={() => onNav('orders')} />
            <StatCard icon={Hourglass} label="Awaiting approval" value={stats.awaitingApproval} sub={canApprove(role) ? 'needs owner/GM sign-off' : 'owner/GM sign-off'} accent={stats.awaitingApproval > 0} onClick={() => onNav(canApprove(role) ? 'approvals' : 'orders')} />
            <StatCard icon={Truck} label="Dispatched / in transit" value={stats.transit} sub="on the way to you" onClick={() => onNav('orders')} />
            <StatCard icon={PackageCheck} label="Delivered: inspect" value={stats.delivered} sub="inspection releases payment" accent={stats.delivered > 0} onClick={() => onNav('orders')} />
            <StatCard icon={Wallet} label="Spend this month" value={compactMoney(stats.monthSpend)} sub="purchase orders created" onClick={() => onNav('spend')} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Stock alerts */}
        <Card className="border-border bg-card">
          <CardHeader className="p-4 sm:p-6 sm:pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="h-4 w-4 text-primary" aria-hidden="true" /> Stock alerts
              {alerts && alerts.length > 0 && <Badge variant="secondary">{alerts.length}</Badge>}
            </CardTitle>
            <CardDescription>Products your garage flagged for re-ordering. Availability is live from supplier warehouses.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            {alerts === null ? (
              <div className="space-y-2"><Skeleton className="h-14 rounded-lg" /><Skeleton className="h-14 rounded-lg" /></div>
            ) : alerts.length === 0 ? (
              <EmptyState
                icon={PackageOpen}
                title="No stock alerts"
                description="Alerts you create appear here with one-tap reorder. (Alerts are created from the supplier storefront.)"
              >
                <Button variant="outline" onClick={onBrowse}><Store className="mr-1.5 h-4 w-4" aria-hidden="true" /> Browse catalogue</Button>
              </EmptyState>
            ) : (
              <ScrollArea className="max-h-96 scrollbar-thin pr-2">
                <ul className="space-y-2">
                  {alerts.map((a) => {
                    const below = a.product.availableQty < a.minQty
                    return (
                      <li key={a.id} className={cn('flex items-center gap-3 rounded-lg border p-2.5', below ? 'border-amber-500/40 bg-amber-500/5' : 'border-border bg-background/40')}>
                        <Img src={a.product.image} alt={a.product.name} className="h-11 w-11 shrink-0 rounded-md border border-border" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{a.product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            SKU {a.product.sku} · {a.product.supplier.name}
                            {a.product.supplier.verified && <span className="text-primary"> ✓</span>}
                          </p>
                          <p className={cn('text-xs', below ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                            {a.product.availableQty} available · alert at {a.minQty} · {money(a.product.unitPriceMinor, a.product.currency)}
                          </p>
                        </div>
                        <AddToCartButton product={{ id: a.product.id, name: a.product.name, sku: a.product.sku, unitPriceMinor: a.product.unitPriceMinor, supplierId: a.product.supplier.id, supplierName: a.product.supplier.name, image: a.product.image, availableQty: a.product.availableQty }} disabled={a.product.availableQty <= 0} />
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Remove alert for ${a.product.name}`} disabled={removingId === a.product.id} onClick={() => removeAlert(a.product.id, a.product.name)}>
                          {removingId === a.product.id ? <BtnSpinner /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Quick reorder */}
        <Card className="border-border bg-card">
          <CardHeader className="p-4 sm:p-6 sm:pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" aria-hidden="true" /> Quick reorder
            </CardTitle>
            <CardDescription>
              {quickReorder
                ? <>Most recent completed order <span className="font-mono text-foreground">{quickReorder.refCode}</span> from <When at={quickReorder.createdAt} />.</>
                : 'Your last completed order appears here for one-tap re-ordering.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            {orders === null ? (
              <div className="space-y-2"><Skeleton className="h-14 rounded-lg" /><Skeleton className="h-14 rounded-lg" /></div>
            ) : !quickReorder ? (
              <EmptyState
                icon={FileQuestion}
                title="No completed orders yet"
                description="Once an order goes through delivery, inspection and payment release, its lines appear here."
              >
                <Button variant="outline" onClick={onBrowse}><Store className="mr-1.5 h-4 w-4" aria-hidden="true" /> Browse catalogue</Button>
                <Button variant="ghost" onClick={onRequestPart}><FileQuestion className="mr-1.5 h-4 w-4" aria-hidden="true" /> Request a part</Button>
              </EmptyState>
            ) : (
              <ScrollArea className="max-h-96 scrollbar-thin pr-2">
                <ul className="space-y-2">
                  {quickReorder.items.map((it) => (
                    <li key={it.id} className="flex items-center gap-3 rounded-lg border border-border bg-background/40 p-2.5">
                      <Img src={it.image} alt={it.name} className="h-11 w-11 shrink-0 rounded-md border border-border" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{it.name}</p>
                        <p className="text-xs text-muted-foreground">SKU {it.sku} · {money(it.unitPriceMinor)} × {it.qty}{it.qtyAccepted != null && it.qtyAccepted !== it.qty ? ` · accepted ${it.qtyAccepted}` : ''}</p>
                      </div>
                      <AddToCartButton
                        product={{ id: it.productId, name: it.name, sku: it.sku, unitPriceMinor: it.unitPriceMinor, supplierId: quickReorder.supplier.id, supplierName: quickReorder.supplier.name, image: it.image }}
                      />
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function AddToCartButton({ product, disabled }: {
  product: { id: string; name: string; sku: string; unitPriceMinor: number; supplierId: string; supplierName: string; image: string | null; availableQty?: number }
  disabled?: boolean
}) {
  const add = useCart((s) => s.add)
  return (
    <Button
      size="sm" className="shrink-0" disabled={disabled}
      onClick={() => {
        add({
          productId: product.id, name: product.name, sku: product.sku,
          unitPriceMinor: product.unitPriceMinor,
          supplierId: product.supplierId, supplierName: product.supplierName,
          image: product.image, availableQty: product.availableQty,
        })
        toast.success(`${product.name} added to cart`, { description: `Supplier: ${product.supplierName}` })
      }}
    >
      <ShoppingCart className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add
    </Button>
  )
}

function computeStats(orders: OrderListItem[]) {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  let open = 0
  let awaitingApproval = 0
  let transit = 0
  let delivered = 0
  let monthSpend = 0
  for (const o of orders) {
    if (OPEN_STATUSES.includes(o.status)) open += 1
    if (o.status === 'AWAITING_APPROVAL') awaitingApproval += 1
    if (o.status === 'DISPATCHED' || o.status === 'IN_TRANSIT') transit += 1
    if (o.status === 'DELIVERED') delivered += 1
    if (new Date(o.createdAt).getTime() >= monthStart && !SPEND_EXCLUDED.includes(o.status)) {
      monthSpend += o.totalMinor
    }
  }
  return { open, awaitingApproval, transit, delivered, monthSpend }
}
