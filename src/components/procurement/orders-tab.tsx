'use client'

/* Orders tab: the garage purchase-order list with status filter chips and
 * the full lifecycle detail dialog (order-detail.tsx). */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PackageSearch, ShieldCheck, Eye, RefreshCw, Truck, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet, ClientApiError } from '@/lib/client'
import { money, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Img, StatusChip, PaymentChip, EmptyState, BtnSpinner,
  PO_STATUS_LABELS, type OrderListItem, type OrdersResponse,
} from './shared'
import { OrderDetailDialog } from './order-detail'

const FILTER_STATUSES = [
  'AWAITING_APPROVAL', 'SUBMITTED', 'ACCEPTED', 'REVISED', 'CONFIRMED',
  'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED', 'COMPLETED', 'DISPUTED', 'CANCELLED', 'REJECTED',
]

export function OrdersTab({ orgId, role, deepLinkId }: {
  orgId: string
  role: string
  deepLinkId: string | null
}) {
  const [fetched, setFetched] = useState<{ key: string; orders: OrderListItem[] } | null>(null)
  const [filter, setFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [manualId, setManualId] = useState<string | null>(null)
  const [dismissedLink, setDismissedLink] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  const load = useCallback(() => {
    let stale = false
    apiGet<OrdersResponse>(`/api/supply/orders?orgId=${encodeURIComponent(orgId)}`)
      .then((d) => { if (!stale) { setFetched({ key: orgId, orders: d.orders }); setRefreshing(false) } })
      .catch((e: unknown) => {
        if (stale) return
        setFetched({ key: orgId, orders: [] })
        setRefreshing(false)
        toast.error(e instanceof ClientApiError ? e.message : 'Could not load your orders.')
      })
    return () => { stale = true }
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    return load()
  }, [orgId, load, reloadTick])

  const orders = fetched && fetched.key === orgId ? fetched.orders : null

  // notification deep link (?order=<id>) opens the detail straight away
  const deepLinkActive = Boolean(deepLinkId) && deepLinkId !== dismissedLink
  const detailId = manualId ?? (deepLinkActive ? deepLinkId : null)
  const closeDetail = (v: boolean) => {
    if (v) return
    setManualId(null)
    if (deepLinkActive && deepLinkId) setDismissedLink(deepLinkId)
  }

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of orders ?? []) map.set(o.status, (map.get(o.status) ?? 0) + 1)
    return map
  }, [orders])

  const visible = useMemo(() => {
    let list = orders ?? []
    if (filter !== 'ALL') list = list.filter((o) => o.status === filter)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((o) => o.refCode.toLowerCase().includes(q) || o.supplier.name.toLowerCase().includes(q))
    return list
  }, [orders, filter, search])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative lg:w-72">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by PO ref or supplier…"
            aria-label="Search orders"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => { setRefreshing(true); setReloadTick((t) => t + 1) }} disabled={refreshing}>
          {refreshing ? <BtnSpinner className="mr-1.5" /> : <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          Refresh
        </Button>
      </div>

      {/* Status chips */}
      <div className="scrollbar-thin flex gap-1.5 overflow-x-auto pb-1">
        <FilterChip active={filter === 'ALL'} onClick={() => setFilter('ALL')} label="All" count={orders?.length ?? 0} />
        {FILTER_STATUSES.map((s) =>
          (counts.get(s) ?? 0) > 0 || filter === s ? (
            <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)} label={PO_STATUS_LABELS[s] ?? s} count={counts.get(s) ?? 0} />
          ) : null
        )}
      </div>

      {orders === null ? (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title={orders.length === 0 ? 'No purchase orders yet' : 'No orders match this filter'}
          description={orders.length === 0
            ? 'Build a cart in the catalogue and check out; purchase orders are tracked here through delivery, inspection and payment release.'
            : 'Try another status chip or clear the search.'}
        />
      ) : (
        <div className="space-y-3">
          {visible.map((o) => <OrderCard key={o.id} order={o} onOpen={() => setManualId(o.id)} />)}
        </div>
      )}

      <OrderDetailDialog
        orderId={detailId ?? ''}
        open={detailId !== null}
        onOpenChange={closeDetail}
        roleFallback={role}
        onChanged={load}
      />
    </div>
  )
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
      )}
    >
      {label}
      <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', active ? 'bg-primary-foreground/20' : 'bg-muted')}>{count}</span>
    </button>
  )
}

function OrderCard({ order: o, onOpen }: { order: OrderListItem; onOpen: () => void }) {
  return (
    <Card className="border-border bg-card p-0 transition-colors hover:border-primary/40">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={onOpen} className="font-mono text-sm font-bold hover:underline">{o.refCode}</button>
              <StatusChip status={o.status} />
              <PaymentChip status={o.paymentStatus} />
              {o.revisedBySupplier && <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">Revised</Badge>}
              {o.disputeCount > 0 && <Badge variant="outline" className="border-rose-500/40 text-rose-600 dark:text-rose-400">{o.disputeCount} dispute{o.disputeCount === 1 ? '' : 's'}</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{o.supplier.name}</span>
              {o.supplier.verified && <ShieldCheck className="ml-1 inline h-3.5 w-3.5 text-primary" aria-label="Verified supplier" />}
              {' · '}{o.supplier.county} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'} · {timeAgo(o.createdAt)}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {o.destinationBranch && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden="true" />{o.destinationBranch.name}</span>}
              {o.delivery && <span className="inline-flex items-center gap-1"><Truck className="h-3 w-3" aria-hidden="true" />{o.delivery.method} · {o.delivery.status}</span>}
              {o.payment && <span>Payment: {o.payment.status}</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              {o.items.slice(0, 3).map((it) => (
                <Img key={it.id} src={it.image} alt={it.name} className="h-9 w-9 rounded border border-border" />
              ))}
              {o.items.length > 3 && (
                <span className="flex h-9 w-9 items-center justify-center rounded border border-border bg-muted text-[10px] text-muted-foreground">
                  +{o.items.length - 3}
                </span>
              )}
            </div>
            <div className="text-right">
              <p className="text-lg font-bold tabular-nums">{money(o.totalMinor, o.currency)}</p>
              <Button size="sm" variant="outline" onClick={onOpen}>
                <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Open
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
