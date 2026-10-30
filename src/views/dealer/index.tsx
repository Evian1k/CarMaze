'use client'

/* DealerOS — dealer onboarding + dealership management portal.
 * Three states driven by GET /api/orgs/me:
 *   A) Not applied            → marketing + 4-step application wizard
 *   B) Pending / corrections  → status card, event timeline, resubmit form
 *   C) Approved (org exists)  → full dashboard (overview, inventory, enquiries,
 *                               offers, buying board, staff, billing, profile)
 * All data comes from live API routes; external modules owned by parallel
 * agents render honest "loading/unavailable" states until integrated.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Building2, CalendarClock, Car, Check,
  CheckCircle2, CircleAlert, ClipboardList, Copy, CreditCard, Eye, FileText, Gauge, Handshake, IdCard,
  Inbox, Info, Loader2,
  LogIn, MessageSquare, MessageSquareReply, Play, Plus, RefreshCw, Send, ShieldCheck, Sparkles,
  Trash2, Upload, Users, Wallet, X, XCircle,
} from 'lucide-react'
import { apiGet, apiSend, apiUpload, navigate } from '@/lib/client'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useAuth } from '@/stores/auth'
import { money, timeAgo, dateLabel, KENYA_COUNTIES, VEHICLE_MAKES, VEHICLE_STATUS_LABELS, APPLICATION_STATUS_LABELS, vehicleTitle } from '@/lib/format'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MessagesTab, useUnreadConversations } from '@/components/messaging/conversation-panel'
import { PromotionsSection } from '@/components/billing/promotions-section'

// ───────────────────────────── Types ─────────────────────────────

type DocItem = { name: string; url: string }

type Membership = {
  orgId: string
  role: string
  org: { id: string; name: string; type: string; status: string; county: string; town: string | null }
}

type AppEvent = { id: string; type: string; actorName?: string | null; note?: string | null; createdAt: string }

type DealerApplication = {
  id: string
  refCode: string
  status: string
  orgName: string
  county: string
  town?: string | null
  phone: string
  representative: string
  accountType?: string | null
  decisionNote?: string | null
  submittedAt?: string | null
  correctionsDueAt?: string | null
  escalated: boolean
  createdAt: string
  events: AppEvent[]
}

type Me = { memberships: Membership[]; application: DealerApplication | null }

type FetchError = { status: number; message: string }

type DealerOrg = {
  id: string
  name: string
  regNo?: string | null
  county: string
  town?: string | null
  location?: string | null
  phone?: string | null
  email?: string | null
  description?: string | null
  status: string
}

type SubscriptionInfo = {
  planCode: string
  planName: string
  status: string
  startedAt: string
  currentPeriodEnd: string
  listingLimit: number
  featuredLimit: number
  staffLimit: number
} | null

type RecentEnquiry = {
  id: string
  refCode: string
  status: string
  createdAt: string
  customerName: string
  phone?: string | null
  vehicle: { id: string; make: string; model: string; year: number; priceMinor: number; currency: string }
  lastMessage?: { senderName: string; senderSide: string; body: string; createdAt: string } | null
}

type DashboardData = {
  org: DealerOrg
  viewerRole: string
  subscription: SubscriptionInfo
  stats: {
    published: number
    pending: number
    drafts: number
    sold: number
    reserved: number
    totalViews: number
    enquiriesOpen: number
    enquiriesAnswered: number
    offersPending: number
    buyingRequestsOpen: number
    staffCount: number
  }
  recentEnquiries: RecentEnquiry[]
  listingUsage: { used: number; limit: number | null }
}

type Insight = { id: string; severity: 'urgent' | 'warning' | 'info'; title: string; detail: string; actionLink?: string }

type VehicleItem = {
  id: string
  refCode: string
  make: string
  model: string
  year: number
  priceMinor: number
  currency: string
  status: string
  views: number
  photos?: unknown[]
  createdAt: string
}

type EnquiryMessage = { id: string; senderId: string; senderName: string; senderSide: string; body: string; createdAt: string }

type EnquiryItem = {
  id: string
  refCode: string
  status: string
  message: string
  phoneShare?: boolean
  phone?: string | null
  createdAt: string
  user?: { name?: string }
  vehicle?: { id: string; make: string; model: string; year: number; priceMinor: number; currency: string }
  messages?: EnquiryMessage[]
}

type OfferItem = {
  id: string
  amountMinor: number
  message?: string | null
  status: string
  expiresAt?: string | null
  createdAt: string
  vehicle?: { id?: string; make: string; model: string; year: number; refCode?: string }
}

type BuyingRequestItem = {
  id: string
  make: string
  model?: string | null
  yearFrom?: number | null
  yearTo?: number | null
  budgetMinor?: number | null
  notes?: string | null
  status: string
  createdAt: string
  org?: { id?: string; name?: string }
}

type StaffMember = { id: string; userId: string; name: string; email: string; role: string; status: string; createdAt: string }

type PlanItem = {
  code: string
  name: string
  audience: string
  priceMinor: number
  currency: string
  intervalMonths: number
  listingLimit: number
  featuredLimit: number
  staffLimit: number
  features?: string | null
  active: boolean
}

type InvoiceItem = {
  id: string
  refCode: string
  type: string
  description: string
  amountMinor: number
  currency: string
  status: string
  issuedAt: string
  dueDate?: string | null
  paidAt?: string | null
}

// ───────────────────────────── Constants ─────────────────────────────

const TABS = ['overview', 'inventory', 'enquiries', 'inbox', 'offers', 'testdrives', 'buying', 'staff', 'billing', 'profile'] as const
type TabKey = (typeof TABS)[number]

const REVIEWABLE_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'RESUBMITTED']

const EVENT_LABELS: Record<string, string> = {
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

const APPLICATION_BADGE_CLASS: Record<string, string> = {
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

const VEHICLE_BADGE_CLASS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PENDING_REVIEW: 'bg-accent/30 text-accent-foreground',
  PUBLISHED: 'bg-primary text-primary-foreground',
  RESERVED: 'bg-secondary text-secondary-foreground',
  SOLD: 'bg-muted text-muted-foreground',
  REJECTED: 'bg-destructive/15 text-destructive',
  SUSPENDED: 'bg-destructive/15 text-destructive',
  EXPIRED: 'bg-muted text-muted-foreground',
}

const GENERIC_BADGE_CLASS: Record<string, string> = {
  PENDING: 'bg-accent/30 text-accent-foreground',
  OPEN: 'bg-accent/30 text-accent-foreground',
  ACTIVE: 'bg-primary text-primary-foreground',
  ANSWERED: 'bg-secondary text-secondary-foreground',
  CLOSED: 'bg-muted text-muted-foreground',
  PAID: 'bg-primary text-primary-foreground',
  OVERDUE: 'bg-destructive/15 text-destructive',
  EXPIRED: 'bg-muted text-muted-foreground',
  ACCEPTED: 'bg-primary text-primary-foreground',
  REJECTED: 'bg-destructive/15 text-destructive',
  WITHDRAWN: 'bg-muted text-muted-foreground',
  CANCELLED: 'bg-muted text-muted-foreground',
  REFUNDED: 'bg-secondary text-secondary-foreground',
  SUSPENDED: 'bg-destructive/15 text-destructive',
}

const ROLE_BADGE: Record<string, string> = {
  OWNER: 'bg-primary text-primary-foreground',
  MANAGER: 'bg-accent/40 text-accent-foreground',
  SALES: 'bg-secondary text-secondary-foreground',
  FINANCE: 'bg-secondary text-secondary-foreground',
  STAFF: 'bg-muted text-muted-foreground',
}

const ACCOUNT_TYPES = [
  { value: 'dealer-starter', label: 'Dealer Starter — KES 4,900/mo, 10 listings' },
  { value: 'dealer-pro', label: 'Dealer Pro — KES 9,900/mo, 40 listings' },
]

// ───────────────────────────── Helpers ─────────────────────────────

function photoUrl(p: unknown): string | null {
  if (typeof p === 'string') return p
  if (p && typeof p === 'object' && typeof (p as { url?: unknown }).url === 'string') return (p as { url: string }).url
  return null
}

function num(n: number): string {
  return n.toLocaleString('en-KE')
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  } catch {
    toast.error('Copy failed — please select the text and copy manually.')
  }
}

type FetchState<T> = { data: T | null; error: FetchError | null; loading: boolean; reload: () => void }

/** GET hook — all state updates happen in async callbacks (lint-safe). */
function useFetch<T>(url: string | null): FetchState<T> {
  const [completed, setCompleted] = useState<{ key: string; data: T | null; error: FetchError | null } | null>(null)
  const [tick, setTick] = useState(0)
  const key = `${url ?? ''}|${tick}`

  useEffect(() => {
    if (!url) return
    let cancelled = false
    apiGet<T>(url)
      .then((d) => {
        if (!cancelled) setCompleted({ key, data: d, error: null })
      })
      .catch((e: { status?: number; message?: string }) => {
        if (!cancelled) {
          setCompleted({ key, data: null, error: { status: typeof e?.status === 'number' ? e.status : 0, message: e?.message ?? 'Request failed' } })
        }
      })
    return () => {
      cancelled = true
    }
  }, [url, tick, key])

  const loading = Boolean(url) && (!completed || completed.key !== key)
  const fresh = completed && url && completed.key.split('|')[0] === url ? completed : null
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data: fresh?.data ?? null, error: fresh && fresh.key === key ? fresh.error : null, loading, reload }
}

// ───────────────────────────── Shared UI bits ─────────────────────────────

function StatusBadge({ status, labels, classes }: { status: string; labels: Record<string, string>; classes: Record<string, string> }) {
  return (
    <Badge variant="secondary" className={cn('border-transparent font-medium', classes[status] ?? 'bg-muted text-muted-foreground')}>
      {labels[status] ?? status}
    </Badge>
  )
}

function StatCard({ label, value, icon, hint, onClick }: { label: string; value: string | number; icon: React.ReactNode; hint?: string; onClick?: () => void }) {
  return (
    <Card className={cn('py-4', onClick && 'cursor-pointer transition-colors hover:border-primary/40')} onClick={onClick} role={onClick ? 'button' : undefined}>
      <CardContent className="flex items-center gap-3 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold leading-tight">{value}</p>
          {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {label}
      </div>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

function ModuleNotice({ title, detail, retry, loading }: { title: string; detail?: string; retry?: () => void; loading?: boolean }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <RefreshCw className={cn('h-6 w-6 text-muted-foreground', loading && 'animate-spin')} />
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="max-w-md text-xs text-muted-foreground">{detail}</p>}
        {retry && (
          <Button variant="outline" size="sm" className="mt-2" onClick={retry}>
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function EmptyState({ icon, title, detail }: { icon: React.ReactNode; title: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      {detail && <p className="max-w-md text-xs text-muted-foreground">{detail}</p>}
    </div>
  )
}

/** Private-document uploader shared by the application wizard and resubmit form. */
function DocUploader({ docs, onAdd, onRemove, uploading, idPrefix }: {
  docs: DocItem[]
  onAdd: (files: FileList | null) => void
  onRemove: (url: string) => void
  uploading: boolean
  idPrefix: string
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
        <p className="mt-1 text-sm font-medium">Business registration, permits or premises photos</p>
        <p className="text-xs text-muted-foreground">JPG, PNG, WEBP or PDF · up to 5MB each</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {uploading ? 'Uploading…' : 'Upload documents'}
        </Button>
      </div>
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

// ───────────────────────────── State A — Not applied ─────────────────────────────

const BENEFITS = [
  { icon: <BadgeCheck className="h-5 w-5" />, title: 'Verified badge', detail: 'Pass document review and earn the trust marker buyers look for.' },
  { icon: <MessageSquare className="h-5 w-5" />, title: 'Enquiry inbox', detail: 'Structured customer conversations on every listing — no WhatsApp scatter.' },
  { icon: <Handshake className="h-5 w-5" />, title: 'Dealer matching', detail: 'Send offers on private cars flagged “match with dealers” before anyone else.' },
  { icon: <Users className="h-5 w-5" />, title: 'Team accounts', detail: 'Add sales staff with their own logins and role-based access.' },
  { icon: <Wallet className="h-5 w-5" />, title: 'M-Pesa billing', detail: 'Subscriptions and promotions paid via Safaricom Daraja STK push.' },
  { icon: <Sparkles className="h-5 w-5" />, title: 'Dealer Copilot', detail: 'Deterministic follow-up nudges computed from your real pipeline data.' },
]

const WIZARD_STEPS = ['Business', 'Representative', 'Documents', 'Review']

type WizardForm = {
  orgName: string
  regNo: string
  county: string
  town: string
  physicalAddress: string
  phone: string
  email: string
  representative: string
  accountType: string
  notes: string
}

function NotApplied({ previousApp, onDone }: { previousApp: DealerApplication | null; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<WizardForm>({
    orgName: '', regNo: '', county: '', town: '', physicalAddress: '', phone: '', email: '',
    representative: '', accountType: 'dealer-pro', notes: '',
  })
  const [docs, setDocs] = useState<DocItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [consent, setConsent] = useState(false)

  const set = (k: keyof WizardForm, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const rejected = previousApp && ['REJECTED', 'REVOKED', 'SUSPENDED'].includes(previousApp.status)
  const draft = previousApp?.status === 'DRAFT' ? previousApp : null

  function openWizard() {
    setStep(1)
    setOpen(true)
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('kind', 'document')
        const res = await apiUpload<{ url: string; name: string }>('/api/upload', fd)
        setDocs((prev) => [...prev, { name: res.name || file.name, url: res.url }])
      }
      toast.success('Document uploaded')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed — please try again.')
    } finally {
      setUploading(false)
    }
  }

  function validateStep(current: number): string | null {
    if (current === 1) {
      if (form.orgName.trim().length < 2) return 'Enter the dealership name.'
      if (!form.county) return 'Select the county.'
      if (form.phone.trim().length < 9) return 'Enter a valid business phone number.'
    }
    if (current === 2 && form.representative.trim().length < 2) return 'Enter the authorised representative name.'
    return null
  }

  function next() {
    const problem = validateStep(step)
    if (problem) {
      toast.error(problem)
      return
    }
    setStep((s) => Math.min(4, s + 1))
  }

  async function submit(status: 'SUBMITTED' | 'DRAFT') {
    if (status === 'SUBMITTED') {
      const problem = validateStep(1) ?? validateStep(2)
      if (problem) {
        toast.error(problem)
        return
      }
      if (docs.length === 0) {
        toast.error('Attach at least one document (business registration or premises photo) so reviewers can verify you.')
        return
      }
      if (!consent) {
        toast.error('Please accept the Dealer Agreement and Privacy Policy.')
        return
      }
    }
    setSubmitting(true)
    try {
      const res = await apiSend<{ application: DealerApplication }>('/api/applications', 'POST', {
        type: 'DEALER',
        status,
        orgName: form.orgName.trim(),
        regNo: form.regNo.trim() || undefined,
        county: form.county,
        town: form.town.trim() || undefined,
        physicalAddress: form.physicalAddress.trim() || undefined,
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        representative: form.representative.trim(),
        accountType: form.accountType || undefined,
        documents: docs,
        consent: status === 'SUBMITTED' ? consent : false,
        notes: form.notes.trim() || undefined,
      })
      if (status === 'SUBMITTED') {
        toast.success(`Application submitted — ${res.application.refCode}. Initial review target: 24 business hours.`)
      } else {
        toast.success(`Draft saved — ${res.application.refCode}. You can finish and submit any time.`)
      }
      setOpen(false)
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not submit the application.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-8 sm:px-6 sm:py-12">
      {/* Marketing-lite header */}
      <div className="text-center">
        <Badge variant="secondary" className="mb-3 gap-1.5 border-transparent bg-accent/30 text-accent-foreground">
          <Sparkles className="h-3.5 w-3.5" /> For verified dealerships
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">DealerOS — run your dealership on CARMAZE</h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          One workspace for listings, customer enquiries, offers, your team and billing. Apply once — our review team
          verifies your business within 24 business hours. No verification badge is ever bought.
        </p>
      </div>

      {(rejected || draft) && previousApp && (
        <Alert className={cn('mt-6', rejected ? 'border-destructive/40 bg-destructive/5' : 'border-accent/50 bg-accent/10')}>
          {rejected ? <CircleAlert className="h-4 w-4 text-destructive" /> : <Info className="h-4 w-4" />}
          <AlertTitle>{rejected ? `Previous application ${previousApp.refCode} was ${APPLICATION_STATUS_LABELS[previousApp.status]?.toLowerCase() ?? previousApp.status.toLowerCase()}` : `Draft ${previousApp.refCode} saved`}</AlertTitle>
          <AlertDescription>
            {rejected
              ? previousApp.decisionNote
                ? `Reviewer note: ${previousApp.decisionNote} You can submit a fresh application below.`
                : 'You can submit a fresh application below.'
              : 'Your saved draft is kept for reference. Complete the application below to submit for review.'}
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BENEFITS.map((b) => (
          <Card key={b.title} className="py-4">
            <CardContent className="flex gap-3 px-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{b.icon}</div>
              <div>
                <p className="text-sm font-semibold">{b.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{b.detail}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        <Button size="lg" onClick={openWizard} className="min-h-11 px-8">
          Apply for dealership verification <ArrowRight className="h-4 w-4" />
        </Button>
        <p className="text-xs text-muted-foreground">
          Already have a CARMAZE account? Use it — the application is linked to your login.
        </p>
      </div>

      {/* Application wizard */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Dealership application</DialogTitle>
            <DialogDescription>
              Step {step} of 4 · {WIZARD_STEPS[step - 1]} — initial review target is 24 business hours.
            </DialogDescription>
          </DialogHeader>

          <ol className="flex items-center gap-1.5" aria-label="Application progress">
            {WIZARD_STEPS.map((label, i) => (
              <li key={label} className="flex flex-1 flex-col gap-1">
                <div className={cn('h-1.5 rounded-full', i + 1 <= step ? 'bg-primary' : 'bg-muted')} />
                <span className={cn('text-[10px] font-medium', i + 1 === step ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
              </li>
            ))}
          </ol>

          {step === 1 && (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="wz-orgname">Dealership name *</Label>
                <Input id="wz-orgname" value={form.orgName} onChange={(e) => set('orgName', e.target.value)} placeholder="e.g. Nairobi Auto Hub" maxLength={120} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wz-regno">Business registration number <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="wz-regno" value={form.regNo} onChange={(e) => set('regNo', e.target.value)} placeholder="e.g. BN-2019-4482" maxLength={60} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>County *</Label>
                  <Select value={form.county} onValueChange={(v) => set('county', v)}>
                    <SelectTrigger aria-label="County"><SelectValue placeholder="Select county" /></SelectTrigger>
                    <SelectContent className="max-h-64 scrollbar-thin">
                      {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="wz-town">Town / area</Label>
                  <Input id="wz-town" value={form.town} onChange={(e) => set('town', e.target.value)} placeholder="e.g. Syokimau" maxLength={60} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wz-address">Physical address of premises</Label>
                <Input id="wz-address" value={form.physicalAddress} onChange={(e) => set('physicalAddress', e.target.value)} placeholder="e.g. Mombasa Road, next to Gateway Mall" maxLength={200} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="wz-phone">Business phone *</Label>
                  <Input id="wz-phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+254 7XX XXX XXX" maxLength={20} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="wz-email">Business email</Label>
                  <Input id="wz-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="sales@yourdealership.co.ke" maxLength={120} />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="wz-rep">Authorised representative *</Label>
                <Input id="wz-rep" value={form.representative} onChange={(e) => set('representative', e.target.value)} placeholder="Full name of the person CARMAZE can contact" maxLength={80} />
              </div>
              <div className="grid gap-1.5">
                <Label>Plan you are interested in</Label>
                <Select value={form.accountType} onValueChange={(v) => set('accountType', v)}>
                  <SelectTrigger aria-label="Plan interest"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Interest only — you choose (or change) your plan after approval, in Billing.</p>
              </div>
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Your CARMAZE account</AlertTitle>
                <AlertDescription>
                  This application is linked to the account you are signed in with. Verification decisions and messages
                  arrive as in-app notifications — no separate dealer login is created.
                </AlertDescription>
              </Alert>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-4">
              <DocUploader
                idPrefix="wz"
                docs={docs}
                uploading={uploading}
                onAdd={handleFiles}
                onRemove={(url) => setDocs((prev) => prev.filter((d) => d.url !== url))}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Reviewers check that the business exists and the premises matches what you publish. Keep names and
                registration numbers readable.
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="grid gap-4">
              <dl className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Dealership</dt><dd className="text-right font-medium">{form.orgName || '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Reg. number</dt><dd className="text-right">{form.regNo || '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Location</dt><dd className="text-right">{[form.town, form.county].filter(Boolean).join(', ') || '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Phone</dt><dd className="text-right">{form.phone || '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Representative</dt><dd className="text-right">{form.representative || '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Plan interest</dt><dd className="text-right">{form.accountType || '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Documents</dt><dd className="text-right">{docs.length} uploaded</dd></div>
              </dl>
              <label className="flex items-start gap-2.5 text-sm leading-relaxed" htmlFor="wz-consent">
                <Checkbox id="wz-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
                <span>I accept the Dealer Agreement and the CARMAZE Privacy Policy, and confirm the information above is accurate.</span>
              </label>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {step > 1 && (
                <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={submitting}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => submit('DRAFT')} disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save draft
              </Button>
              {step < 4 ? (
                <Button onClick={next}>Continue <ArrowRight className="h-4 w-4" /></Button>
              ) : (
                <Button onClick={() => submit('SUBMITTED')} disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Submit application
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ───────────────────────────── State B — Pending application ─────────────────────────────

function PendingApplication({ app, onUpdated }: { app: DealerApplication; onUpdated: () => void }) {
  const [docs, setDocs] = useState<DocItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const needsInfo = app.status === 'MORE_INFO_REQUIRED'
  const infoEvent = [...app.events].reverse().find((e) => e.type === 'INFO_REQUESTED')

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('kind', 'document')
        const res = await apiUpload<{ url: string; name: string }>('/api/upload', fd)
        setDocs((prev) => [...prev, { name: res.name || file.name, url: res.url }])
      }
      toast.success('Document uploaded')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed — please try again.')
    } finally {
      setUploading(false)
    }
  }

  async function resubmit() {
    if (docs.length === 0 && notes.trim().length < 5) {
      toast.error('Add a note or attach the requested documents before resubmitting.')
      return
    }
    setSubmitting(true)
    try {
      await apiSend(`/api/applications/${app.id}`, 'PATCH', {
        action: 'resubmit',
        documents: docs.length > 0 ? docs : undefined,
        notes: notes.trim() || undefined,
      })
      toast.success('Information resubmitted — the review team has been notified.')
      onUpdated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not resubmit.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-8 sm:px-6 sm:py-12">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Building2 className="h-5 w-5 text-primary" /> {app.orgName}
            </CardTitle>
            <StatusBadge status={app.status} labels={APPLICATION_STATUS_LABELS} classes={APPLICATION_BADGE_CLASS} />
          </div>
          <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs">{app.refCode}</span>
            <span aria-hidden>·</span>
            <span>Submitted {app.submittedAt ? dateLabel(app.submittedAt) : '—'}</span>
            <span aria-hidden>·</span>
            <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Initial review target: 24 business hours</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {app.escalated && (
            <Alert className="border-accent/60 bg-accent/10">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Review is taking longer than our target</AlertTitle>
              <AlertDescription>
                Your application has been escalated to senior staff — no action is needed from you. We are sorry for the wait.
              </AlertDescription>
            </Alert>
          )}

          {needsInfo && (
            <div className="space-y-3 rounded-lg border border-accent/60 bg-accent/10 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold">The review team requested more information</p>
                  {infoEvent?.note && <p className="mt-1 text-muted-foreground">{infoEvent.note}</p>}
                  {app.correctionsDueAt && (
                    <p className="mt-1 text-muted-foreground">Please respond before <strong>{dateLabel(app.correctionsDueAt)}</strong> to keep your application in the queue.</p>
                  )}
                </div>
              </div>
              <Separator />
              <div className="space-y-3">
                <DocUploader
                  idPrefix="rs"
                  docs={docs}
                  uploading={uploading}
                  onAdd={handleFiles}
                  onRemove={(url) => setDocs((prev) => prev.filter((d) => d.url !== url))}
                />
                <div className="grid gap-1.5">
                  <Label htmlFor="rs-notes">Note for the review team</Label>
                  <Textarea id="rs-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Explain what you corrected or attached…" maxLength={2000} />
                </div>
                <Button onClick={resubmit} disabled={submitting} className="min-h-11">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Resubmit application
                </Button>
              </div>
            </div>
          )}

          {!needsInfo && app.status !== 'APPROVED' && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              Your application is in the review queue. You will receive an in-app notification as soon as the review team
              updates it — this page updates automatically when you revisit.
            </p>
          )}
          {app.status === 'APPROVED' && (
            <Alert>
              <BadgeCheck className="h-4 w-4 text-primary" />
              <AlertTitle>Application approved</AlertTitle>
              <AlertDescription>
                Your dealership has been verified. If your DealerOS workspace does not appear shortly, sign out and back in
                once — or contact support with your reference {app.refCode}.
              </AlertDescription>
            </Alert>
          )}

          {/* Event timeline */}
          <div>
            <h3 className="text-sm font-semibold">Application timeline</h3>
            <ol className="mt-3 space-y-0">
              {app.events.map((e, i) => (
                <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {i < app.events.length - 1 && <span aria-hidden className="absolute left-[7px] top-4 h-full w-px bg-border" />}
                  <span className={cn('mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2', ['APPROVED'].includes(e.type) ? 'border-primary bg-primary' : ['INFO_REQUESTED', 'REJECTED', 'ESCALATED'].includes(e.type) ? 'border-accent bg-accent' : 'border-primary/40 bg-background')} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{EVENT_LABELS[e.type] ?? e.type}</p>
                    {e.note && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{e.note}</p>}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {timeAgo(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ───────────────────────────── State C — Dashboard tabs ─────────────────────────────

function OverviewTab({ orgId, dash }: { orgId: string; dash: FetchState<DashboardData> }) {
  const copilot = useFetch<{ insights: Insight[]; generatedAt: string }>(`/api/dealer/copilot?orgId=${orgId}`)

  if (dash.loading && !dash.data) return <LoadingBlock label="Loading your dealership numbers…" />
  if (dash.error || !dash.data) {
    return <ModuleNotice title="Could not load the dashboard" detail={dash.error?.message} retry={dash.reload} />
  }
  const d = dash.data
  const s = d.stats

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Published" value={s.published} icon={<Car className="h-4 w-4" />} hint={`${s.reserved} reserved`} onClick={() => navigate('/dealer?tab=inventory')} />
        <StatCard label="Pending review" value={s.pending} icon={<ClipboardList className="h-4 w-4" />} hint={`${s.drafts} drafts`} onClick={() => navigate('/dealer?tab=inventory')} />
        <StatCard label="Views total" value={num(s.totalViews)} icon={<Eye className="h-4 w-4" />} hint="all listings, lifetime" />
        <StatCard label="Open enquiries" value={s.enquiriesOpen} icon={<MessageSquare className="h-4 w-4" />} hint={`${s.enquiriesAnswered} answered`} onClick={() => navigate('/dealer?tab=enquiries')} />
        <StatCard label="Offers sent" value={s.offersPending} icon={<Handshake className="h-4 w-4" />} hint="awaiting seller" onClick={() => navigate('/dealer?tab=offers')} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Copilot panel */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-accent-foreground" /> Dealer Copilot
              {copilot.loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </CardTitle>
            <CardDescription>
              Follow-ups computed from your live data{copilot.data?.generatedAt ? ` · updated ${timeAgo(copilot.data.generatedAt)}` : ''}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {copilot.loading && !copilot.data && (
              <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
            )}
            {copilot.error && (
              <p className="text-sm text-muted-foreground">Copilot is unavailable right now — {copilot.error.message}</p>
            )}
            {copilot.data?.insights.map((ins) => (
              <div
                key={ins.id}
                className={cn(
                  'rounded-lg border p-3',
                  ins.severity === 'urgent' && 'border-destructive/40 bg-destructive/5',
                  ins.severity === 'warning' && 'border-accent/60 bg-accent/10',
                  ins.severity === 'info' && 'border-border bg-muted/40'
                )}
              >
                <div className="flex items-start gap-2.5">
                  {ins.severity === 'urgent' && <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
                  {ins.severity === 'warning' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                  {ins.severity === 'info' && <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{ins.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{ins.detail}</p>
                  </div>
                  {ins.actionLink && (
                    <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => navigate(ins.actionLink!.replace(/^\//, ''))}>
                      Open <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Subscription + latest enquiries */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4 text-primary" /> Subscription</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {d.subscription ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{d.subscription.planName}</span>
                    <Badge variant="secondary" className={cn('border-transparent', d.subscription.status === 'ACTIVE' ? 'bg-primary text-primary-foreground' : 'bg-destructive/15 text-destructive')}>
                      {d.subscription.status === 'ACTIVE' ? 'Active' : d.subscription.status}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">Renews {dateLabel(d.subscription.currentPeriodEnd)}</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Listing usage</span>
                      <span>{d.listingUsage.used} of {d.listingUsage.limit ?? '∞'} active</span>
                    </div>
                    <Progress value={d.listingUsage.limit ? Math.min(100, Math.round((d.listingUsage.used / d.listingUsage.limit) * 100)) : 0} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {s.staffCount} of {d.subscription.staffLimit} staff seats · {d.subscription.featuredLimit} featured slots
                  </p>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/dealer?tab=billing')}>Manage billing</Button>
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-muted-foreground">No subscription on this dealership yet — pick a plan to publish listings.</p>
                  <Button size="sm" onClick={() => navigate('/dealer?tab=billing')}>Choose a plan</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-4 w-4 text-primary" /> Latest enquiries</CardTitle>
            </CardHeader>
            <CardContent>
              {d.recentEnquiries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No enquiries yet — they appear here the moment a customer asks about a listing.</p>
              ) : (
                <ul className="divide-y">
                  {d.recentEnquiries.map((e) => (
                    <li key={e.id} className="py-2.5 first:pt-0 last:pb-0">
                      <button className="w-full text-left" onClick={() => navigate('/dealer?tab=enquiries')}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{e.vehicle.make} {e.vehicle.model} {e.vehicle.year}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(e.createdAt)}</span>
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {e.lastMessage ? `${e.lastMessage.senderSide === 'SELLER' ? 'You' : e.lastMessage.senderName}: ${e.lastMessage.body}` : e.customerName}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function VehicleRowActions({ v, onDone }: { v: VehicleItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [confirmSold, setConfirmSold] = useState(false)

  async function patch(action: 'submit' | 'mark_sold') {
    setBusy(true)
    try {
      await apiSend(`/api/vehicles/${v.id}`, 'PATCH', { action })
      toast.success(action === 'submit' ? `${v.refCode} submitted for review.` : `${v.refCode} marked as sold.`)
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setBusy(false)
      setConfirmSold(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Button variant="outline" size="sm" className="h-8" onClick={() => navigate(`vehicle-detail/${v.id}`)}>
        <Eye className="h-3.5 w-3.5" /> View
      </Button>
      {v.status === 'DRAFT' && (
        <Button size="sm" className="h-8" disabled={busy} onClick={() => patch('submit')}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Submit
        </Button>
      )}
      {(v.status === 'PUBLISHED' || v.status === 'RESERVED') && (
        <>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setConfirmSold(true)} disabled={busy}>
            <Check className="h-3.5 w-3.5" /> Mark sold
          </Button>
          <AlertDialog open={confirmSold} onOpenChange={setConfirmSold}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Mark {v.refCode} as sold?</AlertDialogTitle>
                <AlertDialogDescription>
                  The listing will no longer appear in the marketplace search. This is used for honest reporting of your
                  sales.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => patch('mark_sold')}>Mark as sold</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  )
}

function InventoryTab({ orgId, dash }: { orgId: string; dash: FetchState<DashboardData> }) {
  const vehicles = useFetch<{ vehicles: VehicleItem[] }>('/api/vehicles?org=1')
  const usage = dash.data?.listingUsage ?? null

  const moduleMissing = vehicles.error?.status === 404
  const list = vehicles.data?.vehicles ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-48 flex-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Active listings</span>
            <span>{usage ? `${usage.used} of ${usage.limit ?? '∞'} used` : '—'}</span>
          </div>
          <Progress className="mt-1" value={usage?.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0} />
        </div>
        <Button onClick={() => navigate('/sell')} className="min-h-11">
          <Plus className="h-4 w-4" /> Add vehicle
        </Button>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Listings go through CARMAZE review before publishing — submitted vehicles appear in the marketplace once approved.
        </AlertDescription>
      </Alert>

      {vehicles.loading && !vehicles.data ? (
        <LoadingBlock label="Loading your inventory…" />
      ) : moduleMissing ? (
        <ModuleNotice loading title="Inventory module is loading…" detail="The listings service is being integrated — your vehicles will appear here shortly." retry={vehicles.reload} />
      ) : vehicles.error ? (
        <ModuleNotice title="Could not load inventory" detail={vehicles.error.message} retry={vehicles.reload} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Car className="h-8 w-8" />} title="No vehicles yet" detail="Add your first vehicle — it will go through CARMAZE review before it is published." />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden md:block">
            <CardContent className="px-0 py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Vehicle</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                    <TableHead className="pr-4 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((v) => {
                    const thumb = photoUrl(v.photos?.[0])
                    return (
                      <TableRow key={v.id}>
                        <TableCell className="pl-4">
                          <div className="flex items-center gap-3">
                            {thumb ? (
                               
                              <img src={thumb} alt={`${v.make} ${v.model}`} className="h-10 w-14 shrink-0 rounded-md object-cover" />
                            ) : (
                              <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Car className="h-4 w-4" /></div>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{vehicleTitle(v)}</p>
                              <p className="font-mono text-[11px] text-muted-foreground">{v.refCode}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{money(v.priceMinor, v.currency)}</TableCell>
                        <TableCell><StatusBadge status={v.status} labels={VEHICLE_STATUS_LABELS} classes={VEHICLE_BADGE_CLASS} /></TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{num(v.views)}</TableCell>
                        <TableCell className="pr-4"><VehicleRowActions v={v} onDone={vehicles.reload} /></TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {list.map((v) => {
              const thumb = photoUrl(v.photos?.[0])
              return (
                <Card key={v.id} className="py-3">
                  <CardContent className="flex gap-3 px-3">
                    {thumb ? (
                       
                      <img src={thumb} alt={`${v.make} ${v.model}`} className="h-16 w-20 shrink-0 rounded-md object-cover" />
                    ) : (
                      <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Car className="h-5 w-5" /></div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{vehicleTitle(v)}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">{v.refCode}</p>
                        </div>
                        <StatusBadge status={v.status} labels={VEHICLE_STATUS_LABELS} classes={VEHICLE_BADGE_CLASS} />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-sm">
                        <span className="font-semibold">{money(v.priceMinor, v.currency)}</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground"><Eye className="h-3.5 w-3.5" /> {num(v.views)}</span>
                      </div>
                      <div className="mt-2">
                        <VehicleRowActions v={v} onDone={vehicles.reload} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function EnquiriesTab({ orgId }: { orgId: string }) {
  const enquiries = useFetch<{ enquiries: EnquiryItem[] }>('/api/enquiries?forOrg=1')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  const moduleMissing = enquiries.error?.status === 404
  const list = enquiries.data?.enquiries ?? []
  const selected = list.find((e) => e.id === selectedId) ?? list[0] ?? null
  const openCount = list.filter((e) => e.status === 'OPEN').length

  async function sendReply() {
    if (!selected) return
    const body = reply.trim()
    if (body.length < 2) {
      toast.error('Write a reply first.')
      return
    }
    setSending(true)
    try {
      await apiSend(`/api/enquiries/${selected.id}`, 'POST', { body })
      toast.success('Reply sent to the customer.')
      setReply('')
      enquiries.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send the reply.')
    } finally {
      setSending(false)
    }
  }

  if (enquiries.loading && !enquiries.data) return <LoadingBlock label="Loading enquiries…" />
  if (moduleMissing) {
    return <ModuleNotice loading title="Enquiry inbox is loading…" detail="The messaging service is being integrated — customer enquiries will appear here." retry={enquiries.reload} />
  }
  if (enquiries.error) return <ModuleNotice title="Could not load enquiries" detail={enquiries.error.message} retry={enquiries.reload} />

  return (
    <div className="space-y-4">
      {openCount > 0 && (
        <Alert className="border-accent/60 bg-accent/10">
          <MessageSquareReply className="h-4 w-4" />
          <AlertDescription>
            {openCount} open {openCount === 1 ? 'enquiry' : 'enquiries'} — respond promptly. Customers who get a reply
            within 24 hours are far more likely to visit the yard.
          </AlertDescription>
        </Alert>
      )}

      {list.length === 0 ? (
        <EmptyState icon={<MessageSquare className="h-8 w-8" />} title="No enquiries yet" detail="When customers ask about your listings, conversations appear here." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,380px)_1fr]">
          {/* List */}
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 scrollbar-thin lg:max-h-[560px]">
            {list.map((e) => (
              <button
                key={e.id}
                onClick={() => setSelectedId(e.id)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors hover:border-primary/40',
                  selected?.id === e.id ? 'border-primary/60 bg-primary/5' : 'bg-card'
                )}
                aria-current={selected?.id === e.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px] text-muted-foreground">{e.refCode}</span>
                  <StatusBadge status={e.status} labels={{ OPEN: 'Open', ANSWERED: 'Answered', CLOSED: 'Closed' }} classes={GENERIC_BADGE_CLASS} />
                </div>
                <p className="mt-1 truncate text-sm font-medium">{e.vehicle ? vehicleTitle(e.vehicle) : 'Vehicle enquiry'}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {e.messages && e.messages.length > 0 ? e.messages[e.messages.length - 1].body : e.message}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">{e.user?.name ?? 'Customer'} · {timeAgo(e.createdAt)}</p>
              </button>
            ))}
          </div>

          {/* Thread */}
          {selected && (
            <Card className="flex min-h-80 flex-col">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{selected.vehicle ? vehicleTitle(selected.vehicle) : 'Enquiry'} · <span className="font-mono text-xs font-normal text-muted-foreground">{selected.refCode}</span></CardTitle>
                  <StatusBadge status={selected.status} labels={{ OPEN: 'Open', ANSWERED: 'Answered', CLOSED: 'Closed' }} classes={GENERIC_BADGE_CLASS} />
                </div>
                <CardDescription>
                  {selected.vehicle ? <>Listed at {money(selected.vehicle.priceMinor, selected.vehicle.currency)}</> : null}
                  {selected.phoneShare && selected.phone ? <> · Customer phone: <a className="underline" href={`tel:${selected.phone}`}>{selected.phone}</a></> : ' · Customer has not shared a phone number'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="max-h-72 min-h-40 flex-1 space-y-3 overflow-y-auto rounded-lg bg-muted/40 p-3 scrollbar-thin">
                  {(selected.messages ?? []).map((m) => (
                    <div key={m.id} className={cn('flex', m.senderSide === 'SELLER' ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[80%] rounded-2xl px-3 py-2 text-sm', m.senderSide === 'SELLER' ? 'bg-primary text-primary-foreground' : 'bg-card shadow-sm')}>
                        <p className="whitespace-pre-wrap">{m.body}</p>
                        <p className={cn('mt-1 text-[10px]', m.senderSide === 'SELLER' ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                          {m.senderSide === 'SELLER' ? 'You' : m.senderName} · {timeAgo(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Reply to the customer…"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                    aria-label="Reply message"
                  />
                  <Button onClick={sendReply} disabled={sending} className="min-h-11 shrink-0">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    <span className="hidden sm:inline">Send</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function OffersTab({ orgId }: { orgId: string }) {
  const offers = useFetch<{ offers: OfferItem[] }>('/api/offers?org=1')
  const moduleMissing = offers.error?.status === 404
  const list = offers.data?.offers ?? []

  if (offers.loading && !offers.data) return <LoadingBlock label="Loading offers…" />
  if (moduleMissing) {
    return <ModuleNotice loading title="Offers module is loading…" detail="Offers you send on matched private cars will be tracked here." retry={offers.reload} />
  }
  if (offers.error) return <ModuleNotice title="Could not load offers" detail={offers.error.message} retry={offers.reload} />

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Offers your dealership has sent on private vehicles that opted into dealer matching.
      </p>
      {list.length === 0 ? (
        <EmptyState icon={<Handshake className="h-8 w-8" />} title="No offers sent yet" detail='Browse the marketplace and send offers on cars flagged "match with dealers".' />
      ) : (
        <>
          <Card className="hidden md:block">
            <CardContent className="px-0 py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Vehicle</TableHead>
                    <TableHead>Your offer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="pr-4 text-right">Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="pl-4 text-sm font-medium">{o.vehicle ? vehicleTitle(o.vehicle) : '—'}</TableCell>
                      <TableCell className="text-sm font-semibold">{money(o.amountMinor)}</TableCell>
                      <TableCell><StatusBadge status={o.status} labels={{ PENDING: 'Pending', ACCEPTED: 'Accepted', REJECTED: 'Rejected', EXPIRED: 'Expired', WITHDRAWN: 'Withdrawn' }} classes={GENERIC_BADGE_CLASS} /></TableCell>
                      <TableCell className="text-sm">{o.expiresAt ? dateLabel(o.expiresAt) : '—'}</TableCell>
                      <TableCell className="pr-4 text-right text-sm text-muted-foreground">{timeAgo(o.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="space-y-3 md:hidden">
            {list.map((o) => (
              <Card key={o.id} className="py-3">
                <CardContent className="px-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{o.vehicle ? vehicleTitle(o.vehicle) : 'Vehicle'}</p>
                    <StatusBadge status={o.status} labels={{ PENDING: 'Pending', ACCEPTED: 'Accepted', REJECTED: 'Rejected', EXPIRED: 'Expired', WITHDRAWN: 'Withdrawn' }} classes={GENERIC_BADGE_CLASS} />
                  </div>
                  <p className="mt-1 text-lg font-semibold">{money(o.amountMinor)}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.expiresAt ? `Expires ${dateLabel(o.expiresAt)}` : 'No expiry'} · sent {timeAgo(o.createdAt)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function BuyingTab({ orgId }: { orgId: string }) {
  const mine = useFetch<{ requests: BuyingRequestItem[] }>(`/api/buying-requests?mine=1&orgId=${orgId}`)
  const board = useFetch<{ requests: BuyingRequestItem[] }>('/api/buying-requests?board=1')
  const [createOpen, setCreateOpen] = useState(false)
  const [closingId, setClosingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState({ make: '', model: '', yearFrom: '', yearTo: '', budget: '', notes: '' })
  const moduleMissing = mine.error?.status === 404

  const mineList = mine.data?.requests ?? []
  const boardList = (board.data?.requests ?? []).filter((r) => r.status === 'OPEN' && r.org?.id !== orgId)

  async function closeRequest() {
    if (!closingId) return
    setBusy(true)
    try {
      await apiSend(`/api/buying-requests?id=${closingId}`, 'PATCH', { status: 'CLOSED' })
      toast.success('Buying request closed.')
      setClosingId(null)
      mine.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not close the request.')
    } finally {
      setBusy(false)
    }
  }

  async function createRequest() {
    if (form.make.trim().length < 2) {
      toast.error('Choose the make you are sourcing.')
      return
    }
    setBusy(true)
    try {
      const budgetValue = parseFloat(form.budget)
      await apiSend('/api/buying-requests', 'POST', {
        make: form.make,
        model: form.model.trim() || undefined,
        yearFrom: form.yearFrom ? parseInt(form.yearFrom, 10) : undefined,
        yearTo: form.yearTo ? parseInt(form.yearTo, 10) : undefined,
        budgetMinor: Number.isFinite(budgetValue) ? Math.round(budgetValue * 100) : undefined,
        notes: form.notes.trim() || undefined,
      })
      toast.success('Buying request posted to the dealer board.')
      setCreateOpen(false)
      setForm({ make: '', model: '', yearFrom: '', yearTo: '', budget: '', notes: '' })
      mine.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not post the request.')
    } finally {
      setBusy(false)
    }
  }

  if (mine.loading && !mine.data) return <LoadingBlock label="Loading buying requests…" />
  if (moduleMissing) {
    return <ModuleNotice loading title="Buying board is loading…" detail="The dealer sourcing board is being integrated." retry={mine.reload} />
  }
  if (mine.error) return <ModuleNotice title="Could not load buying requests" detail={mine.error.message} retry={mine.reload} />

  const yearNow = new Date().getFullYear()

  return (
    <div className="space-y-6">
      <section aria-labelledby="our-requests">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="our-requests" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Our requests</h2>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="min-h-11"><Plus className="h-4 w-4" /> New request</Button>
        </div>
        {mineList.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon={<ClipboardList className="h-8 w-8" />} title="No buying requests" detail="Post what you are sourcing — private sellers with matching cars get notified." />
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {mineList.map((r) => (
              <Card key={r.id} className="py-4">
                <CardContent className="px-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{r.make}{r.model ? ` ${r.model}` : ''}</p>
                      <p className="text-xs text-muted-foreground">
                        {[r.yearFrom || r.yearTo ? `${r.yearFrom ?? '…'}–${r.yearTo ?? '…'}` : null, r.budgetMinor ? `up to ${money(r.budgetMinor)}` : null].filter(Boolean).join(' · ') || 'Any year'}
                      </p>
                    </div>
                    <StatusBadge status={r.status} labels={{ OPEN: 'Open', CLOSED: 'Closed' }} classes={GENERIC_BADGE_CLASS} />
                  </div>
                  {r.notes && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{r.notes}</p>}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Posted {timeAgo(r.createdAt)}</span>
                    {r.status === 'OPEN' && (
                      <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={() => setClosingId(r.id)}>
                        <Trash2 className="h-3.5 w-3.5" /> Close
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Separator />

      <section aria-labelledby="dealer-board">
        <h2 id="dealer-board" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Dealer board</h2>
        <p className="mt-1 text-xs text-muted-foreground">What other verified dealerships are sourcing right now — useful for market awareness. Read-only.</p>
        {board.loading && !board.data ? (
          <div className="mt-3"><Skeleton className="h-16 w-full" /></div>
        ) : board.error?.status === 404 ? (
          <div className="mt-3"><Skeleton className="h-16 w-full" /></div>
        ) : boardList.length === 0 ? (
          <div className="mt-3"><EmptyState icon={<ClipboardList className="h-8 w-8" />} title="No open requests from other dealers" /></div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {boardList.map((r) => (
              <Card key={r.id} className="py-4">
                <CardContent className="px-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{r.make}{r.model ? ` ${r.model}` : ''}</p>
                    {r.budgetMinor && <span className="text-xs font-medium">{money(r.budgetMinor)}</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.yearFrom || r.yearTo ? `${r.yearFrom ?? '…'}–${r.yearTo ?? '…'}` : 'Any year'}
                    {r.org?.name ? ` · ${r.org.name}` : ''}
                  </p>
                  {r.notes && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{r.notes}</p>}
                  <p className="mt-2 text-[11px] text-muted-foreground">{timeAgo(r.createdAt)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New buying request</DialogTitle>
            <DialogDescription>Tell sellers what you are sourcing. Matched private listings can be offered to you directly.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Make *</Label>
              <Select value={form.make} onValueChange={(v) => setForm((f) => ({ ...f, make: v }))}>
                <SelectTrigger aria-label="Make"><SelectValue placeholder="Select make" /></SelectTrigger>
                <SelectContent className="max-h-64 scrollbar-thin">
                  {VEHICLE_MAKES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="br-model">Model</Label>
              <Input id="br-model" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="e.g. Land Cruiser Prado" maxLength={80} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="br-yf">Year from</Label>
                <Input id="br-yf" type="number" min={1980} max={yearNow} value={form.yearFrom} onChange={(e) => setForm((f) => ({ ...f, yearFrom: e.target.value }))} placeholder="2015" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="br-yt">Year to</Label>
                <Input id="br-yt" type="number" min={1980} max={yearNow} value={form.yearTo} onChange={(e) => setForm((f) => ({ ...f, yearTo: e.target.value }))} placeholder="2019" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="br-budget">Budget (KES)</Label>
              <Input id="br-budget" type="number" min={0} step="10000" value={form.budget} onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))} placeholder="700000" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="br-notes">Notes</Label>
              <Textarea id="br-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="e.g. Clean units only, mileage under 120k, any colour." maxLength={500} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createRequest} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Post request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close confirm */}
      <AlertDialog open={Boolean(closingId)} onOpenChange={(o) => { if (!o) setClosingId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this buying request?</AlertDialogTitle>
            <AlertDialogDescription>It will no longer appear on the dealer board. You can post a new request any time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep open</AlertDialogCancel>
            <AlertDialogAction onClick={closeRequest} className="bg-destructive text-white hover:bg-destructive/90">Close request</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function StaffTab({ orgId, viewerRole }: { orgId: string; viewerRole: string }) {
  const staff = useFetch<{ members: StaffMember[]; staffLimit: number }>(`/api/orgs/staff?orgId=${orgId}`)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: 'SALES' })
  const [busy, setBusy] = useState(false)
  const [oneTime, setOneTime] = useState<{ email: string; password: string } | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)

  const canManage = viewerRole === 'OWNER' || viewerRole === 'MANAGER'
  const isOwner = viewerRole === 'OWNER'
  const members = staff.data?.members ?? []
  const limit = staff.data?.staffLimit ?? null

  async function invite() {
    if (form.name.trim().length < 2) { toast.error('Enter the team member’s full name.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { toast.error('Enter a valid email address.'); return }
    setBusy(true)
    try {
      const res = await apiSend<{ member: StaffMember; oneTimePassword?: string; note?: string }>('/api/orgs/staff', 'POST', {
        orgId, email: form.email.trim(), name: form.name.trim(), role: form.role,
      })
      if (res.oneTimePassword) {
        setOneTime({ email: res.member.email, password: res.oneTimePassword })
      } else {
        toast.success(`${res.member.name} added to your team.`)
      }
      setInviteOpen(false)
      setForm({ name: '', email: '', role: 'SALES' })
      staff.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the team member.')
    } finally {
      setBusy(false)
    }
  }

  async function removeMember() {
    if (!removeId) return
    setBusy(true)
    try {
      await apiSend(`/api/orgs/staff?memberId=${removeId}&orgId=${orgId}`, 'DELETE')
      toast.success('Team member removed.')
      setRemoveId(null)
      staff.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the member.')
    } finally {
      setBusy(false)
    }
  }

  if (staff.loading && !staff.data) return <LoadingBlock label="Loading your team…" />
  if (staff.error?.status === 403) {
    return <ModuleNotice title="Owner or manager access required" detail="Ask the dealership owner to manage team accounts — you can still use the rest of DealerOS." />
  }
  if (staff.error?.status === 404) {
    return <ModuleNotice loading title="Staff module is loading…" retry={staff.reload} />
  }
  if (staff.error) return <ModuleNotice title="Could not load the team" detail={staff.error.message} retry={staff.reload} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {limit ? `${members.length} of ${limit} staff seats used` : `${members.length} team members`}
        </p>
        {isOwner && (
          <Button onClick={() => setInviteOpen(true)} className="min-h-11" disabled={Boolean(limit && members.length >= limit)}>
            <Plus className="h-4 w-4" /> Invite team member
          </Button>
        )}
      </div>

      {limit && members.length >= limit && (
        <Alert className="border-accent/60 bg-accent/10">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>You have used all staff seats on this plan. Upgrade in Billing to add more team members.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="px-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                {isOwner && <TableHead className="pr-4 text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="pl-4">
                    <span className="text-sm font-medium">{m.name}</span>
                    {m.status === 'SUSPENDED' && <Badge variant="secondary" className="ml-2 border-transparent bg-destructive/15 text-destructive">Suspended</Badge>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={cn('border-transparent', ROLE_BADGE[m.role] ?? 'bg-muted text-muted-foreground')}>
                      {m.role.charAt(0) + m.role.slice(1).toLowerCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{dateLabel(m.createdAt)}</TableCell>
                  {isOwner && (
                    <TableCell className="pr-4 text-right">
                      {m.role !== 'OWNER' && (
                        <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={() => setRemoveId(m.id)}>
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {!canManage && <p className="text-xs text-muted-foreground">Only the owner or a manager can invite or remove staff.</p>}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>They get their own CARMAZE login scoped to this dealership.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="st-name">Full name *</Label>
              <Input id="st-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Brian Otieno" maxLength={80} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="st-email">Email *</Label>
              <Input id="st-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="name@dealership.co.ke" maxLength={120} />
            </div>
            <div className="grid gap-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger aria-label="Role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SALES">Sales — handle enquiries</SelectItem>
                  <SelectItem value="MANAGER">Manager — full operations access</SelectItem>
                  <SelectItem value="FINANCE">Finance — billing and offers</SelectItem>
                  <SelectItem value="STAFF">Staff — basic access</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={invite} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />} Add member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time password */}
      <AlertDialog open={Boolean(oneTime)} onOpenChange={(o) => { if (!o) setOneTime(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Share this password securely</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  A CARMAZE account was created for <strong>{oneTime?.email}</strong>. This temporary password is shown
                  <strong> only once</strong> — copy it now and share it through a private channel.
                </p>
                <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
                  <code className="flex-1 select-all font-mono text-sm font-semibold">{oneTime?.password}</code>
                  <Button variant="outline" size="sm" className="h-8" onClick={() => oneTime && copyText(oneTime.password)}>
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </Button>
                </div>
                <p className="text-xs">They will be asked to change it from their account settings after signing in.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setOneTime(null)}>Done</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove confirm */}
      <AlertDialog open={Boolean(removeId)} onOpenChange={(o) => { if (!o) setRemoveId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this team member?</AlertDialogTitle>
            <AlertDialogDescription>
              They immediately lose access to this dealership&apos;s Dashboard, enquiries and inventory. Their customer
              account is not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={removeMember} className="bg-destructive text-white hover:bg-destructive/90">Remove member</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function BillingTab({ orgId, dash }: { orgId: string; dash: FetchState<DashboardData> }) {
  const plans = useFetch<{ plans: PlanItem[]; packages?: unknown[] }>('/api/billing/plans')
  const invoices = useFetch<{ invoices: InvoiceItem[] }>('/api/billing/invoices?org=1')
  const [busyCode, setBusyCode] = useState<string | null>(null)
  const [payInvoice, setPayInvoice] = useState<InvoiceItem | null>(null)
  const [phone, setPhone] = useState('')
  const [payBusy, setPayBusy] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  const subscription = dash.data?.subscription ?? null
  const dealerPlans = (plans.data?.plans ?? []).filter((p) => p.audience === 'DEALER' && p.active)
  const invoiceList = invoices.data?.invoices ?? []

  async function subscribe(planCode: string) {
    setBusyCode(planCode)
    try {
      const res = await apiSend<{ message?: string; invoice?: { refCode?: string } }>('/api/billing/subscribe', 'POST', { planCode })
      toast.success(res.message ?? `Subscribed to ${planCode} — an invoice was created and is awaiting payment.`)
      dash.reload()
      invoices.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change the subscription.')
    } finally {
      setBusyCode(null)
    }
  }

  async function payMpesa() {
    if (!payInvoice) return
    const cleaned = phone.replace(/\s+/g, '')
    if (!/^(?:\+?254|0)(?:7|1)\d{8}$/.test(cleaned)) {
      setPayError('Enter a valid Safaricom number, e.g. 0712 345 678 or +254712345678.')
      return
    }
    setPayBusy(true)
    setPayError(null)
    try {
      const res = await apiSend<{ message?: string }>('/api/billing/mpesa/stkpush', 'POST', { invoiceId: payInvoice.id, phone: cleaned })
      toast.success(res.message ?? `STK push sent to ${cleaned} — enter your M-Pesa PIN to complete payment for ${payInvoice.refCode}.`)
      setPayInvoice(null)
      setPhone('')
      invoices.reload()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not start the M-Pesa payment.'
      setPayError(message)
      toast.error(message)
    } finally {
      setPayBusy(false)
    }
  }

  const billingMissing = plans.error?.status === 404 && invoices.error?.status === 404

  return (
    <div className="space-y-6">
      {billingMissing && (
        <Card className="border-dashed">
          <CardContent className="px-6 py-10">
            <LoadingBlock label="Billing module loading…" />
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Plans and invoices are served by the billing service — it is being integrated and will appear here.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Current subscription */}
      {dash.data && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4 text-primary" /> Current subscription</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {subscription ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div>
                  <p className="font-semibold">{subscription.planName}</p>
                  <p className="text-xs text-muted-foreground">Renews {dateLabel(subscription.currentPeriodEnd)}</p>
                </div>
                <Badge variant="secondary" className={cn('border-transparent', subscription.status === 'ACTIVE' ? 'bg-primary text-primary-foreground' : 'bg-destructive/15 text-destructive')}>
                  {subscription.status === 'ACTIVE' ? 'Active' : subscription.status}
                </Badge>
                <span className="text-xs text-muted-foreground">{dash.data.listingUsage.used} of {subscription.listingLimit} listings · {dash.data.stats.staffCount} of {subscription.staffLimit} staff</span>
              </div>
            ) : (
              <p className="text-muted-foreground">No active subscription — choose a plan below to publish listings.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Plans */}
      {plans.error?.status === 404 ? null : plans.error ? (
        <ModuleNotice title="Could not load plans" detail={plans.error.message} retry={plans.reload} />
      ) : plans.loading && !plans.data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-44" /><Skeleton className="h-44" /><Skeleton className="h-44" /></div>
      ) : (
        <section aria-label="Available plans">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Plans</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dealerPlans.map((p) => {
              const isCurrent = subscription?.planCode === p.code
              let features: string[] = []
              try { features = p.features ? (JSON.parse(p.features) as string[]) : [] } catch { features = [] }
              return (
                <Card key={p.code} className={cn('py-4', isCurrent && 'border-primary ring-1 ring-primary/30')}>
                  <CardContent className="flex h-full flex-col px-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{p.name}</p>
                      {isCurrent && <Badge className="border-transparent bg-primary text-primary-foreground">Current plan</Badge>}
                    </div>
                    <p className="mt-1 text-lg font-semibold">{money(p.priceMinor, p.currency)}<span className="text-xs font-normal text-muted-foreground"> / {p.intervalMonths === 1 ? 'month' : `${p.intervalMonths} months`}</span></p>
                    <ul className="mt-2 flex-1 space-y-1 text-xs text-muted-foreground">
                      {features.map((f) => (
                        <li key={f} className="flex items-start gap-1.5"><Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" /> {f}</li>
                      ))}
                    </ul>
                    {!isCurrent && (
                      <Button size="sm" className="mt-3 w-full" disabled={busyCode === p.code} onClick={() => subscribe(p.code)}>
                        {busyCode === p.code ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {subscription ? `Switch to ${p.name}` : `Choose ${p.name}`}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>
      )}

      {/* Invoices */}
      {invoices.error?.status === 404 ? null : invoices.error ? (
        <ModuleNotice title="Could not load invoices" detail={invoices.error.message} retry={invoices.reload} />
      ) : invoices.loading && !invoices.data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <section aria-label="Invoices">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Invoices</h2>
          {invoiceList.length === 0 ? (
            <EmptyState icon={<FileText className="h-8 w-8" />} title="No invoices yet" detail="Subscription and campaign invoices appear here with their payment status." />
          ) : (
            <Card>
              <CardContent className="px-0 py-0">
                <div className="overflow-x-auto scrollbar-thin">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Invoice</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Issued</TableHead>
                        <TableHead className="pr-4 text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoiceList.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="pl-4">
                            <p className="font-mono text-xs">{inv.refCode}</p>
                            <p className="max-w-56 truncate text-xs text-muted-foreground">{inv.description}</p>
                          </TableCell>
                          <TableCell className="text-sm font-semibold">{money(inv.amountMinor, inv.currency)}</TableCell>
                          <TableCell><StatusBadge status={inv.status} labels={{ PENDING: 'Pending', PAID: 'Paid', OVERDUE: 'Overdue', CANCELLED: 'Cancelled', REFUNDED: 'Refunded' }} classes={GENERIC_BADGE_CLASS} /></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{dateLabel(inv.issuedAt)}</TableCell>
                          <TableCell className="pr-4 text-right">
                            {inv.status === 'PENDING' && (
                              <Button size="sm" variant="outline" className="h-8" onClick={() => { setPayInvoice(inv); setPayError(null); setPhone('') }}>
                                <Wallet className="h-3.5 w-3.5" /> Pay via M-Pesa
                              </Button>
                            )}
                            {inv.status === 'PAID' && inv.paidAt && <span className="text-xs text-muted-foreground">Paid {dateLabel(inv.paidAt)}</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/* Promotions — buy/manage listing campaigns (same M-Pesa flow) */}
      <PromotionsSection />

      {/* M-Pesa payment dialog */}
      <Dialog open={Boolean(payInvoice)} onOpenChange={(o) => { if (!o) setPayInvoice(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pay {payInvoice ? money(payInvoice.amountMinor, payInvoice.currency) : ''} via M-Pesa</DialogTitle>
            <DialogDescription>
              {payInvoice ? `Invoice ${payInvoice.refCode} — ${payInvoice.description}` : ''} An STK push will be sent to your phone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mpesa-phone">M-Pesa phone number</Label>
              <Input id="mpesa-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
            </div>
            {payError && (
              <Alert variant="destructive">
                <CircleAlert className="h-4 w-4" />
                <AlertDescription>{payError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayInvoice(null)}>Cancel</Button>
            <Button onClick={payMpesa} disabled={payBusy}>
              {payBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />} Send STK push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ProfileTab({ org, viewerRole, onSaved }: { org: DealerOrg; viewerRole: string; onSaved: () => void }) {
  const canEdit = viewerRole === 'OWNER' || viewerRole === 'MANAGER'
  const [form, setForm] = useState({
    name: org.name ?? '',
    description: org.description ?? '',
    location: org.location ?? '',
    phone: org.phone ?? '',
    email: org.email ?? '',
    town: org.town ?? '',
    county: org.county ?? 'Nairobi',
  })
  const [busy, setBusy] = useState(false)

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    if (form.name.trim().length < 2) {
      toast.error('The showroom name must be at least 2 characters.')
      return
    }
    setBusy(true)
    try {
      await apiSend('/api/orgs/profile', 'PATCH', {
        orgId: org.id,
        name: form.name.trim(),
        description: form.description.trim(),
        location: form.location.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        town: form.town.trim(),
        county: form.county,
      })
      toast.success('Dealership profile updated — changes are live on your public showroom.')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {!canEdit && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>Only the dealership owner or a manager can edit the public profile. Fields are read-only for you.</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-primary" /> Public profile</CardTitle>
          <CardDescription>Shown on your public showroom page and listing pages.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pf-name">Showroom name *</Label>
              <Input id="pf-name" value={form.name} onChange={(e) => set('name', e.target.value)} disabled={!canEdit} maxLength={120} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pf-reg">Registration number</Label>
              <Input id="pf-reg" value={org.regNo ?? ''} disabled />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pf-desc">Description</Label>
            <Textarea id="pf-desc" rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} disabled={!canEdit} placeholder="What makes your dealership different — specialisations, warranties, trade-ins…" maxLength={2000} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pf-loc">Physical address</Label>
            <Input id="pf-loc" value={form.location} onChange={(e) => set('location', e.target.value)} disabled={!canEdit} placeholder="e.g. Mombasa Road, next to Gateway Mall" maxLength={200} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pf-county">County</Label>
              <Select value={form.county} onValueChange={(v) => set('county', v)} disabled={!canEdit}>
                <SelectTrigger aria-label="County"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64 scrollbar-thin">
                  {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pf-town">Town / area</Label>
              <Input id="pf-town" value={form.town} onChange={(e) => set('town', e.target.value)} disabled={!canEdit} maxLength={60} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pf-phone">Business phone</Label>
              <Input id="pf-phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} disabled={!canEdit} maxLength={20} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pf-email">Business email</Label>
              <Input id="pf-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} disabled={!canEdit} maxLength={120} />
            </div>
          </div>
          {canEdit && (
            <div>
              <Button onClick={save} disabled={busy} className="min-h-11">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save changes
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ───────────────────────────── State C — Dashboard shell ─────────────────────────────

function DealerDashboard({ memberships, activeOrgId, onOrgChange, onRefresh }: {
  memberships: Membership[]
  activeOrgId: string
  onOrgChange: (orgId: string) => void
  onRefresh: () => void
}) {
  const route = useHashRoute()
  const dash = useFetch<DashboardData>(`/api/dealer/dashboard?orgId=${activeOrgId}`)
  const membership = memberships.find((m) => m.orgId === activeOrgId)
  const viewerRole = dash.data?.viewerRole ?? membership?.role ?? 'STAFF'

  const tabParam = route.query.get('tab')
  const tab: TabKey = TABS.includes(tabParam as TabKey) ? (tabParam as TabKey) : 'overview'
  const goTab = (t: string) => navigate(`/dealer?tab=${t}`, { replace: true })
  const unreadMessages = useUnreadConversations('org')

  const stats = dash.data?.stats

  return (
    <div className="mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 sm:py-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">DealerOS</h1>
            {dash.data?.org.status === 'ACTIVE' && (
              <Badge variant="secondary" className="gap-1 border-transparent bg-primary/10 text-primary">
                <ShieldCheck className="h-3.5 w-3.5" /> Verified dealership
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {dash.data ? (
              <>
                {dash.data.org.name} · {[dash.data.org.town, dash.data.org.county].filter(Boolean).join(', ')}
                {dash.data.subscription ? ` · ${dash.data.subscription.planName} renews ${dateLabel(dash.data.subscription.currentPeriodEnd)}` : ''}
              </>
            ) : (
              'Loading dealership…'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {memberships.length > 1 && (
            <Select value={activeOrgId} onValueChange={onOrgChange}>
              <SelectTrigger className="h-10 w-44 sm:w-52" aria-label="Switch dealership">
                <SelectValue placeholder="Dealership" />
              </SelectTrigger>
              <SelectContent>
                {memberships.map((m) => (
                  <SelectItem key={m.orgId} value={m.orgId}>{m.org.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={() => navigate('/sell')} className="hidden min-h-11 sm:inline-flex">
            <Plus className="h-4 w-4" /> New listing
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={goTab} className="mt-6">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1 scrollbar-thin">
          {([
            ['overview', 'Overview'],
            ['inventory', 'Inventory'],
            ['enquiries', 'Enquiries'],
            ['inbox', 'Inbox'],
            ['offers', 'Offers'],
            ['testdrives', 'Test drives'],
            ['buying', 'Buying board'],
            ['staff', 'Staff'],
            ['billing', 'Billing'],
            ['profile', 'Profile'],
          ] as [TabKey, string][]).map(([key, label]) => (
            <TabsTrigger key={key} value={key} className="min-h-9 shrink-0 gap-1.5 px-3">
              {label}
              {key === 'inbox' && unreadMessages > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground" aria-label={`${unreadMessages} unread`}>
                  {unreadMessages > 9 ? '9+' : unreadMessages}
                </span>
              )}
              {key === 'enquiries' && stats && stats.enquiriesOpen > 0 && (
                <Badge variant="secondary" className="h-5 min-w-5 border-transparent bg-accent px-1 text-[10px] font-bold text-accent-foreground">{stats.enquiriesOpen}</Badge>
              )}
              {key === 'offers' && stats && stats.offersPending > 0 && (
                <Badge variant="secondary" className="h-5 min-w-5 border-transparent bg-accent px-1 text-[10px] font-bold text-accent-foreground">{stats.offersPending}</Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab key={activeOrgId} orgId={activeOrgId} dash={dash} />
        </TabsContent>
        <TabsContent value="inventory" className="mt-4">
          <InventoryTab key={activeOrgId} orgId={activeOrgId} dash={dash} />
        </TabsContent>
        <TabsContent value="enquiries" className="mt-4">
          <EnquiriesTab key={activeOrgId} orgId={activeOrgId} />
        </TabsContent>
        <TabsContent value="inbox" className="mt-4">
          <FadeIn><MessagesTab key={activeOrgId} scope="org" /></FadeIn>
        </TabsContent>
        <TabsContent value="testdrives" className="mt-4">
          <FadeIn><TestDrivesTab key={activeOrgId} orgId={activeOrgId} /></FadeIn>
        </TabsContent>
        <TabsContent value="offers" className="mt-4">
          <OffersTab key={activeOrgId} orgId={activeOrgId} />
        </TabsContent>
        <TabsContent value="buying" className="mt-4">
          <BuyingTab key={activeOrgId} orgId={activeOrgId} />
        </TabsContent>
        <TabsContent value="staff" className="mt-4">
          <StaffTab key={activeOrgId} orgId={activeOrgId} viewerRole={viewerRole} />
        </TabsContent>
        <TabsContent value="billing" className="mt-4">
          <BillingTab key={activeOrgId} orgId={activeOrgId} dash={dash} />
        </TabsContent>
        <TabsContent value="profile" className="mt-4">
          {dash.data && <ProfileTab key={`${activeOrgId}-${dash.data.org.id}`} org={dash.data.org} viewerRole={viewerRole} onSaved={onRefresh} />}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ───────────────────────────── Root view ─────────────────────────────

export default function View() {
  const { user, loading: authLoading } = useAuth()
  const [me, setMe] = useState<Me | null>(null)
  const [meError, setMeError] = useState<string | null>(null)
  const [meLoading, setMeLoading] = useState(true)
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const refresh = useCallback(() => setReloadToken((t) => t + 1), [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    apiGet<Me>('/api/orgs/me')
      .then((d) => {
        if (cancelled) return
        setMe(d)
        setMeError(null)
        setActiveOrgId((prev) => {
          if (prev) return prev
          const firstDealer = d.memberships.find((m) => m.org?.type === 'DEALER')
          return firstDealer?.orgId ?? null
        })
      })
      .catch((e: { message?: string }) => {
        if (!cancelled) setMeError(e?.message ?? 'Could not load your dealership profile.')
      })
      .finally(() => {
        if (!cancelled) setMeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user, reloadToken])

  const dealerMemberships = useMemo(() => (me?.memberships ?? []).filter((m) => m.org?.type === 'DEALER'), [me])
  const current = dealerMemberships.find((m) => m.orgId === activeOrgId) ?? dealerMemberships[0] ?? null
  const app = me?.application ?? null

  if (authLoading || (user && meLoading && !me && !meError)) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-4 px-3 py-8 sm:px-6" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Building2 className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to open DealerOS</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          DealerOS is the workspace for verified CARMAZE dealerships — listings, enquiries, your team and billing in one place.
        </p>
        <Button size="lg" className="min-h-11" onClick={() => navigate('/signin?next=/dealer')}>
          <LogIn className="h-4 w-4" /> Sign in
        </Button>
        <p className="text-xs text-muted-foreground">New to CARMAZE? Apply for dealership verification after creating your free account.</p>
      </div>
    )
  }

  if (meError) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16">
        <ModuleNotice title="DealerOS could not load" detail={meError} retry={refresh} />
      </div>
    )
  }

  // State C — approved dealership(s)
  if (current) {
    if (current.org.status !== 'ACTIVE') {
      return (
        <div className="mx-auto w-full max-w-lg px-4 py-16">
          <Alert variant="destructive">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>{current.org.name} is currently {current.org.status.toLowerCase()}</AlertTitle>
            <AlertDescription>
              Your dealership workspace is paused. Contact CARMAZE support to resolve this — your data is safe.
            </AlertDescription>
          </Alert>
        </div>
      )
    }
    if (activeOrgId) {
      return (
        <DealerDashboard
          memberships={dealerMemberships}
          activeOrgId={activeOrgId}
          onOrgChange={setActiveOrgId}
          onRefresh={refresh}
        />
      )
    }
  }

  // State B — application in review
  if (app && (REVIEWABLE_STATUSES.includes(app.status) || app.status === 'APPROVED')) {
    return <PendingApplication app={app} onUpdated={refresh} />
  }

  // State A — not applied (or rejected / draft)
  return <NotApplied previousApp={app} onDone={refresh} />
}

// ───────────────────────────── Test drives (org side) ─────────────────────────────

/** Soft fade/rise for new tab panels. */
function FadeIn({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}

type OrgTestDrive = {
  id: string
  refCode: string
  status: string
  scheduledAt: string
  licenceConfirmed: boolean
  customerName: string
  vehicle: { id: string; make: string; model: string; year: number; photo: string | null } | null
  odometerOut: number | null
  odometerIn: number | null
  conditionOut: string | null
  conditionIn: string | null
  releasedBy: string | null
  returnedBy: string | null
  startedAt: string | null
  endedAt: string | null
  notes: string | null
}

const TD_STATUS_META: Record<string, { label: string; badge: string }> = {
  PENDING: { label: 'Requested', badge: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  CONFIRMED: { label: 'Confirmed', badge: 'border-sky-300 bg-sky-500/15 text-sky-800 dark:text-sky-300' },
  IN_PROGRESS: { label: 'In progress', badge: 'border-indigo-300 bg-indigo-500/15 text-indigo-800 dark:text-indigo-300' },
  COMPLETED: { label: 'Completed', badge: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-muted text-muted-foreground' },
  NO_SHOW: { label: 'No-show', badge: 'bg-muted text-muted-foreground' },
}

const TD_STATUS_RANK: Record<string, number> = {
  CONFIRMED: 0,
  PENDING: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
  NO_SHOW: 4,
  CANCELLED: 5,
}

const FUEL_LEVELS = [
  { value: 'FULL', label: 'Full tank' },
  { value: 'THREE_QUARTER', label: 'Three quarters' },
  { value: 'HALF', label: 'Half tank' },
  { value: 'QUARTER', label: 'Quarter tank' },
  { value: 'EMPTY', label: 'Reserve / empty' },
] as const

function TestDrivesTab({ orgId }: { orgId: string }) {
  const [drives, setDrives] = useState<OrgTestDrive[] | null>(null)
  const [tick, setTick] = useState(0)
  const [startFor, setStartFor] = useState<OrgTestDrive | null>(null)
  const [completeFor, setCompleteFor] = useState<OrgTestDrive | null>(null)
  const [cancelFor, setCancelFor] = useState<OrgTestDrive | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiGet<{ testDrives: OrgTestDrive[] }>('/api/test-drives?org=1')
      .then((d) => { if (!cancelled) setDrives(d.testDrives) })
      .catch(() => { if (!cancelled) setDrives([]) })
    return () => { cancelled = true }
  }, [orgId, tick])

  // Poll every 15 seconds so new requests and overdue drives surface quickly.
  useEffect(() => {
    const t = setInterval(() => setTick((k) => k + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  const reload = useCallback(() => setTick((k) => k + 1), [])

  const sorted = useMemo(() => {
    const now = Date.now()
    return [...(drives ?? [])].sort((a, b) => {
      const rankA = TD_STATUS_RANK[a.status] ?? 9
      const rankB = TD_STATUS_RANK[b.status] ?? 9
      if (rankA !== rankB) return rankA - rankB
      if (rankA <= 2) return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
      return new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
    }).map((d) => ({
      ...d,
      overdue: d.status === 'IN_PROGRESS' && d.startedAt && now - new Date(d.startedAt).getTime() > 2 * 3_600_000,
    }))
  }, [drives])

  const pendingCount = (drives ?? []).filter((d) => ['PENDING', 'CONFIRMED'].includes(d.status)).length

  async function patchDrive(id: string, payload: Record<string, unknown>, successMsg: string) {
    setBusy(true)
    try {
      await apiSend(`/api/test-drives/${id}`, 'PATCH', payload)
      toast.success(successMsg)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {pendingCount > 0
          ? `${pendingCount} drive${pendingCount === 1 ? '' : 's'} need action — confirm requests and record odometers at handover and return.`
          : 'Test drives requested from your listings. Record the odometer and condition when keys go out and come back.'}
      </p>

      {drives === null ? (
        <LoadingBlock label="Loading test drives…" />
      ) : sorted.length === 0 ? (
        <EmptyState icon={<Car className="h-8 w-8" />} title="No test drives yet" detail="When customers request a drive on your listings, it appears here for scheduling and key handover." />
      ) : (
        <div className="space-y-3">
          {sorted.map((d) => {
            const meta = TD_STATUS_META[d.status] ?? { label: d.status, badge: 'bg-muted text-muted-foreground' }
            return (
              <Card key={d.id} className="py-4">
                <CardContent className="px-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {d.vehicle?.photo ? (
                         
                        <img src={d.vehicle.photo} alt="" className="h-14 w-20 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <span className="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Car className="h-5 w-5" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold">
                          {d.vehicle ? (
                            <button className="hover:underline" onClick={() => { const v = d.vehicle; if (v) navigate(`vehicle-detail/${v.id}`) }}>
                              {vehicleTitle(d.vehicle)}
                            </button>
                          ) : 'Vehicle removed'}
                        </h3>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{d.customerName}</span>
                          <span className="flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {new Date(d.scheduledAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                          <span className="font-mono">{d.refCode}</span>
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px]', meta.badge)}>{meta.label}</Badge>
                          {d.licenceConfirmed ? (
                            <Badge variant="outline" className="border-primary/40 px-1.5 py-0 text-[10px] text-primary dark:text-[#9dc3ae]">
                              <IdCard className="h-3 w-3" /> Licence verified
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">Licence not verified</Badge>
                          )}
                          {'overdue' in d && d.overdue && (
                            <Badge variant="outline" className="border-destructive/50 bg-destructive/10 px-1.5 py-0 text-[10px] text-destructive">
                              <XCircle className="h-3 w-3" /> Overdue — check return
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {d.status === 'PENDING' && (
                        <>
                          <Button size="sm" className="min-h-9 gap-1.5" disabled={busy} onClick={() => patchDrive(d.id, { action: 'confirm' }, 'Test drive confirmed')}>
                            <Check className="h-3.5 w-3.5" /> Confirm
                          </Button>
                          <Button size="sm" variant="ghost" className="min-h-9 text-destructive hover:text-destructive" disabled={busy} onClick={() => setCancelFor(d)}>
                            <XCircle className="h-3.5 w-3.5" /> Cancel
                          </Button>
                        </>
                      )}
                      {d.status === 'CONFIRMED' && (
                        <>
                          <Button size="sm" className="min-h-9 gap-1.5" disabled={busy} onClick={() => setStartFor(d)}>
                            <Play className="h-3.5 w-3.5" /> Start drive
                          </Button>
                          <Button size="sm" variant="outline" className="min-h-9" disabled={busy} onClick={() => patchDrive(d.id, { action: 'no-show' }, 'Marked as no-show')}>
                            No-show
                          </Button>
                          <Button size="sm" variant="ghost" className="min-h-9 text-destructive hover:text-destructive" disabled={busy} onClick={() => setCancelFor(d)}>
                            <XCircle className="h-3.5 w-3.5" /> Cancel
                          </Button>
                        </>
                      )}
                      {d.status === 'IN_PROGRESS' && (
                        <Button size="sm" className="min-h-9 gap-1.5" disabled={busy} onClick={() => setCompleteFor(d)}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Complete drive
                        </Button>
                      )}
                    </div>
                  </div>

                  {(d.odometerOut != null || d.odometerIn != null || d.conditionOut || d.conditionIn || d.releasedBy || d.returnedBy || d.notes) && (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
                      {d.odometerOut != null && <span className="flex items-center gap-1"><Gauge className="h-3 w-3" /> Out: {d.odometerOut.toLocaleString()} km</span>}
                      {d.odometerIn != null && <span className="flex items-center gap-1"><Gauge className="h-3 w-3" /> In: {d.odometerIn.toLocaleString()} km</span>}
                      {d.releasedBy && <span>Released by {d.releasedBy}</span>}
                      {d.returnedBy && <span>Returned to {d.returnedBy}</span>}
                      {d.conditionOut && <span>Out condition: {d.conditionOut}</span>}
                      {d.conditionIn && <span>In condition: {d.conditionIn}</span>}
                      {d.notes && <span className="w-full">Notes: {d.notes}</span>}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Start drive dialog */}
      <StartDriveDialog
        drive={startFor}
        busy={busy}
        onClose={() => setStartFor(null)}
        onSubmit={async (payload) => {
          if (!startFor) return
          await patchDrive(startFor.id, { action: 'start', ...payload }, 'Drive started — keys handed over')
          setStartFor(null)
        }}
      />

      {/* Complete drive dialog */}
      <CompleteDriveDialog
        drive={completeFor}
        busy={busy}
        onClose={() => setCompleteFor(null)}
        onSubmit={async (payload) => {
          if (!completeFor) return
          await patchDrive(completeFor.id, { action: 'complete', ...payload }, 'Drive completed — vehicle returned')
          setCompleteFor(null)
        }}
      />

      {/* Cancel dialog */}
      <CancelDriveDialog
        drive={cancelFor}
        busy={busy}
        onClose={() => setCancelFor(null)}
        onSubmit={async (note) => {
          if (!cancelFor) return
          await patchDrive(cancelFor.id, { action: 'cancel', note: note || undefined }, 'Test drive cancelled')
          setCancelFor(null)
        }}
      />
    </div>
  )
}

function StartDriveDialog({ drive, busy, onClose, onSubmit }: {
  drive: OrgTestDrive | null
  busy: boolean
  onClose: () => void
  onSubmit: (payload: { odometerOut: number; fuelOut?: string; conditionOut?: string; releasedBy: string }) => Promise<void>
}) {
  const [odometer, setOdometer] = useState('')
  const [fuel, setFuel] = useState<string>('FULL')
  const [condition, setCondition] = useState('')
  const [releasedBy, setReleasedBy] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (drive) { setOdometer(''); setFuel('FULL'); setCondition(''); setReleasedBy('') }
  }, [drive])

  const km = parseInt(odometer.trim(), 10)
  const valid = Number.isFinite(km) && km >= 0 && releasedBy.trim().length >= 2

  async function submit() {
    if (!valid || !drive) return
    setSaving(true)
    try {
      await onSubmit({
        odometerOut: km,
        fuelOut: fuel,
        conditionOut: condition.trim() || undefined,
        releasedBy: releasedBy.trim(),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={drive !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start test drive</DialogTitle>
          <DialogDescription>
            {drive ? `${drive.vehicle ? vehicleTitle(drive.vehicle) : 'Vehicle'} for ${drive.customerName}. ` : ''}
            Record the odometer and who released the keys before the car leaves the yard.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="td-odometer-out">Odometer out (km) *</Label>
              <Input id="td-odometer-out" inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="e.g. 64210" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="td-fuel-out">Fuel level</Label>
              <Select value={fuel} onValueChange={setFuel}>
                <SelectTrigger id="td-fuel-out" aria-label="Fuel level at handover"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FUEL_LEVELS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="td-condition-out">Condition notes (optional)</Label>
            <Textarea id="td-condition-out" rows={2} value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="e.g. Small scratch on rear bumper noted with customer" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="td-released-by">Released by (staff name) *</Label>
            <Input id="td-released-by" value={releasedBy} onChange={(e) => setReleasedBy(e.target.value)} placeholder="e.g. Aisha Njeri" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || saving || !valid} className="min-h-11">
            {(busy || saving) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start drive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CompleteDriveDialog({ drive, busy, onClose, onSubmit }: {
  drive: OrgTestDrive | null
  busy: boolean
  onClose: () => void
  onSubmit: (payload: { odometerIn: number; fuelIn?: string; conditionIn?: string; returnedBy: string }) => Promise<void>
}) {
  const [odometer, setOdometer] = useState('')
  const [fuel, setFuel] = useState<string>('FULL')
  const [condition, setCondition] = useState('')
  const [returnedBy, setReturnedBy] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (drive) { setOdometer(''); setFuel('FULL'); setCondition(''); setReturnedBy('') }
  }, [drive])

  const km = parseInt(odometer.trim(), 10)
  const valid = Number.isFinite(km) && km >= 0 && returnedBy.trim().length >= 2

  async function submit() {
    if (!valid || !drive) return
    setSaving(true)
    try {
      await onSubmit({
        odometerIn: km,
        fuelIn: fuel,
        conditionIn: condition.trim() || undefined,
        returnedBy: returnedBy.trim(),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={drive !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Complete test drive</DialogTitle>
          <DialogDescription>
            {drive && drive.odometerOut != null ? `Went out at ${drive.odometerOut.toLocaleString()} km. ` : ''}
            Record the return odometer and who received the vehicle.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="td-odometer-in">Odometer in (km) *</Label>
              <Input id="td-odometer-in" inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="e.g. 64265" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="td-fuel-in">Fuel level on return</Label>
              <Select value={fuel} onValueChange={setFuel}>
                <SelectTrigger id="td-fuel-in" aria-label="Fuel level on return"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FUEL_LEVELS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="td-condition-in">Condition on return (optional)</Label>
            <Textarea id="td-condition-in" rows={2} value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="e.g. Clean, no new damage" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="td-returned-by">Received by (staff name) *</Label>
            <Input id="td-returned-by" value={returnedBy} onChange={(e) => setReturnedBy(e.target.value)} placeholder="e.g. Aisha Njeri" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || saving || !valid} className="min-h-11">
            {(busy || saving) ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Complete drive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CancelDriveDialog({ drive, busy, onClose, onSubmit }: {
  drive: OrgTestDrive | null
  busy: boolean
  onClose: () => void
  onSubmit: (note: string) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (drive) setNote('')
  }, [drive])

  async function submit() {
    if (!drive) return
    setSaving(true)
    try {
      await onSubmit(note.trim())
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={drive !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel this test drive?</DialogTitle>
          <DialogDescription>
            {drive ? `${drive.customerName}'s drive on ${drive.vehicle ? vehicleTitle(drive.vehicle) : 'the vehicle'} will be cancelled.` : ''} The customer is notified automatically.
          </DialogDescription>
        </DialogHeader>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional, shared with the customer)" aria-label="Cancellation reason" />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Keep drive</Button>
          <Button variant="destructive" onClick={submit} disabled={busy || saving} className="min-h-11">
            {(busy || saving) ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Cancel drive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
