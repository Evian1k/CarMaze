'use client'

/* SupplierOS: Orders tab: protected purchase-order workflow (supplier side).
 * Respond (accept / reject / propose revision), dispatch after funds are
 * protected, confirm handover, and open disputes. Full order detail with the
 * merged event timeline comes from GET /api/supply/orders/[id].
 *
 * HONESTY RULES:
 *  - Dispatch is only offered when the API state allows it (CONFIRMED +
 *    payment PROTECTED + delivery AGREED). When funds are not protected the
 *    exact reason is shown: we never pretend money is held.
 *  - The handover OTP is never displayed here (the garage owns it). Only the
 *    server-provided hint (last two digits) and the QR-token presence are shown.
 */

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, BadgeCheck, CalendarClock, CheckCircle2, ClipboardList, FileUp, Handshake, Inbox,
  Loader2, MapPin, Package, PackageCheck, Search, ShieldCheck, Truck, XCircle,
} from 'lucide-react'
import { apiSend } from '@/lib/client'
import { money, timeAgo, dateLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  type FetchState, type OrderListItem, type OrderDetail, type ProductItem, type PoEvent,
  useFetch, supplierRoleCan, StatusBadge, LoadingBlock, ModuleNotice, EmptyState,
  PO_STATUS_LABELS, PO_BADGE_CLASS, PAYMENT_STATUS_LABELS, DELIVERY_STATUS_LABELS,
  DISPUTE_REASONS, DISPUTE_REASON_LABELS,
  kesToMinor, uploadOne, errMessage,
} from './shared'

type Props = {
  orgId: string
  role: string
  orders: FetchState<{ orders: OrderListItem[] }>
  products: FetchState<{ products: ProductItem[] }>
}

type OrderFilter = 'ALL' | 'SUBMITTED' | 'OPEN' | 'CLOSED'

const EVENT_SIDE_LABELS: Record<string, string> = {
  GARAGE: 'Garage',
  SUPPLIER: 'You',
  SYSTEM: 'System',
  ADMIN: 'Platform',
}

export function OrdersTab({ role, orders, products }: Props) {
  const [filter, setFilter] = useState<OrderFilter>('ALL')
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const canRespond = supplierRoleCan(role, 'order.respond')
  const canDispute = supplierRoleCan(role, 'dispute.open')

  const list = orders.data?.orders ?? []
  const awaiting = list.filter((o) => o.status === 'SUBMITTED').length

  const filtered = list.filter((o) => {
    if (filter === 'SUBMITTED' && o.status !== 'SUBMITTED') return false
    if (filter === 'OPEN' && ['REJECTED', 'CANCELLED', 'COMPLETED'].includes(o.status)) return false
    if (filter === 'CLOSED' && !['REJECTED', 'CANCELLED', 'COMPLETED'].includes(o.status)) return false
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      if (!o.refCode.toLowerCase().includes(q) && !o.garage.name.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Purchase orders</h2>
          <p className="text-sm text-muted-foreground">
            {awaiting > 0 ? `${awaiting} order${awaiting === 1 ? '' : 's'} awaiting your response.` : 'Protected orders from verified garages.'}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ref or garage…" className="pl-8" aria-label="Search orders" />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['ALL', 'SUBMITTED', 'OPEN', 'CLOSED'] as OrderFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              filter === f ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {f === 'ALL' ? 'All' : f === 'SUBMITTED' ? `Awaiting response${awaiting ? ` (${awaiting})` : ''}` : f === 'OPEN' ? 'Open' : 'Closed'}
          </button>
        ))}
      </div>

      {orders.loading ? (
        <LoadingBlock label="Loading orders…" />
      ) : orders.error ? (
        <ModuleNotice title="Orders could not load" detail={orders.error.message} retry={orders.reload} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title={list.length === 0 ? 'No purchase orders yet' : 'No orders match the filters'}
          detail={list.length === 0
            ? 'When a verified garage places an order from your catalogue it lands here for you to accept, revise or reject.'
            : 'Try a different search or filter.'}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => (
            <OrderCard key={o.id} order={o} onOpen={() => setOpenId(o.id)} />
          ))}
        </div>
      )}

      {openId && (
        <OrderDetailDialog
          orderId={openId}
          role={role}
          canRespond={canRespond}
          canDispute={canDispute}
          products={products}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            orders.reload()
          }}
        />
      )}
    </div>
  )
}

// ───────────────────────────── Order card ─────────────────────────────

function OrderCard({ order, onOpen }: { order: OrderListItem; onOpen: () => void }) {
  return (
    <Card className="cursor-pointer py-4 transition-colors hover:border-primary/40" onClick={onOpen} role="button" aria-label={`Open order ${order.refCode}`}>
      <CardContent className="flex flex-wrap items-start justify-between gap-3 px-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-sm font-semibold">{order.refCode}</p>
            <StatusBadge status={order.status} labels={PO_STATUS_LABELS} classes={PO_BADGE_CLASS} />
            {order.revisedBySupplier && (
              <Badge variant="secondary" className="border-transparent bg-accent/40 text-accent-foreground">Revision proposed</Badge>
            )}
            {order.disputeCount > 0 && (
              <Badge variant="secondary" className="border-transparent bg-destructive/15 text-destructive">Dispute</Badge>
            )}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {order.garage.name}
              {order.garage.verified && <BadgeCheck className="h-3 w-3 text-primary" />}
            </span>
            <span>{order.garage.county}</span>
            <span>{order.itemCount} line{order.itemCount === 1 ? '' : 's'}</span>
            <span>{timeAgo(order.createdAt)}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>Delivery: {order.delivery ? DELIVERY_STATUS_LABELS[order.delivery.status] ?? order.delivery.status : 'Not arranged'}</span>
            <span>Payment: {order.payment ? PAYMENT_STATUS_LABELS[order.payment.status] ?? order.payment.status : PAYMENT_STATUS_LABELS.UNPAID}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-base font-semibold">{money(order.totalMinor, order.currency)}</p>
          <p className="text-xs text-muted-foreground">{order.destinationBranch ? `→ ${order.destinationBranch.name}` : ''}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ───────────────────────────── Detail dialog ─────────────────────────────

function OrderDetailDialog({ orderId, role, canRespond, canDispute, products, onClose, onChanged }: {
  orderId: string
  role: string
  canRespond: boolean
  canDispute: boolean
  products: FetchState<{ products: ProductItem[] }>
  onClose: () => void
  onChanged: () => void
}) {
  const detail = useFetch<OrderDetail>(`/api/supply/orders/${orderId}`)
  const order = detail.data?.order ?? null
  const [busy, setBusy] = useState<string | null>(null)

  const isDisputed = Boolean(order && (order.status === 'DISPUTED' || order.disputes.some((d) => ['OPEN', 'UNDER_REVIEW'].includes(d.status))))

  async function act<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(key)
    try {
      const res = await fn()
      detail.reload()
      onChanged()
      return res
    } catch (e) {
      toast.error(await errMessage(e, 'Action failed: please try again.'))
      return null
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[94vh] overflow-y-auto scrollbar-thin sm:max-w-4xl">
        {detail.loading || !order ? (
          <div className="space-y-3 py-4" aria-busy="true">
            <Skeleton className="h-7 w-52" />
            <Skeleton className="h-4 w-80" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{order.refCode}</span>
                <StatusBadge status={order.status} labels={PO_STATUS_LABELS} classes={PO_BADGE_CLASS} />
                {order.payment && (
                  <StatusBadge status={order.payment.status} labels={PAYMENT_STATUS_LABELS} classes={paymentBadgeClass(order.payment.status)} />
                )}
              </DialogTitle>
              <DialogDescription>
                {order.garage.name}
                {order.garage.verified ? ' (verified garage)' : ''} · {order.garage.county}
                {order.destinationBranch ? ` → ${order.destinationBranch.name} (${order.destinationBranch.town})` : ''}
                {' '}· placed {dateLabel(order.createdAt)}
              </DialogDescription>
            </DialogHeader>

            {/* Supplier note from response */}
            {order.supplierNote && (
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                Your note on this order: “{order.supplierNote}”
              </p>
            )}

            {/* Action cards */}
            {canRespond && order.status === 'SUBMITTED' && (
              <RespondSection order={order} busy={busy} act={act} products={products} />
            )}
            {order.status === 'REVISED' && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Revision proposed: waiting on the garage</AlertTitle>
                <AlertDescription>
                  The garage must approve or decline your revision before the order can proceed. You&apos;ll be notified of their decision.
                </AlertDescription>
              </Alert>
            )}
            {canRespond && order.status === 'CONFIRMED' && (
              <DispatchSection order={order} busy={busy} act={act} />
            )}
            {canRespond && order.delivery && ['DISPATCHED', 'IN_TRANSIT'].includes(order.delivery.status) && !order.delivery.supplierConfirmAt && (
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Confirm handover</p>
                    <p className="text-xs text-muted-foreground">
                      Confirm you handed the goods to the courier/garage. The garage verifies with their handover code.
                    </p>
                  </div>
                  <Button className="min-h-11" disabled={busy !== null} onClick={() => act('handover', () => apiSend(`/api/supply/orders/${order.id}/action`, 'POST', { action: 'handover-confirm' }))}>
                    {busy === 'handover' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />} Confirm handover
                  </Button>
                </CardContent>
              </Card>
            )}
            {canDispute && !isDisputed && ['CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED'].includes(order.status) && (
              <DisputeSection orderId={order.id} busy={busy} act={act} />
            )}
            {isDisputed && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Order under dispute</AlertTitle>
                <AlertDescription>
                  {order.disputes.map((d) => `${d.refCode} (${DISPUTE_REASON_LABELS[d.reason] ?? d.reason}): ${d.status}`).join('; ')}
                  {' '}Platform admins investigate with all order, payment and delivery evidence.
                </AlertDescription>
              </Alert>
            )}

            <ItemsTable order={order} />

            {/* Delivery + payment panels */}
            <div className="grid gap-3 sm:grid-cols-2">
              <DeliveryPanel order={order} />
              <PaymentPanel order={order} />
            </div>

            <Timeline order={order} />

            <DialogFooter className="justify-start">
              <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function paymentBadgeClass(status: string): string {
  if (status === 'PROTECTED') return 'bg-primary/15 text-primary'
  if (status === 'RELEASED' || status === 'PARTIALLY_RELEASED') return 'bg-primary text-primary-foreground'
  if (status === 'FAILED' || status === 'REFUNDED') return 'bg-destructive/15 text-destructive'
  return 'bg-accent/30 text-accent-foreground'
}

// ───────────────────────────── Respond (accept/reject/revise) ─────────────────────────────

function RespondSection({ order, busy, act, products }: {
  order: NonNullable<OrderDetail['order']>
  busy: string | null
  act: (key: string, fn: () => Promise<unknown>) => Promise<unknown>
  products: FetchState<{ products: ProductItem[] }>
}) {
  const [mode, setMode] = useState<'choose' | 'accept' | 'reject' | 'revise'>('choose')
  const [note, setNote] = useState('')

  if (mode === 'revise') {
    return (
      <RevisionEditor
        order={order}
        busy={busy}
        act={act}
        products={products}
        onDone={() => setMode('choose')}
      />
    )
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-3 px-4 py-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><Inbox className="h-4 w-4 text-primary" /> Respond to this order</p>
          <p className="text-xs text-muted-foreground">
            Accept to confirm the order as quoted, propose revised quantities/prices, or reject with a reason. The garage is notified of your decision.
          </p>
        </div>

        {mode === 'choose' ? (
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" disabled={busy !== null} onClick={() => setMode('accept')}>
              <CheckCircle2 className="h-4 w-4" /> Accept
            </Button>
            <Button variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => setMode('revise')}>
              <Package className="h-4 w-4" /> Propose revision
            </Button>
            <Button variant="ghost" className="min-h-11 text-destructive hover:text-destructive" disabled={busy !== null} onClick={() => setMode('reject')}>
              <XCircle className="h-4 w-4" /> Reject
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="respond-note">
              {mode === 'accept' ? 'Note to the garage (optional)' : 'Reason (required)'}
            </Label>
            <Textarea
              id="respond-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder={mode === 'accept' ? 'e.g. All items in stock: dispatch within 24h of delivery arrangement.' : 'e.g. Brake pads SKU discontinued; we can propose an equivalent.'}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => { setMode('choose'); setNote('') }} disabled={busy !== null}>Back</Button>
              <Button
                className="min-h-11"
                disabled={busy !== null || (mode === 'reject' && note.trim().length < 3)}
                onClick={() =>
                  act('respond', () =>
                    apiSend(`/api/supply/orders/${order.id}/action`, 'POST', {
                      action: 'respond',
                      decision: mode === 'accept' ? 'ACCEPT' : 'REJECT',
                      note: note.trim() || undefined,
                    })
                  ).then(() => setMode('choose'))
                }
              >
                {busy === 'respond' ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'accept' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {mode === 'accept' ? 'Accept order' : 'Reject order'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ───────────────────────────── Revision editor ─────────────────────────────

type LineEdit = { itemId: string; productId: string; name: string; qty: string; unit: string; remove: boolean }
type AddLine = { productId: string; qty: string; unit: string }

function RevisionEditor({ order, busy, act, products, onDone }: {
  order: NonNullable<OrderDetail['order']>
  busy: string | null
  act: (key: string, fn: () => Promise<unknown>) => Promise<unknown>
  products: FetchState<{ products: ProductItem[] }>
  onDone: () => void
}) {
  const [lines, setLines] = useState<LineEdit[]>(() =>
    order.items.map((i) => ({ itemId: i.id, productId: i.productId, name: i.name, qty: String(i.qty), unit: minorToKesInput2(i.unitPriceMinor), remove: false }))
  )
  const [adds, setAdds] = useState<AddLine[]>([])
  const [note, setNote] = useState('')

  function setLine(idx: number, patch: Partial<LineEdit>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  const changes = useMemo(() => {
    const out: { itemId?: string; productId: string; action: 'UPDATE' | 'REMOVE' | 'ADD'; qty?: number; unitPriceMinor?: number }[] = []
    for (const l of lines) {
      const qty = Number(l.qty)
      const unit = kesToMinor(l.unit)
      if (l.remove) {
        out.push({ itemId: l.itemId, productId: l.productId, action: 'REMOVE' })
      } else if (Number.isInteger(qty) && qty >= 1 && unit !== null) {
        // changed only when qty/price differ from the original
        const orig = order.items.find((i) => i.id === l.itemId)
        if (orig && (qty !== orig.qty || unit !== orig.unitPriceMinor)) {
          out.push({ itemId: l.itemId, productId: l.productId, action: 'UPDATE', qty, unitPriceMinor: unit })
        }
      }
    }
    for (const a of adds) {
      const qty = Number(a.qty)
      const unit = kesToMinor(a.unit)
      if (Number.isInteger(qty) && qty >= 1 && unit !== null && unit >= 100) {
        out.push({ productId: a.productId, action: 'ADD', qty, unitPriceMinor: unit })
      }
    }
    return out
  }, [lines, adds, order.items])

  const newSubtotal = useMemo(() => {
    let sum = 0
    for (const l of lines) {
      if (l.remove) continue
      const qty = Number(l.qty)
      const unit = kesToMinor(l.unit)
      if (Number.isInteger(qty) && qty >= 1 && unit !== null) sum += qty * unit
    }
    for (const a of adds) {
      const qty = Number(a.qty)
      const unit = kesToMinor(a.unit)
      if (Number.isInteger(qty) && qty >= 1 && unit !== null) sum += qty * unit
    }
    return sum
  }, [lines, adds])

  const publishable = changes.length > 0 && note.trim().length >= 3

  return (
    <Card className="border-accent/50">
      <CardContent className="space-y-3 px-4 py-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><Package className="h-4 w-4 text-primary" /> Propose a revision</p>
          <p className="text-xs text-muted-foreground">
            Adjust quantities or unit prices, remove lines, or add lines from your catalogue. The garage must approve the
            revision before the order is final.
          </p>
        </div>

        <div className="space-y-2">
          {lines.map((l, idx) => (
            <div key={l.itemId} className={cn('grid gap-2 rounded-lg border border-border p-2.5 sm:grid-cols-[1fr_auto]', l.remove && 'opacity-50')}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{l.name}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{order.items.find((i) => i.id === l.itemId)?.sku}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-20">
                  <Label htmlFor={`rv-qty-${l.itemId}`} className="text-[10px] text-muted-foreground">Qty</Label>
                  <Input id={`rv-qty-${l.itemId}`} inputMode="numeric" className="h-8" value={l.qty} disabled={l.remove}
                    onChange={(e) => setLine(idx, { qty: e.target.value.replace(/[^\d]/g, '') })} />
                </div>
                <div className="w-28">
                  <Label htmlFor={`rv-unit-${l.itemId}`} className="text-[10px] text-muted-foreground">Unit (KES)</Label>
                  <Input id={`rv-unit-${l.itemId}`} inputMode="decimal" className="h-8" value={l.unit} disabled={l.remove}
                    onChange={(e) => setLine(idx, { unit: e.target.value })} />
                </div>
                <Button
                  size="sm"
                  variant={l.remove ? 'secondary' : 'ghost'}
                  className="h-8 text-destructive hover:text-destructive"
                  onClick={() => setLine(idx, { remove: !l.remove })}
                >
                  {l.remove ? 'Keep line' : 'Remove'}
                </Button>
              </div>
            </div>
          ))}
        </div>

        {adds.length > 0 && (
          <div className="space-y-2">
            {adds.map((a, idx) => {
              const prod = products.data?.products.find((p) => p.id === a.productId)
              return (
                <div key={`add-${idx}`} className="grid gap-2 rounded-lg border border-dashed border-border p-2.5 sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">+ {prod?.name ?? a.productId}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{prod?.sku ?? ''}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-20">
                      <Label className="text-[10px] text-muted-foreground" htmlFor={`ad-qty-${idx}`}>Qty</Label>
                      <Input id={`ad-qty-${idx}`} inputMode="numeric" className="h-8" value={a.qty}
                        onChange={(e) => setAdds((xs) => xs.map((x, i) => (i === idx ? { ...x, qty: e.target.value.replace(/[^\d]/g, '') } : x)))} />
                    </div>
                    <div className="w-28">
                      <Label className="text-[10px] text-muted-foreground" htmlFor={`ad-unit-${idx}`}>Unit (KES)</Label>
                      <Input id={`ad-unit-${idx}`} inputMode="decimal" className="h-8" value={a.unit}
                        onChange={(e) => setAdds((xs) => xs.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))} />
                    </div>
                    <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive"
                      onClick={() => setAdds((xs) => xs.filter((_, i) => i !== idx))}>
                      Remove
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <AddLinePicker products={products} onAdd={(a) => setAdds((xs) => [...xs, a])} existing={new Set([...lines.map((l) => l.productId), ...adds.map((a) => a.productId)])} />

        <div className="space-y-1.5">
          <Label htmlFor="rv-note">Note to the garage (required, min 3 chars)</Label>
          <Textarea id="rv-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
            placeholder="Explain the changes: e.g. price update for this quarter's freight costs." />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Proposed subtotal</span>
          <span className="font-semibold">{money(newSubtotal)}</span>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onDone} disabled={busy !== null}>Back</Button>
          <Button
            className="min-h-11"
            disabled={busy !== null || !publishable}
            title={publishable ? 'Send revision to the garage' : 'Adjust at least one line and add a note (min 3 chars).'}
            onClick={() =>
              act('respond', () =>
                apiSend(`/api/supply/orders/${order.id}/action`, 'POST', {
                  action: 'respond',
                  decision: 'REVISE',
                  note: note.trim(),
                  revision: { changes },
                })
              ).then(() => onDone())
            }
          >
            {busy === 'respond' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />} Send revision
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function minorToKesInput2(minor: number): string {
  return String(minor / 100)
}

function AddLinePicker({ products, onAdd, existing }: {
  products: FetchState<{ products: ProductItem[] }>
  onAdd: (a: AddLine) => void
  existing: Set<string>
}) {
  const [productId, setProductId] = useState('')
  const published = (products.data?.products ?? []).filter((p) => p.status === 'PUBLISHED' && !existing.has(p.id))
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-2.5">
      <div className="min-w-48 flex-1">
        <Label htmlFor="rv-add-product" className="text-xs">Add a line from your catalogue</Label>
        <Select value={productId || undefined} onValueChange={setProductId}>
          <SelectTrigger id="rv-add-product" aria-label="Product to add"><SelectValue placeholder="Choose a published product" /></SelectTrigger>
          <SelectContent className="max-h-64">
            {published.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>
            ))}
            {published.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No other published products.</div>}
          </SelectContent>
        </Select>
      </div>
      <Button
        variant="outline"
        className="min-h-10"
        disabled={!productId}
        onClick={() => {
          const p = products.data?.products.find((x) => x.id === productId)
          if (!p) return
          onAdd({ productId: p.id, qty: '1', unit: String(p.unitPriceMinor / 100) })
          setProductId('')
        }}
      >
        <PackagePlusIcon /> Add line
      </Button>
    </div>
  )
}

function PackagePlusIcon() {
  return <Package className="h-4 w-4" />
}

// ───────────────────────────── Dispatch ─────────────────────────────

function DispatchSection({ order, busy, act }: {
  order: NonNullable<OrderDetail['order']>
  busy: string | null
  act: (key: string, fn: () => Promise<unknown>) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [courierName, setCourierName] = useState('')
  const [driverName, setDriverName] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [vehicleReg, setVehicleReg] = useState('')
  const [deliveryRef, setDeliveryRef] = useState('')
  const [expectedHours, setExpectedHours] = useState('24')
  const [evidence, setEvidence] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)

  const paymentProtected = order.paymentStatus === 'PROTECTED'
  const deliveryAgreed = order.delivery?.status === 'AGREED'
  const canDispatch = paymentProtected && deliveryAgreed

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const room = 6 - evidence.length
    if (room <= 0) {
      toast.error('At most 6 dispatch evidence files.')
      return
    }
    setUploading(true)
    try {
      for (const file of Array.from(files).slice(0, room)) {
        const res = await uploadOne(file)
        setEvidence((prev) => [...prev, res.url])
      }
      toast.success('Evidence uploaded')
    } catch (e) {
      toast.error(await errMessage(e, 'Upload failed: please try again.'))
    } finally {
      setUploading(false)
    }
  }

  if (!canDispatch) {
    return (
      <Card className="border-dashed">
        <CardContent className="space-y-1.5 px-4 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold"><Truck className="h-4 w-4 text-muted-foreground" /> Dispatch (locked)</p>
          {!paymentProtected && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Funds must be protected before dispatch</AlertTitle>
              <AlertDescription>
                The garage pays via M-Pesa; platform finance reconciles where M-Pesa is not configured. Funds are only
                released after the garage accepts the delivery.
              </AlertDescription>
            </Alert>
          )}
          {!deliveryAgreed && (
            <p className="text-xs text-muted-foreground">
              Delivery must be arranged and agreed before dispatch; currently:{' '}
              <strong>{order.delivery ? DELIVERY_STATUS_LABELS[order.delivery.status] ?? order.delivery.status : 'not arranged'}</strong>.
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold"><Truck className="h-4 w-4 text-primary" /> Dispatch order</p>
            <p className="text-xs text-muted-foreground">
              Funds are protected. Record the handover details: the garage receives a 6-digit handover code to verify delivery.
            </p>
          </div>
          {!open && (
            <Button className="min-h-11" disabled={busy !== null} onClick={() => setOpen(true)}>
              <Truck className="h-4 w-4" /> Record dispatch
            </Button>
          )}
        </div>

        {open && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dp-courier">Courier / transport company</Label>
                <Input id="dp-courier" value={courierName} onChange={(e) => setCourierName(e.target.value)} placeholder="e.g. G4S Courier" maxLength={80} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dp-driver">Driver name</Label>
                <Input id="dp-driver" value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="e.g. John Otieno" maxLength={80} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dp-phone">Driver phone</Label>
                <Input id="dp-phone" type="tel" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} placeholder="+254 7xx xxx xxx" maxLength={20} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dp-reg">Vehicle registration</Label>
                <Input id="dp-reg" value={vehicleReg} onChange={(e) => setVehicleReg(e.target.value)} placeholder="e.g. KDA 123A" maxLength={20} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dp-ref">Delivery reference</Label>
                <Input id="dp-ref" value={deliveryRef} onChange={(e) => setDeliveryRef(e.target.value)} placeholder="Consignment / waybill number" maxLength={60} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dp-hours">Expected transit (hours)</Label>
                <Input id="dp-hours" inputMode="numeric" value={expectedHours} onChange={(e) => setExpectedHours(e.target.value.replace(/[^\d]/g, ''))} placeholder="e.g. 24" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Dispatch evidence ({evidence.length}/6)</Label>
              <input
                id="dp-evidence"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  handleFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                {evidence.map((url) => (
                  <div key={url} className="relative">
                    <img src={url} alt="Dispatch evidence" className="h-14 w-14 rounded-md border border-border object-cover" />
                    <button
                      type="button"
                      aria-label="Remove evidence"
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                      onClick={() => setEvidence((prev) => prev.filter((u) => u !== url))}
                    >
                      <XCircle className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {evidence.length < 6 && (
                  <button
                    type="button"
                    onClick={() => document.getElementById('dp-evidence')?.click()}
                    disabled={uploading}
                    className="flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                    <span className="text-[9px]">{uploading ? 'Uploading…' : 'Upload'}</span>
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Packing photos or signed waybills; visible to the garage and platform reviewers.</p>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy !== null}>Cancel</Button>
              <Button
                className="min-h-11"
                disabled={busy !== null || uploading}
                onClick={() =>
                  act('dispatch', () =>
                    apiSend(`/api/supply/orders/${order.id}/action`, 'POST', {
                      action: 'dispatch',
                      courierName: courierName.trim() || undefined,
                      driverName: driverName.trim() || undefined,
                      driverPhone: driverPhone.trim() || undefined,
                      vehicleReg: vehicleReg.trim() || undefined,
                      deliveryRef: deliveryRef.trim() || undefined,
                      expectedHours: expectedHours.trim() ? Number(expectedHours) : undefined,
                      evidence,
                    })
                  ).then(() => setOpen(false))
                }
              >
                {busy === 'dispatch' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />} Record dispatch
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ───────────────────────────── Dispute ─────────────────────────────

function DisputeSection({ orderId, busy, act }: {
  orderId: string
  busy: string | null
  act: (key: string, fn: () => Promise<unknown>) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string>('MISSING_ITEMS')
  const [details, setDetails] = useState('')
  const [evidence, setEvidence] = useState<{ url: string; name: string }[]>([])
  const [uploading, setUploading] = useState(false)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const room = 6 - evidence.length
    if (room <= 0) {
      toast.error('At most 6 evidence files.')
      return
    }
    setUploading(true)
    try {
      for (const file of Array.from(files).slice(0, room)) {
        const res = await uploadOne(file)
        setEvidence((prev) => [...prev, { url: res.url, name: res.name || file.name }])
      }
      toast.success('Evidence uploaded')
    } catch (e) {
      toast.error(await errMessage(e, 'Upload failed: please try again.'))
    } finally {
      setUploading(false)
    }
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={busy !== null} onClick={() => setOpen(true)}>
          <AlertTriangle className="h-3.5 w-3.5" /> Open dispute
        </Button>
      </div>
    )
  }

  return (
    <Card className="border-destructive/40">
      <CardContent className="space-y-3 px-4 py-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive"><AlertTriangle className="h-4 w-4" /> Open a dispute</p>
          <p className="text-xs text-muted-foreground">
            Freezes further workflow steps on this order. Platform admins investigate with the full order, payment and
            delivery evidence. Use honest, specific details.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ds-reason">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="ds-reason" aria-label="Dispute reason"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DISPUTE_REASONS.map((r) => <SelectItem key={r} value={r}>{DISPUTE_REASON_LABELS[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ds-details">Details (min 10 characters)</Label>
            <Textarea id="ds-details" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000}
              placeholder="What happened, which lines are affected, what resolution you expect." />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Evidence ({evidence.length}/6)</Label>
          <input
            id="ds-evidence"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            {evidence.map((ev) => (
              <div key={ev.url} className="relative">
                <img src={ev.url} alt={ev.name} className="h-14 w-14 rounded-md border border-border object-cover" />
                <button
                  type="button"
                  aria-label={`Remove ${ev.name}`}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                  onClick={() => setEvidence((prev) => prev.filter((x) => x.url !== ev.url))}
                >
                  <XCircle className="h-3 w-3" />
                </button>
              </div>
            ))}
            {evidence.length < 6 && (
              <button
                type="button"
                onClick={() => document.getElementById('ds-evidence')?.click()}
                disabled={uploading}
                className="flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                <span className="text-[9px]">{uploading ? 'Uploading…' : 'Upload'}</span>
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy !== null}>Cancel</Button>
          <Button
            variant="destructive"
            className="min-h-11"
            disabled={busy !== null || details.trim().length < 10}
            onClick={() =>
              act('dispute', () =>
                apiSend(`/api/supply/orders/${orderId}/action`, 'POST', {
                  action: 'dispute',
                  reason,
                  details: details.trim(),
                  evidence,
                })
              ).then(() => setOpen(false))
            }
          >
            {busy === 'dispute' ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />} File dispute
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ───────────────────────────── Items, panels, timeline ─────────────────────────────

function ItemsTable({ order }: { order: NonNullable<OrderDetail['order']> }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Unit</th>
              <th className="px-3 py-2 text-right font-medium">Line total</th>
              <th className="px-3 py-2 text-right font-medium">Accepted</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.id} className="border-b border-border last:border-0">
                <td className="max-w-64 px-3 py-2">
                  <div className="flex items-center gap-2">
                    {i.image ? <img src={i.image} alt="" className="h-9 w-9 rounded border border-border object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded border border-border bg-muted/40"><Package className="h-4 w-4 text-muted-foreground" /></span>}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{i.name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{i.sku}{i.brand ? ` · ${i.brand}` : ''}{i.note ? ` · note: ${i.note}` : ''}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-right">{i.qty}</td>
                <td className="px-3 py-2 text-right">{money(i.unitPriceMinor, order.currency)}</td>
                <td className="px-3 py-2 text-right">{money(i.lineTotalMinor, order.currency)}</td>
                <td className="px-3 py-2 text-right">{i.qtyAccepted ?? 'Not set'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 border-t border-border bg-muted/20 px-3 py-2.5 text-sm">
        <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{money(order.subtotalMinor, order.currency)}</span></div>
        <div className="flex justify-between text-muted-foreground"><span>Tax</span><span>{money(order.taxMinor, order.currency)}</span></div>
        <div className="flex justify-between text-muted-foreground"><span>Delivery fee</span><span>{money(order.deliveryFeeMinor, order.currency)}</span></div>
        <div className="flex justify-between font-semibold"><span>Total</span><span>{money(order.totalMinor, order.currency)}</span></div>
        {order.acceptedTotalMinor !== null && (
          <div className="flex justify-between text-primary"><span>Accepted value after inspection</span><span className="font-semibold">{money(order.acceptedTotalMinor, order.currency)}</span></div>
        )}
      </div>
    </div>
  )
}

function DeliveryPanel({ order }: { order: NonNullable<OrderDetail['order']> }) {
  const d = order.delivery
  return (
    <Card>
      <CardContent className="space-y-2 px-4 py-4 text-sm">
        <p className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4 text-muted-foreground" /> Delivery</p>
        {!d ? (
          <p className="text-xs text-muted-foreground">
            Not arranged yet. After you accept, the delivery method (direct, collection or meetup) is agreed between you and the garage.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge status={d.status} labels={DELIVERY_STATUS_LABELS} classes={{ AGREED: 'bg-primary/15 text-primary', ARRANGING: 'bg-accent/30 text-accent-foreground' }} />
              <Badge variant="outline" className="text-[10px]">{d.method}</Badge>
            </div>
            <dl className="space-y-1 text-xs text-muted-foreground">
              {d.scheduledFor && <div className="flex gap-1"><CalendarClock className="h-3 w-3 shrink-0" /><span>Scheduled {new Date(d.scheduledFor).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}{d.windowLabel ? ` · ${d.windowLabel}` : ''}</span></div>}
              {d.courierName && <div>Courier: {d.courierName}</div>}
              {d.driverName && <div>Driver: {d.driverName}{d.driverPhone ? ` · ${d.driverPhone}` : ''}</div>}
              {d.vehicleReg && <div>Vehicle: {d.vehicleReg}</div>}
              {d.deliveryRef && <div>Ref: <span className="font-mono">{d.deliveryRef}</span></div>}
              {d.dispatchedAt && <div>Dispatched {timeAgo(d.dispatchedAt)}{d.expectedAt ? ` · expected ${dateLabel(d.expectedAt)}` : ''}</div>}
              {order.destinationBranch && <div className="flex gap-1"><MapPin className="h-3 w-3 shrink-0" /><span>To: {order.destinationBranch.name}, {order.destinationBranch.address || order.destinationBranch.town}</span></div>}
              {d.supplierBranch && <div className="flex gap-1"><MapPin className="h-3 w-3 shrink-0" /><span>Collection: {d.supplierBranch.name}, {d.supplierBranch.town}</span></div>}
              {d.meetup?.address && <div className="flex gap-1"><MapPin className="h-3 w-3 shrink-0" /><span>Meetup: {d.meetup.address}</span></div>}
            </dl>
            {d.dispatchEvidence.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {d.dispatchEvidence.map((url) => (
                  <img key={url} src={url} alt="Dispatch evidence" className="h-12 w-12 rounded border border-border object-cover" />
                ))}
              </div>
            )}
            <HandoverVerification d={d} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function HandoverVerification({ d }: { d: NonNullable<OrderDetail['order']['delivery']> }) {
  const active = ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].includes(d.status)
  if (!active) return null
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <p className="flex items-center gap-1.5 font-medium text-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> Handover verification</p>
      <p className="mt-1">
        {d.otpHint
          ? <>The garage holds the 6-digit handover code; it ends <span className="font-mono font-semibold text-foreground">··{d.otpHint}</span>. You never see the full code; they read it out only at handover.</>
          : 'The garage receives a 6-digit handover code at dispatch; it is verified at delivery.'}
      </p>
      <p className="mt-0.5">
        {d.qrToken ? 'QR handover verification is enabled for this delivery.' : 'QR handover is not enabled for this delivery.'}
      </p>
    </div>
  )
}

function PaymentPanel({ order }: { order: NonNullable<OrderDetail['order']> }) {
  const p = order.payment
  return (
    <Card>
      <CardContent className="space-y-2 px-4 py-4 text-sm">
        <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-muted-foreground" /> Payment</p>
        {!p ? (
          <p className="text-xs text-muted-foreground">
            No payment yet. After confirmation the garage pays via M-Pesa into protected escrow; funds release to you
            after the garage accepts the delivery.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge status={p.status} labels={PAYMENT_STATUS_LABELS} classes={paymentBadgeClass(p.status)} />
              {p.provider && <Badge variant="outline" className="text-[10px]">{p.provider}</Badge>}
            </div>
            <dl className="space-y-1 text-xs text-muted-foreground">
              <div>Amount: <span className="font-semibold text-foreground">{money(p.amountMinor, order.currency)}</span></div>
              <div>Ref: <span className="font-mono">{p.refCode}</span></div>
              {p.protectedAt && <div>Funds protected {timeAgo(p.protectedAt)}</div>}
            </dl>
            <p className="text-xs text-muted-foreground">
              {p.status === 'PROTECTED'
                ? 'Funds are held in protection and release after the garage inspects and accepts the delivery.'
                : p.status === 'RELEASED' || p.status === 'PARTIALLY_RELEASED'
                  ? 'Released funds are paid out per the platform finance schedule; the commission is recorded separately.'
                  : 'Payment states change only when the payment provider or platform finance confirms them; this panel never assumes.'}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Timeline({ order }: { order: NonNullable<OrderDetail['order']> }) {
  const events: PoEvent[] = useMemo(() => {
    const all = [...order.events, ...(order.delivery?.events ?? []).map((e) => ({ ...e, type: `Delivery · ${e.type}` }))]
    return all.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [order])

  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Timeline</p>
      <ol className="max-h-64 space-y-0 overflow-y-auto scrollbar-thin pr-1">
        {events.map((e) => (
          <li key={e.id} className="relative border-l border-border pb-3 pl-4 last:pb-0">
            <span className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full bg-primary/60" />
            <p className="text-xs">
              <span className="font-medium">{e.type.replaceAll('_', ' ')}</span>
              {' '}· {EVENT_SIDE_LABELS[e.actorSide ?? ''] ?? 'Party'}
              {e.actorName ? ` (${e.actorName})` : ''}
              {' '}· {new Date(e.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
            {e.note && <p className="mt-0.5 text-xs text-muted-foreground">{e.note}</p>}
          </li>
        ))}
        {events.length === 0 && <li className="text-xs text-muted-foreground">No events recorded.</li>}
      </ol>
      {order.revisions.length > 0 && (
        <>
          <Separator className="my-3" />
          <p className="mb-1.5 text-sm font-semibold">Revisions</p>
          <ul className="space-y-1.5">
            {order.revisions.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                <span>
                  Proposed {timeAgo(r.createdAt)} · {r.changes.length} change{r.changes.length === 1 ? '' : 's'}
                  {r.note ? ` · “${r.note}”` : ''}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{money(r.newTotalMinor, order.currency)}</span>
                  <Badge variant="secondary" className={cn('border-transparent', r.status === 'APPROVED' ? 'bg-primary text-primary-foreground' : r.status === 'DECLINED' ? 'bg-destructive/15 text-destructive' : 'bg-accent/40 text-accent-foreground')}>
                    {r.status === 'APPROVED' ? 'Approved' : r.status === 'DECLINED' ? 'Declined' : 'Pending'}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {order.inspectionStatus && (
        <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Garage inspection result: <strong className="text-foreground">{order.inspectionStatus}</strong>
          {order.acceptedTotalMinor !== null ? `: accepted value ${money(order.acceptedTotalMinor, order.currency)}.` : ''}
        </p>
      )}
    </div>
  )
}
