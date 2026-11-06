'use client'

/* Order lifecycle action panels (garage side): cancel (step 2 hook-in),
 * inspection (7), payment release (8), dispute / return / warranty (9),
 * the claims record and the merged order+delivery timeline.
 * Payment + handover live in order-payment.tsx. */

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Ban, ClipboardCheck, Unlock, MessageSquareWarning, Undo2, Wrench, Upload, Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { apiSend, ClientApiError } from '@/lib/client'
import { money } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Img, SideChip, QtyStepper, BtnSpinner, When, uploadOne,
  canApprove, canOrder, canPay, canDispute, stepIndex, CANCELABLE,
  type OrderDetailData,
} from './shared'

// ─────────────────────────── Cancel (step 2) ───────────────────────────

export function CancelSection({ order, busy, setBusy, reload, role }: {
  order: OrderDetailData
  busy: string
  setBusy: (v: string) => void
  reload: () => void
  role: string
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const mayCancel = canOrder(role)
  const cancelable = CANCELABLE.includes(order.status) && order.paymentStatus !== 'PROTECTED'
  if (!cancelable) return null

  async function submit() {
    if (reason.trim().length < 3) {
      toast.error('Give a short cancellation reason (min 3 characters).')
      return
    }
    setBusy('cancel')
    try {
      const res = await apiSend<{ message: string }>(`/api/supply/orders/${order.id}/action`, 'POST', { action: 'cancel', reason: reason.trim() })
      toast.success(res.message || 'Order cancelled.')
      setOpen(false)
      reload()
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Could not cancel the order.')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Ban className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Cancel order</h3>
          <p className="text-xs text-muted-foreground">Possible until dispatch{order.paymentStatus === 'PROTECTED' ? '' : ': stock reservations are released and the supplier is notified'}.</p>
        </div>
        {!open && (
          <Button variant="outline" size="sm" disabled={!mayCancel || busy !== ''} onClick={() => setOpen(true)}>
            Cancel this order
          </Button>
        )}
      </div>
      {!mayCancel && <p className="mt-1 text-xs text-muted-foreground">Cancellation needs the owner, GM or procurement role.</p>}
      {open && (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-background/40 p-3">
          <Label htmlFor="cancel-reason">Reason *</Label>
          <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="min-h-16" placeholder="e.g. Customer job rescheduled: needed next week instead" />
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={submit} disabled={busy === 'cancel'}>
              {busy === 'cancel' ? <BtnSpinner className="mr-1.5" /> : null} Confirm cancellation
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Keep order</Button>
          </div>
        </div>
      )}
    </section>
  )
}

// ─────────────────────────── Step 7: inspection ───────────────────────────

export function InspectionPanel({ order, busy, setBusy, reload, role }: {
  order: OrderDetailData
  busy: string
  setBusy: (v: string) => void
  reload: () => void
  role: string
}) {
  const d = order.delivery
  const active = order.status === 'DELIVERED' && d?.status === 'DELIVERED'
  const mayInspect = canApprove(role) // inspect requires order.approve server-side
  const [result, setResult] = useState<'ACCEPT' | 'PARTIAL' | 'ISSUES'>('ACCEPT')
  const [qtys, setQtys] = useState<Record<string, number>>(() =>
    Object.fromEntries(order.items.map((it) => [it.id, it.qtyAccepted ?? it.qty])))
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<string[]>([])

  if (!active) return null

  async function submit() {
    setBusy('inspect')
    try {
      const res = await apiSend<{ message: string; acceptedTotalMinor: number }>(`/api/supply/orders/${order.id}/action`, 'POST', {
        action: 'inspect',
        result,
        items: order.items.map((it) => ({ itemId: it.id, qtyAccepted: result === 'ACCEPT' ? it.qty : Math.min(qtys[it.id] ?? 0, it.qty), ...(notes[it.id]?.trim() ? { note: notes[it.id].trim() } : {}) })),
        ...(note.trim() ? { note: note.trim() } : {}),
        photos,
      })
      toast.success(res.message || 'Inspection recorded.', { description: `Accepted value: ${money(res.acceptedTotalMinor, order.currency)}` })
      reload()
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Could not record the inspection.')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <ClipboardCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> Delivery inspection
      </h3>
      <p className="text-sm text-muted-foreground">
        Check every line against the job sheet. What you accept here is what the supplier gets paid; shortfalls raise an automatic partial refund request.
      </p>
      <ul className="space-y-2">
        {order.items.map((it) => (
          <li key={it.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/40 p-3">
            <Img src={it.image} alt={it.name} className="h-10 w-10 shrink-0 rounded border border-border" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{it.name}</p>
              <p className="text-xs text-muted-foreground">Ordered {it.qty} · {money(it.unitPriceMinor, order.currency)}/unit</p>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Accepted</Label>
              <QtyStepper value={qtys[it.id] ?? 0} min={0} max={it.qty} onChange={(v) => setQtys((s) => ({ ...s, [it.id]: v }))} />
            </div>
            <Input
              value={notes[it.id] ?? ''} onChange={(e) => setNotes((s) => ({ ...s, [it.id]: e.target.value }))}
              placeholder="Line note (optional)" className="h-8 w-full sm:w-48" maxLength={300} aria-label={`Note for ${it.name}`}
            />
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(['ACCEPT', 'PARTIAL', 'ISSUES'] as const).map((r) => (
          <button
            key={r} type="button" onClick={() => setResult(r)} aria-pressed={result === r}
            className={cn(
              'rounded-lg border p-2.5 text-left text-xs transition-colors',
              result === r ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40'
            )}
          >
            <span className="block text-sm font-semibold">{r === 'ACCEPT' ? 'Accept all' : r === 'PARTIAL' ? 'Partial acceptance' : 'Issues reported'}</span>
            <span className="mt-0.5 block leading-snug">
              {r === 'ACCEPT' ? 'Everything matches the order.' : r === 'PARTIAL' ? 'Accept the quantities set above.' : 'Record problems: release is blocked until resolved.'}
            </span>
          </button>
        ))}
      </div>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-16" placeholder="Overall inspection note (optional)" aria-label="Inspection note" />
      <PhotoUploader photos={photos} onChange={setPhotos} label="Inspection photos (damages, shortfall, packaging)" />
      {mayInspect ? (
        <Button onClick={submit} disabled={busy === 'inspect'}>
          {busy === 'inspect' ? <BtnSpinner className="mr-1.5" /> : null} Record inspection
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Inspection is recorded by the owner or GM.</p>
      )}
    </section>
  )
}

// ─────────────────────────── Step 8 + 9: release / dispute / return / warranty ───────────────────────────

export function PostDeliveryActions({ order, busy, setBusy, reload, role }: {
  order: OrderDetailData
  busy: string
  setBusy: (v: string) => void
  reload: () => void
  role: string
}) {
  const postDelivery = stepIndex(order.status) >= 4 || order.status === 'DISPUTED'
  if (!postDelivery) return null
  const mayRelease = canPay(role)
  const mayReturn = canOrder(role)
  const mayDispute = canDispute(role)
  const releasable = order.status === 'INSPECTED' && order.paymentStatus === 'PROTECTED'
  const accepted = order.acceptedTotalMinor ?? order.totalMinor

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Unlock className="h-4 w-4 text-primary" aria-hidden="true" /> Next steps
      </h3>

      {order.status === 'INSPECTED' && (
        <div className="space-y-2 rounded-lg border border-teal-500/40 bg-teal-500/5 p-3">
          <p className="text-sm">
            Release <span className="font-bold tabular-nums">{money(accepted, order.currency)}</span> of the protected funds to the supplier.
          </p>
          <p className="text-xs text-muted-foreground">
            Platform commission is deducted from the supplier&apos;s proceeds at this point: you are never charged extra.
          </p>
          <Button disabled={!releasable || !mayRelease || busy === 'release'} onClick={async () => {
            setBusy('release')
            try {
              const res = await apiSend<{ message: string; releasedMinor: number; commissionMinor: number }>(`/api/supply/orders/${order.id}/action`, 'POST', { action: 'release' })
              toast.success(res.message || 'Payment released.', { description: `Released ${money(res.releasedMinor, order.currency)} · commission ${money(res.commissionMinor, order.currency)} recorded separately.` })
              reload()
            } catch (e) {
              toast.error(e instanceof ClientApiError ? e.message : 'Release failed.')
            } finally {
              setBusy('')
            }
          }}>
            {busy === 'release' ? <BtnSpinner className="mr-1.5" /> : <Unlock className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Request release
          </Button>
          {!mayRelease && <p className="text-xs text-muted-foreground">Release needs the owner, GM, procurement or accountant role.</p>}
          {!releasable && order.paymentStatus !== 'PROTECTED' && (
            <p className="text-xs text-muted-foreground">Funds are not in a protected state; release follows the provider&apos;s confirmation only.</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <DisputeDialog order={order} mayDispute={mayDispute} busy={busy} setBusy={setBusy} reload={reload} />
        <ReturnDialog order={order} mayReturn={mayReturn} busy={busy} setBusy={setBusy} reload={reload} />
        {order.items.some((it) => it.warrantyMonths > 0) && (
          <WarrantyDialog order={order} mayClaim={mayReturn} busy={busy} setBusy={setBusy} reload={reload} />
        )}
      </div>
    </section>
  )
}

function PhotoUploader({ photos, onChange, label, max = 6 }: {
  photos: string[]
  onChange: (urls: string[]) => void
  label: string
  max?: number
}) {
  const [uploading, setUploading] = useState(false)
  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    const next = [...photos]
    try {
      for (const f of Array.from(files).slice(0, max - photos.length)) {
        const url = await uploadOne(f)
        next.push(url)
      }
      onChange(next)
      toast.success('Photo attached.')
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Upload failed. JPG, PNG, WebP or PDF up to 8 MB.')
    } finally {
      setUploading(false)
    }
  }
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((url, i) => (
            <div key={url} className="group relative">
              <Img src={url} alt={`Attached evidence ${i + 1}`} className="h-14 w-14 rounded-md border border-border" />
              <button
                type="button" aria-label="Remove photo"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-destructive"
                onClick={() => onChange(photos.filter((u) => u !== url))}
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      {photos.length < max && (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background/40 px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
          {uploading ? <BtnSpinner /> : <Upload className="h-4 w-4" aria-hidden="true" />}
          {uploading ? 'Uploading…' : 'Attach photos'}
          <input
            type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={uploading}
            onChange={(e) => { handleFiles(e.target.files); e.currentTarget.value = '' }} aria-label="Attach photos"
          />
        </label>
      )}
    </div>
  )
}

const DISPUTE_REASONS = [
  { value: 'MISSING_ITEMS', label: 'Items missing' },
  { value: 'DAMAGED', label: 'Damaged goods' },
  { value: 'WRONG_ITEM', label: 'Wrong item delivered' },
  { value: 'COUNTERFEIT', label: 'Suspected counterfeit' },
  { value: 'NOT_RECEIVED', label: 'Nothing received' },
  { value: 'OTHER', label: 'Other' },
]

function DisputeDialog({ order, mayDispute, busy, setBusy, reload }: {
  order: OrderDetailData
  mayDispute: boolean
  busy: string
  setBusy: (v: string) => void
  reload: () => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('MISSING_ITEMS')
  const [details, setDetails] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const valid = details.trim().length >= 10

  async function submit() {
    setBusy('dispute')
    try {
      const res = await apiSend<{ message: string }>(`/api/supply/orders/${order.id}/action`, 'POST', {
        action: 'dispute',
        reason,
        details: details.trim(),
        evidence: photos.map((url) => ({ url, name: url.split('/').pop() ?? 'evidence' })),
      })
      toast.success(res.message || 'Dispute filed.')
      setOpen(false)
      reload()
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Could not open the dispute.')
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <Button variant="outline" disabled={!mayDispute} onClick={() => setOpen(true)}>
        <MessageSquareWarning className="mr-1.5 h-4 w-4" aria-hidden="true" /> Open dispute
      </Button>
      <Dialog open={open} onOpenChange={(v) => { if (busy !== 'dispute') setOpen(v) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Open a dispute: {order.refCode}</DialogTitle>
            <DialogDescription>
              Platform admins investigate with the full order, payment and delivery record. Funds may be frozen where the provider supports it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger aria-label="Dispute reason"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DISPUTE_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dispute-details">What happened? * (min 10 characters)</Label>
              <Textarea id="dispute-details" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} className="min-h-24" />
            </div>
            <PhotoUploader photos={photos} onChange={setPhotos} label="Evidence photos" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy === 'dispute'}>Cancel</Button>
            <Button variant="destructive" disabled={!valid || busy === 'dispute'} onClick={submit}>
              {busy === 'dispute' ? <BtnSpinner className="mr-1.5" /> : null} File dispute
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ReturnDialog({ order, mayReturn, busy, setBusy, reload }: {
  order: OrderDetailData
  mayReturn: boolean
  busy: string
  setBusy: (v: string) => void
  reload: () => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const returnables = order.items.filter((it) => it.returnable)
  const items = returnables.map((it) => ({ productId: it.productId, qty: qtys[it.id] ?? 0 })).filter((i) => i.qty > 0)
  const valid = reason.trim().length >= 5 && items.length > 0

  return (
    <>
      <Button variant="outline" disabled={!mayReturn || returnables.length === 0} onClick={() => setOpen(true)}>
        <Undo2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Request return
      </Button>
      <Dialog open={open} onOpenChange={(v) => { if (busy !== 'return') setOpen(v) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request a return: {order.refCode}</DialogTitle>
            <DialogDescription>The supplier is notified with the quantities you select.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {returnables.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items on this order are marked returnable by the supplier.</p>
            ) : (
              <ul className="space-y-2">
                {returnables.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{it.name}</p>
                      <p className="text-xs text-muted-foreground">Ordered {it.qty}</p>
                    </div>
                    <QtyStepper value={qtys[it.id] ?? 0} min={0} max={it.qty} onChange={(v) => setQtys((s) => ({ ...s, [it.id]: v }))} />
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="return-reason">Reason * (min 5 characters)</Label>
              <Textarea id="return-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="min-h-16" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy === 'return'}>Cancel</Button>
            <Button disabled={!valid || busy === 'return'} onClick={async () => {
              setBusy('return')
              try {
                await apiSend(`/api/supply/orders/${order.id}/action`, 'POST', { action: 'request-return', reason: reason.trim(), items })
                toast.success('Return request sent to the supplier.')
                setOpen(false)
                reload()
              } catch (e) {
                toast.error(e instanceof ClientApiError ? e.message : 'Could not request the return.')
              } finally {
                setBusy('')
              }
            }}>
              {busy === 'return' ? <BtnSpinner className="mr-1.5" /> : null} Send request
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function WarrantyDialog({ order, mayClaim, busy, setBusy, reload }: {
  order: OrderDetailData
  mayClaim: boolean
  busy: string
  setBusy: (v: string) => void
  reload: () => void
}) {
  const [open, setOpen] = useState(false)
  const [productId, setProductId] = useState('')
  const [issue, setIssue] = useState('')
  const warrantied = order.items.filter((it) => it.warrantyMonths > 0)
  const valid = productId !== '' && issue.trim().length >= 10

  return (
    <>
      <Button variant="outline" disabled={!mayClaim} onClick={() => setOpen(true)}>
        <Wrench className="mr-1.5 h-4 w-4" aria-hidden="true" /> Warranty claim
      </Button>
      <Dialog open={open} onOpenChange={(v) => { if (busy !== 'warranty') setOpen(v) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Warranty claim: {order.refCode}</DialogTitle>
            <DialogDescription>Claim against the supplier&apos;s warranty window on a specific item.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Item *</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger aria-label="Warranty item"><SelectValue placeholder="Choose item" /></SelectTrigger>
                <SelectContent>
                  {warrantied.map((it) => (
                    <SelectItem key={it.id} value={it.productId}>{it.name}: {it.warrantyMonths}-month warranty</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="warranty-issue">Describe the fault * (min 10 characters)</Label>
              <Textarea id="warranty-issue" value={issue} onChange={(e) => setIssue(e.target.value)} maxLength={1000} className="min-h-24" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy === 'warranty'}>Cancel</Button>
            <Button disabled={!valid || busy === 'warranty'} onClick={async () => {
              setBusy('warranty')
              try {
                await apiSend(`/api/supply/orders/${order.id}/action`, 'POST', { action: 'warranty', productId, issue: issue.trim() })
                toast.success('Warranty claim filed with the supplier.')
                setOpen(false)
                reload()
              } catch (e) {
                toast.error(e instanceof ClientApiError ? e.message : 'Could not file the claim.')
              } finally {
                setBusy('')
              }
            }}>
              {busy === 'warranty' ? <BtnSpinner className="mr-1.5" /> : null} File claim
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─────────────────────────── Claims record (read-only) ───────────────────────────

export function ClaimsPanel({ order }: { order: OrderDetailData }) {
  if (order.disputes.length === 0 && order.refunds.length === 0) return null
  return (
    <section className="space-y-2 rounded-xl border border-border bg-card/50 p-4">
      <h3 className="text-sm font-semibold">Disputes & refunds</h3>
      {order.disputes.map((d) => (
        <div key={d.id} className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{d.refCode}</span>
            <Badge variant="outline" className="border-rose-500/40 text-rose-600 dark:text-rose-400">{d.status}</Badge>
            <span className="text-xs text-muted-foreground">{DISPUTE_REASONS.find((r) => r.value === d.reason)?.label ?? d.reason}</span>
            {d.amountFrozenMinor != null && <span className="text-xs text-muted-foreground">· frozen {money(d.amountFrozenMinor, order.currency)}</span>}
            <span className="text-xs text-muted-foreground">· <When at={d.createdAt} /></span>
          </div>
          <p className="mt-1 text-muted-foreground">{d.details}</p>
          {d.resolution && <p className="mt-1 text-xs">Resolution: <span className="font-semibold">{d.resolution}</span>{d.resolutionNote ? `: ${d.resolutionNote}` : ''}</p>}
        </div>
      ))}
      {order.refunds.map((r) => (
        <div key={r.id} className="rounded-lg border border-border bg-background/40 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{r.refCode}</span>
            <Badge variant="outline" className="border-border text-muted-foreground">{r.status}</Badge>
            <span className="tabular-nums font-semibold">{money(r.amountMinor, order.currency)}</span>
            <span className="text-xs text-muted-foreground">{r.kind.toLowerCase()} · {r.reason} · <When at={r.createdAt} /></span>
          </div>
        </div>
      ))}
    </section>
  )
}

// ─────────────────────────── Timeline ───────────────────────────

type TimelineEntry = {
  id: string
  when: string
  type: string
  actorName: string
  actorSide: string
  note: string | null
  source: 'ORDER' | 'DELIVERY'
}

export function Timeline({ order }: { order: OrderDetailData }) {
  const entries = useMemo<TimelineEntry[]>(() => {
    const list: TimelineEntry[] = [
      ...order.events.map((e) => ({ id: e.id, when: e.createdAt, type: e.type, actorName: e.actorName, actorSide: e.actorSide, note: e.note, source: 'ORDER' as const })),
      ...(order.delivery?.events ?? []).map((e) => ({ id: `dlv-${e.id}`, when: e.createdAt, type: e.type, actorName: e.actorName, actorSide: e.actorSide, note: e.note, source: 'DELIVERY' as const })),
    ]
    return list.sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime())
  }, [order])

  return (
    <section className="space-y-2 rounded-xl border border-border bg-card/50 p-4">
      <h3 className="text-sm font-semibold">Timeline ({entries.length})</h3>
      <ol className="space-y-3">
        {entries.map((e) => (
          <li key={e.id} className="flex gap-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <SideChip side={e.actorSide} />
                <span className="text-xs font-semibold">{e.type.replaceAll('_', ' ')}</span>
                <span className="text-xs text-muted-foreground">· {e.actorName} · {e.source === 'DELIVERY' ? 'delivery log' : 'order log'} · <When at={e.when} /></span>
              </div>
              {e.note && <p className="mt-0.5 text-sm text-muted-foreground">{e.note}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
