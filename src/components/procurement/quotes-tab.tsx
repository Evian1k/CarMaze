'use client'

/* Quote requests ("Request a Part") — garage side of GET /api/supply/quotes.
 * Raise a request with optional photo / part number / vehicle details,
 * then accept or decline supplier offers. Accepting closes the request and
 * marks other offers declined (server-enforced). */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  FileQuestion, Plus, Star, Trash2, Upload, X, PackageOpen, Handshake, MessageSquareText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { apiGet, apiSend, ClientApiError } from '@/lib/client'
import { money, timeAgo, KENYA_COUNTIES, VEHICLE_MAKES } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Img, BtnSpinner, EmptyState, kesToMinor, uploadOne, REQUEST_STATUS_TONES,
  canOrder, type QuoteRequestRow, type QuoteOfferRow,
} from './shared'

export function QuotesTab({ orgId, role, openNew, onNewClosed }: {
  orgId: string
  role: string
  /** true when the URL deep-links a fresh "Request a part" dialog. */
  openNew: boolean
  onNewClosed: () => void
}) {
  const [requests, setRequests] = useState<QuoteRequestRow[] | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busyId, setBusyId] = useState('')

  const mayDecide = canOrder(role)

  const load = useCallback(() => {
    let stale = false
    apiGet<{ side: string; requests: QuoteRequestRow[] }>(`/api/supply/quotes?orgId=${encodeURIComponent(orgId)}`)
      .then((d) => { if (!stale) setRequests(d.requests) })
      .catch((e: unknown) => {
        if (stale) return
        setRequests([])
        toast.error(e instanceof ClientApiError ? e.message : 'Could not load quote requests.')
      })
    return () => { stale = true }
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    return load()
  }, [orgId, load])

  // deep link: open the "Request a part" dialog straight away
  useEffect(() => {
    if (openNew) setDialogOpen(true)
  }, [openNew])

  async function decide(reqId: string, offerId: string, decision: 'ACCEPTED' | 'DECLINED') {
    setBusyId(offerId)
    try {
      const res = await apiSend<{ message: string }>(`/api/supply/quotes/${reqId}`, 'POST', {
        action: 'decide', offerId, decision,
      })
      toast.success(res.message || (decision === 'ACCEPTED' ? 'Offer accepted.' : 'Offer declined.'))
      load()
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Could not record the decision.')
    } finally {
      setBusyId('')
    }
  }

  async function closeRequest(reqId: string) {
    setBusyId(reqId)
    try {
      const res = await apiSend<{ message: string }>(`/api/supply/quotes/${reqId}`, 'POST', { action: 'close' })
      toast.success(res.message || 'Request closed.')
      load()
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Could not close the request.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Quote requests</h2>
          <p className="text-xs text-muted-foreground">Can&apos;t find a part? Describe it (or upload a photo) and verified suppliers in your delivery area quote back.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Request a part
        </Button>
      </div>

      {requests === null ? (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={FileQuestion}
          title="No quote requests yet"
          description="Raise a Request a Part with the vehicle details, a part number or a photo — suppliers quote with price and lead time."
        >
          <Button onClick={() => setDialogOpen(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Request a part</Button>
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <Card key={r.id} className="border-border bg-card p-0">
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{r.title}</h3>
                      <Badge variant="outline" className={REQUEST_STATUS_TONES[r.status]}>{r.status}</Badge>
                      <span className="font-mono text-xs text-muted-foreground">{r.refCode}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Raised {timeAgo(r.createdAt)}</p>
                  </div>
                  {r.status !== 'CLOSED' && mayDecide && (
                    <Button variant="outline" size="sm" disabled={busyId === r.id} onClick={() => closeRequest(r.id)}>
                      {busyId === r.id ? <BtnSpinner className="mr-1.5" /> : <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                      Close request
                    </Button>
                  )}
                </div>

                <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{r.description}</p>

                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {r.partNumber && <span>Part no: <span className="font-mono text-foreground">{r.partNumber}</span></span>}
                  {r.vehicle && (
                    <span>
                      Vehicle: <span className="text-foreground">
                        {[r.vehicle.make, r.vehicle.model, r.vehicle.year, r.vehicle.engine].filter(Boolean).join(' ')}
                      </span>
                    </span>
                  )}
                  {r.budgetMinor != null && <span>Budget: <span className="text-foreground tabular-nums">{money(r.budgetMinor)}</span></span>}
                  {r.deliveryCounty && <span>Deliver to: <span className="text-foreground">{r.deliveryCounty}</span></span>}
                </div>

                {r.photoUrl && (
                  <Img src={r.photoUrl} alt={`Photo for ${r.title}`} className="mt-3 h-32 w-full max-w-xs rounded-lg border border-border" />
                )}

                <Separator className="my-4" />

                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Handshake className="h-3.5 w-3.5" aria-hidden="true" />
                  Offers ({r.offers.length})
                </h4>
                {r.offers.length === 0 ? (
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <PackageOpen className="h-4 w-4" aria-hidden="true" />
                    No offers yet — verified suppliers were notified{r.deliveryCounty ? ` in ${r.deliveryCounty}` : ''}. Responses depend on their stock.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {r.offers.map((o) => <OfferRow key={o.id} offer={o} busy={busyId === o.id} mayDecide={mayDecide && r.status !== 'CLOSED'} onDecide={(d) => decide(r.id, o.id, d)} />)}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewRequestDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v)
          if (!v) onNewClosed()
        }}
        orgId={orgId}
        onCreated={() => { load(); setDialogOpen(false); onNewClosed() }}
      />
    </div>
  )
}

function OfferRow({ offer: o, busy, mayDecide, onDecide }: {
  offer: QuoteOfferRow
  busy: boolean
  mayDecide: boolean
  onDecide: (d: 'ACCEPTED' | 'DECLINED') => void
}) {
  return (
    <li className={cn('rounded-lg border p-3', o.status === 'ACCEPTED' ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-background/40')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{o.supplier.name}</span>
          {o.supplier.verified && <Badge variant="outline" className="border-primary/40 text-primary">Verified</Badge>}
          {o.supplier.supplierRating != null && (
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground"><Star className="h-3 w-3" aria-hidden="true" />{o.supplier.supplierRating.toFixed(1)}</span>
          )}
          <span className="text-xs text-muted-foreground">· {o.supplier.county}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={REQUEST_STATUS_TONES[o.status]}>{o.status}</Badge>
          <span className="text-sm font-bold tabular-nums">{money(o.amountMinor)}</span>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {o.leadDays != null && <span>Lead time: {o.leadDays} day{o.leadDays === 1 ? '' : 's'}</span>}
        <span>Quoted {timeAgo(o.createdAt)}</span>
      </div>
      {o.note && (
        <p className="mt-1.5 flex items-start gap-1.5 text-sm">
          <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">{o.note}</span>
        </p>
      )}
      {o.items.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
          {o.items.map((it, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span>{it.qty ?? 1} × {it.name ?? 'item'}{it.partNumber ? ` (${it.partNumber})` : ''}</span>
              {it.unitPriceMinor != null && <span className="tabular-nums">{money(it.unitPriceMinor)}</span>}
            </li>
          ))}
        </ul>
      )}
      {o.status === 'PENDING' && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={busy || !mayDecide} onClick={() => onDecide('ACCEPTED')}>
            {busy ? <BtnSpinner className="mr-1.5" /> : null} Accept
          </Button>
          <Button size="sm" variant="outline" disabled={busy || !mayDecide} onClick={() => onDecide('DECLINED')}>Decline</Button>
          {!mayDecide && <span className="self-center text-xs text-muted-foreground">Owner/GM/procurement decide on offers.</span>}
        </div>
      )}
    </li>
  )
}

// ─────────────────────────── New request dialog ───────────────────────────

function NewRequestDialog({ open, onOpenChange, orgId, onCreated }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  orgId: string
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [partNumber, setPartNumber] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [engine, setEngine] = useState('')
  const [budget, setBudget] = useState('')
  const [county, setCounty] = useState('')
  const [expiresIn, setExpiresIn] = useState('7')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(''); setDescription(''); setPartNumber(''); setPhotoUrl('')
      setMake(''); setModel(''); setYear(''); setEngine(''); setBudget(''); setCounty(''); setExpiresIn('7')
    }
  }, [open])

  const valid = title.trim().length >= 4 && description.trim().length >= 10

  async function handleUpload(file: File | undefined) {
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadOne(file)
      setPhotoUrl(url)
      toast.success('Photo attached.')
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Upload failed. JPG, PNG, WebP or PDF up to 8 MB.')
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    const budgetMinor = budget.trim() ? kesToMinor(budget) : undefined
    if (budget.trim() && budgetMinor == null) {
      toast.error('Enter the budget as a plain KES amount, e.g. 12500 or 12500.50.')
      return
    }
    setSubmitting(true)
    try {
      const vehicle =
        make || model || year || engine
          ? {
            ...(make ? { make } : {}),
            ...(model ? { model } : {}),
            ...(year ? { year: Number(year) } : {}),
            ...(engine ? { engine } : {}),
          }
          : undefined
      const res = await apiSend<{ message: string; notifiedSuppliers: number }>('/api/supply/quotes', 'POST', {
        orgId,
        title: title.trim(),
        description: description.trim(),
        partNumber: partNumber.trim() || undefined,
        photoUrl: photoUrl || undefined,
        vehicle,
        budgetMinor: budgetMinor ?? undefined,
        deliveryCounty: county || undefined,
        expiresInDays: Number(expiresIn),
      })
      toast.success(res.message || 'Request sent to suppliers.', { description: `${res.notifiedSuppliers} supplier(s) notified.` })
      onCreated()
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Could not send the request.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v) }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Request a part</DialogTitle>
          <DialogDescription>
            Verified suppliers in the delivery area are notified. Quote offers appear under the request.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="qr-title">Title *</Label>
            <Input id="qr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Front brake pads — Hilux 2015" maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qr-desc">Description * (what the part is, where it came from, condition expectations)</Label>
            <Textarea id="qr-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-24" maxLength={2000}
              placeholder="Describe the part and any markings. Minimum 10 characters." />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="qr-part">Part number / OEM ref</Label>
              <Input id="qr-part" value={partNumber} onChange={(e) => setPartNumber(e.target.value)} placeholder="Optional" maxLength={60} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qr-budget">Budget (KES)</Label>
              <Input id="qr-budget" value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="Optional, e.g. 12500" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Photo of the part or nameplate (JPG/PNG/WebP/PDF, ≤ 8 MB)</Label>
            {photoUrl ? (
              <div className="flex items-center gap-3">
                <Img src={photoUrl} alt="Attached part" className="h-16 w-16 rounded-md border border-border" />
                <Button variant="outline" size="sm" onClick={() => setPhotoUrl('')}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Remove
                </Button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background/40 px-4 py-6 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                {uploading ? <BtnSpinner /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                {uploading ? 'Uploading…' : 'Click to attach a photo'}
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={uploading}
                  onChange={(e) => { handleUpload(e.target.files?.[0]); e.currentTarget.value = '' }} aria-label="Attach photo" />
              </label>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Make</Label>
              <Select value={make} onValueChange={(v) => setMake(v === 'unspecified' ? '' : v)}>
                <SelectTrigger aria-label="Vehicle make"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unspecified">Not specified</SelectItem>
                  {VEHICLE_MAKES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qr-model">Model</Label>
              <Input id="qr-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="—" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qr-year">Year</Label>
              <Input id="qr-year" value={year} inputMode="numeric" onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="—" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qr-engine">Engine</Label>
              <Input id="qr-engine" value={engine} onChange={(e) => setEngine(e.target.value)} placeholder="e.g. 2KD-FTV" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Deliver to county</Label>
              <Select value={county} onValueChange={(v) => setCounty(v === 'any' ? '' : v)}>
                <SelectTrigger aria-label="Delivery county"><SelectValue placeholder="Any county" /></SelectTrigger>
                <SelectContent className="max-h-64 scrollbar-thin">
                  <SelectItem value="any">Any county</SelectItem>
                  {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Offers stay open for</Label>
              <Select value={expiresIn} onValueChange={setExpiresIn}>
                <SelectTrigger aria-label="Expiry"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[3, 7, 14, 30].map((d) => <SelectItem key={d} value={String(d)}>{d} day{d === 1 ? '' : 's'}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={submitting || !valid || uploading} onClick={submit}>
            {submitting ? <BtnSpinner className="mr-1.5" /> : null}
            {submitting ? 'Sending…' : 'Send to suppliers'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
