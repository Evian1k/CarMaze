'use client'

/* Multi-branch panels for GarageOS / DealerOS.
 *
 * BranchManager  : branches & warehouses of the business — create, edit,
 *                  operating hours, delivery areas, close. Owner/GM only
 *                  (enforced server-side, noted in the UI).
 * TransfersPanel : inter-branch vehicle transfers (showrooms). A vehicle has
 *                  ONE authoritative inventory record; transfers move it with
 *                  a full custody history (request → approve → dispatch with
 *                  condition report → receive → inventory moves).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Building2, CalendarClock, CarFront, CircleAlert, GitBranch, MapPin, Package,
  Pencil, PhoneCall, Plus, RefreshCw, Star, Truck, UserRound, Warehouse, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { apiGet, apiSend, apiUpload } from '@/lib/client'
import { KENYA_COUNTIES, dateLabel, timeAgo, vehicleTitle } from '@/lib/format'
import { cn } from '@/lib/utils'

// ───────────────────────────── types ─────────────────────────────

type Hours = Record<string, [string, string] | null>
type Branch = {
  id: string; orgId: string; name: string; code: string; kind: 'BRANCH' | 'WAREHOUSE' | string
  isPrimary: boolean; address: string | null; county: string; town: string | null
  lat: number | null; lng: number | null; phone: string | null; managerName: string | null
  operatingHours: Hours | null; deliveryAreas: string[]
  status: 'ACTIVE' | 'CLOSED' | string
  _count: { productStocks: number; vehicles: number }
}
type TransferEvent = { id: string; type: string; actorName: string; note: string | null; createdAt: string }
type ConditionReport = { odometerKm?: number | null; notes?: string | null; photos?: string[]; by?: string } | null
type Transfer = {
  id: string; refCode: string; status: 'REQUESTED' | 'APPROVED' | 'DISPATCHED' | 'RECEIVED' | 'CANCELLED' | 'REJECTED' | string
  vehicle: { id: string; refCode: string; make: string; model: string; year: number; status: string; branchId: string | null }
  fromBranch: { id: string; name: string; code: string; town: string | null }
  toBranch: { id: string; name: string; code: string; town: string | null }
  conditionOut: ConditionReport
  conditionIn: ConditionReport
  dispatchRef: string | null
  receivedByName: string | null
  dispatchedAt: string | null
  receivedAt: string | null
  events: TransferEvent[]
  createdAt: string
}
type VehicleRow = {
  id: string; refCode: string; make: string; model: string; year: number
  status: string; priceMinor?: number
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DAY_LABEL: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }

const TRANSFER_BADGE: Record<string, string> = {
  REQUESTED: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  APPROVED: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  DISPATCHED: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  RECEIVED: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-300',
  REJECTED: 'border-border bg-muted text-muted-foreground',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
}

// ═══════════════════════════ BranchManager ═══════════════════════════

export function BranchManager({ orgId, orgType }: { orgId: string; orgType: string }) {
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Branch | null>(null)
  const [closeTarget, setCloseTarget] = useState<Branch | null>(null)

  const load = useCallback(() => {
    apiGet<{ branches: Branch[] }>(`/api/supply/branches?orgId=${orgId}`)
      .then((d) => { setBranches(d.branches); setError(null) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load branches'))
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function doClose(branch: Branch) {
    try {
      await apiSend(`/api/supply/branches/${branch.id}`, 'DELETE')
      toast.success(`${branch.name} closed — historical records are preserved`)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not close the branch')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">
            {orgType === 'DEALER' ? 'Showroom branches' : orgType === 'GARAGE' ? 'Workshop branches' : 'Branches & warehouses'}
          </h3>
          <p className="text-sm text-muted-foreground">Creating, editing and closing branches requires the owner or general manager.</p>
        </div>
        <Button className="min-h-11" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New branch</Button>
      </div>

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <CircleAlert className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Could not load branches</p>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" className="min-h-11" onClick={() => { setBranches(null); load() }}><RefreshCw className="h-4 w-4" /> Try again</Button>
          </CardContent>
        </Card>
      ) : !branches ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
        </div>
      ) : branches.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 font-medium">No branches yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Add your first location — it becomes the primary branch and anchors inventory, transfers
            and delivery coverage.
          </p>
          <Button variant="outline" className="mt-4 min-h-11" onClick={() => setCreateOpen(true)}>Create the first branch</Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {branches.map((b) => (
            <BranchCard key={b.id} branch={b} onEdit={() => setEditTarget(b)} onClose={() => setCloseTarget(b)} />
          ))}
        </div>
      )}

      {createOpen && (
        <BranchFormDialog
          orgId={orgId}
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); load() }}
        />
      )}
      {editTarget && (
        <BranchFormDialog
          orgId={orgId}
          branch={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load() }}
        />
      )}
      <AlertDialog open={closeTarget !== null} onOpenChange={(o) => { if (!o) setCloseTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close {closeTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The branch stops appearing as an active location. It is never hard-deleted — historical
              stock movements, transfers and orders keep their records. Make another branch primary
              first if this one is primary.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep branch</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async (e) => { e.preventDefault(); if (closeTarget) await doClose(closeTarget); setCloseTarget(null) }}
            >
              Close branch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function BranchCard({ branch: b, onEdit, onClose }: { branch: Branch; onEdit: () => void; onClose: () => void }) {
  const closed = b.status !== 'ACTIVE'
  return (
    <Card className={cn('flex h-full flex-col', closed && 'opacity-70')}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {b.kind === 'WAREHOUSE' ? <Warehouse className="h-5 w-5 text-primary" /> : <Building2 className="h-5 w-5 text-primary" />}
            {b.name}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            {b.isPrimary && (
              <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300">
                <Star className="h-3 w-3" /> Primary
              </Badge>
            )}
            <Badge variant="secondary">{b.kind}</Badge>
            {closed && <Badge variant="outline" className="border-border bg-muted text-muted-foreground">Closed</Badge>}
          </div>
        </div>
        <CardDescription>
          {b.code} · {[b.town, b.county].filter(Boolean).join(', ')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2.5 text-sm">
        {b.address && <p className="flex items-start gap-1.5 text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {b.address}</p>}
        {b.managerName && <p className="flex items-center gap-1.5 text-muted-foreground"><UserRound className="h-4 w-4 shrink-0" /> {b.managerName}</p>}
        {b.phone && (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <PhoneCall className="h-4 w-4 shrink-0" /> {b.phone}
          </p>
        )}

        {b.operatingHours && Object.values(b.operatingHours).some(Boolean) && <HoursSummary hours={b.operatingHours} />}

        {b.deliveryAreas.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {b.deliveryAreas.map((a, i) => (
              <Badge key={i} variant="outline" className="text-[11px] font-normal">{a}</Badge>
            ))}
          </div>
        )}

        <p className="mt-auto flex items-center gap-3 pt-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><CarFront className="h-3.5 w-3.5" />{b._count.vehicles} vehicles</span>
          <span className="inline-flex items-center gap-1"><Package className="h-3.5 w-3.5" />{b._count.productStocks} parts stocked</span>
        </p>

        {!closed && (
          <div className="flex justify-end gap-1.5 border-t pt-2.5">
            <Button variant="outline" size="sm" className="min-h-11" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button variant="ghost" size="sm" className="min-h-11 text-muted-foreground hover:text-destructive" onClick={onClose}>
              Close branch
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function HoursSummary({ hours }: { hours: Hours }) {
  const open = DAYS.filter((d) => hours[d])
  return (
    <Collapsible>
      <CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <CalendarClock className="h-4 w-4" /> Opening hours
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1.5 space-y-0.5 rounded-md border bg-muted/40 p-2 text-xs">
          {DAYS.map((d) => {
            const h = hours[d]
            return (
              <li key={d} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{DAY_LABEL[d]}</span>
                <span>{h ? `${h[0]}–${h[1]}` : 'closed'}</span>
              </li>
            )
          })}
          {open.length === 0 && <li className="text-muted-foreground">No hours published</li>}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ───────────────────────── branch form dialog ─────────────────────────

type BranchForm = {
  name: string; code: string; kind: 'BRANCH' | 'WAREHOUSE'
  county: string; town: string; address: string
  lat: string; lng: string; phone: string; managerName: string
  hours: Record<string, { open: string; close: string }>
  deliveryAreas: string
  status: 'ACTIVE' | 'CLOSED'
  isPrimary: boolean
}

function emptyHours(): BranchForm['hours'] {
  return Object.fromEntries(DAYS.map((d) => [d, { open: '', close: '' }]))
}

function BranchFormDialog({ orgId, branch, onClose, onSaved }: {
  orgId: string
  branch?: Branch
  onClose: () => void
  onSaved: () => void
}) {
  const editing = Boolean(branch)
  const [form, setForm] = useState<BranchForm>({
    name: branch?.name ?? '',
    code: branch?.code ?? '',
    kind: (branch?.kind as 'BRANCH' | 'WAREHOUSE') ?? 'BRANCH',
    county: branch?.county ?? 'Nairobi',
    town: branch?.town ?? '',
    address: branch?.address ?? '',
    lat: branch?.lat != null ? String(branch.lat) : '',
    lng: branch?.lng != null ? String(branch.lng) : '',
    phone: branch?.phone ?? '',
    managerName: branch?.managerName ?? '',
    hours: (() => {
      const h = emptyHours()
      if (branch?.operatingHours) {
        for (const d of DAYS) {
          const v = branch.operatingHours[d]
          if (v) h[d] = { open: v[0], close: v[1] }
        }
      }
      return h
    })(),
    deliveryAreas: branch?.deliveryAreas.join(', ') ?? '',
    status: (branch?.status as 'ACTIVE' | 'CLOSED') ?? 'ACTIVE',
    isPrimary: branch?.isPrimary ?? false,
  })
  const [busy, setBusy] = useState(false)

  const latNum = form.lat.trim() === '' ? null : Number(form.lat)
  const lngNum = form.lng.trim() === '' ? null : Number(form.lng)
  const valid =
    form.name.trim().length >= 2 &&
    (editing || form.code.trim().length >= 1) &&
    form.county.trim().length >= 2 &&
    (latNum === null || Number.isFinite(latNum)) &&
    (lngNum === null || Number.isFinite(lngNum))

  function buildOperatingHours(): Hours | undefined {
    const out: Hours = {}
    let any = false
    for (const d of DAYS) {
      const { open, close } = form.hours[d]
      if (open.trim() && close.trim()) { out[d] = [open.trim(), close.trim()]; any = true }
      else out[d] = null
    }
    return any ? out : undefined
  }

  async function save() {
    setBusy(true)
    try {
      const hours = buildOperatingHours()
      const areas = form.deliveryAreas.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20)
      if (editing && branch) {
        await apiSend(`/api/supply/branches/${branch.id}`, 'PATCH', {
          name: form.name.trim(),
          kind: form.kind,
          county: form.county.trim(),
          town: form.town.trim() || null,
          address: form.address.trim() || null,
          lat: form.lat.trim() === '' ? null : Number(form.lat),
          lng: form.lng.trim() === '' ? null : Number(form.lng),
          phone: form.phone.trim() || null,
          managerName: form.managerName.trim() || null,
          operatingHours: hours ?? null,
          deliveryAreas: areas.length > 0 ? areas : null,
          status: form.status,
          isPrimary: form.isPrimary,
        })
        toast.success(`${form.name.trim()} updated`)
      } else {
        await apiSend('/api/supply/branches', 'POST', {
          orgId,
          name: form.name.trim(),
          code: form.code.trim().toUpperCase(),
          kind: form.kind,
          county: form.county.trim(),
          town: form.town.trim() || undefined,
          address: form.address.trim() || undefined,
          lat: form.lat.trim() === '' ? undefined : Number(form.lat),
          lng: form.lng.trim() === '' ? undefined : Number(form.lng),
          phone: form.phone.trim() || undefined,
          managerName: form.managerName.trim() || undefined,
          operatingHours: hours,
          deliveryAreas: areas.length > 0 ? areas : undefined,
        })
        toast.success(`${form.name.trim()} created`)
      }
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the branch')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${branch?.name}` : 'New branch or warehouse'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Changes apply immediately across inventory, transfers and delivery.'
              : 'The first branch of a business becomes its primary automatically.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="br-name">Name</Label>
              <Input id="br-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Nairobi CBD workshop" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="br-code">Code {!editing && <span className="text-muted-foreground">(short, unique)</span>}</Label>
              <Input
                id="br-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                disabled={editing}
                maxLength={12}
                placeholder="CBD"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as 'BRANCH' | 'WAREHOUSE' })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRANCH">Branch</SelectItem>
                  <SelectItem value="WAREHOUSE">Warehouse</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="br-county">County</Label>
              <Select value={form.county} onValueChange={(v) => setForm({ ...form, county: v })}>
                <SelectTrigger id="br-county" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="br-town">Town</Label>
              <Input id="br-town" value={form.town} onChange={(e) => setForm({ ...form, town: e.target.value })} placeholder="e.g. Westlands" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="br-address">Address</Label>
            <Input id="br-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street / building" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="br-phone">Phone</Label>
              <Input id="br-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="07xx xxx xxx" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="br-manager">Branch manager</Label>
              <Input id="br-manager" value={form.managerName} onChange={(e) => setForm({ ...form, managerName: e.target.value })} placeholder="Name" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="br-lat">Latitude (optional)</Label>
              <Input id="br-lat" inputMode="decimal" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="-1.286" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="br-lng">Longitude (optional)</Label>
              <Input id="br-lng" inputMode="decimal" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="36.817" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Operating hours (leave a day blank to mark it closed)</Label>
            <div className="space-y-1.5 rounded-lg border p-3">
              {DAYS.map((d) => (
                <div key={d} className="grid grid-cols-[5.5rem_1fr_1fr] items-center gap-2">
                  <span className="text-sm text-muted-foreground">{DAY_LABEL[d]}</span>
                  <Input
                    aria-label={`${DAY_LABEL[d]} opening time`}
                    value={form.hours[d].open}
                    onChange={(e) => setForm((f) => ({ ...f, hours: { ...f.hours, [d]: { ...f.hours[d], open: e.target.value } } }))}
                    placeholder="08:00"
                  />
                  <Input
                    aria-label={`${DAY_LABEL[d]} closing time`}
                    value={form.hours[d].close}
                    onChange={(e) => setForm((f) => ({ ...f, hours: { ...f.hours, [d]: { ...f.hours[d], close: e.target.value } } }))}
                    placeholder="18:00"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="br-areas">Delivery areas (comma-separated)</Label>
            <Input id="br-areas" value={form.deliveryAreas} onChange={(e) => setForm({ ...form, deliveryAreas: e.target.value })} placeholder="Nairobi, Kiambu, Machakos" />
          </div>

          {editing && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="br-primary">Primary branch</Label>
                  <p className="text-xs text-muted-foreground">The main location — making this primary unpicks it from the current primary.</p>
                </div>
                <Switch id="br-primary" checked={form.isPrimary} onCheckedChange={(v) => setForm({ ...form, isPrimary: v })} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="br-status">Status</Label>
                  <p className="text-xs text-muted-foreground">Closed branches keep history but stop accepting operations.</p>
                </div>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as 'ACTIVE' | 'CLOSED' })}>
                  <SelectTrigger id="br-status" className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="min-h-11" disabled={!valid || busy} onClick={save}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create branch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ═══════════════════════════ TransfersPanel ═══════════════════════════

export function TransfersPanel({ orgId, orgType }: { orgId: string; orgType: string }) {
  // Showroom feature only — render nothing for other org types.
  if (orgType !== 'DEALER') return null
  return <TransfersContent orgId={orgId} />
}

function TransfersContent({ orgId }: { orgId: string }) {
  const [transfers, setTransfers] = useState<Transfer[] | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [vehicles, setVehicles] = useState<VehicleRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requestOpen, setRequestOpen] = useState(false)
  const [dispatchTarget, setDispatchTarget] = useState<Transfer | null>(null)
  const [receiveTarget, setReceiveTarget] = useState<Transfer | null>(null)
  const [rejectTarget, setRejectTarget] = useState<Transfer | null>(null)

  const load = useCallback(() => {
    apiGet<{ transfers: Transfer[] }>(`/api/org/transfers?orgId=${orgId}`)
      .then((d) => { setTransfers(d.transfers); setError(null) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load transfers'))
    apiGet<{ branches: Branch[] }>(`/api/supply/branches?orgId=${orgId}`)
      .then((d) => setBranches(d.branches))
      .catch(() => setBranches([]))
    // Vehicle list: GET /api/vehicles?mine=1&orgId= returns the org's own
    // inventory (any status) for the signed-in dealer member.
    apiGet<{ vehicles: VehicleRow[] }>(`/api/vehicles?mine=1&orgId=${orgId}`)
      .then((d) => setVehicles(d.vehicles))
      .catch(() => setVehicles([]))
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function action(t: Transfer, body: Record<string, unknown>, successMsg: string) {
    try {
      await apiSend(`/api/org/transfers/${t.id}`, 'POST', body)
      toast.success(successMsg)
      load()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed')
      return false
    }
  }

  const requestableVehicles = (vehicles ?? []).filter((v) => !['SOLD', 'REJECTED'].includes(v.status))
  const activeBranches = branches.filter((b) => b.status === 'ACTIVE')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">Inter-branch transfers</h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            A vehicle has one authoritative inventory record; transfers move it with full custody
            history. Every step writes an immutable event.
          </p>
        </div>
        <Button className="min-h-11" onClick={() => setRequestOpen(true)} disabled={requestableVehicles.length === 0 || activeBranches.length < 2}>
          <Truck className="h-4 w-4" /> Request transfer
        </Button>
      </div>

      {requestableVehicles.length === 0 || activeBranches.length < 2 ? (
        <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {activeBranches.length < 2
            ? 'You need at least two active branches before a transfer can be requested.'
            : 'No transferable vehicles in your inventory.'}
        </div>
      ) : null}

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <CircleAlert className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Could not load transfers</p>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" className="min-h-11" onClick={() => { setTransfers(null); load() }}><RefreshCw className="h-4 w-4" /> Try again</Button>
          </CardContent>
        </Card>
      ) : !transfers ? (
        <Skeleton className="h-48 rounded-xl" aria-busy="true" />
      ) : transfers.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <GitBranch className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 font-medium">No transfers yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Move stock between branches with a documented chain of custody — request, authorise,
            dispatch with a condition report, and receive at the destination.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {transfers.map((t) => (
            <Card key={t.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <CarFront className="h-5 w-5 text-primary" aria-hidden />
                      {vehicleTitle(t.vehicle)}
                      <Badge variant="outline" className={cn(TRANSFER_BADGE[t.status] ?? TRANSFER_BADGE.CANCELLED)}>{t.status}</Badge>
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {t.refCode} · {t.fromBranch.name} ({t.fromBranch.code}) → {t.toBranch.name} ({t.toBranch.code})
                      {t.dispatchRef ? ` · dispatch ${t.dispatchRef}` : ''}
                    </CardDescription>
                  </div>
                  <span className="text-xs text-muted-foreground">{timeAgo(t.createdAt)}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {(t.conditionOut || t.conditionIn) && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {t.conditionOut && (
                      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Condition out</p>
                        <p className="mt-1">{t.conditionOut.odometerKm != null ? `${t.conditionOut.odometerKm.toLocaleString()} km` : 'odometer not recorded'}</p>
                        {t.conditionOut.notes && <p className="mt-0.5 text-muted-foreground">{t.conditionOut.notes}</p>}
                      </div>
                    )}
                    {t.conditionIn && (
                      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Condition in</p>
                        <p className="mt-1">{t.conditionIn.odometerKm != null ? `${t.conditionIn.odometerKm.toLocaleString()} km` : 'odometer not recorded'}</p>
                        {t.conditionIn.notes && <p className="mt-0.5 text-muted-foreground">{t.conditionIn.notes}</p>}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-2">
                  {t.status === 'REQUESTED' && (
                    <>
                      <Button size="sm" className="min-h-11" onClick={() => action(t, { action: 'approve' }, 'Transfer authorised — prepare dispatch')}>
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" className="min-h-11 text-muted-foreground hover:text-destructive" onClick={() => setRejectTarget(t)}>
                        Reject
                      </Button>
                      <Button size="sm" variant="ghost" className="min-h-11 text-muted-foreground" onClick={() => action(t, { action: 'cancel' }, 'Transfer cancelled')}>
                        Cancel
                      </Button>
                    </>
                  )}
                  {t.status === 'APPROVED' && (
                    <>
                      <Button size="sm" className="min-h-11" onClick={() => setDispatchTarget(t)}>
                        <Truck className="h-4 w-4" /> Record dispatch
                      </Button>
                      <Button size="sm" variant="ghost" className="min-h-11 text-muted-foreground hover:text-destructive" onClick={() => setRejectTarget(t)}>
                        Reject
                      </Button>
                      <Button size="sm" variant="ghost" className="min-h-11 text-muted-foreground" onClick={() => action(t, { action: 'cancel' }, 'Transfer cancelled')}>
                        Cancel
                      </Button>
                    </>
                  )}
                  {t.status === 'DISPATCHED' && (
                    <Button size="sm" className="min-h-11" onClick={() => setReceiveTarget(t)}>
                      <MapPin className="h-4 w-4" /> Record receipt
                    </Button>
                  )}
                </div>

                <Collapsible>
                  <CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    Custody timeline ({t.events.length}) <ChevronGlyph />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ol className="mt-2 space-y-2 border-l pl-4">
                      {t.events.map((ev) => (
                        <li key={ev.id} className="relative text-sm">
                          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" aria-hidden />
                          <p className="font-medium">
                            {ev.type} · {ev.actorName} <span className="font-normal text-muted-foreground">{dateLabel(ev.createdAt)}</span>
                          </p>
                          {ev.note && <p className="text-muted-foreground">{ev.note}</p>}
                        </li>
                      ))}
                    </ol>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {requestOpen && (
        <RequestTransferDialog
          vehicles={requestableVehicles}
          branches={activeBranches}
          onClose={() => setRequestOpen(false)}
          onSaved={() => { setRequestOpen(false); load() }}
          orgId={orgId}
        />
      )}

      {dispatchTarget && (
        <ConditionReportDialog
          mode="dispatch"
          transfer={dispatchTarget}
          onClose={() => setDispatchTarget(null)}
          onSubmit={async (payload) => {
            const done = await action(
              dispatchTarget,
              { action: 'dispatch', ...payload },
              'Dispatch recorded with condition report'
            )
            if (done) setDispatchTarget(null)
          }}
        />
      )}

      {receiveTarget && (
        <ConditionReportDialog
          mode="receive"
          transfer={receiveTarget}
          onClose={() => setReceiveTarget(null)}
          onSubmit={async (payload) => {
            const done = await action(
              receiveTarget,
              { action: 'receive', receivedByName: payload.receivedByName, ...payload },
              'Vehicle received — inventory record updated'
            )
            if (done) setReceiveTarget(null)
          }}
        />
      )}

      {rejectTarget && (
        <Dialog open onOpenChange={(o) => { if (!o) setRejectTarget(null) }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Reject transfer {rejectTarget.refCode}?</DialogTitle>
              <DialogDescription>The requesting branch is notified. Add a note for the record.</DialogDescription>
            </DialogHeader>
            <RejectForm
              onSubmit={async (note) => {
                const done = await action(rejectTarget, { action: 'reject', ...(note ? { note } : {}) }, 'Transfer rejected')
                if (done) setRejectTarget(null)
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function RejectForm({ onSubmit }: { onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="reject-note">Note (optional)</Label>
        <Textarea id="reject-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this transfer was rejected" />
      </div>
      <DialogFooter>
        <Button variant="destructive" className="min-h-11" disabled={busy} onClick={async () => { setBusy(true); try { await onSubmit(note.trim()) } finally { setBusy(false) } }}>
          {busy ? 'Working…' : 'Reject transfer'}
        </Button>
      </DialogFooter>
    </div>
  )
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

// ───────────────────────── request transfer dialog ─────────────────────────

function RequestTransferDialog({ orgId, vehicles, branches, onClose, onSaved }: {
  orgId: string
  vehicles: VehicleRow[]
  branches: Branch[]
  onClose: () => void
  onSaved: () => void
}) {
  const [vehicleId, setVehicleId] = useState('')
  const [toBranchId, setToBranchId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = vehicleId !== '' && toBranchId !== ''

  async function submit() {
    setBusy(true)
    try {
      await apiSend('/api/org/transfers', 'POST', {
        orgId, vehicleId, toBranchId, ...(note.trim() ? { note: note.trim() } : {}),
      })
      toast.success('Transfer requested — it requires authorisation before dispatch')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not request the transfer')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request a transfer</DialogTitle>
          <DialogDescription>
            The vehicle keeps one authoritative inventory record; the transfer moves it after
            authorisation, dispatch and receipt.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Vehicle</Label>
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose a vehicle" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.make} {v.model} {v.year} · {v.refCode} · {v.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Destination branch</Label>
            <Select value={toBranchId} onValueChange={setToBranchId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose destination" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name} ({b.code}){b.town ? ` · ${b.town}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transfer-note">Note (optional)</Label>
            <Input id="transfer-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for the move" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="min-h-11" disabled={!valid || busy} onClick={submit}>
            {busy ? 'Requesting…' : 'Request transfer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────── condition report dialog ─────────────────────────

function ConditionReportDialog({ mode, transfer, onClose, onSubmit }: {
  mode: 'dispatch' | 'receive'
  transfer: Transfer
  onClose: () => void
  onSubmit: (payload: {
    dispatchRef?: string; receivedByName?: string; odometerKm?: number
    conditionNotes?: string; photos?: string[]
  }) => Promise<void>
}) {
  const [dispatchRef, setDispatchRef] = useState('')
  const [receiverName, setReceiverName] = useState('')
  const [odometer, setOdometer] = useState('')
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const odometerKm = odometer.trim() === '' ? undefined : Number(odometer)
  const valid =
    (mode === 'receive' ? receiverName.trim().length >= 2 : true) &&
    (odometerKm === undefined || (Number.isFinite(odometerKm) && odometerKm >= 0))

  async function upload(files: FileList) {
    setUploading(true)
    try {
      for (const file of Array.from(files).slice(0, 6 - photos.length)) {
        const fd = new FormData()
        fd.append('file', file)
        const d = await apiUpload<{ url: string }>('/api/upload', fd)
        setPhotos((p) => (p.length >= 6 ? p : [...p, d.url]))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'dispatch' ? `Dispatch ${transfer.refCode}` : `Receive ${transfer.refCode}`}
          </DialogTitle>
          <DialogDescription>
            {mode === 'dispatch'
              ? `Condition report out — ${transfer.fromBranch.name} → ${transfer.toBranch.name}. Odometer and notes become part of the custody history.`
              : `Condition report in at ${transfer.toBranch.name}. On receipt the vehicle's inventory record moves to the destination branch.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {mode === 'dispatch' && (
            <div className="space-y-1.5">
              <Label htmlFor="cr-dispatch-ref">Dispatch reference (optional)</Label>
              <Input id="cr-dispatch-ref" value={dispatchRef} onChange={(e) => setDispatchRef(e.target.value)} placeholder={`Default: DSP-${transfer.refCode}`} />
            </div>
          )}
          {mode === 'receive' && (
            <div className="space-y-1.5">
              <Label htmlFor="cr-receiver">Received by (required)</Label>
              <Input id="cr-receiver" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder="Full name of the receiving staff" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="cr-odometer">Odometer (km, optional)</Label>
            <Input id="cr-odometer" inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="e.g. 84500" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-notes">Condition notes</Label>
            <Textarea id="cr-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Scratches, fuel level, missing accessories…" />
          </div>
          <div className="space-y-1.5">
            <Label>Photos ({photos.length}/6)</Label>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-accent"
              onChange={(e) => { if (e.target.files?.length) void upload(e.target.files) }}
              disabled={uploading || photos.length >= 6}
            />
            {uploading && <p className="text-xs text-muted-foreground">Uploading…</p>}
            {photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {photos.map((url) => (
                  <span key={url} className="relative">
                    <img src={url} alt="Condition photo" className="h-14 w-14 rounded-md border object-cover" />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 text-muted-foreground hover:text-destructive"
                      onClick={() => setPhotos((p) => p.filter((u) => u !== url))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="min-h-11"
            disabled={!valid || busy || uploading}
            onClick={async () => {
              setBusy(true)
              try {
                await onSubmit({
                  ...(mode === 'dispatch' && dispatchRef.trim() ? { dispatchRef: dispatchRef.trim() } : {}),
                  ...(mode === 'receive' ? { receivedByName: receiverName.trim() } : {}),
                  ...(odometerKm !== undefined ? { odometerKm } : {}),
                  ...(notes.trim() ? { conditionNotes: notes.trim() } : {}),
                  ...(photos.length > 0 ? { photos } : {}),
                })
              } finally { setBusy(false) }
            }}
          >
            {busy ? 'Recording…' : mode === 'dispatch' ? 'Record dispatch' : 'Record receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
