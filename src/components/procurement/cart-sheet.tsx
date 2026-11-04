'use client'

/* Procurement cart sheet + checkout.
 * Cart contents span multiple suppliers — checkout creates ONE purchase
 * order per supplier via POST /api/supply/orders (verified against the
 * route contract: { orgId, destinationBranchId, items[{productId,qty}], note }).
 * Items stay in the Zustand cart (localStorage-persisted) until the order
 * request succeeds. */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ShoppingCart, Trash2, PackageOpen, Truck, Building2 } from 'lucide-react'
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { apiGet, apiSend, ClientApiError } from '@/lib/client'
import { money } from '@/lib/format'
import { useCart, cartBySupplier, cartLineTotal, cartUnitPrice, type CartItem } from '@/stores/cart'
import {
  Img, QtyStepper, BtnSpinner, canOrder, type BranchRow,
} from './shared'

type CreatedOrder = { id: string; refCode: string; status: string; totalMinor: number }

export function CartSheet({ open, onOpenChange, orgId, role, onBrowse, onOrdered }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  orgId: string
  role: string
  onBrowse: () => void
  /** Called after a successful checkout (cart already cleared). */
  onOrdered?: (refs: string[]) => void
}) {
  const items = useCart((s) => s.items)
  const setQty = useCart((s) => s.setQty)
  const remove = useCart((s) => s.remove)
  const clear = useCart((s) => s.clear)

  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const total = items.reduce((s, i) => s + cartLineTotal(i), 0)
  const groups = [...cartBySupplier(items).entries()]
  const mayOrder = canOrder(role)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" aria-hidden="true" />
            Procurement cart
            {items.length > 0 && (
              <Badge variant="secondary" className="ml-1">{items.length} item{items.length === 1 ? '' : 's'}</Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            Items from {groups.length || 0} supplier{groups.length === 1 ? '' : 's'} — one purchase order is created per supplier at checkout.
          </SheetDescription>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <PackageOpen className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="text-sm font-semibold">Your cart is empty</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Add parts from the catalogue, fitment finder, stock alerts or quick reorder.
            </p>
            <Button variant="outline" onClick={() => { onOpenChange(false); onBrowse() }}>Browse catalogue</Button>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 scrollbar-thin">
              <div className="space-y-4 p-4">
                {groups.map(([supplierId, list]) => {
                  const sub = list.reduce((s, i) => s + cartLineTotal(i), 0)
                  return (
                    <div key={supplierId} className="rounded-lg border border-border bg-card">
                      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="truncate">{list[0]?.supplierName}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">Subtotal {money(sub)}</span>
                      </div>
                      <ul className="divide-y divide-border">
                        {list.map((item) => (
                          <CartLine
                            key={item.productId}
                            item={item}
                            onQty={(q) => setQty(item.productId, q)}
                            onRemove={() => remove(item.productId)}
                          />
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>

            <SheetFooter className="gap-3 border-t border-border p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Estimated total (products + tax at checkout)</span>
                <span className="font-bold tabular-nums">{money(total)}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={!mayOrder}
                  onClick={() => setCheckoutOpen(true)}
                >
                  <Truck className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Checkout
                </Button>
                <Button variant="outline" size="icon" onClick={() => clear()} aria-label="Clear cart">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {!mayOrder && (
                <p className="text-xs text-muted-foreground">
                  Your role ({role || '—'}) can browse but not place orders. Ask the owner, GM or procurement to check out.
                </p>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>

      {orgId && (
        <CheckoutDialog
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          orgId={orgId}
          mayOrder={mayOrder}
          onDone={(refs) => {
            setCheckoutOpen(false)
            onOpenChange(false)
            clear()
            onOrdered?.(refs)
          }}
        />
      )}
    </Sheet>
  )
}

function CartLine({ item, onQty, onRemove }: {
  item: CartItem
  onQty: (q: number) => void
  onRemove: () => void
}) {
  const max = item.availableQty && item.availableQty > 0 ? item.availableQty : undefined
  const unlockMore =
    item.wholesalePriceMinor && item.wholesaleMinQty && item.qty < item.wholesaleMinQty
      ? item.wholesaleMinQty - item.qty
      : 0
  return (
    <li className="flex gap-3 p-3">
      <Img src={item.image} alt={item.name} className="h-14 w-14 shrink-0 rounded-md border border-border" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={item.name}>{item.name}</p>
        <p className="text-xs text-muted-foreground">SKU {item.sku}</p>
        <p className="mt-0.5 text-xs tabular-nums">
          {money(cartUnitPrice(item))}
          <span className="text-muted-foreground"> /unit</span>
          {unlockMore > 0 && (
            <span className="ml-1 text-primary">
              · add {unlockMore} to unlock wholesale {money(item.wholesalePriceMinor!)}
            </span>
          )}
          {unlockMore === 0 && item.wholesalePriceMinor && item.wholesaleMinQty && item.qty >= item.wholesaleMinQty && (
            <Badge variant="secondary" className="ml-1.5 px-1 py-0 text-[10px]">Wholesale applied</Badge>
          )}
        </p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <QtyStepper value={item.qty} onChange={onQty} max={max} />
          <span className="text-sm font-semibold tabular-nums">{money(cartLineTotal(item))}</span>
        </div>
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label={`Remove ${item.name}`}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  )
}

// ─────────────────────────── Checkout ───────────────────────────

function CheckoutDialog({ open, onOpenChange, orgId, mayOrder, onDone }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  orgId: string
  mayOrder: boolean
  onDone: (refs: string[]) => void
}) {
  const items = useCart((s) => s.items)
  const [branches, setBranches] = useState<BranchRow[] | null>(null)
  const [branchId, setBranchId] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const groups = [...cartBySupplier(items).entries()]
  const total = items.reduce((s, i) => s + cartLineTotal(i), 0)

  const loadBranches = useCallback(() => {
    let stale = false
    apiGet<{ branches: BranchRow[] }>(`/api/supply/branches?orgId=${encodeURIComponent(orgId)}`)
      .then((d) => {
        if (stale) return
        const active = d.branches.filter((b) => b.status === 'ACTIVE')
        setBranches(active)
        setBranchId((prev) => prev || active.find((b) => b.isPrimary)?.id || active[0]?.id || '')
      })
      .catch((e: unknown) => {
        if (stale) return
        setBranches([])
        toast.error(e instanceof ClientApiError ? e.message : 'Could not load your branches.')
      })
    return () => { stale = true }
  }, [orgId])

  useEffect(() => {
    if (!open) return
    const cancel = loadBranches()
    return cancel
  }, [open, loadBranches])

  async function submit() {
    if (!branchId) {
      toast.error('Choose the destination branch for the delivery.')
      return
    }
    setSubmitting(true)
    try {
      const res = await apiSend<{ orders: CreatedOrder[]; message: string }>('/api/supply/orders', 'POST', {
        orgId,
        destinationBranchId: branchId,
        items: items.map((i) => ({ productId: i.productId, qty: i.qty })),
        note: note.trim() || undefined,
      })
      toast.success(res.message || 'Purchase order(s) created.', {
        description: res.orders.map((o) => o.refCode).join(' · '),
      })
      onDone(res.orders.map((o) => o.refCode))
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Checkout failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm purchase order</DialogTitle>
          <DialogDescription>
            {groups.length} purchase order{groups.length === 1 ? '' : 's'} will be sent to {groups.length === 1 ? 'its supplier' : 'their suppliers'} — stock is reserved immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card/50 p-3 text-sm">
            {groups.map(([supplierId, list]) => (
              <div key={supplierId} className="flex items-center justify-between gap-2 py-0.5">
                <span className="truncate text-muted-foreground">{list[0]?.supplierName} · {list.length} line{list.length === 1 ? '' : 's'}</span>
                <span className="shrink-0 tabular-nums">{money(list.reduce((s, i) => s + cartLineTotal(i), 0))}</span>
              </div>
            ))}
            <Separator className="my-2" />
            <div className="flex items-center justify-between font-semibold">
              <span>Products + applicable tax</span>
              <span className="tabular-nums">{money(total)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Delivery fee is agreed when the supplier arranges transport — totals update on the order.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dest-branch">Deliver to branch *</Label>
            {branches === null ? (
              <Skeleton className="h-9 w-full" />
            ) : branches.length === 0 ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Your garage has no active branch yet. Add one in the Garage Dashboard before ordering.
              </p>
            ) : (
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger id="dest-branch" aria-label="Destination branch">
                  <SelectValue placeholder="Choose destination branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} ({b.code}){b.town ? ` — ${b.town}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="order-note">Note to supplier (optional)</Label>
            <Textarea
              id="order-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
              placeholder="e.g. Deliver before Friday 10am — job card JB-118"
              className="min-h-16"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !branchId || !mayOrder || items.length === 0}>
            {submitting ? <BtnSpinner className="mr-1.5" /> : null}
            {submitting ? 'Sending…' : 'Place order(s)'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
