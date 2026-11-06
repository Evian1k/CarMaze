'use client'

/* SupplierOS: Quotes tab: Request-a-Part quote requests routed to this
 * supplier. Submit or update an offer (amount, lead days, note, optional
 * itemised lines). Offering requires a VERIFIED supplier account: the API
 * enforces it; the UI shows the same requirement honestly. */

import { useState } from 'react'
import { toast } from 'sonner'
import {
  BadgeCheck, Car, CalendarClock, FileText, ImageOff, Loader2, MapPin, MessageSquareQuote, Send, Wallet,
} from 'lucide-react'
import { apiSend } from '@/lib/client'
import { money, timeAgo, dateLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  type QuoteRequestItem, type FetchState,
  useFetch, supplierRoleCan, StatusBadge, LoadingBlock, ModuleNotice, EmptyState,
  OFFER_STATUS_LABELS, kesToMinor, errMessage,
} from './shared'

type Props = {
  orgId: string
  role: string
  verified: boolean | null
}

type OfferLine = { name: string; partNumber: string; qty: string; unitPrice: string }

type QuoteListPayload = { side: string; requests: QuoteRequestItem[] }

export function QuotesTab({ orgId, role, verified }: Props) {
  const quotes = useFetch<QuoteListPayload>(`/api/supply/quotes?orgId=${orgId}`)
  const [offerFor, setOfferFor] = useState<QuoteRequestItem | null>(null)

  const canQuote = supplierRoleCan(role, 'order.respond') // SALES/OWNER/OPERATIONS quote; API allows any verified member via its own check
  const requests = quotes.data?.requests ?? []
  const unquoted = requests.filter((r) => !r.myOffer).length

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Quote requests</h2>
        <p className="text-sm text-muted-foreground">
          {unquoted > 0
            ? `${unquoted} request${unquoted === 1 ? '' : 's'} without your offer: respond while garages are still comparing.`
            : 'Request-a-Part enquiries routed to your business.'}
        </p>
      </div>

      {verified === false && (
        <Alert>
          <BadgeCheck className="h-4 w-4" />
          <AlertTitle>Offers require a verified supplier account</AlertTitle>
          <AlertDescription>
            Only verified suppliers can send quotations. Your application is still under platform review; offers unlock
            automatically once verification completes.
          </AlertDescription>
        </Alert>
      )}

      {quotes.loading ? (
        <LoadingBlock label="Loading quote requests…" />
      ) : quotes.error ? (
        <ModuleNotice title="Quote requests could not load" detail={quotes.error.message} retry={quotes.reload} />
      ) : requests.length === 0 ? (
        <EmptyState
          icon={<MessageSquareQuote className="h-8 w-8" />}
          title="No quote requests right now"
          detail="Garages raise Request-a-Part enquiries with photos or part numbers. Requests routed to your delivery counties appear here; add delivery areas on your warehouses to widen coverage."
        />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <QuoteCard
              key={r.id}
              request={r}
              canOffer={verified !== false}
              onOffer={() => setOfferFor(r)}
            />
          ))}
        </div>
      )}

      {offerFor && (
        <OfferDialog
          request={offerFor}
          canOffer={verified !== false && canQuote}
          onClose={() => setOfferFor(null)}
          onSaved={() => {
            setOfferFor(null)
            quotes.reload()
          }}
        />
      )}
    </div>
  )
}

// ───────────────────────────── Quote card ─────────────────────────────

function QuoteCard({ request: r, canOffer, onOffer }: { request: QuoteRequestItem; canOffer: boolean; onOffer: () => void }) {
  const vehicle = r.vehicle
  const vehicleText = vehicle && typeof vehicle === 'object'
    ? [vehicle.make, vehicle.model, vehicle.year, vehicle.engine, vehicle.trim].filter(Boolean).join(' · ')
    : ''
  return (
    <Card className="py-4">
      <CardContent className="flex flex-wrap gap-4 px-4">
        {r.photoUrl ? (
          <img src={r.photoUrl} alt={r.title} className="h-24 w-32 shrink-0 rounded-lg border border-border object-cover" />
        ) : (
          <span className="flex h-24 w-32 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 text-muted-foreground">
            <ImageOff className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{r.refCode}</span>
            <Badge variant="secondary" className={cn('border-transparent text-[10px]', r.status === 'OPEN' ? 'bg-accent/40 text-accent-foreground' : 'bg-secondary text-secondary-foreground')}>
              {r.status === 'OPEN' ? 'Open' : r.status === 'QUOTING' ? 'Quoting' : r.status}
            </Badge>
            {r.garage?.verified && (
              <Badge variant="secondary" className="gap-1 border-transparent bg-primary/10 px-1 py-0 text-[10px] text-primary">
                <BadgeCheck className="h-3 w-3" /> Verified garage
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-sm font-semibold">{r.title}</p>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{r.description}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {r.partNumber && <span className="font-mono">P/N {r.partNumber}</span>}
            {vehicleText && <span className="flex items-center gap-1"><Car className="h-3 w-3" /> {vehicleText}</span>}
            {r.deliveryCounty && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> Deliver to {r.deliveryCounty}</span>}
            {r.budgetMinor != null && r.budgetMinor > 0 && <span className="flex items-center gap-1"><Wallet className="h-3 w-3" /> Budget ~{money(r.budgetMinor)}</span>}
            <span className="flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {timeAgo(r.createdAt)}</span>
            {r.expiresAt && <span>closes {dateLabel(r.expiresAt)}</span>}
            <span>{r.offerCount} offer{r.offerCount === 1 ? '' : 's'} so far</span>
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-col items-end justify-between gap-2 sm:w-44">
          {r.myOffer ? (
            <div className="w-full rounded-lg border border-border px-3 py-2 text-right">
              <p className="text-sm font-semibold">{money(r.myOffer.amountMinor)}</p>
              <p className="text-[11px] text-muted-foreground">
                {r.myOffer.leadDays ? `${r.myOffer.leadDays} day lead · ` : ''}your offer
              </p>
              <StatusBadge status={r.myOffer.status} labels={OFFER_STATUS_LABELS} classes={{
                PENDING: 'bg-accent/30 text-accent-foreground',
                ACCEPTED: 'bg-primary text-primary-foreground',
                DECLINED: 'bg-destructive/15 text-destructive',
              }} />
            </div>
          ) : (
            <p className="w-full text-right text-xs text-muted-foreground">No offer yet</p>
          )}
          <Button size="sm" variant={r.myOffer ? 'outline' : 'default'} className="min-h-10 w-full" disabled={!canOffer} onClick={onOffer}>
            {r.myOffer ? 'Update offer' : 'Send offer'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ───────────────────────────── Offer dialog ─────────────────────────────

function OfferDialog({ request, canOffer, onClose, onSaved }: {
  request: QuoteRequestItem
  canOffer: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const existing = request.myOffer
  const [amount, setAmount] = useState(existing ? String(existing.amountMinor / 100) : '')
  const [leadDays, setLeadDays] = useState(existing?.leadDays ? String(existing.leadDays) : '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [lines, setLines] = useState<OfferLine[]>([])
  const [saving, setSaving] = useState(false)

  function setLine(idx: number, patch: Partial<OfferLine>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  function validate(): string | null {
    const amountMinor = kesToMinor(amount)
    if (amountMinor === null || amountMinor < 100) return 'Enter an offer amount of at least KES 1.'
    if (leadDays.trim()) {
      const d = Number(leadDays)
      if (!Number.isInteger(d) || d < 1 || d > 90) return 'Lead time must be 1–90 days.'
    }
    for (const l of lines) {
      if (!l.name.trim()) return 'Every itemised line needs a name.'
      const q = Number(l.qty)
      const unit = kesToMinor(l.unitPrice)
      if (!Number.isInteger(q) || q < 1) return 'Line quantities must be whole numbers of at least 1.'
      if (unit === null || unit < 0) return 'Line unit prices are invalid.'
    }
    return null
  }

  async function submit() {
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return
    }
    setSaving(true)
    try {
      await apiSend(`/api/supply/quotes/${request.id}`, 'POST', {
        action: 'offer',
        amountMinor: kesToMinor(amount)!,
        leadDays: leadDays.trim() ? Number(leadDays) : undefined,
        note: note.trim() || undefined,
        items: lines.length
          ? lines.map((l) => ({ name: l.name.trim(), partNumber: l.partNumber.trim() || undefined, qty: Number(l.qty), unitPriceMinor: kesToMinor(l.unitPrice)! }))
          : undefined,
      })
      toast.success(existing ? 'Offer updated: the garage sees your latest quotation.' : 'Offer sent to the garage.')
      onSaved()
    } catch (e) {
      toast.error(await errMessage(e, 'Could not submit the offer.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scrollbar-thin sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{existing ? 'Update your offer' : 'Send an offer'}: {request.refCode}</DialogTitle>
          <DialogDescription>
            {request.title} · for {request.garage?.name ?? 'the garage'}
            {request.budgetMinor != null && request.budgetMinor > 0 ? ` · budget ~${money(request.budgetMinor)}` : ''}.
            {' '}Offering is an upsert: sending again replaces your previous quotation and resets its status to pending.
          </DialogDescription>
        </DialogHeader>

        {canOffer ? (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="of-amount">Offer amount (KES) *</Label>
                <Input id="of-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 12500" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="of-lead">Lead time (days)</Label>
                <Input id="of-lead" inputMode="numeric" value={leadDays} onChange={(e) => setLeadDays(e.target.value.replace(/[^\d]/g, ''))} placeholder="e.g. 3" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="of-note">Note to the garage</Label>
              <Textarea id="of-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
                placeholder="Brand, condition, warranty, collection/delivery options…" />
            </div>

            {lines.length > 0 && (
              <div className="space-y-2">
                {lines.map((l, idx) => (
                  <div key={idx} className="grid gap-2 rounded-lg border border-border p-2.5 sm:grid-cols-[1fr_auto]">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input className="h-9" value={l.name} onChange={(e) => setLine(idx, { name: e.target.value })} placeholder="Item name" aria-label="Item name" />
                      <Input className="h-9" value={l.partNumber} onChange={(e) => setLine(idx, { partNumber: e.target.value })} placeholder="Part number (optional)" aria-label="Part number" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Input className="h-9 w-16" inputMode="numeric" value={l.qty} onChange={(e) => setLine(idx, { qty: e.target.value.replace(/[^\d]/g, '') })} placeholder="Qty" aria-label="Quantity" />
                      <Input className="h-9 w-24" inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(idx, { unitPrice: e.target.value })} placeholder="Unit KES" aria-label="Unit price" />
                      <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive hover:text-destructive" aria-label="Remove line"
                        onClick={() => setLines((xs) => xs.filter((_, i) => i !== idx))}>
                        ✕
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button variant="outline" size="sm" className="self-start" onClick={() => setLines((xs) => [...xs, { name: '', partNumber: '', qty: '1', unitPrice: '' }])}>
              <FileText className="h-3.5 w-3.5" /> Add itemised line (optional)
            </Button>
          </div>
        ) : (
          <Alert>
            <BadgeCheck className="h-4 w-4" />
            <AlertTitle>Offering locked</AlertTitle>
            <AlertDescription>Only verified suppliers can send quotations. This unlocks after platform verification.</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          {canOffer && (
            <Button onClick={submit} disabled={saving} className="min-h-11">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {existing ? 'Update offer' : 'Send offer'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
