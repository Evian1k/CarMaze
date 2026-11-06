'use client'

/* Vehicle Protection: customer-side custody tracking, road-test approvals,
 * collection authorisation and security reporting.
 *
 * Shared by My Garage and the Account dashboard (DRY: one implementation).
 * Talks to /api/custody and /api/incidents only.
 */

import { useCallback, useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  CarFront, Check, CircleAlert, Copy, FileText, Gauge, KeyRound, Loader2,
  MessageSquarePlus, Phone, ShieldAlert, ShieldCheck, Siren, UserRound, Wrench, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { apiGet, apiSend, apiUpload } from '@/lib/client'
import { money, timeAgo, dateLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Stagger, StaggerItem } from '@/components/motion/reveal'

// ───────────────────────────── Types (API contract) ─────────────────────────────

type CustodyRow = {
  id: string
  refCode: string
  status: string
  vehicleDesc: string
  plate: string | null
  customerName?: string
  orgName?: string
  requestedWork: string | null
  createdAt: string
  updatedAt: string
}

type CustodyEvent = {
  id: string
  type: string
  fromStatus: string | null
  toStatus: string | null
  actorName: string | null
  actorSide: string
  note: string | null
  createdAt: string
}

type RoadTest = {
  id: string
  purpose: string
  driverName: string
  status: string
  startOdometerKm: number | null
  endOdometerKm: number | null
  requestedAt: string
  authorisedAt: string | null
  startedAt: string | null
  endedAt: string | null
  notes: string | null
  incident: boolean
}

type CollectionAuth = {
  collectorName: string
  collectorPhone: string
  codeHint: string
  expiresAt: string
  usedAt: string | null
  revokedAt: string | null
} | null

type CustodyDetail = CustodyRow & {
  photos: string[]
  completionPhotos: string[]
  orgName: string
  customerName: string
  authorisedSpendMinor: number | null
  roadTestAllowed: boolean
  declaredCondition?: string | null
  declaredMileageKm?: number | null
  valuables?: string | null
  completedWork?: string | null
  finalOdometerKm?: number | null
  finalNotes?: string | null
  costMinor?: number | null
  events: CustodyEvent[]
  roadTests: RoadTest[]
  collectionAuth: CollectionAuth
}

type IncidentItem = {
  id: string
  refCode?: string
  category: string
  title: string
  details?: string
  status?: string
  createdAt: string
  orgName?: string | null
}

// ───────────────────────────── Status metadata ─────────────────────────────

const CUSTODY_STATUS_META: Record<string, { label: string; badge: string }> = {
  HANDOVER_REQUESTED: { label: 'Handover requested', badge: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  RECEIVED: { label: 'Received', badge: 'border-sky-300 bg-sky-500/15 text-sky-800 dark:text-sky-300' },
  INSPECTION: { label: 'Inspection', badge: 'border-sky-300 bg-sky-500/15 text-sky-800 dark:text-sky-300' },
  AWAITING_APPROVAL: { label: 'Awaiting your approval', badge: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  WORK_IN_PROGRESS: { label: 'Work in progress', badge: 'border-indigo-300 bg-indigo-500/15 text-indigo-800 dark:text-indigo-300' },
  ROAD_TEST_REQUESTED: { label: 'Road test requested', badge: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  READY_FOR_COLLECTION: { label: 'Ready for collection', badge: 'border-primary/50 bg-primary/10 text-primary dark:text-[#9dc3ae]' },
  COLLECTION_PENDING: { label: 'Collection pending', badge: 'border-primary/50 bg-primary/10 text-primary dark:text-[#9dc3ae]' },
  RETURNED: { label: 'Returned to you', badge: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' },
  DISPUTED: { label: 'Disputed', badge: 'border-destructive/50 bg-destructive/10 text-destructive' },
  INCIDENT: { label: 'Incident opened', badge: 'border-destructive/50 bg-destructive/10 text-destructive' },
}

const STEPS = ['Requested', 'Received', 'Inspection', 'Approval', 'Work', 'Ready', 'Release', 'Returned'] as const
const STEP_INDEX: Record<string, number> = {
  HANDOVER_REQUESTED: 0,
  RECEIVED: 1,
  INSPECTION: 2,
  AWAITING_APPROVAL: 3,
  WORK_IN_PROGRESS: 4,
  ROAD_TEST_REQUESTED: 4,
  READY_FOR_COLLECTION: 5,
  COLLECTION_PENDING: 6,
  RETURNED: 7,
}

const ACTIVE_CUSTODY = new Set(['HANDOVER_REQUESTED', 'RECEIVED', 'INSPECTION', 'AWAITING_APPROVAL', 'WORK_IN_PROGRESS', 'ROAD_TEST_REQUESTED', 'READY_FOR_COLLECTION', 'COLLECTION_PENDING'])

const ROAD_TEST_STATUS_META: Record<string, { label: string; badge: string }> = {
  REQUESTED: { label: 'Awaiting your authorisation', badge: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  AUTHORISED: { label: 'Authorised', badge: 'border-sky-300 bg-sky-500/15 text-sky-800 dark:text-sky-300' },
  IN_PROGRESS: { label: 'On the road', badge: 'border-indigo-300 bg-indigo-500/15 text-indigo-800 dark:text-indigo-300' },
  COMPLETED: { label: 'Completed', badge: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' },
  DECLINED: { label: 'Declined', badge: 'bg-muted text-muted-foreground' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-muted text-muted-foreground' },
}

const INCIDENT_CATEGORIES = [
  { value: 'STOLEN_VEHICLE', label: 'Stolen vehicle' },
  { value: 'MISSING_FROM_GARAGE', label: 'Missing from garage' },
  { value: 'TEST_DRIVE_NOT_RETURNED', label: 'Test drive not returned' },
  { value: 'UNAUTHORISED_USE', label: 'Unauthorised use' },
  { value: 'OWNERSHIP_FRAUD', label: 'Ownership fraud' },
  { value: 'FAKE_DOCS', label: 'Fake documents' },
  { value: 'MISCONDUCT', label: 'Staff misconduct' },
  { value: 'OTHER', label: 'Other' },
] as const

const INCIDENT_STATUS_BADGE: Record<string, string> = {
  OPEN: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:text-amber-300',
  UNDER_REVIEW: 'border-sky-300 bg-sky-500/15 text-sky-800 dark:text-sky-300',
  RESOLVED: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  CLOSED: 'bg-muted text-muted-foreground',
}

const SAFETY_NOTE_FALLBACK = 'If you believe a vehicle has been stolen, contact the police immediately. CARMAZE is not an emergency service.'

// ───────────────────────────── Main component ─────────────────────────────

export function VehicleProtection() {
  const [custodies, setCustodies] = useState<CustodyRow[] | null>(null)
  const [incidents, setIncidents] = useState<IncidentItem[] | null>(null)
  const [custodyTick, setCustodyTick] = useState(0)
  const [incidentTick, setIncidentTick] = useState(0)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CustodyDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [collectSelfId, setCollectSelfId] = useState<string | null>(null)
  const [authDialogId, setAuthDialogId] = useState<string | null>(null)
  const [disputeId, setDisputeId] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [safetyNote, setSafetyNote] = useState<string | null>(null)

  const loadCustodies = useCallback(() => setCustodyTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    apiGet<{ custodies: CustodyRow[] }>('/api/custody?mine=1')
      .then((d) => { if (!cancelled) setCustodies(d.custodies) })
      .catch(() => { if (!cancelled) setCustodies([]) })
    return () => { cancelled = true }
  }, [custodyTick])

  useEffect(() => {
    let cancelled = false
    apiGet<{ incidents: IncidentItem[] }>('/api/incidents?mine=1')
      .then((d) => { if (!cancelled) setIncidents(d.incidents) })
      .catch(() => { if (!cancelled) setIncidents([]) })
    return () => { cancelled = true }
  }, [incidentTick])

  // Poll active garage jobs every 15s.
  useEffect(() => {
    const t = setInterval(loadCustodies, 15_000)
    return () => clearInterval(t)
  }, [loadCustodies])

  async function openDetail(id: string) {
    setDetailId(id)
    setDetailLoading(true)
    try {
      const d = await apiGet<{ custody: CustodyDetail }>(`/api/custody/${id}`)
      setDetail(d.custody)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the job details.')
      setDetailId(null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function refreshDetail(id: string) {
    try {
      const d = await apiGet<{ custody: CustodyDetail }>(`/api/custody/${id}`)
      setDetail(d.custody)
    } catch { /* keep current view */ }
  }

  const activeJobs = (custodies ?? []).filter((c) => ACTIVE_CUSTODY.has(c.status))
  const pastJobs = (custodies ?? []).filter((c) => !ACTIVE_CUSTODY.has(c.status))

  return (
    <div className="space-y-6">
      {/* Success / safety callout after reporting */}
      {safetyNote && (
        <motion.div
          initial={false}
          animate={{ opacity: 1 }}
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
          role="status"
        >
          <Siren className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Report received: CARMAZE security will review it.</p>
            <p className="mt-1 text-sm leading-relaxed">{safetyNote}</p>
          </div>
          <button
            className="rounded-full p-1 hover:bg-amber-100 dark:hover:bg-amber-500/20"
            aria-label="Dismiss notice"
            onClick={() => setSafetyNote(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}

      {/* ── Active garage jobs ── */}
      <section aria-labelledby="vp-active">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="vp-active" className="flex items-center gap-2 text-lg font-bold">
              <Wrench className="h-5 w-5 text-primary" aria-hidden="true" /> Vehicles with the garage
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Live custody tracking: approve road tests, authorise collection and dispute anything that looks wrong.
            </p>
          </div>
          <Button variant="outline" className="min-h-11 gap-2" onClick={() => setReportOpen(true)}>
            <ShieldAlert className="h-4 w-4" /> Report a security concern
          </Button>
        </div>

        {custodies === null ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        ) : custodies.length === 0 ? (
          <Card className="mt-4 border-dashed">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ShieldCheck className="h-7 w-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 font-semibold">Nothing in the workshop right now</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                When you accept a garage&apos;s quote and hand over your car, its custody status, road tests and
                collection authorisation appear here: protected end to end.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="mt-4 space-y-3">
              {activeJobs.map((c) => <JobCard key={c.id} row={c} onOpen={() => openDetail(c.id)} />)}
            </div>
            {pastJobs.length > 0 && (
              <details className="mt-3 rounded-xl border bg-card">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
                  Past jobs ({pastJobs.length})
                </summary>
                <div className="space-y-3 px-3 pb-3">
                  {pastJobs.map((c) => <JobCard key={c.id} row={c} onOpen={() => openDetail(c.id)} />)}
                </div>
              </details>
            )}
          </>
        )}
      </section>

      {/* ── Security alerts ── */}
      <section aria-labelledby="vp-alerts">
        <h2 id="vp-alerts" className="flex items-center gap-2 text-lg font-bold">
          <Siren className="h-5 w-5 text-destructive" aria-hidden="true" /> Security alerts
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Incidents you have reported. CARMAZE security reviews every one.</p>

        {incidents === null ? (
          <Skeleton className="mt-4 h-24 rounded-xl" />
        ) : incidents.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed px-6 py-8 text-center">
            <ShieldCheck className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">No incidents reported</p>
            <p className="mt-0.5 text-sm text-muted-foreground">If something ever feels off; a missing vehicle, a fake document: report it here.</p>
          </div>
        ) : (
          <IncidentsList incidents={incidents} onAdded={() => setIncidentTick((t) => t + 1)} />
        )}
      </section>

      {/* ── Detail dialog ── */}
      <Dialog open={detailId !== null} onOpenChange={(open) => { if (!open) { setDetailId(null); setDetail(null) } }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogTitle className="sr-only">Vehicle custody details</DialogTitle>
          {detailLoading || !detail ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <CustodyDetailBody
              detail={detail}
              onChanged={() => { refreshDetail(detail.id); loadCustodies() }}
              onCollectSelf={() => setCollectSelfId(detail.id)}
              onAuthoriseOther={() => setAuthDialogId(detail.id)}
              onDispute={() => setDisputeId(detail.id)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Collect self confirm ── */}
      <AlertDialog open={collectSelfId !== null} onOpenChange={(o) => { if (!o) setCollectSelfId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm you are collecting the vehicle now</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const row = (custodies ?? []).find((c) => c.id === collectSelfId)
                return row
                  ? `Confirm you are collecting ${row.vehicleDesc}${row.plate ? ` (${row.plate})` : ''} in person now. The garage will verify your identity at release.`
                  : 'The garage will verify your identity at release.'
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={(e) => { e.preventDefault(); doCollectSelf(collectSelfId) }}
            >
              Yes, I&apos;m collecting it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Authorise someone else ── */}
      <CollectionAuthDialog
        custodyId={authDialogId}
        onClose={() => setAuthDialogId(null)}
        onDone={() => { if (authDialogId) refreshDetail(authDialogId) }}
      />

      {/* ── Dispute ── */}
      <DisputeDialog
        custodyId={disputeId}
        vehicleLabel={(() => {
          const row = (custodies ?? []).find((c) => c.id === disputeId)
          return row ? `${row.vehicleDesc}${row.plate ? ` (${row.plate})` : ''}` : ''
        })()}
        onClose={() => setDisputeId(null)}
        onDone={() => {
          if (disputeId) { refreshDetail(disputeId); loadCustodies() }
          setIncidentTick((t) => t + 1)
        }}
      />

      {/* ── Report a security concern ── */}
      <ReportIncidentDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        onReported={(note) => {
          setSafetyNote(note ?? SAFETY_NOTE_FALLBACK)
          setIncidentTick((t) => t + 1)
        }}
      />
    </div>
  )

  async function doCollectSelf(id: string | null) {
    if (!id) return
    try {
      await apiSend(`/api/custody/${id}`, 'PATCH', { action: 'collect-self' })
      toast.success('Confirmed: the garage has been notified to release your vehicle to you.')
      setCollectSelfId(null)
      refreshDetail(id)
      loadCustodies()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not confirm collection.')
    }
  }
}

// ───────────────────────────── Job card + stepper ─────────────────────────────

function JobCard({ row, onOpen }: { row: CustodyRow; onOpen: () => void }) {
  const meta = CUSTODY_STATUS_META[row.status] ?? { label: row.status, badge: 'bg-muted text-muted-foreground' }
  return (
    <button
      onClick={onOpen}
      className="block w-full rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow-md"
      aria-label={`Open custody job ${row.refCode} for ${row.vehicleDesc}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold leading-tight">
            <CarFront className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">{row.vehicleDesc}</span>
            {row.plate && <Badge variant="secondary" className="shrink-0 font-mono text-[11px]">{row.plate}</Badge>}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {row.orgName ?? 'Garage'} · <span className="font-mono">{row.refCode}</span> · updated {timeAgo(row.updatedAt)}
          </p>
        </div>
        <Badge variant="outline" className={cn('shrink-0', meta.badge)}>{meta.label}</Badge>
      </div>
      {row.requestedWork && <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">{row.requestedWork}</p>}
      <div className="mt-3">
        <StatusStepper status={row.status} compact />
      </div>
    </button>
  )
}

function StatusStepper({ status, compact = false }: { status: string; compact?: boolean }) {
  const reduce = useReducedMotion()
  const idx = STEP_INDEX[status]

  if (idx === undefined) {
    return (
      <div className={cn('flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-medium text-destructive', compact && 'text-[11px]')}>
        <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {status === 'DISPUTED' ? 'Under dispute: CARMAZE security is reviewing.' : 'Security incident: CARMAZE is reviewing.'}
      </div>
    )
  }

  return (
    <ol className="flex w-full items-start" aria-label={`Job progress: ${CUSTODY_STATUS_META[status]?.label ?? status}`}>
      {STEPS.map((label, i) => (
        <li key={label} className={cn('flex items-start', i < STEPS.length - 1 && 'flex-1')}>
          <div className="flex flex-col items-center gap-1">
            {i < idx ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
                <Check className="h-3 w-3" />
              </span>
            ) : i === idx ? (
              <motion.span
                className="flex h-5 w-5 items-center justify-center rounded-full bg-primary ring-4 ring-primary/20"
                aria-current="step"
                animate={reduce ? undefined : { scale: [1, 1.18, 1] }}
                transition={reduce ? undefined : { repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
              />
            ) : (
              <span className="h-5 w-5 rounded-full border-2 border-muted bg-background" aria-hidden="true" />
            )}
            <span className={cn(
              'whitespace-nowrap text-center text-[8.5px] leading-tight sm:text-[9px]',
              i <= idx ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className="mx-1 mt-2.5 h-1 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: i < idx ? '100%' : '0%' }}
                animate={{ width: i < idx ? '100%' : '0%' }}
                transition={{ duration: reduce ? 0 : 0.6, delay: reduce ? 0 : 0.08 * i, ease: 'easeOut' }}
              />
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

// ───────────────────────────── Detail body (customer side) ─────────────────────────────

function CustodyDetailBody({ detail, onChanged, onCollectSelf, onAuthoriseOther, onDispute }: {
  detail: CustodyDetail
  onChanged: () => void
  onCollectSelf: () => void
  onAuthoriseOther: () => void
  onDispute: () => void
}) {
  const meta = CUSTODY_STATUS_META[detail.status] ?? { label: detail.status, badge: 'bg-muted text-muted-foreground' }
  const [authorisingId, setAuthorisingId] = useState<string | null>(null)
  const [busyRoadTest, setBusyRoadTest] = useState(false)
  const disputed = detail.status === 'DISPUTED' || detail.status === 'INCIDENT'
  const readyForCollection = detail.status === 'READY_FOR_COLLECTION' || detail.status === 'COLLECTION_PENDING'
  const authActive = detail.collectionAuth && !detail.collectionAuth.usedAt && !detail.collectionAuth.revokedAt

  async function respondRoadTest(roadTestId: string, action: 'authorize-roadtest' | 'decline-roadtest') {
    setBusyRoadTest(true)
    try {
      await apiSend(`/api/custody/${detail.id}`, 'PATCH', { action, roadTestId })
      toast.success(action === 'authorize-roadtest'
        ? 'Road test authorised: the garage has been notified.'
        : 'Road test declined.')
      setAuthorisingId(null)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setBusyRoadTest(false)
    }
  }

  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2 text-left">
          {detail.vehicleDesc}
          {detail.plate && <Badge variant="secondary" className="font-mono text-[11px]">{detail.plate}</Badge>}
          <Badge variant="outline" className={meta.badge}>{meta.label}</Badge>
        </DialogTitle>
        <DialogDescription className="text-left">
          {detail.orgName} · <span className="font-mono">{detail.refCode}</span> · in custody since {dateLabel(detail.createdAt)}
        </DialogDescription>
      </DialogHeader>

      {disputed && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
          <p className="flex items-center gap-2 font-semibold"><CircleAlert className="h-4 w-4" /> Custody disputed</p>
          <p className="mt-1 leading-relaxed text-destructive/90">
            A security incident is open on this job. CARMAZE security will review it and both sides will be contacted.
          </p>
        </div>
      )}

      <div className="rounded-xl border bg-muted/30 p-3">
        <StatusStepper status={detail.status} />
      </div>

      {/* Job facts */}
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        {detail.requestedWork && (
          <div className="rounded-lg border p-3 sm:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Requested work</p>
            <p className="mt-1">{detail.requestedWork}</p>
          </div>
        )}
        {detail.authorisedSpendMinor != null && (
          <div className="rounded-lg border p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Approved spend cap</p>
            <p className="mt-1 font-semibold">{money(detail.authorisedSpendMinor)}</p>
          </div>
        )}
        {detail.declaredMileageKm != null && (
          <div className="rounded-lg border p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Odometer at handover</p>
            <p className="mt-1 font-semibold">{detail.declaredMileageKm.toLocaleString()} km</p>
          </div>
        )}
        <div className="rounded-lg border p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Road tests</p>
          <p className="mt-1 font-semibold">{detail.roadTestAllowed ? 'Allowed by you' : 'Not allowed'}</p>
        </div>
        {detail.valuables && (
          <div className="rounded-lg border p-3 sm:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Valuables declared at handover</p>
            <p className="mt-1">{detail.valuables}</p>
          </div>
        )}
      </div>

      {/* Declared condition photos */}
      {detail.photos.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold">Condition at handover</h4>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {detail.photos.map((p) => (
              <a key={p} href={p} target="_blank" rel="noreferrer">
                { }
                <img src={p} alt="Vehicle condition at handover" className="aspect-square w-full rounded-lg border object-cover transition-transform hover:scale-[1.03]" />
              </a>
            ))}
          </div>
          {detail.declaredCondition && <p className="mt-2 text-sm text-muted-foreground">{detail.declaredCondition}</p>}
        </div>
      )}

      {/* Road tests */}
      {detail.roadTests.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold">Road tests</h4>
          <div className="mt-2 space-y-2">
            {detail.roadTests.map((rt) => {
              const rm = ROAD_TEST_STATUS_META[rt.status] ?? { label: rt.status, badge: 'bg-muted text-muted-foreground' }
              return (
                <div key={rt.id} className={cn('rounded-lg border p-3', rt.incident && 'border-destructive/50 bg-destructive/5')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{rt.purpose}</p>
                    <Badge variant="outline" className={rm.badge}>{rm.label}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Driver: {rt.driverName} · requested {timeAgo(rt.requestedAt)}
                    {rt.startOdometerKm != null && ` · out at ${rt.startOdometerKm.toLocaleString()} km`}
                    {rt.endOdometerKm != null && ` · back at ${rt.endOdometerKm.toLocaleString()} km`}
                  </p>
                  {rt.notes && <p className="mt-1 text-xs text-muted-foreground">Notes: {rt.notes}</p>}
                  {rt.incident && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-destructive">
                      <CircleAlert className="h-3 w-3" /> An incident was reported on this road test
                    </p>
                  )}
                  {rt.status === 'REQUESTED' && !disputed && (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" className="min-h-9 gap-1.5" disabled={busyRoadTest} onClick={() => respondRoadTest(rt.id, 'authorize-roadtest')}>
                        {busyRoadTest ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Authorise
                      </Button>
                      <Button size="sm" variant="ghost" className="min-h-9 text-destructive hover:text-destructive" disabled={busyRoadTest} onClick={() => respondRoadTest(rt.id, 'decline-roadtest')}>
                        <X className="h-3.5 w-3.5" /> Decline
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Completed work */}
      {detail.status === 'READY_FOR_COLLECTION' && detail.completedWork && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-primary dark:text-[#9dc3ae]">
            <Wrench className="h-4 w-4" /> Work completed
          </h4>
          <p className="mt-1 text-sm">{detail.completedWork}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {detail.costMinor != null && <span className="flex items-center gap-1 font-semibold text-foreground">Final cost: {money(detail.costMinor)}</span>}
            {detail.finalOdometerKm != null && <span className="flex items-center gap-1"><Gauge className="h-3 w-3" /> {detail.finalOdometerKm.toLocaleString()} km</span>}
          </div>
          {detail.finalNotes && <p className="mt-1 text-xs text-muted-foreground">{detail.finalNotes}</p>}
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

      {/* Collection actions */}
      {readyForCollection && !disputed && (
        <div className="rounded-xl border p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-primary" /> Collection
          </h4>
          {authActive && detail.collectionAuth && (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium">Authorised collector: {detail.collectionAuth.collectorName}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {detail.collectionAuth.collectorPhone}</span>
                <span>Code hint: <strong className="font-mono">{detail.collectionAuth.codeHint}</strong></span>
                <span>Valid until {dateLabel(detail.collectionAuth.expiresAt)}</span>
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 h-8 text-destructive hover:text-destructive"
                onClick={async () => {
                  try {
                    await apiSend(`/api/custody/${detail.id}/collection-auth`, 'DELETE')
                    toast.success('Collection authorisation revoked.')
                    onChanged()
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Could not revoke.')
                  }
                }}
              >
                <X className="h-3.5 w-3.5" /> Revoke authorisation
              </Button>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button className="min-h-11 gap-2" onClick={onCollectSelf}>
              <UserRound className="h-4 w-4" /> I&apos;ll collect personally
            </Button>
            {!authActive && (
              <Button variant="outline" className="min-h-11 gap-2" onClick={onAuthoriseOther}>
                <KeyRound className="h-4 w-4" /> Authorise someone else
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div>
        <h4 className="text-sm font-semibold">Full history</h4>
        <Stagger className="mt-2 space-y-3">
          {detail.events.map((ev) => (
            <StaggerItem key={ev.id}>
              <div className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary/70 ring-4 ring-primary/10" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-medium">{eventLabel(ev)}</p>
                  {ev.note && <p className="text-muted-foreground">{ev.note}</p>}
                  <p className="text-xs text-muted-foreground">
                    {timeAgo(ev.createdAt)}{ev.actorName ? ` · ${ev.actorName}` : ''}
                  </p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>

      {/* Dispute */}
      {!disputed && detail.status !== 'RETURNED' && (
        <div className="border-t pt-3">
          <Button variant="outline" className="min-h-11 gap-2 border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={onDispute}>
            <ShieldAlert className="h-4 w-4" /> Dispute this job
          </Button>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Opens a security incident and freezes the job until CARMAZE reviews it.
          </p>
        </div>
      )}
    </div>
  )
}

function eventLabel(ev: CustodyEvent): string {
  const labels: Record<string, string> = {
    CREATED: 'Custody requested',
    RECEIVE: 'Vehicle received',
    STATUS_CHANGED: 'Status updated',
    NOTE: 'Note added',
    ROAD_TEST_REQUESTED: 'Road test requested',
    ROAD_TEST_AUTHORISED: 'Road test authorised',
    ROAD_TEST_DECLINED: 'Road test declined',
    ROAD_TEST_STARTED: 'Road test started',
    ROAD_TEST_ENDED: 'Road test ended',
    COMPLETION_RECORDED: 'Work completed',
    COLLECTION_AUTH_CREATED: 'Collection authorised for a third party',
    COLLECTION_AUTH_REVOKED: 'Collection authorisation revoked',
    COLLECT_SELF: 'Owner confirmed personal collection',
    COLLECTED: 'Vehicle collected',
    DISPUTE: 'Dispute opened',
    INCIDENT: 'Incident reported',
  }
  if (labels[ev.type]) return labels[ev.type]
  if (ev.toStatus) {
    const meta = CUSTODY_STATUS_META[ev.toStatus]
    return `Moved to ${meta?.label.toLowerCase() ?? ev.toStatus.toLowerCase()}`
  }
  return ev.type.replaceAll('_', ' ').toLowerCase()
}

// ───────────────────────────── Collection auth dialog ─────────────────────────────

function CollectionAuthDialog({ custodyId, onClose, onDone }: {
  custodyId: string | null
  onClose: () => void
  onDone: () => void
}) {
  const [collectorName, setCollectorName] = useState('')
  const [collectorPhone, setCollectorPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState<string | null>(null)

  useEffect(() => {
    if (custodyId) { setCode(null); setCollectorName(''); setCollectorPhone('') }
  }, [custodyId])

  async function create() {
    if (!custodyId) return
    if (collectorName.trim().length < 3) { toast.error('Enter the full name of the person collecting.'); return }
    if (!/^(?:\+?254|0)(?:7|1)\d{8}$/.test(collectorPhone.replace(/\s+/g, ''))) {
      toast.error('Enter a valid Safaricom phone number for the collector, e.g. 0712 345 678.')
      return
    }
    setBusy(true)
    try {
      const d = await apiSend<{ code: string }>(`/api/custody/${custodyId}/collection-auth`, 'POST', {
        collectorName: collectorName.trim(),
        collectorPhone: collectorPhone.replace(/\s+/g, ''),
      })
      setCode(d.code)
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the authorisation.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={custodyId !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        {code ? (
          <>
            <DialogHeader>
              <DialogTitle>Authorisation created</DialogTitle>
              <DialogDescription>
                Share this 6-digit code with {collectorName.trim()}: it is shown <strong>only this once</strong>.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 p-4 text-center dark:bg-amber-500/10">
              <p className="font-mono text-4xl font-bold tracking-[0.35em] text-amber-900 dark:text-amber-300">{code}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 min-h-9 gap-1.5"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(code)
                    toast.success('Code copied')
                  } catch {
                    toast.error('Copy failed: write it down now.')
                  }
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Copy code
              </Button>
              <p className="mt-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                Share only with the person collecting. Valid 48 hours, single use. The garage verifies it at release:
                the vehicle will not be handed over without it.
              </p>
            </div>
            <DialogFooter>
              <Button className="min-h-11" onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Authorise someone else to collect</DialogTitle>
              <DialogDescription>
                The person you nominate presents the 6-digit code we generate plus their ID at the garage. Single use,
                valid 48 hours.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ca-name">Collector&apos;s full name *</Label>
                <Input id="ca-name" value={collectorName} onChange={(e) => setCollectorName(e.target.value)} placeholder="e.g. Jane Wanjiku" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ca-phone">Collector&apos;s phone *</Label>
                <Input id="ca-phone" type="tel" inputMode="tel" value={collectorPhone} onChange={(e) => setCollectorPhone(e.target.value)} placeholder="07xx xxx xxx" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={create} disabled={busy} className="min-h-11 gap-2">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Generate code
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────────── Dispute dialog ─────────────────────────────

function DisputeDialog({ custodyId, vehicleLabel, onClose, onDone }: {
  custodyId: string | null
  vehicleLabel: string
  onClose: () => void
  onDone: () => void
}) {
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = title.trim().length >= 4 && details.trim().length >= 20

  useEffect(() => {
    if (custodyId) { setTitle(''); setDetails('') }
  }, [custodyId])

  async function submit() {
    if (!custodyId || !valid) return
    setBusy(true)
    try {
      await apiPostDispute(custodyId, title.trim(), details.trim())
      toast.success('Dispute opened: the job is frozen while CARMAZE security reviews it.')
      onDone()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open the dispute.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={custodyId !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dispute this custody job</DialogTitle>
          <DialogDescription>
            {vehicleLabel ? `${vehicleLabel}: ` : ''}this opens a security incident, freezes the job and notifies CARMAZE
            security. Use it for damage you did not authorise, missing parts or anything suspicious.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dp-title">What happened (short title) *</Label>
            <Input id="dp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Scratched bumper not agreed" maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dp-details">Full details * <span className="font-normal text-muted-foreground">(min 20 characters)</span></Label>
            <Textarea id="dp-details" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Describe exactly what is wrong, when you noticed it and what you expected…" />
            <p className={cn('text-xs', details.trim().length >= 20 ? 'text-muted-foreground' : 'text-destructive')}>
              {details.trim().length}/20 characters minimum
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={busy || !valid} className="min-h-11 gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Open dispute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

async function apiPostDispute(custodyId: string, title: string, details: string) {
  await apiSend('/api/incidents', 'POST', {
    category: 'DAMAGE_IN_CUSTODY',
    title,
    details,
    custodyId,
  })
  await apiSend(`/api/custody/${custodyId}`, 'PATCH', { action: 'dispute', note: title })
}

// ───────────────────────────── Report incident dialog ─────────────────────────────

function ReportIncidentDialog({ open, onClose, onReported }: {
  open: boolean
  onClose: () => void
  onReported: (safetyNote: string) => void
}) {
  const [category, setCategory] = useState<string>('OTHER')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [vehicleDesc, setVehicleDesc] = useState('')
  const [evidence, setEvidence] = useState<{ url: string; name: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const valid = title.trim().length >= 4 && details.trim().length >= 20

  useEffect(() => {
    if (open) { setCategory('OTHER'); setTitle(''); setDetails(''); setVehicleDesc(''); setEvidence([]) }
  }, [open])

  async function uploadEvidence(file: File) {
    if (evidence.length >= 3) { toast.error('Up to 3 evidence files.'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const d = await apiUpload<{ url: string; name: string }>('/api/upload', fd)
      setEvidence((prev) => [...prev, { url: d.url, name: d.name || file.name }])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    if (!valid) return
    setBusy(true)
    try {
      const d = await apiSend<{ incident: { refCode: string }; safetyNote: string }>('/api/incidents', 'POST', {
        category,
        title: title.trim(),
        details: details.trim(),
        vehicleDesc: vehicleDesc.trim() || undefined,
        evidence: evidence.length > 0 ? evidence.map((f) => f.url) : undefined,
      })
      toast.success(`Incident ${d.incident.refCode} reported.`)
      onReported(d.safetyNote ?? SAFETY_NOTE_FALLBACK)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not report the incident.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report a security concern</DialogTitle>
          <DialogDescription>
            Every report is reviewed by CARMAZE security. False reports waste everyone&apos;s time: be precise and honest.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Category *</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger aria-label="Incident category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INCIDENT_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ri-title">Short title *</Label>
            <Input id="ri-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Car missing from yard after service" maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ri-details">Full details * <span className="font-normal text-muted-foreground">(min 20 characters)</span></Label>
            <Textarea id="ri-details" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="What happened, when, who was involved, what you have already tried…" />
            <p className={cn('text-xs', details.trim().length >= 20 ? 'text-muted-foreground' : 'text-destructive')}>
              {details.trim().length}/20 characters minimum
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ri-vehicle">Vehicle involved (optional)</Label>
            <Input id="ri-vehicle" value={vehicleDesc} onChange={(e) => setVehicleDesc(e.target.value)} placeholder="e.g. Toyota Premio, white, KDJ…" />
          </div>
          <div className="space-y-1.5">
            <Label>Evidence (optional, up to 3)</Label>
            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground transition-colors hover:bg-muted/60">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {uploading ? 'Uploading…' : 'Attach photos or documents'}
              <input
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadEvidence(f); e.currentTarget.value = '' }}
              />
            </label>
            {evidence.length > 0 && (
              <ul className="space-y-1">
                {evidence.map((f, i) => (
                  <li key={f.url} className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-1.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2"><FileText className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{f.name}</span></span>
                    <button className="text-xs text-muted-foreground hover:text-destructive" aria-label={`Remove ${f.name}`} onClick={() => setEvidence((prev) => prev.filter((_, j) => j !== i))}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !valid} className="min-h-11 gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Submit report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────────── Incidents list ─────────────────────────────

function IncidentsList({ incidents, onAdded }: { incidents: IncidentItem[]; onAdded: () => void }) {
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function addNote(id: string) {
    if (note.trim().length < 3) { toast.error('Write a short note first.'); return }
    setBusy(true)
    try {
      await apiSend(`/api/incidents/${id}`, 'PATCH', { action: 'note', note: note.trim() })
      toast.success('Note added to the incident.')
      setNote(''); setNoteFor(null)
      onAdded()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the note.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 space-y-2">
      {incidents.map((inc) => {
        const badge = INCIDENT_STATUS_BADGE[inc.status ?? 'OPEN'] ?? 'bg-muted text-muted-foreground'
        const catLabel = INCIDENT_CATEGORIES.find((c) => c.value === inc.category)?.label ?? inc.category.replaceAll('_', ' ').toLowerCase()
        return (
          <div key={inc.id} className="rounded-xl border bg-card p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-destructive/40 text-destructive">{catLabel}</Badge>
                <p className="truncate text-sm font-semibold">{inc.title}</p>
                {inc.refCode && <span className="font-mono text-[11px] text-muted-foreground">{inc.refCode}</span>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline" className={badge}>{(inc.status ?? 'OPEN').replaceAll('_', ' ').toLowerCase()}</Badge>
                <span className="text-xs text-muted-foreground">{timeAgo(inc.createdAt)}</span>
              </div>
            </div>
            {inc.details && <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{inc.details}</p>}
            {inc.orgName && <p className="mt-1 text-xs text-muted-foreground">Business: {inc.orgName}</p>}
            {noteFor === inc.id ? (
              <div className="mt-2 space-y-2">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add context for the security team…" aria-label="Additional note" />
                <div className="flex gap-2">
                  <Button size="sm" className="min-h-9 gap-1.5" disabled={busy} onClick={() => addNote(inc.id)}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquarePlus className="h-3.5 w-3.5" />} Save note
                  </Button>
                  <Button size="sm" variant="ghost" className="min-h-9" onClick={() => { setNoteFor(null); setNote('') }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="mt-1.5 h-8 gap-1 text-xs text-muted-foreground" onClick={() => { setNoteFor(inc.id); setNote('') }}>
                <MessageSquarePlus className="h-3.5 w-3.5" /> Add note
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
