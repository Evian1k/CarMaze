'use client'

/* SupplierOS — Consumer orders tab: B2C parts orders placed directly by
 * signed-in customers (deliberately separate from the B2B purchase-order
 * workflow). Accept (choosing the fulfilling warehouse), reject with a
 * reason, dispatch with a courier, and mark delivered by verifying the
 * collection code the customer received.
 *
 * HONESTY RULES:
 *  - The customer's collection code is never displayed here (the buyer owns
 *    it — it was delivered to their notifications). Only the server-provided
 *    hint is shown, and delivery requires the code the customer/courier reads out.
 *  - Payment states are rendered exactly as the API reports them.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import {
  BadgeCheck, CheckCircle2, ClipboardList, Inbox, Loader2, MapPin, Package,
  PackageCheck, Phone, Search, ShieldCheck, Truck, User, XCircle,
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
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  type BranchItem, type FetchState, useFetch, supplierRoleCan, StatusBadge,
  LoadingBlock, ModuleNotice, EmptyState, errMessage,
} from './shared'

// ───────────────────────────── Types ─────────────────────────────

type ConsumerOrderItem = {
  id: string
  productId: string
  name: string
  sku: string
  qty: number
  unitPriceMinor: number
  lineTotalMinor: number
  image: string | null
}

export type ConsumerOrder = {
  id: string
  refCode: string
  status: string
  paymentStatus: string
  buyer: { id: string; name: string }
  deliveryMethod: string
  county: string
  address: string
  phone: string
  notes: string | null
  courierName: string | null
  fulfillmentBranchId: string | null
  rejectedReason: string | null
  itemCount: number
  items: ConsumerOrderItem[]
  deliveryFeeMinor: number
  totalMinor: number
  currency: string
  invoice: { id: string; refCode: string; status: string } | null
  createdAt: string
  updatedAt: string
}

type ConsumerOrderDetail = {
  side: string
  role: string | null
  order: ConsumerOrder & {
    fulfillmentBranch: { id: string; name: string; town: string } | null
    deliveredAt: string | null
    completedAt: string | null
    otpHint: string | null
    invoice: { id: string; refCode: string; status: string; amountMinor: number; dueDate: string | null } | null
    events: { id: string; type: string; actorSide: string; actorName: string; note: string | null; createdAt: string }[]
  }
}

type Props = {
  orgId: string
  role: string
  orders: FetchState<{ orders: ConsumerOrder[]; counts: Record<string, number> }>
  branches: FetchState<{ branches: BranchItem[] }>
}

type OrderFilter = 'ALL' | 'SUBMITTED' | 'OPEN' | 'CLOSED'

const CO_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Awaiting your response',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  CONFIRMED: 'Confirmed',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  DISPUTED: 'Under dispute',
}

const CO_BADGE_CLASS: Record<string, string> = {
  SUBMITTED: 'bg-accent/40 text-accent-foreground',
  ACCEPTED: 'bg-primary/15 text-primary',
  REJECTED: 'bg-destructive/15 text-destructive',
  CONFIRMED: 'bg-primary/15 text-primary',
  DISPATCHED: 'bg-secondary text-secondary-foreground',
  DELIVERED: 'bg-primary text-primary-foreground',
  COMPLETED: 'bg-primary text-primary-foreground',
  CANCELLED: 'bg-muted text-muted-foreground',
  DISPUTED: 'bg-destructive/15 text-destructive',
}

const CO_PAYMENT_LABELS: Record<string, string> = {
  UNPAID: 'Not paid',
  PROCESSING: 'Payment initiating',
  PAID: 'Paid',
  REFUNDED: 'Refunded',
}

const EVENT_SIDE_LABELS: Record<string, string> = {
  CUSTOMER: 'Customer',
  SUPPLIER: 'You',
  SYSTEM: 'System',
}

const CLOSED_STATUSES = ['REJECTED', 'CANCELLED', 'COMPLETED']
const OPEN_STATUSES = ['ACCEPTED', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'DISPUTED']

// ───────────────────────────── Tab ─────────────────────────────

export function ConsumerOrdersTab({ orgId, role, orders, branches }: Props) {
  const [filter, setFilter] = useState<OrderFilter>('ALL')
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const canRespond = supplierRoleCan(role, 'order.respond')

  const list = orders.data?.orders ?? []
  const awaiting = list.filter((o) => o.status === 'SUBMITTED').length

  const filtered = list.filter((o) => {
    if (filter === 'SUBMITTED' && o.status !== 'SUBMITTED') return false
    if (filter === 'OPEN' && !OPEN_STATUSES.includes(o.status)) return false
    if (filter === 'CLOSED' && !CLOSED_STATUSES.includes(o.status)) return false
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      if (!o.refCode.toLowerCase().includes(q) && !o.buyer.name.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Consumer orders</h2>
          <p className="text-sm text-muted-foreground">
            {awaiting > 0 ? `${awaiting} order${awaiting === 1 ? '' : 's'} awaiting your response.` : 'Parts orders placed directly by customers from your public catalogue.'}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ref or customer…" className="pl-8" aria-label="Search consumer orders" />
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
        <LoadingBlock label="Loading consumer orders…" />
      ) : orders.error ? (
        <ModuleNotice title="Consumer orders could not load" detail={orders.error.message} retry={orders.reload} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title={list.length === 0 ? 'No consumer orders yet' : 'No orders match the filters'}
          detail={list.length === 0
            ? 'When a signed-in customer orders parts from your published catalogue it lands here for you to accept, dispatch or reject.'
            : 'Try a different search or filter.'}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => (
            <ConsumerOrderCard key={o.id} order={o} onOpen={() => setOpenId(o.id)} />
          ))}
        </div>
      )}

      {openId && (
        <ConsumerOrderDetailDialog
          orderId={openId}
          orgId={orgId}
          canRespond={canRespond}
          branches={branches}
          onClose={() => setOpenId(null)}
          onChanged={orders.reload}
        />
      )}
    </div>
  )
}

// ───────────────────────────── Card ─────────────────────────────

function ConsumerOrderCard({ order, onOpen }: { order: ConsumerOrder; onOpen: () => void }) {
  return (
    <Card className="cursor-pointer py-4 transition-colors hover:border-primary/40" onClick={onOpen} role="button" aria-label={`Open consumer order ${order.refCode}`}>
      <CardContent className="flex flex-wrap items-start justify-between gap-3 px-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-sm font-semibold">{order.refCode}</p>
            <StatusBadge status={order.status} labels={CO_STATUS_LABELS} classes={CO_BADGE_CLASS} />
            <StatusBadge status={order.paymentStatus} labels={CO_PAYMENT_LABELS} classes="bg-muted text-muted-foreground" />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><User className="h-3 w-3" /> {order.buyer.name}</span>
            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {order.county}</span>
            <span>{order.itemCount} line{order.itemCount === 1 ? '' : 's'}</span>
            <span>{order.deliveryMethod === 'COLLECTION' ? 'Collection' : 'Delivery'}</span>
            <span>{timeAgo(order.createdAt)}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-base font-semibold">{money(order.totalMinor, order.currency)}</p>
          <p className="text-xs text-muted-foreground">incl. {money(order.deliveryFeeMinor, order.currency)} delivery</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ───────────────────────────── Detail dialog ─────────────────────────────

function ConsumerOrderDetailDialog({ orderId, orgId, canRespond, branches, onClose, onChanged }: {
  orderId: string
  orgId: string
  canRespond: boolean
  branches: FetchState<{ branches: BranchItem[] }>
  onClose: () => void
  onChanged: () => void
}) {
  const detail = useFetch<ConsumerOrderDetail>(`/api/orders/${orderId}`)
  const order = detail.data?.order ?? null
  const [busy, setBusy] = useState<string | null>(null)

  async function act<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(key)
    try {
      const res = await fn()
      detail.reload()
      onChanged()
      return res
    } catch (e) {
      toast.error(await errMessage(e, 'Action failed — please try again.'))
      return null
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[94vh] overflow-y-auto scrollbar-thin sm:max-w-3xl">
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
                <StatusBadge status={order.status} labels={CO_STATUS_LABELS} classes={CO_BADGE_CLASS} />
                <StatusBadge status={order.paymentStatus} labels={CO_PAYMENT_LABELS} classes="bg-muted text-muted-foreground" />
              </DialogTitle>
              <DialogDescription>
                {order.buyer.name} · {order.county} · {order.deliveryMethod === 'COLLECTION' ? 'customer collects' : 'delivery to customer'}
                {' '}· placed {dateLabel(order.createdAt)}
              </DialogDescription>
            </DialogHeader>

            {order.status === 'REJECTED' && order.rejectedReason && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Rejected</AlertTitle>
                <AlertDescription>{order.rejectedReason}</AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            {canRespond && order.status === 'SUBMITTED' && (
              <AcceptRejectSection order={order} busy={busy} act={act} branches={branches} />
            )}
            {canRespond && ['ACCEPTED', 'CONFIRMED'].includes(order.status) && (
              <DispatchSection order={order} busy={busy} act={act} />
            )}
            {canRespond && order.status === 'DISPATCHED' && (
              <MarkDeliveredSection order={order} busy={busy} act={act} />
            )}

            <ItemsTable order={order} />

            {/* Customer + payment panels */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Card>
                <CardContent className="space-y-2 px-4 py-4 text-sm">
                  <p className="flex items-center gap-2 font-semibold"><MapPin className="h-4 w-4 text-muted-foreground" /> {order.deliveryMethod === 'COLLECTION' ? 'Collection' : 'Delivery'}</p>
                  <dl className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex gap-1"><User className="h-3 w-3 shrink-0" /><span>{order.buyer.name}</span></div>
                    <div className="flex gap-1"><Phone className="h-3 w-3 shrink-0" /><span className="font-mono">{order.phone}</span></div>
                    <div className="flex gap-1"><MapPin className="h-3 w-3 shrink-0" /><span>{order.address}, {order.county}</span></div>
                    {order.fulfillmentBranch && <div>Fulfilment: {order.fulfillmentBranch.name}</div>}
                    {order.courierName && <div>Courier: {order.courierName}</div>}
                    {order.otpHint && (
                      <div className="rounded-md bg-muted/60 px-2 py-1.5">
                        Collection code ends <span className="font-mono font-semibold text-foreground">··{order.otpHint}</span> — the customer received the full code in their notifications. Ask them to read it out at handover.
                      </div>
                    )}
                    {order.notes && <div className="rounded-md bg-muted/60 px-2 py-1.5">Customer note: “{order.notes}”</div>}
                  </dl>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-2 px-4 py-4 text-sm">
                  <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-muted-foreground" /> Payment</p>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={order.paymentStatus} labels={CO_PAYMENT_LABELS} classes="bg-muted text-muted-foreground" />
                    {order.invoice && (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <BadgeCheck className="h-3 w-3" /> Invoice {order.invoice.refCode} · {order.invoice.status}
                      </Badge>
                    )}
                  </div>
                  {order.invoice ? (
                    <p className="text-xs text-muted-foreground">
                      A {money(order.invoice.amountMinor, order.currency)} invoice was issued to the customer
                      {order.invoice.dueDate ? ` — due ${dateLabel(order.invoice.dueDate)}` : ''}.
                      {order.invoice.status === 'PAID' ? ' It has been paid.' : ' The customer pays it via M-Pesa from their account; states update only when the provider confirms.'}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">No invoice yet — one is issued automatically when you accept the order.</p>
                  )}
                </CardContent>
              </Card>
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

// ───────────────────────────── Accept / reject ─────────────────────────────

function AcceptRejectSection({ order, busy, act, branches }: {
  order: NonNullable<ConsumerOrderDetail['order']>
  busy: string | null
  act: (key: string, fn: () => Promise<unknown>) => Promise<unknown>
  branches: FetchState<{ branches: BranchItem[] }>
}) {
  const [mode, setMode] = useState<'choose' | 'accept' | 'reject'>('choose')
  const [branchId, setBranchId] = useState('')
  const [reason, setReason] = useState('')

  const activeBranches = (branches.data?.branches ?? []).filter((b) => b.status === 'ACTIVE')
  const selected = activeBranches.find((b) => b.id === branchId) ?? null

  if (mode === 'choose') {
    return (
      <Card className="border-primary/30">
        <CardContent className="space-y-3 px-4 py-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold"><Inbox className="h-4 w-4 text-primary" /> Respond to this order</p>
            <p className="text-xs text-muted-foreground">
              Accepting takes the goods off your shelf at the fulfilling branch and issues a payable invoice to the customer. Rejecting asks for a reason the customer will see.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" disabled={busy !== null} onClick={() => setMode('accept')}>
              <CheckCircle2 className="h-4 w-4" /> Accept
            </Button>
            <Button variant="ghost" className="min-h-11 text-destructive hover:text-destructive" disabled={busy !== null} onClick={() => setMode('reject')}>
              <XCircle className="h-4 w-4" /> Reject
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (mode === 'accept') {
    return (
      <Card className="border-primary/30">
        <CardContent className="space-y-3 px-4 py-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold"><PackageCheck className="h-4 w-4 text-primary" /> Accept from a branch</p>
            <p className="text-xs text-muted-foreground">
              Pick the warehouse that holds the stock. Leave it on “best stocked” to let the system choose the branch that can cover every line.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="co-branch">Fulfilling branch / warehouse</Label>
            <Select value={branchId || undefined} onValueChange={setBranchId}>
              <SelectTrigger id="co-branch" aria-label="Fulfilling branch"><SelectValue placeholder="Best stocked branch (auto)" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {activeBranches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name} ({b.kind === 'WAREHOUSE' ? 'Warehouse' : 'Branch'} · {b.county})</SelectItem>
                ))}
                {activeBranches.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No active branches — add one under Warehouses first.</div>}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => { setMode('choose'); setBranchId('') }} disabled={busy !== null}>Back</Button>
            <Button
              className="min-h-11"
              disabled={busy !== null}
              onClick={() =>
                act('accept', () =>
                  apiSend(`/api/orders/${order.id}`, 'POST', {
                    action: 'accept',
                    fulfillmentBranchId: selected ? selected.id : undefined,
                  })
                ).then((res) => {
                  if (res) {
                    const message = (res as { message?: string }).message
                    if (message) toast.success(message)
                    setMode('choose')
                  }
                })
              }
            >
              {busy === 'accept' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Accept order
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-destructive/30">
      <CardContent className="space-y-3 px-4 py-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive"><XCircle className="h-4 w-4" /> Reject this order</p>
          <p className="text-xs text-muted-foreground">The customer sees your reason. Nothing has been reserved yet, so no stock changes.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="co-reject-reason">Reason (required, min 5 characters)</Label>
          <Textarea id="co-reject-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
            placeholder="e.g. This part is discontinued; an equivalent is available on request." />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => { setMode('choose'); setReason('') }} disabled={busy !== null}>Back</Button>
          <Button
            variant="destructive"
            className="min-h-11"
            disabled={busy !== null || reason.trim().length < 5}
            onClick={() =>
              act('reject', () =>
                apiSend(`/api/orders/${order.id}`, 'POST', { action: 'reject', reason: reason.trim() })
              ).then((res) => {
                if (res) {
                  toast.success('Order rejected')
                  setMode('choose')
                }
              })
            }
          >
            {busy === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject order
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ───────────────────────────── Dispatch ─────────────────────────────

function DispatchSection({ order, busy, act }: {
  order: NonNullable<ConsumerOrderDetail['order']>
  busy: string | null
  act: (key: string, fn: () => Promise<unknown>) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [courierName, setCourierName] = useState('')

  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold"><Truck className="h-4 w-4 text-primary" /> Dispatch order</p>
            <p className="text-xs text-muted-foreground">
              Recording dispatch generates a 6-digit collection code and delivers it to the customer&apos;s notifications. They share it with the courier; you enter it at handover.
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
            <div className="space-y-1.5">
              <Label htmlFor="co-courier">Courier / transport company</Label>
              <Input id="co-courier" value={courierName} onChange={(e) => setCourierName(e.target.value)} placeholder="e.g. G4S Courier" maxLength={120} />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy !== null}>Cancel</Button>
              <Button
                className="min-h-11"
                disabled={busy !== null || courierName.trim().length < 2}
                onClick={() =>
                  act('dispatch', () =>
                    apiSend(`/api/orders/${order.id}`, 'POST', { action: 'dispatch', courierName: courierName.trim() })
                  ).then((res) => {
                    if (res) {
                      const message = (res as { message?: string }).message
                      if (message) toast.success(message)
                      setOpen(false)
                    }
                  })
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

// ───────────────────────────── Mark delivered ─────────────────────────────

function MarkDeliveredSection({ order, busy, act }: {
  order: NonNullable<ConsumerOrderDetail['order']>
  busy: string | null
  act: (key: string, fn: () => Promise<unknown>) => Promise<unknown>
}) {
  const [code, setCode] = useState('')

  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-3 px-4 py-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><PackageCheck className="h-4 w-4 text-primary" /> Mark delivered</p>
          <p className="text-xs text-muted-foreground">
            Enter the 6-digit collection code the customer received{order.otpHint ? ` — it ends ··${order.otpHint}` : ''}. This proves the handover.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="co-code">Collection code</Label>
            <Input id="co-code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="6-digit code" maxLength={6} className="w-36 font-mono" autoComplete="off" />
          </div>
          <Button
            className="min-h-11"
            disabled={busy !== null || code.trim().length < 4}
            onClick={() =>
              act('delivered', () =>
                apiSend(`/api/orders/${order.id}`, 'POST', { action: 'delivered', code: code.trim() })
              ).then((res) => {
                if (res) {
                  const message = (res as { message?: string }).message
                  if (message) toast.success(message)
                  setCode('')
                }
              })
            }
          >
            {busy === 'delivered' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Mark delivered
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ───────────────────────────── Items + timeline ─────────────────────────────

function ItemsTable({ order }: { order: NonNullable<ConsumerOrderDetail['order']> }) {
  const subtotal = order.items.reduce((sum, i) => sum + i.lineTotalMinor, 0)
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
                      <p className="font-mono text-[11px] text-muted-foreground">{i.sku}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-right">{i.qty}</td>
                <td className="px-3 py-2 text-right">{money(i.unitPriceMinor, order.currency)}</td>
                <td className="px-3 py-2 text-right">{money(i.lineTotalMinor, order.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 border-t border-border bg-muted/20 px-3 py-2.5 text-sm">
        <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{money(subtotal, order.currency)}</span></div>
        <div className="flex justify-between text-muted-foreground"><span>Delivery fee</span><span>{money(order.deliveryFeeMinor, order.currency)}</span></div>
        <div className="flex justify-between font-semibold"><span>Total</span><span>{money(order.totalMinor, order.currency)}</span></div>
      </div>
    </div>
  )
}

function Timeline({ order }: { order: NonNullable<ConsumerOrderDetail['order']> }) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Timeline</p>
      <ol className="scrollbar-thin max-h-56 space-y-0 overflow-y-auto pr-1">
        {order.events.map((e) => (
          <li key={e.id} className="relative border-l border-border pb-3 pl-4 last:pb-0">
            <span className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full bg-primary/60" />
            <p className="text-xs">
              <span className="font-medium">{e.type.replaceAll('_', ' ')}</span>
              {' '}· {EVENT_SIDE_LABELS[e.actorSide] ?? 'Party'}
              {e.actorName ? ` (${e.actorName})` : ''}
              {' '}· {new Date(e.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
            {e.note && <p className="mt-0.5 text-xs text-muted-foreground">{e.note}</p>}
          </li>
        ))}
        {order.events.length === 0 && <li className="text-xs text-muted-foreground">No events recorded.</li>}
      </ol>
    </div>
  )
}
