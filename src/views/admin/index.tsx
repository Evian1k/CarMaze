'use client'

/**
 * CARMAZE Control Center (#/admin): staff-only platform administration
 * plus the billing console (subscriptions, campaigns, M-Pesa).
 *
 * Honesty rules encoded here:
 *  - Every number comes from a live API aggregate; nothing hardcoded.
 *  - Integration chips show REAL configuration state (e.g. M-Pesa
 *    "not configured" is shown in amber, never faked as green).
 *  - Payment actions never pretend success: STK push failures surface the
 *    server's 501/502 states and manual mark-paid requires a written
 *    reconciliation note that is audit-logged.
 * Server-side authorisation is the source of truth; the role gate below is
 * only UX: APIs enforce the same rules.
 */

import { useEffect, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  BellRing,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Handshake,
  Inbox,
  KeyRound,
  LifeBuoy,
  Megaphone,
  MoreHorizontal,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldAlert,
  Star,
  Truck,
  Undo2,
  UserPlus,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, CartesianGrid } from 'recharts'

import { apiGet, apiSend, buildQuery, navigate } from '@/lib/client'
import { hasAnyRole, useAuth, type CurrentUser } from '@/stores/auth'
import { useHashRoute } from '@/hooks/use-hash-route'
import { money, compactMoney, timeAgo, dateLabel, VEHICLE_STATUS_LABELS, APPLICATION_STATUS_LABELS, vehicleTitle } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AdminSupplyConsole } from '@/components/admin/supply-console'
import { AdminRevenueDashboard } from '@/components/admin/revenue-dashboard'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { VerificationCenter } from '@/components/admin/verification-center'
import { DemoTab } from '@/views/admin/demo-tab'

// ───────────────────────────── Constants & helpers ─────────────────────────────

const GREEN = '#315E4B'
const GOLD = '#D9B878'
const PIE_COLORS = ['#315E4B', '#D9B878', '#7FA08E', '#6E6E67', '#B0A284', '#5C8A73', '#C9B285', '#8FA99F']

const TABS = [
  'overview', 'applications', 'verification', 'listings', 'users', 'staff', 'reports', 'billing',
  'campaigns', 'partners', 'support', 'notifications', 'settings', 'audit',
  'supply', 'revenue', 'demo',
] as const
type TabKey = (typeof TABS)[number]

const TAB_LABELS: Record<TabKey, string> = {
  overview: 'Overview',
  applications: 'Applications',
  verification: 'Verification Center',
  listings: 'Listings',
  users: 'Users',
  staff: 'Staff',
  reports: 'Reports',
  billing: 'Billing',
  campaigns: 'Campaigns',
  partners: 'Partners',
  support: 'Support',
  notifications: 'Notifications',
  settings: 'Settings',
  audit: 'Audit',
  supply: 'Supply Network',
  revenue: 'Revenue',
  demo: 'Demo',
}

const STAFF_ROLES_CLIENT = ['SUPPORT', 'REVIEWER', 'MODERATOR', 'FINANCE', 'ADMIN', 'FOUNDER'] as const

const DEPARTMENT_LABELS: Record<string, string> = {
  BUSINESS_VERIFICATION: 'Business verification',
  SUPPORT: 'Support',
  FINANCE: 'Finance',
  DISPUTES: 'Disputes',
  FRAUD: 'Fraud',
  MODERATION: 'Moderation',
  TECHNICAL: 'Technical',
}

// Per-tab role gates: tabs without an entry are visible to all staff.
// Server APIs enforce the same rules; this is UX only.
const TAB_ROLES: Partial<Record<TabKey, readonly string[]>> = {
  staff: ['ADMIN', 'FOUNDER'],
  demo: ['ADMIN', 'FOUNDER'],
  // GET /api/admin/revenue requires the FINANCE tier: keep the nav in step.
  revenue: ['FINANCE', 'ADMIN', 'FOUNDER'],
}

function tabVisibleFor(user: CurrentUser | null, t: TabKey): boolean {
  const roles = TAB_ROLES[t]
  return !roles || hasAnyRole(user, ...roles)
}

type Tone = 'green' | 'gold' | 'red' | 'neutral'

function toneFor(status: string): Tone {
  const green = ['PUBLISHED', 'APPROVED', 'ACTIVE', 'PAID', 'RESOLVED', 'SUCCESS', 'SENT', 'CONNECTED', 'CONFIGURED', 'DONE']
  const gold = ['PENDING_REVIEW', 'PENDING', 'PENDING_PAYMENT', 'OPEN', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'RESUBMITTED', 'INITIATED', 'QUEUED', 'RESERVED', 'PAST_DUE']
  const red = ['REJECTED', 'SUSPENDED', 'FAILED', 'OVERDUE', 'REVOKED', 'ERROR']
  if (green.includes(status)) return 'green'
  if (gold.includes(status)) return 'gold'
  if (red.includes(status)) return 'red'
  return 'neutral'
}

const TONE_CLASSES: Record<Tone, string> = {
  green: 'border-primary/30 bg-primary/10 text-primary',
  gold: 'border-[#c9a94e]/50 bg-[#d9b878]/15 text-gold-ink dark:text-[#d9b878]',
  red: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  neutral: 'border-border bg-muted text-muted-foreground',
}

function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge variant="outline" className={`font-medium ${TONE_CLASSES[toneFor(status)]}`}>
      {label ?? status.replaceAll('_', ' ').toLowerCase()}
    </Badge>
  )
}

function StatCard({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: Tone }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'gold' ? 'text-gold-ink dark:text-[#d9b878]' : tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'green' ? 'text-primary' : ''}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </Card>
  )
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-20" aria-busy="true">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <span className="sr-only">Loading</span>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
      <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="max-w-sm px-4 text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" aria-hidden />
      <AlertTitle>Could not load data</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{message}</span>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

function LoadingCards({ n = 6 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  )
}

// ───────────────────────────── API payload types ─────────────────────────────

type Health = {
  status: string
  checks: { database: string; mpesa: string; email: string; sms: string; ai: string }
}

type OverviewData = {
  users: { total: number; suspended: number; newThisWeek: number }
  orgs: {
    dealers: { total: number; active: number; pending: number }
    garages: { total: number; active: number; pending: number }
  }
  listings: { published: number; pendingReview: number; sold: number; rejected: number; drafts: number }
  enquiries: { total: number; open: number }
  revenue: { paidTotalMinor: number; pendingCount: number; pendingTotalMinor: number; byType: { type: string; paidMinor: number; pendingMinor: number }[] }
  campaigns: { active: number; pendingPayment: number }
  ops: { failedNotifications: number; failedPayments: number; openReports: number; openTickets: number; escalatedApplications: number }
  recentAudit: { action: string; actorName: string | null; targetType: string | null; targetId: string | null; createdAt: string }[]
  chart: { listingsByStatus: { status: string; count: number }[] }
}

type AppEvent = { id: string; type: string; actorName?: string | null; note?: string | null; createdAt: string }
type AppDoc = { name: string; url: string; uploadedAt?: string }
type QueueApplication = {
  id: string
  refCode: string
  type: string
  orgName: string
  regNo: string | null
  county: string
  town: string | null
  physicalAddress: string | null
  phone: string
  email: string | null
  representative: string
  accountType: string | null
  categories: string | null
  documents: string | null
  notes: string | null
  status: string
  reviewSlaHours: number
  submittedAt: string | null
  reviewOwnerId: string | null
  reviewOwnerName: string | null
  decisionNote: string | null
  infoRequestedAt: string | null
  correctionsDueAt: string | null
  escalated: boolean
  createdAt: string
  user: { name: string; email: string; phone: string | null }
  events: AppEvent[]
}

type AdminListing = {
  id: string
  refCode: string
  make: string
  model: string
  year: number
  priceMinor: number
  status: string
  sellerType: string
  featured: boolean
  reviewNote: string | null
  county: string
  createdAt: string
  photos: { url: string; order: number }[]
  owner: { id: string; name: string; email: string; phone: string | null }
  org: { name: string; type: string } | null
}

type UserRow = {
  id: string
  name: string
  email: string
  roles: string[]
  phone: string | null
  status: string
  createdAt: string
  memberships: { orgName: string; orgType: string; role: string }[]
}

type ReportRow = {
  id: string
  targetType: string
  targetId: string
  reason: string
  details: string | null
  status: string
  resolutionNote: string | null
  createdAt: string
}

type PaymentRow = { id: string; provider: string; phone: string; amountMinor: number; status: string; resultDesc: string | null; createdAt: string }
type InvoiceRow = {
  id: string
  refCode: string
  org: { name: string; type: string } | null
  type: string
  description: string
  amountMinor: number
  currency: string
  status: string
  issuedAt: string
  dueDate: string | null
  paidAt: string | null
  paidVia: string | null
  payments: PaymentRow[]
}

type CampaignRow = {
  id: string
  refCode: string
  org: { name: string; type: string }
  vehicle: { refCode: string; make: string; model: string; year: number; status: string }
  packageCode: string
  packageName: string
  packageDays: number | null
  packagePriceMinor: number | null
  status: string
  startsAt: string | null
  endsAt: string | null
  impressions: number
  clicks: number
  createdAt: string
  invoice: { refCode: string; status: string; amountMinor: number } | null
}

type TicketRow = {
  id: string
  refCode: string
  name: string
  email: string
  subject: string
  message: string
  status: string
  response: string | null
  createdAt: string
}

type OpsData = {
  failedDeliveries: { id: string; channel: string; status: string; lastError: string | null; notification: { title: string; type: string }; createdAt: string }[]
  paymentAttempts: { id: string; invoice: { refCode: string; status: string }; provider: string; phone: string; amountMinor: number; status: string; resultDesc: string | null; createdAt: string }[]
  tickets: TicketRow[]
  health: { mpesa: boolean; email: boolean; sms: boolean }
}

type PartnerNote = { by: string; at: string; text: string }

type PartnerRow = {
  id: string
  refCode: string
  name: string
  category: string
  county: string
  serviceAreas: string[] | string | null
  description: string | null
  logoUrl: string | null
  coverUrl: string | null
  phone: string | null
  email: string | null
  whatsapp: boolean
  website: string | null
  contactName: string | null
  status: string
  verified: boolean
  rating: number | null
  referrals: number
  notes: string | null
  notesList?: PartnerNote[]
  rejectionReason: string | null
  createdAt: string
  updatedAt: string
}

type PartnerCounts = { PENDING: number; APPROVED: number; SUSPENDED: number; REJECTED: number }

type BroadcastRow = {
  id: string
  actorName: string | null
  createdAt: string
  title: string
  audience: string
  recipients: number | null
  link: string | null
}

type SettingsData = { settings: { key: string; value: unknown; updatedAt: string }[]; allowedKeys: string[] }

type AuditRow = {
  id: string
  actorId: string | null
  actorName: string | null
  action: string
  targetType: string | null
  targetId: string | null
  metadata: string | null
  createdAt: string
}

// ───────────────────────────── Root view ─────────────────────────────

export default function View() {
  const user = useAuth((s) => s.user)
  const authLoading = useAuth((s) => s.loading)
  const route = useHashRoute()
  const [health, setHealth] = useState<Health | null>(null)
  const [sweeping, setSweeping] = useState(false)

  const tabParamRaw = route.query.get('tab')
  // 'disputes' deep-link alias: some notifications link to /admin?tab=disputes,
  // but disputes live INSIDE the Supply Network console (its own internal tab).
  // AdminSupplyConsole keeps its own tab state and accepts no initial-subtab
  // prop, so the alias safely maps to the 'supply' tab; the Disputes sub-view
  // is one click inside it.
  const tabParam = tabParamRaw === 'disputes' ? 'supply' : tabParamRaw
  let tab: TabKey = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as TabKey) : 'overview'
  // Role-gated tabs fall back to the overview when the signed-in staff member
  // lacks the required role (e.g. ?tab=staff as plain SUPPORT).
  if (!tabVisibleFor(user, tab)) tab = 'overview'
  const isStaff = hasAnyRole(user, ...STAFF_ROLES_CLIENT)
  // Exposed by the auth layer for staff accounts; guarded so the view works
  // before/without it too.
  const staffDepartment = (user as (CurrentUser & { department?: string | null }) | null)?.department ?? null

  useEffect(() => {
    let alive = true
    apiGet<Health>('/api/health')
      .then((d) => {
        if (alive) setHealth(d)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  function runSweep() {
    setSweeping(true)
    apiSend<{ reviewed: number; reviewerReminders: number; applicantReminders: number; escalations: number }>('/api/applications/sweep', 'POST')
      .then((r) => {
        toast.success(
          `Sweep complete: ${r.reviewed} active applications checked, ${r.reviewerReminders} reviewer reminders, ${r.applicantReminders} applicant reminders, ${r.escalations} escalations.`
        )
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setSweeping(false))
  }

  if (authLoading) return <Loading />
  if (!user || !isStaff) return <Restricted />

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
        <header>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
                CARMAZE Control Center
                <ShieldAlert className="h-5 w-5 text-primary" aria-hidden />
                {staffDepartment ? (
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                    {DEPARTMENT_LABELS[staffDepartment] ?? staffDepartment.replaceAll('_', ' ').toLowerCase()}
                  </Badge>
                ) : null}
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Platform operations, verification and billing: live aggregates, honest payment states.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <HealthChips health={health} />
              <Button size="sm" variant="outline" onClick={runSweep} disabled={sweeping}>
                <RefreshCw className={`mr-1.5 h-4 w-4 ${sweeping ? 'animate-spin' : ''}`} aria-hidden />
                {sweeping ? 'Sweeping…' : 'Run follow-up sweep'}
              </Button>
            </div>
          </div>

          <nav aria-label="Control Center sections" className="mt-5 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {TABS.filter((t) => tabVisibleFor(user, t)).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => navigate(`admin?tab=${t}`)}
                aria-current={tab === t ? 'page' : undefined}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </nav>
        </header>

        <div className="mt-5">
          {tab === 'overview' && <OverviewTab />}
          {tab === 'applications' && <ApplicationsTab user={user} />}
          {tab === 'verification' && <VerificationCenter />}
          {tab === 'listings' && <ListingsTab />}
          {tab === 'users' && <UsersTab user={user} />}
          {tab === 'staff' && <StaffTab user={user} />}
          {tab === 'reports' && <ReportsTab />}
          {tab === 'billing' && <BillingTab user={user} />}
          {tab === 'campaigns' && <CampaignsTab />}
          {tab === 'partners' && <PartnersTab />}
          {tab === 'support' && <SupportTab />}
          {tab === 'notifications' && <NotificationsTab user={user} />}
          {tab === 'settings' && <SettingsTab user={user} />}
          {tab === 'audit' && <AuditTab />}
          {tab === 'supply' && <AdminSupplyConsole />}
          {tab === 'revenue' && <AdminRevenueDashboard />}
          {tab === 'demo' && <DemoTab />}
        </div>
      </main>
    </div>
  )
}

function Restricted() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-md p-6 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">Restricted</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This area is limited to authorised CARMAZE staff accounts. If you believe you should have access, contact the platform team.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('')}>
          Back to marketplace
        </Button>
      </Card>
    </div>
  )
}

function HealthChips({ health }: { health: Health | null }) {
  if (!health) {
    return (
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-7 w-24 rounded-full" />
        ))}
      </div>
    )
  }
  const items = [
    { label: 'DB', ok: health.checks.database === 'connected', okText: 'Live', badText: 'DB error' },
    { label: 'M-Pesa', ok: health.checks.mpesa === 'configured', okText: 'Configured', badText: 'Not configured' },
    { label: 'Email', ok: health.checks.email === 'configured', okText: 'Configured', badText: 'Not configured' },
    { label: 'SMS', ok: health.checks.sms === 'configured', okText: 'Configured', badText: 'Not configured' },
  ]
  return (
    <div className="flex flex-wrap gap-1.5" role="status" aria-label="Integration status">
      {items.map((i) => (
        <Badge
          key={i.label}
          variant="outline"
          className={
            i.ok
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-[#c9a94e]/50 bg-[#d9b878]/15 text-gold-ink dark:text-[#d9b878]'
          }
        >
          {i.ok ? <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden /> : <AlertTriangle className="mr-1 h-3 w-3" aria-hidden />}
          {i.label}: {i.ok ? i.okText : i.badText}
        </Badge>
      ))}
    </div>
  )
}

// ───────────────────────────── Overview ─────────────────────────────

function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    apiGet<OverviewData>('/api/admin/overview')
      .then((d) => {
        if (alive) setData(d)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [reload])

  if (error) return <ErrorNote message={error} onRetry={() => setReload((r) => r + 1)} />
  if (!data) return <LoadingCards n={9} />

  const rev = data.revenue
  const revenueChartData = rev.byType.map((t) => ({
    name: t.type === 'SUBSCRIPTION' ? 'Subscriptions' : t.type === 'CAMPAIGN' ? 'Campaigns' : 'Lead fees',
    Paid: t.paidMinor / 100,
    Pending: t.pendingMinor / 100,
  }))
  const hasRevenue = rev.paidTotalMinor > 0 || rev.pendingTotalMinor > 0
  const pieData = data.chart.listingsByStatus.map((s) => ({
    name: VEHICLE_STATUS_LABELS[s.status] ?? s.status,
    value: s.count,
  }))
  const hasListings = pieData.some((p) => p.value > 0)

  return (
    <div className="space-y-5">
      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Users" value={data.users.total} sub={`+${data.users.newThisWeek} this week · ${data.users.suspended} suspended`} />
        <StatCard label="Dealers" value={`${data.orgs.dealers.active}/${data.orgs.dealers.total}`} sub={`${data.orgs.dealers.pending} application(s) in queue`} tone="green" />
        <StatCard label="Garages" value={`${data.orgs.garages.active}/${data.orgs.garages.total}`} sub={`${data.orgs.garages.pending} application(s) in queue`} tone="green" />
        <StatCard label="Live listings" value={data.listings.published} sub={`${data.listings.pendingReview} pending review`} />
        <StatCard label="Paid revenue" value={compactMoney(rev.paidTotalMinor)} sub={`${rev.pendingCount} invoice(s) pending · ${compactMoney(rev.pendingTotalMinor)}`} tone="green" />
        <StatCard label="Campaigns" value={data.campaigns.active} sub={`${data.campaigns.pendingPayment} awaiting payment`} />
      </section>

      <section aria-label="Operations flags" className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <OpsFlag label="Failed notifications" count={data.ops.failedNotifications} tab="notifications" />
        <OpsFlag label="Failed payments" count={data.ops.failedPayments} tab="notifications" />
        <OpsFlag label="Open reports" count={data.ops.openReports} tab="reports" />
        <OpsFlag label="Open tickets" count={data.ops.openTickets} tab="support" />
        <OpsFlag label="Escalated applications" count={data.ops.escalatedApplications} tab="applications" />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Revenue by invoice type</h3>
          <p className="mb-3 text-xs text-muted-foreground">Paid vs pending (KES): computed live from invoices.</p>
          {hasRevenue ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={revenueChartData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}K` : String(v))} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => money(Number(value) * 100)} contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--popover)', color: 'var(--popover-foreground)', fontSize: 13 }} itemStyle={{ color: 'var(--popover-foreground)' }} labelStyle={{ color: 'var(--muted-foreground)', marginBottom: 4 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Paid" fill={GREEN} radius={[4, 4, 0, 0]} maxBarSize={48} />
                <Bar dataKey="Pending" fill={GOLD} radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No invoices yet: the revenue chart fills in as subscriptions and campaigns are paid." />
          )}
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold">Listings by status</h3>
          <p className="mb-3 text-xs text-muted-foreground">Marketplace inventory health at a glance.</p>
          {hasListings ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={85} paddingAngle={2} strokeWidth={1}>
                  {pieData.map((entry, i) => (
                    <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--popover)', color: 'var(--popover-foreground)', fontSize: 13 }} itemStyle={{ color: 'var(--popover-foreground)' }} labelStyle={{ color: 'var(--muted-foreground)', marginBottom: 4 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No listings yet." />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Recent audit trail</h3>
          <p className="mb-2 text-xs text-muted-foreground">Latest 8 platform events. Full trail in the Audit tab.</p>
          {data.recentAudit.length === 0 ? (
            <EmptyState message="No audit entries yet." />
          ) : (
            <ul className="divide-y">
              {data.recentAudit.map((a, i) => (
                <li key={`${a.action}-${i}`} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{a.action.replaceAll('_', ' ').toLowerCase()}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.actorName ?? 'system'}
                      {a.targetType ? ` · ${a.targetType.toLowerCase()}` : ''}
                    </p>
                  </div>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">{timeAgo(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold">Queue &amp; content summary</h3>
          <p className="mb-2 text-xs text-muted-foreground">Where attention is needed right now.</p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Listing review queue</span>
              <Button size="sm" variant="ghost" onClick={() => navigate('admin?tab=listings')}>
                {data.listings.pendingReview} pending <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden />
              </Button>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Verification applications</span>
              <Button size="sm" variant="ghost" onClick={() => navigate('admin?tab=applications')}>
                {data.orgs.dealers.pending + data.orgs.garages.pending} in queue <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden />
              </Button>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Enquiries (open)</span>
              <span className="tabular-nums">
                {data.enquiries.open} / {data.enquiries.total}
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Sold / rejected / drafts</span>
              <span className="tabular-nums">
                {data.listings.sold} / {data.listings.rejected} / {data.listings.drafts}
              </span>
            </li>
          </ul>
          <Separator className="my-3" />
          <p className="text-xs text-muted-foreground">
            All figures are computed on request from live database aggregates; nothing cached, nothing estimated.
          </p>
        </Card>
      </div>
    </div>
  )
}

function OpsFlag({ label, count, tab }: { label: string; count: number; tab: TabKey }) {
  return (
    <button
      type="button"
      onClick={() => navigate(`admin?tab=${tab}`)}
      className={`rounded-xl border p-3 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05] ${count > 0 ? 'border-[#c9a94e]/60 bg-[#d9b878]/10' : 'border-border bg-card'}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${count > 0 ? 'text-gold-ink dark:text-[#d9b878]' : 'text-muted-foreground'}`}>{count}</p>
    </button>
  )
}

// ───────────────────────────── Applications ─────────────────────────────

/** Honest type label: LOGISTICS/SELLER applications were previously
 * mislabelled as "Garage" in this queue. */
function applicationTypeLabel(type: string): string {
  if (type === 'DEALER') return 'Dealership'
  if (type === 'GARAGE') return 'Garage'
  if (type === 'LOGISTICS') return 'Delivery partner'
  if (type === 'SELLER') return 'Seller verification'
  return type
}

function ApplicationsTab({ user }: { user: CurrentUser }) {
  const [apps, setApps] = useState<QueueApplication[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    apiGet<{ applications: QueueApplication[] }>('/api/applications?scope=queue')
      .then((d) => {
        if (alive) setApps(d.applications)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [reload])

  if (error) return <ErrorNote message={error} onRetry={() => setReload((r) => r + 1)} />
  if (!apps) return <LoadingCards n={4} />

  return (
    <div className="space-y-4">
      <Alert>
        <BellRing className="h-4 w-4" aria-hidden />
        <AlertTitle>Live review queue</AlertTitle>
        <AlertDescription>
          Submitted, under-review, resubmitted and information-request applications. Finalised decisions are visible in the Audit tab.
        </AlertDescription>
      </Alert>

      {apps.length === 0 ? (
        <EmptyState message="The review queue is clear: no applications waiting." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {apps.map((app) => {
            const ageH = app.submittedAt ? (Date.now() - new Date(app.submittedAt).getTime()) / 3_600_000 : null
            const overSla = ageH !== null && ageH > app.reviewSlaHours
            return (
              <Card
                key={app.id}
                className={`cursor-pointer p-4 transition-shadow hover:shadow-md ${overSla ? 'border-[#c9a94e]/60' : ''}`}
                onClick={() => setSelectedId(app.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setSelectedId(app.id)
                }}
                aria-label={`Open application ${app.refCode}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs text-muted-foreground">{app.refCode}</p>
                    <h3 className="font-semibold leading-tight">{app.orgName}</h3>
                    <p className="text-sm text-muted-foreground">
                      {app.user.name} · {app.county}
                      {app.town ? `, ${app.town}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={app.status} label={APPLICATION_STATUS_LABELS[app.status] ?? app.status} />
                    <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                      {applicationTypeLabel(app.type)}
                    </Badge>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  {ageH !== null ? (
                    <span className={overSla ? 'font-semibold text-gold-ink dark:text-[#d9b878]' : 'text-muted-foreground'}>
                      Age {Math.round(ageH)}h · SLA {app.reviewSlaHours}h {overSla ? ' (over target)' : ''}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not submitted yet</span>
                  )}
                  {app.reviewOwnerName ? <span className="text-muted-foreground">Reviewer: {app.reviewOwnerName}</span> : <span className="text-muted-foreground">Unassigned</span>}
                  {app.escalated ? <StatusBadge status="FAILED" label="escalated" /> : null}
                  {app.correctionsDueAt ? <span className="text-muted-foreground">Corrections due {dateLabel(app.correctionsDueAt)}</span> : null}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {selectedId && (
        <ApplicationDetail
          id={selectedId}
          user={user}
          onClose={() => {
            setSelectedId(null)
            setReload((r) => r + 1)
          }}
        />
      )}

      {/* Delivery-partner oversight (ADMIN/FOUNDER: the API enforces it too). */}
      {hasAnyRole(user, 'ADMIN', 'FOUNDER') && <LogisticsPartnersSection />}
    </div>
  )
}

function ApplicationDetail({ id, user, onClose }: { id: string; user: CurrentUser; onClose: () => void }) {
  const [app, setApp] = useState<QueueApplication | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)

  // request info dialog
  const [infoOpen, setInfoOpen] = useState(false)
  const [infoMsg, setInfoMsg] = useState('')
  const [infoDays, setInfoDays] = useState('7')
  // reject dialog
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  // approve confirm
  const [approveOpen, setApproveOpen] = useState(false)
  // suspend/revoke dialog
  const [closeAction, setCloseAction] = useState<'suspend' | 'revoke' | null>(null)
  const [closeNote, setCloseNote] = useState('')

  useEffect(() => {
    let alive = true
    apiGet<{ application: QueueApplication }>(`/api/applications/${id}`)
      .then((d) => {
        if (alive) setApp(d.application)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [id, reload])

  function act(body: Record<string, unknown>, successMsg: string, closeAfter: boolean) {
    if (!app) return
    setBusy(true)
    apiSend<{ application: QueueApplication }>(`/api/applications/${app.id}`, 'PATCH', body)
      .then(() => {
        toast.success(successMsg)
        if (closeAfter) {
          onClose()
        } else {
          setReload((r) => r + 1)
        }
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }

  const documents: AppDoc[] = (() => {
    if (!app?.documents) return []
    try {
      const parsed = JSON.parse(app.documents) as AppDoc[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })()

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {app ? app.refCode : 'Application'}
            {app ? <StatusBadge status={app.status} label={APPLICATION_STATUS_LABELS[app.status] ?? app.status} /> : null}
            {app?.escalated ? <StatusBadge status="FAILED" label="escalated" /> : null}
          </DialogTitle>
          <DialogDescription>
            {app ? `${app.orgName}: ${applicationTypeLabel(app.type)}${app.type === 'SELLER' ? '' : ' verification'}` : 'Loading…'}
          </DialogDescription>
        </DialogHeader>

        {error && <ErrorNote message={error} onRetry={() => setReload((r) => r + 1)} />}
        {!app && !error && <Loading />}

        {app && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              <Detail label="Applicant" value={`${app.user.name} (${app.user.email})`} />
              <Detail label="Applicant phone" value={app.user.phone ?? app.phone} />
              <Detail label="Business phone" value={app.phone} />
              <Detail label="Business email" value={app.email ?? 'Not provided'} />
              <Detail label="County / town" value={`${app.county}${app.town ? `, ${app.town}` : ''}`} />
              <Detail label="Registration no." value={app.regNo ?? 'Not set'} />
              <Detail label="Representative" value={app.representative} />
              <Detail label="Plan interest" value={app.accountType ?? 'Not set'} />
              {app.type === 'GARAGE' && <Detail label="Service categories" value={app.categories ? app.categories.split(',').join(', ') : 'Not set'} />}
              <Detail label="Submitted" value={app.submittedAt ? `${dateLabel(app.submittedAt)} (${timeAgo(app.submittedAt)})` : 'Not set'} />
              <Detail label="SLA" value={`${app.reviewSlaHours}h target`} />
              {app.correctionsDueAt && <Detail label="Corrections due" value={dateLabel(app.correctionsDueAt)} />}
              <Detail label="Reviewer" value={app.reviewOwnerName ?? 'Unassigned'} />
              <Detail label="Physical address" value={app.physicalAddress ?? 'Not set'} />
            </div>

            {app.notes ? (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Applicant notes</p>
                <p className="rounded-md bg-muted p-3">{app.notes}</p>
              </div>
            ) : null}

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Documents</p>
              {documents.length === 0 ? (
                <p className="text-muted-foreground">No documents attached.</p>
              ) : (
                <ul className="space-y-1">
                  {documents.map((d, i) => (
                    <li key={i}>
                      {/* Protected file route: opens in a new tab for staff review. */}
                      <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline">
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        {d.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Timeline</p>
              <ol className="space-y-2 border-l pl-4">
                {app.events.map((ev) => (
                  <li key={ev.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden />
                    <p className="font-medium">{ev.type.replaceAll('_', ' ').toLowerCase()}</p>
                    {ev.note ? <p className="text-muted-foreground">{ev.note}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      {ev.actorName ?? 'system'} · {timeAgo(ev.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            </div>

            <Separator />

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || app.reviewOwnerId === user.id}
                onClick={() => act({ action: 'assign', reviewOwnerId: user.id, reviewOwnerName: user.name }, `Review assigned to you.` , false)}
              >
                Assign to me
              </Button>
              <Button size="sm" variant="outline" disabled={busy || app.status === 'UNDER_REVIEW'} onClick={() => act({ action: 'start_review' }, 'Review started.', false)}>
                Start review
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setInfoOpen(true)}>
                Request info
              </Button>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => setRejectOpen(true)}>
                Reject
              </Button>
              <Button size="sm" disabled={busy} onClick={() => setApproveOpen(true)}>
                Approve
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setCloseAction('suspend')}>
                Suspend
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setCloseAction('revoke')}>
                Revoke
              </Button>
            </div>
          </div>
        )}

        {/* Request info */}
        <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Request information</DialogTitle>
              <DialogDescription>Tell the applicant exactly what is missing and set a correction deadline.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="info-msg">What is required</Label>
                <Textarea id="info-msg" value={infoMsg} onChange={(e) => setInfoMsg(e.target.value)} placeholder="e.g. Please upload a clear photo of the business permit…" rows={3} />
              </div>
              <div>
                <Label>Corrections window</Label>
                <Select value={infoDays} onValueChange={setInfoDays}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3 days</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInfoOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={busy || infoMsg.trim().length < 5}
                onClick={() => {
                  act({ action: 'request_info', infoMessage: infoMsg.trim(), correctionDays: Number(infoDays) }, 'Information request sent to the applicant.', false)
                  setInfoOpen(false)
                }}
              >
                Send request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reject */}
        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Reject application</DialogTitle>
              <DialogDescription>The applicant will see this reason. Minimum 10 characters.</DialogDescription>
            </DialogHeader>
            <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Explain the decision clearly and fairly…" rows={3} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={busy || rejectNote.trim().length < 10}
                onClick={() => {
                  act({ action: 'reject', decisionNote: rejectNote.trim() }, 'Application rejected.', true)
                  setRejectOpen(false)
                }}
              >
                Confirm rejection
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Approve */}
        <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Approve {app?.orgName}?</AlertDialogTitle>
              <AlertDialogDescription>
                Approval creates the organisation on CARMAZE, grants the applicant owner access to their {app?.type === 'DEALER' ? 'DealerOS dashboard' : 'garage dashboard'} and sends a welcome notification. This decision is audit-logged.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={() => {
                  act({ action: 'approve' }, 'Application approved: organisation created.', true)
                  setApproveOpen(false)
                }}
              >
                Approve &amp; create organisation
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Suspend / Revoke */}
        <Dialog open={closeAction !== null} onOpenChange={(open) => !open && setCloseAction(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{closeAction === 'suspend' ? 'Suspend application' : 'Revoke application'}</DialogTitle>
              <DialogDescription>{closeAction === 'suspend' ? 'Temporarily pause this application.' : 'Permanently close this application. The applicant keeps their account.'}</DialogDescription>
            </DialogHeader>
            <Textarea value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="Reason (required)…" rows={3} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setCloseAction(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={busy || closeNote.trim().length === 0}
                onClick={() => {
                  act({ action: closeAction, decisionNote: closeNote.trim() }, closeAction === 'suspend' ? 'Application suspended.' : 'Application revoked.', true)
                  setCloseAction(null)
                }}
              >
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="break-words">{value}</p>
    </div>
  )
}

// ─────────────────────────── Logistics partners (delivery) ───────────────────────────

type LogisticsNote = { by: string | null; at: string; text: string }

type LogisticsPartnerStats = { total: number; completed: number; failed: number; active: number }

type LogisticsPartnerRow = {
  id: string
  refCode: string
  name: string
  partnerType: string
  county: string
  status: string
  verified: boolean
  ownerEmail: string
  jobsTotal: number
  jobsCompleted: number
  jobsFailed: number
  notes: LogisticsNote[]
  createdAt: string
}

type LogisticsSummary = { total: number; pending: number; approved: number; suspended: number; rejected: number }

/** Delivery-partner oversight, rendered inside the Applications tab for
 * ADMIN/FOUNDER. Suspension is an operational kill-switch (no new jobs);
 * approval of NEW partners stays in the applications review queue above. */
function LogisticsPartnersSection() {
  const [partners, setPartners] = useState<LogisticsPartnerRow[] | null>(null)
  const [summary, setSummary] = useState<LogisticsSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)

  // suspend / reinstate reason dialog
  const [reasonAction, setReasonAction] = useState<'suspend' | 'reinstate' | null>(null)
  const [reasonTarget, setReasonTarget] = useState<LogisticsPartnerRow | null>(null)
  const [reason, setReason] = useState('')
  // view + add internal notes
  const [noteTarget, setNoteTarget] = useState<LogisticsPartnerRow | null>(null)
  const [noteText, setNoteText] = useState('')

  useEffect(() => {
    let alive = true
    apiGet<{ partners: (Omit<LogisticsPartnerRow, 'jobsTotal' | 'jobsCompleted' | 'jobsFailed'> & { stats?: LogisticsPartnerStats })[]; summary: LogisticsSummary }>('/api/admin/logistics')
      .then((d) => {
        if (alive) {
          // API nests job counters under `stats`; flatten for the table shape.
          setPartners(d.partners.map((p) => ({ ...p, jobsTotal: p.stats?.total ?? 0, jobsCompleted: p.stats?.completed ?? 0, jobsFailed: p.stats?.failed ?? 0 })))
          setSummary(d.summary)
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [reload])

  function act(target: LogisticsPartnerRow, body: Record<string, unknown>, msg: string, closeDialog: () => void) {
    setBusy(true)
    apiSend<{ message?: string }>(`/api/admin/logistics/${target.id}`, 'PATCH', body)
      .then((d) => {
        toast.success(d.message ?? msg)
        closeDialog()
        setReload((r) => r + 1)
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <section aria-label="Logistics partners" className="space-y-3 border-t pt-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Truck className="h-4 w-4 text-primary" aria-hidden /> Logistics partners
          </h2>
          <p className="text-xs text-muted-foreground">
            Delivery partner oversight: suspend or reinstate accounts, keep internal notes. New partner approvals happen through the review queue above.
          </p>
        </div>
        {summary ? (
          <div className="flex flex-wrap gap-1.5" role="status" aria-label="Partner counts">
            <Badge variant="outline" className="border-border bg-muted text-muted-foreground">{summary.total} total</Badge>
            <Badge variant="outline" className={TONE_CLASSES.green}>{summary.approved} approved</Badge>
            {summary.suspended > 0 ? <Badge variant="outline" className={TONE_CLASSES.red}>{summary.suspended} suspended</Badge> : null}
          </div>
        ) : null}
      </div>

      {error && <ErrorNote message={error} onRetry={() => setReload((r) => r + 1)} />}
      {!error && !partners && <LoadingCards n={2} />}
      {partners && partners.length === 0 && (
        <EmptyState message="No logistics partners yet: approved delivery partner applications appear here." />
      )}

      {partners && partners.length > 0 && (
        <div className="overflow-hidden rounded-xl border">
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Partner</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>County</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Verified</TableHead>
                  <TableHead>Jobs</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <p className="font-medium">{p.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{p.refCode}</p>
                      <p className="text-xs text-muted-foreground">{p.ownerEmail}</p>
                    </TableCell>
                    <TableCell className="text-sm capitalize">{p.partnerType.toLowerCase()}</TableCell>
                    <TableCell className="text-sm">{p.county}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell>
                      {p.verified ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                          <BadgeCheck className="h-4 w-4 text-[#c9a94e]" aria-hidden />
                          <span className="sr-only">Verified</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not verified</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {p.jobsTotal} total · {p.jobsCompleted} delivered · {p.jobsFailed} failed
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateLabel(p.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {p.status === 'APPROVED' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              setReasonTarget(p)
                              setReasonAction('suspend')
                              setReason('')
                            }}
                          >
                            Suspend
                          </Button>
                        )}
                        {p.status === 'SUSPENDED' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              setReasonTarget(p)
                              setReasonAction('reinstate')
                              setReason('')
                            }}
                          >
                            Reinstate
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setNoteTarget(p); setNoteText('') }} aria-label={`Notes for ${p.name}`}>
                          Notes
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      {partners && partners.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing {partners.length} partner{partners.length === 1 ? '' : 's'}: job counts are live aggregates from delivery records.
        </p>
      )}

      {/* Suspend / Reinstate: shared reason dialog */}
      <Dialog open={reasonAction !== null} onOpenChange={(open) => !open && setReasonAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{reasonAction === 'suspend' ? `Suspend ${reasonTarget?.name}` : `Reinstate ${reasonTarget?.name}`}</DialogTitle>
            <DialogDescription>
              {reasonAction === 'suspend'
                ? 'The partner is removed from job assignment immediately and their verified marker is cleared. A reason is mandatory for the audit trail.'
                : 'The partner returns to APPROVED and becomes eligible for job assignment again. A reason is mandatory for the audit trail.'}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonAction === 'suspend' ? 'e.g. Repeated failed deliveries without proof-of-delivery evidence.' : 'e.g. Suspension reviewed: corrective plan accepted.'}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonAction(null)}>
              Cancel
            </Button>
            <Button
              variant={reasonAction === 'suspend' ? 'destructive' : 'default'}
              disabled={busy || reason.trim().length < 10}
              onClick={() => {
                if (!reasonTarget) return
                act(
                  reasonTarget,
                  { action: reasonAction, note: reason.trim() },
                  reasonAction === 'suspend' ? 'Partner suspended.' : 'Partner reinstated.',
                  () => setReasonAction(null)
                )
              }}
            >
              Confirm {reasonAction === 'suspend' ? 'suspension' : 'reinstatement'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Internal notes: view history + add */}
      <Dialog open={noteTarget !== null} onOpenChange={(open) => !open && setNoteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Internal notes: {noteTarget?.name}</DialogTitle>
            <DialogDescription>Staff-only notes on this delivery partner. Never shown publicly or to the partner.</DialogDescription>
          </DialogHeader>
          <div className="max-h-60 space-y-2 overflow-y-auto">
            {(noteTarget?.notes ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No internal notes yet.</p>
            ) : (
              <ul className="space-y-2">
                {noteTarget?.notes.map((n, i) => (
                  <li key={i} className="rounded-md bg-muted p-3">
                    <p className="whitespace-pre-wrap text-sm">{n.text}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {n.by ?? 'staff'} · {timeAgo(n.at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="e.g. Called the owner: driver onboarding in progress." rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteTarget(null)}>
              Close
            </Button>
            <Button
              disabled={busy || noteText.trim().length < 2}
              onClick={() => {
                if (!noteTarget) return
                act(noteTarget, { action: 'note', note: noteText.trim() }, 'Internal note added.', () => setNoteTarget(null))
              }}
            >
              Save note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ───────────────────────────── Listings ─────────────────────────────

const LISTING_STATUS_FILTERS = ['PENDING_REVIEW', 'ALL', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'SOLD', 'DRAFT']

function ListingsTab() {
  const [status, setStatus] = useState('PENDING_REVIEW')
  const [page, setPage] = useState(1)
  const [listings, setListings] = useState<AdminListing[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)

  const [approving, setApproving] = useState<AdminListing | null>(null)
  const [rejecting, setRejecting] = useState<AdminListing | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [suspending, setSuspending] = useState<AdminListing | null>(null)
  const [suspendNote, setSuspendNote] = useState('')

  useEffect(() => {
    let alive = true
    apiGet<{ listings: AdminListing[]; total: number }>(buildQuery('/api/admin/listings', { status, page }))
      .then((d) => {
        if (alive) {
          setListings(d.listings)
          setTotal(d.total)
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [status, page, reload])

  function act(body: Record<string, unknown>, successMsg: string) {
    setBusy(true)
    apiSend('/api/admin/listings', 'PATCH', body)
      .then(() => {
        toast.success(successMsg)
        setReload((r) => r + 1)
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }

  const pageSize = 12

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-[220px]" aria-label="Filter listings by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LISTING_STATUS_FILTERS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'ALL' ? 'All statuses' : VEHICLE_STATUS_LABELS[s] ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {listings ? `${total} listing(s)` : 'Loading…'}
        </p>
      </div>

      {error && <ErrorNote message={error} onRetry={() => setReload((r) => r + 1)} />}
      {!error && !listings && <LoadingCards n={6} />}

      {listings && listings.length === 0 && <EmptyState message={`No listings with status "${VEHICLE_STATUS_LABELS[status] ?? status}".`} />}

      {listings && listings.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {listings.map((v) => (
            <Card key={v.id} className="overflow-hidden p-0">
              <div className="flex gap-3 p-4">
                <div className="h-20 w-24 shrink-0 overflow-hidden rounded-md bg-muted">
                  {v.photos[0] ? (
                     
                    <img src={v.photos[0].url} alt={`${v.make} ${v.model}`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No photo</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate font-semibold leading-tight">{vehicleTitle(v)}</h3>
                    <StatusBadge status={v.status} label={VEHICLE_STATUS_LABELS[v.status] ?? v.status} />
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">{v.refCode}</p>
                  <p className="text-sm font-semibold text-primary">{money(v.priceMinor)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {v.owner.name}
                    {v.org ? ` · ${v.org.name}` : ' · private seller'} · {timeAgo(v.createdAt)}
                  </p>
                  {v.reviewNote && (v.status === 'REJECTED' || v.status === 'SUSPENDED') ? (
                    <p className="mt-1 line-clamp-2 rounded bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">{v.reviewNote}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 border-t bg-black/[0.015] px-4 py-2.5 dark:bg-white/[0.03]">
                {v.status === 'PENDING_REVIEW' && (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => setApproving(v)}>
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Approve
                    </Button>
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => { setRejecting(v); setRejectNote('') }}>
                      <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Reject
                    </Button>
                  </>
                )}
                {(v.status === 'PUBLISHED' || v.status === 'RESERVED') && (
                  <>
                    <Button size="sm" variant={v.featured ? 'secondary' : 'outline'} disabled={busy} onClick={() => act({ id: v.id, action: v.featured ? 'unfeature' : 'feature' }, v.featured ? 'Featuring removed.' : 'Listing featured.')}>
                      <Star className={`mr-1.5 h-3.5 w-3.5 ${v.featured ? 'fill-[#d9b878] text-[#c9a94e]' : ''}`} aria-hidden />
                      {v.featured ? 'Unfeature' : 'Feature'}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => { setSuspending(v); setSuspendNote('') }}>
                      Suspend
                    </Button>
                  </>
                )}
                {v.status === 'SUSPENDED' && (
                  <Button size="sm" disabled={busy} onClick={() => setApproving(v)}>
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Restore (approve)
                  </Button>
                )}
                {v.status === 'REJECTED' && (
                  <Button size="sm" disabled={busy} onClick={() => setApproving(v)}>
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Approve anyway
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {total > pageSize && (
        <div className="flex items-center justify-center gap-3">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden /> Prev
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {Math.ceil(total / pageSize)}
          </span>
          <Button size="sm" variant="outline" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      )}

      {/* Approve confirm */}
      <AlertDialog open={approving !== null} onOpenChange={(open) => !open && setApproving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish {approving ? vehicleTitle(approving) : 'listing'}?</AlertDialogTitle>
            <AlertDialogDescription>
              {approving?.refCode} goes live in the marketplace immediately and the owner is notified. This action is audit-logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (approving) act({ id: approving.id, action: 'approve' }, 'Listing approved and published.')
                setApproving(null)
              }}
            >
              Publish listing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject dialog */}
      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject {rejecting ? vehicleTitle(rejecting) : 'listing'}</DialogTitle>
            <DialogDescription>The owner receives the reason by notification. Minimum 10 characters.</DialogDescription>
          </DialogHeader>
          <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="e.g. Photos do not match the stated condition; please retake and resubmit." rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy || rejectNote.trim().length < 10}
              onClick={() => {
                if (rejecting) act({ id: rejecting.id, action: 'reject', note: rejectNote.trim() }, 'Listing rejected: owner notified.')
                setRejecting(null)
              }}
            >
              Confirm rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend dialog */}
      <Dialog open={suspending !== null} onOpenChange={(open) => !open && setSuspending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Suspend {suspending ? vehicleTitle(suspending) : 'listing'}</DialogTitle>
            <DialogDescription>The listing is hidden from the marketplace. A reason is required.</DialogDescription>
          </DialogHeader>
          <Textarea value={suspendNote} onChange={(e) => setSuspendNote(e.target.value)} placeholder="e.g. Reported for suspicious pricing: suspended pending verification." rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspending(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy || suspendNote.trim().length < 10}
              onClick={() => {
                if (suspending) act({ id: suspending.id, action: 'suspend', note: suspendNote.trim() }, 'Listing suspended: owner notified.')
                setSuspending(null)
              }}
            >
              Confirm suspension
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ───────────────────────────── Users ─────────────────────────────

function UsersTab({ user }: { user: CurrentUser }) {
  const [q, setQ] = useState('')
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [suspendTarget, setSuspendTarget] = useState<UserRow | null>(null)
  const [note, setNote] = useState('')
  const [activateTarget, setActivateTarget] = useState<UserRow | null>(null)
  const [busy, setBusy] = useState(false)
  const isAdmin = hasAnyRole(user, 'ADMIN', 'FOUNDER')

  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      apiGet<{ users: UserRow[] }>(buildQuery('/api/admin/users', { q }))
        .then((d) => {
          if (alive) setUsers(d.users)
        })
        .catch((e: Error) => {
          if (alive) setError(e.message)
        })
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q, reload])

  function setStatus(target: UserRow, status: 'SUSPENDED' | 'ACTIVE', reason?: string) {
    setBusy(true)
    apiSend<{ message: string }>('/api/admin/users', 'PATCH', { id: target.id, status, note: reason })
      .then((d) => {
        toast.success(d.message)
        setReload((r) => r + 1)
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="space-y-4">
      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setReload((r) => r + 1)
        }}
        role="search"
      >
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className="pl-8" aria-label="Search users" />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>

      {error && <ErrorNote message={error} onRetry={() => setReload((r) => r + 1)} />}
      {!error && !users && <LoadingCards n={3} />}
      {users && users.length === 0 && <EmptyState message={`No users match "${q}".`} />}

      {users && users.length > 0 && (
        <div className="overflow-hidden rounded-xl border">
          <div className="max-h-[70vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Organisations</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <p className="font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}{u.phone ? ` · ${u.phone}` : ''}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <Badge key={r} variant="outline" className={`text-[10px] ${STAFF_ROLES_CLIENT.includes(r as (typeof STAFF_ROLES_CLIENT)[number]) ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'}`}>
                            {r.replaceAll('_', ' ').toLowerCase()}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.memberships.length === 0
                        ? 'Not set'
                        : u.memberships.map((m) => `${m.orgName} (${m.role.toLowerCase()})`).join(', ')}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={u.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateLabel(u.createdAt)}</TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        {u.id !== user.id && !u.roles.includes('FOUNDER') ? (
                          u.status === 'ACTIVE' ? (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setSuspendTarget(u); setNote('') }}>
                              Suspend
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => setActivateTarget(u)}>
                              Activate
                            </Button>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">Protected</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Suspend confirm */}
      <Dialog open={suspendTarget !== null} onOpenChange={(open) => !open && setSuspendTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Suspend {suspendTarget?.name}?</DialogTitle>
            <DialogDescription>
              They immediately lose API access (the session check rejects suspended accounts), and they see a suspension notice on next sign-in.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (recommended for the audit trail)…" rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (suspendTarget) setStatus(suspendTarget, 'SUSPENDED', note.trim() || undefined)
                setSuspendTarget(null)
              }}
            >
              Suspend account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate confirm */}
      <AlertDialog open={activateTarget !== null} onOpenChange={(open) => !open && setActivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reactivate {activateTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>The account regains full access immediately.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (activateTarget) setStatus(activateTarget, 'ACTIVE')
                setActivateTarget(null)
              }}
            >
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ───────────────────────────── Company staff ─────────────────────────────

const ASSIGNABLE_STAFF_ROLES = ['SUPPORT', 'REVIEWER', 'MODERATOR', 'FINANCE'] as const

const ROLE_LABELS: Record<string, string> = {
  SUPPORT: 'Support',
  REVIEWER: 'Reviewer',
  MODERATOR: 'Moderator',
  FINANCE: 'Finance',
}

type StaffRow = {
  id: string
  name: string
  email: string
  roles: string[]
  department: string | null
  status: string
  createdAt: string
}

type StaffAction = 'set_department' | 'set_role' | 'suspend' | 'reactivate' | 'remove_staff'

/** Company staff management (ADMIN/FOUNDER only: both the nav gate and the
 * APIs enforce it). Invite generates a one-time password that is shown exactly
 * once; row actions cover department, role, suspension and access removal. */
function StaffTab({ user }: { user: CurrentUser }) {
  const [staff, setStaff] = useState<StaffRow[] | null>(null)
  const [departments, setDepartments] = useState<string[]>(Object.keys(DEPARTMENT_LABELS))
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)

  // invite dialog + one-time password reveal
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('')
  const [inviteDept, setInviteDept] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviting, setInviting] = useState(false)
  const [createdInvite, setCreatedInvite] = useState<{ name: string; email: string; oneTimePassword: string } | null>(null)

  // row action dialogs
  const [action, setAction] = useState<StaffAction | null>(null)
  const [actionTarget, setActionTarget] = useState<StaffRow | null>(null)
  const [actionDept, setActionDept] = useState('')
  const [actionRole, setActionRole] = useState('')
  const [actionNote, setActionNote] = useState('')

  useEffect(() => {
    let alive = true
    apiGet<{ staff: StaffRow[]; departments: string[] }>('/api/admin/staff')
      .then((d) => {
        if (alive) {
          setStaff(d.staff)
          if (Array.isArray(d.departments) && d.departments.length > 0) setDepartments(d.departments)
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [reload])

  async function copyText(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(successMessage)
    } catch {
      toast.error('Could not copy: please copy it manually')
    }
  }

  function openAction(target: StaffRow, kind: StaffAction) {
    setActionTarget(target)
    setAction(kind)
    setActionDept(target.department ?? '')
    setActionRole(ASSIGNABLE_STAFF_ROLES.find((r) => target.roles.includes(r)) ?? '')
    setActionNote('')
  }

  function submitInvite() {
    setInviting(true)
    apiSend<{ user: { name: string; email: string }; oneTimePassword: string }>('/api/admin/staff', 'POST', {
      name: inviteName.trim(),
      email: inviteEmail.trim(),
      role: inviteRole,
      department: inviteDept,
      phone: invitePhone.trim() || undefined,
    })
      .then((d) => {
        setInviteOpen(false)
        setCreatedInvite({ name: d.user.name, email: d.user.email, oneTimePassword: d.oneTimePassword })
        setInviteName('')
        setInviteEmail('')
        setInviteRole('')
        setInviteDept('')
        setInvitePhone('')
        setReload((r) => r + 1)
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setInviting(false))
  }

  function runAction() {
    if (!actionTarget || !action) return
    const body: Record<string, unknown> = { action }
    if (action === 'set_department') body.department = actionDept
    if (action === 'set_role') body.role = actionRole
    if (action === 'suspend') body.note = actionNote.trim() || undefined
    setBusy(true)
    apiSend<{ message: string }>(`/api/admin/staff/${actionTarget.id}`, 'PATCH', body)
      .then((d) => {
        toast.success(d.message)
        setAction(null)
        setActionTarget(null)
        setReload((r) => r + 1)
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Company staff</h2>
          <p className="text-xs text-muted-foreground">
            Operations team accounts, departments and access. ADMIN/FOUNDER accounts are managed by the Super Admin outside this console.
          </p>
        </div>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <UserPlus className="mr-1.5 h-4 w-4" aria-hidden /> Invite staff member
        </Button>
      </div>

      {error && <ErrorNote message={error} onRetry={() => setReload((r) => r + 1)} />}
      {!error && !staff && <LoadingCards n={3} />}
      {staff && staff.length === 0 && <EmptyState message="No staff accounts yet; invite your first team member." />}

      {staff && staff.length > 0 && (
        <div className="overflow-hidden rounded-xl border">
          <div className="max-h-[70vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role(s)</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((s) => {
                  const isFounder = s.roles.includes('FOUNDER')
                  const isSelf = s.id === user.id
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <p className="font-medium">
                          {s.name}
                          {isSelf ? <span className="ml-1.5 text-xs text-muted-foreground">(you)</span> : null}
                        </p>
                        <p className="text-xs text-muted-foreground">{s.email}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-[220px] flex-wrap gap-1">
                          {s.roles.map((r) => (
                            <Badge key={r} variant="outline" className={`text-[10px] ${STAFF_ROLES_CLIENT.includes(r as (typeof STAFF_ROLES_CLIENT)[number]) ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'}`}>
                              {r.replaceAll('_', ' ').toLowerCase()}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {s.department ? (
                          <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                            {DEPARTMENT_LABELS[s.department] ?? s.department.replaceAll('_', ' ').toLowerCase()}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not set</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateLabel(s.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        {isFounder ? (
                          <span className="text-xs text-muted-foreground">Protected</span>
                        ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="outline" aria-label={`Manage ${s.name}`}>
                                <MoreHorizontal className="h-4 w-4" aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => openAction(s, 'set_department')}>Change department</DropdownMenuItem>
                              {!s.roles.includes('ADMIN') && (
                                <DropdownMenuItem onSelect={() => openAction(s, 'set_role')}>Change role</DropdownMenuItem>
                              )}
                              {isSelf ? null : s.status === 'ACTIVE' ? (
                                <DropdownMenuItem className="text-red-600 dark:text-red-400" onSelect={() => openAction(s, 'suspend')}>
                                  Suspend
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onSelect={() => openAction(s, 'reactivate')}>Reactivate</DropdownMenuItem>
                              )}
                              {isSelf ? null : (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-red-600 dark:text-red-400" onSelect={() => openAction(s, 'remove_staff')}>
                                    Remove staff access
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Invite staff member */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite staff member</DialogTitle>
            <DialogDescription>
              Creates a CARMAZE account with an operational staff role and department. A one-time password is generated: share it through a secure channel.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="staff-invite-name">Full name</Label>
              <Input id="staff-invite-name" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="e.g. Amina Wanjiru" autoComplete="off" />
            </div>
            <div>
              <Label htmlFor="staff-invite-email">Work email</Label>
              <Input id="staff-invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@carmaze.co.ke" autoComplete="off" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger aria-label="Staff role">
                    <SelectValue placeholder="Select role…" />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_STAFF_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Department</Label>
                <Select value={inviteDept} onValueChange={setInviteDept}>
                  <SelectTrigger aria-label="Department">
                    <SelectValue placeholder="Select department…" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d} value={d}>
                        {DEPARTMENT_LABELS[d] ?? d.replaceAll('_', ' ').toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="staff-invite-phone">Phone (optional)</Label>
              <Input id="staff-invite-phone" value={invitePhone} onChange={(e) => setInvitePhone(e.target.value)} placeholder="+254…" autoComplete="off" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={inviting || inviteName.trim().length < 2 || !inviteEmail.includes('@') || !inviteRole || !inviteDept}
              onClick={submitInvite}
            >
              Create staff account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time password: shown ONCE, never stored in plaintext, never re-displayed */}
      <Dialog open={createdInvite !== null} onOpenChange={(open) => !open && setCreatedInvite(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-gold-ink dark:text-[#d9b878]" aria-hidden /> Staff account created
            </DialogTitle>
            <DialogDescription>
              {createdInvite?.name} ({createdInvite?.email}) can now sign in with the one-time password below.
            </DialogDescription>
          </DialogHeader>
          <Alert>
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <AlertTitle>Share this securely: it will not be shown again.</AlertTitle>
            <AlertDescription>
              Production email delivery is not configured yet, so the password is shown here once. Copy it now and hand it over through a secure channel.
            </AlertDescription>
          </Alert>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-muted px-3 py-2 text-center font-mono text-lg tracking-widest">{createdInvite?.oneTimePassword}</code>
            <Button variant="outline" onClick={() => createdInvite && copyText(createdInvite.oneTimePassword, 'One-time password copied')}>
              <Copy className="mr-1.5 h-4 w-4" aria-hidden /> Copy
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreatedInvite(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change department / role */}
      <Dialog open={action === 'set_department' || action === 'set_role'} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          {action === 'set_department' ? (
            <>
              <DialogHeader>
                <DialogTitle>Change department: {actionTarget?.name}</DialogTitle>
                <DialogDescription>Which team this staff member sits in.</DialogDescription>
              </DialogHeader>
              <Select value={actionDept} onValueChange={setActionDept}>
                <SelectTrigger aria-label="Department">
                  <SelectValue placeholder="Select department…" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d} value={d}>
                      {DEPARTMENT_LABELS[d] ?? d.replaceAll('_', ' ').toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAction(null)}>
                  Cancel
                </Button>
                <Button disabled={busy || !actionDept} onClick={runAction}>
                  Save department
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Change role: {actionTarget?.name}</DialogTitle>
                <DialogDescription>Swaps their operational staff role. Only the four operational roles can be assigned here.</DialogDescription>
              </DialogHeader>
              <Select value={actionRole} onValueChange={setActionRole}>
                <SelectTrigger aria-label="Staff role">
                  <SelectValue placeholder="Select role…" />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_STAFF_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAction(null)}>
                  Cancel
                </Button>
                <Button disabled={busy || !actionRole} onClick={runAction}>
                  Save role
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Suspend: with reason for the audit trail */}
      <Dialog open={action === 'suspend'} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Suspend {actionTarget?.name}?</DialogTitle>
            <DialogDescription>
              They immediately lose staff access: the session check rejects suspended accounts on every request, so this takes effect despite stateless sessions.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={actionNote} onChange={(e) => setActionNote(e.target.value)} placeholder="Reason (recommended for the audit trail)…" rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={runAction}>
              Suspend staff access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reactivate confirm */}
      <AlertDialog open={action === 'reactivate'} onOpenChange={(open) => !open && setAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reactivate {actionTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>The account regains full staff access immediately.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={runAction}>
              Reactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove staff access confirm */}
      <AlertDialog open={action === 'remove_staff'} onOpenChange={(open) => !open && setAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove staff access for {actionTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              All staff roles are stripped and their department is cleared; the account continues as a regular customer account. This is audit-logged and the member is notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-600/90"
              disabled={busy}
              onClick={runAction}
            >
              Remove staff access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ───────────────────────────── Reports ─────────────────────────────

function ReportsTab() {
  const [statusFilter, setStatusFilter] = useState('OPEN')
  const [reports, setReports] = useState<ReportRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [resolveTarget, setResolveTarget] = useState<ReportRow | null>(null)
  const [note, setNote] = useState('')
  const [dismissTarget, setDismissTarget] = useState<ReportRow | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    apiGet<{ reports: ReportRow[] }>(buildQuery('/api/reports', { status: statusFilter }))
      .then((d) => {
        if (alive) setReports(d.reports)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [statusFilter, reload])

  function patch(body: Record<string, unknown>, msg: string) {
    setBusy(true)
    apiSend('/api/reports', 'PATCH', body)
      .then(() => {
        toast.success(msg)
        setReload((r) => r + 1)
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]" aria-label="Filter reports by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
            <SelectItem value="DISMISSED">Dismissed</SelectItem>
            <SelectItem value="ALL">All</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{reports ? `${reports.length} report(s)` : 'Loading…'}</p>
      </div>

      {error && <ErrorNote message={error} onRetry={() => setReload((r) => r + 1)} />}
      {!error && !reports && <LoadingCards n={3} />}
      {reports && reports.length === 0 && (
        <EmptyState message={statusFilter === 'OPEN' ? 'No open reports: the community report queue is clear.' : 'No reports with this status.'} />
      )}

      {reports && reports.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {reports.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <StatusBadge status={r.status} />
                  <Badge variant="outline" className="ml-2 border-border bg-muted text-muted-foreground">{r.targetType.toLowerCase()}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
              </div>
              <h3 className="mt-2 font-semibold">{r.reason}</h3>
              {r.details ? <p className="mt-1 text-sm text-muted-foreground">{r.details}</p> : null}
              <p className="mt-1 font-mono text-xs text-muted-foreground">target: {r.targetId}</p>
              {r.resolutionNote ? <p className="mt-1 rounded bg-muted px-2 py-1 text-xs">Resolution: {r.resolutionNote}</p> : null}
              {r.status === 'OPEN' && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => { setResolveTarget(r); setNote('') }}>
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Resolve
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setDismissTarget(r)}>
                    Dismiss
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Dialog open={resolveTarget !== null} onOpenChange={(open) => !open && setResolveTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve report</DialogTitle>
            <DialogDescription>Record what was done about the reported content.</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Listing suspended pending document re-verification." rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (resolveTarget) patch({ id: resolveTarget.id, status: 'RESOLVED', resolutionNote: note.trim() || undefined }, 'Report resolved.')
                setResolveTarget(null)
              }}
            >
              Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dismissTarget !== null} onOpenChange={(open) => !open && setDismissTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dismiss this report?</AlertDialogTitle>
            <AlertDialogDescription>The report is closed as not actionable. This is recorded with your name.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (dismissTarget) patch({ id: dismissTarget.id, status: 'DISMISSED' }, 'Report dismissed.')
                setDismissTarget(null)
              }}
            >
              Dismiss
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ───────────────────────────── Partners moderation ─────────────────────────────

const PARTNER_STATUS_FILTERS = ['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED'] as const

function PartnersTab() {
  const [statusFilter, setStatusFilter] = useState<(typeof PARTNER_STATUS_FILTERS)[number]>('PENDING')
  const [partners, setPartners] = useState<PartnerRow[] | null>(null)
  const [counts, setCounts] = useState<PartnerCounts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    apiGet<{ partners: PartnerRow[]; counts: PartnerCounts }>(buildQuery('/api/admin/partners', { status: statusFilter }))
      .then((d) => {
        if (alive) {
          setPartners(d.partners)
          setCounts(d.counts)
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [statusFilter, reload])

  const selected = partners?.find((p) => p.id === selectedId) ?? null

  return (
    <div className="space-y-4">
      <Alert>
        <Handshake className="h-4 w-4" aria-hidden />
        <AlertTitle>Partner network moderation</AlertTitle>
        <AlertDescription>
          Inspection, insurance, finance, towing, parts and transport partners. Only APPROVED partners appear in public listings; approval is earned through document review, never bought.
        </AlertDescription>
      </Alert>

      {/* Status chips with live counts */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter partners by status">
        {PARTNER_STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            aria-pressed={statusFilter === s}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10'
            }`}
          >
            {s.toLowerCase()} <span className="tabular-nums opacity-70">{counts ? counts[s] : '…'}</span>
          </button>
        ))}
      </div>

      {error && <ErrorNote message={error} onRetry={() => setReload((r) => r + 1)} />}
      {!error && (!partners || !counts) && <LoadingCards n={3} />}
      {partners && partners.length === 0 && (
        <EmptyState message={`No ${statusFilter.toLowerCase()} partners right now. New applications from the public partner form appear here as PENDING.`} />
      )}

      {partners && partners.length > 0 && (
        <div className="overflow-hidden rounded-xl border">
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Partner</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>County</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Referrals</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <p className="flex items-center gap-1.5 font-medium">
                        {p.name}
                        {p.verified ? (
                          <BadgeCheck className="h-4 w-4 shrink-0 text-[#c9a94e]" aria-label="Verified partner" />
                        ) : null}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">{p.refCode}</p>
                    </TableCell>
                    <TableCell className="text-sm capitalize">{p.category.toLowerCase()}</TableCell>
                    <TableCell className="text-sm">{p.county}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                      {p.rejectionReason && p.status === 'REJECTED' ? (
                        <p className="mt-0.5 max-w-[200px] truncate text-[11px] text-red-600 dark:text-red-400" title={p.rejectionReason}>
                          {p.rejectionReason}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.referrals}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateLabel(p.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setSelectedId(p.id)} aria-label={`Open partner ${p.name}`}>
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {selected && (
        <PartnerDetail
          partner={selected}
          onClose={() => {
            setSelectedId(null)
            setReload((r) => r + 1)
          }}
          onMutated={() => setReload((r) => r + 1)}
        />
      )}
    </div>
  )
}

function PartnerDetail({ partner, onClose, onMutated }: { partner: PartnerRow; onClose: () => void; onMutated: () => void }) {
  const [busy, setBusy] = useState(false)
  // reject / suspend reason dialog
  const [reasonAction, setReasonAction] = useState<'reject' | 'suspend' | null>(null)
  const [reason, setReason] = useState('')
  const [approveOpen, setApproveOpen] = useState(false)
  const [reactivateOpen, setReactivateOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState('')

  function act(body: Record<string, unknown>, msg: string, closeAfter: boolean) {
    setBusy(true)
    apiSend(`/api/admin/partners/${partner.id}`, 'PATCH', body)
      .then(() => {
        toast.success(msg)
        if (closeAfter) {
          onClose()
        } else {
          onMutated()
        }
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }

  const serviceAreas: string[] = (() => {
    const v = partner.serviceAreas
    if (!v) return []
    if (Array.isArray(v)) return v
    try {
      const parsed = JSON.parse(v) as string[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })()

  // The API stores notes as a JSON string of entries ({by, at, text}) and may
  // include them pre-parsed as notesList. Degrade to the raw string otherwise.
  const noteEntries: PartnerNote[] = (() => {
    if (Array.isArray(partner.notesList) && partner.notesList.length > 0) return partner.notesList
    if (!partner.notes) return []
    try {
      const parsed = JSON.parse(partner.notes) as PartnerNote[]
      return Array.isArray(parsed) ? parsed.filter((n) => n && typeof n.text === 'string') : []
    } catch {
      return [{ by: '', at: '', text: partner.notes }]
    }
  })()

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {partner.name}
            <StatusBadge status={partner.status} />
            {partner.verified ? <StatusBadge status="APPROVED" label="verified" /> : null}
          </DialogTitle>
          <DialogDescription>
            {partner.refCode} · {partner.category.toLowerCase()} partner · {partner.county}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            <Detail label="Contact person" value={partner.contactName ?? 'Not provided'} />
            <Detail label="Phone" value={partner.phone ?? 'Not provided'} />
            <Detail label="Email" value={partner.email ?? 'Not provided'} />
            <Detail label="Website" value={partner.website ?? 'Not provided'} />
            <Detail label="WhatsApp" value={partner.whatsapp ? 'Enabled' : 'Not enabled'} />
            <Detail label="County" value={partner.county} />
            <Detail label="Service areas" value={serviceAreas.length > 0 ? serviceAreas.join(', ') : 'Not set'} />
            <Detail label="Rating" value={partner.rating !== null ? `${partner.rating.toFixed(1)} / 5` : 'No ratings yet'} />
            <Detail label="Referral requests" value={String(partner.referrals)} />
            <Detail label="Created" value={`${dateLabel(partner.createdAt)} (${timeAgo(partner.createdAt)})`} />
            <Detail label="Last updated" value={timeAgo(partner.updatedAt)} />
          </div>

          {partner.description ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Public description</p>
              <p className="whitespace-pre-wrap rounded-md bg-muted p-3">{partner.description}</p>
            </div>
          ) : null}

          {partner.rejectionReason ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rejection reason</p>
              <p className="rounded-md bg-red-500/10 p-3 text-red-600 dark:text-red-400">{partner.rejectionReason}</p>
            </div>
          ) : null}

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Internal notes (never public)</p>
            {noteEntries.length === 0 ? (
              <p className="text-muted-foreground">No internal notes recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {noteEntries.map((n, i) => (
                  <li key={i} className="rounded-md bg-muted p-3">
                    <p className="whitespace-pre-wrap">{n.text}</p>
                    {n.by ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {n.by}
                        {n.at ? ` · ${timeAgo(n.at)}` : ''}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2">
            {(partner.status === 'PENDING' || partner.status === 'REJECTED') && (
              <Button size="sm" disabled={busy} onClick={() => setApproveOpen(true)}>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Approve
              </Button>
            )}
            {partner.status === 'PENDING' && (
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => { setReasonAction('reject'); setReason('') }}>
                <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Reject
              </Button>
            )}
            {partner.status === 'APPROVED' && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { setReasonAction('suspend'); setReason('') }}>
                Suspend
              </Button>
            )}
            {partner.status === 'SUSPENDED' && (
              <Button size="sm" disabled={busy} onClick={() => setReactivateOpen(true)}>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Reactivate
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setNoteOpen(true); setNoteText('') }}>
              Add internal note
            </Button>
          </div>
        </div>

        {/* Reject / Suspend: shared reason dialog */}
        <Dialog open={reasonAction !== null} onOpenChange={(open) => !open && setReasonAction(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{reasonAction === 'reject' ? `Reject ${partner.name}` : `Suspend ${partner.name}`}</DialogTitle>
              <DialogDescription>
                {reasonAction === 'reject'
                  ? 'The partner will not be publicly listed. A reason is mandatory for the audit trail.'
                  : 'The partner disappears from public listings immediately. A reason is mandatory for the audit trail.'}
              </DialogDescription>
            </DialogHeader>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Business permit could not be verified with the county registry." rows={3} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setReasonAction(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={busy || reason.trim().length < 10}
                onClick={() => {
                  if (reasonAction === 'reject') act({ action: 'reject', reason: reason.trim() }, 'Partner rejected.', true)
                  else act({ action: 'suspend', reason: reason.trim() }, 'Partner suspended: removed from public listings.', true)
                  setReasonAction(null)
                }}
              >
                Confirm {reasonAction === 'reject' ? 'rejection' : 'suspension'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Approve confirm */}
        <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Approve {partner.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                The partner becomes eligible for the public partner directory and referral routing. Verify their documents are genuine first: approval is a trust decision and is audit-logged.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={() => {
                  act({ action: 'approve' }, 'Partner approved.', true)
                  setApproveOpen(false)
                }}
              >
                Approve partner
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reactivate confirm */}
        <AlertDialog open={reactivateOpen} onOpenChange={setReactivateOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reactivate {partner.name}?</AlertDialogTitle>
              <AlertDialogDescription>The partner returns to APPROVED and is publicly listed again. This decision is audit-logged.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={() => {
                  act({ action: 'reactivate' }, 'Partner reactivated.', true)
                  setReactivateOpen(false)
                }}
              >
                Reactivate
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Internal note */}
        <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add internal note</DialogTitle>
              <DialogDescription>Notes are visible to CARMAZE staff only; never shown publicly or to the partner.</DialogDescription>
            </DialogHeader>
            <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="e.g. Called the business line: permit verification in progress." rows={3} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setNoteOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={busy || noteText.trim().length < 2}
                onClick={() => {
                  act({ action: 'note', text: noteText.trim() }, 'Internal note added.', false)
                  setNoteOpen(false)
                }}
              >
                Save note
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────────── Billing ─────────────────────────────

const INVOICE_TYPE_LABELS: Record<string, string> = { SUBSCRIPTION: 'Subscription', CAMPAIGN: 'Campaign', LEAD_FEE: 'Lead fee' }

function BillingTab({ user }: { user: CurrentUser }) {
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [markTarget, setMarkTarget] = useState<InvoiceRow | null>(null)
  const [note, setNote] = useState('')
  const [refundTarget, setRefundTarget] = useState<InvoiceRow | null>(null)
  const [refundReason, setRefundReason] = useState('')
  const [busy, setBusy] = useState(false)
  const canFinance = hasAnyRole(user, 'FINANCE', 'ADMIN', 'FOUNDER')

  useEffect(() => {
    let alive = true
    apiGet<OverviewData>('/api/admin/overview')
      .then((d) => {
        if (alive) setOverview(d)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [reload])

  useEffect(() => {
    let alive = true
    apiGet<{ invoices: InvoiceRow[] }>(buildQuery('/api/billing/invoices', { status: statusFilter }))
      .then((d) => {
        if (alive) setInvoices(d.invoices)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [statusFilter, reload])

  function markPaid() {
    if (!markTarget) return
    setBusy(true)
    apiSend<{ invoice: InvoiceRow; warning: string }>(`/api/billing/invoices/${markTarget.id}/mark-paid`, 'POST', { note: note.trim() })
      .then((d) => {
        toast.success(`Invoice ${d.invoice.refCode} marked paid.`)
        toast.warning(d.warning)
        setReload((r) => r + 1)
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }

  function refund() {
    if (!refundTarget) return
    setBusy(true)
    apiSend<{ invoice: InvoiceRow; subscriptionCancelled: boolean; campaignsEnded: number }>(
      `/api/billing/invoices/${refundTarget.id}/refund`,
      'POST',
      { reason: refundReason.trim() }
    )
      .then((d) => {
        toast.success(
          `Invoice ${d.invoice.refCode} recorded as refunded.${d.subscriptionCancelled ? ' Subscription cancelled immediately.' : ''}${
            d.campaignsEnded > 0 ? ` ${d.campaignsEnded} active campaign(s) ended.` : ''
          }`
        )
        setReload((r) => r + 1)
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="space-y-4">
      {overview ? (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Paid revenue" value={compactMoney(overview.revenue.paidTotalMinor)} sub="M-Pesa + reconciled" tone="green" />
          <StatCard label="Pending" value={compactMoney(overview.revenue.pendingTotalMinor)} sub={`${overview.revenue.pendingCount} invoice(s)`} tone="gold" />
          <StatCard label="Campaigns live" value={overview.campaigns.active} sub={`${overview.campaigns.pendingPayment} awaiting payment`} />
          <StatCard label="Failed payments" value={overview.ops.failedPayments} sub="attempts recorded honestly" tone={overview.ops.failedPayments > 0 ? 'red' : undefined} />
        </section>
      ) : (
        <LoadingCards n={4} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]" aria-label="Filter invoices by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="PAID">Paid</SelectItem>
            <SelectItem value="OVERDUE">Overdue</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
            <SelectItem value="REFUNDED">Refunded</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{invoices ? `${invoices.length} invoice(s)` : 'Loading…'}</p>
      </div>

      {error && <ErrorNote message={error} onRetry={() => setReload((r) => r + 1)} />}
      {!error && !invoices && <LoadingCards n={3} />}
      {invoices && invoices.length === 0 && <EmptyState message="No invoices with this status yet." />}

      {invoices && invoices.length > 0 && (
        <div className="overflow-hidden rounded-xl border">
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issued / due</TableHead>
                  {canFinance && <TableHead className="text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <p className="font-mono text-xs font-medium">{inv.refCode}</p>
                      <p className="max-w-[220px] truncate text-xs text-muted-foreground" title={inv.description}>{inv.description}</p>
                      {inv.payments.length > 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          {inv.payments.length} payment attempt(s)
                          {inv.payments.some((p) => p.status === 'FAILED') ? ' · includes failed' : ''}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">{inv.org ? inv.org.name : 'Not set'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-border bg-muted text-muted-foreground">{INVOICE_TYPE_LABELS[inv.type] ?? inv.type}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{money(inv.amountMinor, inv.currency)}</TableCell>
                    <TableCell>
                      <StatusBadge status={inv.status} />
                      {inv.paidVia ? <p className="text-[11px] text-muted-foreground">via {inv.paidVia === 'MPESA' ? 'M-Pesa' : inv.paidVia}</p> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {dateLabel(inv.issuedAt)}
                      {inv.dueDate ? ` · due ${dateLabel(inv.dueDate)}` : ''}
                    </TableCell>
                    {canFinance && (
                      <TableCell className="text-right">
                        {inv.status === 'PENDING' || inv.status === 'OVERDUE' ? (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => { setMarkTarget(inv); setNote('') }}>
                            Mark paid
                          </Button>
                        ) : null}
                        {inv.status === 'PAID' ? (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => { setRefundTarget(inv); setRefundReason('') }}>
                            <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Record refund
                          </Button>
                        ) : null}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {!canFinance && <p className="text-xs text-muted-foreground">Marking invoices paid or recording refunds requires FINANCE, ADMIN or FOUNDER role.</p>}

      {/* Mark paid confirm */}
      <Dialog open={markTarget !== null} onOpenChange={(open) => !open && setMarkTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark {markTarget?.refCode} as paid</DialogTitle>
            <DialogDescription>
              Manual reconciliation for money received outside M-Pesa (bank transfer, cash, cheque). A written note is mandatory and audit-logged with your name. When M-Pesa callbacks are configured, automatic verification is preferred.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={'e.g. Received via bank transfer: reconciled by ' + (user.name ?? 'finance')} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkTarget(null)}>
              Cancel
            </Button>
            <Button disabled={busy || note.trim().length < 5} onClick={() => { markPaid(); setMarkTarget(null) }}>
              Confirm payment received
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund confirm: mandatory written reason, honest consequences */}
      <AlertDialog open={refundTarget !== null} onOpenChange={(open) => !open && setRefundTarget(null)}>
        <AlertDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Record refund for {refundTarget?.refCode}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  The invoice becomes REFUNDED: refunded money is not counted as revenue. The payment date is kept as history, and the written reason below is stored in the audit trail with your name. The organisation owner is notified.
                </p>
                {refundTarget?.type === 'SUBSCRIPTION' ? (
                  <p className="rounded-md bg-[#d9b878]/15 px-3 py-2 text-gold-ink dark:text-[#d9b878]">
                    Consequence: the organisation&apos;s ACTIVE subscription is CANCELLED immediately: the money is returned, so the paid entitlement ends now.
                  </p>
                ) : null}
                {refundTarget?.type === 'CAMPAIGN' ? (
                  <p className="rounded-md bg-[#d9b878]/15 px-3 py-2 text-gold-ink dark:text-[#d9b878]">
                    Consequence: any ACTIVE campaign linked to this invoice is ENDED immediately (money returned, promotion stops).
                  </p>
                ) : null}
                {refundTarget?.type === 'LEAD_FEE' ? (
                  <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">
                    This invoice has no recurring entitlement: only the invoice status changes.
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            placeholder="Reason for the refund (required, at least 10 characters): e.g. Duplicate payment received for the same subscription period."
            rows={3}
            aria-label="Refund reason"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || refundReason.trim().length < 10}
              onClick={() => {
                refund()
                setRefundTarget(null)
              }}
            >
              Record refund
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ───────────────────────────── Campaigns ─────────────────────────────

function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [confirm, setConfirm] = useState<{ row: CampaignRow; action: 'activate' | 'end' | 'cancel' } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    apiGet<{ campaigns: CampaignRow[] }>('/api/admin/campaigns')
      .then((d) => {
        if (alive) setCampaigns(d.campaigns)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [reload])

  function run() {
    if (!confirm) return
    const { row, action } = confirm
    setBusy(true)
    apiSend('/api/admin/campaigns', 'PATCH', { id: row.id, action })
      .then(() => {
        toast.success(`Campaign ${row.refCode} ${action === 'activate' ? 'activated' : action + 'ed'}.`)
        setReload((r) => r + 1)
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="space-y-4">
      <Alert>
        <Megaphone className="h-4 w-4" aria-hidden />
        <AlertTitle>Campaign lifecycle</AlertTitle>
        <AlertDescription>
          Campaigns activate only when their linked invoice is genuinely PAID (M-Pesa callback or reconciled manually). Impression and click numbers are real counters.
        </AlertDescription>
      </Alert>

      {error && <ErrorNote message={error} onRetry={() => setReload((r) => r + 1)} />}
      {!error && !campaigns && <LoadingCards n={3} />}
      {campaigns && campaigns.length === 0 && <EmptyState message="No campaigns yet; dealers create them from their dashboard." />}

      {campaigns && campaigns.length > 0 && (
        <div className="overflow-hidden rounded-xl border">
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Listing</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Impr. / clicks</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <p className="font-mono text-xs font-medium">{c.refCode}</p>
                      <p className="text-xs text-muted-foreground">{c.org.name}</p>
                      {c.invoice ? (
                        <p className="text-[11px] text-muted-foreground">
                          {c.invoice.refCode} · {c.invoice.status.toLowerCase()}
                        </p>
                      ) : (
                        <p className="text-[11px] text-red-600 dark:text-red-400">no invoice linked</p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <p>{vehicleTitle(c.vehicle)}</p>
                      <p className="font-mono text-xs text-muted-foreground">{c.vehicle.refCode}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      <p>{c.packageName}</p>
                      <p className="text-xs text-muted-foreground">{c.packagePriceMinor !== null ? money(c.packagePriceMinor) : 'Not provided'} · {c.packageDays ?? '?'} days</p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.impressions} / {c.clicks}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {c.startsAt ? `${dateLabel(c.startsAt)} → ${c.endsAt ? dateLabel(c.endsAt) : '?'}` : 'Not set'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {c.status === 'PENDING_PAYMENT' && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm({ row: c, action: 'activate' })}>
                            Activate
                          </Button>
                        )}
                        {c.status === 'ACTIVE' && (
                          <>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm({ row: c, action: 'end' })}>
                              End
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm({ row: c, action: 'cancel' })}>
                              Cancel
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === 'activate' ? 'Activate campaign' : confirm?.action === 'end' ? 'End campaign' : 'Cancel campaign'} {confirm?.row.refCode}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.action === 'activate'
                ? `Activation requires the linked invoice to be PAID; the server verifies this and refuses otherwise. The campaign runs for ${confirm?.row.packageDays ?? 7} days from now.`
                : confirm?.action === 'end'
                  ? 'The campaign stops immediately and is marked ENDED.'
                  : 'The campaign is cancelled. If it was unpaid, the invoice stays pending for follow-up.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                run()
                setConfirm(null)
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ───────────────────────────── Support ─────────────────────────────

function SupportTab() {
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [tickets, setTickets] = useState<TicketRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [openTicket, setOpenTicket] = useState<TicketRow | null>(null)
  const [response, setResponse] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    apiGet<{ tickets: TicketRow[] }>(buildQuery('/api/admin/tickets', { status: statusFilter }))
      .then((d) => {
        if (alive) setTickets(d.tickets)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [statusFilter, reload])

  function patch(body: Record<string, unknown>, msg: string) {
    setBusy(true)
    apiSend('/api/admin/tickets', 'PATCH', body)
      .then(() => {
        toast.success(msg)
        setOpenTicket(null)
        setReload((r) => r + 1)
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]" aria-label="Filter tickets by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="IN_PROGRESS">In progress</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{tickets ? `${tickets.length} ticket(s)` : 'Loading…'}</p>
      </div>

      {error && <ErrorNote message={error} onRetry={() => setReload((r) => r + 1)} />}
      {!error && !tickets && <LoadingCards n={3} />}
      {tickets && tickets.length === 0 && (
        <EmptyState message="No tickets here yet. Submit one through the public contact form (Contact → send a message) to see the support flow live." />
      )}

      {tickets && tickets.length > 0 && (
        <div className="overflow-hidden rounded-xl border">
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.refCode}</TableCell>
                    <TableCell className="max-w-[260px] truncate font-medium">{t.subject}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">{t.name}</p>
                      {t.email}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{timeAgo(t.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => { setOpenTicket(t); setResponse(t.response ?? '') }}>
                        <LifeBuoy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        {t.status === 'RESOLVED' ? 'View' : 'Handle'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Dialog open={openTicket !== null} onOpenChange={(open) => !open && setOpenTicket(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {openTicket?.subject}
              {openTicket ? <StatusBadge status={openTicket.status} /> : null}
            </DialogTitle>
            <DialogDescription>
              {openTicket?.refCode} · {openTicket?.name} &lt;{openTicket?.email}&gt; · {openTicket ? timeAgo(openTicket.createdAt) : ''}
            </DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{openTicket?.message}</p>
          {openTicket?.status !== 'RESOLVED' ? (
            <>
              <div>
                <Label htmlFor="ticket-response">Response</Label>
                <Textarea id="ticket-response" value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Write the reply sent to the requester…" rows={3} />
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" disabled={busy} onClick={() => openTicket && patch({ id: openTicket.id, status: 'IN_PROGRESS' }, 'Ticket marked in progress.')}>
                  Mark in progress
                </Button>
                <Button disabled={busy || response.trim().length < 2} onClick={() => openTicket && patch({ id: openTicket.id, status: 'RESOLVED', response: response.trim() }, 'Ticket resolved with response.')}>
                  Save response &amp; resolve
                </Button>
              </DialogFooter>
            </>
          ) : (
            <div>
              <Label>Recorded response</Label>
              <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{openTicket?.response ?? 'Not set'}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ───────────────────────────── Notifications (ops) ─────────────────────────────

function NotificationsTab({ user }: { user: CurrentUser }) {
  const [data, setData] = useState<OpsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  // Broadcast composer state (ADMIN/FOUNDER only: server enforces the same rule)
  const canBroadcast = hasAnyRole(user, 'ADMIN', 'FOUNDER')
  const [broadcasts, setBroadcasts] = useState<BroadcastRow[] | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [audience, setAudience] = useState('CUSTOMERS')
  const [bTitle, setBTitle] = useState('')
  const [bBody, setBBody] = useState('')
  const [bLink, setBLink] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let alive = true
    apiGet<OpsData>('/api/admin/ops')
      .then((d) => {
        if (alive) setData(d)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    apiGet<{ broadcasts: BroadcastRow[] }>('/api/admin/broadcast')
      .then((d) => {
        if (alive) setBroadcasts(d.broadcasts)
      })
      .catch(() => {
        if (alive) setBroadcasts([])
      })
    return () => {
      alive = false
    }
  }, [reload])

  function sendBroadcast() {
    setSending(true)
    apiSend<{ recipients: number; warning?: string }>('/api/admin/broadcast', 'POST', {
      title: bTitle.trim(),
      body: bBody.trim(),
      audience,
      link: bLink.trim() || undefined,
    })
      .then((d) => {
        toast.success(`Broadcast delivered in-app to ${d.recipients} user(s).`)
        if (d.warning) toast.warning(d.warning)
        setComposerOpen(false)
        setBTitle('')
        setBBody('')
        setBLink('')
        setReload((r) => r + 1)
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setSending(false))
  }

  if (error) return <ErrorNote message={error} onRetry={() => setReload((r) => r + 1)} />
  if (!data) return <LoadingCards n={4} />

  return (
    <div className="space-y-5">
      <Alert>
        <BellRing className="h-4 w-4" aria-hidden />
        <AlertTitle>Honest delivery records</AlertTitle>
        <AlertDescription>
          Email and SMS providers are not configured on this deployment, so those channel deliveries are recorded as FAILED instead of pretending
          success. Configure SMTP_URL / SMS_API_KEY to activate them; in-app notifications always work.
        </AlertDescription>
      </Alert>

      {/* ── Broadcast composer + history ── */}
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Broadcasts</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Platform-wide announcements. Delivery is honest: in-app is real; EMAIL/SMS rows record the actual provider state.
            </p>
          </div>
          {canBroadcast ? (
            <Button size="sm" onClick={() => setComposerOpen(true)}>
              <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden /> New broadcast
            </Button>
          ) : (
            <Badge variant="outline" className="border-border bg-muted text-muted-foreground">admin only</Badge>
          )}
        </div>
        <Separator className="my-3" />
        {broadcasts && broadcasts.length === 0 ? (
          <EmptyState message="No broadcasts have been sent yet. Admins can compose one with “New broadcast”; every send is audit-logged with the exact recipient count." />
        ) : broadcasts && broadcasts.length > 0 ? (
          <ul className="max-h-64 divide-y overflow-y-auto">
            {broadcasts.map((b) => (
              <li key={b.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{b.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.audience.toLowerCase()} · {b.recipients !== null ? `${b.recipients} recipient(s)` : 'recipient count unavailable'} · by {b.actorName ?? 'system'}
                    {b.link ? ` · links to ${b.link}` : ''}
                  </p>
                </div>
                <span className="whitespace-nowrap text-xs text-muted-foreground">{timeAgo(b.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Loading />
        )}
      </Card>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="M-Pesa" value={data.health.mpesa ? 'Configured' : 'Not configured'} tone={data.health.mpesa ? 'green' : 'gold'} />
        <StatCard label="Email" value={data.health.email ? 'Configured' : 'Not configured'} tone={data.health.email ? 'green' : 'gold'} />
        <StatCard label="SMS" value={data.health.sms ? 'Configured' : 'Not configured'} tone={data.health.sms ? 'green' : 'gold'} />
        <StatCard label="Failed deliveries" value={data.failedDeliveries.length} tone={data.failedDeliveries.length > 0 ? 'red' : 'green'} sub="latest 30 shown" />
      </section>

      <Card className="p-4">
        <h3 className="text-sm font-semibold">Failed notification deliveries</h3>
        <p className="mb-2 text-xs text-muted-foreground">Channel attempts that could not be completed, newest first.</p>
        {data.failedDeliveries.length === 0 ? (
          <EmptyState message="No failed deliveries: all notification channels are healthy or unused." />
        ) : (
          <ul className="max-h-72 divide-y overflow-y-auto">
            {data.failedDeliveries.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{d.notification.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.notification.type.toLowerCase()} · {d.channel.toLowerCase()} · {d.lastError}
                  </p>
                </div>
                <StatusBadge status={d.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold">Payment attempts</h3>
        <p className="mb-2 text-xs text-muted-foreground">Every M-Pesa attempt is recorded with its real outcome; including failures.</p>
        {data.paymentAttempts.length === 0 ? (
          <EmptyState message="No payment attempts recorded yet. Attempts appear here the moment a dealer tries to pay." />
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.paymentAttempts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.invoice.refCode}</TableCell>
                    <TableCell className="text-sm">{p.phone}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(p.amountMinor)}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground" title={p.resultDesc ?? ''}>
                      {p.resultDesc ?? 'Not provided'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{timeAgo(p.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* ── Broadcast composer ── */}
      <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Compose broadcast</DialogTitle>
            <DialogDescription>
              Sends an in-app notification to the selected audience. Rate limit: 4 broadcasts per hour. Every send is audit-logged with your name and the exact recipient count.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Audience</Label>
              <Select value={audience} onValueChange={setAudience}>
                <SelectTrigger aria-label="Broadcast audience">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Everyone (active users, cap 1,000)</SelectItem>
                  <SelectItem value="CUSTOMERS">Customers only</SelectItem>
                  <SelectItem value="DEALERS">Dealers (owners &amp; staff)</SelectItem>
                  <SelectItem value="GARAGES">Garages (owners &amp; staff)</SelectItem>
                  <SelectItem value="STAFF">CARMAZE staff</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="broadcast-title">Title</Label>
              <Input id="broadcast-title" value={bTitle} onChange={(e) => setBTitle(e.target.value)} placeholder="e.g. Scheduled maintenance this Sunday" maxLength={120} />
            </div>
            <div>
              <Label htmlFor="broadcast-body">Message</Label>
              <Textarea id="broadcast-body" value={bBody} onChange={(e) => setBBody(e.target.value)} placeholder="What should every recipient know? (10–1000 characters)" rows={4} maxLength={1000} />
              <p className="mt-1 text-right text-xs text-muted-foreground">{bBody.trim().length}/1000</p>
            </div>
            <div>
              <Label htmlFor="broadcast-link">Link (optional)</Label>
              <Input id="broadcast-link" value={bLink} onChange={(e) => setBLink(e.target.value)} placeholder="/cars: in-app hash route the notification opens" maxLength={200} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposerOpen(false)}>
              Cancel
            </Button>
            <Button disabled={sending || bTitle.trim().length < 4 || bBody.trim().length < 10} onClick={() => setConfirmOpen(true)}>
              Review &amp; send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Broadcast confirmation: shows the recipient estimate before sending */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Send “{bTitle.trim()}”?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {audience === 'ALL' &&
                    'This goes to every ACTIVE user on the platform, capped at 1,000 recipients.'}
                  {audience === 'CUSTOMERS' &&
                    'This goes to active users with the CUSTOMER role and no business or staff roles.'}
                  {audience === 'DEALERS' &&
                    'This goes to active users with DEALER_OWNER or DEALER_STAFF roles.'}
                  {audience === 'GARAGES' &&
                    'This goes to active users with GARAGE_OWNER or GARAGE_STAFF roles.'}
                  {audience === 'STAFF' &&
                    'This goes to active staff accounts (support, reviewers, moderators, finance, admin, founder).'}
                </p>
                <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">
                  In-app delivery is real. EMAIL/SMS rows will honestly record the provider state; with no provider configured they are stored as FAILED, never as sent.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back to editing</AlertDialogCancel>
            <AlertDialogAction
              disabled={sending}
              onClick={() => {
                sendBroadcast()
                setConfirmOpen(false)
              }}
            >
              Send broadcast
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ───────────────────────────── Settings ─────────────────────────────

function SettingsTab({ user }: { user: CurrentUser }) {
  const isAdmin = hasAnyRole(user, 'ADMIN', 'FOUNDER')
  const [data, setData] = useState<SettingsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saveKey, setSaveKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    let alive = true
    apiGet<SettingsData>('/api/admin/settings')
      .then((d) => {
        if (alive) {
          setData(d)
          setDrafts(Object.fromEntries(d.settings.map((s) => [s.key, JSON.stringify(s.value, null, 2)])))
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [isAdmin, reload])

  if (!isAdmin) {
    return (
      <Alert>
        <ShieldAlert className="h-4 w-4" aria-hidden />
        <AlertTitle>Restricted settings</AlertTitle>
        <AlertDescription>Editing platform settings requires ADMIN or FOUNDER role.</AlertDescription>
      </Alert>
    )
  }

  if (error) return <ErrorNote message={error} onRetry={() => setReload((r) => r + 1)} />
  if (!data) return <LoadingCards n={4} />

  function save(key: string) {
    let parsed: unknown
    try {
      parsed = JSON.parse(drafts[key])
    } catch {
      toast.error('Invalid JSON: fix the syntax before saving.')
      return
    }
    setBusy(true)
    apiSend('/api/admin/settings', 'PUT', { key, value: parsed })
      .then(() => {
        toast.success(`Setting "${key}" saved. Changes are live and audit-logged.`)
        setSaveKey(null)
        setBusy(false)
      })
      .catch((e: Error) => {
        toast.error(e.message)
        setBusy(false)
      })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Platform configuration as JSON documents. Changes apply live across the site and are audit-logged (key only: values stay out of the audit trail).
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.settings.map((s) => (
          <Card key={s.key} className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-mono text-sm font-semibold">{s.key}</h3>
              <span className="text-xs text-muted-foreground">updated {timeAgo(s.updatedAt)}</span>
            </div>
            <Textarea
              value={drafts[s.key] ?? ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
              rows={Math.min(14, (drafts[s.key] ?? '').split('\n').length + 1)}
              className="font-mono text-xs"
              aria-label={`JSON value for ${s.key}`}
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setSaveKey(s.key)}>
                <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Save
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <AlertDialog open={saveKey !== null} onOpenChange={(open) => !open && setSaveKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save setting “{saveKey}”?</AlertDialogTitle>
            <AlertDialogDescription>The new JSON value applies live to the public site immediately. The change is audit-logged under your name.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (saveKey) save(saveKey)
              }}
            >
              Save setting
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ───────────────────────────── Audit ─────────────────────────────

function AuditTab() {
  const [action, setAction] = useState('')
  const [targetType, setTargetType] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ entries: AuditRow[]; total: number; pageSize: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    apiGet<{ entries: AuditRow[]; total: number; pageSize: number }>(buildQuery('/api/admin/audit', { action, targetType, page }))
      .then((d) => {
        if (alive) setData(d)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [action, targetType, page])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }} placeholder="Filter action contains…" className="w-[220px]" aria-label="Filter by action" />
        <Input value={targetType} onChange={(e) => { setTargetType(e.target.value); setPage(1) }} placeholder="Filter target type…" className="w-[200px]" aria-label="Filter by target type" />
        <p className="text-sm text-muted-foreground">{data ? `${data.total} entr${data.total === 1 ? 'y' : 'ies'}` : 'Loading…'}</p>
      </div>

      {error && <ErrorNote message={error} />}
      {!error && !data && <LoadingCards n={3} />}
      {data && data.entries.length === 0 && <EmptyState message="No audit entries match these filters." />}

      {data && data.entries.length > 0 && (
        <div className="overflow-hidden rounded-xl border">
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Metadata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{timeAgo(e.createdAt)}</TableCell>
                    <TableCell className="text-sm">{e.actorName ?? <span className="text-muted-foreground">system</span>}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">{e.action}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {e.targetType ? (
                        <span className="text-muted-foreground">
                          {e.targetType}
                          {e.targetId ? ` · ${e.targetId}` : ''}
                        </span>
                      ) : (
                        'Not set'
                      )}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate font-mono text-[11px] text-muted-foreground" title={e.metadata ?? ''}>
                      {e.metadata ?? 'Not set'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-3">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden /> Prev
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Next <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}
