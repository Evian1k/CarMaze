'use client'

/* Customer-side test drive list: status, schedule, vehicle + dealership,
 * odometer trail and cancel action. Shared by the Account dashboard.
 * Talks to /api/test-drives?mine=1 only. */

import { useCallback, useEffect, useState } from 'react'
import { CarFront, CalendarClock, Gauge, IdCard, Loader2, Store, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { apiGet, apiSend, navigate } from '@/lib/client'
import { timeAgo, dateLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type CustomerTestDrive = {
  id: string
  refCode: string
  status: string
  scheduledAt: string
  licenceConfirmed: boolean
  orgName?: string
  vehicle: { id?: string; make: string; model: string; year: number; photo?: string | null } | null
  odometerOut?: number | null
  odometerIn?: number | null
  conditionOut?: string | null
  conditionIn?: string | null
  startedAt?: string | null
  endedAt?: string | null
  notes?: string | null
}

const TD_STATUS_META: Record<string, { label: string; badge: string }> = {
  PENDING: { label: 'Awaiting confirmation', badge: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  CONFIRMED: { label: 'Confirmed', badge: 'border-sky-300 bg-sky-500/15 text-sky-800 dark:text-sky-300' },
  IN_PROGRESS: { label: 'On the drive', badge: 'border-indigo-300 bg-indigo-500/15 text-indigo-800 dark:text-indigo-300' },
  COMPLETED: { label: 'Completed', badge: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-muted text-muted-foreground' },
  NO_SHOW: { label: 'Missed (no-show)', badge: 'bg-muted text-muted-foreground' },
}

const CANCELLABLE = new Set(['PENDING', 'CONFIRMED'])

export function CustomerTestDrives() {
  const [drives, setDrives] = useState<CustomerTestDrive[] | null>(null)
  const [tick, setTick] = useState(0)
  const [cancelling, setCancelling] = useState<CustomerTestDrive | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiGet<{ testDrives: CustomerTestDrive[] }>('/api/test-drives?mine=1')
      .then((d) => { if (!cancelled) setDrives(d.testDrives) })
      .catch(() => { if (!cancelled) setDrives([]) })
    return () => { cancelled = true }
  }, [tick])

  useEffect(() => {
    const t = setInterval(() => setTick((k) => k + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  const reload = useCallback(() => setTick((k) => k + 1), [])

  const upcoming = (drives ?? [])
    .filter((d) => ['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(d.status))
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
  const past = (drives ?? [])
    .filter((d) => !['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(d.status))
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())

  async function cancelDrive() {
    if (!cancelling) return
    setBusy(true)
    try {
      await apiSend(`/api/test-drives/${cancelling.id}`, 'PATCH', { action: 'cancel' })
      toast.success('Test drive cancelled — the dealership has been notified.')
      setCancelling(null)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not cancel the test drive.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Test drives you have booked. You can cancel any time before the keys are handed over.
        </p>
        <Button variant="outline" className="min-h-11 gap-2" onClick={() => navigate('showrooms')}>
          <Store className="h-4 w-4" /> Browse showrooms
        </Button>
      </div>

      {drives === null ? (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      ) : drives.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CarFront className="h-7 w-7" aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-base font-semibold">No test drives booked</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Find a car you love and request a drive from its listing page — the dealership confirms and tracks
            everything here.
          </p>
          <Button className="mt-5 min-h-11" variant="outline" onClick={() => navigate('cars')}>Browse cars</Button>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {upcoming.map((d) => <DriveCard key={d.id} drive={d} onCancel={() => setCancelling(d)} />)}
          </div>
          {past.length > 0 && (
            <details className="rounded-xl border bg-card">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
                Past drives ({past.length})
              </summary>
              <div className="space-y-3 px-3 pb-3">
                {past.map((d) => <DriveCard key={d.id} drive={d} onCancel={() => setCancelling(d)} />)}
              </div>
            </details>
          )}
        </>
      )}

      <AlertDialog open={cancelling !== null} onOpenChange={(o) => { if (!o) setCancelling(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this test drive?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelling?.vehicle
                ? `The drive for the ${cancelling.vehicle.make} ${cancelling.vehicle.model} on ${dateLabel(cancelling.scheduledAt)} will be cancelled.`
                : 'The dealership will be notified and the slot released.'}
              You can book another drive any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={busy}
              onClick={(e) => { e.preventDefault(); cancelDrive() }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Cancel drive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DriveCard({ drive, onCancel }: { drive: CustomerTestDrive; onCancel: () => void }) {
  const meta = TD_STATUS_META[drive.status] ?? { label: drive.status, badge: 'bg-muted text-muted-foreground' }
  const active = ['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(drive.status)
  const v = drive.vehicle

  return (
    <Card className="py-4">
      <CardContent className="px-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {v?.photo ? (
               
              <img src={v.photo} alt="" className="h-14 w-20 shrink-0 rounded-lg object-cover" />
            ) : (
              <span className="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <CarFront className="h-5 w-5" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">
                {v ? (
                  v.id ? (
                    <button className="hover:underline" onClick={() => navigate(`vehicle-detail/${v.id}`)}>
                      {v.make} {v.model} {v.year}
                    </button>
                  ) : (
                    <>{v.make} {v.model} {v.year}</>
                  )
                ) : 'Vehicle removed'}
              </h3>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {drive.orgName && <span>{drive.orgName}</span>}
                <span className="flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {dateLabel(drive.scheduledAt)}</span>
                <span className="font-mono">{drive.refCode}</span>
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px]', meta.badge)}>{meta.label}</Badge>
                {drive.licenceConfirmed ? (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] border-primary/40 text-primary dark:text-[#9dc3ae]">
                    <IdCard className="h-3 w-3" /> Licence verified
                  </Badge>
                ) : (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">Licence not yet verified</Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="text-[11px] text-muted-foreground">booked {timeAgo(drive.scheduledAt)}</span>
            {active && (
              <Button size="sm" variant="ghost" className="h-9 min-h-9 text-destructive hover:text-destructive" onClick={onCancel}>
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
            )}
          </div>
        </div>
        {(drive.odometerOut != null || drive.odometerIn != null || drive.conditionOut || drive.conditionIn || drive.notes) && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
            {drive.odometerOut != null && <span className="flex items-center gap-1"><Gauge className="h-3 w-3" /> Out: {drive.odometerOut.toLocaleString()} km</span>}
            {drive.odometerIn != null && <span className="flex items-center gap-1"><Gauge className="h-3 w-3" /> In: {drive.odometerIn.toLocaleString()} km</span>}
            {drive.conditionOut && <span>Out condition: {drive.conditionOut}</span>}
            {drive.conditionIn && <span>In condition: {drive.conditionIn}</span>}
            {drive.notes && <span className="w-full">Notes: {drive.notes}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
