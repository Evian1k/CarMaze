'use client'

/* SupplierOS: Warehouses tab: branches & warehouses the business ships from.
 * Create, edit, set-primary and soft-close via /api/supply/branches. Delivery
 * areas power quote-request routing: copy in the UI says so honestly. */

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Building2, Loader2, MapPin, Package, Pencil, Phone, Plus, Star, Trash2, UserRound, Warehouse as WarehouseIcon,
} from 'lucide-react'
import { apiSend } from '@/lib/client'
import { KENYA_COUNTIES } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import {
  type BranchItem, type FetchState,
  supplierRoleCan, LoadingBlock, ModuleNotice, EmptyState, errMessage,
} from './shared'

type Props = {
  orgId: string
  role: string
  branches: FetchState<{ branches: BranchItem[] }>
}

type BranchForm = {
  name: string
  code: string
  kind: 'BRANCH' | 'WAREHOUSE'
  county: string
  town: string
  address: string
  lat: string
  lng: string
  phone: string
  managerName: string
  deliveryAreas: string
}

const EMPTY_FORM: BranchForm = {
  name: '', code: '', kind: 'WAREHOUSE', county: '', town: '', address: '', lat: '', lng: '',
  phone: '', managerName: '', deliveryAreas: '',
}

function formFromBranch(b: BranchItem): BranchForm {
  return {
    name: b.name,
    code: b.code,
    kind: b.kind,
    county: b.county,
    town: b.town ?? '',
    address: b.address ?? '',
    lat: b.lat !== null ? String(b.lat) : '',
    lng: b.lng !== null ? String(b.lng) : '',
    phone: b.phone ?? '',
    managerName: b.managerName ?? '',
    deliveryAreas: b.deliveryAreas.join(', '),
  }
}

export function WarehousesTab({ orgId, role, branches }: Props) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<BranchItem | null>(null)
  const [closing, setClosing] = useState<BranchItem | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const canWrite = supplierRoleCan(role, 'catalogue.write') // OWNER/GM/OPERATIONS create branches (server checks the same)

  async function setPrimary(b: BranchItem) {
    setBusyId(b.id)
    try {
      await apiSend(`/api/supply/branches/${b.id}`, 'PATCH', { isPrimary: true })
      toast.success(`${b.name} is now the primary location.`)
      branches.reload()
    } catch (e) {
      toast.error(await errMessage(e, 'Could not update the location.'))
    } finally {
      setBusyId(null)
    }
  }

  async function toggleStatus(b: BranchItem) {
    setBusyId(b.id)
    try {
      await apiSend(`/api/supply/branches/${b.id}`, 'PATCH', { status: b.status === 'ACTIVE' ? 'CLOSED' : 'ACTIVE' })
      toast.success(b.status === 'ACTIVE' ? `${b.name} closed. Historical orders keep their records.` : `${b.name} re-opened.`)
      branches.reload()
    } catch (e) {
      toast.error(await errMessage(e, 'Could not update the location.'))
    } finally {
      setBusyId(null)
    }
  }

  const list = branches.data?.branches ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Warehouses & branches</h2>
          <p className="text-sm text-muted-foreground">
            Stock locations for fulfilment. Delivery areas determine which Request-a-Part quote requests reach you.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={!canWrite} title={canWrite ? 'Add a location' : 'Only the owner or general manager can create locations'} className="min-h-11">
          <Plus className="h-4 w-4" /> New location
        </Button>
      </div>

      {branches.loading ? (
        <LoadingBlock label="Loading locations…" />
      ) : branches.error ? (
        <ModuleNotice title="Locations could not load" detail={branches.error.message} retry={branches.reload} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<WarehouseIcon className="h-8 w-8" />}
          title="No warehouses yet"
          detail="Add at least one warehouse so garages know where collection happens and stock can be tracked per location."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((b) => (
            <Card key={b.id} className={cn('py-4', b.status !== 'ACTIVE' && 'opacity-70')}>
              <CardContent className="px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {b.kind === 'WAREHOUSE' ? <WarehouseIcon className="h-4.5 w-4.5" /> : <Building2 className="h-4.5 w-4.5" />}
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                        <span className="truncate">{b.name}</span>
                        {b.isPrimary && (
                          <Badge variant="secondary" className="gap-1 border-transparent bg-primary/10 px-1 py-0 text-[10px] text-primary">
                            <Star className="h-3 w-3" /> Primary
                          </Badge>
                        )}
                        {b.status !== 'ACTIVE' && (
                          <Badge variant="secondary" className="border-transparent bg-muted px-1 py-0 text-[10px] text-muted-foreground">Closed</Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{b.code}</span> · {b.kind === 'WAREHOUSE' ? 'Warehouse' : 'Branch'} · {b.town ? `${b.town}, ` : ''}{b.county}
                      </p>
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Edit ${b.name}`} onClick={() => setEditing(b)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" aria-label={`Close ${b.name}`} onClick={() => setClosing(b)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>

                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {b.address && <p className="flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" /> {b.address}</p>}
                  {b.phone && <p className="flex items-center gap-1"><Phone className="h-3 w-3 shrink-0" /> {b.phone}</p>}
                  {b.managerName && <p className="flex items-center gap-1"><UserRound className="h-3 w-3 shrink-0" /> Manager: {b.managerName}</p>}
                  {b.lat != null && b.lng != null && <p className="font-mono text-[10px]">{b.lat.toFixed(4)}, {b.lng.toFixed(4)}</p>}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {b.deliveryAreas.length > 0 ? (
                    b.deliveryAreas.map((a) => (
                      <Badge key={a} variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">{a}</Badge>
                    ))
                  ) : (
                    <span className="text-[11px] text-muted-foreground">No delivery areas set: quote-request routing may skip this location.</span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Package className="h-3 w-3" /> {b._count?.productStocks ?? 0} stocked product{(b._count?.productStocks ?? 0) === 1 ? '' : 's'}</span>
                  {canWrite && !b.isPrimary && b.status === 'ACTIVE' && (
                    <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busyId === b.id} onClick={() => setPrimary(b)}>
                      <Star className="h-3 w-3" /> Make primary
                    </Button>
                  )}
                  {canWrite && (
                    <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busyId === b.id} onClick={() => toggleStatus(b)}>
                      {b.status === 'ACTIVE' ? 'Close location' : 'Re-open'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <BranchDialog
          orgId={orgId}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            branches.reload()
          }}
        />
      )}
      {editing && (
        <BranchDialog
          orgId={orgId}
          branch={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            branches.reload()
          }}
        />
      )}

      <AlertDialog open={Boolean(closing)} onOpenChange={(o) => { if (!o) setClosing(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close {closing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Locations are never hard-deleted: closing removes them from new fulfilment, collections and quote routing,
              while historical orders keep their records. You can re-open it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it open</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!closing) return
                const b = closing
                setClosing(null)
                setBusyId(b.id)
                try {
                  await apiSend(`/api/supply/branches/${b.id}`, 'DELETE')
                  toast.success(`${b.name} closed.`)
                  branches.reload()
                } catch (e) {
                  toast.error(await errMessage(e, 'Could not close the location.'))
                } finally {
                  setBusyId(null)
                }
              }}
            >
              Close location
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ───────────────────────────── Branch create/edit dialog ─────────────────────────────

function BranchDialog({ orgId, branch, onClose, onSaved }: {
  orgId: string
  branch?: BranchItem
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = Boolean(branch)
  const [form, setForm] = useState<BranchForm>(() => (branch ? formFromBranch(branch) : EMPTY_FORM))
  const [saving, setSaving] = useState(false)

  const set = (k: keyof BranchForm, v: string) => setForm((f) => ({ ...f, [k]: v }))

  function validate(): string | null {
    if (form.name.trim().length < 2) return 'Enter the location name (at least 2 characters).'
    if (form.code.trim().length < 1 || form.code.trim().length > 12) return 'Code must be 1–12 characters (letters/numbers).'
    if (!form.county || form.county.length < 2) return 'Select the county.'
    if (form.lat.trim()) {
      const lat = Number(form.lat)
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Latitude must be between -90 and 90.'
    }
    if (form.lng.trim()) {
      const lng = Number(form.lng)
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'Longitude must be between -180 and 180.'
    }
    const areas = form.deliveryAreas.split(',').map((x) => x.trim()).filter(Boolean)
    if (areas.length > 20) return 'At most 20 delivery areas.'
    return null
  }

  async function save() {
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        kind: form.kind,
        county: form.county,
        town: form.town.trim() || null,
        address: form.address.trim() || null,
        lat: form.lat.trim() ? Number(form.lat) : null,
        lng: form.lng.trim() ? Number(form.lng) : null,
        phone: form.phone.trim() || null,
        managerName: form.managerName.trim() || null,
        deliveryAreas: form.deliveryAreas.split(',').map((x) => x.trim()).filter(Boolean),
      }
      if (isEdit) {
        await apiSend(`/api/supply/branches/${branch!.id}`, 'PATCH', payload)
        toast.success('Location updated.')
      } else {
        await apiSend('/api/supply/branches', 'POST', { orgId, ...payload })
        toast.success('Location created. Stock can now be tracked here.')
      }
      onSaved()
    } catch (e) {
      toast.error(await errMessage(e, 'Could not save the location.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scrollbar-thin sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${branch?.name}` : 'New warehouse / branch'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the location details. Stock records and historical orders are unaffected.'
              : 'The first location you create automatically becomes the primary one.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bf-name">Name *</Label>
            <Input id="bf-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Sifa HQ Warehouse" maxLength={80} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bf-code">Code * (short, unique)</Label>
            <Input id="bf-code" value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="e.g. SIFA-WH1" maxLength={12} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bf-kind">Kind</Label>
            <Select value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v as BranchForm['kind'] }))}>
              <SelectTrigger id="bf-kind" aria-label="Kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="WAREHOUSE">Warehouse</SelectItem>
                <SelectItem value="BRANCH">Branch</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bf-county">County *</Label>
            <Select value={form.county || undefined} onValueChange={(v) => set('county', v)}>
              <SelectTrigger id="bf-county" aria-label="County"><SelectValue placeholder="Select county" /></SelectTrigger>
              <SelectContent>
                {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bf-town">Town / area</Label>
            <Input id="bf-town" value={form.town} onChange={(e) => set('town', e.target.value)} placeholder="e.g. Industrial Area" maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bf-address">Address</Label>
            <Input id="bf-address" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Street, building" maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bf-lat">Latitude</Label>
              <Input id="bf-lat" inputMode="decimal" value={form.lat} onChange={(e) => set('lat', e.target.value)} placeholder="-1.2977" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bf-lng">Longitude</Label>
              <Input id="bf-lng" inputMode="decimal" value={form.lng} onChange={(e) => set('lng', e.target.value)} placeholder="36.8328" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bf-phone">Phone</Label>
            <Input id="bf-phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+254 7xx xxx xxx" maxLength={20} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bf-manager">Manager name</Label>
            <Input id="bf-manager" value={form.managerName} onChange={(e) => set('managerName', e.target.value)} placeholder="e.g. Alice Wanjiru" maxLength={80} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="bf-areas">Delivery areas (comma separated counties)</Label>
            <Input id="bf-areas" value={form.deliveryAreas} onChange={(e) => set('deliveryAreas', e.target.value)} placeholder="e.g. Nairobi, Kiambu, Machakos" />
            <p className="text-xs text-muted-foreground">
              Quote requests from garages in these counties are routed to your business. Empty areas means platform-wide routing.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="min-h-11">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {isEdit ? 'Save changes' : 'Create location'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
