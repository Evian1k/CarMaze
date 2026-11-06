'use client'

// Super Admin: Automotive Supply Network console.
// Supplier verification, product moderation + independent authenticity
// review, dispute resolution, payment reconciliation, refund administration.
// Every sensitive action is audit-logged server-side.

import { useCallback, useEffect, useState } from 'react'
import {
  BadgeCheck, Building2, Gavel, Inbox, Loader2, PackageSearch, RefreshCw,
  ShieldAlert, ShieldCheck, Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet, apiSend } from '@/lib/client'
import { money, timeAgo } from '@/lib/format'

type SupplierRow = {
  id: string; name: string; regNo: string | null; county: string; verified: boolean
  supplierRiskScore: number; createdAt: string; status: string
  _count: { products: number; branches: number; poAsSupplier: number; reviews: number }
  subscription: { planCode: string; status: string; currentPeriodEnd: string } | null
}
type ApplicationRow = {
  id: string; refCode: string; orgName: string; county: string; representative: string
  phone: string; status: string; submittedAt: string | null; createdAt: string
  user: { name: string; email: string }
  documents: { name: string; url: string }[]
  notes: string | null
}
type ProductRow = {
  id: string; refCode: string; name: string; sku: string; brand: string | null
  provenance: string | null; createdAt: string
  supplier: { id: string; name: string; verified: boolean }
}
type DisputeRow = {
  id: string; refCode: string; reason: string; details: string; status: string
  amountFrozenMinor: number | null; openedBySide: string; createdAt: string
  order: { refCode: string; totalMinor: number; paymentStatus: string; garage: { name: string }; supplier: { name: string } } | null
  customerOrder: {
    refCode: string; totalMinor: number; paymentStatus: string; status: string
    buyer: { name: string }; supplier: { name: string }
    invoice: { refCode: string; status: string } | null
  } | null
  events: { id: string; type: string; actorName: string; note: string | null; createdAt: string }[]
}
type OrderRow = {
  id: string; refCode: string; status: string; paymentStatus: string; totalMinor: number; createdAt: string
  garage: { name: string }; supplier: { name: string }
}
type RefundRow = {
  id: string; refCode: string; amountMinor: number; kind: string; reason: string; status: string; createdAt: string
  order: { refCode: string; totalMinor: number; paymentStatus: string }
}
type SupplyData = {
  applications: ApplicationRow[]
  suppliers: SupplierRow[]
  pendingProducts: ProductRow[]
  openDisputes: DisputeRow[]
  recentOrders: OrderRow[]
  refundQueue: RefundRow[]
  counterfeitSignalCount: number
}

const REASONS: Record<string, string> = {
  MISSING_ITEMS: 'Missing items', DAMAGED: 'Damaged', WRONG_ITEM: 'Wrong item',
  COUNTERFEIT: 'Suspected counterfeit', NOT_RECEIVED: 'Not received', OTHER: 'Other',
}

export function AdminSupplyConsole() {
  const [data, setData] = useState<SupplyData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [verifyDialog, setVerifyDialog] = useState<SupplierRow | null>(null)
  const [verifyNote, setVerifyNote] = useState('')
  const [disputeDialog, setDisputeDialog] = useState<DisputeRow | null>(null)
  const [disputeNote, setDisputeNote] = useState('')
  const [disputeResolution, setDisputeResolution] = useState<'REFUND_FULL' | 'REFUND_PARTIAL' | 'REPLACEMENT' | 'REJECTED'>('REFUND_FULL')
  const [refundAmount, setRefundAmount] = useState('')
  const [reconcileDialog, setReconcileDialog] = useState<OrderRow | null>(null)
  const [reconcileRef, setReconcileRef] = useState('')

  const load = useCallback(() => {
    setError(null)
    apiGet<SupplyData>('/api/admin/supply')
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])

  useEffect(() => { load() }, [load])

  async function act(key: string, body: Record<string, unknown>, done?: () => void) {
    setBusy(key)
    try {
      const res = await apiSend<{ message?: string }>('/api/admin/supply', 'POST', body)
      toast.success(res.message ?? 'Done')
      load()
      done?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  if (error) {
    return (
      <Card className="p-6 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-destructive" />
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={load}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry</Button>
      </Card>
    )
  }
  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
      </div>
    )
  }

  const pendingApplications = data.applications.length
  const highRisk = data.suppliers.filter((s) => s.supplierRiskScore >= 60).length

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Verification queue</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-primary">{pendingApplications}</p>
          <p className="text-xs text-muted-foreground">supplier applications</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Verified suppliers</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{data.suppliers.filter((s) => s.verified).length}/{data.suppliers.length}</p>
          <p className="text-xs text-muted-foreground">never auto-verified</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Open disputes</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-red-600 dark:text-red-400">{data.openDisputes.length}</p>
          <p className="text-xs text-muted-foreground">investigation workflow</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Refund queue</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{data.refundQueue.length}</p>
          <p className="text-xs text-muted-foreground">awaiting finance</p>
        </Card>
      </div>

      <Tabs defaultValue="verification">
        <TabsList className="h-auto w-full justify-start overflow-x-auto scrollbar-thin">
          <TabsTrigger value="verification" className="gap-1.5"><Building2 className="h-4 w-4" /> Suppliers</TabsTrigger>
          <TabsTrigger value="products" className="gap-1.5"><PackageSearch className="h-4 w-4" /> Products & authenticity</TabsTrigger>
          <TabsTrigger value="disputes" className="gap-1.5"><Gavel className="h-4 w-4" /> Disputes</TabsTrigger>
          <TabsTrigger value="payments" className="gap-1.5"><Wallet className="h-4 w-4" /> Payments & refunds</TabsTrigger>
        </TabsList>

        {/* ── Supplier verification ── */}
        <TabsContent value="verification" className="mt-4 space-y-4">
          {data.applications.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Supplier applications</CardTitle>
                <CardDescription>Document review required. Approval creates the business account: verification (public listing) is a separate, explicit decision.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.applications.map((a) => (
                  <div key={a.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{a.orgName} <Badge variant="outline" className="ml-1">{a.refCode}</Badge></p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{a.representative} · {a.phone} · {a.county} · applied {timeAgo(a.submittedAt ?? a.createdAt)}</p>
                        {a.notes && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.notes}</p>}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busy === a.id} onClick={() => act(a.id, { action: 'approve-application', applicationId: a.id })}>
                          {busy === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-1 h-4 w-4" />} Approve
                        </Button>
                        <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" disabled={busy === `rej-${a.id}`}
                          onClick={() => {
                            const note = window.prompt('Rejection reason (shared with the applicant):')
                            if (note) act(`rej-${a.id}`, { action: 'reject-application', applicationId: a.id, note })
                          }}>
                          Reject
                        </Button>
                      </div>
                    </div>
                    {a.documents.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {a.documents.map((d) => (
                          <a key={d.url} href={d.url} target="_blank" rel="noreferrer" className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground">
                            {d.name}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Supplier businesses</CardTitle>
              <CardDescription>Verification, suspension and risk monitoring. Unverified suppliers never appear publicly.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">Business</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Risk</th>
                      <th className="py-2 pr-3">Products</th>
                      <th className="py-2 pr-3">Orders</th>
                      <th className="py-2 pr-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.suppliers.map((s) => (
                      <tr key={s.id} className="border-b last:border-0">
                        <td className="py-2.5 pr-3">
                          <p className="font-medium">{s.name}</p>
                          <p className="text-xs text-muted-foreground">{s.county} · joined {timeAgo(s.createdAt)}</p>
                        </td>
                        <td className="py-2.5 pr-3">
                          {s.verified ? (
                            <Badge className="gap-1 bg-primary/15 text-primary"><ShieldCheck className="h-3 w-3" /> Verified</Badge>
                          ) : s.status === 'SUSPENDED' ? (
                            <Badge variant="destructive">Suspended</Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">Unverified</Badge>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className={s.supplierRiskScore >= 60 ? 'font-semibold text-red-600 dark:text-red-400' : s.supplierRiskScore >= 30 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
                            {s.supplierRiskScore}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums">{s._count.products}</td>
                        <td className="py-2.5 pr-3 tabular-nums">{s._count.poAsSupplier}</td>
                        <td className="py-2.5 pr-3">
                          <div className="flex flex-wrap gap-1.5">
                            {!s.verified && s.status === 'ACTIVE' && (
                              <Button size="sm" variant="outline" onClick={() => { setVerifyDialog(s); setVerifyNote('') }}>
                                <BadgeCheck className="mr-1 h-3.5 w-3.5" /> Verify
                              </Button>
                            )}
                            {s.verified && s.status === 'ACTIVE' && (
                              <Button size="sm" variant="ghost" disabled={busy === `uv-${s.id}`}
                                onClick={() => {
                                  const note = window.prompt('Reason for revoking verification:')
                                  if (note) act(`uv-${s.id}`, { action: 'unverify-supplier', orgId: s.id, note })
                                }}>
                                Revoke
                              </Button>
                            )}
                            {s.status === 'ACTIVE' ? (
                              <Button size="sm" variant="ghost" className="text-destructive" disabled={busy === `sus-${s.id}`}
                                onClick={() => {
                                  const note = window.prompt('Suspension reason (audit-logged):')
                                  if (note) act(`sus-${s.id}`, { action: 'suspend-supplier', orgId: s.id, note })
                                }}>
                                Suspend
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" disabled={busy === `res-${s.id}`} onClick={() => act(`res-${s.id}`, { action: 'restore-supplier', orgId: s.id })}>Restore</Button>
                            )}
                            <Button size="sm" variant="ghost" disabled={busy === `risk-${s.id}`}
                              onClick={() => {
                                const score = window.prompt(`Risk score 0–100 for ${s.name} (≥60 = high risk):`, String(s.supplierRiskScore))
                                if (score !== null) act(`risk-${s.id}`, { action: 'risk-score', orgId: s.id, score: Math.max(0, Math.min(100, Number(score) || 0)), note: 'Manual risk update from admin console' })
                              }}>
                              Risk
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Product moderation + authenticity ── */}
        <TabsContent value="products" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Authenticity review queue</CardTitle>
              <CardDescription>
                Provenance evidence below is supplier-declared. Verifying is an independent CARMAZE decision: business verification and product authenticity are separate judgements.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.pendingProducts.length === 0 && (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
                  <Inbox className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No products awaiting authenticity review.</p>
                </div>
              )}
              {data.pendingProducts.map((p) => {
                const provenance = (() => { try { return JSON.parse(p.provenance ?? '{}') as { provenanceNote?: string } } catch { return {} } })()
                return (
                  <div key={p.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4">
                    <div className="min-w-0">
                      <p className="font-medium">{p.name} <span className="ml-1 text-xs text-muted-foreground">{p.sku}</span></p>
                      <p className="text-xs text-muted-foreground">{p.supplier.name} {p.supplier.verified ? '(verified business)' : '(UNVERIFIED business)'} · {p.brand ?? 'no brand'} · added {timeAgo(p.createdAt)}</p>
                      {provenance.provenanceNote && <p className="mt-1 text-xs text-muted-foreground">Provenance: {provenance.provenanceNote}</p>}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy === p.id} onClick={() => {
                        const note = window.prompt('Verification basis (audit-logged):')
                        if (note) act(p.id, { action: 'verify-authenticity', productId: p.id, note })
                      }}>
                        <BadgeCheck className="mr-1 h-4 w-4" /> Verify authenticity
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={busy === `susp-${p.id}`} onClick={() => {
                        const note = window.prompt('Suspension reason (audit-logged):')
                        if (note) act(`susp-${p.id}`, { action: 'suspend-product', productId: p.id, note })
                      }}>
                        Suspend
                      </Button>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Disputes ── */}
        <TabsContent value="disputes" className="mt-4 space-y-3">
          {data.openDisputes.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
              <Gavel className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No open disputes. Order records, payment confirmations, delivery evidence and messages are collected automatically when disputes arise.</p>
            </div>
          )}
          {data.openDisputes.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{d.refCode} · {REASONS[d.reason] ?? d.reason} <Badge variant="outline" className="ml-1">{d.status}</Badge>
                    {d.customerOrder && <Badge variant="outline" className="ml-1 border-amber-300 text-amber-700">Consumer order</Badge>}
                  </p>
                  {d.customerOrder ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Order {d.customerOrder.refCode}: {d.customerOrder.buyer.name} vs {d.customerOrder.supplier.name} · {money(d.customerOrder.totalMinor)} ({d.customerOrder.paymentStatus})
                      {d.customerOrder.invoice ? ` · invoice ${d.customerOrder.invoice.refCode} ${d.customerOrder.invoice.status}` : ''}
                      {d.amountFrozenMinor ? ` · ${money(d.amountFrozenMinor)} frozen` : ''}
                    </p>
                  ) : d.order ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Order {d.order.refCode}: {d.order.garage.name} vs {d.order.supplier.name} · {money(d.order.totalMinor)} ({d.order.paymentStatus})
                      {d.amountFrozenMinor ? ` · ${money(d.amountFrozenMinor)} frozen` : ''}
                    </p>
                  ) : null}
                  <p className="mt-1 max-w-2xl text-sm">{d.details}</p>
                  {d.events.length > 0 && (
                    <div className="mt-2 max-h-32 space-y-1 overflow-y-auto scrollbar-thin text-xs text-muted-foreground">
                      {d.events.map((ev) => (
                        <p key={ev.id}><span className="font-medium">{ev.actorName}</span> ({ev.type.replaceAll('_', ' ').toLowerCase()}): {ev.note}</p>
                      ))}
                    </div>
                  )}
                </div>
                <Button size="sm" onClick={() => { setDisputeDialog(d); setDisputeNote(''); setDisputeResolution('REFUND_FULL'); setRefundAmount('') }}>
                  Investigate & resolve
                </Button>
              </div>
            </Card>
          ))}
        </TabsContent>

        {/* ── Payments & refunds ── */}
        <TabsContent value="payments" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Orders in flight</CardTitle>
              <CardDescription>Reconcile real provider statements against pending order payments (MANUAL_RECONCILED: fully audit-logged). Dispatch is blocked until payment is protected.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">Order</th>
                      <th className="py-2 pr-3">Parties</th>
                      <th className="py-2 pr-3">Total</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentOrders.map((o) => (
                      <tr key={o.id} className="border-b last:border-0">
                        <td className="py-2.5 pr-3 font-medium">{o.refCode}</td>
                        <td className="py-2.5 pr-3 text-xs text-muted-foreground">{o.garage.name} → {o.supplier.name}</td>
                        <td className="py-2.5 pr-3 tabular-nums">{money(o.totalMinor)}</td>
                        <td className="py-2.5 pr-3">
                          <Badge variant="outline" className={o.paymentStatus === 'PROTECTED' ? 'border-primary/40 text-primary' : ''}>
                            {o.status} · {o.paymentStatus}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-3">
                          {o.paymentStatus !== 'PROTECTED' && ['CONFIRMED'].includes(o.status) && (
                            <Button size="sm" variant="outline" onClick={() => { setReconcileDialog(o); setReconcileRef('') }}>Reconcile</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Refund queue</CardTitle>
              <CardDescription>From partial inspections and dispute resolutions. Processing records the provider reference.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.refundQueue.length === 0 && <p className="text-sm text-muted-foreground">No refunds awaiting processing.</p>}
              {data.refundQueue.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{r.refCode} · {money(r.amountMinor)} <Badge variant="outline" className="ml-1">{r.kind}</Badge></p>
                    <p className="text-xs text-muted-foreground">Order {r.order.refCode} ({r.order.paymentStatus}) · {r.reason} · raised {timeAgo(r.createdAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy === `r-${r.id}`} onClick={() => {
                      const providerRef = window.prompt('Provider transaction reference (e.g. M-Pesa receipt):')
                      if (providerRef) act(`r-${r.id}`, { action: 'process-refund', refundId: r.id, decision: 'PROCESSED', providerRef })
                    }}>
                      Mark processed
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={busy === `rr-${r.id}`}
                      onClick={() => act(`rr-${r.id}`, { action: 'process-refund', refundId: r.id, decision: 'REJECTED', note: 'Rejected from admin console' })}>
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Verify supplier dialog */}
      <Dialog open={Boolean(verifyDialog)} onOpenChange={(o) => !o && setVerifyDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verify {verifyDialog?.name}</DialogTitle>
            <DialogDescription>
              Confirm that registration documents and business-ownership checks are complete. Verified status is public and revocable; it does not certify product authenticity.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="verify-note">Review note (audit-logged)</Label>
            <Textarea id="verify-note" value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} placeholder="Documents checked: reg certificate, KRA PIN, premises…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyDialog(null)}>Cancel</Button>
            <Button disabled={verifyNote.trim().length < 5 || busy === 'verify'} onClick={() => {
              act('verify', { action: 'verify-supplier', orgId: verifyDialog!.id, note: verifyNote }, () => setVerifyDialog(null))
            }}>
              {busy === 'verify' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1 h-4 w-4" />} Confirm verification
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve dispute dialog */}
      <Dialog open={Boolean(disputeDialog)} onOpenChange={(o) => !o && setDisputeDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Resolve {disputeDialog?.refCode}</DialogTitle>
            <DialogDescription>All order records, payment confirmations, delivery confirmations, photos and messages are preserved as evidence. Completed transaction records can never be edited by either party.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(['REFUND_FULL', 'REFUND_PARTIAL', 'REPLACEMENT', 'REJECTED'] as const).map((r) => (
                <Button key={r} size="sm" variant={disputeResolution === r ? 'default' : 'outline'} onClick={() => setDisputeResolution(r)}>
                  {r.replaceAll('_', ' ')}
                </Button>
              ))}
            </div>
            {disputeResolution === 'REFUND_PARTIAL' && (
              <div className="space-y-1">
                <Label htmlFor="refund-amount">Partial refund amount (KES)</Label>
                <Input id="refund-amount" inputMode="numeric" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder="e.g. 15000" />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="dispute-note">Resolution note</Label>
              <Textarea id="dispute-note" value={disputeNote} onChange={(e) => setDisputeNote(e.target.value)} placeholder="Findings and decision rationale (shared with both parties)" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeDialog(null)}>Cancel</Button>
            <Button disabled={disputeNote.trim().length < 5 || busy === 'resolve'} onClick={() => {
              act('resolve', {
                action: 'resolve-dispute',
                disputeId: disputeDialog!.id,
                resolution: disputeResolution,
                note: disputeNote,
                ...(disputeResolution === 'REFUND_PARTIAL' && refundAmount ? { refundAmountMinor: Math.round(Number(refundAmount) * 100) } : {}),
              }, () => setDisputeDialog(null))
            }}>
              Record resolution
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reconcile payment dialog */}
      <Dialog open={Boolean(reconcileDialog)} onOpenChange={(o) => !o && setReconcileDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reconcile payment: {reconcileDialog?.refCode}</DialogTitle>
            <DialogDescription>
              Record the real M-Pesa/paybill transaction reference after checking your provider statement. This marks funds as PROTECTED (provider MANUAL_RECONCILED) and lets the supplier dispatch. Funds release only after the garage&apos;s inspection.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rec-ref">Provider reference</Label>
            <Input id="rec-ref" value={reconcileRef} onChange={(e) => setReconcileRef(e.target.value)} placeholder="e.g. SBX12QTXYZ" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReconcileDialog(null)}>Cancel</Button>
            <Button disabled={reconcileRef.trim().length < 3 || busy === 'rec'} onClick={() => {
              act('rec', { action: 'reconcile-payment', orderId: reconcileDialog!.id, providerRef: reconcileRef.trim() }, () => setReconcileDialog(null))
            }}>
              Confirm protected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
