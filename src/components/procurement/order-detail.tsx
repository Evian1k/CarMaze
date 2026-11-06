'use client'

/* Order detail dialog: the protected order lifecycle for the GARAGE side.
 * Renders the 9-step lifecycle with exactly the backend's action union
 * (POST /api/supply/orders/[id]/action). The action panels themselves
 * (payment, handover, cancel, inspection, release, dispute/return/warranty,
 * claims record and timeline) live in order-actions.tsx. */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Check, Truck, MapPin, ShieldCheck, Building2, Navigation, CalendarClock,
  ScrollText, RefreshCw,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { apiGet, apiSend, ClientApiError } from '@/lib/client'
import { money } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Img, StatusChip, PaymentChip, BtnSpinner, When, dateTimeLabel,
  kesToMinor, canApprove, canOrder, STEPS, stepIndex, ARRANGEABLE, PayStatus, Row,
  type OrderDetailResponse, type OrderDetailData,
} from './shared'
import { HandoverPanel, PaymentPanel } from './order-payment'
import {
  CancelSection, InspectionPanel, PostDeliveryActions, ClaimsPanel, Timeline,
} from './order-actions'

const DELIVERY_METHODS = [
  { value: 'DIRECT', label: 'Direct to my branch', hint: 'Supplier delivers to your chosen destination branch.' },
  { value: 'COLLECTION', label: 'Collect from supplier', hint: 'Pick the parts up at one of the supplier\u2019s warehouses.' },
  { value: 'MEETUP', label: 'Meet at agreed location', hint: 'Propose a handover point: both parties must agree before it is locked.' },
]

export function OrderDetailDialog({ orderId, open, onOpenChange, roleFallback, onChanged }: {
  orderId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  roleFallback: string
  /** Parent list refresh after any successful action. */
  onChanged: () => void
}) {
  const [data, setData] = useState<{ key: string; detail: OrderDetailResponse } | null>(null)
  const [payStatusRaw, setPayStatus] = useState<{ key: string; data: PayStatus } | null>(null)
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null)
  const [busy, setBusy] = useState('')

  const role = data && data.key === orderId ? (data.detail.role || roleFallback) : roleFallback
  const order = data && data.key === orderId ? data.detail.order : null

  const load = useCallback(() => {
    let stale = false
    apiGet<OrderDetailResponse>(`/api/supply/orders/${orderId}`)
      .then((d) => { if (!stale) { setData({ key: orderId, detail: d }); setLoadError(null) } })
      .catch((e: unknown) => {
        if (stale) return
        setLoadError({ key: orderId, message: e instanceof ClientApiError ? e.message : 'Could not load this order.' })
      })
    apiGet<PayStatus>(`/api/supply/orders/${orderId}/pay`)
      .then((d) => { if (!stale) setPayStatus({ key: orderId, data: d }) })
      .catch(() => { /* payment panel reads order.payment as fallback */ })
    return () => { stale = true }
  }, [orderId])

  useEffect(() => {
    if (!open || !orderId) return
    return load()
  }, [open, orderId, load])

  const reload = useCallback(() => {
    load()
    onChanged()
  }, [load, onChanged])

  const payStatus = payStatusRaw && payStatusRaw.key === orderId ? payStatusRaw.data : null

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-3xl lg:max-w-4xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Order detail</DialogTitle>
          <DialogDescription>Purchase order lifecycle, delivery, payment and actions.</DialogDescription>
        </DialogHeader>
        {loadError && loadError.key === orderId ? (
          <div className="py-10 text-center">
            <p className="text-sm text-destructive">{loadError.message}</p>
            <Button variant="outline" className="mt-3" onClick={() => { setLoadError(null); load() }}>
              <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> Retry
            </Button>
          </div>
        ) : !order ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        ) : (
          <ScrollArea className="-mx-2 max-h-[calc(92vh-4rem)] px-2 scrollbar-thin">
            <div className="space-y-5 pb-4 pr-1">
              <Header order={order} />
              <Stepper order={order} />
              {order.supplierNote && (
                <Alert className="border-violet-500/30 bg-violet-500/5 [&>svg]:text-violet-500">
                  <ScrollText className="h-4 w-4" aria-hidden="true" />
                  <AlertTitle>Supplier note</AlertTitle>
                  <AlertDescription>{order.supplierNote}</AlertDescription>
                </Alert>
              )}
              <RevisionPanel order={order} busy={busy} setBusy={setBusy} reload={reload} role={role} />
              <ItemsPanel order={order} />
              <MoneyPanel order={order} payStatus={payStatus} />
              <DeliveryPanel order={order} busy={busy} setBusy={setBusy} reload={reload} role={role} />
              <HandoverPanel order={order} busy={busy} setBusy={setBusy} reload={reload} />
              <PaymentPanel order={order} payStatus={payStatus} role={role} busy={busy} setBusy={setBusy} reload={reload} />
              <CancelSection order={order} busy={busy} setBusy={setBusy} reload={reload} role={role} />
              <InspectionPanel order={order} busy={busy} setBusy={setBusy} reload={reload} role={role} />
              <PostDeliveryActions order={order} busy={busy} setBusy={setBusy} reload={reload} role={role} />
              <ClaimsPanel order={order} />
              <Timeline order={order} />
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────── Header + stepper ───────────────────────────

function Header({ order }: { order: OrderDetailData }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-lg font-bold">{order.refCode}</h2>
          <StatusChip status={order.status} />
          <PaymentChip status={order.paymentStatus} />
          {order.inspectionStatus && (
            <Badge variant="outline" className="border-border text-muted-foreground">Inspection: {order.inspectionStatus}</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Supplier <span className="font-medium text-foreground">{order.supplier.name}</span>
          {order.supplier.verified && <ShieldCheck className="ml-1 inline h-3.5 w-3.5 text-primary" aria-label="Verified supplier" />}
          {' · '}{[order.supplier.county, order.supplier.town].filter(Boolean).join(', ')}
          {order.supplier.verified && (order.supplier.phone || order.supplier.email) && (
            <> · {order.supplier.phone ?? ''}{order.supplier.phone && order.supplier.email ? ' · ' : ''}{order.supplier.email ?? ''}</>
          )}
        </p>
        {order.destinationBranch && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
            Destination: {order.destinationBranch.name} ({order.destinationBranch.code})
          </p>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">Created {dateTimeLabel(order.createdAt)}</p>
      </div>
      <div className="text-right">
        <p className="text-xs text-muted-foreground">Order total</p>
        <p className="text-xl font-bold tabular-nums">{money(order.totalMinor, order.currency)}</p>
      </div>
    </div>
  )
}

function Stepper({ order }: { order: OrderDetailData }) {
  const idx = stepIndex(order.status)
  const terminalBad = idx === -1
  return (
    <div className="rounded-xl border border-border bg-card/50 p-3">
      {terminalBad ? (
        <div className="flex items-center justify-center gap-2 py-1">
          <StatusChip status={order.status} />
          <span className="text-sm text-muted-foreground">
            {order.status === 'CANCELLED'
              ? 'This order was cancelled: no further actions apply.'
              : order.status === 'REJECTED'
                ? 'The supplier rejected this order.'
                : 'Lifecycle paused while the dispute is investigated.'}
          </span>
        </div>
      ) : (
        <ol className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-0" aria-label="Order lifecycle">
          {STEPS.map((label, i) => {
            const done = i < idx
            const current = i === idx
            return (
              <li key={label} className="flex flex-1 items-center gap-1.5 sm:flex-col sm:gap-1">
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                    done && 'border-emerald-500/50 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                    current && 'border-primary bg-primary text-primary-foreground',
                    !done && !current && 'border-border bg-muted text-muted-foreground'
                  )}
                  aria-current={current ? 'step' : undefined}
                >
                  {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
                </span>
                <span className={cn('text-[11px] leading-tight', current ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{label}</span>
                {i < STEPS.length - 1 && <span className="hidden h-px flex-1 bg-border sm:block" aria-hidden="true" />}
              </li>
            )
          })}
        </ol>
      )}
      {order.status === 'AWAITING_APPROVAL' && (
        <p className="mt-2 text-center text-xs text-amber-600 dark:text-amber-400">
          Internal approval gate: this order is not visible to the supplier until management approves it.
        </p>
      )}
    </div>
  )
}

// ─────────────────────────── Supplier revision decision ───────────────────────────

function RevisionPanel({ order, busy, setBusy, reload, role }: {
  order: OrderDetailData
  busy: string
  setBusy: (v: string) => void
  reload: () => void
  role: string
}) {
  const pending = order.revisions.filter((r) => r.status === 'PENDING')
  if (pending.length === 0 && order.status !== 'REVISED') return null
  const mayDecide = canApprove(role)

  async function decide(revisionId: string, decision: 'APPROVED' | 'DECLINED') {
    setBusy(`revision-${revisionId}`)
    try {
      const res = await apiSend<{ message: string }>(`/api/supply/orders/${order.id}/action`, 'POST', {
        action: 'revision-decision', revisionId, decision,
      })
      toast.success(res.message || 'Revision decision recorded.')
      reload()
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Could not record the decision.')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
      <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">Supplier proposed changes</h3>
      {pending.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">A revision was proposed on this order; see the timeline below.</p>
      ) : (
        pending.map((r) => (
          <div key={r.id} className="mt-2 space-y-2">
            <p className="text-sm text-muted-foreground">
              Proposed subtotal <span className="font-semibold text-foreground tabular-nums">{money(r.newTotalMinor, order.currency)}</span>
              {' · '}{r.note || 'No note provided'} · <When at={r.createdAt} />
            </p>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {(r.changes as { action?: string; qty?: number; unitPriceMinor?: number; productId?: string }[]).map((c, i) => (
                <li key={i}>
                  {c.action === 'REMOVE' ? 'Remove line' : c.action === 'ADD' ? 'Add line' : 'Update line'}
                  {c.qty ? `: qty ${c.qty}` : ''}{c.unitPriceMinor ? ` @ ${money(c.unitPriceMinor, order.currency)}` : ''}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button size="sm" disabled={!mayDecide || busy === `revision-${r.id}`} onClick={() => decide(r.id, 'APPROVED')}>
                {busy === `revision-${r.id}` ? <BtnSpinner className="mr-1.5" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                Approve revision
              </Button>
              <Button size="sm" variant="outline" disabled={!mayDecide || busy === `revision-${r.id}`} onClick={() => decide(r.id, 'DECLINED')}>
                Decline: original terms
              </Button>
            </div>
            {!mayDecide && <p className="text-xs text-muted-foreground">Only the owner or GM can decide on revisions.</p>}
          </div>
        ))
      )}
    </section>
  )
}

// ─────────────────────────── Items + money ───────────────────────────

function ItemsPanel({ order }: { order: OrderDetailData }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Items ({order.items.length})</h3>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {order.items.map((it) => (
          <li key={it.id} className="flex gap-3 p-3">
            <Img src={it.image} alt={it.name} className="h-12 w-12 shrink-0 rounded-md border border-border" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{it.name}</p>
              <p className="text-xs text-muted-foreground">
                {[it.brand, it.sku].filter(Boolean).join(' · ')} · {money(it.unitPriceMinor, order.currency)} × {it.qty}
                {' = '}<span className="tabular-nums">{money(it.lineTotalMinor, order.currency)}</span>
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {it.authenticityVerified && <Badge variant="outline" className="border-emerald-500/40 px-1.5 py-0 text-[10px] text-emerald-600 dark:text-emerald-400">Authenticity verified</Badge>}
                {it.warrantyMonths > 0 && <Badge variant="outline" className="border-border px-1.5 py-0 text-[10px] text-muted-foreground">{it.warrantyMonths}-month warranty</Badge>}
                {it.returnable && <Badge variant="outline" className="border-border px-1.5 py-0 text-[10px] text-muted-foreground">Returnable</Badge>}
                {it.qtyDelivered != null && <Badge variant="outline" className="border-border px-1.5 py-0 text-[10px] text-muted-foreground">Delivered {it.qtyDelivered}/{it.qty}</Badge>}
                {it.qtyAccepted != null && (
                  <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px]', it.qtyAccepted === it.qty
                    ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                    : 'border-amber-500/40 text-amber-600 dark:text-amber-400')}>
                    Accepted {it.qtyAccepted}/{it.qty}
                  </Badge>
                )}
              </div>
              {it.note && <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">{it.note}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function MoneyPanel({ order, payStatus }: { order: OrderDetailData; payStatus: PayStatus | null }) {
  return (
    <section className="space-y-1.5 rounded-xl border border-border bg-card/50 p-4 text-sm">
      <h3 className="text-sm font-semibold">Cost breakdown</h3>
      <Row label="Products (subtotal)" value={money(order.subtotalMinor, order.currency)} />
      <Row label="Delivery fee" value={money(order.deliveryFeeMinor, order.currency)} />
      <Row label="Tax" value={money(order.taxMinor, order.currency)} />
      <Row label="Order total" value={money(order.totalMinor, order.currency)} strong />
      {order.acceptedTotalMinor != null && (
        <Row label="Accepted value after inspection" value={money(order.acceptedTotalMinor, order.currency)} />
      )}
      <Separator className="my-1" />
      <p className="text-xs text-muted-foreground">
        Platform commission {payStatus ? `(${money(payStatus.estimatedCommissionMinor, order.currency)})` : ''} is recorded separately and taken from the supplier&apos;s proceeds at release: never charged on top of your total.
      </p>
    </section>
  )
}

// ─────────────────────────── Delivery (steps 3–4) ───────────────────────────

function DeliveryPanel({ order, busy, setBusy, reload, role }: {
  order: OrderDetailData
  busy: string
  setBusy: (v: string) => void
  reload: () => void
  role: string
}) {
  const d = order.delivery
  const mayArrange = canOrder(role) // delivery.arrange = OWNER/GM/PROCUREMENT
  const canArrangeNow = ARRANGEABLE.includes(order.status) && mayArrange
  const canAgree = Boolean(d && d.method === 'MEETUP' && d.status !== 'AGREED' && !d.meetupAgreedByGarage) && mayArrange

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Truck className="h-4 w-4 text-primary" aria-hidden="true" /> Delivery
        </h3>
        {d ? <Badge variant="outline" className="border-border text-muted-foreground">{d.method} · {d.status}</Badge> : null}
      </div>

      {!d && !canArrangeNow && (
        <p className="text-sm text-muted-foreground">
          Delivery is arranged after the supplier accepts{order.status === 'AWAITING_APPROVAL' ? ' (and management approves)' : ''} the order.
        </p>
      )}

      {d && (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>Reference <span className="font-mono text-foreground">{d.refCode}</span></p>
          {d.scheduledFor && <p className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Scheduled {dateTimeLabel(d.scheduledFor)}{d.windowLabel ? ` (${d.windowLabel})` : ''}</p>}
          {d.courierName && <p>Courier: {d.courierName}{d.driverName ? `: driver ${d.driverName}` : ''}{d.vehicleReg ? ` (${d.vehicleReg})` : ''}</p>}
          {d.deliveryRef && <p>Delivery ref: <span className="font-mono">{d.deliveryRef}</span></p>}
          {d.supplierBranch && <p>Collection point: {d.supplierBranch.name}, {[d.supplierBranch.town, d.supplierBranch.county].filter(Boolean).join(', ')}</p>}
          {d.meetup?.address && <p className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Handover point: {d.meetup.address}{d.meetup.lat != null && d.meetup.lng != null ? ` (${d.meetup.lat.toFixed(5)}, ${d.meetup.lng.toFixed(5)})` : ''}</p>}
          {d.meetup?.address && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              <AgreementFlag label="Garage" agreed={d.meetupAgreedByGarage} />
              <AgreementFlag label="Supplier" agreed={d.meetupAgreedBySupplier} />
            </div>
          )}
          {d.dispatchedAt && <p>Dispatched {dateTimeLabel(d.dispatchedAt)}{d.expectedAt ? `: expected by ${dateTimeLabel(d.expectedAt)}` : ''}</p>}
          {d.garageConfirmAt && !d.supplierConfirmAt && (
            <p className="text-amber-600 dark:text-amber-400">Handover verified by you: awaiting supplier confirmation to mark the delivery DELIVERED.</p>
          )}
          {d.failedReason && <p className="text-rose-600 dark:text-rose-400">Delivery problem: {d.failedReason}</p>}
          <p>Fee agreed: {money(d.feeMinor, order.currency)}</p>
        </div>
      )}

      {canArrangeNow && (
        <ArrangeForm order={order} busy={busy} setBusy={setBusy} reload={reload} />
      )}

      {canAgree && (
        <Button
          disabled={busy === 'agree-location'}
          onClick={async () => {
            setBusy('agree-location')
            try {
              const res = await apiSend<{ message: string }>(`/api/supply/orders/${order.id}/action`, 'POST', { action: 'agree-location' })
              toast.success(res.message || 'Agreement recorded.')
              reload()
            } catch (e) {
              toast.error(e instanceof ClientApiError ? e.message : 'Could not record agreement.')
            } finally {
              setBusy('')
            }
          }}
        >
          {busy === 'agree-location' ? <BtnSpinner className="mr-1.5" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          Agree to this location
        </Button>
      )}
    </section>
  )
}

function AgreementFlag({ label, agreed }: { label: string; agreed: boolean }) {
  return (
    <Badge variant="outline" className={agreed
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : 'border-border bg-muted text-muted-foreground'}>
      {agreed ? <Check className="mr-1 h-3 w-3" aria-hidden="true" /> : null}
      {label} {agreed ? 'agreed' : 'pending'}
    </Badge>
  )
}

// ─────────────────────────── Arrange form (step 3) ───────────────────────────

function ArrangeForm({ order, busy, setBusy, reload }: {
  order: OrderDetailData
  busy: string
  setBusy: (v: string) => void
  reload: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      {!open ? (
        <Button onClick={() => setOpen(true)} disabled={busy !== ''}>
          <Truck className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {order.delivery ? 'Change delivery arrangement' : 'Arrange delivery'}
        </Button>
      ) : (
        <ArrangeFormInner order={order} busy={busy} setBusy={setBusy} reload={() => { setOpen(false); reload() }} onCancel={() => setOpen(false)} />
      )}
    </div>
  )
}

function ArrangeFormInner({ order, busy, setBusy, reload, onCancel }: {
  order: OrderDetailData
  busy: string
  setBusy: (v: string) => void
  reload: () => void
  onCancel: () => void
}) {
  const [method, setMethod] = useState<'DIRECT' | 'COLLECTION' | 'MEETUP'>('DIRECT')
  const [supplierBranches, setSupplierBranches] = useState<{ id: string; name: string; code: string; county: string; town: string | null; isPrimary: boolean }[] | null>(null)
  const [supplierBranchId, setSupplierBranchId] = useState('')
  const [address, setAddress] = useState(order.delivery?.meetup?.address ?? '')
  const [lat, setLat] = useState(order.delivery?.meetup?.lat != null ? String(order.delivery.meetup.lat) : '')
  const [lng, setLng] = useState(order.delivery?.meetup?.lng != null ? String(order.delivery.meetup.lng) : '')
  const [geoBusy, setGeoBusy] = useState(false)
  const [scheduledFor, setScheduledFor] = useState('')
  const [windowLabel, setWindowLabel] = useState(order.delivery?.windowLabel ?? '')
  const [fee, setFee] = useState(order.delivery ? String(order.delivery.feeMinor / 100) : '0')
  const [courierName, setCourierName] = useState(order.delivery?.courierName ?? '')

  // supplier warehouses are public storefront data; needed for COLLECTION
  useEffect(() => {
    if (method !== 'COLLECTION' || supplierBranches !== null) return
    let stale = false
    apiGet<{ branches: { id: string; name: string; code: string; county: string; town: string | null; isPrimary: boolean }[] }>(`/api/suppliers/${order.supplier.id}`)
      .then((d) => { if (!stale) setSupplierBranches(d.branches) })
      .catch(() => { if (!stale) setSupplierBranches([]) })
    return () => { stale = true }
  }, [method, supplierBranches, order.supplier.id])

  function useMyLocation() {
    if (!('geolocation' in navigator)) {
      toast.error('Geolocation is not available in this browser.')
      return
    }
    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6))
        setLng(pos.coords.longitude.toFixed(6))
        setGeoBusy(false)
        if (!address.trim()) setAddress('Current location (adjust the address text)')
      },
      () => { setGeoBusy(false); toast.error('Could not read your location: check browser permissions.') },
      { enableHighAccuracy: true, timeout: 10_000 }
    )
  }

  async function submit() {
    const feeMinor = fee.trim() === '' ? 0 : kesToMinor(fee) ?? -1
    if (feeMinor < 0) {
      toast.error('Enter the delivery fee as a KES amount (or 0).')
      return
    }
    const body: Record<string, unknown> = { action: 'arrange', method, feeMinor }
    if (supplierBranchId) body.supplierBranchId = supplierBranchId
    if (method === 'MEETUP') {
      const latNum = Number(lat)
      const lngNum = Number(lng)
      if (address.trim().length < 4 || !Number.isFinite(latNum) || !Number.isFinite(lngNum) || Math.abs(latNum) > 90 || Math.abs(lngNum) > 180) {
        toast.error('Propose a handover point: an address plus valid lat/lng (or use your current location).')
        return
      }
      body.meetup = { lat: latNum, lng: lngNum, address: address.trim() }
    }
    if (scheduledFor) body.scheduledFor = new Date(scheduledFor).toISOString()
    if (windowLabel.trim()) body.windowLabel = windowLabel.trim()
    if (courierName.trim()) body.courierName = courierName.trim()

    setBusy('arrange')
    try {
      const res = await apiSend<{ message: string }>(`/api/supply/orders/${order.id}/action`, 'POST', body)
      toast.success(res.message || 'Delivery arrangement saved.')
      reload()
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Could not arrange delivery.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {DELIVERY_METHODS.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setMethod(m.value as 'DIRECT' | 'COLLECTION' | 'MEETUP')}
            className={cn(
              'rounded-lg border p-2.5 text-left text-xs transition-colors',
              method === m.value ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40'
            )}
            aria-pressed={method === m.value}
          >
            <span className="block text-sm font-semibold">{m.label}</span>
            <span className="mt-0.5 block leading-snug">{m.hint}</span>
          </button>
        ))}
      </div>

      {method === 'COLLECTION' && (
        <div className="space-y-1.5">
          <Label>Supplier warehouse *</Label>
          {supplierBranches === null ? (
            <Skeleton className="h-9 w-full" />
          ) : supplierBranches.length === 0 ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">This supplier has no public warehouse listed; choose another method.</p>
          ) : (
            <Select value={supplierBranchId} onValueChange={setSupplierBranchId}>
              <SelectTrigger aria-label="Supplier warehouse"><SelectValue placeholder="Choose collection point" /></SelectTrigger>
              <SelectContent>
                {supplierBranches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name} ({b.code}){b.town ? `: ${b.town}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {method === 'MEETUP' && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Handover location</Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. Total Rongai petrol station, Magadi Road" aria-label="Meeting address" />
          <div className="grid grid-cols-2 gap-2">
            <Input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" placeholder="Latitude (e.g. -1.39215)" aria-label="Latitude" />
            <Input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" placeholder="Longitude (e.g. 36.74992)" aria-label="Longitude" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={useMyLocation} disabled={geoBusy}>
              {geoBusy ? <BtnSpinner className="mr-1.5" /> : <Navigation className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              Use my current location
            </Button>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Both parties must agree before the location is locked; changes require new mutual agreement.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="arr-when">Preferred date & time</Label>
          <Input id="arr-when" type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="arr-window">Window label</Label>
          <Input id="arr-window" value={windowLabel} onChange={(e) => setWindowLabel(e.target.value)} maxLength={60} placeholder="e.g. Morning (08:00–12:00)" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="arr-fee">Delivery fee (KES)</Label>
          <Input id="arr-fee" value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" placeholder="0" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="arr-courier">Courier / transport</Label>
          <Input id="arr-courier" value={courierName} onChange={(e) => setCourierName(e.target.value)} maxLength={80} placeholder="e.g. Supplier-owned" />
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={submit} disabled={busy === 'arrange'}>
          {busy === 'arrange' ? <BtnSpinner className="mr-1.5" /> : null} Save arrangement
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
