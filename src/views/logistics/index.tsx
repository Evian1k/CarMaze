'use client'

/* LogisticsOS — the delivery-partner platform of CARMAZE, plus the
 * requester-side delivery service. One view, four states:
 *
 *   A) Landing / marketing — anon or signed-in without a logistics footprint.
 *      CTAs: "Join our delivery network" (application) and
 *      "Request a delivery" (requester tool for signed-in users).
 *   B) Application — form (POST /api/applications type LOGISTICS) or the
 *      honest status card with timeline + "respond to info request" resubmit.
 *   C) Partner dashboard — Jobs (open board + active lifecycle + history),
 *      Fleet (drivers CRUD), My requests (requester tool), Earnings
 *      (honest records; no fake settlement numbers).
 *   D) Suspended — amber notice with the staff reason and no actions.
 *
 * Every state is driven by live API data. Verification is only ever rendered
 * as the API reports it; errors surface verbatim.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Truck, MapPin, PackageCheck, Package, PackageOpen, Users, Wallet, Plus, RefreshCw,
  Phone, ClipboardList, CircleAlert, ShieldCheck, FileUp, Trash2, Power, ArrowRight,
  ArrowLeft, CheckCircle2, XCircle, Loader2, Bike, Wrench, Building2, Handshake, ScanLine,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import QRCode from 'qrcode'
import { apiGet, apiSend, apiUpload, navigate } from '@/lib/client'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useAuth, type CurrentUser } from '@/stores/auth'
import { KENYA_COUNTIES, money, timeAgo, dateLabel } from '@/lib/format'
import { cn } from '@/lib/utils'

/* ─────────────────────────────── types ─────────────────────────────── */

type PartnerSelf = {
  id: string
  refCode: string
  name: string
  partnerType: string
  county: string
  town: string | null
  status: string
  verified: boolean
  capabilities: string[]
  serviceAreas: string[]
  decisionNote: string | null
  createdAt: string
}

type JobEvent = { id: string; type: string; actorName: string; actorSide: string; note: string | null; createdAt: string }

type Job = {
  id: string
  refCode: string
  status: string
  cargoDesc: string
  sizeClass: string
  pickupCounty: string
  pickupAddress: string
  pickupContactName: string
  pickupContactPhone: string
  dropCounty: string
  dropAddress: string
  dropContactName: string
  dropContactPhone: string
  requesterOrgName: string | null
  feeMinor: number
  failReason: string | null
  pickupAt: string | null
  deliveredAt: string | null
  createdAt: string
  updatedAt: string
  partner?: { id: string; name: string; county: string; phone: string } | null
  driver?: { id: string; name: string; phone: string; vehicleReg: string | null; vehicleType: string | null } | null
  otpHint?: string | null
  qrToken?: string | null
  podPhotos?: string[]
  events?: JobEvent[]
}

type Driver = {
  id: string
  name: string
  phone: string
  licenseNo: string | null
  vehicleReg: string | null
  vehicleType: string | null
  status: string
  activeJobs: number
  createdAt: string
}

type AppEvent = { id: string; type: string; actorName?: string | null; note?: string | null; createdAt: string }

type LogisticsApplication = {
  id: string
  refCode: string
  type: string
  orgName: string
  status: string
  county: string
  town?: string | null
  phone: string
  email?: string | null
  representative: string
  accountType?: string | null
  categories?: string | null
  documents?: string | null
  notes?: string | null
  decisionNote?: string | null
  submittedAt?: string | null
  events: AppEvent[]
  createdAt: string
  updatedAt: string
}

type UploadedDoc = { name: string; url: string }

/* ───────────────────────────── constants ───────────────────────────── */

const CAPABILITIES = [
  { value: 'PARCELS', label: 'Parcels & documents' },
  { value: 'VEHICLES', label: 'Vehicle delivery (driveaway / transporter)' },
  { value: 'TOWING', label: 'Towing & recovery' },
  { value: 'PARTS', label: 'Auto parts runs' },
] as const

const SIZE_LABEL: Record<string, string> = {
  SMALL: 'Small — parcels, documents',
  MEDIUM: 'Medium — parts, boxes',
  LARGE: 'Large — vehicle or bulky cargo',
}

const VEHICLE_TYPES = [
  { value: 'MOTORBIKE', label: 'Motorbike' },
  { value: 'PICKUP', label: 'Pickup' },
  { value: 'VAN', label: 'Van' },
  { value: 'TRUCK', label: 'Truck' },
  { value: 'TOW_TRUCK', label: 'Tow truck' },
] as const

const REVIEWABLE = ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'RESUBMITTED']

const TABS = ['jobs', 'fleet', 'requests', 'earnings'] as const
type TabKey = (typeof TABS)[number]

/* ───────────────────────────── helpers ───────────────────────────── */

function feeLabel(minor: number): string {
  return money(minor)
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'OPEN':
      return 'border-transparent bg-muted text-muted-foreground'
    case 'ASSIGNED':
      return 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400'
    case 'PICKED_UP':
      return 'border-transparent bg-accent/15 text-accent-foreground'
    case 'IN_TRANSIT':
      return 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400'
    case 'DELIVERED':
      return 'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
    case 'FAILED':
      return 'border-transparent bg-red-500/15 text-red-700 dark:text-red-400'
    case 'CANCELLED':
      return 'border-transparent bg-muted text-muted-foreground'
    default:
      return 'border-transparent bg-muted text-muted-foreground'
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn('gap-1 text-[11px] font-semibold', statusBadgeClass(status))}>
      {status === 'IN_TRANSIT' && <Truck className="h-3 w-3" aria-hidden="true" />}
      {status === 'DELIVERED' && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
      {status === 'FAILED' && <XCircle className="h-3 w-3" aria-hidden="true" />}
      {status.replaceAll('_', ' ')}
    </Badge>
  )
}

/** Requester-side drop-off QR: encodes the job's QR token. The partner can
 * confirm delivery by scanning it or typing the token — an alternative to the
 * 6-digit code. Rendered on demand (generated locally, no external service). */
function DropOffQr({ token }: { token: string }) {
  const [open, setOpen] = useState(false)
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!open || dataUrl) return
    QRCode.toDataURL(token, { width: 160, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(null))
  }, [open, dataUrl, token])

  return (
    <div>
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ScanLine className="mr-1.5 h-4 w-4" aria-hidden="true" /> {open ? 'Hide QR' : 'Show drop-off QR'}
      </Button>
      {open && (
        <div className="mt-2 inline-flex flex-col items-center gap-1.5 rounded-lg border bg-background p-3">
          {dataUrl ? (
             
            <img src={dataUrl} alt={`Drop-off QR code, token ${token}`} className="h-40 w-40" />
          ) : (
            <Skeleton className="h-40 w-40" />
          )}
          <p className="font-mono text-xs font-semibold tracking-wide">{token}</p>
          <p className="max-w-48 text-center text-[11px] text-muted-foreground">
            The partner scans or types this token to confirm delivery — it works instead of the 6-digit code.
          </p>
        </div>
      )}
    </div>
  )
}

function RouteLine({ from, to }: { from: string; to: string }) {
  return (
    <p className="flex items-center gap-1.5 text-sm font-medium">
      <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{from}</span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{to}</span>
    </p>
  )
}

function JobTimeline({ events }: { events: JobEvent[] }) {
  if (!events.length) return null
  return (
    <ol className="mt-2 space-y-2 border-l border-border pl-3.5">
      {events.map((e) => (
        <li key={e.id} className="relative text-xs text-muted-foreground">
          <span className="absolute -left-[18.5px] top-1 h-2 w-2 rounded-full bg-border" aria-hidden="true" />
          <span className="font-medium text-foreground">{e.type.replaceAll('_', ' ')}</span>
          {' · '}{timeAgo(e.createdAt)} · {e.actorName}
          {e.note && <span className="block">{e.note}</span>}
        </li>
      ))}
    </ol>
  )
}

function EmptyState({ icon: Icon, title, hint, action }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
      <Icon className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Spin({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </span>
  )
}

/** URL-bound fetch hook with manual reload — mirrors the data flow used by
 * the other dashboard views (plain state + useEffect, no extra deps).
 * All setState calls happen in async continuations, never synchronously
 * inside the effect body. */
function useApiData<T>(url: string | null): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(url))
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    const run = async () => {
      try {
        const d = await apiGet<T>(url)
        if (cancelled) return
        setData(d)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Request failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [url, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  // Derived reset when unmounted/disabled — no synchronous setState in effects.
  return { data: url ? data : null, error: url ? error : null, loading, reload }
}

/* ───────────────────────── upload atoms ───────────────────────── */

function DocUploader({ docs, onChange, max = 8 }: {
  docs: UploadedDoc[]
  onChange: (docs: UploadedDoc[]) => void
  max?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const room = max - docs.length
    if (room <= 0) {
      toast.error(`Up to ${max} documents`)
      return
    }
    setUploading(true)
    for (const file of Array.from(files).slice(0, room)) {
      const fd = new FormData()
      fd.set('file', file)
      try {
        const res = await apiUpload<{ url: string; name: string }>('/api/upload', fd)
        onChange([...docs, { name: file.name, url: res.url }])
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not upload ${file.name}`)
      }
    }
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-2">
      <label
        className={cn(
          'flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-4 text-center transition-colors hover:bg-muted/50',
          uploading && 'pointer-events-none opacity-60'
        )}
      >
        {uploading ? <Spin label="Uploading…" /> : (
          <>
            <FileUp className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-medium">Upload documents</span>
            <span className="text-xs text-muted-foreground">JPG, PNG, WebP or PDF · max 8 MB each · {docs.length}/{max} uploaded</span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
          aria-label="Upload supporting documents"
        />
      </label>
      {docs.length > 0 && (
        <ul className="space-y-1.5">
          {docs.map((d, i) => (
            <li key={`${d.url}-${i}`} className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm">
              <span className="truncate">{d.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={`Remove ${d.name}`}
                onClick={() => onChange(docs.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PhotoUploader({ photos, onChange, max = 6 }: {
  photos: string[]
  onChange: (urls: string[]) => void
  max?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const room = max - photos.length
    if (room <= 0) {
      toast.error(`Up to ${max} photos`)
      return
    }
    setUploading(true)
    for (const file of Array.from(files).slice(0, room)) {
      const fd = new FormData()
      fd.set('file', file)
      try {
        const res = await apiUpload<{ url: string }>('/api/upload', fd)
        onChange([...photos, res.url])
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not upload ${file.name}`)
      }
    }
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={cn(
            'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 text-sm font-medium transition-colors hover:bg-muted/50',
            uploading && 'pointer-events-none opacity-60'
          )}
        >
          {uploading ? <Spin label="Uploading…" /> : (<><FileUp className="h-4 w-4" aria-hidden="true" /> Add photo evidence</>)}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
            aria-label="Upload proof-of-delivery photos"
          />
        </label>
        <span className="text-xs text-muted-foreground">{photos.length}/{max} · required for delivery confirmation</span>
      </div>
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((url, i) => (
            <div key={`${url}-${i}`} className="group relative h-16 w-16 overflow-hidden rounded-md border">
              { }
              <img src={url} alt={`Proof of delivery ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                className="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                onClick={() => onChange(photos.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════ STATE A — landing ═══════════════════════════ */

function Landing({ signedIn, onJoin, onRequest }: {
  signedIn: boolean
  onJoin: () => void
  onRequest: () => void
}) {
  const audience = [
    { icon: Wrench, title: 'Garages', text: 'Collect parts from suppliers and return customer vehicles after service.' },
    { icon: Building2, title: 'Showrooms & dealers', text: 'Move vehicles between branches, auctions and buyers — driveaway or transporter.' },
    { icon: Package, title: 'Suppliers & parts shops', text: 'Same-day parts runs to workshops and retail customers.' },
    { icon: Users, title: 'Individual customers', text: 'Parcels, documents and bulky automotive cargo across counties.' },
  ]
  const requirements = [
    'National ID or passport of the owner / authorised representative',
    'Business registration certificate (companies — independents may skip)',
    'Vehicle registration documents for every delivery vehicle',
    'Valid insurance certificate where applicable',
  ]

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      {/* hero */}
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Truck className="h-9 w-9" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">CARMAZE Logistics Network</h1>
        <p className="mx-auto mt-3 max-w-2xl text-balance text-sm text-muted-foreground sm:text-base">
          Verified delivery partners move vehicles, parts and parcels between garages, showrooms, suppliers
          and customers across Kenya — with proof of pickup, live status and drop-off verification on every job.
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" onClick={onJoin} className="min-h-11 w-full sm:w-auto">
            <Handshake className="mr-2 h-4 w-4" aria-hidden="true" />
            Join our delivery network
          </Button>
          <Button size="lg" variant="outline" onClick={onRequest} className="min-h-11 w-full sm:w-auto">
            {signedIn ? 'Request a delivery' : 'Sign in to request'}
          </Button>
        </div>
        {!signedIn && (
          <p className="mt-3 text-xs text-muted-foreground">
            Partner applications are tied to a free CARMAZE account — you will be asked to sign in or register first.
          </p>
        )}
      </div>

      {/* what partners do */}
      <section aria-labelledby="what-partners-do" className="mt-14">
        <h2 id="what-partners-do" className="text-center text-xl font-semibold">What our delivery partners do</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {audience.map((a) => (
            <Card key={a.title} className="p-0">
              <CardContent className="p-5">
                <a.icon className="h-6 w-6 text-primary" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold">{a.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* verification honesty */}
      <section aria-labelledby="verification" className="mx-auto mt-12 max-w-3xl">
        <Card className="p-0">
          <CardContent className="p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h2 id="verification" className="text-lg font-semibold">Verification is earned, not claimed</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Verification is granted by our review team after document checks — never automatic, never
                  self-claimed. Every application is reviewed by a human, and partners can only accept
                  deliveries once approved. Suspended or non-approved accounts cannot act on the platform.
                </p>
                <h3 className="mt-5 text-sm font-semibold">What you will need to apply</h3>
                <ul className="mt-2 space-y-1.5">
                  {requirements.map((r) => (
                    <li key={r} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      {r}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-muted-foreground">
                  Applying is free. CARMAZE does not charge for applications, and no payment is collected
                  inside the app for delivery fees at this stage.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

/* ═════════════════════ STATE B — application form ═════════════════════ */

function ApplyForm({ onSubmitted, onBack }: { onSubmitted: () => void; onBack: () => void }) {
  const [name, setName] = useState('')
  const [partnerType, setPartnerType] = useState<'COMPANY' | 'INDEPENDENT'>('COMPANY')
  const [regNo, setRegNo] = useState('')
  const [county, setCounty] = useState('')
  const [town, setTown] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [representative, setRepresentative] = useState('')
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [serviceAreas, setServiceAreas] = useState<string[]>([])
  const [documents, setDocuments] = useState<UploadedDoc[]>([])
  const [notes, setNotes] = useState('')
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function toggle(list: string[], value: string, set: (v: string[]) => void) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  async function submit() {
    const problem =
      name.trim().length < 2 ? 'Enter the business or operator name.'
      : !county ? 'Select your base county.'
      : phone.trim().length < 9 ? 'Enter a reachable phone number.'
      : representative.trim().length < 2 ? 'Enter the authorised representative name.'
      : partnerType === 'COMPANY' && regNo.trim().length < 1 ? 'Enter the business registration number.'
      : capabilities.length === 0 ? 'Select at least one capability.'
      : documents.length === 0 ? 'Upload at least one document (ID, registration, vehicle or insurance) — review is manual.'
      : !consent ? 'Confirm the declaration to submit.'
      : null
    if (problem) {
      toast.error(problem)
      return
    }
    setSubmitting(true)
    try {
      // The unified applications API carries the counties the partner serves
      // inside the reviewer notes (it has no dedicated serviceAreas column).
      const composedNotes = [
        serviceAreas.length > 0 ? `Service areas: ${serviceAreas.join(', ')}` : '',
        notes.trim(),
      ].filter(Boolean).join('\n')
      await apiSend<{ application: { refCode: string } }>('/api/applications', 'POST', {
        type: 'LOGISTICS',
        status: 'SUBMITTED',
        orgName: name.trim(),
        accountType: partnerType,
        regNo: regNo.trim() || undefined,
        county,
        town: town.trim() || undefined,
        phone: phone.trim(),
        email: email.trim() || undefined,
        representative: representative.trim(),
        categories: capabilities.join(','),
        documents,
        consent: true,
        notes: composedNotes || undefined,
      })
      toast.success('Application submitted — our review team will check your documents.')
      onSubmitted()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not submit the application.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-4">
        <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" /> Back
      </Button>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Truck className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Join the CARMAZE delivery network</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tell us about your operation and upload your documents. Every application is reviewed by
            hand — approval is never automatic and never self-claimed.
          </p>
        </div>
      </div>

      <Card className="mt-6 p-0">
        <CardContent className="space-y-6 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={partnerType === 'COMPANY' ? 'Business name' : 'Operator / business name'}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rift Valley Movers" maxLength={120} />
            </Field>
            <Field label="Account type">
              <RadioGroup value={partnerType} onValueChange={(v) => setPartnerType(v as 'COMPANY' | 'INDEPENDENT')} className="flex gap-4 pt-1">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="COMPANY" id="ptype-company" />
                  <Label htmlFor="ptype-company" className="font-normal">Company</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="INDEPENDENT" id="ptype-independent" />
                  <Label htmlFor="ptype-independent" className="font-normal">Independent driver</Label>
                </div>
              </RadioGroup>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {partnerType === 'COMPANY' && (
              <Field label="Registration number">
                <Input value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="e.g. PVT-XYZ890" maxLength={60} />
              </Field>
            )}
            <Field label="Base county">
              <Select value={county} onValueChange={setCounty}>
                <SelectTrigger aria-label="Base county"><SelectValue placeholder="Select county" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Town / area">
              <Input value={town} onChange={(e) => setTown(e.target.value)} placeholder="e.g. Industrial Area" maxLength={60} />
            </Field>
            <Field label="Phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" inputMode="tel" maxLength={20} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email (optional)">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.co.ke" />
            </Field>
            <Field label="Authorised representative">
              <Input value={representative} onChange={(e) => setRepresentative(e.target.value)} placeholder="Full name" maxLength={80} />
            </Field>
          </div>

          <Field label="What can you deliver?">
            <div className="grid gap-2 sm:grid-cols-2">
              {CAPABILITIES.map((c) => (
                <label key={c.value} className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-card p-3 text-sm transition-colors hover:bg-muted/40 has-[:checked]:border-primary/50">
                  <Checkbox
                    checked={capabilities.includes(c.value)}
                    onCheckedChange={() => toggle(capabilities, c.value, setCapabilities)}
                    className="mt-0.5"
                    aria-label={c.label}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          </Field>

          <Field label="Service areas" hint="Counties you can pick up and drop off in.">
            <div className="flex flex-wrap gap-1.5">
              {KENYA_COUNTIES.map((c) => {
                const active = serviceAreas.includes(c)
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggle(serviceAreas, c, setServiceAreas)}
                    aria-pressed={active}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-9',
                      active ? 'border-primary/60 bg-primary/10 text-primary' : 'bg-card text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {c}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label="Supporting documents" hint="ID of the representative, business registration (companies), vehicle registration documents, insurance where applicable.">
            <DocUploader docs={documents} onChange={setDocuments} />
          </Field>

          <Field label="Anything else we should know? (optional)">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} placeholder="Fleet size, years operating, special equipment (flatbed, tow rig)…" />
          </Field>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-muted/20 p-4 text-sm">
            <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" aria-label="Consent to terms and privacy notice" />
            <span className="text-muted-foreground">
              I confirm the information and documents provided are true and belong to my operation, and I
              accept the CARMAZE terms and privacy notice. I understand verification is decided by the
              review team after document checks.
            </span>
          </label>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onBack} disabled={submitting}>Cancel</Button>
            <Button onClick={submit} disabled={submitting} className="min-h-11">
              {submitting ? <Spin label="Submitting…" /> : <><ClipboardList className="mr-2 h-4 w-4" aria-hidden="true" /> Submit application</>}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* ═══════════ STATE B — application status card (+ resubmit) ═══════════ */

const STATUS_BADGE: Record<string, string> = {
  SUBMITTED: 'border-transparent bg-muted text-muted-foreground',
  UNDER_REVIEW: 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400',
  MORE_INFO_REQUIRED: 'border-transparent bg-red-500/15 text-red-700 dark:text-red-400',
  RESUBMITTED: 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400',
  APPROVED: 'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  REJECTED: 'border-transparent bg-red-500/15 text-red-700 dark:text-red-400',
}

function ApplicationStatusCard({ app, onChanged }: { app: LogisticsApplication; onChanged: () => void }) {
  const [resubmitOpen, setResubmitOpen] = useState(false)
  const infoRequest = [...app.events].reverse().find((e) => e.type === 'INFO_REQUESTED')

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Truck className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Delivery partner application</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ref <span className="font-medium text-foreground">{app.refCode}</span> · {app.orgName}
            {app.submittedAt ? ` · submitted ${dateLabel(app.submittedAt)}` : ''}
          </p>
        </div>
      </div>

      <Card className="mt-6 p-0">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn('text-xs font-semibold', STATUS_BADGE[app.status] ?? '')}>
              {app.status.replaceAll('_', ' ')}
            </Badge>
            {app.accountType && <Badge variant="secondary" className="text-xs">{app.accountType}</Badge>}
            {app.county && <Badge variant="outline" className="text-xs">{app.county}</Badge>}
          </div>

          <p className="text-sm text-muted-foreground">
            Verification is performed by our review team after document checks — it is never automatic and
            never self-claimed. We will notify you here the moment a decision is made.
          </p>

          {app.status === 'MORE_INFO_REQUIRED' && (
            <Alert variant="destructive">
              <CircleAlert className="h-4 w-4" />
              <AlertTitle>The review team needs more information</AlertTitle>
              <AlertDescription>
                {infoRequest?.note || 'Please provide the requested details.'}
                <div className="mt-3">
                  <Button size="sm" onClick={() => setResubmitOpen(true)}>Respond &amp; resubmit</Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div>
            <h2 className="text-sm font-semibold">Timeline</h2>
            {app.events.length === 0
              ? <p className="mt-1 text-xs text-muted-foreground">No events recorded yet.</p>
              : <JobTimeline events={app.events.map((e) => ({ id: e.id, type: e.type, actorName: e.actorName ?? 'CARMAZE', actorSide: 'STAFF', note: e.note ?? null, createdAt: e.createdAt }))} />}
          </div>
        </CardContent>
      </Card>

      <ResubmitDialog
        app={app}
        open={resubmitOpen}
        onOpenChange={setResubmitOpen}
        onDone={() => { setResubmitOpen(false); onChanged() }}
      />
    </div>
  )
}

function ResubmitDialog({ app, open, onOpenChange, onDone }: {
  app: LogisticsApplication
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const [docs, setDocs] = useState<UploadedDoc[]>([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      // keep previously uploaded documents and let the applicant add more
      let existing: UploadedDoc[] = []
      try { existing = app.documents ? JSON.parse(app.documents) : [] } catch { existing = [] }
      setDocs(Array.isArray(existing) ? existing.filter((d) => d && d.url) : [])
      setNotes('')
    }
  }, [open, app.documents])

  async function submit() {
    setBusy(true)
    try {
      await apiSend(`/api/applications/${app.id}`, 'PATCH', {
        action: 'resubmit',
        documents: docs,
        notes: notes.trim() || undefined,
      })
      toast.success('Response submitted — review continues.')
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not resubmit.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Respond to the information request</DialogTitle>
          <DialogDescription>
            Add the requested documents or an explanation. Your original documents are kept and sent
            back to the review team together with this response.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <DocUploader docs={docs} onChange={setDocs} />
          <Field label="Message to the reviewer (optional)">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} placeholder="What you have added or clarified…" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || docs.length === 0}>
            {busy ? <Spin label="Submitting…" /> : 'Resubmit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ═══════════════════════ STATE D — suspended notice ═══════════════════════ */

function SuspendedNotice({ partner }: { partner: PartnerSelf }) {
  const suspended = partner.status === 'SUSPENDED'
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-16">
      <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
        <CircleAlert className="h-4 w-4" />
        <AlertTitle>
          {suspended ? `${partner.name} is suspended` : `${partner.name} is not active (${partner.status.replaceAll('_', ' ')})`}
        </AlertTitle>
        <AlertDescription className="text-amber-900/80 dark:text-amber-200/80">
          {suspended
            ? 'Your delivery partner account has been suspended by CARMAZE staff — you cannot accept deliveries or manage your fleet while suspended.'
            : 'Your delivery partner account is not active — you cannot accept deliveries or manage your fleet until the review team reactivates it.'}
          {partner.decisionNote && <span className="mt-2 block font-medium">Reason: {partner.decisionNote}</span>}
          <span className="mt-2 block">
            Contact CARMAZE support to resolve this. Your account data and history are safe.
          </span>
        </AlertDescription>
      </Alert>
      <p className="mt-4 text-center text-xs text-muted-foreground">Partner ref {partner.refCode}</p>
    </div>
  )
}

/* ═══════════════════ STATE C — partner dashboard (tabs) ═══════════════════ */

function PartnerDashboard({ partner, onRefresh }: { partner: PartnerSelf; onRefresh: () => void }) {
  const route = useHashRoute()
  const tabParam = route.query.get('tab')
  const tab: TabKey = TABS.includes(tabParam as TabKey) ? (tabParam as TabKey) : 'jobs'
  const goTab = (t: string) => navigate(`/logistics?tab=${t}`, { replace: true })

  const partnerJobs = useApiData<{ jobs: Job[] }>(`/api/logistics/jobs?scope=partner`)
  const fleet = useApiData<{ drivers: Driver[] }>('/api/logistics/fleet')

  return (
    <div className="mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">LogisticsOS</h1>
            {partner.verified && (
              <Badge variant="secondary" className="gap-1 border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verified partner
              </Badge>
            )}
            <Badge variant="outline" className="gap-1 text-[11px] text-muted-foreground">
              <Truck className="h-3 w-3" aria-hidden="true" /> Logistics Network
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {partner.name} · {[partner.town, partner.county].filter(Boolean).join(', ')} · ref {partner.refCode}
            {partner.capabilities.length > 0 && ` · ${partner.capabilities.join(' · ')}`}
          </p>
        </div>
        <Button variant="outline" size="icon" className="h-10 w-10" aria-label="Refresh data" onClick={() => { partnerJobs.reload(); fleet.reload(); onRefresh() }}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <Tabs value={tab} onValueChange={goTab} className="mt-6">
        <TabsList className="scrollbar-thin h-auto w-full justify-start overflow-x-auto py-0.5">
          <TabsTrigger value="jobs" className="gap-1.5"><Package className="h-4 w-4" aria-hidden="true" /> Jobs</TabsTrigger>
          <TabsTrigger value="fleet" className="gap-1.5"><Users className="h-4 w-4" aria-hidden="true" /> Fleet</TabsTrigger>
          <TabsTrigger value="requests" className="gap-1.5"><ClipboardList className="h-4 w-4" aria-hidden="true" /> My requests</TabsTrigger>
          <TabsTrigger value="earnings" className="gap-1.5"><Wallet className="h-4 w-4" aria-hidden="true" /> Earnings</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="mt-4">
          <JobsTab
            partnerJobs={partnerJobs}
            fleet={fleet}
            goFleet={() => goTab('fleet')}
          />
        </TabsContent>
        <TabsContent value="fleet" className="mt-4">
          <FleetTab fleet={fleet} />
        </TabsContent>
        <TabsContent value="requests" className="mt-4">
          <MyRequestsSection />
        </TabsContent>
        <TabsContent value="earnings" className="mt-4">
          <EarningsTab jobs={partnerJobs.data?.jobs ?? null} loading={partnerJobs.loading} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* ───────────────────────── Jobs tab ───────────────────────── */

function JobsTab({ partnerJobs, fleet, goFleet }: {
  partnerJobs: { data: { jobs: Job[] } | null; loading: boolean; error: string | null; reload: () => void }
  fleet: { data: { drivers: Driver[] } | null; loading: boolean; error: string | null; reload: () => void }
  goFleet: () => void
}) {
  const open = useApiData<{ jobs: Job[] }>('/api/logistics/jobs?scope=open')

  const jobs = partnerJobs.data?.jobs ?? []
  const openJobs = open.data?.jobs ?? []
  const active = jobs.filter((j) => ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'].includes(j.status))
  const history = jobs.filter((j) => ['DELIVERED', 'FAILED', 'CANCELLED'].includes(j.status))
  const activeDrivers = (fleet.data?.drivers ?? []).filter((d) => d.status === 'ACTIVE')

  const [acceptJob, setAcceptJob] = useState<Job | null>(null)
  const [deliverJob, setDeliverJob] = useState<Job | null>(null)
  const [failJob, setFailJob] = useState<Job | null>(null)

  function refreshAll() {
    open.reload()
    partnerJobs.reload()
    fleet.reload()
  }

  async function quickAction(job: Job, action: 'pickup' | 'transit') {
    try {
      await apiSend(`/api/logistics/jobs/${job.id}`, 'POST', { action })
      toast.success(action === 'pickup' ? `Delivery ${job.refCode} marked as picked up.` : `Delivery ${job.refCode} marked in transit.`)
      partnerJobs.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed.')
    }
  }

  return (
    <div className="space-y-8">
      {/* ── open requests board ── */}
      <section aria-labelledby="open-requests">
        <div className="flex items-center justify-between gap-2">
          <h2 id="open-requests" className="text-lg font-semibold">Open requests</h2>
          <Button variant="outline" size="sm" onClick={open.reload} aria-label="Refresh open requests">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
        {open.error ? (
          <Alert variant="destructive" className="mt-3">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Could not load the open board</AlertTitle>
            <AlertDescription>{open.error}</AlertDescription>
          </Alert>
        ) : open.loading ? (
          <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
          </div>
        ) : openJobs.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={PackageOpen}
              title="No open requests in your service areas yet"
              hint="New requests from customers and businesses appear here the moment they are created."
            />
          </div>
        ) : (
          <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {openJobs.map((job) => (
              <Card key={job.id} className="flex flex-col p-0">
                <CardContent className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-muted-foreground">{job.refCode}</span>
                    <span className="text-xs text-muted-foreground">{timeAgo(job.createdAt)}</span>
                  </div>
                  <p className="line-clamp-2 text-sm font-medium">{job.cargoDesc}</p>
                  <RouteLine from={job.pickupCounty} to={job.dropCounty} />
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="text-[10px]">{job.sizeClass}</Badge>
                    {job.requesterOrgName && <Badge variant="outline" className="text-[10px]">{job.requesterOrgName}</Badge>}
                  </div>
                  <div className="mt-auto space-y-1 rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground">
                    <p className="flex items-center gap-1.5"><Users className="h-3 w-3 shrink-0" aria-hidden="true" /> Pickup: {job.pickupContactName} · {job.pickupContactPhone}</p>
                    <p className="flex items-center gap-1.5"><MapPin className="h-3 w-3 shrink-0" aria-hidden="true" /> Drop: {job.dropContactName} · {job.dropContactPhone}</p>
                  </div>
                  <Button className="min-h-10" onClick={() => setAcceptJob(job)}>
                    <PackageCheck className="mr-2 h-4 w-4" aria-hidden="true" /> Accept job
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── active deliveries ── */}
      <section aria-labelledby="active-deliveries">
        <h2 id="active-deliveries" className="text-lg font-semibold">Active deliveries</h2>
        {partnerJobs.loading && !partnerJobs.data ? (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
          </div>
        ) : active.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={Truck}
              title="No active deliveries right now"
              hint="Accept an open request to start a delivery — you will quote the fee and assign one of your drivers."
            />
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            {active.map((job) => (
              <Card key={job.id} className="p-0">
                <CardContent className="space-y-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-muted-foreground">{job.refCode}</span>
                      <StatusBadge status={job.status} />
                      {job.driver && (
                        <Badge variant="outline" className="gap-1 text-[11px]">
                          {vehicleIcon(job.driver.vehicleType)} {job.driver.name}{job.driver.vehicleReg ? ` · ${job.driver.vehicleReg}` : ''}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">accepted {timeAgo(job.updatedAt)}</span>
                  </div>
                  <p className="text-sm font-medium">{job.cargoDesc}</p>
                  <RouteLine from={job.pickupCounty} to={job.dropCounty} />
                  <div className="grid gap-1 rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground sm:grid-cols-2">
                    <p>Pickup: {job.pickupContactName} · {job.pickupContactPhone}</p>
                    <p>Drop: {job.dropContactName} · {job.dropContactPhone}</p>
                    <p className="sm:col-span-2 font-medium text-foreground">Agreed fee: {feeLabel(job.feeMinor)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {job.status === 'ASSIGNED' && (
                      <Button size="sm" className="min-h-10" onClick={() => quickAction(job, 'pickup')}>
                        <PackageCheck className="mr-1.5 h-4 w-4" aria-hidden="true" /> Mark picked up
                      </Button>
                    )}
                    {job.status === 'PICKED_UP' && (
                      <Button size="sm" className="min-h-10" onClick={() => quickAction(job, 'transit')}>
                        <Truck className="mr-1.5 h-4 w-4" aria-hidden="true" /> Start transit
                      </Button>
                    )}
                    {job.status === 'IN_TRANSIT' && (
                      <Button size="sm" className="min-h-10" onClick={() => setDeliverJob(job)}>
                        <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Confirm delivery
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="min-h-10" onClick={() => setFailJob(job)}>
                      <XCircle className="mr-1.5 h-4 w-4" aria-hidden="true" /> Report failure
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── history ── */}
      <section aria-labelledby="job-history">
        <h2 id="job-history" className="text-lg font-semibold">History</h2>
        {history.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon={ClipboardList} title="No completed deliveries yet" hint="Delivered, failed and cancelled jobs appear here as honest records." />
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {history.map((job) => (
              <Card key={job.id} className="p-0">
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3.5">
                  <span className="font-mono text-xs font-semibold text-muted-foreground">{job.refCode}</span>
                  <StatusBadge status={job.status} />
                  <span className="min-w-0 flex-1 truncate text-sm">{job.cargoDesc}</span>
                  <RouteLine from={job.pickupCounty} to={job.dropCounty} />
                  <span className="text-xs font-medium">{feeLabel(job.feeMinor)}</span>
                  {job.status === 'DELIVERED' && <span className="text-xs text-muted-foreground">delivered {timeAgo(job.deliveredAt ?? job.updatedAt)}</span>}
                  {job.status === 'FAILED' && job.failReason && <span className="w-full text-xs text-muted-foreground">Reason: {job.failReason}</span>}
                  {(job.podPhotos?.length ?? 0) > 0 && (
                    <span className="text-xs text-muted-foreground">{job.podPhotos?.length} proof photo{(job.podPhotos?.length ?? 0) === 1 ? '' : 's'}</span>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* dialogs */}
      <AcceptJobDialog
        job={acceptJob}
        drivers={activeDrivers}
        onClose={() => setAcceptJob(null)}
        onAccepted={() => { setAcceptJob(null); refreshAll() }}
        goFleet={goFleet}
      />
      <DeliverJobDialog
        job={deliverJob}
        onClose={() => setDeliverJob(null)}
        onDelivered={() => { setDeliverJob(null); partnerJobs.reload() }}
      />
      <FailJobDialog
        job={failJob}
        onClose={() => setFailJob(null)}
        onFailed={() => { setFailJob(null); partnerJobs.reload() }}
      />
    </div>
  )
}

function vehicleIcon(type: string | null | undefined) {
  if (type === 'MOTORBIKE') return <Bike className="h-3 w-3" aria-hidden="true" />
  if (type === 'TOW_TRUCK') return <Wrench className="h-3 w-3" aria-hidden="true" />
  return <Truck className="h-3 w-3" aria-hidden="true" />
}

/* ── accept dialog ── */

function AcceptJobDialog({ job, drivers, onClose, onAccepted, goFleet }: {
  job: Job | null
  drivers: Driver[]
  onClose: () => void
  onAccepted: () => void
  goFleet: () => void
}) {
  const [driverId, setDriverId] = useState('')
  const [fee, setFee] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (job) {
      setDriverId(drivers.length === 1 ? drivers[0].id : '')
      setFee('')
    }
     
  }, [job])

  const feeMinor = Math.round((parseFloat(fee) || 0) * 100)

  async function confirm() {
    if (!job) return
    if (!driverId) { toast.error('Select the driver who will handle this delivery.'); return }
    if (!feeMinor || feeMinor <= 0) { toast.error('Quote a fee above zero.'); return }
    if (feeMinor > 10_000_000) { toast.error('Fee is above the platform maximum (KES 100,000).'); return }
    setBusy(true)
    try {
      await apiSend(`/api/logistics/jobs/${job.id}`, 'POST', { action: 'accept', driverId, feeMinor })
      toast.success(`Delivery ${job.refCode} accepted — the requester was notified with their drop-off code.`)
      onAccepted()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not accept this job.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(job)} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Accept delivery {job?.refCode}</DialogTitle>
          <DialogDescription>
            Assign one of your ACTIVE drivers and quote your fee. The requester is notified with a
            6-digit drop-off code — you will need it back from them to confirm delivery.
          </DialogDescription>
        </DialogHeader>
        {job && (
          <div className="space-y-4">
            <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-sm">
              <p className="font-medium">{job.cargoDesc}</p>
              <RouteLine from={job.pickupCounty} to={job.dropCounty} />
              <p className="text-xs text-muted-foreground">Pickup: {job.pickupContactName} · {job.pickupContactPhone}</p>
              <p className="text-xs text-muted-foreground">Drop: {job.dropContactName} · {job.dropContactPhone}</p>
            </div>
            {drivers.length === 0 ? (
              <Alert>
                <Users className="h-4 w-4" />
                <AlertTitle>No active drivers</AlertTitle>
                <AlertDescription>
                  Add a driver (or reactivate one) in the Fleet tab before accepting jobs.
                  <div className="mt-3">
                    <Button size="sm" variant="outline" onClick={() => { onClose(); goFleet() }}>Open Fleet</Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <Field label="Driver">
                  <Select value={driverId} onValueChange={setDriverId}>
                    <SelectTrigger aria-label="Assign driver"><SelectValue placeholder="Select driver" /></SelectTrigger>
                    <SelectContent>
                      {drivers.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}{d.vehicleReg ? ` · ${d.vehicleReg}` : ''}{d.vehicleType ? ` (${d.vehicleType.replaceAll('_', ' ')})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Your fee (KES)" hint="The requester sees this as the agreed delivery fee. Max KES 100,000.">
                  <Input
                    value={fee}
                    onChange={(e) => setFee(e.target.value.replace(/[^\d.]/g, ''))}
                    inputMode="decimal"
                    placeholder="e.g. 2500"
                  />
                </Field>
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={confirm} disabled={busy || drivers.length === 0}>
            {busy ? <Spin label="Accepting…" /> : 'Confirm acceptance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── deliver dialog (OTP + POD photos) ── */

function DeliverJobDialog({ job, onClose, onDelivered }: {
  job: Job | null
  onClose: () => void
  onDelivered: () => void
}) {
  const [otp, setOtp] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (job) { setOtp(''); setPhotos([]) }
  }, [job])

  async function confirm() {
    if (!job) return
    if (!/^\d{6}$/.test(otp.trim()) && !/^[A-Z0-9]{12,14}$/.test(otp.trim().toUpperCase())) { toast.error('Enter the 6-digit drop-off code or the requester QR token.'); return }
    if (photos.length === 0) { toast.error('Attach at least one proof-of-delivery photo.'); return }
    setBusy(true)
    try {
      await apiSend(`/api/logistics/jobs/${job.id}`, 'POST', { action: 'deliver', otp: /^[A-Z0-9]{12,14}$/i.test(otp.trim()) ? otp.trim().toUpperCase() : otp.trim(), photos })
      toast.success(`Delivery ${job.refCode} confirmed as delivered.`)
      onDelivered()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not confirm delivery.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(job)} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm delivery {job?.refCode}</DialogTitle>
          <DialogDescription>
            Ask the requester for their 6-digit drop-off code (sent to their CARMAZE notifications when
            you accepted the job). Delivery is only released with the correct code and at least one
            proof photo.
          </DialogDescription>
        </DialogHeader>
        {job && (
          <div className="space-y-4">
            <Field label="Drop-off verification code">
              <Input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="6 digits"
                className="text-center font-mono text-lg tracking-[0.5em]"
                maxLength={6}
                aria-label="6-digit drop-off verification code"
              />
            </Field>
            <Field label="Proof of delivery">
              <PhotoUploader photos={photos} onChange={setPhotos} />
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={confirm} disabled={busy}>
            {busy ? <Spin label="Confirming…" /> : 'Confirm delivery'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── fail dialog ── */

function FailJobDialog({ job, onClose, onFailed }: {
  job: Job | null
  onClose: () => void
  onFailed: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (job) setReason('') }, [job])

  async function confirm() {
    if (!job) return
    if (reason.trim().length < 10) { toast.error('Explain what went wrong (at least 10 characters).'); return }
    setBusy(true)
    try {
      await apiSend(`/api/logistics/jobs/${job.id}`, 'POST', { action: 'fail', reason: reason.trim() })
      toast.success(`Delivery ${job.refCode} reported as failed.`)
      onFailed()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not report the failure.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(job)} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report failure — {job?.refCode}</DialogTitle>
          <DialogDescription>
            The requester is notified with your reason. Use this honestly when the delivery cannot be
            completed — it is recorded on the job timeline.
          </DialogDescription>
        </DialogHeader>
        <Field label="What went wrong?">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="e.g. Cargo was damaged during loading and the requester refused handover." />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? <Spin label="Reporting…" /> : 'Report failure'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ───────────────────────── Fleet tab ───────────────────────── */

function FleetTab({ fleet }: {
  fleet: { data: { drivers: Driver[] } | null; loading: boolean; error: string | null; reload: () => void }
}) {
  const [addOpen, setAddOpen] = useState(false)
  const drivers = fleet.data?.drivers ?? []

  async function toggleStatus(d: Driver) {
    try {
      await apiSend(`/api/logistics/fleet/${d.id}`, 'PATCH', { status: d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })
      toast.success(`${d.name} is now ${d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}.`)
      fleet.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the driver.')
    }
  }

  async function remove(d: Driver) {
    try {
      await apiSend(`/api/logistics/fleet/${d.id}`, 'DELETE')
      toast.success(`${d.name} removed from your fleet.`)
      fleet.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the driver.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Your drivers</h2>
          <p className="text-sm text-muted-foreground">Only ACTIVE drivers can be assigned when you accept a job.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="min-h-10">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add driver
        </Button>
      </div>

      {fleet.error ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>Could not load your fleet</AlertTitle>
          <AlertDescription>{fleet.error}</AlertDescription>
        </Alert>
      ) : fleet.loading && !fleet.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      ) : drivers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No drivers yet"
          hint="Add your first driver to start accepting deliveries. Vehicle details help requesters trust your operation."
          action={<Button onClick={() => setAddOpen(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add driver</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {drivers.map((d) => (
            <Card key={d.id} className="p-0">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{d.name}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" aria-hidden="true" /> {d.phone}</p>
                  </div>
                  <Badge variant="outline" className={cn('text-[10px] font-semibold', d.status === 'ACTIVE'
                    ? 'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : 'border-transparent bg-muted text-muted-foreground')}>
                    {d.status}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  {d.vehicleType && <Badge variant="secondary" className="gap-1 text-[10px]">{vehicleIcon(d.vehicleType)} {d.vehicleType.replaceAll('_', ' ')}</Badge>}
                  {d.vehicleReg && <Badge variant="secondary" className="text-[10px]">{d.vehicleReg}</Badge>}
                  {d.licenseNo && <span className="self-center">Licence {d.licenseNo}</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {d.activeJobs > 0 ? `Carrying ${d.activeJobs} active deliver${d.activeJobs === 1 ? 'y' : 'ies'}` : 'No active deliveries'}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="min-h-9 flex-1" onClick={() => toggleStatus(d)}>
                    <Power className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {d.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="min-h-9 text-destructive hover:text-destructive" aria-label={`Delete ${d.name}`}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove {d.name} from your fleet?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently deletes the driver record. Drivers carrying active
                          deliveries cannot be deleted — mark them inactive instead.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(d)} className="bg-destructive text-white hover:bg-destructive/90">Delete driver</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddDriverDialog open={addOpen} onOpenChange={setAddOpen} onAdded={() => { setAddOpen(false); fleet.reload() }} />
    </div>
  )
}

function AddDriverDialog({ open, onOpenChange, onAdded }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onAdded: () => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [licenseNo, setLicenseNo] = useState('')
  const [vehicleReg, setVehicleReg] = useState('')
  const [vehicleType, setVehicleType] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setName(''); setPhone(''); setLicenseNo(''); setVehicleReg(''); setVehicleType('') }
  }, [open])

  async function submit() {
    if (name.trim().length < 2) { toast.error('Enter the driver name.'); return }
    if (phone.trim().length < 9) { toast.error('Enter a reachable phone number.'); return }
    setBusy(true)
    try {
      await apiSend('/api/logistics/fleet', 'POST', {
        name: name.trim(),
        phone: phone.trim(),
        licenseNo: licenseNo.trim() || undefined,
        vehicleReg: vehicleReg.trim() || undefined,
        vehicleType: vehicleType || undefined,
      })
      toast.success(`${name.trim()} added to your fleet.`)
      onAdded()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the driver.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a driver</DialogTitle>
          <DialogDescription>New drivers start ACTIVE and can immediately be assigned to accepted jobs.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Driver name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Full name" />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={20} placeholder="07xx xxx xxx" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Licence number (optional)">
              <Input value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} maxLength={60} />
            </Field>
            <Field label="Vehicle registration (optional)">
              <Input value={vehicleReg} onChange={(e) => setVehicleReg(e.target.value)} maxLength={20} placeholder="e.g. KDA 123A" />
            </Field>
          </div>
          <Field label="Vehicle type (optional)">
            <Select value={vehicleType} onValueChange={setVehicleType}>
              <SelectTrigger aria-label="Vehicle type"><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {VEHICLE_TYPES.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? <Spin label="Adding…" /> : 'Add driver'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ═══════════ Requester tool — create + track my deliveries ═══════════ */

function MyRequestsSection() {
  const mine = useApiData<{ jobs: Job[] }>('/api/logistics/jobs?scope=mine')
  const [createOpen, setCreateOpen] = useState(false)
  const jobs = mine.data?.jobs ?? []

  async function cancel(job: Job) {
    try {
      await apiSend(`/api/logistics/jobs/${job.id}`, 'POST', { action: 'cancel' })
      toast.success(`Delivery ${job.refCode} cancelled.`)
      mine.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not cancel the delivery.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Your delivery requests</h2>
          <p className="text-sm text-muted-foreground">
            Request a pickup and drop-off. A verified partner accepts the job and quotes the fee —
            your drop-off code arrives in your notifications.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" className="h-10 w-10" aria-label="Refresh requests" onClick={mine.reload}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="min-h-10">
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Request a delivery
          </Button>
        </div>
      </div>

      {mine.error ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>Could not load your requests</AlertTitle>
          <AlertDescription>{mine.error}</AlertDescription>
        </Alert>
      ) : mine.loading && !mine.data ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={Package}
          title="You have not requested any deliveries yet"
          hint="Create a request with pickup and drop-off details — verified partners will see it on their board."
          action={<Button onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Request a delivery</Button>}
        />
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => {
            const cancellable = ['OPEN', 'ASSIGNED'].includes(job.status)
            const showOtp = Boolean(job.otpHint) && ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'].includes(job.status)
            return (
              <Card key={job.id} className="p-0">
                <CardContent className="space-y-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-muted-foreground">{job.refCode}</span>
                      <StatusBadge status={job.status} />
                    </div>
                    <div className="flex items-center gap-2">
                      {job.feeMinor > 0 && <span className="text-xs font-semibold">{feeLabel(job.feeMinor)}</span>}
                      {cancellable && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="min-h-9 text-destructive hover:text-destructive">Cancel</Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Cancel delivery {job.refCode}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {job.status === 'ASSIGNED'
                                  ? 'The assigned partner will be notified that you cancelled before pickup.'
                                  : 'The open request will be removed from the partner board.'}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Keep it</AlertDialogCancel>
                              <AlertDialogAction onClick={() => cancel(job)} className="bg-destructive text-white hover:bg-destructive/90">Cancel delivery</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                  <p className="text-sm font-medium">{job.cargoDesc}</p>
                  <RouteLine from={job.pickupCounty} to={job.dropCounty} />
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="text-[10px]">{job.sizeClass}</Badge>
                    {job.requesterOrgName && <span>on behalf of {job.requesterOrgName}</span>}
                    <span>requested {timeAgo(job.createdAt)}</span>
                  </div>

                  {job.partner && (
                    <p className="text-xs text-muted-foreground">
                      Handled by <span className="font-medium text-foreground">{job.partner.name}</span>
                      {job.driver ? ` · driver ${job.driver.name}${job.driver.phone ? ` (${job.driver.phone})` : ''}` : ''}
                    </p>
                  )}

                  {showOtp && (
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs">
                        <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                        <span>
                          Drop-off code <span className="font-mono font-bold text-foreground">••• {job.otpHint}</span> — sent to your notifications. Share it only when you receive the cargo.
                        </span>
                      </div>
                      {job.qrToken && <DropOffQr token={job.qrToken} />}
                    </div>
                  )}

                  {job.status === 'FAILED' && job.failReason && (
                    <Alert variant="destructive">
                      <XCircle className="h-4 w-4" />
                      <AlertTitle>Delivery not completed</AlertTitle>
                      <AlertDescription>{job.failReason}</AlertDescription>
                    </Alert>
                  )}

                  {(job.podPhotos?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Proof of delivery</p>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {job.podPhotos?.map((url, i) => (
                           
                          <img key={`${url}-${i}`} src={url} alt={`Proof of delivery ${i + 1}`} className="h-16 w-16 rounded-md border object-cover" />
                        ))}
                      </div>
                    </div>
                  )}

                  {(job.events?.length ?? 0) > 0 && <JobTimeline events={job.events ?? []} />}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <CreateDeliveryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => { setCreateOpen(false); mine.reload() }}
      />
    </div>
  )
}

function CreateDeliveryDialog({ open, onOpenChange, onCreated }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}) {
  const [cargoDesc, setCargoDesc] = useState('')
  const [sizeClass, setSizeClass] = useState('SMALL')
  const [pickupCounty, setPickupCounty] = useState('')
  const [pickupAddress, setPickupAddress] = useState('')
  const [pickupName, setPickupName] = useState('')
  const [pickupPhone, setPickupPhone] = useState('')
  const [dropCounty, setDropCounty] = useState('')
  const [dropAddress, setDropAddress] = useState('')
  const [dropName, setDropName] = useState('')
  const [dropPhone, setDropPhone] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setCargoDesc(''); setSizeClass('SMALL'); setPickupCounty(''); setPickupAddress('')
      setPickupName(''); setPickupPhone(''); setDropCounty(''); setDropAddress('')
      setDropName(''); setDropPhone('')
    }
  }, [open])

  async function submit() {
    const problem =
      cargoDesc.trim().length < 5 ? 'Describe the cargo (at least 5 characters).'
      : !pickupCounty ? 'Select the pickup county.'
      : pickupAddress.trim().length < 5 ? 'Enter a detailed pickup address.'
      : pickupName.trim().length < 2 ? 'Enter the pickup contact name.'
      : pickupPhone.trim().length < 9 ? 'Enter the pickup contact phone.'
      : !dropCounty ? 'Select the drop-off county.'
      : dropAddress.trim().length < 5 ? 'Enter a detailed drop-off address.'
      : dropName.trim().length < 2 ? 'Enter the drop-off contact name.'
      : dropPhone.trim().length < 9 ? 'Enter the drop-off contact phone.'
      : null
    if (problem) { toast.error(problem); return }
    setBusy(true)
    try {
      const d = await apiSend<{ job: Job }>('/api/logistics/jobs', 'POST', {
        cargoDesc: cargoDesc.trim(),
        sizeClass,
        pickupCounty,
        pickupAddress: pickupAddress.trim(),
        pickupContactName: pickupName.trim(),
        pickupContactPhone: pickupPhone.trim(),
        dropCounty,
        dropAddress: dropAddress.trim(),
        dropContactName: dropName.trim(),
        dropContactPhone: dropPhone.trim(),
      })
      toast.success(`Request ${d.job.refCode} created — partners can now see it on their board.`)
      onCreated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the delivery request.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Request a delivery</DialogTitle>
          <DialogDescription>
            Give the pickup and drop-off details. A verified delivery partner will accept the job and
            quote the fee — you approve nothing extra, the fee is fixed at acceptance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="What is being delivered?">
            <Textarea value={cargoDesc} onChange={(e) => setCargoDesc(e.target.value)} rows={2} maxLength={300} placeholder="e.g. Two sealed gearboxes, approx 40 kg total" />
          </Field>
          <Field label="Size class">
            <Select value={sizeClass} onValueChange={setSizeClass}>
              <SelectTrigger aria-label="Size class"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SIZE_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <div className="rounded-lg border p-4">
            <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Package className="h-4 w-4 text-primary" aria-hidden="true" /> Pickup</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="County">
                <Select value={pickupCounty} onValueChange={setPickupCounty}>
                  <SelectTrigger aria-label="Pickup county"><SelectValue placeholder="Select county" /></SelectTrigger>
                  <SelectContent className="max-h-72">{KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Contact name">
                <Input value={pickupName} onChange={(e) => setPickupName(e.target.value)} maxLength={80} placeholder="Who hands over the cargo?" />
              </Field>
              <Field label="Address">
                <Input value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} maxLength={200} placeholder="Street, building, unit" />
              </Field>
              <Field label="Contact phone">
                <Input value={pickupPhone} onChange={(e) => setPickupPhone(e.target.value)} inputMode="tel" maxLength={20} />
              </Field>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><MapPin className="h-4 w-4 text-primary" aria-hidden="true" /> Drop-off</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="County">
                <Select value={dropCounty} onValueChange={setDropCounty}>
                  <SelectTrigger aria-label="Drop-off county"><SelectValue placeholder="Select county" /></SelectTrigger>
                  <SelectContent className="max-h-72">{KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Contact name">
                <Input value={dropName} onChange={(e) => setDropName(e.target.value)} maxLength={80} placeholder="Who receives the cargo?" />
              </Field>
              <Field label="Address">
                <Input value={dropAddress} onChange={(e) => setDropAddress(e.target.value)} maxLength={200} placeholder="Street, building, unit" />
              </Field>
              <Field label="Contact phone">
                <Input value={dropPhone} onChange={(e) => setDropPhone(e.target.value)} inputMode="tel" maxLength={20} />
              </Field>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spin label="Creating…" /> : 'Create request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ───────────────────────── Earnings tab ───────────────────────── */

function EarningsTab({ jobs, loading }: { jobs: Job[] | null; loading: boolean }) {
  const stats = useMemo(() => {
    const all = jobs ?? []
    const delivered = all.filter((j) => j.status === 'DELIVERED')
    const failed = all.filter((j) => j.status === 'FAILED')
    const active = all.filter((j) => ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'].includes(j.status))
    const completedSum = delivered.reduce((s, j) => s + j.feeMinor, 0)
    const pendingSum = active.reduce((s, j) => s + j.feeMinor, 0)
    return { delivered, failed, active, completedSum, pendingSum }
  }, [jobs])

  if (loading && !jobs) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-0">
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Completed deliveries</p>
            <p className="mt-1 text-2xl font-bold">{stats.delivered.length}</p>
            <p className="text-sm text-muted-foreground">{feeLabel(stats.completedSum)} in agreed fees</p>
          </CardContent>
        </Card>
        <Card className="p-0">
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Active (fees pending)</p>
            <p className="mt-1 text-2xl font-bold">{stats.active.length}</p>
            <p className="text-sm text-muted-foreground">{feeLabel(stats.pendingSum)} quoted on active jobs</p>
          </CardContent>
        </Card>
        <Card className="p-0">
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Failed deliveries</p>
            <p className="mt-1 text-2xl font-bold">{stats.failed.length}</p>
            <p className="text-sm text-muted-foreground">No fees recorded on failed jobs</p>
          </CardContent>
        </Card>
      </div>

      <Alert>
        <Wallet className="h-4 w-4" />
        <AlertTitle>How settlement works</AlertTitle>
        <AlertDescription>
          Settlement with the platform is reconciled by our finance team; in-app payment collection for
          delivery fees is not yet enabled. The figures above are honest records of agreed and completed
          fees — not wallet balances.
        </AlertDescription>
      </Alert>

      {stats.delivered.length === 0 ? (
        <EmptyState icon={Wallet} title="No completed deliveries yet" hint="Once you complete deliveries, each one appears here with its agreed fee." />
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Completed jobs</h3>
          {stats.delivered.map((j) => (
            <Card key={j.id} className="p-0">
              <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1.5 p-3.5">
                <span className="font-mono text-xs font-semibold text-muted-foreground">{j.refCode}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{j.cargoDesc}</span>
                <RouteLine from={j.pickupCounty} to={j.dropCounty} />
                <Badge variant="outline" className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">{feeLabel(j.feeMinor)}</Badge>
                <span className="text-xs text-muted-foreground">{dateLabel(j.deliveredAt ?? j.updatedAt)}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/* ═══════════ signed-in, no partner — landing / apply / request ═══════════ */

function NonPartnerHome({ user, onDataChanged }: { user: CurrentUser; onDataChanged: () => void }) {
  const apps = useApiData<{ applications: LogisticsApplication[] }>('/api/applications')
  const [panel, setPanel] = useState<'landing' | 'apply' | 'request'>('landing')

  const latestApp = useMemo(() => {
    const list = (apps.data?.applications ?? []).filter((a) => a.type === 'LOGISTICS')
    return list[0] ?? null
  }, [apps.data])
  const reviewable = latestApp && REVIEWABLE.includes(latestApp.status)

  if (apps.loading && !apps.data) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-10 sm:px-6">
        <Skeleton className="mx-auto h-16 w-16 rounded-2xl" />
        <Skeleton className="mx-auto h-9 w-80" />
        <Skeleton className="mx-auto h-5 w-96" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    )
  }

  if (reviewable && latestApp) {
    return <ApplicationStatusCard app={latestApp} onChanged={() => { apps.reload(); onDataChanged() }} />
  }

  if (panel === 'apply') {
    return <ApplyForm onSubmitted={() => { apps.reload(); onDataChanged() }} onBack={() => setPanel('landing')} />
  }

  if (panel === 'request') {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => setPanel('landing')}>
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" /> Back
        </Button>
        <MyRequestsSection />
      </div>
    )
  }

  return (
    <div>
      <Landing
        signedIn
        onJoin={() => setPanel('apply')}
        onRequest={() => setPanel('request')}
      />
      {latestApp && ['REJECTED', 'SUSPENDED'].includes(latestApp.status) && (
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <Alert variant="destructive">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Your previous application {latestApp.refCode} was not approved</AlertTitle>
            <AlertDescription>
              {latestApp.decisionNote || 'You can submit a new application at any time.'}
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={() => setPanel('apply')}>Apply again</Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      )}
      <p className="mx-auto w-full max-w-6xl px-4 py-6 text-center text-xs text-muted-foreground sm:px-6">
        Signed in as {user.name} — you can join the network as a delivery partner and still request
        deliveries for your own cargo.
      </p>
    </div>
  )
}

/* ═══════════════════════════ root view ═══════════════════════════ */

export default function View() {
  const { user, loading: authLoading } = useAuth()
  const [self, setSelf] = useState<PartnerSelf | null>(null)
  const [selfLoading, setSelfLoading] = useState(true)
  const [selfError, setSelfError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const run = async () => {
      try {
        const d = await apiGet<{ partner: PartnerSelf | null }>('/api/logistics/jobs?scope=self')
        if (cancelled) return
        setSelf(d.partner)
        setSelfError(null)
      } catch (e) {
        if (!cancelled) setSelfError(e instanceof Error ? e.message : 'Could not load your logistics profile.')
      } finally {
        if (!cancelled) setSelfLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [user, reloadToken])

  // Event-context refresh — never invoked from an effect body.
  const refresh = () => { setSelfLoading(true); setReloadToken((t) => t + 1) }

  if (authLoading || (user && selfLoading && self === null)) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-10 sm:px-6" aria-busy="true">
        <Skeleton className="mx-auto h-16 w-16 rounded-2xl" />
        <Skeleton className="mx-auto h-9 w-72" />
        <Skeleton className="mx-auto h-5 w-96" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  // State A — anonymous landing
  if (!user) {
    return (
      <Landing
        signedIn={false}
        onJoin={() => { toast.info('Partner applications are tied to a free CARMAZE account.'); navigate('signin?mode=register') }}
        onRequest={() => navigate('signin')}
      />
    )
  }

  if (selfError) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16">
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>LogisticsOS could not load</AlertTitle>
          <AlertDescription>
            {selfError}
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={refresh}><RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> Retry</Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  // State C/D — approved or suspended partner
  if (self) {
    if (self.status === 'APPROVED') {
      return <PartnerDashboard partner={self} onRefresh={refresh} />
    }
    return <SuspendedNotice partner={self} />
  }

  // State A/B — signed in without a partner
  return <NonPartnerHome user={user} onDataChanged={refresh} />
}
