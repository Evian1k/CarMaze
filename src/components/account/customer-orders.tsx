'use client'

/* Account → Orders tab: parts the signed-in customer ordered from verified
 * suppliers. Track the lifecycle, cancel while still awaiting acceptance,
 * confirm receipt after delivery, and pay the issued invoice via M-Pesa STK
 * push (the payment endpoint returns an honest 501 when M-Pesa is not
 * configured — that message is surfaced as-is, never simulated).
 *
 * The dispatch collection code lives in the customer's notifications; only the
 * server-provided hint (last 4 digits) is shown here.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Bell, ClipboardList, CreditCard, Flag, Loader2, MapPin, Package, Phone, Truck,
} from 'lucide-react'
import { apiGet, apiSend, navigate } from '@/lib/client'
import { money, timeAgo } from '@/lib/format'
import { useAuth } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type OrderItem = {
  id: string
  productId: string
  name: string
  sku: string
  qty: number
  unitPriceMinor: number
  lineTotalMinor: number
  image: string | null
}

type CustomerOrder = {
  id: string
  refCode: string
  status: string
  paymentStatus: string
  supplier: { id: string; name: string; county: string; verified: boolean }
  deliveryMethod: string
  county: string
  address: string
  phone: string
  notes: string | null
  courierName: string | null
  otpHint: string | null
  rejectedReason: string | null
  deliveredAt: string | null
  completedAt: string | null
  itemCount: number
  items: OrderItem[]
  deliveryFeeMinor: number
  totalMinor: number
  currency: string
  invoice: { id: string; refCode: string; status: string } | null
  createdAt: string
  updatedAt: string
}

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Awaiting supplier',
  ACCEPTED: 'Accepted by supplier',
  REJECTED: 'Rejected by supplier',
  CONFIRMED: 'Confirmed',
  DISPATCHED: 'Out for delivery',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  DISPUTED: 'Under dispute',
}

const BADGE_CLASS: Record<string, string> = {
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

const PAYMENT_LABELS: Record<string, string> = {
  UNPAID: 'Not paid',
  PROCESSING: 'Payment initiating',
  PAID: 'Paid',
  REFUNDED: 'Refunded',
}

const DISPUTE_REASONS = [
  { value: 'MISSING_ITEMS', label: 'Missing items' },
  { value: 'DAMAGED', label: 'Items arrived damaged' },
  { value: 'WRONG_ITEM', label: 'Wrong item delivered' },
  { value: 'COUNTERFEIT', label: 'Suspected counterfeit parts' },
  { value: 'NOT_RECEIVED', label: 'Never received the order' },
  { value: 'OTHER', label: 'Other problem' },
] as const

export function CustomerOrders() {
  const { user } = useAuth()
  const userPhone = user?.phone ?? ''
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [payOrder, setPayOrder] = useState<CustomerOrder | null>(null)
  const [payPhone, setPayPhone] = useState('')
  const [disputeOrder, setDisputeOrder] = useState<CustomerOrder | null>(null)
  const [disputeReason, setDisputeReason] = useState<string>('')
  const [disputeDetails, setDisputeDetails] = useState('')

  const load = useCallback(() => {
    apiGet<{ orders: CustomerOrder[] }>('/api/orders')
      .then((d) => setOrders(d.orders))
      .catch(() => setOrders([]))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Pre-fill the M-Pesa number from the profile once the user is known.
  useEffect(() => {
    if (userPhone) setPayPhone((p) => p || userPhone)
  }, [userPhone])

  async function act(key: string, fn: () => Promise<unknown>, done?: () => void) {
    setBusy(key)
    try {
      const res = await fn()
      const message = (res as { message?: string } | undefined)?.message
      if (message) toast.success(message)
      done?.()
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed — please try again.')
    } finally {
      setBusy(null)
    }
  }

  function openPay(o: CustomerOrder) {
    if (!o.invoice) {
      toast.error('No invoice has been issued for this order yet.')
      return
    }
    setPayPhone((p) => p || user?.phone || '')
    setPayOrder(o)
  }

  function submitPay() {
    if (!payOrder) return
    void act('pay', () => apiSend<{ status?: string; message?: string }>('/api/billing/mpesa/stkpush', 'POST', { invoiceId: payOrder.invoice!.id, phone: payPhone.trim() }), () => setPayOrder(null))
  }

  function openDispute(o: CustomerOrder) {
    setDisputeReason('')
    setDisputeDetails('')
    setDisputeOrder(o)
  }

  function submitDispute() {
    if (!disputeOrder) return
    if (!disputeReason) {
      toast.error('Choose what went wrong.')
      return
    }
    if (disputeDetails.trim().length < 20) {
      toast.error('Describe the problem in at least 20 characters so it can be acted on.')
      return
    }
    void act(
      'dispute',
      () => apiSend<{ message?: string }>(`/api/orders/${disputeOrder.id}`, 'POST', { action: 'dispute', reason: disputeReason, details: disputeDetails.trim() }),
      () => setDisputeOrder(null)
    )
  }

  if (orders === null) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><ClipboardList className="h-6 w-6" /></span>
        <h3 className="mt-3 font-semibold">No parts orders yet</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          When you order parts from a verified supplier, the order and its delivery progress appear here.
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('supply')}>Browse parts</Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {orders.map((o) => {
        const payable = ['ACCEPTED', 'CONFIRMED'].includes(o.status) && o.paymentStatus === 'UNPAID' && Boolean(o.invoice)
        return (
          <Card key={o.id}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{o.refCode}</span>
                  <Badge variant="secondary" className={cn('border-transparent font-medium', BADGE_CLASS[o.status] ?? 'bg-muted text-muted-foreground')}>
                    {STATUS_LABELS[o.status] ?? o.status}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">{PAYMENT_LABELS[o.paymentStatus] ?? o.paymentStatus}</Badge>
                  {o.invoice && (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <CreditCard className="h-3 w-3" /> Invoice {o.invoice.refCode} · {o.invoice.status}
                    </Badge>
                  )}
                </div>
                <span className="text-sm font-semibold">{money(o.totalMinor, o.currency)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {o.supplier.name}
                {o.supplier.verified ? ' · verified supplier' : ''} · placed {timeAgo(o.createdAt)}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-1.5">
                {o.items.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      {i.image
                        ? <img src={i.image} alt="" className="h-8 w-8 rounded border border-border object-cover" />
                        : <span className="flex h-8 w-8 items-center justify-center rounded border border-border bg-muted/40"><Package className="h-3.5 w-3.5 text-muted-foreground" /></span>}
                      <span className="min-w-0 truncate">{i.name} <span className="text-muted-foreground">× {i.qty}</span></span>
                    </span>
                    <span className="shrink-0 text-muted-foreground">{money(i.lineTotalMinor, o.currency)}</span>
                  </li>
                ))}
              </ul>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {o.address}, {o.county}</span>
                <span>{o.deliveryMethod === 'COLLECTION' ? 'Collection from supplier' : 'Delivery'}</span>
                <span>incl. {money(o.deliveryFeeMinor, o.currency)} delivery</span>
                {o.courierName && <span className="flex items-center gap-1"><Truck className="h-3 w-3" /> Courier: {o.courierName}</span>}
              </p>

              {o.status === 'REJECTED' && o.rejectedReason && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">Supplier rejected this order: {o.rejectedReason}</p>
              )}

              {o.status === 'DISPATCHED' && (
                <div className="rounded-lg border border-dashed px-3 py-2 text-xs">
                  <p className="flex items-center gap-1.5 font-medium"><Bell className="h-3.5 w-3.5 text-primary" /> Collection code</p>
                  {o.otpHint ? (
                    <p className="mt-1 text-muted-foreground">
                      The code ends <span className="font-mono font-semibold text-foreground">··{o.otpHint}</span> — the full 6-digit code was sent to your{' '}
                      <button className="inline text-primary hover:underline" onClick={() => navigate('/account?tab=notifications')}>notifications</button>.
                      Share it with the courier at handover.
                    </p>
                  ) : (
                    <p className="mt-1 text-muted-foreground">The full code was sent to your notifications — share it with the courier at handover.</p>
                  )}
                </div>
              )}

              {(o.status === 'SUBMITTED' || o.status === 'DELIVERED' || payable) && (
                <div className="flex flex-wrap justify-end gap-2">
                  {o.status === 'SUBMITTED' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={busy !== null}
                      onClick={() => act(`cancel-${o.id}`, () => apiSend(`/api/orders/${o.id}`, 'POST', { action: 'cancel' }))}
                    >
                      {busy === `cancel-${o.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Cancel order
                    </Button>
                  )}
                  {payable && (
                    <Button size="sm" disabled={busy !== null} onClick={() => openPay(o)}>
                      <CreditCard className="h-4 w-4" /> Pay {money(o.totalMinor, o.currency)}
                    </Button>
                  )}
                  {o.status === 'DELIVERED' && (
                    <Button size="sm" disabled={busy !== null} onClick={() => act(`confirm-${o.id}`, () => apiSend(`/api/orders/${o.id}`, 'POST', { action: 'confirm' }))}>
                      {busy === `confirm-${o.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Confirm receipt
                    </Button>
                  )}
                  {(o.status === 'DELIVERED' || o.status === 'COMPLETED') && (
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={busy !== null} onClick={() => openDispute(o)}>
                      <Flag className="h-4 w-4" /> Report a problem
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}

      {/* Dispute dialog — opens a real dispute reviewed by the platform team */}
      <Dialog open={disputeOrder !== null} onOpenChange={(open) => { if (!open) setDisputeOrder(null) }}>
        <DialogContent className="sm:max-w-md">
          {disputeOrder && (
            <>
              <DialogHeader>
                <DialogTitle>Report a problem with {disputeOrder.refCode}</DialogTitle>
                <DialogDescription>
                  Your report goes to the supplier and the CARMAZE disputes team with the order record. Payments are never moved by this form — any refund is decided and processed by the disputes and finance teams.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>What went wrong?</Label>
                  <Select value={disputeReason || undefined} onValueChange={setDisputeReason}>
                    <SelectTrigger aria-label="Dispute reason"><SelectValue placeholder="Select the problem" /></SelectTrigger>
                    <SelectContent>
                      {DISPUTE_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dispute-details">Describe what happened</Label>
                  <Textarea
                    id="dispute-details"
                    rows={4}
                    value={disputeDetails}
                    onChange={(e) => setDisputeDetails(e.target.value)}
                    placeholder="Include what was ordered vs delivered, the condition on arrival, and anything the courier noted…"
                    maxLength={2000}
                  />
                  <p className="text-xs text-muted-foreground">Minimum 20 characters. Both parties see this text.</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDisputeOrder(null)} disabled={busy !== null}>Cancel</Button>
                <Button onClick={submitDispute} disabled={busy !== null || disputeDetails.trim().length < 20 || !disputeReason}>
                  {busy === 'dispute' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />} Open dispute
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* M-Pesa payment dialog — honest states only */}
      <Dialog open={payOrder !== null} onOpenChange={(open) => { if (!open) setPayOrder(null) }}>
        <DialogContent className="sm:max-w-md">
          {payOrder && (
            <>
              <DialogHeader>
                <DialogTitle>Pay invoice {payOrder.invoice?.refCode}</DialogTitle>
                <DialogDescription>
                  {money(payOrder.totalMinor, payOrder.currency)} to {payOrder.supplier.name} for order {payOrder.refCode}. You&apos;ll receive an M-Pesa push on your phone — enter your PIN to approve it.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="pay-phone" className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> M-Pesa number</Label>
                <Input id="pay-phone" type="tel" value={payPhone} onChange={(e) => setPayPhone(e.target.value)} placeholder="0712 345 678" inputMode="tel" />
                {payOrder.invoice?.status === 'PAID' && (
                  <p className="text-xs text-muted-foreground">This invoice is already marked paid.</p>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setPayOrder(null)} disabled={busy !== null}>Cancel</Button>
                <Button onClick={submitPay} disabled={busy !== null || payPhone.trim().length < 9}>
                  {busy === 'pay' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Send push
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
