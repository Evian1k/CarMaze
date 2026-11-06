'use client'

/* SupplierOS: Inventory tab: stock levels per warehouse. Rows are grouped by
 * branch, low-stock rows (at/below reorder level) are highlighted, and a
 * restock dialog sets qty-on-hand + reorder level with a movement note.
 * qtyReserved is shown with an honest explanation: it is held for open orders
 * and prevents overselling: it is never editable here (reservations belong
 * to live orders). */

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Boxes, Loader2, PackageSearch, Warehouse as WarehouseIcon } from 'lucide-react'
import { apiSend } from '@/lib/client'
import { money } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  type InventoryRow, type FetchState,
  useFetch, supplierRoleCan, LoadingBlock, ModuleNotice, EmptyState, errMessage,
} from './shared'

type Props = {
  orgId: string
  role: string
}

export function InventoryTab({ orgId, role }: Props) {
  const inventory = useFetch<{ inventory: InventoryRow[] }>(`/api/supply/inventory?orgId=${orgId}`)
  const [restockFor, setRestockFor] = useState<InventoryRow | null>(null)

  const canWrite = supplierRoleCan(role, 'stock.write')
  const rows = inventory.data?.inventory ?? []

  const grouped = useMemo(() => {
    const map = new Map<string, InventoryRow[]>()
    for (const r of rows) {
      const list = map.get(r.branchName) ?? []
      list.push(r)
      map.set(r.branchName, list)
    }
    return [...map.entries()]
  }, [rows])

  const lowCount = rows.filter((r) => r.low).length
  const reservedUnits = rows.reduce((s, r) => s + r.qtyReserved, 0)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Inventory</h2>
        <p className="text-sm text-muted-foreground">
          {rows.length} stock record{rows.length === 1 ? '' : 's'} across {grouped.length} location{grouped.length === 1 ? '' : 's'}
          {lowCount > 0 ? ` · ${lowCount} at or below reorder level` : ''}
        </p>
      </div>

      <Alert>
        <Boxes className="h-4 w-4" />
        <AlertTitle>Reserved stock protects open orders</AlertTitle>
        <AlertDescription>
          <strong>{reservedUnits}</strong> unit{reservedUnits === 1 ? '' : 's'} are currently held for open purchase orders.
          Reserved quantities are managed by the order workflow; restocking never touches them, so you can never oversell
          committed stock.
        </AlertDescription>
      </Alert>

      {inventory.loading ? (
        <LoadingBlock label="Loading inventory…" />
      ) : inventory.error ? (
        <ModuleNotice title="Inventory could not load" detail={inventory.error.message} retry={inventory.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<PackageSearch className="h-8 w-8" />}
          title="No stock records yet"
          detail="Stock rows appear here once products are stocked at your warehouses. Use the restock action after your first delivery, or stock products when editing the catalogue."
        />
      ) : (
        <div className="space-y-4">
          {grouped.map(([branchName, branchRows]) => {
            const lowHere = branchRows.filter((r) => r.low).length
            return (
              <Card key={branchName}>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <div className="flex items-center gap-2">
                    <WarehouseIcon className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">{branchName}</CardTitle>
                    <Badge variant="outline" className="text-[10px]">{branchRows[0].branchKind}</Badge>
                  </div>
                  {lowHere > 0 && (
                    <Badge variant="secondary" className="gap-1 border-transparent bg-destructive/10 text-destructive">
                      <AlertTriangle className="h-3 w-3" /> {lowHere} low
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="px-0 pb-2">
                  <div className="overflow-x-auto scrollbar-thin">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-y border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-2 font-medium">Product</th>
                          <th className="px-3 py-2 text-right font-medium">On hand</th>
                          <th className="px-3 py-2 text-right font-medium">Reserved</th>
                          <th className="px-3 py-2 text-right font-medium">Available</th>
                          <th className="px-3 py-2 text-right font-medium">Reorder at</th>
                          <th className="px-3 py-2 text-right font-medium pr-4">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branchRows.map((r) => (
                          <tr key={r.id} className={cn('border-b border-border last:border-0', r.low && 'bg-destructive/5')}>
                            <td className="max-w-64 px-4 py-2">
                              <p className="truncate font-medium">{r.productName}</p>
                              <p className="font-mono text-[11px] text-muted-foreground">{r.sku} · {money(r.unitPriceMinor)}</p>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.qtyOnHand}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.qtyReserved}</td>
                            <td className={cn('px-3 py-2 text-right font-semibold tabular-nums', r.low ? 'text-destructive' : 'text-primary')}>
                              {r.available}
                              {r.low && <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" aria-label="Low stock" />}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.reorderLevel}</td>
                            <td className="px-3 py-2 pr-4 text-right">
                              <Button size="sm" variant="outline" className="h-8" disabled={!canWrite}
                                title={canWrite ? 'Restock / adjust' : `Your role (${role}) cannot write stock`}
                                onClick={() => setRestockFor(r)}>
                                Restock
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {restockFor && (
        <RestockDialog
          row={restockFor}
          orgId={orgId}
          onClose={() => setRestockFor(null)}
          onSaved={() => {
            setRestockFor(null)
            inventory.reload()
          }}
        />
      )}
    </div>
  )
}

function RestockDialog({ row, orgId, onClose, onSaved }: {
  row: InventoryRow
  orgId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [qty, setQty] = useState(String(row.qtyOnHand))
  const [reorder, setReorder] = useState(String(row.reorderLevel))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    const q = Number(qty)
    const rl = Number(reorder)
    if (!Number.isInteger(q) || q < 0) {
      toast.error('Quantity on hand must be a whole number of 0 or more.')
      return
    }
    if (!Number.isInteger(rl) || rl < 0) {
      toast.error('Reorder level must be a whole number of 0 or more.')
      return
    }
    setSaving(true)
    try {
      await apiSend('/api/supply/inventory', 'POST', {
        orgId,
        productId: row.productId,
        branchId: row.branchId,
        setQtyOnHand: q,
        reorderLevel: rl,
        note: note.trim() || undefined,
      })
      toast.success(`${row.productName} updated at ${row.branchName}.`)
      onSaved()
    } catch (e) {
      toast.error(await errMessage(e, 'Could not update stock.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Restock: {row.productName}</DialogTitle>
          <DialogDescription>
            {row.branchName} · <span className="font-mono">{row.sku}</span>. This sets the absolute quantity on hand:
            every change is written to the stock movement log. Reserved units ({row.qtyReserved}) stay untouched.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rs-qty">Quantity on hand *</Label>
              <Input id="rs-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rs-reorder">Reorder level</Label>
              <Input id="rs-reorder" inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value.replace(/[^\d]/g, ''))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rs-note">Movement note</Label>
            <Textarea id="rs-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
              placeholder="e.g. Delivery from Denso EA: invoice #4821" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="min-h-11">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />} Save stock level
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
