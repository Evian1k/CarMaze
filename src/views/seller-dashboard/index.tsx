'use client'

/* CARMAZE — Seller dashboard (#/my-listings)
 * Listings management (all statuses), offers received with accept/reject,
 * and enquiry threads with replies. Dealer org members see their org's
 * listings, offers and enquiries too (server-scoped by membership).
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Car, Inbox, Tag, Eye, Send, X, CircleCheck, Ban, DollarSign, LockKeyhole,
  ChevronDown, Loader2, RefreshCw, Plus, MessageSquareText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { VehicleCard, type VehicleCardData } from '@/components/marketplace/vehicle-card'
import { useAuth } from '@/stores/auth'
import { apiGet, apiSend, navigate } from '@/lib/client'
import { money, timeAgo, dateLabel, VEHICLE_STATUS_LABELS } from '@/lib/format'
import { toast } from 'sonner'

type MyVehicle = VehicleCardData & {
  views: number
  enquiryCount: number
  offerCount: number
  description: string
  reviewNote: string | null
  matchWithDealers: boolean
  createdAt: string
}

type OfferRow = {
  id: string
  vehicleId: string
  amountMinor: number
  message: string | null
  status: string
  expiresAt: string | null
  createdAt: string
  org: { id: string; name: string }
  vehicle: { id: string; make: string; model: string; year: number; refCode: string }
}

type EnquiryMessage = {
  id: string
  senderName: string
  senderSide: string
  body: string
  createdAt: string
}

type EnquiryRow = {
  id: string
  refCode: string
  message: string
  phoneShare: boolean
  phone: string | null
  status: string
  createdAt: string
  vehicle: { id: string; make: string; model: string; year: number; priceMinor: number; currency: string; refCode: string }
  messages: EnquiryMessage[]
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'PUBLISHED': return 'default'
    case 'SOLD': return 'destructive'
    case 'REJECTED': case 'SUSPENDED': case 'EXPIRED': return 'destructive'
    case 'DRAFT': return 'outline'
    default: return 'secondary'
  }
}

export default function View() {
  const { user, loading: authLoading } = useAuth()

  const [vehicles, setVehicles] = useState<MyVehicle[] | null>(null)
  const [offers, setOffers] = useState<OfferRow[] | null>(null)
  const [enquiries, setEnquiries] = useState<EnquiryRow[] | null>(null)
  const [busyOffer, setBusyOffer] = useState<string | null>(null)
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [replying, setReplying] = useState<string | null>(null)

  function loadListings() {
    return apiGet<{ vehicles: MyVehicle[] }>('/api/vehicles?mine=1')
      .then((d) => setVehicles(d.vehicles))
      .catch((e: Error) => { setVehicles([]); toast.error(e.message) })
  }
  function loadOffers() {
    return apiGet<{ offers: OfferRow[] }>('/api/offers?incoming=1')
      .then((d) => setOffers(d.offers))
      .catch(() => setOffers([]))
  }
  function loadEnquiries() {
    return apiGet<{ enquiries: EnquiryRow[] }>('/api/enquiries?selling=1')
      .then((d) => setEnquiries(d.enquiries))
      .catch(() => setEnquiries([]))
  }

  useEffect(() => {
    let active = true
    if (!user) {
      const t = setTimeout(() => {
        if (active) { setVehicles([]); setOffers([]); setEnquiries([]) }
      }, 0)
      return () => { active = false; clearTimeout(t) }
    }
    Promise.resolve().then(() => {
      if (!active) return
      loadListings()
      loadOffers()
      loadEnquiries()
    })
    return () => { active = false }
  }, [user])

  const pendingOffers = useMemo(() => (offers ?? []).filter((o) => o.status === 'PENDING'), [offers])

  const offersByVehicle = useMemo(() => {
    const map = new Map<string, { vehicle: OfferRow['vehicle']; offers: OfferRow[] }>()
    for (const o of offers ?? []) {
      const entry = map.get(o.vehicleId) ?? { vehicle: o.vehicle, offers: [] }
      entry.offers.push(o)
      map.set(o.vehicleId, entry)
    }
    return [...map.values()]
  }, [offers])

  function vehicleAction(id: string, action: 'submit' | 'mark_sold', doneMsg: string) {
    setBusyOffer(id)
    apiSend(`/api/vehicles/${id}`, 'PATCH', { action })
      .then(() => {
        toast.success(doneMsg)
        return loadListings()
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusyOffer(null))
  }

  function deleteVehicle(id: string) {
    setBusyOffer(id)
    apiSend(`/api/vehicles/${id}`, 'DELETE')
      .then(() => {
        toast.success('Draft deleted')
        return loadListings()
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusyOffer(null))
  }

  function offerAction(offer: OfferRow, action: 'accept' | 'reject') {
    setBusyOffer(offer.id)
    apiSend<{ vehicle?: { status: string } }>(`/api/offers/${offer.id}`, 'PATCH', { action })
      .then((res) => {
        toast.success(
          action === 'accept'
            ? 'Offer accepted — your listing is now Reserved'
            : 'Offer rejected',
          { description: action === 'accept' ? `The dealer (${offer.org.name}) has been notified.` : undefined }
        )
        if (res.vehicle?.status) return Promise.all([loadListings(), loadOffers()])
        return loadOffers()
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusyOffer(null))
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function replyTo(enquiry: EnquiryRow) {
    const body = (replyTexts[enquiry.id] ?? '').trim()
    if (body.length < 2) { toast.error('Write a reply first'); return }
    setReplying(enquiry.id)
    apiSend(`/api/enquiries/${enquiry.id}`, 'POST', { body })
      .then(() => {
        setReplyTexts((t) => ({ ...t, [enquiry.id]: '' }))
        toast.success('Reply sent')
        return loadEnquiries()
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setReplying(null))
  }

  function closeEnquiry(enquiry: EnquiryRow) {
    apiSend(`/api/enquiries/${enquiry.id}`, 'PATCH', { status: 'CLOSED' })
      .then(() => {
        toast.success('Enquiry closed')
        return loadEnquiries()
      })
      .catch((e: Error) => toast.error(e.message))
  }

  // ── Auth gate ──
  if (!authLoading && !user) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16 sm:py-24">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <LockKeyhole className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-xl font-bold">Sign in to manage your listings</h1>
            <p className="text-sm text-muted-foreground">
              Track views, reply to enquiries, and manage dealer offers on your cars.
            </p>
            <Button className="h-11 px-6" onClick={() => navigate('signin')}>Sign in</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">My listings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your cars, offers and enquiries.</p>
        </div>
        <Button className="h-11 px-5" onClick={() => navigate('sell')}>
          <Plus className="h-4 w-4" /> New listing
        </Button>
      </header>

      <Tabs defaultValue="listings">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
          <TabsTrigger value="listings" className="gap-1.5 px-4 py-2.5">
            <Car className="h-4 w-4" /> Listings
            {vehicles && <Badge variant="secondary" className="ml-1">{vehicles.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="offers" className="gap-1.5 px-4 py-2.5">
            <Tag className="h-4 w-4" /> Offers received
            {pendingOffers.length > 0 && <Badge className="ml-1 border-none bg-accent text-accent-foreground">{pendingOffers.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="enquiries" className="gap-1.5 px-4 py-2.5">
            <Inbox className="h-4 w-4" /> Enquiries
            {enquiries && <Badge variant="secondary" className="ml-1">{enquiries.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ── Listings ── */}
        <TabsContent value="listings" className="mt-4">
          {!vehicles ? (
            <div className="space-y-3" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
            </div>
          ) : vehicles.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                <Car className="h-10 w-10 text-muted-foreground" />
                <p className="font-medium">No listings yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  List your first car — it&apos;s free, and your contact details stay private until you decide to share them.
                </p>
                <Button className="h-11 px-5" onClick={() => navigate('sell')}>Sell your car</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {vehicles.map((v) => (
                <Card key={v.id}>
                  <CardContent className="p-4 sm:p-6">
                    <div className="flex flex-col gap-4 sm:flex-row">
                      <div className="flex h-24 w-36 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-xs text-muted-foreground">
                        {v.photos && v.photos.length > 0
                          ? <img src={v.photos[0].url} alt={`${v.make} ${v.model}`} className="h-full w-full object-cover" />
                          : 'No photo'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={statusBadgeVariant(v.status)}>{VEHICLE_STATUS_LABELS[v.status] ?? v.status}</Badge>
                          <span className="font-mono text-xs text-muted-foreground">{v.refCode}</span>
                          {v.featured && <Badge className="border-none bg-accent text-accent-foreground">Featured</Badge>}
                        </div>
                        <h3 className="mt-1 truncate font-semibold">{v.make} {v.model} {v.year}</h3>
                        <p className="font-bold text-primary">{money(v.priceMinor, v.currency)}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {v.views.toLocaleString()} views</span>
                          <span className="flex items-center gap-1"><MessageSquareText className="h-3.5 w-3.5" /> {v.enquiryCount} {v.enquiryCount === 1 ? 'enquiry' : 'enquiries'}</span>
                          {v.offerCount > 0 && (
                            <span className="flex items-center gap-1 font-medium text-accent-foreground">
                              <Tag className="h-3.5 w-3.5" /> {v.offerCount} {v.offerCount === 1 ? 'offer' : 'offers'}
                            </span>
                          )}
                          <span>listed {timeAgo(v.createdAt)}</span>
                        </div>
                        {v.status === 'PENDING_REVIEW' && (
                          <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                            Under review — our team checks listings before they go public (target: 24 business hours).
                          </p>
                        )}
                        {v.status === 'REJECTED' && (
                          <p className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                            <span className="font-semibold">Rejected{v.reviewNote ? ':' : ' — edit and resubmit.'}</span>
                            {v.reviewNote ? ` ${v.reviewNote}` : ''}
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" className="h-11 px-4 sm:h-9" onClick={() => navigate(`vehicle-detail/${v.id}`)}>
                            View
                          </Button>
                          {(v.status === 'DRAFT' || v.status === 'PENDING_REVIEW' || v.status === 'REJECTED') && (
                            <Button variant="outline" size="sm" className="h-11 px-4 sm:h-9" onClick={() => navigate(`sell?id=${v.id}`)}>
                              Edit
                            </Button>
                          )}
                          {v.status === 'DRAFT' && (
                            <Button
                              size="sm" className="h-11 px-4 sm:h-9"
                              disabled={busyOffer === v.id}
                              onClick={() => vehicleAction(v.id, 'submit', 'Submitted for review')}
                            >
                              {busyOffer === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit for review
                            </Button>
                          )}
                          {v.status === 'REJECTED' && (
                            <Button
                              size="sm" className="h-11 px-4 sm:h-9"
                              disabled={busyOffer === v.id}
                              onClick={() => vehicleAction(v.id, 'submit', 'Resubmitted for review')}
                            >
                              {busyOffer === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Resubmit
                            </Button>
                          )}
                          {(v.status === 'PUBLISHED' || v.status === 'RESERVED') && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="outline" size="sm" className="h-11 px-4 text-destructive sm:h-9">
                                  <CircleCheck className="h-4 w-4" /> Mark sold
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Mark as sold?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Your listing will show as sold and buyers can no longer enquire. Only mark it sold when payment
                                    has been completed — this can&apos;t be undone by you.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => vehicleAction(v.id, 'mark_sold', 'Marked as sold')}>
                                    Yes, it&apos;s sold
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                          {(v.status === 'DRAFT' || v.status === 'REJECTED') && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-11 px-4 text-destructive sm:h-9" disabled={busyOffer === v.id}>
                                  <X className="h-4 w-4" /> Delete
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This permanently removes the listing and its photos. Published listings can&apos;t be deleted this way.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteVehicle(v.id)} className="bg-destructive text-white hover:bg-destructive/90">
                                    Delete permanently
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Offers received ── */}
        <TabsContent value="offers" className="mt-4">
          {!offers ? (
            <div className="space-y-3" aria-busy="true">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
            </div>
          ) : offersByVehicle.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                <Tag className="h-10 w-10 text-muted-foreground" />
                <p className="font-medium">No offers yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Verified dealers send offers on listings where you opted in to &ldquo;match with dealers&rdquo;.
                  Your contact stays private until you accept.
                </p>
                <Button className="h-11 px-5" onClick={() => navigate('sell')}>List a car</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {offersByVehicle.map(({ vehicle, offers: vos }) => (
                <Card key={vehicle.id}>
                  <CardContent className="p-4 sm:p-6">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <button onClick={() => navigate(`vehicle-detail/${vehicle.id}`)} className="text-left font-semibold hover:underline">
                        {vehicle.make} {vehicle.model} {vehicle.year}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">{vehicle.refCode}</span>
                      </button>
                      <Badge variant={statusBadgeVariant('PUBLISHED')} className="hidden sm:inline-flex">Your listing</Badge>
                    </div>
                    <div className="space-y-3">
                      {vos.map((o) => (
                        <div key={o.id} className="rounded-xl border border-border p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <DollarSign className="h-4 w-4 text-primary" />
                              <span className="text-lg font-bold text-primary">{money(o.amountMinor)}</span>
                              <span className="text-sm text-muted-foreground">from {o.org.name}</span>
                            </div>
                            <Badge variant={o.status === 'PENDING' ? 'secondary' : o.status === 'ACCEPTED' ? 'default' : 'outline'}>
                              {o.status.charAt(0) + o.status.slice(1).toLowerCase()}
                            </Badge>
                          </div>
                          {o.message && <p className="mt-2 text-sm text-foreground/90">&ldquo;{o.message}&rdquo;</p>}
                          <p className="mt-1 text-xs text-muted-foreground">
                            Sent {timeAgo(o.createdAt)}
                            {o.expiresAt ? ` · expires ${dateLabel(o.expiresAt)}` : ''}
                          </p>
                          {o.status === 'PENDING' && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" className="h-11 px-5 sm:h-9" disabled={busyOffer === o.id}>
                                    {busyOffer === o.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleCheck className="h-4 w-4" />} Accept
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Accept {money(o.amountMinor)} from {o.org.name}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Your listing will be marked <strong>Reserved</strong> while you complete the sale with this dealer.
                                      All other pending offers on this car will be automatically closed. You can still mark the car
                                      as sold afterwards.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => offerAction(o, 'accept')}>
                                      Accept offer &amp; reserve
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                              <Button
                                variant="outline" size="sm" className="h-11 px-5 sm:h-9"
                                disabled={busyOffer === o.id}
                                onClick={() => offerAction(o, 'reject')}
                              >
                                <Ban className="h-4 w-4" /> Reject
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Enquiries ── */}
        <TabsContent value="enquiries" className="mt-4">
          {!enquiries ? (
            <div className="space-y-3" aria-busy="true">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
            </div>
          ) : enquiries.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                <Inbox className="h-10 w-10 text-muted-foreground" />
                <p className="font-medium">No enquiries yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  When buyers ask about your cars, the conversation appears here.
                </p>
                <Button className="h-11 px-5" onClick={() => navigate('cars')}>See what buyers see</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {enquiries.map((e) => {
                const isOpen = expanded.has(e.id)
                return (
                  <Card key={e.id}>
                    <CardContent className="p-0">
                      <button
                        className="flex w-full items-center justify-between gap-3 p-4 text-left sm:p-6"
                        onClick={() => toggleExpanded(e.id)}
                        aria-expanded={isOpen}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={e.status === 'OPEN' ? 'secondary' : e.status === 'ANSWERED' ? 'default' : 'outline'}>
                              {e.status.charAt(0) + e.status.slice(1).toLowerCase()}
                            </Badge>
                            <span className="truncate text-sm font-semibold">
                              {e.vehicle.make} {e.vehicle.model} {e.vehicle.year}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">{e.refCode}</span>
                          </div>
                          <p className="mt-1 truncate text-sm text-muted-foreground">{e.message}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {timeAgo(e.createdAt)} · {e.messages.length} {e.messages.length === 1 ? 'message' : 'messages'}
                            {e.phoneShare && e.phone ? ` · Phone: ${e.phone}` : ' · Phone not shared'}
                          </p>
                        </div>
                        <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {isOpen && (
                        <div className="border-t border-border p-4 sm:p-6">
                          <div className="max-h-80 space-y-3 overflow-y-auto pr-1 scrollbar-thin">
                            {e.messages.map((m) => {
                              const mine = m.senderSide === 'SELLER'
                              return (
                                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                                    mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                                  }`}>
                                    <p className={`mb-0.5 text-xs ${mine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                                      {m.senderName} · {timeAgo(m.createdAt)}
                                    </p>
                                    <p className="whitespace-pre-line">{m.body}</p>
                                  </div>
                                </div>
                              )
                            })}
                          </div>

                          {e.status !== 'CLOSED' ? (
                            <div className="mt-4 space-y-2">
                              <Textarea
                                rows={2}
                                placeholder={`Reply to ${e.refCode.replace('ENQ-', 'enquiry ')}…`}
                                value={replyTexts[e.id] ?? ''}
                                onChange={(ev) => setReplyTexts((t) => ({ ...t, [e.id]: ev.target.value }))}
                              />
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  className="h-11 px-5"
                                  disabled={replying === e.id}
                                  onClick={() => replyTo(e)}
                                >
                                  {replying === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send reply
                                </Button>
                                <Button variant="ghost" className="h-11 px-4" onClick={() => closeEnquiry(e)}>
                                  <X className="h-4 w-4" /> Close enquiry
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p className="mt-3 text-sm text-muted-foreground">This enquiry is closed.</p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
