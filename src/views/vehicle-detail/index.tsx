'use client'

/* CARMAZE — Vehicle detail (#/vehicle-detail/<id>)
 * Gallery, full specification, safety guidance, honest seller card,
 * save / share / report / enquire actions and similar listings.
 */

import { useEffect, useState } from 'react'
import {
  Heart, Share2, Flag, Mail, BadgeCheck, MapPin, Gauge, Fuel, Cog, Car,
  Palette, CalendarDays, Eye, Hash, ShieldAlert, ArrowLeft, MessageSquareText, Phone,
  CalendarCheck, MessageCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { VehicleCard, type VehicleCardData } from '@/components/marketplace/vehicle-card'
import { MessageDialog, TestDriveDialog } from '@/components/storefront/dialogs'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useAuth } from '@/stores/auth'
import { apiGet, apiSend, navigate } from '@/lib/client'
import { money, timeAgo, CONDITION_LABELS, VEHICLE_STATUS_LABELS, vehicleTitle } from '@/lib/format'
import { toast } from 'sonner'

type VehicleDetail = {
  id: string
  refCode: string
  make: string
  model: string
  year: number
  priceMinor: number
  currency: string
  mileageKm: number
  fuel: string
  transmission: string
  bodyType: string
  engineCc: number | null
  condition: string
  county: string
  town: string | null
  color: string
  description: string
  sellerType: string
  status: string
  featured: boolean
  views: number
  matchWithDealers: boolean
  createdAt: string
  photos: { url: string; order: number }[]
  owner: { name: string }
  org?: {
    id: string
    name: string
    county: string
    town: string | null
    phone: string | null
    location: string | null
    description: string | null
    status: string
  } | null
}

type DetailResponse = { vehicle: VehicleDetail; similar: VehicleCardData[] }

const REPORT_REASONS = [
  'Suspected scam or fraud',
  'Price looks wrong or misleading',
  'Vehicle already sold',
  'Duplicate listing',
  'Prohibited or stolen vehicle',
  'Other',
]

export default function View() {
  const route = useHashRoute()
  const id = route.segments[1] ?? ''
  const { user } = useAuth()

  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null)
  const [similar, setSimilar] = useState<VehicleCardData[]>([])
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activePhoto, setActivePhoto] = useState(0)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())

  const [enquiryOpen, setEnquiryOpen] = useState(false)
  const [enquiryMsg, setEnquiryMsg] = useState('')
  const [phoneShare, setPhoneShare] = useState(true)
  const [phone, setPhone] = useState('')
  const [sendingEnquiry, setSendingEnquiry] = useState(false)

  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState<string>('')
  const [reportDetails, setReportDetails] = useState('')
  const [sendingReport, setSendingReport] = useState(false)

  // Storefront actions (dealer listings with an org): test drive / vehicle enquiry
  const [storefrontAction, setStorefrontAction] = useState<'message' | 'test-drive' | null>(null)

  // ── Load detail (and reset view-local state per vehicle) ──
  useEffect(() => {
    if (!id) return
    let active = true
    Promise.resolve().then(() => {
      if (!active) return
      setVehicle(null)
      setNotFound(false)
      setError(null)
      setActivePhoto(0)
    })
    apiGet<DetailResponse>(`/api/vehicles/${id}`)
      .then((d) => {
        if (!active) return
        setVehicle(d.vehicle)
        setSimilar(d.similar ?? [])
      })
      .catch((e: { status?: number; message: string }) => {
        if (!active) return
        if (e.status === 404) setNotFound(true)
        else setError(e.message)
      })
    return () => { active = false }
  }, [id])

  // ── Fire-and-forget view ping (server dedupes per IP) ──
  useEffect(() => {
    if (!id) return
    apiSend(`/api/vehicles/${id}/view`, 'POST').catch(() => {})
  }, [id])

  // ── Saved vehicles (for the heart) ──
  useEffect(() => {
    if (!user) {
      const t = setTimeout(() => setSavedIds(new Set()), 0)
      return () => clearTimeout(t)
    }
    let active = true
    apiGet<{ saved: { vehicle: VehicleCardData }[] }>('/api/saved-vehicles')
      .then((d) => { if (active) setSavedIds(new Set(d.saved.map((s) => s.vehicle.id))) })
      .catch(() => {})
    return () => { active = false }
  }, [user])

  // ── Document title ──
  useEffect(() => {
    if (vehicle) document.title = `${vehicleTitle(vehicle)} | CARMAZE`
    return () => { document.title = 'CARMAZE' }
  }, [vehicle])

  // ── Prefill the enquiry phone from the session ──
  useEffect(() => {
    if (user) {
      const t = setTimeout(() => setPhone(user.phone ?? ''), 0)
      return () => clearTimeout(t)
    }
  }, [user])

  function toggleSaved() {
    if (!vehicle) return
    if (!user) {
      toast.info('Sign in to save vehicles')
      navigate('signin')
      return
    }
    const isSaved = savedIds.has(vehicle.id)
    setSavedIds((prev) => {
      const next = new Set(prev)
      if (isSaved) next.delete(vehicle.id)
      else next.add(vehicle.id)
      return next
    })
    const done = isSaved
      ? apiSend(`/api/saved-vehicles?vehicleId=${vehicle.id}`, 'DELETE')
      : apiSend('/api/saved-vehicles', 'POST', { vehicleId: vehicle.id })
    done
      .then(() => toast.success(isSaved ? 'Removed from your shortlist' : 'Saved to your shortlist'))
      .catch((e: Error) => {
        setSavedIds((prev) => {
          const next = new Set(prev)
          if (isSaved) next.add(vehicle.id)
          else next.delete(vehicle.id)
          return next
        })
        toast.error(e.message)
      })
  }

  function share() {
    const url = window.location.href
    const done = navigator.clipboard?.writeText(url)
    Promise.resolve(done)
      .then(() => toast.success('Link copied to clipboard'))
      .catch(() => toast.info('Copy this link', { description: url }))
  }

  function sendEnquiry() {
    if (!vehicle) return
    if (enquiryMsg.trim().length < 10) { toast.error('Please write a message (at least 10 characters)'); return }
    if (phoneShare && phone.trim() && !/^[+\d][\d\s-]{6,}$/.test(phone.trim())) {
      toast.error('Enter a valid phone number')
      return
    }
    setSendingEnquiry(true)
    apiSend<{ enquiry: { id: string; refCode: string } }>('/api/enquiries', 'POST', {
      vehicleId: vehicle.id,
      message: enquiryMsg.trim(),
      phoneShare,
      phone: phoneShare ? (phone.trim() || undefined) : undefined,
    })
      .then((res) => {
        setEnquiryOpen(false)
        setEnquiryMsg('')
        toast.success('Enquiry sent to the seller', {
          description: `Reference ${res.enquiry.refCode}. Track replies under Account → Enquiries.`,
          action: { label: 'View', onClick: () => navigate('account') },
        })
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setSendingEnquiry(false))
  }

  function sendReport() {
    if (!vehicle) return
    if (!user) {
      toast.info('Sign in to report a listing')
      navigate('signin')
      return
    }
    if (!reportReason) { toast.error('Choose a reason'); return }
    setSendingReport(true)
    apiSend('/api/reports', 'POST', {
      targetType: 'LISTING',
      targetId: vehicle.id,
      reason: reportReason,
      details: reportDetails.trim() || undefined,
    })
      .then(() => {
        setReportOpen(false)
        setReportDetails('')
        setReportReason('')
        toast.success('Report submitted', { description: 'Our moderation team will review it shortly.' })
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setSendingReport(false))
  }

  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-20 text-center">
        <Car className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="mt-4 text-2xl font-bold">This listing is not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been sold, removed or is still awaiting review.
        </p>
        <Button className="mt-6 h-11 px-6" onClick={() => navigate('cars')}>
          <ArrowLeft className="h-4 w-4" /> Browse all cars
        </Button>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-20 text-center">
        <p className="font-medium">Something went wrong loading this listing.</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" className="mt-6 h-11 px-6" onClick={() => navigate('cars')}>Back to marketplace</Button>
      </div>
    )
  }

  if (!vehicle) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6" aria-busy="true">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="aspect-[16/10] w-full rounded-xl lg:col-span-2" />
          <div className="space-y-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  const title = vehicleTitle(vehicle)
  const photos = vehicle.photos ?? []
  const location = [vehicle.town, vehicle.county].filter(Boolean).join(', ')
  const isDealer = vehicle.sellerType === 'DEALER'

  const specs = [
    { icon: Gauge, label: 'Mileage', value: `${vehicle.mileageKm.toLocaleString()} km` },
    { icon: Fuel, label: 'Fuel', value: vehicle.fuel.charAt(0) + vehicle.fuel.slice(1).toLowerCase() },
    { icon: Cog, label: 'Transmission', value: vehicle.transmission === 'AUTOMATIC' ? 'Automatic' : 'Manual' },
    { icon: Car, label: 'Body', value: vehicle.bodyType.charAt(0) + vehicle.bodyType.slice(1).toLowerCase() },
    { icon: Cog, label: 'Engine', value: vehicle.engineCc ? `${vehicle.engineCc.toLocaleString()} cc` : '—' },
    { icon: Palette, label: 'Colour', value: vehicle.color },
    { icon: MapPin, label: 'Location', value: location || '—' },
    { icon: CalendarDays, label: 'Listed', value: timeAgo(vehicle.createdAt) },
    { icon: Hash, label: 'Ref', value: vehicle.refCode },
    { icon: Eye, label: 'Views', value: vehicle.views.toLocaleString() },
  ]

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <Button variant="ghost" className="mb-4 h-11 px-3 -ml-3" onClick={() => navigate('cars')}>
        <ArrowLeft className="h-4 w-4" /> Back to marketplace
      </Button>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Gallery */}
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-xl border border-border bg-muted">
            {photos.length > 0 ? (
              <img
                src={photos[activePhoto]?.url ?? photos[0].url}
                alt={`${title} — photo ${activePhoto + 1} of ${photos.length}`}
                className="aspect-[16/10] w-full object-cover"
              />
            ) : (
              <div className="flex aspect-[16/10] w-full items-center justify-center text-sm text-muted-foreground">
                No photos provided
              </div>
            )}
          </div>
          {photos.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-thin" role="tablist" aria-label="Vehicle photos">
              {photos.map((p, i) => (
                <button
                  key={p.url}
                  role="tab"
                  aria-selected={i === activePhoto}
                  aria-label={`Show photo ${i + 1}`}
                  onClick={() => setActivePhoto(i)}
                  className={`h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                    i === activePhoto ? 'border-accent' : 'border-transparent hover:border-border'
                  }`}
                >
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {/* Description */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-lg">Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{vehicle.description}</p>
            </CardContent>
          </Card>

          <Alert className="mt-4 border-amber-600/30 bg-amber-50/60 text-amber-950 [&>svg]:text-amber-700">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Stay safe when buying</AlertTitle>
            <AlertDescription>
              Never pay a &ldquo;release fee&rdquo; or deposit to a stranger before seeing the vehicle. Inspect in
              person (or via a trusted agent) before paying. Report suspicious listings using the Report button.
            </AlertDescription>
          </Alert>
        </div>

        {/* Summary sidebar */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-wrap items-center gap-2">
                {vehicle.featured && <Badge className="border-none bg-accent text-accent-foreground">Featured</Badge>}
                <Badge variant="secondary">{CONDITION_LABELS[vehicle.condition] ?? vehicle.condition}</Badge>
                {vehicle.status !== 'PUBLISHED' && (
                  <Badge variant={vehicle.status === 'SOLD' ? 'destructive' : 'outline'}>
                    {VEHICLE_STATUS_LABELS[vehicle.status] ?? vehicle.status}
                  </Badge>
                )}
                {isDealer ? (
                  <Badge variant="outline" className="gap-1"><BadgeCheck className="h-3.5 w-3.5 text-primary" /> Dealer</Badge>
                ) : (
                  <Badge variant="outline">Private seller</Badge>
                )}
              </div>
              <h1 className="mt-3 text-2xl font-bold leading-tight">{title}</h1>
              <p className="mt-1 text-3xl font-extrabold text-primary">{money(vehicle.priceMinor, vehicle.currency)}</p>
              <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" /> {location || 'Kenya'}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  className="h-11 flex-col gap-0.5"
                  onClick={() => setEnquiryOpen(true)}
                  disabled={vehicle.status === 'SOLD'}
                >
                  <Mail className="h-4 w-4" />
                  <span className="text-xs">{vehicle.status === 'SOLD' ? 'Sold' : 'Enquire'}</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-11 flex-col gap-0.5"
                  onClick={toggleSaved}
                  aria-pressed={savedIds.has(vehicle.id)}
                >
                  <Heart className={`h-4 w-4 ${savedIds.has(vehicle.id) ? 'fill-[#D9B878] text-[#D9B878]' : ''}`} />
                  <span className="text-xs">{savedIds.has(vehicle.id) ? 'Saved' : 'Save'}</span>
                </Button>
                <Button variant="outline" className="h-11 flex-col gap-0.5" onClick={share}>
                  <Share2 className="h-4 w-4" /><span className="text-xs">Share</span>
                </Button>
                <Button variant="outline" className="h-11 flex-col gap-0.5" onClick={() => setReportOpen(true)}>
                  <Flag className="h-4 w-4" /><span className="text-xs">Report</span>
                </Button>
              </div>

              {vehicle.org?.id && (
                <div className="mt-2 grid gap-2 border-t border-border pt-3">
                  <Button
                    variant="outline"
                    className="h-11 justify-start gap-2"
                    onClick={() => setStorefrontAction('test-drive')}
                    disabled={vehicle.status === 'SOLD'}
                  >
                    <CalendarCheck className="h-4 w-4 text-primary" /> Book test drive
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 justify-start gap-2"
                    onClick={() => setStorefrontAction('message')}
                    disabled={vehicle.status === 'SOLD'}
                  >
                    <MessageCircle className="h-4 w-4 text-primary" /> Ask about this vehicle
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Seller card — honest about seller type */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{isDealer ? 'Sold by' : 'Private seller'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isDealer && vehicle.org ? (
                <>
                  <p className="flex items-center gap-1.5 font-semibold">
                    {vehicle.org.name}
                    <BadgeCheck className="h-4.5 w-4.5 text-primary" aria-label="Verified dealer" />
                  </p>
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    {[vehicle.org.location, vehicle.org.town, vehicle.org.county].filter(Boolean).join(', ')}
                  </p>
                  {vehicle.org.description && (
                    <p className="text-sm text-muted-foreground">{vehicle.org.description}</p>
                  )}
                  {vehicle.org.phone && (
                    <p className="flex items-center gap-1.5 pt-1 text-sm font-medium">
                      <Phone className="h-4 w-4 text-primary" />
                      <a href={`tel:${vehicle.org.phone}`} className="hover:underline">{vehicle.org.phone}</a>
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">Business contact — call during working hours.</p>
                </>
              ) : (
                <>
                  <p className="font-semibold">{vehicle.owner?.name ?? 'Private seller'}</p>
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" /> {location || 'Kenya'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Contact details stay private. Send an enquiry and the seller can reply securely.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Specs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Specification</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3">
              {specs.map((s) => (
                <div key={s.label} className="flex items-start gap-2">
                  <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="truncate text-sm font-medium" title={s.value}>{s.value}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Similar listings */}
      {similar.length > 0 && (
        <section className="mt-10">
          <Separator className="mb-6" />
          <h2 className="mb-4 text-xl font-bold">Similar vehicles</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {similar.map((v) => <VehicleCard key={v.id} v={v} />)}
          </div>
        </section>
      )}

      {/* Enquiry dialog */}
      <Dialog open={enquiryOpen} onOpenChange={setEnquiryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enquire about the {title}</DialogTitle>
            <DialogDescription>
              Your message goes straight to {isDealer && vehicle.org ? vehicle.org.name : 'the seller'}. Ask about
              availability, inspection or service history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="enq-msg">Message</Label>
              <Textarea
                id="enq-msg"
                rows={4}
                placeholder="Hi, is this still available? I'd like to book a viewing…"
                value={enquiryMsg}
                onChange={(e) => setEnquiryMsg(e.target.value)}
              />
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                checked={phoneShare}
                onCheckedChange={(c) => setPhoneShare(c === true)}
                className="mt-0.5"
              />
              <span>Share my phone number with the seller for faster replies</span>
            </label>
            {phoneShare && (
              <div className="space-y-1.5">
                <Label htmlFor="enq-phone">Phone number</Label>
                <Input
                  id="enq-phone"
                  inputMode="tel"
                  placeholder="+254 7XX XXX XXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Only visible to this seller.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" className="h-11" onClick={() => setEnquiryOpen(false)}>Cancel</Button>
            <Button className="h-11 px-5" onClick={sendEnquiry} disabled={sendingEnquiry}>
              <MessageSquareText className="h-4 w-4" /> {sendingEnquiry ? 'Sending…' : 'Send enquiry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Storefront dialogs — dealer listings */}
      {vehicle.org?.id && (
        <>
          <MessageDialog
            open={storefrontAction === 'message'}
            onOpenChange={(open) => { if (!open) setStorefrontAction(null) }}
            org={{ id: vehicle.org.id, name: vehicle.org.name }}
            vehicleId={vehicle.id}
            kind="VEHICLE_ENQUIRY"
            subject={`Enquiry: ${title}`}
          />
          <TestDriveDialog
            open={storefrontAction === 'test-drive'}
            onOpenChange={(open) => { if (!open) setStorefrontAction(null) }}
            org={{ id: vehicle.org.id, name: vehicle.org.name }}
            vehicleId={vehicle.id}
            vehicleLabel={title}
          />
        </>
      )}

      {/* Report dialog */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Report this listing</DialogTitle>
            <DialogDescription>
              Tell us what looks wrong. Reports are reviewed by our moderation team.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={reportReason} onValueChange={setReportReason}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose a reason" /></SelectTrigger>
                <SelectContent>
                  {REPORT_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-details">Details (optional)</Label>
              <Textarea
                id="report-details"
                rows={3}
                placeholder="Anything that helps us investigate…"
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="h-11" onClick={() => setReportOpen(false)}>Cancel</Button>
            <Button variant="destructive" className="h-11 px-5" onClick={sendReport} disabled={sendingReport}>
              {sendingReport ? 'Submitting…' : 'Submit report'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
