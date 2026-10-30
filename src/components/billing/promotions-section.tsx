'use client'

/* Promotions panel — shared by the DealerOS billing tab and the GarageOS
 * profile/billing area. Lists the caller's org campaigns with real recorded
 * activity, lets OWNER/MANAGER buy a promotion for a PUBLISHED listing and pay
 * via the same M-Pesa STK push flow as subscriptions (POST /api/billing/
 * mpesa/stkpush), and cancel unpaid promotions. Honest states only: no fake
 * metrics, no simulated payments. */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Megaphone, Wallet, Eye, MousePointerClick, Loader2, CalendarDays,
  CircleAlert, RefreshCw, Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Reveal } from '@/components/motion/reveal'
import { apiGet, apiSend } from '@/lib/client'
import { money, dateLabel } from '@/lib/format'
import { cn } from '@/lib/utils'

// ───────────────────────────── Types ─────────────────────────────

type CampaignRow = {
  id: string
  refCode: string
  status: string
  packageCode: string
  startsAt: string | null
  endsAt: string | null
  impressions: number
  clicks: number
  createdAt: string
  vehicle: { id: string; refCode: string; title: string; status: string }
  package: { code: string; name: string; days: number } | null
  invoice: {
    id: string
    refCode: string
    status: string
    amountMinor: number
    currency: string
    dueDate: string | null
  } | null
}

type PackageRow = {
  code: string
  name: string
  days: number
  priceMinor: number
  currency: string
  description: string | null
}

type VehicleRow = {
  id: string
  refCode: string
  make: string
  model: string
  year: number
  status: string
}

type PromotionsData = { campaigns: CampaignRow[]; packages: PackageRow[] }
type FetchError = { status: number; message: string }

type PayTarget = {
  invoiceId: string
  invoiceRef: string
  amountMinor: number
  currency: string
  description: string
}

const CAMPAIGN_STATUS: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-primary text-primary-foreground' },
  PENDING_PAYMENT: { label: 'Awaiting payment', className: 'bg-gold text-gold-foreground' },
  ENDED: { label: 'Ended', className: 'bg-muted text-muted-foreground' },
  CANCELLED: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
}

/** Whole days left on a running promotion, computed from endsAt. */
function daysRemaining(endsAt: string | null): number | null {
  if (!endsAt) return null
  const ms = new Date(endsAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

// ─────────────────── Data hooks (lint-safe: state only in async callbacks) ───────────────────

function usePromotions() {
  const [completed, setCompleted] = useState<{ data: PromotionsData | null; error: FetchError | null } | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    apiGet<PromotionsData>('/api/campaigns?mine=1')
      .then((d) => { if (!cancelled) setCompleted({ data: d, error: null }) })
      .catch((e: { status?: number; message?: string }) => {
        if (!cancelled) setCompleted({ data: null, error: { status: e?.status ?? 0, message: e?.message ?? 'Request failed' } })
      })
    return () => { cancelled = true }
  }, [tick])

  return { data: completed?.data ?? null, error: completed?.error ?? null, loading: !completed, reload }
}

function usePublishedVehicles() {
  const [completed, setCompleted] = useState<{ data: VehicleRow[] | null; error: FetchError | null } | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    // Same feed the seller dashboard uses (own + org listings, any status) —
    // filtered to PUBLISHED here because only published listings can be promoted.
    apiGet<{ vehicles: VehicleRow[] }>('/api/vehicles?mine=1')
      .then((d) => { if (!cancelled) setCompleted({ data: d.vehicles.filter((v) => v.status === 'PUBLISHED'), error: null }) })
      .catch((e: { status?: number; message?: string }) => {
        if (!cancelled) setCompleted({ data: null, error: { status: e?.status ?? 0, message: e?.message ?? 'Request failed' } })
      })
    return () => { cancelled = true }
  }, [tick])

  return { data: completed?.data ?? null, error: completed?.error ?? null, loading: !completed, reload }
}

// ───────────────────────────── Component ─────────────────────────────

export function PromotionsSection() {
  const promos = usePromotions()
  const vehicles = usePublishedVehicles()

  // Purchase form state
  const [vehicleId, setVehicleId] = useState<string>('')
  const [packageCode, setPackageCode] = useState<string>('')
  const [purchasing, setPurchasing] = useState(false)

  // M-Pesa STK push dialog state (same flow as the billing tab)
  const [payTarget, setPayTarget] = useState<PayTarget | null>(null)
  const [phone, setPhone] = useState('')
  const [payBusy, setPayBusy] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  // Cancel confirmation state
  const [cancelTarget, setCancelTarget] = useState<CampaignRow | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)

  const campaigns = promos.data?.campaigns ?? []
  const packages = promos.data?.packages ?? []
  const published = vehicles.data ?? []

  async function purchase() {
    if (!vehicleId || !packageCode) return
    setPurchasing(true)
    try {
      const res = await apiSend<{ campaign: { id: string; refCode: string }; invoice: { id: string; refCode: string; description: string; amountMinor: number; currency: string } }>(
        '/api/campaigns',
        'POST',
        { vehicleId, packageCode }
      )
      toast.success(`Promotion ${res.campaign.refCode} created — an invoice was issued and is awaiting payment.`)
      promos.reload()
      setVehicleId('')
      setPackageCode('')
      // Prompt payment immediately with the freshly issued invoice.
      setPayError(null)
      setPhone('')
      setPayTarget({
        invoiceId: res.invoice.id,
        invoiceRef: res.invoice.refCode,
        amountMinor: res.invoice.amountMinor,
        currency: res.invoice.currency,
        description: res.invoice.description,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the promotion.')
    } finally {
      setPurchasing(false)
    }
  }

  async function payMpesa() {
    if (!payTarget) return
    const cleaned = phone.replace(/\s+/g, '')
    if (!/^(?:\+?254|0)(?:7|1)\d{8}$/.test(cleaned)) {
      setPayError('Enter a valid Safaricom number, e.g. 0712 345 678 or +254712345678.')
      return
    }
    setPayBusy(true)
    setPayError(null)
    try {
      const res = await apiSend<{ message?: string }>('/api/billing/mpesa/stkpush', 'POST', { invoiceId: payTarget.invoiceId, phone: cleaned })
      toast.success(res.message ?? `STK push sent to ${cleaned} — enter your M-Pesa PIN to complete payment for ${payTarget.invoiceRef}.`)
      setPayTarget(null)
      setPhone('')
      promos.reload()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not start the M-Pesa payment.'
      setPayError(message)
      toast.error(message)
    } finally {
      setPayBusy(false)
    }
  }

  async function cancelPromotion() {
    if (!cancelTarget) return
    setCancelBusy(true)
    try {
      await apiSend<{ cancelledInvoice: string | null }>(`/api/campaigns/${cancelTarget.id}/cancel`, 'POST')
      toast.success(`Promotion ${cancelTarget.refCode} cancelled — its unpaid invoice was cancelled too.`)
      setCancelTarget(null)
      promos.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not cancel the promotion.')
    } finally {
      setCancelBusy(false)
    }
  }

  // ── States ──
  const noOrg = promos.error?.status === 403
  const vehiclesLoading = vehicles.loading

  return (
    <section aria-label="Promotions" className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Promotions</h2>
        <Badge variant="outline" className="border-gold/60 text-[11px] text-gold-foreground"><Megaphone className="h-3 w-3" /> Boost a listing</Badge>
      </div>

      {promos.loading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-44 w-full rounded-xl" />
        </div>
      ) : noOrg ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Megaphone className="h-6 w-6" /></div>
            <p className="text-sm font-semibold">Promotions are for dealerships and garages</p>
            <p className="max-w-md text-xs text-muted-foreground">
              You don&apos;t belong to a verified organisation yet. Once your dealership or garage application is approved you can promote
              published listings from here.
            </p>
          </CardContent>
        </Card>
      ) : promos.error ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <CircleAlert className="h-5 w-5 text-destructive" />
            <p className="text-sm">Could not load promotions</p>
            <p className="text-xs text-muted-foreground">{promos.error.message}</p>
            <Button variant="outline" size="sm" className="mt-2 h-11" onClick={promos.reload}><RefreshCw className="h-4 w-4" /> Try again</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* ── Purchase form ── */}
          <Reveal>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><Megaphone className="h-4 w-4 text-primary" /> Buy a promotion</CardTitle>
                <CardDescription>Pick one of your published listings and a package — an invoice is issued and payment is requested via M-Pesa. The promotion starts the moment payment is confirmed.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {vehiclesLoading ? (
                  <Skeleton className="h-11 w-full" />
                ) : published.length === 0 ? (
                  <Alert>
                    <CircleAlert className="h-4 w-4" />
                    <AlertDescription>
                      You have no published listings to promote. Promotions boost vehicle listings, so a listing must be reviewed and published
                      first — submit one from the Sell flow or your inventory, then come back.
                    </AlertDescription>
                  </Alert>
                ) : packages.length === 0 ? (
                  <Alert>
                    <CircleAlert className="h-4 w-4" />
                    <AlertDescription>No promotion packages are being offered right now — please check back soon.</AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <div className="grid gap-1.5">
                      <Label htmlFor="promo-vehicle">Listing to promote</Label>
                      <Select value={vehicleId} onValueChange={setVehicleId}>
                        <SelectTrigger id="promo-vehicle" className="h-11 w-full" aria-label="Choose a published listing">
                          <SelectValue placeholder="Choose a published listing" />
                        </SelectTrigger>
                        <SelectContent>
                          {published.map((v) => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.make} {v.model} {v.year} — {v.refCode}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-1.5">
                      <Label>Package</Label>
                      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Promotion package">
                        {packages.map((p) => {
                          const selected = packageCode === p.code
                          return (
                            <button
                              key={p.code}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => setPackageCode(p.code)}
                              className={cn(
                                'flex min-h-[44px] flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                                selected ? 'border-primary ring-1 ring-primary/40' : 'hover:bg-muted/60'
                              )}
                            >
                              <span className="flex w-full items-center justify-between gap-2">
                                <span className="text-sm font-semibold">{p.name}</span>
                                {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                              </span>
                              <span className="text-sm font-semibold text-primary">
                                {money(p.priceMinor, p.currency)}
                                <span className="text-xs font-normal text-muted-foreground"> · {p.days} day{p.days === 1 ? '' : 's'}</span>
                              </span>
                              {p.description && <span className="text-xs text-muted-foreground">{p.description}</span>}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <Button className="h-11 w-full sm:w-auto" disabled={!vehicleId || !packageCode || purchasing} onClick={purchase}>
                      {purchasing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                      Purchase promotion
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </Reveal>

          {/* ── My promotions ── */}
          <Reveal delay={0.05}>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Your promotions</CardTitle>
                <CardDescription>
                  Impressions and clicks are recorded activity on CARMAZE — impressions count featured/homepage appearances, clicks count
                  detail-page views of the promoted listing. Nothing else is estimated.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {campaigns.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    No promotions yet — buy one above to put a listing in the spotlight.
                  </p>
                ) : (
                  <ul className="max-h-96 space-y-3 overflow-y-auto pr-1 scrollbar-thin">
                    {campaigns.map((c) => {
                      const badge = CAMPAIGN_STATUS[c.status] ?? { label: c.status, className: 'bg-muted text-muted-foreground' }
                      const pending = c.status === 'PENDING_PAYMENT'
                      const remaining = c.status === 'ACTIVE' ? daysRemaining(c.endsAt) : null
                      return (
                        <li key={c.id} className="rounded-lg border p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{c.vehicle.title}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {c.package ? c.package.name : c.packageCode}
                                {c.package ? ` · ${c.package.days} day${c.package.days === 1 ? '' : 's'}` : ''}
                                {' · '}<span className="font-mono">{c.refCode}</span>
                              </p>
                            </div>
                            <Badge variant="secondary" className={cn('border-transparent font-medium', badge.className)}>{badge.label}</Badge>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {c.impressions.toLocaleString()} impressions</span>
                            <span className="inline-flex items-center gap-1"><MousePointerClick className="h-3.5 w-3.5" /> {c.clicks.toLocaleString()} clicks</span>
                            {remaining !== null && (
                              <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {remaining} day{remaining === 1 ? '' : 's'} remaining</span>
                            )}
                            {c.status === 'ENDED' && c.endsAt && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> Ended {dateLabel(c.endsAt)}</span>}
                          </div>

                          {pending && c.invoice && (
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2">
                              <div className="min-w-0 text-xs">
                                <p className="font-semibold text-foreground">{money(c.invoice.amountMinor, c.invoice.currency)} due · invoice <span className="font-mono">{c.invoice.refCode}</span></p>
                                <p className="text-muted-foreground">Due {dateLabel(c.invoice.dueDate)} — pay via M-Pesa to activate the promotion.</p>
                              </div>
                              <div className="flex shrink-0 gap-2">
                                <Button
                                  size="sm"
                                  className="h-11"
                                  onClick={() => {
                                    if (!c.invoice) return
                                    setPayError(null)
                                    setPhone('')
                                    setPayTarget({
                                      invoiceId: c.invoice.id,
                                      invoiceRef: c.invoice.refCode,
                                      amountMinor: c.invoice.amountMinor,
                                      currency: c.invoice.currency,
                                      description: `Promotion ${c.refCode} — ${c.vehicle.title}`,
                                    })
                                  }}
                                >
                                  <Wallet className="h-4 w-4" /> Pay
                                </Button>
                                <Button size="sm" variant="outline" className="h-11" onClick={() => setCancelTarget(c)}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}

                          {pending && !c.invoice && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              This promotion has no linked invoice — cancel it and purchase again.
                            </p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </Reveal>
        </div>
      )}

      {/* M-Pesa STK push dialog — same flow as the billing tab's invoice payment */}
      <Dialog open={Boolean(payTarget)} onOpenChange={(o) => { if (!o) setPayTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pay {payTarget ? money(payTarget.amountMinor, payTarget.currency) : ''} via M-Pesa</DialogTitle>
            <DialogDescription>
              {payTarget ? `${payTarget.description} — invoice ${payTarget.invoiceRef}.` : ''} An STK push will be sent to your phone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="promo-mpesa-phone">M-Pesa phone number</Label>
              <Input id="promo-mpesa-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
            </div>
            {payError && (
              <Alert variant="destructive">
                <CircleAlert className="h-4 w-4" />
                <AlertDescription>{payError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setPayTarget(null)}>Cancel</Button>
            <Button className="h-11" onClick={payMpesa} disabled={payBusy}>
              {payBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />} Send STK push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel promotion confirmation */}
      <AlertDialog open={Boolean(cancelTarget)} onOpenChange={(o) => { if (!o) setCancelTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel promotion {cancelTarget?.refCode}?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget
                ? `The unpaid promotion for ${cancelTarget.vehicle.title} will be cancelled and its pending invoice voided. This cannot be undone — you can purchase the promotion again later.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-white hover:bg-destructive/90"
              disabled={cancelBusy}
              onClick={(e) => { e.preventDefault(); cancelPromotion() }}
            >
              {cancelBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Cancel promotion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
