'use client'

/* Garage Dashboard — GarageOS for approved garages, plus the garage
 * application wizard for new providers. Real data via /api/garages?mine=1,
 * /api/service-requests?org=1, /api/quotes, /api/bookings, /api/reviews. */

import { useCallback, useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Wrench, MapPin, Star, Plus, Pencil, Send, CalendarClock, Play, CheckCircle2, XCircle,
  ClipboardList, ShieldCheck, Building2, FileText, Upload, MessageSquareText, Settings2, RefreshCw,
  Inbox, ClipboardCheck, KeyRound, PackageCheck, Gauge, StickyNote, Ban, CarFront, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CountUp, Stagger, StaggerItem } from '@/components/motion/reveal'
import { MessagesTab, useUnreadConversations } from '@/components/messaging/conversation-panel'
import { PromotionsSection } from '@/components/billing/promotions-section'
import { useAuth } from '@/stores/auth'
import { navigate, apiGet, apiSend, apiUpload, buildQuery } from '@/lib/client'
import { useHashRoute } from '@/hooks/use-hash-route'
import {
  money, timeAgo, dateLabel, KENYA_COUNTIES, SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS,
} from '@/lib/format'

// ─────────────────────────── Types ───────────────────────────

type ServiceRow = { id: string; category: string; title: string; description: string | null; priceFromMinor: number | null; active: boolean }
type MyGarage = {
  org: { id: string; name: string; county: string; town: string | null; location: string | null; description: string | null; phone: string | null; status: string }
  services: ServiceRow[]
  rating: { avg: number; count: number }
  stats: { openRequests: number; quoted: number; booked: number; completed: number; pendingBookings: number }
  subscription: { planCode: string; status: string; currentPeriodEnd: string } | null
}
type MyQuote = { id: string; amountMinor: number; leadDays: number | null; message: string | null; status: string; createdAt: string }
type LeadRequest = {
  id: string; refCode: string; category: string; vehicleDesc: string | null; description: string
  county: string; town: string | null; status: string; configId: string | null; createdAt: string
  customer: { name: string }
  myQuote: MyQuote | null
}
type ReviewRow = { id: string; rating: number; comment: string | null; createdAt: string; author: { name: string } }
type AppEvent = { id: string; type: string; actorName: string | null; note: string | null; createdAt: string }
type GarageApplication = {
  id: string; refCode: string; status: string; orgName: string; createdAt: string; orgId: string | null
  type?: string
  events: AppEvent[]
  decisionNote?: string | null
}

const REVIEWABLE = ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'RESUBMITTED']

/** KES major-unit input → integer minor units (×100). Returns null when invalid. */
function kesToMinor(input: string): number | null {
  const v = input.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null
  const minor = Math.round(parseFloat(v) * 100)
  return Number.isFinite(minor) && minor > 0 ? minor : null
}

const REQUEST_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open', QUOTING: 'Quoting', BOOKED: 'Booked', IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled', EXPIRED: 'Expired',
}
const BOOKING_STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'Confirmed', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
}

export default function GarageDashboardView() {
  const { user, loading } = useAuth()
  const route = useHashRoute()
  const [phase, setPhase] = useState<'loading' | 'wizard' | 'application' | 'dashboard'>('loading')
  const [garages, setGarages] = useState<MyGarage[]>([])
  const [activeOrgId, setActiveOrgId] = useState<string>('')
  const [application, setApplication] = useState<GarageApplication | null>(null)

  const activeGarage = garages.find((g) => g.org.id === activeOrgId) ?? garages[0] ?? null

  // ── Bootstrap: which phase are we in? ──
  const bootstrap = useCallback(() => {
    if (!user) return
    let appsFetched: GarageApplication[] | null = null
    let mineFetched: MyGarage[] | null = null
    const decide = () => {
      if (appsFetched === null || mineFetched === null) return
      if (mineFetched.length > 0) {
        setGarages(mineFetched)
        setActiveOrgId(mineFetched[0].org.id)
        setPhase('dashboard')
      } else {
        const app = appsFetched.find((a) => a.type === 'GARAGE') ?? null
        setApplication(app)
        setPhase(app ? 'application' : 'wizard')
      }
    }
    apiGet<{ applications: (GarageApplication & { type: string })[] }>('/api/applications')
      .then((d) => { appsFetched = d.applications; decide() })
      .catch(() => { appsFetched = []; decide() })
    apiGet<{ garages: MyGarage[] }>('/api/garages?mine=1')
      .then((d) => { mineFetched = d.garages; decide() })
      .catch(() => { mineFetched = []; decide() })
  }, [user])

  useEffect(() => {
    if (!loading && user) bootstrap()
  }, [loading, user, bootstrap])

  // ─────────────────────────── Gate: signed out ───────────────────────────
  if (!loading && !user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"><Wrench className="h-7 w-7" /></div>
        <h1 className="mt-4 text-2xl font-bold">Garage Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in with your garage account to manage services, quotes, bookings and reviews.</p>
        <Button className="mt-6" onClick={() => navigate('signin')}>Sign in</Button>
      </div>
    )
  }

  if (loading || phase === 'loading') {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  // ─────────────────────────── Gate: application wizard ───────────────────────────
  if (phase === 'wizard') {
    return <ApplicationWizard user={user!} onDone={bootstrap} />
  }

  // ─────────────────────────── Gate: application under review ───────────────────────────
  if (phase === 'application' && application) {
    return (
      <ApplicationStatus
        application={application}
        onResubmitted={bootstrap}
        onNewApplication={() => { setApplication(null); setPhase('wizard') }}
      />
    )
  }

  // ─────────────────────────── Dashboard ───────────────────────────
  return <Dashboard garages={garages} activeGarage={activeGarage!} activeOrgId={activeOrgId} onOrgChange={setActiveOrgId} initialTab={route.query.get('tab') ?? 'overview'} onRefresh={bootstrap} />
}

// ═══════════════════════════ Dashboard (approved garage) ═══════════════════════════

function Dashboard({ garages, activeGarage, activeOrgId, onOrgChange, initialTab, onRefresh }: {
  garages: MyGarage[]
  activeGarage: MyGarage
  activeOrgId: string
  onOrgChange: (id: string) => void
  initialTab: string
  onRefresh: () => void
}) {
  const TABS = ['overview', 'services', 'requests', 'quotes', 'bookings', 'custody', 'inbox', 'reviews', 'profile'] as const
  const [tab, setTab] = useState<string>(TABS.includes(initialTab as (typeof TABS)[number]) ? initialTab : 'overview')
  const unreadMessages = useUnreadConversations('org')

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{activeGarage.org.name}</h1>
            <Badge variant="outline" className="gap-1 border-primary/40 text-primary"><ShieldCheck className="h-3 w-3" /> Approved garage</Badge>
          </div>
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            {[activeGarage.org.town, activeGarage.org.county].filter(Boolean).join(', ')}
            {activeGarage.subscription && ` · ${activeGarage.subscription.planCode} plan`}
          </p>
        </div>
        {garages.length > 1 && (
          <Select value={activeOrgId} onValueChange={onOrgChange}>
            <SelectTrigger className="w-64" aria-label="Switch garage">
              <SelectValue placeholder="Choose garage" />
            </SelectTrigger>
            <SelectContent>
              {garages.map((g) => <SelectItem key={g.org.id} value={g.org.id}>{g.org.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList className="scrollbar-thin h-auto w-full justify-start overflow-x-auto py-0.5">
          <TabsTrigger value="overview" className="gap-1.5"><Building2 className="h-4 w-4" /> Overview</TabsTrigger>
          <TabsTrigger value="services" className="gap-1.5"><Wrench className="h-4 w-4" /> Services</TabsTrigger>
          <TabsTrigger value="requests" className="gap-1.5"><ClipboardList className="h-4 w-4" /> Requests</TabsTrigger>
          <TabsTrigger value="quotes" className="gap-1.5"><Send className="h-4 w-4" /> Quotes</TabsTrigger>
          <TabsTrigger value="bookings" className="gap-1.5"><CalendarClock className="h-4 w-4" /> Bookings</TabsTrigger>
          <TabsTrigger value="custody" className="gap-1.5"><KeyRound className="h-4 w-4" /> Vehicle custody</TabsTrigger>
          <TabsTrigger value="inbox" className="gap-1.5">
            <Inbox className="h-4 w-4" /> Inbox
            {unreadMessages > 0 && (
              <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground" aria-label={`${unreadMessages} unread`}>
                {unreadMessages > 9 ? '9+' : unreadMessages}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="reviews" className="gap-1.5"><MessageSquareText className="h-4 w-4" /> Reviews</TabsTrigger>
          <TabsTrigger value="profile" className="gap-1.5"><Settings2 className="h-4 w-4" /> Profile</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4"><OverviewTab garage={activeGarage} onGo={setTab} /></TabsContent>
        <TabsContent value="services" className="mt-4"><ServicesTab orgId={activeOrgId} services={activeGarage.services} onChanged={onRefresh} /></TabsContent>
        <TabsContent value="requests" className="mt-4"><RequestsTab orgId={activeOrgId} services={activeGarage.services} /></TabsContent>
        <TabsContent value="quotes" className="mt-4"><QuotesTab orgId={activeOrgId} /></TabsContent>
        <TabsContent value="bookings" className="mt-4"><BookingsTab orgId={activeOrgId} onChanged={onRefresh} /></TabsContent>
        <TabsContent value="custody" className="mt-4"><FadeIn><CustodyTab /></FadeIn></TabsContent>
        <TabsContent value="inbox" className="mt-4"><FadeIn><MessagesTab scope="org" /></FadeIn></TabsContent>
        <TabsContent value="reviews" className="mt-4"><ReviewsTab orgId={activeOrgId} rating={activeGarage.rating} /></TabsContent>
        <TabsContent value="profile" className="mt-4">
          <div className="space-y-6">
            <ProfileTab garage={activeGarage} onSaved={onRefresh} />
            {/* Billing — promotions (garage packages apply to the org, same M-Pesa flow) */}
            <PromotionsSection />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─────────────────────────── Overview ───────────────────────────

function OverviewTab({ garage, onGo }: { garage: MyGarage; onGo: (tab: string) => void }) {
  const stats = garage.stats
  const activeServices = garage.services.filter((s) => s.active)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Eligible open requests" value={stats.openRequests} hint="Leads in your categories" onClick={() => onGo('requests')} />
        <StatCard label="Quotes sent" value={stats.quoted} hint="All time" onClick={() => onGo('quotes')} />
        <StatCard label="Active bookings" value={stats.booked} hint="Confirmed or in progress" onClick={() => onGo('bookings')} />
        <StatCard label="Services completed" value={stats.completed} hint="All time" onClick={() => onGo('bookings')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Rating</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-4">
            <div className="text-4xl font-bold">{garage.rating.count > 0 ? garage.rating.avg.toFixed(1) : '—'}</div>
            <div>
              <Stars avg={garage.rating.avg} />
              <p className="mt-1 text-xs text-muted-foreground">
                {garage.rating.count > 0 ? `${garage.rating.count} verified review${garage.rating.count === 1 ? '' : 's'} from completed bookings` : 'No reviews yet — they come from completed bookings.'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Request pipeline</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <PipelineRow label="Open / quoting leads available to you" value={stats.openRequests} onClick={() => onGo('requests')} />
            <PipelineRow label="Bookings awaiting schedule or start" value={stats.pendingBookings} onClick={() => onGo('bookings')} />
            <PipelineRow label="Active services listed" value={activeServices.length} onClick={() => onGo('services')} />
            <PipelineRow label="Inactive services" value={garage.services.length - activeServices.length} onClick={() => onGo('services')} />
          </CardContent>
        </Card>
      </div>

      <Alert>
        <ClipboardList className="h-4 w-4" />
        <AlertTitle>How leads work</AlertTitle>
        <AlertDescription>
          You see requests whose category matches an <strong>active service</strong> you list, plus every request you already quoted.
          Send quotes from the Requests tab — customers accept in their account and a booking is created automatically.
        </AlertDescription>
      </Alert>
    </div>
  )
}

function StatCard({ label, value, hint, onClick }: { label: string; value: number; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/50">
      <p className="text-3xl font-bold">{value}</p>
      <p className="mt-1 text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </button>
  )
}

function PipelineRow({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant="secondary">{value}</Badge>
    </button>
  )
}

// ─────────────────────────── Services ───────────────────────────

function ServicesTab({ orgId, services, onChanged }: { orgId: string; services: ServiceRow[]; onChanged: () => void }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ServiceRow | null>(null)
  const [category, setCategory] = useState<string>('GENERAL_SERVICE')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)

  function openCreate() {
    setEditing(null)
    setCategory('GENERAL_SERVICE')
    setTitle('')
    setDescription('')
    setPrice('')
    setDialogOpen(true)
  }

  function openEdit(s: ServiceRow) {
    setEditing(s)
    setCategory(s.category)
    setTitle(s.title)
    setDescription(s.description ?? '')
    setPrice(s.priceFromMinor ? String(s.priceFromMinor / 100) : '')
    setDialogOpen(true)
  }

  const priceMinor = price.trim() ? kesToMinor(price) : null
  const priceInvalid = price.trim() !== '' && priceMinor === null

  function save() {
    if (title.trim().length < 3) { toast.error('Give the service a clear title'); return }
    if (priceInvalid) { toast.error('Price must be a KES amount like 3500 or 3500.50'); return }
    setSaving(true)
    const payload = {
      category,
      title: title.trim(),
      description: description.trim() || null,
      priceFromMinor: priceMinor,
    }
    const call = editing
      ? apiSend(`/api/garage-services?id=${editing.id}`, 'PATCH', payload)
      : apiSend('/api/garage-services', 'POST', { ...payload, orgId })
    call
      .then(() => {
        toast.success(editing ? 'Service updated' : 'Service added')
        setDialogOpen(false)
        onChanged()
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not save service'))
      .finally(() => setSaving(false))
  }

  function toggleActive(s: ServiceRow) {
    apiSend(`/api/garage-services?id=${s.id}`, 'PATCH', { active: !s.active })
      .then(() => { toast.success(s.active ? 'Service deactivated' : 'Service activated'); onChanged() })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not update service'))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Active services decide which customer requests you see. Deactivate instead of deleting to keep history.</p>
        <Button onClick={openCreate} className="gap-1.5"><Plus className="h-4 w-4" /> Add service</Button>
      </div>

      {services.length === 0 ? (
        <EmptyBlock icon={<Wrench className="h-6 w-6" />} title="No services yet" desc="Add the categories you cover — e.g. general servicing, tyres, or modifications — so matching requests reach you." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {services.map((s) => (
            <Card key={s.id} className={`p-4 ${!s.active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold">{s.title}</h4>
                    <Badge variant={s.active ? 'secondary' : 'outline'}>{s.active ? 'Active' : 'Inactive'}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{SERVICE_CATEGORY_LABELS[s.category] ?? s.category}</p>
                  {s.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{s.description}</p>}
                  <p className="mt-2 text-sm font-medium">{s.priceFromMinor ? `from ${money(s.priceFromMinor)}` : 'Price on quote'}</p>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => openEdit(s)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(s)}>{s.active ? 'Deactivate' : 'Activate'}</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit service' : 'Add a service'}</DialogTitle>
            <DialogDescription>Shown on your public garage profile. &quot;From&quot; pricing sets customer expectations.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="svc-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="svc-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SERVICE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{SERVICE_CATEGORY_LABELS[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="svc-title">Title</Label>
              <Input id="svc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Full engine service" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="svc-desc">Description (optional)</Label>
              <Textarea id="svc-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's included, warranties, turnaround…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="svc-price">Price from (KES, optional)</Label>
              <div className="flex gap-2">
                <Input id="svc-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 6500" className="max-w-40" />
                {priceMinor !== null && <Badge variant="secondary" className="self-center">{money(priceMinor)}</Badge>}
              </div>
              {priceInvalid && <p className="text-xs text-destructive">Enter a valid KES amount, e.g. 6500 or 6500.50</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || title.trim().length < 3 || priceInvalid}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add service'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─────────────────────────── Requests (leads) + Quotes ───────────────────────────

function useOrgRequests(orgId: string) {
  const [feed, setFeed] = useState<{ orgId: string; requests: LeadRequest[]; tick: number } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    apiGet<{ requests: LeadRequest[] }>(buildQuery('/api/service-requests', { org: 1, orgId }))
      .then((d) => { if (!cancelled) setFeed({ orgId, requests: d.requests, tick }) })
      .catch(() => { if (!cancelled) setFeed({ orgId, requests: [], tick }) })
    return () => { cancelled = true }
  }, [orgId, tick])
  const refresh = useCallback(() => setTick((t) => t + 1), [])
  // Stale while switching orgs or refetching — renders as loading.
  const requests = feed && feed.orgId === orgId && feed.tick === tick ? feed.requests : null
  return { requests, refresh }
}

function RequestsTab({ orgId, services }: { orgId: string; services: ServiceRow[] }) {
  const { requests, refresh } = useOrgRequests(orgId)
  const [quoteFor, setQuoteFor] = useState<LeadRequest | null>(null)
  const [amount, setAmount] = useState('')
  const [leadDays, setLeadDays] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const activeCategories = new Set(services.filter((s) => s.active).map((s) => s.category))

  function openQuote(r: LeadRequest) {
    setQuoteFor(r)
    setAmount('')
    setLeadDays('')
    setMessage('')
  }

  const amountMinor = amount.trim() ? kesToMinor(amount) : null
  const amountInvalid = amount.trim() !== '' && amountMinor === null
  const leadInvalid = leadDays.trim() !== '' && !/^\d{1,3}$/.test(leadDays.trim())

  function sendQuote() {
    if (!quoteFor) return
    if (amountMinor === null) { toast.error('Enter a valid KES amount, e.g. 12000'); return }
    setSending(true)
    apiSend('/api/quotes', 'POST', {
      requestId: quoteFor.id,
      orgId,
      amountMinor,
      leadDays: leadDays.trim() ? parseInt(leadDays.trim(), 10) : undefined,
      message: message.trim() || undefined,
    })
      .then(() => {
        toast.success(`Quote sent to ${quoteFor.customer.name}`)
        setQuoteFor(null)
        refresh()
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not send quote'))
      .finally(() => setSending(false))
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Eligible requests match your active service categories. Sending another quote updates your previous one — customers never see other garages&apos; prices.
      </p>

      {requests === null ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : requests.length === 0 ? (
        <EmptyBlock
          icon={<ClipboardList className="h-6 w-6" />}
          title="No eligible requests right now"
          desc="Add more service categories or check back — new requests notify garages offering that category instantly."
        />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => {
            const eligible = ['OPEN', 'QUOTING'].includes(r.status) && activeCategories.has(r.category)
            return (
              <Card key={r.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold">{SERVICE_CATEGORY_LABELS[r.category] ?? r.category}</h4>
                      <Badge variant="outline">{REQUEST_STATUS_LABELS[r.status] ?? r.status}</Badge>
                      {r.configId && (
                        <button
                          className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs text-primary hover:bg-muted"
                          onClick={() => navigate(`customizer?cfg=${r.configId}`)}
                        >
                          <Settings2 className="h-3 w-3" /> 3D configuration
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.refCode} · {r.county}{r.town ? ` · ${r.town}` : ''} · {timeAgo(r.createdAt)} · requested by {r.customer.name}
                    </p>
                  </div>
                  {eligible && (
                    <Button size="sm" className="gap-1.5" onClick={() => openQuote(r)}>
                      <Send className="h-3.5 w-3.5" /> {r.myQuote ? 'Update quote' : 'Send quote'}
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{r.description}</p>
                {r.vehicleDesc && <p className="mt-1 text-xs text-muted-foreground">Vehicle: {r.vehicleDesc}</p>}
                {r.myQuote && (
                  <div className={`mt-3 rounded-lg border p-3 text-sm ${r.myQuote.status === 'ACCEPTED' ? 'border-primary/40 bg-primary/5' : ''}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">Your quote: <span className="font-bold text-primary">{money(r.myQuote.amountMinor)}</span>
                        {r.myQuote.leadDays !== null && <span className="ml-2 text-xs text-muted-foreground">· {r.myQuote.leadDays} day{r.myQuote.leadDays === 1 ? '' : 's'} lead</span>}
                      </span>
                      <Badge variant={r.myQuote.status === 'ACCEPTED' ? 'default' : r.myQuote.status === 'PENDING' ? 'secondary' : 'outline'} className={r.myQuote.status === 'ACCEPTED' ? 'bg-primary text-white' : ''}>
                        {r.myQuote.status}
                      </Badge>
                    </div>
                    {r.myQuote.message && <p className="mt-1 text-xs text-muted-foreground">{r.myQuote.message}</p>}
                    <p className="mt-1 text-[10px] text-muted-foreground">sent {timeAgo(r.myQuote.createdAt)}</p>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Quote dialog */}
      <Dialog open={quoteFor !== null} onOpenChange={(open) => { if (!open) setQuoteFor(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send quote</DialogTitle>
            <DialogDescription>
              {quoteFor && `${quoteFor.refCode} · ${SERVICE_CATEGORY_LABELS[quoteFor.category] ?? quoteFor.category} · ${quoteFor.county}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="q-amount">Amount (KES)</Label>
              <div className="flex gap-2">
                <Input id="q-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 12500" className="max-w-40" />
                {amountMinor !== null && <Badge variant="secondary" className="self-center">{money(amountMinor)}</Badge>}
              </div>
              {amountInvalid && <p className="text-xs text-destructive">Enter a valid KES amount, e.g. 12500 or 12500.50</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="q-lead">Lead time in days (optional)</Label>
              <Input id="q-lead" inputMode="numeric" value={leadDays} onChange={(e) => setLeadDays(e.target.value)} placeholder="e.g. 2" className="max-w-24" />
              {leadInvalid && <p className="text-xs text-destructive">Whole days, e.g. 2</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="q-msg">Message (optional)</Label>
              <Textarea id="q-msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What the quote includes, parts, warranty…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setQuoteFor(null)}>Cancel</Button>
            <Button onClick={sendQuote} disabled={sending || amountMinor === null || amountInvalid || leadInvalid}>
              {sending ? 'Sending…' : quoteFor?.myQuote ? 'Update quote' : 'Send quote'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Quotes tab — sent quotes derived from the org feed (own quotes only, tenant-safe). */
function QuotesTab({ orgId }: { orgId: string }) {
  const { requests } = useOrgRequests(orgId)
  const quoted = requests?.filter((r) => r.myQuote) ?? []
  const statusBadge = (status: string) =>
    status === 'ACCEPTED' ? 'default' : status === 'PENDING' ? 'secondary' : 'outline'

  return (
    <div className="space-y-3">
      {requests === null ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : quoted.length === 0 ? (
        <EmptyBlock icon={<Send className="h-6 w-6" />} title="No quotes sent yet" desc="Quotes you send from the Requests tab appear here with their live status." />
      ) : (
        quoted.map((r) => (
          <Card key={r.id} className={`p-4 ${r.myQuote!.status === 'ACCEPTED' ? 'border-primary/50 bg-primary/5' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{r.refCode} · {SERVICE_CATEGORY_LABELS[r.category] ?? r.category}</p>
                <p className="text-xs text-muted-foreground">{r.county}{r.town ? ` · ${r.town}` : ''} · request is {REQUEST_STATUS_LABELS[r.status] ?? r.status}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-primary">{money(r.myQuote!.amountMinor)}</p>
                <Badge variant={statusBadge(r.myQuote!.status)} className={r.myQuote!.status === 'ACCEPTED' ? 'bg-primary text-white' : ''}>{r.myQuote!.status}</Badge>
              </div>
            </div>
            {r.myQuote!.message && <p className="mt-2 text-sm text-muted-foreground">{r.myQuote!.message}</p>}
          </Card>
        ))
      )}
    </div>
  )
}

// ─────────────────────────── Bookings ───────────────────────────

type OrgBookingFeed = {
  id: string; scheduledAt: string | null; status: string; notes: string | null; updatedAt: string
  request: {
    refCode: string; category: string; description: string; vehicleDesc: string | null
    county: string; town: string | null; status: string
    customer: { name: string; phone: string | null }
  }
}

function BookingsTab({ orgId, onChanged }: { orgId: string; onChanged: () => void }) {
  const [feed, setFeed] = useState<{ orgId: string; bookings: OrgBookingFeed[] } | null>(null)
  const [scheduleFor, setScheduleFor] = useState<OrgBookingFeed | null>(null)
  const [scheduleAt, setScheduleAt] = useState('')
  const [notesFor, setNotesFor] = useState<{ booking: OrgBookingFeed; action: 'complete' | 'cancel' } | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    apiGet<{ bookings: OrgBookingFeed[] }>(buildQuery('/api/bookings', { org: 1, orgId }))
      .then((d) => setFeed({ orgId, bookings: d.bookings }))
      .catch(() => setFeed({ orgId, bookings: [] }))
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  const bookings = feed && feed.orgId === orgId ? feed.bookings : null

  function act(booking: OrgBookingFeed, action: string, extra?: Record<string, unknown>) {
    setBusy(true)
    apiSend<{ booking: { status: string } }>(`/api/bookings?id=${booking.id}`, 'PATCH', { action, ...extra })
      .then((d) => {
        toast.success(`Booking ${d.booking.status.toLowerCase().replaceAll('_', ' ')}`)
        setScheduleFor(null); setNotesFor(null); setNotes(''); setScheduleAt('')
        load()
        onChanged()
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not update booking'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="space-y-3">
      {bookings === null ? (
        <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : bookings.length === 0 ? (
        <EmptyBlock
          icon={<CalendarClock className="h-6 w-6" />}
          title="No bookings yet"
          desc="When a customer accepts your quote, a confirmed booking appears here with their contact details."
        />
      ) : (
        bookings.map((b) => (
          <Card key={b.id} className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold">{b.request.refCode}</h4>
                  <Badge variant={b.status === 'COMPLETED' ? 'default' : b.status === 'CANCELLED' ? 'outline' : 'secondary'}
                    className={b.status === 'COMPLETED' ? 'bg-primary text-white' : ''}>
                    {BOOKING_STATUS_LABELS[b.status] ?? b.status}
                  </Badge>
                  <Badge variant="outline">{SERVICE_CATEGORY_LABELS[b.request.category] ?? b.request.category}</Badge>
                </div>
                {/* Customer contact is visible here only — justified by an accepted booking. */}
                <p className="mt-1 text-xs text-muted-foreground">
                  {b.request.customer.name}{b.request.customer.phone ? ` · ${b.request.customer.phone}` : ''} · {b.request.county}{b.request.town ? ` · ${b.request.town}` : ''}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{b.request.vehicleDesc ? `${b.request.vehicleDesc} — ` : ''}{b.request.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Scheduled: {b.scheduledAt ? new Date(b.scheduledAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : 'not scheduled yet'}
                </p>
                {b.notes && <p className="mt-1 text-xs text-muted-foreground">Notes: {b.notes}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {(b.status === 'CONFIRMED' || b.status === 'IN_PROGRESS') && (
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => { setScheduleFor(b); setScheduleAt(b.scheduledAt ? toLocalInput(b.scheduledAt) : '') }}>
                    <CalendarClock className="h-3.5 w-3.5" /> Schedule
                  </Button>
                )}
                {b.status === 'CONFIRMED' && <Button size="sm" className="gap-1" onClick={() => act(b, 'start')} disabled={busy}><Play className="h-3.5 w-3.5" /> Start</Button>}
                {b.status === 'IN_PROGRESS' && <Button size="sm" className="gap-1" onClick={() => { setNotesFor({ booking: b, action: 'complete' }); setNotes('') }} disabled={busy}><CheckCircle2 className="h-3.5 w-3.5" /> Complete</Button>}
                {(b.status === 'CONFIRMED' || b.status === 'IN_PROGRESS') && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setNotesFor({ booking: b, action: 'cancel' }); setNotes('') }} disabled={busy}>
                    <XCircle className="h-3.5 w-3.5" /> Cancel
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))
      )}

      {/* Schedule dialog */}
      <Dialog open={scheduleFor !== null} onOpenChange={(open) => { if (!open) setScheduleFor(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Schedule booking</DialogTitle>
            <DialogDescription>{scheduleFor?.request.refCode} — pick the date and time the customer should come in (or you go out).</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="bk-when">Date &amp; time</Label>
            <Input id="bk-when" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setScheduleFor(null)}>Cancel</Button>
            <Button
              disabled={busy || !scheduleAt}
              onClick={() => scheduleFor && act(scheduleFor, 'schedule', { scheduledAt: new Date(scheduleAt).toISOString() })}
            >
              Save schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete / cancel dialog */}
      <Dialog open={notesFor !== null} onOpenChange={(open) => { if (!open) setNotesFor(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{notesFor?.action === 'complete' ? 'Complete booking' : 'Cancel booking'}</DialogTitle>
            <DialogDescription>
              {notesFor?.booking.request.refCode}
              {notesFor?.action === 'complete' ? ' — the customer will be asked to leave a review.' : ' — the request is closed for quoting.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="bk-notes">Notes (optional)</Label>
            <Textarea id="bk-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Work done, advice for the customer, reason for cancelling…" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNotesFor(null)}>Close</Button>
            <Button
              variant={notesFor?.action === 'cancel' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => notesFor && act(notesFor.booking, notesFor.action, { notes: notes.trim() || undefined })}
            >
              {notesFor?.action === 'complete' ? 'Mark completed' : 'Cancel booking'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ─────────────────────────── Reviews ───────────────────────────

function ReviewsTab({ orgId, rating }: { orgId: string; rating: { avg: number; count: number } }) {
  const [feed, setFeed] = useState<{ orgId: string; reviews: ReviewRow[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<{ reviews: ReviewRow[] }>(buildQuery('/api/reviews', { orgId }))
      .then((d) => { if (!cancelled) setFeed({ orgId, reviews: d.reviews }) })
      .catch(() => { if (!cancelled) setFeed({ orgId, reviews: [] }) })
    return () => { cancelled = true }
  }, [orgId])

  const reviews = feed && feed.orgId === orgId ? feed.reviews : null

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <div className="text-4xl font-bold">{rating.count > 0 ? rating.avg.toFixed(1) : '—'}</div>
          <div>
            <Stars avg={rating.avg} />
            <p className="mt-1 text-xs text-muted-foreground">
              {rating.count > 0 ? `${rating.count} review${rating.count === 1 ? '' : 's'} from completed bookings` : 'Reviews appear after customers complete booked services.'}
            </p>
          </div>
        </div>
      </Card>

      {reviews === null ? (
        <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : reviews.length === 0 ? (
        <EmptyBlock icon={<MessageSquareText className="h-6 w-6" />} title="No reviews yet" desc="Complete bookings to earn verified reviews — only customers with a completed booking can review." />
      ) : (
        reviews.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Stars avg={r.rating} />
                <span className="text-sm font-medium">{r.author.name}</span>
              </div>
              <span className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
            </div>
            {r.comment && <p className="mt-2 text-sm text-muted-foreground">{r.comment}</p>}
          </Card>
        ))
      )}
    </div>
  )
}

// ─────────────────────────── Profile ───────────────────────────

function ProfileTab({ garage, onSaved }: { garage: MyGarage; onSaved: () => void }) {
  const [name, setName] = useState(garage.org.name)
  const [description, setDescription] = useState(garage.org.description ?? '')
  const [location, setLocation] = useState(garage.org.location ?? '')
  const [phone, setPhone] = useState(garage.org.phone ?? '')
  const [town, setTown] = useState(garage.org.town ?? '')
  const [saving, setSaving] = useState(false)

  function save() {
    if (name.trim().length < 2) { toast.error('Garage name is too short'); return }
    setSaving(true)
    apiSend<{ org: { id: string } }>(buildQuery('/api/garages', { id: garage.org.id }), 'PATCH', {
      name: name.trim(),
      description: description.trim(),
      location: location.trim(),
      phone: phone.trim(),
      town: town.trim(),
    })
      .then(() => { toast.success('Profile updated'); onSaved() })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not update profile'))
      .finally(() => setSaving(false))
  }

  return (
    <Card className="p-6">
      <CardHeader className="px-0 pt-0">
        <CardTitle className="text-lg">Garage profile</CardTitle>
        <CardDescription>Shown on your public listing in the Garages directory. County was set during verification.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 px-0 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pf-name">Garage name</Label>
          <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pf-desc">Description</Label>
          <Textarea id="pf-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What your garage specialises in…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-town">Town</Label>
          <Input id="pf-town" value={town} onChange={(e) => setTown(e.target.value)} placeholder="e.g. Westlands" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-loc">Street / landmark</Label>
          <Input id="pf-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Karuna Rd, Westlands" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-phone">Business phone</Label>
          <Input id="pf-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2547…" />
        </div>
        <div className="flex items-end">
          <Button onClick={save} disabled={saving} className="gap-1.5"><RefreshCw className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} /> {saving ? 'Saving…' : 'Save profile'}</Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ═══════════════════════════ Application wizard ═══════════════════════════

type Doc = { name: string; url: string }

function ApplicationWizard({ user, onDone }: { user: NonNullable<ReturnType<typeof useAuth.getState>['user']>; onDone: () => void }) {
  const [step, setStep] = useState(1)
  const [orgName, setOrgName] = useState('')
  const [regNo, setRegNo] = useState('')
  const [county, setCounty] = useState('Nairobi')
  const [town, setTown] = useState('')
  const [physicalAddress, setPhysicalAddress] = useState('')
  const [phone, setPhone] = useState(user.phone ?? '')
  const [email, setEmail] = useState(user.email)
  const [representative, setRepresentative] = useState(user.name)
  const [categories, setCategories] = useState<string[]>([])
  const [docs, setDocs] = useState<Doc[]>([])
  const [uploading, setUploading] = useState(false)
  const [consent, setConsent] = useState(false)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canStep1 = orgName.trim().length >= 2 && phone.trim().length >= 9
  const canStep2 = categories.length > 0 && representative.trim().length >= 2
  const canSubmit = canStep1 && canStep2 && consent

  function toggleCategory(c: string) {
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  function uploadDoc(file: File) {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', 'document')
    apiUpload<{ url: string; name: string }>('/api/upload', fd)
      .then((d) => { setDocs((prev) => [...prev, { name: d.name, url: d.url }]); toast.success(`${d.name} uploaded`) })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Upload failed'))
      .finally(() => setUploading(false))
  }

  function submit() {
    setSubmitting(true)
    apiSend<{ application: GarageApplication }>('/api/applications', 'POST', {
      type: 'GARAGE',
      status: 'SUBMITTED',
      orgName: orgName.trim(),
      regNo: regNo.trim() || undefined,
      county,
      town: town.trim() || undefined,
      physicalAddress: physicalAddress.trim() || undefined,
      phone: phone.trim(),
      email: email.trim() || undefined,
      representative: representative.trim(),
      categories: categories.join(','),
      documents: docs,
      consent,
      notes: notes.trim() || undefined,
    })
      .then(() => {
        toast.success('Application submitted — review usually starts within 24 business hours')
        onDone()
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not submit application'))
      .finally(() => setSubmitting(false))
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <div className="flex items-center gap-2">
        <Wrench className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">List your garage on CARMAZE</h1>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Apply once — our team verifies your business, then your garage goes live in the directory and you start receiving quote requests.
      </p>

      <div className="mt-6 flex items-center gap-2" aria-hidden="true">
        {[1, 2, 3].map((s) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full ${s <= step ? 'bg-primary' : 'bg-muted'}`} />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Step {step} of 3</p>

      <Card className="mt-4 p-6">
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-semibold">Business information</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ap-name">Garage / business name *</Label>
                <Input id="ap-name" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Premium Motors Garage" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-reg">Registration no. (optional)</Label>
                <Input id="ap-reg" value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="e.g. BN-2014-7731" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-county">County *</Label>
                <Select value={county} onValueChange={setCounty}>
                  <SelectTrigger id="ap-county"><SelectValue /></SelectTrigger>
                  <SelectContent>{KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-town">Town</Label>
                <Input id="ap-town" value={town} onChange={(e) => setTown(e.target.value)} placeholder="e.g. Westlands" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ap-addr">Physical address / landmark</Label>
                <Input id="ap-addr" value={physicalAddress} onChange={(e) => setPhysicalAddress(e.target.value)} placeholder="e.g. Karuna Rd, Westlands, opposite X" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-phone">Business phone *</Label>
                <Input id="ap-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2547…" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-email">Business email</Label>
                <Input id="ap-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="service@yourgarage.co.ke" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button disabled={!canStep1} onClick={() => setStep(2)}>Continue</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="font-semibold">Representative &amp; services</h2>
            <div className="space-y-1.5">
              <Label htmlFor="ap-rep">Authorised representative *</Label>
              <Input id="ap-rep" value={representative} onChange={(e) => setRepresentative(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Service categories offered * (select all that apply)</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SERVICE_CATEGORIES.map((c) => (
                  <label key={c} className="flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm transition-colors hover:bg-muted/60">
                    <Checkbox checked={categories.includes(c)} onCheckedChange={() => toggleCategory(c)} aria-label={SERVICE_CATEGORY_LABELS[c]} />
                    {SERVICE_CATEGORY_LABELS[c]}
                  </label>
                ))}
              </div>
              {categories.length === 0 && <p className="text-xs text-muted-foreground">At least one category is required.</p>}
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button disabled={!canStep2} onClick={() => setStep(3)}>Continue</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="font-semibold">Documents &amp; consent</h2>
            <div className="space-y-2">
              <Label>Verification documents</Label>
              <p className="text-xs text-muted-foreground">
                Business permit / registration certificate. JPG, PNG or PDF up to 5MB. Stored privately — only reviewers see them.
              </p>
              <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground transition-colors hover:bg-muted/60">
                <Upload className="h-4 w-4" />
                {uploading ? 'Uploading…' : 'Upload a document'}
                <input
                  type="file"
                  className="sr-only"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  disabled={uploading || docs.length >= 5}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(f); e.currentTarget.value = '' }}
                />
              </label>
              {docs.length > 0 && (
                <ul className="space-y-1">
                  {docs.map((d, i) => (
                    <li key={d.url} className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-1.5 text-sm">
                      <span className="flex items-center gap-2 truncate"><FileText className="h-3.5 w-3.5 shrink-0" /> {d.name}</span>
                      <button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => setDocs((prev) => prev.filter((_, j) => j !== i))}>remove</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ap-notes">Anything else reviewers should know (optional)</Label>
              <Textarea id="ap-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" aria-label="Provider terms consent" />
              <span>
                I confirm the information provided is accurate and I accept the CARMAZE provider terms and privacy notice,
                including honest-quote and no-fake-dispatch rules for roadside services. *
              </span>
            </label>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <Button disabled={!canSubmit || submitting || uploading} onClick={submit}>
                {submitting ? 'Submitting…' : 'Submit application'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

// ═══════════════════════════ Application status ═══════════════════════════

function ApplicationStatus({ application, onResubmitted, onNewApplication }: {
  application: GarageApplication
  onResubmitted: () => void
  onNewApplication: () => void
}) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [uploading, setUploading] = useState(false)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const needsInfo = application.status === 'MORE_INFO_REQUIRED'

  function uploadDoc(file: File) {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', 'document')
    apiUpload<{ url: string; name: string }>('/api/upload', fd)
      .then((d) => { setDocs((prev) => [...prev, { name: d.name, url: d.url }]); toast.success(`${d.name} uploaded`) })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Upload failed'))
      .finally(() => setUploading(false))
  }

  function resubmit() {
    setSubmitting(true)
    apiSend(`/api/applications/${application.id}`, 'PATCH', {
      action: 'resubmit',
      ...(docs.length > 0 ? { documents: docs } : {}),
      notes: notes.trim() || 'Requested information provided.',
    })
      .then(() => { toast.success('Resubmitted — reviewers have been notified'); onResubmitted() })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not resubmit'))
      .finally(() => setSubmitting(false))
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">Garage application</h1>
      <p className="mt-1 text-sm text-muted-foreground">Reference {application.refCode} · submitted {timeAgo(application.createdAt)}</p>

      <Alert className="mt-4">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Status: {application.status.replaceAll('_', ' ').toLowerCase()}</AlertTitle>
        <AlertDescription>
          {needsInfo
            ? 'The review team needs more information before approving. Provide it below.'
            : application.status === 'REJECTED'
              ? 'This application was rejected. You can submit a new application with updated information.'
              : 'Your garage application is in the review queue. You will be notified of any update.'}
        </AlertDescription>
      </Alert>

      <Card className="mt-4 p-5">
        <h2 className="font-semibold">Timeline</h2>
        <Separator className="my-3" />
        <ol className="space-y-3">
          {application.events.map((ev) => (
            <li key={ev.id} className="flex gap-3 text-sm">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#c9a45c]" aria-hidden="true" />
              <div>
                <p className="font-medium">{ev.type.replaceAll('_', ' ').toLowerCase()}</p>
                {ev.note && <p className="text-muted-foreground">{ev.note}</p>}
                <p className="text-xs text-muted-foreground">{timeAgo(ev.createdAt)}{ev.actorName ? ` · ${ev.actorName}` : ''}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {needsInfo && (
        <Card className="mt-4 p-5">
          <h2 className="font-semibold">Provide requested information</h2>
          <p className="mt-1 text-xs text-muted-foreground">Attach documents if asked, and add a short note for the reviewer.</p>
          <label className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground transition-colors hover:bg-muted/60">
            <Upload className="h-4 w-4" />
            {uploading ? 'Uploading…' : 'Upload document (optional)'}
            <input
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(f); e.currentTarget.value = '' }}
            />
          </label>
          {docs.length > 0 && (
            <ul className="mt-2 space-y-1">
              {docs.map((d, i) => (
                <li key={d.url} className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-1.5 text-sm">
                  <span className="flex items-center gap-2 truncate"><FileText className="h-3.5 w-3.5 shrink-0" /> {d.name}</span>
                  <button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => setDocs((prev) => prev.filter((_, j) => j !== i))}>remove</button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="rs-notes">Note to reviewers</Label>
            <Textarea id="rs-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button className="mt-3" onClick={resubmit} disabled={submitting || uploading}>
            {submitting ? 'Submitting…' : 'Resubmit application'}
          </Button>
        </Card>
      )}

      {application.status === 'REJECTED' && (
        <Button className="mt-4" variant="outline" onClick={onNewApplication}>Submit a new application</Button>
      )}
    </div>
  )
}

// ─────────────────────────── Shared bits ───────────────────────────

function Stars({ avg }: { avg: number }) {
  const rounded = Math.round(avg)
  return (
    <span className="flex" aria-label={`Rated ${avg.toFixed(1)} out of 5`} role="img">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`h-3.5 w-3.5 ${i <= rounded ? 'fill-[#c9a45c] text-[#c9a45c]' : 'text-muted-foreground/40'}`} aria-hidden="true" />
      ))}
    </span>
  )
}

function EmptyBlock({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</span>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{desc}</p>
    </div>
  )
}

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

// ═══════════════════════════ Vehicle custody (org side) ═══════════════════════════

type CustodyRow = {
  id: string; refCode: string; status: string; vehicleDesc: string; plate: string | null
  customerName: string; requestedWork: string | null; createdAt: string; updatedAt: string
}

type OrgRoadTest = {
  id: string; purpose: string; driverName: string; status: string
  startOdometerKm: number | null; endOdometerKm: number | null
  requestedAt: string; authorisedAt: string | null; startedAt: string | null; endedAt: string | null
  notes: string | null; incident: boolean
}

type OrgCustodyEvent = {
  id: string; type: string; fromStatus: string | null; toStatus: string | null
  actorName: string | null; actorSide: string; note: string | null; createdAt: string
}

type OrgCustodyDetail = CustodyRow & {
  orgName: string
  authorisedSpendMinor: number | null
  roadTestAllowed: boolean
  declaredCondition?: string | null
  declaredMileageKm?: number | null
  valuables?: string | null
  completedWork?: string | null
  finalOdometerKm?: number | null
  finalNotes?: string | null
  costMinor?: number | null
  photos: string[]
  completionPhotos: string[]
  events: OrgCustodyEvent[]
  roadTests: OrgRoadTest[]
  collectionAuth: { collectorName: string; collectorPhone: string; codeHint: string; expiresAt: string; usedAt: string | null; revokedAt: string | null } | null
}

const CUSTODY_META: Record<string, { label: string; badge: string }> = {
  HANDOVER_REQUESTED: { label: 'Handover requested', badge: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  RECEIVED: { label: 'Received', badge: 'border-sky-300 bg-sky-500/15 text-sky-800 dark:text-sky-300' },
  INSPECTION: { label: 'Inspection', badge: 'border-sky-300 bg-sky-500/15 text-sky-800 dark:text-sky-300' },
  AWAITING_APPROVAL: { label: 'Awaiting customer approval', badge: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  WORK_IN_PROGRESS: { label: 'Work in progress', badge: 'border-indigo-300 bg-indigo-500/15 text-indigo-800 dark:text-indigo-300' },
  ROAD_TEST_REQUESTED: { label: 'Road test requested', badge: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  READY_FOR_COLLECTION: { label: 'Ready for collection', badge: 'border-primary/50 bg-primary/10 text-primary dark:text-[#9dc3ae]' },
  COLLECTION_PENDING: { label: 'Collection pending', badge: 'border-primary/50 bg-primary/10 text-primary dark:text-[#9dc3ae]' },
  RETURNED: { label: 'Returned', badge: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' },
  DISPUTED: { label: 'Disputed', badge: 'border-destructive/50 bg-destructive/10 text-destructive' },
  INCIDENT: { label: 'Incident', badge: 'border-destructive/50 bg-destructive/10 text-destructive' },
}

/** Lifecycle order used to lay out the board. */
const CUSTODY_FLOW = [
  'HANDOVER_REQUESTED', 'RECEIVED', 'INSPECTION', 'AWAITING_APPROVAL', 'WORK_IN_PROGRESS',
  'ROAD_TEST_REQUESTED', 'READY_FOR_COLLECTION', 'COLLECTION_PENDING', 'RETURNED', 'DISPUTED', 'INCIDENT',
] as const

const ROAD_TEST_META: Record<string, { label: string; badge: string }> = {
  REQUESTED: { label: 'Awaiting customer authorisation', badge: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  AUTHORISED: { label: 'Authorised — ready to start', badge: 'border-sky-300 bg-sky-500/15 text-sky-800 dark:text-sky-300' },
  IN_PROGRESS: { label: 'On the road', badge: 'border-indigo-300 bg-indigo-500/15 text-indigo-800 dark:text-indigo-300' },
  COMPLETED: { label: 'Completed', badge: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' },
  DECLINED: { label: 'Declined by customer', badge: 'bg-muted text-muted-foreground' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-muted text-muted-foreground' },
}

/** Statuses the garage can progress from. */
const MUTABLE_STATUSES = new Set(['RECEIVED', 'INSPECTION', 'AWAITING_APPROVAL', 'WORK_IN_PROGRESS'])

function CustodyTab() {
  const [custodies, setCustodies] = useState<CustodyRow[] | null>(null)
  const [tick, setTick] = useState(0)
  const [detailId, setDetailId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<{ custodies: CustodyRow[] }>('/api/custody?org=1')
      .then((d) => { if (!cancelled) setCustodies(d.custodies) })
      .catch(() => { if (!cancelled) setCustodies([]) })
    return () => { cancelled = true }
  }, [tick])

  // Poll the board every 15 seconds.
  useEffect(() => {
    const t = setInterval(() => setTick((k) => k + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  const reload = useCallback(() => setTick((k) => k + 1), [])
  const list = custodies ?? []
  const inCustody = list.filter((c) => !['RETURNED'].includes(c.status) && c.status !== 'DISPUTED' && c.status !== 'INCIDENT').length
  const awaitingCustomer = list.filter((c) => ['AWAITING_APPROVAL', 'ROAD_TEST_REQUESTED'].includes(c.status)).length
  const readyForCollection = list.filter((c) => ['READY_FOR_COLLECTION', 'COLLECTION_PENDING'].includes(c.status)).length
  const disputed = list.filter((c) => ['DISPUTED', 'INCIDENT'].includes(c.status)).length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-3xl font-bold"><CountUp value={inCustody} /></p>
          <p className="mt-1 text-sm font-medium">Vehicles in custody</p>
          <p className="text-xs text-muted-foreground">From handover to release</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-3xl font-bold"><CountUp value={awaitingCustomer} /></p>
          <p className="mt-1 text-sm font-medium">Awaiting customer</p>
          <p className="text-xs text-muted-foreground">Approvals &amp; road tests</p>
        </div>
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
          <p className="text-3xl font-bold text-primary dark:text-[#9dc3ae]"><CountUp value={readyForCollection} /></p>
          <p className="mt-1 text-sm font-medium">Ready for collection</p>
          <p className="text-xs text-muted-foreground">Verify the code at release</p>
        </div>
        <div className={`rounded-xl border bg-card p-4 ${disputed > 0 ? 'border-destructive/40 bg-destructive/5' : ''}`}>
          <p className={`text-3xl font-bold ${disputed > 0 ? 'text-destructive' : ''}`}><CountUp value={disputed} /></p>
          <p className="mt-1 text-sm font-medium">Disputed / incidents</p>
          <p className="text-xs text-muted-foreground">Frozen pending review</p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Every vehicle handed over for work is tracked through custody. A vehicle can only be released with the
        customer&apos;s 6-digit collection code or their personal collection confirmation — there is no way around it.
      </p>

      {custodies === null ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : list.length === 0 ? (
        <EmptyBlock
          icon={<ClipboardCheck className="h-6 w-6" />}
          title="No custody jobs yet"
          desc="When a customer hands a vehicle over for booked work, it appears here with full condition records and a protected release flow."
        />
      ) : (
        CUSTODY_FLOW.map((status) => {
          const group = list.filter((c) => c.status === status)
          if (group.length === 0) return null
          const meta = CUSTODY_META[status] ?? { label: status, badge: 'bg-muted text-muted-foreground' }
          return (
            <section key={status} aria-label={meta.label}>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{meta.label}</h3>
                <Badge variant="outline" className={meta.badge}>{group.length}</Badge>
              </div>
              <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setDetailId(c.id)}
                    className="rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow-md"
                    aria-label={`Open custody job ${c.refCode}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="flex min-w-0 items-center gap-2 font-semibold leading-tight">
                        <CarFront className="h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0 truncate">{c.vehicleDesc}</span>
                      </h4>
                      {c.plate && <Badge variant="secondary" className="shrink-0 font-mono text-[11px]">{c.plate}</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.customerName} · <span className="font-mono">{c.refCode}</span> · updated {timeAgo(c.updatedAt)}
                    </p>
                    {c.requestedWork && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{c.requestedWork}</p>}
                    {['DISPUTED', 'INCIDENT'].includes(status) && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-destructive">
                        <Ban className="h-3.5 w-3.5" /> Status changes locked
                      </p>
                    )}
                    {status === 'READY_FOR_COLLECTION' && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary dark:text-[#9dc3ae]">
                        <KeyRound className="h-3.5 w-3.5" /> Verify collection code to release
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )
        })
      )}

      <CustodyDetailDialog custodyId={detailId} onClose={() => setDetailId(null)} onChanged={reload} />
    </div>
  )
}

function CustodyDetailDialog({ custodyId, onClose, onChanged }: {
  custodyId: string | null
  onClose: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<OrgCustodyDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<'receive' | 'ready' | 'note' | 'roadtest-request' | 'roadtest-start' | 'roadtest-end' | 'verify' | null>(null)
  const [activeRoadTest, setActiveRoadTest] = useState<OrgRoadTest | null>(null)

  async function load(id: string, silent = false) {
    if (!silent) setLoading(true)
    try {
      const d = await apiGet<{ custody: OrgCustodyDetail }>(`/api/custody/${id}`)
      setDetail(d.custody)
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : 'Could not load the custody job.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    if (custodyId) load(custodyId)
    else { setDetail(null); setDialog(null); setActiveRoadTest(null) }
     
  }, [custodyId])

  async function patchCustody(payload: Record<string, unknown>, successMsg: string): Promise<boolean> {
    if (!custodyId) return false
    setBusy(true)
    try {
      await apiSend(`/api/custody/${custodyId}`, 'PATCH', payload)
      toast.success(successMsg)
      setDialog(null)
      await load(custodyId, true)
      onChanged()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const meta = detail ? (CUSTODY_META[detail.status] ?? { label: detail.status, badge: 'bg-muted text-muted-foreground' }) : null
  const disputed = detail ? (detail.status === 'DISPUTED' || detail.status === 'INCIDENT') : false
  const canVerify = detail ? ['READY_FOR_COLLECTION', 'COLLECTION_PENDING'].includes(detail.status) : false
  const canRequestRoadTest = detail ? detail.roadTestAllowed && MUTABLE_STATUSES.has(detail.status) : false
  const authActive = detail?.collectionAuth && !detail.collectionAuth.usedAt && !detail.collectionAuth.revokedAt

  return (
    <>
    <Dialog open={custodyId !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {loading || !detail || !meta ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 text-left">
                {detail.vehicleDesc}
                {detail.plate && <Badge variant="secondary" className="font-mono text-[11px]">{detail.plate}</Badge>}
                <Badge variant="outline" className={meta.badge}>{meta.label}</Badge>
              </DialogTitle>
              <DialogDescription className="text-left">
                {detail.customerName} · <span className="font-mono">{detail.refCode}</span> · handover requested {timeAgo(detail.createdAt)}
              </DialogDescription>
            </DialogHeader>

            {disputed && (
              <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-4" role="alert">
                <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
                  <Ban className="h-4 w-4" /> Custody disputed — incident opened.
                </p>
                <p className="mt-1 text-sm leading-relaxed text-destructive/90">
                  CARMAZE security will review. You cannot close this dispute.
                </p>
              </div>
            )}

            {/* Job facts */}
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg border p-3 sm:col-span-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Requested work</p>
                <p className="mt-1">{detail.requestedWork ?? '—'}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Authorised spend cap</p>
                <p className="mt-1 font-semibold">{detail.authorisedSpendMinor != null ? money(detail.authorisedSpendMinor) : 'No cap set'}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Road tests</p>
                <p className="mt-1 font-semibold">{detail.roadTestAllowed ? 'Authorised by customer' : 'Not authorised'}</p>
              </div>
              {detail.declaredMileageKm != null && (
                <div className="rounded-lg border p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Odometer at handover</p>
                  <p className="mt-1 font-semibold">{detail.declaredMileageKm.toLocaleString()} km</p>
                </div>
              )}
              {detail.valuables && (
                <div className="rounded-lg border p-3 sm:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Valuables declared</p>
                  <p className="mt-1">{detail.valuables}</p>
                </div>
              )}
              {detail.declaredCondition && (
                <div className="rounded-lg border p-3 sm:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Condition declared at handover</p>
                  <p className="mt-1">{detail.declaredCondition}</p>
                </div>
              )}
            </div>

            {/* Declared condition photos */}
            {detail.photos.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold">Handover condition photos</h4>
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {detail.photos.map((p) => (
                    <a key={p} href={p} target="_blank" rel="noreferrer">
                      { }
                      <img src={p} alt="Vehicle condition at handover" className="aspect-square w-full rounded-lg border object-cover transition-transform hover:scale-[1.03]" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Lifecycle actions */}
            {!disputed && (
              <div className="rounded-xl border p-4">
                <h4 className="text-sm font-semibold">Progress the job</h4>
                <div className="mt-3 flex flex-wrap gap-2">
                  {detail.status === 'HANDOVER_REQUESTED' && (
                    <Button size="sm" className="min-h-11 gap-1.5" disabled={busy} onClick={() => setDialog('receive')}>
                      <PackageCheck className="h-4 w-4" /> Receive vehicle
                    </Button>
                  )}
                  {detail.status === 'RECEIVED' && (
                    <Button size="sm" className="min-h-11 gap-1.5" disabled={busy} onClick={() => patchCustody({ action: 'status', status: 'INSPECTION' }, 'Moved to inspection')}>
                      <ClipboardCheck className="h-4 w-4" /> Begin inspection
                    </Button>
                  )}
                  {detail.status === 'INSPECTION' && (
                    <Button size="sm" className="min-h-11 gap-1.5" disabled={busy} onClick={() => patchCustody({ action: 'status', status: 'AWAITING_APPROVAL' }, 'Sent to the customer for approval')}>
                      <Send className="h-4 w-4" /> Submit for customer approval
                    </Button>
                  )}
                  {detail.status === 'AWAITING_APPROVAL' && (
                    <Button size="sm" className="min-h-11 gap-1.5" disabled={busy} onClick={() => patchCustody({ action: 'status', status: 'WORK_IN_PROGRESS' }, 'Work started')}>
                      <Play className="h-4 w-4" /> Start work
                    </Button>
                  )}
                  {detail.status === 'WORK_IN_PROGRESS' && (
                    <Button size="sm" className="min-h-11 gap-1.5" disabled={busy} onClick={() => setDialog('ready')}>
                      <CheckCircle2 className="h-4 w-4" /> Mark ready for collection
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="min-h-11 gap-1.5" disabled={busy} onClick={() => setDialog('note')}>
                    <StickyNote className="h-4 w-4" /> Add note
                  </Button>
                </div>
                {detail.completedWork && (
                  <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
                    <p className="font-medium text-primary dark:text-[#9dc3ae]">Recorded completion</p>
                    <p className="mt-1">{detail.completedWork}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {detail.costMinor != null && `Final cost ${money(detail.costMinor)} · `}
                      {detail.finalOdometerKm != null && `${detail.finalOdometerKm.toLocaleString()} km · `}
                      recorded {timeAgo(detail.updatedAt)}
                    </p>
                    {detail.completionPhotos.length > 0 && (
                      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {detail.completionPhotos.map((p) => (
                          <a key={p} href={p} target="_blank" rel="noreferrer">
                            { }
                            <img src={p} alt="Completed work" className="aspect-square w-full rounded-lg border object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Road tests */}
            {!disputed && (
              <div className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">Road tests</h4>
                  {canRequestRoadTest && (
                    <Button size="sm" variant="outline" className="min-h-9 gap-1.5" onClick={() => setDialog('roadtest-request')}>
                      <Gauge className="h-3.5 w-3.5" /> Request road test
                    </Button>
                  )}
                </div>
                {detail.roadTests.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {detail.roadTestAllowed
                      ? 'No road tests yet. Request one when the job needs an on-road check.'
                      : 'The customer has not authorised road tests for this job.'}
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {detail.roadTests.map((rt) => {
                      const rm = ROAD_TEST_META[rt.status] ?? { label: rt.status, badge: 'bg-muted text-muted-foreground' }
                      return (
                        <div key={rt.id} className={rt.incident ? 'rounded-lg border border-destructive/50 bg-destructive/5 p-3' : 'rounded-lg border p-3'}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium">{rt.purpose}</p>
                            <Badge variant="outline" className={rm.badge}>{rm.label}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Driver: {rt.driverName} · requested {timeAgo(rt.requestedAt)}
                            {rt.startOdometerKm != null && ` · out ${rt.startOdometerKm.toLocaleString()} km`}
                            {rt.endOdometerKm != null && ` · in ${rt.endOdometerKm.toLocaleString()} km`}
                          </p>
                          {rt.notes && <p className="mt-1 text-xs text-muted-foreground">Notes: {rt.notes}</p>}
                          {rt.incident && (
                            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-destructive">
                              <Ban className="h-3 w-3" /> Incident reported on this road test
                            </p>
                          )}
                          {rt.status === 'AUTHORISED' && (
                            <Button size="sm" className="mt-2 min-h-9 gap-1.5" onClick={() => { setActiveRoadTest(rt); setDialog('roadtest-start') }}>
                              <Play className="h-3.5 w-3.5" /> Start (record odometer)
                            </Button>
                          )}
                          {rt.status === 'IN_PROGRESS' && (
                            <Button size="sm" className="mt-2 min-h-9 gap-1.5" onClick={() => { setActiveRoadTest(rt); setDialog('roadtest-end') }}>
                              <CheckCircle2 className="h-3.5 w-3.5" /> End road test
                            </Button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Release verification */}
            {canVerify && !disputed && (
              <div className="rounded-xl border border-primary/50 bg-primary/5 p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-primary dark:text-[#9dc3ae]">
                  <KeyRound className="h-4 w-4" /> Release verification
                </h4>
                {authActive && detail.collectionAuth && (
                  <div className="mt-2 rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-sm">
                    <p className="font-medium">Active collection authorisation</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Collector: <strong className="text-foreground">{detail.collectionAuth.collectorName}</strong> · code hint{' '}
                      <strong className="font-mono text-foreground">{detail.collectionAuth.codeHint}</strong> · valid until{' '}
                      {dateLabel(detail.collectionAuth.expiresAt)}
                    </p>
                  </div>
                )}
                <p className="mt-2 text-sm text-muted-foreground">
                  Ask the person collecting for their 6-digit code and enter it with their name. The vehicle is marked
                  returned only after the code verifies — never hand over keys without it.
                </p>
                <Button className="mt-3 min-h-11 gap-2" onClick={() => setDialog('verify')}>
                  <ShieldCheck className="h-4 w-4" /> Verify collection
                </Button>
              </div>
            )}

            {/* Timeline */}
            <div>
              <h4 className="text-sm font-semibold">Event timeline</h4>
              <Stagger className="mt-2 space-y-3">
                {detail.events.map((ev) => (
                  <StaggerItem key={ev.id}>
                    <div className="flex gap-3 text-sm">
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#c9a45c] ring-4 ring-[#c9a45c]/10" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="font-medium">{custodyEventLabel(ev)}</p>
                        {ev.note && <p className="text-muted-foreground">{ev.note}</p>}
                        <p className="text-xs text-muted-foreground">
                          {timeAgo(ev.createdAt)}{ev.actorName ? ` · ${ev.actorName}` : ''}{ev.actorSide ? ` (${ev.actorSide.toLowerCase()})` : ''}
                        </p>
                      </div>
                    </div>
                  </StaggerItem>
                ))}
              </Stagger>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>

    {/* ── Receive vehicle dialog ── */}
    <ReceiveVehicleDialog
      open={dialog === 'receive'}
      busy={busy}
      onCancel={() => setDialog(null)}
      onSubmit={(staffName) => patchCustody({ action: 'receive', staffName }, 'Vehicle received into custody')}
    />

    {/* ── Ready for collection dialog ── */}
    <ReadyForCollectionDialog
      open={dialog === 'ready'}
      busy={busy}
      onCancel={() => setDialog(null)}
      onSubmit={async (payload) => {
        const ok = await patchCustody({ action: 'status', status: 'READY_FOR_COLLECTION', ...payload }, 'Marked ready for collection — the customer can now authorise release')
        return ok
      }}
    />

    {/* ── Note dialog ── */}
    <NoteDialog
      open={dialog === 'note'}
      busy={busy}
      onCancel={() => setDialog(null)}
      onSubmit={(note) => patchCustody({ action: 'note', note }, 'Note added to the custody record')}
    />

    {/* ── Request road test dialog ── */}
    <RequestRoadTestDialog
      open={dialog === 'roadtest-request'}
      busy={busy}
      onCancel={() => setDialog(null)}
      onSubmit={(purpose, driverName) => patchCustody({ action: 'request-roadtest', purpose, driverName }, 'Road test requested — awaiting customer authorisation')}
    />

    {/* ── Start road test dialog ── */}
    <OdometerDialog
      open={dialog === 'roadtest-start'}
      title="Start road test"
      description={activeRoadTest ? `${activeRoadTest.purpose} — driver ${activeRoadTest.driverName}. Record the odometer before leaving the yard.` : ''}
      label="Odometer out (km)"
      submitLabel="Start test"
      busy={busy}
      onCancel={() => setDialog(null)}
      onSubmit={(km) => patchCustody({ action: 'start-roadtest', roadTestId: activeRoadTest?.id, startOdometerKm: km }, 'Road test started')}
    />

    {/* ── End road test dialog ── */}
    <EndRoadTestDialog
      open={dialog === 'roadtest-end'}
      roadTest={activeRoadTest}
      busy={busy}
      onCancel={() => setDialog(null)}
      onSubmit={(km, notes, incident) => patchCustody(
        { action: 'end-roadtest', roadTestId: activeRoadTest?.id, endOdometerKm: km, notes: notes || undefined, incident: incident || undefined },
        incident ? 'Road test ended — incident flagged and CARMAZE notified' : 'Road test completed',
      )}
    />

    {/* ── Verify collection dialog ── */}
    <VerifyCollectionDialog
      open={dialog === 'verify'}
      busy={busy}
      vehicleLabel={detail ? `${detail.vehicleDesc}${detail.plate ? ` (${detail.plate})` : ''}` : ''}
      onCancel={() => setDialog(null)}
      onSubmit={async (collectorName, authCode) => {
        if (!custodyId) return false
        setBusy(true)
        try {
          await apiSend(`/api/custody/${custodyId}/collect`, 'POST', { collectorName, authCode })
          toast.success('Code verified — vehicle released. Custody closed as RETURNED.')
          setDialog(null)
          await load(custodyId, true)
          onChanged()
          return true
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Verification failed — check the name and code.')
          return false
        } finally {
          setBusy(false)
        }
      }}
    />
    </>
  )
}

function custodyEventLabel(ev: OrgCustodyEvent): string {
  const labels: Record<string, string> = {
    CREATED: 'Custody requested',
    RECEIVE: 'Vehicle received',
    STATUS_CHANGED: 'Status updated',
    NOTE: 'Note added',
    ROAD_TEST_REQUESTED: 'Road test requested',
    ROAD_TEST_AUTHORISED: 'Road test authorised by customer',
    ROAD_TEST_DECLINED: 'Road test declined by customer',
    ROAD_TEST_STARTED: 'Road test started',
    ROAD_TEST_ENDED: 'Road test ended',
    COMPLETION_RECORDED: 'Completion recorded',
    COLLECTION_AUTH_CREATED: 'Third-party collection authorised',
    COLLECTION_AUTH_REVOKED: 'Collection authorisation revoked',
    COLLECT_SELF: 'Customer confirmed personal collection',
    COLLECTED: 'Vehicle collected — code verified',
    DISPUTE: 'Dispute opened',
    INCIDENT: 'Incident reported',
  }
  if (labels[ev.type]) return labels[ev.type]
  if (ev.toStatus) {
    const m = CUSTODY_META[ev.toStatus]
    return `Moved to ${m?.label.toLowerCase() ?? ev.toStatus.toLowerCase()}`
  }
  return ev.type.replaceAll('_', ' ').toLowerCase()
}

// ─────────────────────────── Custody sub-dialogs ───────────────────────────

function ReceiveVehicleDialog({ open, busy, onCancel, onSubmit }: {
  open: boolean
  busy: boolean
  onCancel: () => void
  onSubmit: (staffName: string) => void
}) {
  const [staffName, setStaffName] = useState('')
  const valid = staffName.trim().length >= 2

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Receive the vehicle</DialogTitle>
          <DialogDescription>Record which staff member physically checked the vehicle in.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cu-staff">Staff member receiving *</Label>
          <Input id="cu-staff" value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="e.g. John Mwangi" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button disabled={busy || !valid} onClick={() => onSubmit(staffName.trim())} className="min-h-11">
            {busy ? 'Saving…' : 'Confirm receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReadyForCollectionDialog({ open, busy, onCancel, onSubmit }: {
  open: boolean
  busy: boolean
  onCancel: () => void
  onSubmit: (payload: { completedWork: string; finalOdometerKm?: number; finalNotes?: string; costMinor?: number; completionPhotos?: string[] }) => Promise<boolean>
}) {
  const [completedWork, setCompletedWork] = useState('')
  const [finalOdometer, setFinalOdometer] = useState('')
  const [finalNotes, setFinalNotes] = useState('')
  const [cost, setCost] = useState('')
  const [photos, setPhotos] = useState<{ url: string; name: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) { setCompletedWork(''); setFinalOdometer(''); setFinalNotes(''); setCost(''); setPhotos([]) }
  }, [open])

  const costMinor = cost.trim() ? kesToMinor(cost) : null
  const costInvalid = cost.trim() !== '' && costMinor === null
  const valid = completedWork.trim().length >= 5

  async function uploadPhoto(file: File) {
    if (photos.length >= 4) { toast.error('Up to 4 completion photos.'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const d = await apiUpload<{ url: string; name: string }>('/api/upload', fd)
      setPhotos((prev) => [...prev, { url: d.url, name: d.name || file.name }])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    if (!valid) return
    setSaving(true)
    const ok = await onSubmit({
      completedWork: completedWork.trim(),
      finalOdometerKm: finalOdometer.trim() ? parseInt(finalOdometer.trim(), 10) : undefined,
      finalNotes: finalNotes.trim() || undefined,
      costMinor: costMinor ?? undefined,
      completionPhotos: photos.length > 0 ? photos.map((p) => p.url) : undefined,
    })
    setSaving(false)
    if (ok) setCompletedWork('')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark ready for collection</DialogTitle>
          <DialogDescription>Record what was done — the customer sees this before authorising release.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cu-done">Completed work *</Label>
            <Textarea id="cu-done" rows={3} value={completedWork} onChange={(e) => setCompletedWork(e.target.value)} placeholder="e.g. Replaced front brake pads, full service, wheel alignment…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cu-odo">Final odometer (km)</Label>
              <Input id="cu-odo" inputMode="numeric" value={finalOdometer} onChange={(e) => setFinalOdometer(e.target.value)} placeholder="e.g. 84210" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cu-cost">Final cost (KES)</Label>
              <div className="flex gap-2">
                <Input id="cu-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="e.g. 12500" />
              </div>
              {costInvalid && <p className="text-xs text-destructive">Enter a valid KES amount.</p>}
              {costMinor !== null && <Badge variant="secondary">{money(costMinor)}</Badge>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cu-fnotes">Notes for the customer (optional)</Label>
            <Textarea id="cu-fnotes" rows={2} value={finalNotes} onChange={(e) => setFinalNotes(e.target.value)} placeholder="Advice, next service due, watch-outs…" />
          </div>
          <div className="space-y-1.5">
            <Label>Completion photos (optional, up to 4)</Label>
            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground transition-colors hover:bg-muted/60">
              <Upload className="h-4 w-4" />
              {uploading ? 'Uploading…' : 'Upload a photo'}
              <input
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.currentTarget.value = '' }}
              />
            </label>
            {photos.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {photos.map((p, i) => (
                  <div key={p.url} className="relative">
                    { }
                    <img src={p.url} alt={p.name} className="aspect-square w-full rounded-lg border object-cover" />
                    <button
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-destructive"
                      aria-label={`Remove photo ${p.name}`}
                      onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy || saving} onClick={onCancel}>Cancel</Button>
          <Button onClick={submit} disabled={busy || saving || !valid || costInvalid} className="min-h-11">
            {saving ? 'Saving…' : 'Mark ready'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NoteDialog({ open, busy, onCancel, onSubmit }: {
  open: boolean
  busy: boolean
  onCancel: () => void
  onSubmit: (note: string) => void
}) {
  const [note, setNote] = useState('')
  const valid = note.trim().length >= 2

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a note to the custody record</DialogTitle>
          <DialogDescription>Notes are visible to the customer in their Vehicle Protection timeline.</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Customer called — approved extra coolant flush." aria-label="Note" />
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button disabled={busy || !valid} onClick={() => { onSubmit(note.trim()); setNote('') }} className="min-h-11">Save note</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RequestRoadTestDialog({ open, busy, onCancel, onSubmit }: {
  open: boolean
  busy: boolean
  onCancel: () => void
  onSubmit: (purpose: string, driverName: string) => void
}) {
  const [purpose, setPurpose] = useState('')
  const [driverName, setDriverName] = useState('')
  const valid = purpose.trim().length >= 3 && driverName.trim().length >= 2

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Request a road test</DialogTitle>
          <DialogDescription>
            The customer must authorise this before the vehicle leaves your yard. Record who will drive.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rt-purpose">Purpose *</Label>
            <Input id="rt-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Verify steering fix on rough road" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rt-driver">Driver name *</Label>
            <Input id="rt-driver" value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="e.g. Samuel Kariuki (technician)" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button disabled={busy || !valid} onClick={() => { onSubmit(purpose.trim(), driverName.trim()); setPurpose(''); setDriverName('') }} className="min-h-11">
            {busy ? 'Sending…' : 'Request authorisation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OdometerDialog({ open, title, description, label, submitLabel, busy, onCancel, onSubmit }: {
  open: boolean
  title: string
  description: string
  label: string
  submitLabel: string
  busy: boolean
  onCancel: () => void
  onSubmit: (km: number) => void
}) {
  const [km, setKm] = useState('')
  const parsed = parseInt(km.trim(), 10)
  const valid = Number.isFinite(parsed) && parsed >= 0

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rt-odo">{label} *</Label>
          <Input id="rt-odo" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} placeholder="e.g. 84210" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button disabled={busy || !valid} onClick={() => { onSubmit(parsed); setKm('') }} className="min-h-11">
            {busy ? 'Saving…' : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EndRoadTestDialog({ open, roadTest, busy, onCancel, onSubmit }: {
  open: boolean
  roadTest: OrgRoadTest | null
  busy: boolean
  onCancel: () => void
  onSubmit: (endOdometerKm: number, notes: string, incident: boolean) => void
}) {
  const [km, setKm] = useState('')
  const [notes, setNotes] = useState('')
  const [incident, setIncident] = useState(false)
  const parsed = parseInt(km.trim(), 10)
  const valid = Number.isFinite(parsed) && parsed >= 0

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>End road test</DialogTitle>
          <DialogDescription>
            {roadTest ? `${roadTest.purpose} — out at ${roadTest.startOdometerKm != null ? `${roadTest.startOdometerKm.toLocaleString()} km` : '—'}.` : ''} Record the return odometer.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rt-endo">Odometer in (km) *</Label>
            <Input id="rt-endo" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} placeholder="e.g. 84265" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rt-enotes">Notes (optional)</Label>
            <Textarea id="rt-enotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How the vehicle behaved…" />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={incident} onCheckedChange={(v) => setIncident(v === true)} aria-label="Flag an incident on this road test" />
            Flag an incident (damage, warning light, unexpected behaviour)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            disabled={busy || !valid}
            variant={incident ? 'destructive' : 'default'}
            onClick={() => { onSubmit(parsed, notes.trim(), incident); setKm(''); setNotes(''); setIncident(false) }}
            className="min-h-11"
          >
            {busy ? 'Saving…' : 'End test'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function VerifyCollectionDialog({ open, busy, vehicleLabel, onCancel, onSubmit }: {
  open: boolean
  busy: boolean
  vehicleLabel: string
  onCancel: () => void
  onSubmit: (collectorName: string, authCode: string) => Promise<boolean>
}) {
  const [collectorName, setCollectorName] = useState('')
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const valid = collectorName.trim().length >= 2 && /^\d{6}$/.test(code.trim())

  async function submit() {
    if (!valid) return
    setVerifying(true)
    const ok = await onSubmit(collectorName.trim(), code.trim())
    setVerifying(false)
    if (ok) { setCollectorName(''); setCode('') }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Verify collection</DialogTitle>
          <DialogDescription>
            {vehicleLabel && `${vehicleLabel} — `}enter the collector&apos;s name and the 6-digit code the customer shared.
            The code is single-use and valid for 48 hours.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="vc-name">Collector&apos;s name *</Label>
            <Input id="vc-name" value={collectorName} onChange={(e) => setCollectorName(e.target.value)} placeholder="Full name as authorised by the customer" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vc-code">6-digit code *</Label>
            <Input
              id="vc-code"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="······"
              className="max-w-40 font-mono text-lg tracking-[0.3em]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={submit} disabled={busy || verifying || !valid} className="min-h-11 gap-2">
            {verifying || busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Verify &amp; release
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
