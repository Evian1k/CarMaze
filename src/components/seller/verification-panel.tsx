'use client'

/* CARMAZE — Seller verification panel
 * Individual seller identity verification (type SELLER applications).
 * One component, four states:
 *   VERIFIED        — role SELLER_VERIFIED granted: green confirmation card.
 *   IN PROGRESS     — application SUBMITTED / UNDER_REVIEW / RESUBMITTED.
 *   ACTION REQUIRED — MORE_INFO_REQUIRED: reviewer request + resubmission form.
 *   NOT STARTED     — apply form (also used for REJECTED after the decision note).
 * Verification is always a manual document review — every state says so.
 * Lives on #/sell; #/my-listings reuses useSellerApplication for its banners.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ShieldCheck, BadgeCheck, Loader2, Upload, FileText, Plus, X,
  AlertTriangle, RefreshCw, Info, ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { hasAnyRole, useAuth, type CurrentUser } from '@/stores/auth'
import { apiGet, apiSend, apiUpload } from '@/lib/client'
import { APPLICATION_STATUS_LABELS, KENYA_COUNTIES, dateLabel, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export type SellerApplicationEvent = {
  id: string
  type: string
  actorName: string | null
  note: string | null
  createdAt: string
}

export type SellerApplication = {
  id: string
  refCode: string
  type: string
  status: string
  orgName: string
  county: string
  town: string | null
  phone: string
  representative: string
  /** Stored as encoded JSON — use parseSellerDocs. */
  documents: string | null
  notes: string | null
  decisionNote: string | null
  correctionsDueAt: string | null
  escalated: boolean
  submittedAt: string | null
  createdAt: string
  events: SellerApplicationEvent[]
}

export type SellerAppDoc = { name: string; url: string }

/** Statuses where the review team is actively working (or waiting on the seller). */
export const SELLER_ACTIVE_STATUSES: string[] = ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'RESUBMITTED']

const IN_REVIEW_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED']
const CLOSED_BAD_STATUSES = ['REJECTED', 'SUSPENDED', 'REVOKED']
const MAX_DOCS = 10

const SELLER_EVENT_LABELS: Record<string, string> = {
  SUBMITTED: 'Application submitted',
  REVIEW_ASSIGNED: 'Reviewer assigned',
  INFO_REQUESTED: 'Information requested',
  RESUBMITTED: 'Information resubmitted',
  REMINDER: 'Reminder sent',
  ESCALATED: 'Escalated to senior review',
  APPROVED: 'Application approved',
  REJECTED: 'Application rejected',
  NOTE: 'Note from the review team',
  STATUS_CHANGED: 'Status updated',
}

const SELLER_BADGE_CLASS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SUBMITTED: 'bg-accent/30 text-accent-foreground',
  UNDER_REVIEW: 'bg-accent/40 text-accent-foreground',
  MORE_INFO_REQUIRED: 'bg-accent/50 text-accent-foreground',
  RESUBMITTED: 'bg-accent/30 text-accent-foreground',
  APPROVED: 'bg-primary text-primary-foreground',
  REJECTED: 'bg-destructive/15 text-destructive',
  SUSPENDED: 'bg-destructive/15 text-destructive',
  REVOKED: 'bg-destructive/15 text-destructive',
}

function parseSellerDocs(raw: string | null | undefined): SellerAppDoc[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (d): d is SellerAppDoc =>
        typeof d === 'object' && d !== null && typeof (d as SellerAppDoc).url === 'string'
    )
  } catch {
    return []
  }
}

/** Fetches the signed-in user's most recent SELLER application.
 * `enabled` gates the request (only when signed in and not already verified). */
export function useSellerApplication(enabled: boolean) {
  const [app, setApp] = useState<SellerApplication | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const run = async () => {
      try {
        const d = await apiGet<{ applications: SellerApplication[] }>('/api/applications')
        if (cancelled) return
        const sellers = d.applications
          .filter((a) => a.type === 'SELLER')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        setApp(sellers[0] ?? null)
        setError(null)
      } catch (e) {
        if (!cancelled) setError((e as { message?: string })?.message ?? 'Could not load verification status.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [enabled, tick])

  // Event-context refresh: safe to set state here (never called from an effect body).
  const reload = useCallback(() => {
    if (enabled) setLoading(true)
    setTick((t) => t + 1)
  }, [enabled])

  // Derived reset for the disabled state — no synchronous setState inside effects.
  return { app: enabled ? app : null, loading: enabled && loading, error: enabled ? error : null, reload }
}

// ───────────────────────────── Shared pieces ─────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={cn('border-transparent', SELLER_BADGE_CLASS[status] ?? 'bg-muted text-muted-foreground')}>
      {APPLICATION_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}

function ApplicationHeader({ app }: { app: SellerApplication }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={app.status} />
      <span className="font-mono text-sm font-semibold tracking-wide">{app.refCode}</span>
      {app.submittedAt && (
        <span className="text-sm text-muted-foreground">Submitted {dateLabel(app.submittedAt)}</span>
      )}
    </div>
  )
}

/** Compact event timeline — events arrive oldest first, so newest renders last. */
function EventTimeline({ events }: { events: SellerApplicationEvent[] }) {
  if (events.length === 0) return null
  return (
    <div>
      <h3 className="text-sm font-semibold">Progress</h3>
      <ol className="mt-3 space-y-0">
        {events.map((e, i) => (
          <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < events.length - 1 && <span aria-hidden className="absolute left-[7px] top-4 h-full w-px bg-border" />}
            <span
              className={cn(
                'mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2',
                e.type === 'APPROVED'
                  ? 'border-primary bg-primary'
                  : e.type === 'INFO_REQUESTED' || e.type === 'REJECTED' || e.type === 'ESCALATED'
                    ? 'border-accent bg-accent'
                    : 'border-primary/40 bg-background'
              )}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">{SELLER_EVENT_LABELS[e.type] ?? e.type}</p>
              {e.note && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{e.note}</p>}
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {timeAgo(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : ''}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Document uploader — same pattern as the dealer application wizard. */
function DocUploader({ docs, onAdd, onRemove, uploading, idPrefix, title, hint }: {
  docs: SellerAppDoc[]
  onAdd: (files: FileList | null) => void
  onRemove: (url: string) => void
  uploading: boolean
  idPrefix: string
  title: string
  hint?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        id={`${idPrefix}-file`}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          onAdd(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-center">
        <Upload className="mx-auto h-5 w-5 text-muted-foreground" />
        <p className="mt-1 text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">JPG, PNG, WEBP or PDF · up to 8MB each</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {uploading ? 'Uploading…' : 'Upload documents'}
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {docs.length > 0 && (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.url} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm">{d.name}</span>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${d.name}`} onClick={() => onRemove(d.url)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" /> Documents are private — only CARMAZE reviewers can view them.
      </p>
    </div>
  )
}

async function uploadDocs(files: FileList | null, current: number, onDoc: (d: SellerAppDoc) => void) {
  if (!files || files.length === 0) return
  const slots = MAX_DOCS - current
  const list = Array.from(files).slice(0, slots)
  if (list.length === 0) { toast.warning(`Maximum of ${MAX_DOCS} documents`); return }
  try {
    for (const file of list) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', 'document')
      const res = await apiUpload<{ url: string; name: string }>('/api/upload', fd)
      onDoc({ name: res.name || file.name, url: res.url })
    }
    toast.success('Document uploaded')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Upload failed — please try again.')
  }
}

// ───────────────────────────── State A — Verified ─────────────────────────────

function VerifiedCard() {
  return (
    <Card className="border-emerald-500/40 bg-emerald-500/5">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4 sm:p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
          <ShieldCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-emerald-800 dark:text-emerald-200">Verified seller</p>
            <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verified
            </Badge>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Your identity and authority-to-sell documents have been reviewed and approved by the CARMAZE verification team.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Verification shows on your listings — buyers see the trust marker next to your name.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// ───────────────────────────── State B — In review ─────────────────────────────

function InProgress({ app }: { app: SellerApplication }) {
  const docs = parseSellerDocs(app.documents)
  return (
    <div className="space-y-5">
      <ApplicationHeader app={app} />

      {app.escalated && (
        <Alert className="border-accent/60 bg-accent/10">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Review is taking longer than our target</AlertTitle>
          <AlertDescription>
            Your application has been escalated to senior staff — no action is needed from you. We are sorry for the wait.
          </AlertDescription>
        </Alert>
      )}

      <EventTimeline events={app.events} />

      <div className="space-y-1">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Our review team checks identity and ownership documents manually. Uploading documents never
          self-verifies an account — you&apos;ll get a notification the moment a decision is made.
        </p>
        <p className="text-xs text-muted-foreground">
          {docs.length} document{docs.length === 1 ? '' : 's'} on file for this application.
        </p>
      </div>
    </div>
  )
}

// ───────────────────────────── State C — Action required ─────────────────────────────

function ActionRequired({ app, onDone }: { app: SellerApplication; onDone: () => void }) {
  const infoEvent = [...app.events].reverse().find((e) => e.type === 'INFO_REQUESTED')
  const onFile = parseSellerDocs(app.documents)
  const [docs, setDocs] = useState<SellerAppDoc[]>([])
  const [uploading, setUploading] = useState(false)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  async function handleFiles(files: FileList | null) {
    setUploading(true)
    await uploadDocs(files, docs.length, (d) => setDocs((prev) => (prev.length < MAX_DOCS ? [...prev, d] : prev)))
    setUploading(false)
  }

  async function resubmit() {
    if (docs.length === 0 && notes.trim().length < 5) {
      toast.error('Add a note or attach the requested documents before resubmitting.')
      return
    }
    setSubmitting(true)
    setApiError(null)
    try {
      await apiSend(`/api/applications/${app.id}`, 'PATCH', {
        action: 'resubmit',
        documents: docs.length > 0 ? docs : undefined,
        notes: notes.trim() || undefined,
      })
      toast.success('Information resubmitted — the review team has been notified.')
      onDone()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not resubmit.'
      setApiError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <ApplicationHeader app={app} />

      {/* The reviewer's request — prominent */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">The review team requested more information</p>
          {infoEvent?.note && <p className="mt-1 leading-relaxed">{infoEvent.note}</p>}
          {app.correctionsDueAt && (
            <p className="mt-1 text-xs opacity-90">
              Please respond before {dateLabel(app.correctionsDueAt)} to keep your application in the queue.
            </p>
          )}
        </div>
      </div>

      <DocUploader
        idPrefix="sva-rs"
        docs={docs}
        uploading={uploading}
        onAdd={handleFiles}
        onRemove={(url) => setDocs((prev) => prev.filter((d) => d.url !== url))}
        title="Attach the requested documents"
        hint={
          onFile.length > 0
            ? `${onFile.length} document${onFile.length === 1 ? ' is' : 's are'} already on file — new uploads replace them, so attach everything the reviewer needs.`
            : 'Attach exactly what the reviewer asked for.'
        }
      />

      <div className="grid gap-1.5">
        <Label htmlFor="sva-rs-notes">Note for the review team</Label>
        <Textarea
          id="sva-rs-notes"
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Explain what you corrected or attached…"
        />
      </div>

      {apiError && (
        <Alert className="border-destructive/40 bg-destructive/5 text-destructive [&>svg]:text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t resubmit</AlertTitle>
          <AlertDescription>{apiError}</AlertDescription>
        </Alert>
      )}

      <Button onClick={resubmit} disabled={submitting} className="min-h-11 px-6">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Resubmit for review
      </Button>

      <EventTimeline events={app.events} />
    </div>
  )
}

// ───────────────────── State D — Not started / rejected ─────────────────────

function NotStarted({ user, previousApp, onDone }: {
  user: CurrentUser
  previousApp: SellerApplication | null
  onDone: () => void
}) {
  const closed = previousApp !== null && CLOSED_BAD_STATUSES.includes(previousApp.status)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    orgName: user.name,
    regNo: '',
    county: '',
    town: '',
    phone: user.phone ?? '',
    representative: user.name,
    notes: '',
  })
  const [docs, setDocs] = useState<SellerAppDoc[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [consent, setConsent] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function handleFiles(files: FileList | null) {
    setUploading(true)
    await uploadDocs(files, docs.length, (d) => setDocs((prev) => (prev.length < MAX_DOCS ? [...prev, d] : prev)))
    setUploading(false)
  }

  async function submit() {
    if (form.orgName.trim().length < 2) { toast.error('Enter your full legal name.'); return }
    if (form.regNo.trim().length < 3) { toast.error('Enter your national ID or passport number.'); return }
    if (!form.county) { toast.error('Select your county.'); return }
    if (form.phone.trim().length < 9) { toast.error('Enter a valid phone number.'); return }
    if (form.representative.trim().length < 2) { toast.error('Enter the authorised representative name.'); return }
    if (docs.length === 0) {
      toast.error('Attach at least one document — your government ID and a logbook/ownership document or authority-to-sell letter.')
      return
    }
    if (!consent) { toast.error('Please confirm your information is true and accept the verification terms and privacy notice.'); return }
    setSubmitting(true)
    setApiError(null)
    try {
      const res = await apiSend<{ application: SellerApplication }>('/api/applications', 'POST', {
        type: 'SELLER',
        status: 'SUBMITTED',
        orgName: form.orgName.trim(),
        regNo: form.regNo.trim(),
        county: form.county,
        town: form.town.trim() || undefined,
        phone: form.phone.trim(),
        email: user.email || undefined,
        representative: form.representative.trim(),
        documents: docs,
        consent: true,
        notes: form.notes.trim() || undefined,
      })
      toast.success(`Seller verification submitted — ${res.application.refCode}. Our review team checks documents manually.`)
      setOpen(false)
      onDone()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not submit the application.'
      setApiError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {previousApp?.status === 'DRAFT' && (
        <Alert className="border-accent/50 bg-accent/10">
          <Info className="h-4 w-4" />
          <AlertTitle>Draft {previousApp.refCode} saved</AlertTitle>
          <AlertDescription>
            A draft was saved earlier but was never sent to the review team. Submit a fresh application below.
          </AlertDescription>
        </Alert>
      )}

      {closed && previousApp && (
        <Alert className="border-destructive/40 bg-destructive/5 text-destructive [&>svg]:text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {previousApp.refCode} was {APPLICATION_STATUS_LABELS[previousApp.status]?.toLowerCase() ?? previousApp.status.toLowerCase()}
          </AlertTitle>
          <AlertDescription>
            {previousApp.decisionNote
              ? `Reviewer note: ${previousApp.decisionNote}`
              : 'You can correct the details and submit a fresh application.'}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-sm text-muted-foreground">
          {closed
            ? 'Correct the issues noted above, then submit a fresh application for review.'
            : 'Verify your identity and authority to sell — approved accounts carry the verified trust marker on their listings.'}
        </p>
        <Button
          variant={closed ? 'default' : 'outline'}
          className="h-11 px-5 sm:h-9"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {closed ? 'Correct and resubmit' : open ? 'Close form' : 'Start verification'}
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </Button>
      </div>

      {open && (
        <div className="space-y-4 rounded-xl border border-border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sva-name">Full legal name *</Label>
              <Input id="sva-name" placeholder="As it appears on your ID" value={form.orgName} onChange={(e) => set('orgName', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sva-reg">National ID / passport number *</Label>
              <Input id="sva-reg" placeholder="e.g. 12345678" value={form.regNo} onChange={(e) => set('regNo', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>County *</Label>
              <Select value={form.county || undefined} onValueChange={(v) => set('county', v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select county" /></SelectTrigger>
                <SelectContent>
                  {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sva-town">Town / area</Label>
              <Input id="sva-town" placeholder="e.g. Syokimau" value={form.town} onChange={(e) => set('town', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sva-phone">Phone *</Label>
              <Input id="sva-phone" inputMode="tel" placeholder="e.g. 0712 345 678" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sva-rep">Authorised representative *</Label>
              <Input id="sva-rep" value={form.representative} onChange={(e) => set('representative', e.target.value)} />
              <p className="text-xs text-muted-foreground">For private sellers this is you — the person selling the vehicle(s).</p>
            </div>
          </div>

          <DocUploader
            idPrefix="sva-new"
            docs={docs}
            uploading={uploading}
            onAdd={handleFiles}
            onRemove={(url) => setDocs((prev) => prev.filter((d) => d.url !== url))}
            title="Identity & ownership documents"
            hint="Attach your government ID (national ID or passport) plus a logbook/ownership document — or an authority-to-sell letter for each vehicle you're listing."
          />

          <div className="grid gap-1.5">
            <Label htmlFor="sva-notes">Notes for the review team (optional)</Label>
            <Textarea
              id="sva-notes"
              rows={3}
              maxLength={2000}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Anything that helps the reviewer — e.g. the vehicle(s) you plan to list…"
            />
          </div>

          <label className="flex items-start gap-2.5 text-sm leading-relaxed" htmlFor="sva-consent">
            <Checkbox id="sva-consent" className="mt-0.5" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
            <span>I confirm the information and documents are true and I accept the verification terms and privacy notice.</span>
          </label>

          {apiError && (
            <Alert className="border-destructive/40 bg-destructive/5 text-destructive [&>svg]:text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Couldn&apos;t submit the application</AlertTitle>
              <AlertDescription>{apiError}</AlertDescription>
            </Alert>
          )}

          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Verification is completed by our review team after document checks — it is never automatic.
            Initial review target: 24 business hours.
          </p>

          <Button onClick={submit} disabled={submitting} className="min-h-11 px-6">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Submit for verification
          </Button>
        </div>
      )}
    </div>
  )
}

// ───────────────────── Edge — approved but session not refreshed ─────────────────────

function ApprovedPendingRole({ onRefresh }: { onRefresh: () => void }) {
  return (
    <Alert>
      <BadgeCheck className="h-4 w-4 text-primary" />
      <AlertTitle>Verification approved</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>Your documents were approved by the review team.</span>
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" /> Refresh status
        </Button>
      </AlertDescription>
    </Alert>
  )
}

// ───────────────────────────── Panel ─────────────────────────────

export function VerificationPanel() {
  const { user, refresh } = useAuth()
  const verified = hasAnyRole(user, 'SELLER_VERIFIED')
  const { app, loading, error, reload } = useSellerApplication(!!user && !verified)

  const onActionDone = () => {
    reload()
    void refresh()
  }

  if (!user) return null

  if (verified) return <VerifiedCard />

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /> Seller verification
        </CardTitle>
        <CardDescription>
          A one-time manual document review adds the verified trust marker buyers look for.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : error ? (
          <Alert className="border-destructive/40 bg-destructive/5 text-destructive [&>svg]:text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Couldn&apos;t load your verification status</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={reload}>
                <RefreshCw className="h-4 w-4" /> Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : !app || app.status === 'DRAFT' ? (
          <NotStarted user={user} previousApp={app} onDone={onActionDone} />
        ) : app.status === 'MORE_INFO_REQUIRED' ? (
          <ActionRequired app={app} onDone={onActionDone} />
        ) : IN_REVIEW_STATUSES.includes(app.status) ? (
          <InProgress app={app} />
        ) : app.status === 'APPROVED' ? (
          <ApprovedPendingRole onRefresh={() => void refresh()} />
        ) : (
          <NotStarted user={user} previousApp={app} onDone={onActionDone} />
        )}
      </CardContent>
    </Card>
  )
}
