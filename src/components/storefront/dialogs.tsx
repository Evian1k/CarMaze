'use client'

/* CARMAZE — storefront dialogs: Message (conversations), Quote (service
 * requests), Booking (fixed-price service slot requests), Test drive and
 * Review. All are auth-aware (401 → sign-in), mobile-friendly and animated.
 * Each dialog = outer shell (Dialog) + inner form that mounts fresh every
 * time the dialog opens, so no reset effects are needed. */

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Loader2, MessageCircle, PartyPopper, ShieldCheck, Sparkles, Star,
  CalendarCheck, CarFront, ClipboardList,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/stores/auth'
import { apiSend, navigate } from '@/lib/client'
import { KENYA_COUNTIES, SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS } from '@/lib/format'
import type { StorefrontReview, StorefrontService } from './types'

// ─────────────────────────── Shared bits ───────────────────────────

function Sending({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {label}
    </span>
  )
}

export function SuccessPanel({ refCode, title, body, children }: { refCode?: string | null; title: string; body: string; children?: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 0.61, 0.36, 1] }}
      className="space-y-4 py-2 text-center"
    >
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#315e4b]/10 text-[#315e4b]">
        <PartyPopper className="h-6 w-6" aria-hidden="true" />
      </div>
      <div>
        <p className="font-semibold">{title}</p>
        {refCode && (
          <p className="mt-1 text-sm text-muted-foreground">
            Reference <span className="font-mono font-semibold text-foreground">{refCode}</span>
          </p>
        )}
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      </div>
      {children && <div className="flex flex-wrap justify-center gap-2">{children}</div>}
    </motion.div>
  )
}

/** Next 14 days (local YYYY-MM-DD) + hourly 09:00–17:00 slots. */
export function slotOptions() {
  const days: { value: string; label: string }[] = []
  const fmt = new Intl.DateTimeFormat('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })
  for (let i = 0; i < 14; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.push({ value: iso, label: i === 0 ? `Today · ${fmt.format(d)}` : i === 1 ? `Tomorrow · ${fmt.format(d)}` : fmt.format(d) })
  }
  const times: string[] = []
  for (let h = 9; h <= 17; h++) times.push(`${String(h).padStart(2, '0')}:00`)
  return { days, times }
}

function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Handles the auth-gate uniformly for all storefront dialogs. */
function useSubmitGuard() {
  const user = useAuth((s) => s.user)
  return function guard(): boolean {
    if (!user) {
      toast.info('Sign in to continue', { description: 'Create a free CARMAZE account first — it takes a minute.' })
      navigate('signin')
      return false
    }
    return true
  }
}

function isAuthError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'status' in e && (e as { status?: number }).status === 401
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

/** Time input slots that are still bookable for the chosen date. */
function useValidTimes(date: string, bufferMinutes: number) {
  const { times } = useMemo(() => slotOptions(), [])
  const todayIso = localIsoDate(new Date())
  return times.filter((t) => {
    if (date !== todayIso) return true
    const [h, m] = t.split(':').map(Number)
    const slot = new Date()
    slot.setHours(h, m, 0, 0)
    return slot.getTime() >= Date.now() + bufferMinutes * 60 * 1000
  })
}

// ─────────────────────────── MessageDialog ───────────────────────────

export function MessageDialog({
  open, onOpenChange, org, vehicleId, kind = 'GENERAL', subject = '',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  org: { id: string; name: string }
  vehicleId?: string
  kind?: 'GENERAL' | 'VEHICLE_ENQUIRY'
  subject?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" aria-hidden="true" /> Message {org.name}
          </DialogTitle>
          <DialogDescription>
            Your message lands in their CARMAZE inbox. Your phone number stays private unless you choose to share it.
          </DialogDescription>
        </DialogHeader>
        <MessageForm onOpenChange={onOpenChange} org={org} vehicleId={vehicleId} kind={kind} subject={subject} />
      </DialogContent>
    </Dialog>
  )
}

function MessageForm({
  onOpenChange, org, vehicleId, kind, subject,
}: {
  onOpenChange: (open: boolean) => void
  org: { id: string; name: string }
  vehicleId?: string
  kind: 'GENERAL' | 'VEHICLE_ENQUIRY'
  subject: string
}) {
  const guard = useSubmitGuard()
  const [sub, setSub] = useState(subject)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [doneRef, setDoneRef] = useState<string | null>(null)

  function submit() {
    if (message.trim().length < 5) { toast.error('Write a short message first (at least 5 characters)'); return }
    if (!guard()) return
    setSending(true)
    apiSend<{ conversation: { id: string; refCode?: string } }>('/api/conversations', 'POST', {
      orgId: org.id,
      subject: sub.trim() || undefined,
      vehicleId,
      kind,
      message: message.trim(),
    })
      .then((d) => {
        setDoneRef(d.conversation?.refCode ?? d.conversation?.id ?? null)
        toast.success('Message sent')
      })
      .catch((e) => {
        if (isAuthError(e)) {
          toast.info('Sign in to message businesses')
          navigate('signin')
          return
        }
        toast.error(errMessage(e, 'Could not send your message'))
      })
      .finally(() => setSending(false))
  }

  if (doneRef) {
    return (
      <SuccessPanel refCode={doneRef} title="Message sent" body={`${org.name} has been notified — replies appear in your messages.`}>
        <Button onClick={() => navigate('account?tab=messages')}>Open my messages</Button>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
      </SuccessPanel>
    )
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="msg-subject">Subject (optional)</Label>
          <Input id="msg-subject" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="e.g. Service enquiry" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="msg-body">Message</Label>
          <Textarea
            id="msg-body"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Hi, I found you on CARMAZE and would like to ask about…"
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button className="h-11 px-5" onClick={submit} disabled={sending || message.trim().length < 5}>
          {sending ? <Sending label="Sending…" /> : 'Send message'}
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────────────────────────── QuoteDialog ───────────────────────────

export function QuoteDialog({
  open, onOpenChange, org, presetCategory = 'GENERAL_SERVICE', presetTitle,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  org: { id: string; name: string; county: string; town?: string | null }
  presetCategory?: string
  presetTitle?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request a quote{presetTitle ? ` — ${presetTitle}` : ''}</DialogTitle>
          <DialogDescription>
            Your request is sent to garages matching the category — {org.name} is notified instantly and replies with a quote in your account. No obligation.
          </DialogDescription>
        </DialogHeader>
        <QuoteForm onOpenChange={onOpenChange} org={org} presetCategory={presetCategory} presetTitle={presetTitle} />
      </DialogContent>
    </Dialog>
  )
}

function QuoteForm({
  onOpenChange, org, presetCategory, presetTitle,
}: {
  onOpenChange: (open: boolean) => void
  org: { id: string; name: string; county: string; town?: string | null }
  presetCategory: string
  presetTitle?: string
}) {
  const guard = useSubmitGuard()
  const [category, setCategory] = useState(presetCategory)
  const [vehicle, setVehicle] = useState('')
  const [description, setDescription] = useState(presetTitle ? `Request for "${presetTitle}" — ` : '')
  const [county, setCounty] = useState(org.county || 'Nairobi')
  const [town, setTown] = useState('')
  const [sending, setSending] = useState(false)
  const [doneRef, setDoneRef] = useState<string | null>(null)

  function submit() {
    if (description.trim().length < 15) { toast.error('Describe the work in at least 15 characters'); return }
    if (!guard()) return
    setSending(true)
    apiSend<{ request: { refCode: string } }>('/api/service-requests', 'POST', {
      category,
      vehicleDesc: vehicle.trim() || undefined,
      description: description.trim(),
      county,
      town: town.trim() || undefined,
    })
      .then((d) => {
        setDoneRef(d.request.refCode)
        toast.success(`Request ${d.request.refCode} sent`)
      })
      .catch((e) => {
        if (isAuthError(e)) {
          toast.info('Sign in to request a quote')
          navigate('signin')
          return
        }
        toast.error(errMessage(e, 'Could not send your request'))
      })
      .finally(() => setSending(false))
  }

  if (doneRef) {
    return (
      <SuccessPanel refCode={doneRef} title="Request sent" body="Quotes will appear in your account — accept one and the booking is confirmed.">
        <Button onClick={() => navigate('account?tab=requests')}>View my requests</Button>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
      </SuccessPanel>
    )
  }

  return (
    <>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sfq-category">Service category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="sfq-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SERVICE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{SERVICE_CATEGORY_LABELS[c]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sfq-vehicle">Vehicle</Label>
            <Input id="sfq-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. Toyota Prado 2018" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sfq-desc">What do you need?</Label>
          <Textarea
            id="sfq-desc"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the work — symptoms, parts, preferences. Minimum 15 characters."
          />
          <p className={`text-xs ${description.trim().length < 15 ? 'text-muted-foreground' : 'text-[#315e4b]'}`}>
            {description.trim().length}/15 characters minimum
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sfq-county">County</Label>
            <Select value={county} onValueChange={setCounty}>
              <SelectTrigger id="sfq-county"><SelectValue /></SelectTrigger>
              <SelectContent>
                {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sfq-town">Town / area (optional)</Label>
            <Input id="sfq-town" value={town} onChange={(e) => setTown(e.target.value)} placeholder="e.g. Westlands" />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button className="h-11 px-5" onClick={submit} disabled={sending || description.trim().length < 15}>
          {sending ? <Sending label="Sending…" /> : <><Sparkles className="h-4 w-4" /> Send request</>}
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────────────────────────── BookingDialog ───────────────────────────
// NOTE: /api/bookings has no POST — bookings are created when a quote is
// accepted. So "Book this service" submits a service request carrying the
// preferred slot; the garage confirms and quotes, and the booking is locked.

export function BookingDialog({
  open, onOpenChange, org, service,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  org: { id: string; name: string; county: string; town?: string | null }
  service: StorefrontService
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 text-primary" aria-hidden="true" /> Book: {service.title}
          </DialogTitle>
          <DialogDescription>
            Pick a preferred slot in the next 14 days. {org.name} confirms the appointment and sends a fixed quote — accepting it locks the booking.
          </DialogDescription>
        </DialogHeader>
        <BookingForm onOpenChange={onOpenChange} org={org} service={service} />
      </DialogContent>
    </Dialog>
  )
}

function BookingForm({
  onOpenChange, org, service,
}: {
  onOpenChange: (open: boolean) => void
  org: { id: string; name: string; county: string; town?: string | null }
  service: StorefrontService
}) {
  const guard = useSubmitGuard()
  const { days } = useMemo(() => slotOptions(), [])
  const todayIso = localIsoDate(new Date())
  const [date, setDate] = useState(todayIso)
  const [time, setTime] = useState('09:00')
  const [vehicle, setVehicle] = useState('')
  const [notes, setNotes] = useState('')
  const [sending, setSending] = useState(false)
  const [doneRef, setDoneRef] = useState<string | null>(null)

  const validTimes = useValidTimes(date, 30)
  const slotLabel = date ? `${days.find((d) => d.value === date)?.label ?? date} at ${time}` : ''

  function submit() {
    if (!date || !time) { toast.error('Pick a preferred date and time'); return }
    const description = `Booking request: ${service.title} — preferred slot ${date} ${time}.${notes.trim() ? ` Notes: ${notes.trim()}` : ''}`
    if (description.trim().length < 15) { toast.error('Add a few more details (15 characters minimum)'); return }
    if (!guard()) return
    setSending(true)
    apiSend<{ request: { refCode: string } }>('/api/service-requests', 'POST', {
      category: service.category,
      vehicleDesc: vehicle.trim() || undefined,
      description: description.trim(),
      county: org.county,
      town: org.town || undefined,
    })
      .then((d) => {
        setDoneRef(d.request.refCode)
        toast.success(`Booking request ${d.request.refCode} sent`)
      })
      .catch((e) => {
        if (isAuthError(e)) {
          toast.info('Sign in to book this service')
          navigate('signin')
          return
        }
        toast.error(errMessage(e, 'Could not send your booking request'))
      })
      .finally(() => setSending(false))
  }

  if (doneRef) {
    return (
      <SuccessPanel
        refCode={doneRef}
        title="Booking request sent"
        body={`${org.name} will confirm your slot (${slotLabel}) — you'll get the fixed quote to accept in your account.`}
      >
        <Button onClick={() => navigate('account?tab=requests')}>View my requests</Button>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
      </SuccessPanel>
    )
  }

  return (
    <>
      <div className="space-y-4">
        <div className="rounded-lg bg-muted/60 p-3 text-sm">
          <p className="font-medium">{service.title}</p>
          {service.priceFromMinor != null && <p className="text-xs text-muted-foreground">Fixed price from KES {(service.priceFromMinor / 100).toLocaleString()}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bk-date">Preferred date</Label>
            <input
              id="bk-date"
              type="date"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={date}
              min={todayIso}
              max={days[days.length - 1].value}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bk-time">Preferred time</Label>
            <Select value={validTimes.includes(time) ? time : validTimes[0] ?? ''} onValueChange={setTime}>
              <SelectTrigger id="bk-time"><SelectValue placeholder="Choose a time" /></SelectTrigger>
              <SelectContent>
                {validTimes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bk-vehicle">Your vehicle</Label>
          <Input id="bk-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. Subaru Forester 2016, KDA…123A" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bk-notes">Notes (optional)</Label>
          <Textarea id="bk-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the garage should know before confirming the slot…" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button className="h-11 px-5" onClick={submit} disabled={sending || validTimes.length === 0}>
          {sending ? <Sending label="Sending…" /> : 'Request this slot'}
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────────────────────────── TestDriveDialog ───────────────────────────

export function TestDriveDialog({
  open, onOpenChange, org, vehicleId, vehicleLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  org?: { id: string; name: string }
  vehicleId: string
  vehicleLabel: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CarFront className="h-5 w-5 text-primary" aria-hidden="true" /> Book a test drive
          </DialogTitle>
          <DialogDescription>
            {vehicleLabel}{org ? ` — ${org.name}` : ''}. Choose a slot in the next 14 days; the showroom will confirm your appointment.
          </DialogDescription>
        </DialogHeader>
        <TestDriveForm onOpenChange={onOpenChange} org={org} vehicleId={vehicleId} vehicleLabel={vehicleLabel} />
      </DialogContent>
    </Dialog>
  )
}

function TestDriveForm({
  onOpenChange, org, vehicleId, vehicleLabel,
}: {
  onOpenChange: (open: boolean) => void
  org?: { id: string; name: string }
  vehicleId: string
  vehicleLabel: string
}) {
  const guard = useSubmitGuard()
  const { days } = useMemo(() => slotOptions(), [])
  const todayIso = localIsoDate(new Date())
  const [date, setDate] = useState(todayIso)
  const [time, setTime] = useState('09:00')
  const [licence, setLicence] = useState(false)
  const [notes, setNotes] = useState('')
  const [sending, setSending] = useState(false)
  const [doneRef, setDoneRef] = useState<string | null>(null)

  const validTimes = useValidTimes(date, 60)

  function submit() {
    if (!date || !time) { toast.error('Pick a date and time for the test drive'); return }
    if (!licence) { toast.error('Please confirm you hold a valid driving licence'); return }
    if (!guard()) return
    setSending(true)
    const scheduledAt = new Date(`${date}T${time}:00`).toISOString()
    apiSend<{ testDrive: { id: string; refCode?: string } }>('/api/test-drives', 'POST', {
      vehicleId,
      scheduledAt,
      licenceConfirmed: true,
    })
      .then((d) => {
        setDoneRef(d.testDrive?.refCode ?? d.testDrive?.id ?? null)
        toast.success('Test drive requested')
      })
      .catch((e) => {
        if (isAuthError(e)) {
          toast.info('Sign in to book a test drive')
          navigate('signin')
          return
        }
        toast.error(errMessage(e, 'Could not request the test drive'))
      })
      .finally(() => setSending(false))
  }

  if (doneRef) {
    return (
      <SuccessPanel refCode={doneRef} title="Test drive requested" body="The showroom will confirm your appointment. Track it under Account → Test drives.">
        <Button onClick={() => navigate('account?tab=testdrives')}>Track my test drives</Button>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
      </SuccessPanel>
    )
  }

  return (
    <>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="td-date">Date</Label>
            <input
              id="td-date"
              type="date"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={date}
              min={todayIso}
              max={days[days.length - 1].value}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="td-time">Time (EAT)</Label>
            <Select value={validTimes.includes(time) ? time : validTimes[0] ?? ''} onValueChange={setTime}>
              <SelectTrigger id="td-time"><SelectValue placeholder="Choose a time" /></SelectTrigger>
              <SelectContent>
                {validTimes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="td-notes">Notes for the showroom (optional)</Label>
          <Textarea id="td-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Would like to inspect service history too." />
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox className="mt-0.5" checked={licence} onCheckedChange={(c) => setLicence(c === true)} />
          <span>I hold a valid driving licence for this vehicle class</span>
        </label>
      </div>
      <DialogFooter>
        <Button variant="ghost" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button className="h-11 px-5" onClick={submit} disabled={sending || !licence || validTimes.length === 0}>
          {sending ? <Sending label="Requesting…" /> : <><ClipboardList className="h-4 w-4" /> Request test drive</>}
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────────────────────────── ReviewDialog ───────────────────────────

export function ReviewDialog({
  open, onOpenChange, org, onSubmitted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  org: { id: string; name: string }
  onSubmitted: (review: StorefrontReview) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /> Review {org.name}
          </DialogTitle>
          <DialogDescription>
            Reviews are earned: post after a completed engagement with this business — a booked service for garages, a completed test drive for showrooms. Be honest and specific.
          </DialogDescription>
        </DialogHeader>
        <ReviewForm onOpenChange={onOpenChange} org={org} onSubmitted={onSubmitted} />
      </DialogContent>
    </Dialog>
  )
}

function ReviewForm({
  onOpenChange, org, onSubmitted,
}: {
  onOpenChange: (open: boolean) => void
  org: { id: string; name: string }
  onSubmitted: (review: StorefrontReview) => void
}) {
  const guard = useSubmitGuard()
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)

  function submit() {
    if (rating < 1) { toast.error('Tap to choose a star rating'); return }
    if (!guard()) return
    setSending(true)
    apiSend<{ review: { id: string; rating: number; comment: string | null; createdAt: string; author: { name: string } } }>('/api/reviews', 'POST', {
      orgId: org.id,
      rating,
      comment: comment.trim() || undefined,
    })
      .then((d) => {
        const r = d.review
        onSubmitted({ id: r.id, rating: r.rating, comment: r.comment, authorName: r.author?.name ?? 'You', createdAt: r.createdAt })
        toast.success('Thanks — your review is live')
        onOpenChange(false)
      })
      .catch((e) => {
        if (isAuthError(e)) {
          toast.info('Sign in to write a review')
          navigate('signin')
          return
        }
        toast.error(errMessage(e, 'Could not submit your review'))
      })
      .finally(() => setSending(false))
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-1.5" role="radiogroup" aria-label="Star rating">
          {[1, 2, 3, 4, 5].map((i) => (
            <motion.button
              key={i}
              type="button"
              role="radio"
              aria-checked={rating === i}
              aria-label={`${i} star${i > 1 ? 's' : ''}`}
              whileTap={{ scale: 0.85 }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setRating(i)}
              className="rounded-md p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Star className={`h-8 w-8 transition-colors ${i <= (hover || rating) ? 'fill-[#c9a45c] text-[#c9a45c]' : 'text-muted-foreground/40'}`} />
            </motion.button>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rv-comment">Your experience (optional)</Label>
          <Textarea
            id="rv-comment"
            rows={4}
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="How was the work, communication and pricing?"
          />
          <p className="text-right text-xs text-muted-foreground">{comment.length}/1000</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button className="h-11 px-5" onClick={submit} disabled={sending || rating < 1}>
          {sending ? <Sending label="Posting…" /> : 'Post review'}
        </Button>
      </DialogFooter>
    </>
  )
}
