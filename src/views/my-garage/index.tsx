'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Car, Wrench, Bell, Gauge, Plus, Trash2, CalendarClock, ShieldCheck, Coins,
  CircleCheck, Undo2, Lock, Info, FileText, CalendarDays,
} from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiSend, navigate } from '@/lib/client'
import { useAuth } from '@/stores/auth'
import { money, dateLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { VehicleProtection } from '@/components/protection/vehicle-protection'
import { useHashRoute } from '@/hooks/use-hash-route'

// ─────────────────────────────── Types ───────────────────────────────

type GarageRecord = {
  id: string
  date: string
  type: string
  description: string | null
  costMinor: number | null
  mileageKm: number | null
  garageOrgId: string | null
}

type GarageReminder = {
  id: string
  type: string
  title: string
  dueDate: string
  intervalDays: number | null
  status: string
}

type GarageVehicle = {
  id: string
  make: string
  model: string
  year: number | null
  plate: string | null
  color: string | null
  mileageKm: number | null
  purchaseDate: string | null
  purchasePriceMinor: number | null
  notes: string | null
  records: GarageRecord[]
  reminders: GarageReminder[]
}

type ReminderWithVehicle = GarageReminder & { vehicle: { make: string; model: string; plate: string | null } }

const REMINDER_TYPE_LABELS: Record<string, string> = {
  SERVICE: 'Service',
  INSURANCE: 'Insurance renewal',
  INSPECTION: 'Inspection',
  LICENSE: 'License',
  CUSTOM: 'Custom',
}

const RECORD_TYPE_LABELS: Record<string, string> = {
  SERVICE: 'Service',
  REPAIR: 'Repair',
  INSPECTION: 'Inspection',
  MODIFICATION: 'Modification',
  OTHER: 'Other',
}

const INTERVAL_OPTIONS = [
  { value: '30', label: 'Every 30 days' },
  { value: '90', label: 'Every 90 days' },
  { value: '180', label: 'Every 180 days' },
  { value: '365', label: 'Every 365 days' },
]

const scrollbarClasses =
  'max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent'

// ─────────────────────────────── Helpers ───────────────────────────────

function daysUntil(dueDate: string): number {
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86_400_000)
}

function ReminderDueBadge({ dueDate }: { dueDate: string }) {
  const d = daysUntil(dueDate)
  if (d < 0) {
    return (
      <Badge variant="destructive" className="gap-1">
        <CalendarClock className="h-3 w-3" /> Overdue {Math.abs(d)}d
      </Badge>
    )
  }
  if (d <= 14) {
    return (
      <Badge className="gap-1 border-gold/60 bg-gold/20 text-gold-ink dark:text-gold">
        <CalendarClock className="h-3 w-3" /> Due soon · {d === 0 ? 'today' : `${d}d`}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <CalendarDays className="h-3 w-3" /> In {d}d
    </Badge>
  )
}

function totalSpent(v: GarageVehicle): number {
  return v.records.reduce((sum, r) => sum + (r.costMinor ?? 0), 0)
}

// ─────────────────────────────── View ───────────────────────────────

export default function View() {
  const { user, loading: authLoading } = useAuth()
  const route = useHashRoute()

  const SECTIONS = ['garage', 'protection'] as const
  const [section, setSection] = useState<string>(() => {
    const t = route.query.get('tab')
    return SECTIONS.includes(t as (typeof SECTIONS)[number]) ? t! : 'garage'
  })

  const [vehicles, setVehicles] = useState<GarageVehicle[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  // dialogs
  const [addVehicleOpen, setAddVehicleOpen] = useState(false)
  const [deleteVehicleId, setDeleteVehicleId] = useState<string | null>(null)
  const [recordDialogVehicleId, setRecordDialogVehicleId] = useState<string | null>(null)
  const [reminderDialogVehicleId, setReminderDialogVehicleId] = useState<string | null>(null)

  const selected = useMemo(
    () => vehicles.find((v) => v.id === selectedId) ?? vehicles[0] ?? null,
    [vehicles, selectedId]
  )

  useEffect(() => {
    if (!user) return
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) setDataLoading(true)
    })
    apiGet<{ vehicles: GarageVehicle[] }>('/api/mygarage/vehicles')
      .then((d) => {
        if (cancelled) return
        setVehicles(d.vehicles)
        setDataLoading(false)
      })
      .catch((e: Error) => {
        if (cancelled) return
        toast.error(e.message || 'Could not load your garage.')
        setDataLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user, reloadKey])

  function refresh() {
    setReloadKey((k) => k + 1)
  }

  // ── Auth gate ──
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <Skeleton className="h-10 w-72" />
          <div className="mt-8 grid gap-6 lg:grid-cols-[340px_1fr]">
            <div className="space-y-4">
              <Skeleton className="h-40 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">My Garage</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to keep your private ownership records — service history, costs and reminders for every car you own.
          </p>
          <Button className="mt-6" onClick={() => navigate('signin')}>
            Sign in to continue
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
        {/* Header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">My Garage</h1>
            <p className="mt-1 text-sm text-muted-foreground">Your private ownership records.</p>
          </div>
          <Button onClick={() => setAddVehicleOpen(true)} className="shrink-0">
            <Plus className="mr-1.5 h-4 w-4" /> Add vehicle
          </Button>
        </header>

        <Tabs value={section} onValueChange={setSection} className="mt-6">
          <TabsList className="h-auto w-full justify-start overflow-x-auto py-0.5">
            <TabsTrigger value="garage" className="min-h-11 gap-1.5">
              <Car className="h-4 w-4" /> My vehicles
            </TabsTrigger>
            <TabsTrigger value="protection" className="min-h-11 gap-1.5">
              <ShieldCheck className="h-4 w-4" /> Vehicle protection
            </TabsTrigger>
          </TabsList>

          <TabsContent value="garage" className="mt-0">
        <div className="mt-4 space-y-3">
          <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-xs leading-relaxed text-foreground/80">
              <span className="font-medium">Private by default.</span> You choose what to share — nothing here is
              public, and reminders live in your notification center only.
            </p>
          </div>
          <div className="flex items-start gap-2.5 rounded-lg border border-gold/40 bg-gold/10 p-3.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink dark:text-gold" />
            <p className="text-xs leading-relaxed text-foreground/80">
              CARMAZE does not send SMS or email reminders in this deployment — check the Alerts tab.
            </p>
          </div>
        </div>

        {/* Content */}
        {dataLoading ? (
          <div className="mt-8 grid gap-6 lg:grid-cols-[340px_1fr]">
            <div className="space-y-4">
              <Skeleton className="h-44 w-full rounded-xl" />
              <Skeleton className="h-44 w-full rounded-xl" />
            </div>
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        ) : vehicles.length === 0 ? (
          <Card className="mt-8 border-dashed">
            <CardContent className="flex flex-col items-center py-14 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Car className="h-8 w-8 text-muted-foreground" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-foreground">Your garage is empty</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Add the cars you own to track service history, running costs and renewal reminders in one private place.
              </p>
              <Button className="mt-5" onClick={() => setAddVehicleOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Add your first vehicle
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-8 grid items-start gap-6 lg:grid-cols-[340px_1fr]">
            {/* Vehicle list */}
            <div className="space-y-4">
              {vehicles.map((v) => {
                const active = selected?.id === v.id
                const activeReminders = v.reminders.filter((r) => r.status === 'ACTIVE').length
                const nextDue = v.reminders
                  .filter((r) => r.status === 'ACTIVE')
                  .map((r) => daysUntil(r.dueDate))
                  .sort((a, b) => a - b)[0]
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedId(v.id)}
                    className={`block w-full rounded-xl border bg-card text-left shadow-sm transition-all hover:shadow-md ${
                      active ? 'border-primary ring-2 ring-primary/30' : 'border-border'
                    }`}
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-semibold leading-tight text-foreground">
                            {v.make} {v.model}
                            {v.year ? <span className="text-muted-foreground"> · {v.year}</span> : null}
                          </h3>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {v.plate ? <Badge variant="secondary" className="font-mono text-[11px]">{v.plate}</Badge> : null}
                            {v.color ? (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <span className="h-2.5 w-2.5 rounded-full border border-border bg-gradient-to-br from-stone-300 to-stone-500" />
                                {v.color}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {active ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Selected" /> : null}
                      </div>

                      <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Gauge className="h-3.5 w-3.5" />
                        {v.mileageKm != null ? `${v.mileageKm.toLocaleString()} km` : 'Mileage not set'}
                      </div>

                      <Separator className="my-3" />

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Total spent</p>
                          <p className="mt-0.5 flex items-center gap-1 font-semibold text-foreground">
                            <Coins className="h-3.5 w-3.5 text-primary" /> {money(totalSpent(v))}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Service records</p>
                          <p className="mt-0.5 flex items-center gap-1 font-semibold text-foreground">
                            <Wrench className="h-3.5 w-3.5 text-primary" /> {v.records.length}
                          </p>
                        </div>
                        {v.purchasePriceMinor != null ? (
                          <div className="col-span-2">
                            <p className="text-muted-foreground">Purchased {dateLabel(v.purchaseDate)}</p>
                            <p className="mt-0.5 font-semibold text-foreground">{money(v.purchasePriceMinor)}</p>
                          </div>
                        ) : null}
                        {activeReminders > 0 ? (
                          <div className="col-span-2 flex items-center gap-1.5 text-primary">
                            <Bell className="h-3.5 w-3.5" />
                            {activeReminders} active reminder{activeReminders === 1 ? '' : 's'}
                            {nextDue != null && nextDue >= 0 ? ` · next in ${nextDue}d` : nextDue != null ? ' · one overdue' : ''}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Selected vehicle panel */}
            {selected ? (
              <SelectedVehiclePanel
                vehicle={selected}
                onAddRecord={() => setRecordDialogVehicleId(selected.id)}
                onAddReminder={() => setReminderDialogVehicleId(selected.id)}
                onDelete={() => setDeleteVehicleId(selected.id)}
                onChanged={refresh}
              />
            ) : null}
          </div>
        )}
          </TabsContent>

          <TabsContent value="protection" className="mt-2">
            <VehicleProtection />
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialogs */}
      <AddVehicleDialog
        open={addVehicleOpen}
        onClose={() => setAddVehicleOpen(false)}
        onCreated={(id) => {
          setSelectedId(id)
          refresh()
        }}
      />

      <AddRecordDialog
        vehicleId={recordDialogVehicleId}
        vehicleLabel={
          recordDialogVehicleId
            ? (() => {
                const v = vehicles.find((x) => x.id === recordDialogVehicleId)
                return v ? `${v.make} ${v.model}` : ''
              })()
            : ''
        }
        onClose={() => setRecordDialogVehicleId(null)}
        onCreated={refresh}
      />

      <AddReminderDialog
        vehicleId={reminderDialogVehicleId}
        vehicleLabel={
          reminderDialogVehicleId
            ? (() => {
                const v = vehicles.find((x) => x.id === reminderDialogVehicleId)
                return v ? `${v.make} ${v.model}` : ''
              })()
            : ''
        }
        onClose={() => setReminderDialogVehicleId(null)}
        onCreated={refresh}
      />

      <DeleteVehicleDialog
        vehicleId={deleteVehicleId}
        vehicleLabel={(() => {
          const v = vehicles.find((x) => x.id === deleteVehicleId)
          return v ? `${v.make} ${v.model}${v.year ? ` ${v.year}` : ''}` : ''
        })()}
        onClose={() => setDeleteVehicleId(null)}
        onDeleted={() => {
          setDeleteVehicleId(null)
          refresh()
        }}
      />
    </div>
  )
}

// ─────────────────────── Selected vehicle panel ───────────────────────

function SelectedVehiclePanel({
  vehicle,
  onAddRecord,
  onAddReminder,
  onDelete,
  onChanged,
}: {
  vehicle: GarageVehicle
  onAddRecord: () => void
  onAddReminder: () => void
  onDelete: () => void
  onChanged: () => void
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">
              {vehicle.make} {vehicle.model}
              {vehicle.year ? <span className="font-normal text-muted-foreground"> · {vehicle.year}</span> : null}
            </CardTitle>
            <CardDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {vehicle.plate ? <span className="font-mono text-xs">{vehicle.plate}</span> : null}
              {vehicle.color ? <span className="text-xs">{vehicle.color}</span> : null}
              {vehicle.mileageKm != null ? <span className="text-xs">{vehicle.mileageKm.toLocaleString()} km</span> : null}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onAddRecord}>
              <Wrench className="mr-1.5 h-4 w-4" /> Log service
            </Button>
            <Button size="sm" variant="outline" onClick={onAddReminder}>
              <Bell className="mr-1.5 h-4 w-4" /> Add reminder
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Delete vehicle</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="records">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="records" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Records ({vehicle.records.length})
            </TabsTrigger>
            <TabsTrigger value="reminders" className="gap-1.5">
              <Bell className="h-3.5 w-3.5" /> Reminders ({vehicle.reminders.filter((r) => r.status === 'ACTIVE').length})
            </TabsTrigger>
            <TabsTrigger value="details" className="gap-1.5">
              <Gauge className="h-3.5 w-3.5" /> Details
            </TabsTrigger>
          </TabsList>

          <TabsContent value="records" className="mt-4">
            {vehicle.records.length === 0 ? (
              <EmptyHint
                icon={<Wrench className="h-6 w-6" />}
                text="No service records yet. Log an oil change, repair or inspection to build the history."
                action={
                  <Button size="sm" variant="outline" onClick={onAddRecord}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Log first service
                  </Button>
                }
              />
            ) : (
              <ol className={scrollbarClasses + ' relative space-y-0 pr-2'}>
                {vehicle.records.map((r, idx) => (
                  <li key={r.id} className="relative flex gap-4 pb-5 last:pb-0">
                    {idx < vehicle.records.length - 1 ? (
                      <span className="absolute left-[7px] top-5 h-full w-px bg-border" aria-hidden="true" />
                    ) : null}
                    <span className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-primary bg-background" aria-hidden="true" />
                    <div className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="text-[11px]">
                            {RECORD_TYPE_LABELS[r.type] ?? r.type}
                          </Badge>
                          <span className="text-sm font-medium text-foreground">{dateLabel(r.date)}</span>
                        </div>
                        <RecordDeleteButton recordId={r.id} onChanged={onChanged} />
                      </div>
                      {r.description ? <p className="mt-1.5 text-sm text-foreground/80">{r.description}</p> : null}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {r.costMinor != null ? (
                          <span className="flex items-center gap-1">
                            <Coins className="h-3 w-3" /> {money(r.costMinor)}
                          </span>
                        ) : null}
                        {r.mileageKm != null ? (
                          <span className="flex items-center gap-1">
                            <Gauge className="h-3 w-3" /> {r.mileageKm.toLocaleString()} km
                          </span>
                        ) : null}
                        {r.garageOrgId ? (
                          <span className="flex items-center gap-1">
                            <Wrench className="h-3 w-3" /> Garage ref: {r.garageOrgId.slice(-6).toUpperCase()}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>

          <TabsContent value="reminders" className="mt-4">
            {vehicle.reminders.length === 0 ? (
              <EmptyHint
                icon={<Bell className="h-6 w-6" />}
                text="No reminders yet. Add insurance renewals, services or inspections so you never miss a date."
                action={
                  <Button size="sm" variant="outline" onClick={onAddReminder}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Add first reminder
                  </Button>
                }
              />
            ) : (
              <div className={scrollbarClasses + ' space-y-3 pr-2'}>
                {vehicle.reminders.map((r) => (
                  <ReminderRow key={r.id} reminder={r} onChanged={onChanged} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="details" className="mt-4">
            <MileageUpdater vehicle={vehicle} onChanged={onChanged} />
            <Separator className="my-5" />
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <DetailRow label="Purchased on" value={dateLabel(vehicle.purchaseDate)} />
              <DetailRow label="Purchase price" value={vehicle.purchasePriceMinor != null ? money(vehicle.purchasePriceMinor) : '—'} />
              <DetailRow
                label="Total spent on records"
                value={money(vehicle.records.reduce((s, r) => s + (r.costMinor ?? 0), 0))}
              />
              <DetailRow label="Records kept" value={`${vehicle.records.length}`} />
            </div>
            {vehicle.notes ? (
              <div className="mt-4 rounded-lg bg-muted/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
                <p className="mt-1 text-sm text-foreground/80">{vehicle.notes}</p>
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium text-foreground">{value}</p>
    </div>
  )
}

function EmptyHint({ icon, text, action }: { icon: React.ReactNode; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed py-10 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">{text}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

function RecordDeleteButton({ recordId, onChanged }: { recordId: string; onChanged: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  function doDelete() {
    setBusy(true)
    apiSend('/api/mygarage/records?id=' + encodeURIComponent(recordId), 'DELETE')
      .then(() => {
        toast.success('Record deleted.')
        setConfirmOpen(false)
        onChanged()
      })
      .catch((e: Error) => toast.error(e.message || 'Could not delete record.'))
      .finally(() => setBusy(false))
  }

  return (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
          <span className="sr-only">Delete record</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this service record?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the record from your private history. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              doDelete()
            }}
            disabled={busy}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {busy ? 'Deleting…' : 'Delete record'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ─────────────────────────── Reminder row ───────────────────────────

function ReminderRow({ reminder, onChanged }: { reminder: GarageReminder; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const done = reminder.status === 'DONE'
  const dismissed = reminder.status === 'DISMISSED'

  function setStatus(status: 'DONE' | 'DISMISSED' | 'ACTIVE') {
    setBusy(true)
    apiSend<{ reminder: GarageReminder; next: GarageReminder | null }>(
      '/api/mygarage/reminders?id=' + encodeURIComponent(reminder.id),
      'PATCH',
      { status }
    )
      .then((d) => {
        if (status === 'DONE' && d.next) {
          toast.success(`Recurring reminder rescheduled for ${dateLabel(d.next.dueDate)}`)
        } else if (status === 'DONE') {
          toast.success('Reminder marked as done.')
        } else if (status === 'DISMISSED') {
          toast('Reminder dismissed.')
        } else {
          toast.success('Reminder reactivated.')
        }
        onChanged()
      })
      .catch((e: Error) => toast.error(e.message || 'Could not update reminder.'))
      .finally(() => setBusy(false))
  }

  return (
    <div
      className={`rounded-lg border p-3.5 ${
        done || dismissed ? 'border-border bg-muted/30 opacity-70' : 'border-border bg-card'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[11px] text-primary border-primary/40">
              {REMINDER_TYPE_LABELS[reminder.type] ?? reminder.type}
            </Badge>
            <span className={`text-sm font-medium ${done || dismissed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
              {reminder.title}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ReminderDueBadge dueDate={reminder.dueDate} />
            {reminder.intervalDays ? (
              <span className="text-[11px] text-muted-foreground">Repeats every {reminder.intervalDays} days</span>
            ) : null}
            {done ? <Badge variant="secondary">Done</Badge> : null}
            {dismissed ? <Badge variant="secondary">Dismissed</Badge> : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {done || dismissed ? (
            <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => setStatus('ACTIVE')}>
              <Undo2 className="mr-1 h-3.5 w-3.5" /> Reactivate
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => setStatus('DONE')}>
                <CircleCheck className="mr-1 h-3.5 w-3.5" /> Done
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" disabled={busy} onClick={() => setStatus('DISMISSED')}>
                Dismiss
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────── Mileage updater ───────────────────────────

function MileageUpdater({ vehicle, onChanged }: { vehicle: GarageVehicle; onChanged: () => void }) {
  const [value, setValue] = useState(String(vehicle.mileageKm ?? ''))
  const [busy, setBusy] = useState(false)

  function save() {
    const km = parseInt(value, 10)
    if (Number.isNaN(km) || km < 0) {
      toast.error('Enter a valid mileage in km.')
      return
    }
    setBusy(true)
    apiSend('/api/mygarage/vehicles/' + vehicle.id, 'PATCH', { mileageKm: km })
      .then(() => {
        toast.success('Mileage updated.')
        onChanged()
      })
      .catch((e: Error) => toast.error(e.message || 'Could not update mileage.'))
      .finally(() => setBusy(false))
  }

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current odometer</p>
      <div className="mt-2 flex max-w-sm gap-2">
        <div className="relative flex-1">
          <Gauge className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 62000"
            className="pl-9"
            aria-label="Mileage in kilometres"
          />
        </div>
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">Update any time — logging a higher-mileage service record also updates this automatically.</p>
    </div>
  )
}

// ─────────────────────────── Add vehicle dialog ───────────────────────────

function AddVehicleDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [plate, setPlate] = useState('')
  const [color, setColor] = useState('')
  const [mileage, setMileage] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!make.trim() || !model.trim()) {
      toast.error('Make and model are required.')
      return
    }
    setBusy(true)
    apiSend<{ vehicle: GarageVehicle }>('/api/mygarage/vehicles', 'POST', {
      make: make.trim(),
      model: model.trim(),
      year: year ? parseInt(year, 10) : undefined,
      plate: plate.trim() || undefined,
      color: color.trim() || undefined,
      mileageKm: mileage ? parseInt(mileage, 10) : undefined,
      purchaseDate: purchaseDate || undefined,
      purchasePriceMinor: purchasePrice ? Math.round(parseFloat(purchasePrice) * 100) : undefined,
      notes: notes.trim() || undefined,
    })
      .then((d) => {
        toast.success(`${d.vehicle.make} ${d.vehicle.model} added to your garage.`)
        setMake(''); setModel(''); setYear(''); setPlate(''); setColor(''); setMileage(''); setPurchaseDate(''); setPurchasePrice(''); setNotes('')
        onClose()
        onCreated(d.vehicle.id)
      })
      .catch((err: Error) => toast.error(err.message || 'Could not add vehicle.'))
      .finally(() => setBusy(false))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a vehicle</DialogTitle>
          <DialogDescription>Only you can see the vehicles in your garage.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-make">Make *</Label>
              <Input id="v-make" value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-model">Model *</Label>
              <Input id="v-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Vitz 1.0" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-year">Year</Label>
              <Input id="v-year" type="number" min={1950} max={new Date().getFullYear() + 2} value={year} onChange={(e) => setYear(e.target.value)} placeholder="2016" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-plate">Number plate</Label>
              <Input id="v-plate" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="KCX 118R" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-color">Colour</Label>
              <Input id="v-color" value={color} onChange={(e) => setColor(e.target.value)} placeholder="White" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-mileage">Mileage (km)</Label>
              <Input id="v-mileage" type="number" min={0} value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder="62000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-pdate">Purchase date</Label>
              <Input id="v-pdate" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-price">Purchase price (KES)</Label>
              <Input id="v-price" type="number" min={0} step="0.01" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="950000" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-notes">Notes</Label>
            <Textarea id="v-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bought from a colleague, full history available." rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add vehicle'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────── Add record dialog ───────────────────────────

function AddRecordDialog({
  vehicleId,
  vehicleLabel,
  onClose,
  onCreated,
}: {
  vehicleId: string | null
  vehicleLabel: string
  onClose: () => void
  onCreated: () => void
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [type, setType] = useState('SERVICE')
  const [description, setDescription] = useState('')
  const [cost, setCost] = useState('')
  const [mileage, setMileage] = useState('')
  const [garageRef, setGarageRef] = useState('')
  const [busy, setBusy] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!vehicleId) return
    setBusy(true)
    apiSend('/api/mygarage/records', 'POST', {
      myVehicleId: vehicleId,
      date,
      type,
      description: description.trim() || undefined,
      costMinor: cost ? Math.round(parseFloat(cost) * 100) : undefined,
      mileageKm: mileage ? parseInt(mileage, 10) : undefined,
      garageOrgId: garageRef.trim() || undefined,
    })
      .then(() => {
        toast.success('Service record added.')
        setDescription(''); setCost(''); setMileage(''); setGarageRef('')
        onClose()
        onCreated()
      })
      .catch((err: Error) => toast.error(err.message || 'Could not add record.'))
      .finally(() => setBusy(false))
  }

  return (
    <Dialog open={vehicleId !== null} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log a service record</DialogTitle>
          <DialogDescription>{vehicleLabel ? `For your ${vehicleLabel}. Private to you.` : 'Private to you.'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="r-date">Date *</Label>
              <Input id="r-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger aria-label="Record type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(RECORD_TYPE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-desc">Description</Label>
            <Textarea id="r-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Engine oil and filter change, coolant top-up." rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="r-cost">Cost (KES)</Label>
              <Input id="r-cost" type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="3200" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-km">Mileage (km)</Label>
              <Input id="r-km" type="number" min={0} value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder="62000" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-garage">Garage reference (optional)</Label>
            <Input id="r-garage" value={garageRef} onChange={(e) => setGarageRef(e.target.value)} placeholder="e.g. the garage org id from a booking" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add record'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────── Add reminder dialog ───────────────────────────

function AddReminderDialog({
  vehicleId,
  vehicleLabel,
  onClose,
  onCreated,
}: {
  vehicleId: string | null
  vehicleLabel: string
  onClose: () => void
  onCreated: () => void
}) {
  const [type, setType] = useState('INSURANCE')
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [recurring, setRecurring] = useState(false)
  const [interval, setInterval] = useState('90')
  const [busy, setBusy] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!vehicleId) return
    if (!title.trim() || title.trim().length < 2) {
      toast.error('Give the reminder a short title.')
      return
    }
    if (!dueDate) {
      toast.error('Pick a due date.')
      return
    }
    setBusy(true)
    apiSend('/api/mygarage/reminders', 'POST', {
      myVehicleId: vehicleId,
      type,
      title: title.trim(),
      dueDate,
      intervalDays: recurring ? parseInt(interval, 10) : undefined,
    })
      .then(() => {
        toast.success('Reminder created — it will also appear in your Alerts tab.')
        setTitle(''); setDueDate(''); setRecurring(false)
        onClose()
        onCreated()
      })
      .catch((err: Error) => toast.error(err.message || 'Could not create reminder.'))
      .finally(() => setBusy(false))
  }

  return (
    <Dialog open={vehicleId !== null} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a reminder</DialogTitle>
          <DialogDescription>In-app only — you will see it here and in your Alerts tab.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger aria-label="Reminder type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(REMINDER_TYPE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-due">Due date *</Label>
              <Input id="m-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-title">Title *</Label>
            <Input id="m-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Comprehensive insurance renewal" required />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="m-recurring" checked={recurring} onCheckedChange={(c) => setRecurring(c === true)} />
            <Label htmlFor="m-recurring" className="text-sm font-normal">Repeats automatically when marked done</Label>
          </div>
          {recurring ? (
            <div className="space-y-1.5">
              <Label>Interval</Label>
              <Select value={interval} onValueChange={setInterval}>
                <SelectTrigger aria-label="Repeat interval"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERVAL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create reminder'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────── Delete vehicle dialog ───────────────────────────

function DeleteVehicleDialog({
  vehicleId,
  vehicleLabel,
  onClose,
  onDeleted,
}: {
  vehicleId: string | null
  vehicleLabel: string
  onClose: () => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)

  function doDelete() {
    if (!vehicleId) return
    setBusy(true)
    apiSend('/api/mygarage/vehicles/' + vehicleId, 'DELETE')
      .then(() => {
        toast.success(`${vehicleLabel} removed from your garage.`)
        onDeleted()
      })
      .catch((e: Error) => {
        toast.error(e.message || 'Could not delete vehicle.')
        setBusy(false)
      })
  }

  return (
    <AlertDialog open={vehicleId !== null} onOpenChange={(o) => (!o ? onClose() : null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {vehicleLabel || 'this vehicle'}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the vehicle along with all of its service records and reminders. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep vehicle</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              doDelete()
            }}
            disabled={busy}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {busy ? 'Removing…' : 'Delete permanently'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
