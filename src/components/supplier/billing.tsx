'use client'

/* SupplierOS: Billing tab: supplier subscription plans, invoices, M-Pesa
 * payment and the supplier settlement ledger. HONEST BILLING RULES (mirroring
 * the platform contract):
 *  - Subscribing creates a PENDING invoice only; the subscription activates
 *    exclusively after payment is confirmed by M-Pesa Daraja callback or
 *    platform finance reconciliation. Never claim otherwise.
 *  - M-Pesa STK push failures (incl. unconfigured deployments) are surfaced
 *    verbatim from the API: no simulated payments, ever.
 *  - Settlements show money OWED from released protected payments; they are
 *    marked SETTLED only on provider confirmation or audited finance
 *    reconciliation — never by this UI. */

import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Info, Loader2, Receipt, Wallet, Landmark } from 'lucide-react'
import { apiSend } from '@/lib/client'
import { money, dateLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  type PlanItem, type InvoiceItem, type FetchState,
  useFetch, LoadingBlock, ModuleNotice, EmptyState, INVOICE_BADGE_CLASS, errMessage,
} from './shared'

type PlansPayload = { plans: PlanItem[]; packages?: unknown[] }
type InvoicesPayload = { invoices: InvoiceItem[]; scope: string }

type SettlementItem = {
  id: string
  refCode: string
  kind: string
  amountMinor: number
  commissionMinor: number
  netMinor: number
  currency: string
  status: string
  provider: string | null
  providerRef: string | null
  attempts: number
  lastError: string | null
  holdReason: string | null
  settledAt: string | null
  createdAt: string
  order: { refCode: string } | null
}
type SettlementsPayload = {
  settlements: SettlementItem[]
  totals: { pendingNetMinor: number; processingNetMinor: number; settledNetMinor: number; onHoldNetMinor: number }
}

const SETTLEMENT_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  PROCESSING: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  SETTLED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  FAILED: 'bg-red-500/15 text-red-700 dark:text-red-400',
  ON_HOLD: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  CANCELLED: 'bg-muted text-muted-foreground',
}

export function BillingTab() {
  const plans = useFetch<PlansPayload>('/api/billing/plans')
  const invoices = useFetch<InvoicesPayload>('/api/billing/invoices?org=1')
  const settlements = useFetch<SettlementsPayload>('/api/settlements')
  const [busyCode, setBusyCode] = useState<string | null>(null)
  const [payInvoice, setPayInvoice] = useState<InvoiceItem | null>(null)

  const supplierPlans = (plans.data?.plans ?? []).filter((p) => p.audience === 'SUPPLIER')
  const invoiceList = invoices.data?.invoices ?? []

  async function subscribe(planCode: string) {
    setBusyCode(planCode)
    try {
      const res = await apiSend<{ invoice?: InvoiceItem; message?: string }>('/api/billing/subscribe', 'POST', { planCode })
      toast.success(res.message ?? 'Invoice created: complete payment to activate the subscription.')
      invoices.reload()
    } catch (e) {
      // Honest failure: role gates / plan issues are surfaced verbatim.
      toast.error(await errMessage(e, 'Could not create the subscription invoice.'))
    } finally {
      setBusyCode(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Billing & plans</h2>
        <p className="text-sm text-muted-foreground">Supplier subscriptions and invoices for your business.</p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Honest billing</AlertTitle>
        <AlertDescription>
          Subscribing issues a PENDING invoice only. The subscription activates after your payment is confirmed by
          M-Pesa (Daraja callback) or by platform finance: never before, and nothing here simulates a payment.
        </AlertDescription>
      </Alert>

      {/* Plans */}
      <div className="grid gap-3 md:grid-cols-2">
        {plans.loading ? (
          <>
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </>
        ) : plans.error ? (
          <div className="md:col-span-2">
            <ModuleNotice title="Plans could not load" detail={plans.error.message} retry={plans.reload} />
          </div>
        ) : supplierPlans.length === 0 ? (
          <div className="md:col-span-2">
            <EmptyState
              icon={<Wallet className="h-8 w-8" />}
              title="No supplier plans published"
              detail="Supplier subscription plans become available after platform verification. You will see them here once published."
            />
          </div>
        ) : (
          supplierPlans.map((p) => (
            <PlanCard key={p.code} plan={p} busy={busyCode === p.code} onSubscribe={() => subscribe(p.code)} />
          ))
        )}
      </div>

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-4 w-4" /> Invoices</CardTitle>
          <CardDescription>Invoices issued to businesses you own or manage (owner/manager/finance roles).</CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.loading ? (
            <LoadingBlock label="Loading invoices…" />
          ) : invoices.error ? (
            <ModuleNotice title="Invoices could not load" detail={invoices.error.message} retry={invoices.reload} />
          ) : invoiceList.length === 0 ? (
            <EmptyState
              icon={<Receipt className="h-8 w-8" />}
              title="No invoices yet"
              detail="Subscribe to a plan above to receive your first invoice, or wait for platform-issued fees."
            />
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto scrollbar-thin">
              {invoiceList.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="font-mono text-xs text-muted-foreground">{inv.refCode}</span>
                      <Badge variant="secondary" className={cn('border-transparent', INVOICE_BADGE_CLASS[inv.status] ?? 'bg-muted text-muted-foreground')}>
                        {inv.status === 'PENDING' ? 'Pending payment' : inv.status === 'PAID' ? 'Paid' : inv.status}
                      </Badge>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{inv.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Issued {dateLabel(inv.issuedAt)}{inv.dueDate ? ` · due ${dateLabel(inv.dueDate)}` : ''}{inv.paidAt ? ` · paid ${dateLabel(inv.paidAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{money(inv.amountMinor, inv.currency)}</span>
                    {inv.status === 'PENDING' && (
                      <Button size="sm" variant="outline" className="h-8" onClick={() => setPayInvoice(inv)}>
                        <Wallet className="h-3.5 w-3.5" /> Pay via M-Pesa
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Settlements */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-4 w-4" /> Settlements</CardTitle>
          <CardDescription>
            Money owed to you from released protected payments. A payout is marked settled only after the payment
            provider confirms the transfer or platform finance reconciles it with an external reference.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settlements.loading ? (
            <LoadingBlock label="Loading settlements…" />
          ) : settlements.error ? (
            <ModuleNotice title="Settlements could not load" detail={settlements.error.message} retry={settlements.reload} />
          ) : (settlements.data?.settlements.length ?? 0) === 0 ? (
            <EmptyState
              icon={<Landmark className="h-8 w-8" />}
              title="No settlements yet"
              detail="When a garage releases payment on one of your orders, the payout owed appears here."
            />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SettlementStat label="Owed (pending)" minor={settlements.data?.totals.pendingNetMinor ?? 0} />
                <SettlementStat label="Processing" minor={settlements.data?.totals.processingNetMinor ?? 0} />
                <SettlementStat label="Settled" minor={settlements.data?.totals.settledNetMinor ?? 0} />
                <SettlementStat label="On hold" minor={settlements.data?.totals.onHoldNetMinor ?? 0} />
              </div>
              <ul className="max-h-72 divide-y divide-border overflow-y-auto scrollbar-thin">
                {(settlements.data?.settlements ?? []).map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="font-mono text-xs text-muted-foreground">{s.refCode}</span>
                        {s.order && <span className="text-xs text-muted-foreground">order {s.order.refCode}</span>}
                        <Badge variant="secondary" className={cn('border-transparent', SETTLEMENT_BADGE[s.status] ?? 'bg-muted text-muted-foreground')}>
                          {s.status === 'PENDING' ? 'Owed to you' : s.status === 'PROCESSING' ? 'Payout in progress' : s.status === 'ON_HOLD' ? 'On hold' : s.status === 'SETTLED' ? 'Settled' : s.status}
                        </Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Net {money(s.netMinor, s.currency)} (gross {money(s.amountMinor, s.currency)} · commission {money(s.commissionMinor, s.currency)})
                      </p>
                      {s.holdReason && <p className="mt-0.5 text-xs text-orange-600 dark:text-orange-400">Held: {s.holdReason}</p>}
                      {s.lastError && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">Last error: {s.lastError}</p>}
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {s.settledAt ? `settled ${dateLabel(s.settledAt)}` : `created ${dateLabel(s.createdAt)}`}
                      {s.provider && <p>{s.provider === 'MANUAL' ? 'reconciled by finance' : s.provider}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {payInvoice && (
        <MpesaPayDialog
          invoice={payInvoice}
          onClose={() => setPayInvoice(null)}
          onPaid={() => {
            setPayInvoice(null)
            invoices.reload()
          }}
        />
      )}
    </div>
  )
}

function PlanCard({ plan, busy, onSubscribe }: { plan: PlanItem; busy: boolean; onSubscribe: () => void }) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-base">{plan.name}</CardTitle>
        <CardDescription>Billed every {plan.intervalMonths} month{plan.intervalMonths === 1 ? '' : 's'}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <p className="text-2xl font-semibold">
          {money(plan.priceMinor, plan.currency)}
          <span className="text-sm font-normal text-muted-foreground"> /{plan.intervalMonths}mo</span>
        </p>
        <ul className="mt-3 space-y-1.5">
          {plan.features.map((f) => (
            <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {f}
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Button className="w-full min-h-11" disabled={busy} onClick={onSubscribe}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />} Subscribe: get invoice
        </Button>
      </CardFooter>
    </Card>
  )
}

function MpesaPayDialog({ invoice, onClose, onPaid }: {
  invoice: InvoiceItem
  onClose: () => void
  onPaid: () => void
}) {
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pay() {
    const cleaned = phone.replace(/\s+/g, '')
    if (!/^(?:\+?254|0)(?:7|1)\d{8}$/.test(cleaned)) {
      setError('Enter a valid Kenyan phone number (e.g. 0712 345 678).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await apiSend<{ message?: string }>('/api/billing/mpesa/stkpush', 'POST', { invoiceId: invoice.id, phone: cleaned })
      toast.success(res.message ?? `STK push sent to ${cleaned}: enter your M-Pesa PIN to complete payment for ${invoice.refCode}.`)
      onPaid()
    } catch (e) {
      const msg = await errMessage(e, 'Could not start the M-Pesa payment.')
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Pay {money(invoice.amountMinor, invoice.currency)} via M-Pesa</DialogTitle>
          <DialogDescription>
            Invoice {invoice.refCode}: {invoice.description}. An STK push will be sent to your phone; the invoice is
            marked paid only after Safaricom confirms the transaction.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="mpesa-phone">M-Pesa phone number</Label>
            <Input id="mpesa-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={pay} disabled={busy} className="min-h-11">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />} Send STK push
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SettlementStat({ label, minor }: { label: string; minor: number }) {
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{money(minor, 'KES')}</p>
    </div>
  )
}
