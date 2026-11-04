'use client'

/* Order payment + handover panels (steps 5–6 of the protected lifecycle).
 * Payment posts to POST /api/supply/orders/[id]/pay — the 503
 * MPESA_NOT_CONFIGURED response is surfaced verbatim (message + manualOption)
 * and success is NEVER simulated. Handover verifies the 6-digit OTP or the
 * QR token with optional GPS capture. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, CreditCard, ShieldCheck, MessageSquareWarning, QrCode, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { apiGet, apiSend, ClientApiError } from '@/lib/client'
import { money } from '@/lib/format'
import {
  PaymentChip, BtnSpinner, dateTimeLabel, canPay, Row,
  type OrderDetailData, type PayStatus,
} from './shared'

// ─────────────────────────── Payment (step 5) ───────────────────────────

const PHONE_RE = /^(\+?254|0)[17]\d{8}$/

export function PaymentPanel({ order, payStatus: payStatusProp, role, busy, setBusy, reload }: {
  order: OrderDetailData
  payStatus: PayStatus | null
  role: string
  busy: string
  setBusy: (v: string) => void
  reload: () => void
}) {
  const [payOpen, setPayOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [mpesaNotice, setMpesaNotice] = useState<{ message: string; manualOption: string } | null>(null)
  const [stkMessage, setStkMessage] = useState('')
  const [livePay, setLivePay] = useState<PayStatus | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollsRef = useRef(0)

  const mayPay = canPay(role)
  const payment = order.payment
  const payStatus = livePay ?? payStatusProp
  const processing = payment?.status === 'PROCESSING' || order.paymentStatus === 'PROCESSING'
  const canInitiate = order.status === 'CONFIRMED' && !['PROTECTED', 'PROCESSING', 'RELEASED', 'PARTIALLY_RELEASED', 'REFUNDED'].includes(order.paymentStatus)

  const pollPayment = useCallback(() => {
    if (pollRef.current) return
    pollsRef.current = 0
    pollRef.current = setInterval(() => {
      pollsRef.current += 1
      apiGet<PayStatus>(`/api/supply/orders/${order.id}/pay`)
        .then((d) => {
          setLivePay(d)
          const s = d.payment?.status
          if (s === 'PROTECTED' || s === 'FAILED' || s === 'CANCELLED' || s === 'REFUNDED' || pollsRef.current > 24) {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
            if (s === 'PROTECTED') { toast.success('Payment confirmed — funds are protected.'); reload() }
          }
        })
        .catch(() => { /* transient — keep polling */ })
    }, 5000)
  }, [order.id, reload])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])
  useEffect(() => {
    if (processing) pollPayment()
    else if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [processing, pollPayment])

  async function submitPay() {
    if (!PHONE_RE.test(phone.trim())) {
      toast.error('Enter the M-Pesa number in the format 07XX or 01XX (or +2547…).')
      return
    }
    setBusy('pay')
    setMpesaNotice(null)
    try {
      const res = await apiSend<{ message: string; customerMessage?: string }>(`/api/supply/orders/${order.id}/pay`, 'POST', { phone: phone.trim() })
      setStkMessage(res.customerMessage || res.message || 'STK push sent. Enter your M-Pesa PIN — the order is protected only after Safaricom confirms.')
      toast.info('STK push sent', { description: 'The order becomes protected only when Safaricom confirms the payment.' })
      pollPayment()
      reload()
    } catch (e) {
      if (e instanceof ClientApiError && e.code === 'MPESA_NOT_CONFIGURED') {
        const manual = typeof e.data?.manualOption === 'string' ? e.data.manualOption : ''
        setMpesaNotice({ message: e.message, manualOption: manual })
        toast.error('M-Pesa is not configured on this deployment — no payment was taken.')
        reload()
      } else {
        toast.error(e instanceof ClientApiError ? e.message : 'Payment attempt failed.')
      }
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <CreditCard className="h-4 w-4 text-primary" aria-hidden="true" /> Payment
        </h3>
        <PaymentChip status={order.paymentStatus} />
      </div>

      {payment && (
        <div className="space-y-0.5 text-sm text-muted-foreground">
          <p>Authorization <span className="font-mono text-foreground">{payment.refCode}</span> · {payment.provider}</p>
          {payment.protectedAt && <p className="text-emerald-600 dark:text-emerald-400">Funds protected {dateTimeLabel(payment.protectedAt)} — released only after your inspection.</p>}
          {payment.releasedAmountMinor > 0 && <p>Released to supplier: {money(payment.releasedAmountMinor, order.currency)}</p>}
          {payment.resultDesc && <p>Provider note: {payment.resultDesc}</p>}
        </div>
      )}

      {!payStatus?.mpesaConfigured && payStatus && !payment && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          M-Pesa is not configured on this deployment. Payment attempts will fail honestly with a manual-reconciliation option — nothing is ever simulated.
        </p>
      )}

      {canInitiate && mayPay && (
        <div className="space-y-3">
          {!payOpen ? (
            <Button onClick={() => { setPayOpen(true); setStkMessage('') }}>
              <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" /> Pay to protect funds
            </Button>
          ) : (
            <div className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
              <div className="space-y-1 text-sm">
                <Row label="Products" value={money(order.subtotalMinor, order.currency)} />
                <Row label="Delivery" value={money(order.deliveryFeeMinor, order.currency)} />
                <Row label="Tax" value={money(order.taxMinor, order.currency)} />
                <Row label="Platform commission" value={money(payStatus?.estimatedCommissionMinor ?? order.platformFeeMinor, order.currency)} />
                <Separator className="my-1" />
                <Row label="TOTAL to pay now" value={money(order.totalMinor, order.currency)} strong />
                <p className="pt-1 text-xs text-muted-foreground">
                  The commission is not charged on top — it is deducted from the supplier&apos;s proceeds when funds are released.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pay-phone">M-Pesa phone number</Label>
                <Input
                  id="pay-phone" value={phone} inputMode="tel" autoComplete="tel"
                  onChange={(e) => setPhone(e.target.value)} placeholder="07XXXXXXXX or 01XXXXXXXX"
                  aria-describedby="pay-phone-hint"
                />
                <p id="pay-phone-hint" className="text-xs text-muted-foreground">An STK push is sent to this number. Real provider only — if M-Pesa is not configured the attempt fails with a manual option.</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={submitPay} disabled={busy === 'pay'}>
                  {busy === 'pay' ? <BtnSpinner className="mr-1.5" /> : null}
                  {busy === 'pay' ? 'Sending push…' : `Send STK push — ${money(order.totalMinor, order.currency)}`}
                </Button>
                <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
              </div>
              {stkMessage && (
                <Alert className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 [&>svg]:text-emerald-500">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  <AlertTitle>Awaiting your M-Pesa PIN</AlertTitle>
                  <AlertDescription className="text-foreground/80">{stkMessage}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>
      )}
      {canInitiate && !mayPay && (
        <p className="text-xs text-muted-foreground">Payments are initiated by the owner, GM, procurement or accountant.</p>
      )}

      {processing && (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 [&>svg]:text-amber-500">
          <BtnSpinner />
          <AlertTitle>Payment processing</AlertTitle>
          <AlertDescription className="text-foreground/80">
            Waiting for the provider callback. The order is protected only when Safaricom confirms — this panel refreshes automatically.
          </AlertDescription>
        </Alert>
      )}

      {mpesaNotice && (
        <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200 [&>svg]:text-amber-500">
          <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>M-Pesa not configured on this deployment</AlertTitle>
          <AlertDescription>
            <p>{mpesaNotice.message}</p>
            {mpesaNotice.manualOption && <p className="mt-1.5">{mpesaNotice.manualOption}</p>}
            <p className="mt-1.5 text-xs opacity-80">No payment was taken and the order remains unpaid — nothing has been simulated.</p>
          </AlertDescription>
        </Alert>
      )}
    </section>
  )
}


// ─────────────────────────── Step 6 — handover verification ───────────────────────────

export function HandoverPanel({ order, busy, setBusy, reload }: {
  order: OrderDetailData
  busy: string
  setBusy: (v: string) => void
  reload: () => void
}) {
  const d = order.delivery
  const active = Boolean(d && ['DISPATCHED', 'IN_TRANSIT'].includes(d.status) && !d.garageConfirmAt)
  const [otp, setOtp] = useState('')
  const [qrToken, setQrToken] = useState('')
  const [capture, setCapture] = useState(false)

  if (!active) return null

  async function getLocation(): Promise<{ lat: number; lng: number } | null> {
    if (!('geolocation' in navigator)) return null
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10_000 }
      )
    })
  }

  async function submit(body: Record<string, unknown>, tag: string) {
    if (capture) {
      const loc = await getLocation()
      if (loc) {
        body.captureLocation = true
        body.location = loc
      } else {
        body.captureLocation = false
        toast.info('Location unavailable — handover recorded without GPS coordinates.')
      }
    }
    setBusy(tag)
    try {
      const res = await apiSend<{ message: string }>(`/api/supply/orders/${order.id}/action`, 'POST', body)
      toast.success(res.message || 'Handover verified.')
      reload()
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Handover verification failed.')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-violet-500/40 bg-violet-500/5 p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <KeyRound className="h-4 w-4 text-violet-500 dark:text-violet-400" aria-hidden="true" /> Verify handover
      </h3>
      <p className="text-sm text-muted-foreground">
        Confirm the physical handover with the driver. Ask for the 6-digit code sent to the garage at dispatch
        {d?.otpHint ? <span> (ends <span className="font-mono font-semibold">…{d.otpHint}</span>)</span> : ''} — or enter the QR token printed on the delivery note.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="handover-otp">Handover code (6 digits)</Label>
          <Input
            id="handover-otp" value={otp} inputMode="numeric" maxLength={6}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••"
            className="text-center font-mono text-lg tracking-[0.4em]"
          />
          <Button
            className="w-full" disabled={otp.length !== 6 || busy !== ''}
            onClick={() => submit({ action: 'handover', otp }, 'handover-otp')}
          >
            {busy === 'handover-otp' ? <BtnSpinner className="mr-1.5" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Verify with code
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="handover-qr">QR token (delivery note)</Label>
          <Input id="handover-qr" value={qrToken} onChange={(e) => setQrToken(e.target.value)} placeholder="Token from the QR code" />
          <Button
            variant="outline" className="w-full" disabled={!qrToken.trim() || busy !== ''}
            onClick={() => submit({ action: 'handover', qrToken: qrToken.trim() }, 'handover-qr')}
          >
            {busy === 'handover-qr' ? <BtnSpinner className="mr-1.5" /> : <QrCode className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Verify with token
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/40 px-3 py-2">
        <div>
          <Label htmlFor="handover-geo" className="text-sm">Attach GPS location to the handover</Label>
          <p className="text-xs text-muted-foreground">Optional proof-of-delivery coordinates.</p>
        </div>
        <Switch id="handover-geo" checked={capture} onCheckedChange={setCapture} />
      </div>
    </section>
  )
}
