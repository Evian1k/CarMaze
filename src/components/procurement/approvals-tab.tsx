'use client'

/* Approvals tab: purchase orders held at AWAITING_APPROVAL by the garage's
 * spending-limit gate. Owner/GM only (mirrors order.approve server matrix). */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Ban, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet, apiSend, ClientApiError } from '@/lib/client'
import { money, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Img, StatusChip, PaymentChip, EmptyState, BtnSpinner, canApprove,
  type OrdersResponse, type OrderListItem,
} from './shared'

export function ApprovalsTab({ orgId, role }: { orgId: string; role: string }) {
  const [orders, setOrders] = useState<OrderListItem[] | null>(null)
  const [busyId, setBusyId] = useState('')
  const [noteId, setNoteId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const mayApprove = canApprove(role)

  const load = useCallback(() => {
    let stale = false
    apiGet<OrdersResponse>(`/api/supply/orders?orgId=${encodeURIComponent(orgId)}&status=AWAITING_APPROVAL`)
      .then((d) => { if (!stale) setOrders(d.orders) })
      .catch((e: unknown) => {
        if (stale) return
        setOrders([])
        toast.error(e instanceof ClientApiError ? e.message : 'Could not load approval queue.')
      })
    return () => { stale = true }
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    return load()
  }, [orgId, load])

  async function approve(order: OrderListItem) {
    setBusyId(order.id)
    try {
      const res = await apiSend<{ message: string }>(`/api/supply/orders/${order.id}/action`, 'POST', {
        action: 'approve',
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      toast.success(res.message || 'Order approved and sent to the supplier.', { description: order.refCode })
      setNoteId(null)
      setNote('')
      load()
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Approval failed.')
    } finally {
      setBusyId('')
    }
  }

  async function reject(order: OrderListItem) {
    if (reason.trim().length < 3) {
      toast.error('Give a short rejection reason (min 3 characters).')
      return
    }
    setBusyId(order.id)
    try {
      const res = await apiSend<{ message: string }>(`/api/supply/orders/${order.id}/action`, 'POST', {
        action: 'cancel', reason: reason.trim(),
      })
      toast.success(res.message || 'Order rejected and cancelled.', { description: order.refCode })
      setRejectId(null)
      setReason('')
      load()
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Could not reject the order.')
    } finally {
      setBusyId('')
    }
  }

  if (!mayApprove) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Management approval area"
        description={`Your role (${role || 'unassigned'}) cannot approve purchase orders. Ask the owner or general manager.`}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Approval queue</h2>
        <p className="text-xs text-muted-foreground">
          Orders above the garage&apos;s spending limit are held here: suppliers only see them after approval.
        </p>
      </div>

      {orders === null ? (
        <div className="space-y-3"><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-32 rounded-xl" /></div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={Check}
          title="Nothing waiting for approval"
          description="New orders over the spending limit will appear here for sign-off."
        />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Card key={o.id} className="border-amber-500/40 bg-card p-0">
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold">{o.refCode}</span>
                      <StatusChip status={o.status} />
                      <PaymentChip status={o.paymentStatus} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{o.supplier.name}</span>
                      {o.supplier.verified && <Badge variant="outline" className="ml-1.5 border-primary/40 px-1 py-0 text-[10px] text-primary">Verified</Badge>}
                      {' · '}{o.itemCount} line{o.itemCount === 1 ? '' : 's'} · raised {timeAgo(o.createdAt)}
                      {o.destinationBranch ? ` · to ${o.destinationBranch.name}` : ''}
                    </p>
                  </div>
                  <p className="text-lg font-bold tabular-nums">{money(o.totalMinor, o.currency)}</p>
                </div>

                <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {o.items.map((it) => (
                    <li key={it.id} className="flex items-center gap-2 rounded-lg border border-border bg-background/40 p-2">
                      <Img src={it.image} alt={it.name} className="h-9 w-9 shrink-0 rounded border border-border" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{it.name}</p>
                        <p className="text-[11px] text-muted-foreground">{it.qty} × {money(it.unitPriceMinor)} = {money(it.lineTotalMinor)}</p>
                      </div>
                    </li>
                  ))}
                </ul>

                {noteId === o.id ? (
                  <div className={cn('mt-3 space-y-2 rounded-lg border border-border bg-background/40 p-3')}>
                    <Label htmlFor={`approve-note-${o.id}`}>Approval note (optional)</Label>
                    <Textarea id={`approve-note-${o.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="min-h-16" placeholder="e.g. Approved: urgent fleet job" />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busyId === o.id} onClick={() => approve(o)}>
                        {busyId === o.id ? <BtnSpinner className="mr-1.5" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />} Approve & send
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setNoteId(null); setNote('') }}>Cancel</Button>
                    </div>
                  </div>
                ) : rejectId === o.id ? (
                  <div className="mt-3 space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                    <Label htmlFor={`reject-reason-${o.id}`}>Rejection reason *</Label>
                    <Textarea id={`reject-reason-${o.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="min-h-16" placeholder="e.g. Over budget this month: re-order in May" />
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" disabled={busyId === o.id} onClick={() => reject(o)}>
                        {busyId === o.id ? <BtnSpinner className="mr-1.5" /> : <Ban className="mr-1.5 h-4 w-4" aria-hidden="true" />} Reject order
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setRejectId(null); setReason('') }}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" disabled={busyId === o.id} onClick={() => { setNoteId(o.id); setRejectId(null) }}>
                      {busyId === o.id ? <BtnSpinner className="mr-1.5" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />} Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={busyId === o.id} onClick={() => { setRejectId(o.id); setNoteId(null) }}>
                      <Ban className="mr-1.5 h-4 w-4" aria-hidden="true" /> Reject
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
