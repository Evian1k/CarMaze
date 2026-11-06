'use client'

/* Trust & Credit managers: business-side, private.
 *
 * TrustManager  : the business's Trusted Customer Programme. Labels are
 *                 internal relationship markers: never shared with other
 *                 businesses and never treated as credit ratings.
 * CreditManager : business-controlled customer credit ledger. CARMAZE is
 *                 management technology only, not a lender.
 *
 * Every number comes from GET /api/org/trust and GET /api/org/credit; the
 * balances are derived from the append-only ledger server-side. */

import { useCallback, useEffect, useState } from 'react'
import {
  BadgeCheck, CalendarClock, CircleAlert, HandCoins, Landmark, Lock, Plus,
  RefreshCw, ShieldAlert, ShieldCheck, UserPlus, UserMinus, Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { apiGet, apiSend } from '@/lib/client'
import { dateLabel, money, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

// ───────────────────────────── types ─────────────────────────────

type CustomerRef = { id: string; name: string; phone: string | null }
type TrustMemberRow = {
  id: string; label: string
  customer: CustomerRef
  note: string | null
  createdAt: string
}
type TrustProgramme = {
  id: string; name: string; description: string | null; terms: string | null
  status: string
  members: TrustMemberRow[]
}
type CreditLedgerEntry = {
  id: string; kind: string; amountMinor: number; balanceAfterMinor: number
  refType: string | null; dueDate: string | null; paidAt: string | null
  note: string | null; actorName: string | null; createdAt: string
}
type Facility = {
  id: string; refCode: string
  customer: CustomerRef
  limitMinor: number; depositMinor: number; status: string; terms: string | null
  outstandingMinor: number; availableMinor: number; overdue: boolean
  approvedAt: string | null; createdAt: string
  entries: CreditLedgerEntry[]
}

const TRUST_LABELS = ['NEW', 'REGULAR', 'LOYAL', 'PREFERRED', 'TRUSTED', 'SUSPENDED'] as const
type TrustLabel = (typeof TRUST_LABELS)[number]

const LABEL_BADGE: Record<string, string> = {
  NEW: 'border-border bg-muted text-muted-foreground',
  REGULAR: 'border-border bg-secondary text-secondary-foreground',
  LOYAL: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  PREFERRED: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  TRUSTED: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-300',
  SUSPENDED: 'border-rose-300 bg-rose-500/15 text-rose-800 dark:border-rose-500/40 dark:text-rose-300',
}
const FACILITY_BADGE: Record<string, string> = {
  PENDING_APPLICATION: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  OFFERED: 'border-amber-300 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  ACTIVE: 'border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-300',
  SUSPENDED: 'border-rose-300 bg-rose-500/15 text-rose-800 dark:border-rose-500/40 dark:text-rose-300',
  CLOSED: 'border-border bg-muted text-muted-foreground',
  REJECTED: 'border-border bg-muted text-muted-foreground',
}

function kesToMinor(input: string): number | null {
  const n = Number(input)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

// ═══════════════════════════ TrustManager ═══════════════════════════

export function TrustManager({ orgId }: { orgId: string }) {
  const [programme, setProgramme] = useState<TrustProgramme | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<TrustMemberRow | null>(null)

  const load = useCallback(() => {
    apiGet<{ programme: TrustProgramme | null }>(`/api/org/trust?orgId=${orgId}`)
      .then((d) => { setProgramme(d.programme); setError(null) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the trust programme'))
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function createProgramme(form: { name: string; description: string; terms: string }) {
    try {
      await apiSend('/api/org/trust', 'POST', {
        orgId,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        terms: form.terms.trim() || undefined,
      })
      toast.success('Trusted Customer Programme created: invite customers by email')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the programme')
    }
  }

  async function invite(email: string, label: TrustLabel, note: string) {
    try {
      const d = await apiSend<{ message: string }>('/api/org/trust', 'POST', {
        action: 'invite', orgId, customerEmail: email.trim(), label, ...(note.trim() ? { note: note.trim() } : {}),
      })
      toast.success(d.message)
      setInviteOpen(false)
      load()
    } catch (e) {
      const code = (e as { code?: string }).code
      toast.error(e instanceof Error ? e.message : 'Could not invite the customer', {
        description: code === 'NO_CUSTOMER' ? 'No CARMAZE account uses that email. Customers must register first.' : undefined,
      })
    }
  }

  async function changeLabel(memberId: string, label: TrustLabel, note?: string) {
    try {
      await apiSend('/api/org/trust', 'POST', { action: 'label', memberId, label, ...(note ? { note } : {}) })
      toast.success(`Label updated to ${label}`)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the label')
    }
  }

  async function removeMember(memberId: string) {
    try {
      await apiSend('/api/org/trust', 'POST', { action: 'remove', memberId })
      toast.success('Member removed from the programme')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the member')
    }
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CircleAlert className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">Could not load the trust programme</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="min-h-11" onClick={() => { setProgramme(undefined); load() }}><RefreshCw className="h-4 w-4" /> Try again</Button>
        </CardContent>
      </Card>
    )
  }

  if (programme === undefined) {
    return <Skeleton className="h-56 rounded-xl" aria-busy="true" />
  }

  if (programme === null) {
    return <CreateTrustForm onCreate={createProgramme} />
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-5 w-5 text-primary" /> {programme.name}</CardTitle>
              <CardDescription className="mt-1">
                {programme.members.length} member{programme.members.length === 1 ? '' : 's'} · status {programme.status.toLowerCase()}
              </CardDescription>
            </div>
            <Button className="min-h-11" onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4" /> Invite customer</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {programme.description && <p className="text-sm text-muted-foreground">{programme.description}</p>}

          {/* Prominent privacy note: required copy */}
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-500/10 p-3 dark:border-amber-500/40">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Labels are private to your business: never shared with other businesses and never treated
              as credit ratings.
            </p>
          </div>

          {programme.members.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No members yet. Invite customers by their CARMAZE account email; they must register first.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <div className="overflow-x-auto scrollbar-thin">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Internal note</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {programme.members.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <p className="font-medium">{m.customer.name}</p>
                          <p className="text-xs text-muted-foreground">{m.customer.phone ?? 'Not provided'}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={LABEL_BADGE[m.label] ?? LABEL_BADGE.NEW}>{m.label}</Badge>
                        </TableCell>
                        <TableCell className="max-w-48">
                          <p className="truncate text-sm text-muted-foreground">{m.note ?? 'Not provided'}</p>
                        </TableCell>
                        <TableCell className="text-sm">{timeAgo(m.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            <Select
                              value={m.label}
                              onValueChange={(v) => changeLabel(m.id, v as TrustLabel)}
                            >
                              <SelectTrigger size="sm" aria-label={`Change label for ${m.customer.name}`} className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TRUST_LABELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="min-h-11 text-muted-foreground hover:text-destructive"
                              aria-label={`Remove ${m.customer.name}`}
                              onClick={() => setRemoveTarget(m)}
                            >
                              <UserMinus className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {inviteOpen && (
        <InviteDialog
          onClose={() => setInviteOpen(false)}
          onSubmit={async (email, label, note) => { await invite(email, label, note) }}
        />
      )}

      <AlertDialog open={removeTarget !== null} onOpenChange={(o) => { if (!o) setRemoveTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.customer.name} from “{programme.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The customer loses the programme&apos;s relationship status with your business immediately.
              Their CARMAZE account and history are untouched, and other businesses are unaffected:
              labels never leave your business.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep member</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault()
                if (removeTarget) await removeMember(removeTarget.id)
                setRemoveTarget(null)
              }}
            >
              Remove member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CreateTrustForm({ onCreate }: { onCreate: (f: { name: string; description: string; terms: string }) => Promise<void> }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [terms, setTerms] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = name.trim().length >= 3

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-5 w-5 text-primary" /> Create your Trusted Customer Programme</CardTitle>
        <CardDescription>
          A private list of the customers you know and trust, with your own relationship labels.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-500/10 p-3 dark:border-amber-500/40">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Labels are private to your business: never shared with other businesses and never treated
            as credit ratings.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trust-name">Programme name</Label>
          <Input id="trust-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wanjiku Motors Trusted Customers" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trust-desc">Description (optional)</Label>
          <Input id="trust-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who the programme is for and what it means" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trust-terms">Terms (optional, shown to members)</Label>
          <Textarea id="trust-terms" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="What members can expect and what you expect from them" />
        </div>
        <div className="flex justify-end">
          <Button className="min-h-11" disabled={!valid || busy} onClick={async () => { setBusy(true); try { await onCreate({ name, description, terms }) } finally { setBusy(false) } }}>
            <Plus className="h-4 w-4" /> {busy ? 'Creating…' : 'Create programme'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function InviteDialog({ onClose, onSubmit }: {
  onClose: () => void
  onSubmit: (email: string, label: TrustLabel, note: string) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [label, setLabel] = useState<TrustLabel>('NEW')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a customer</DialogTitle>
          <DialogDescription>
            The customer must already have a CARMAZE account with that email. They see the programme
            terms and must accept them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Customer email</Label>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Initial label</Label>
            <Select value={label} onValueChange={(v) => setLabel(v as TrustLabel)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRUST_LABELS.filter((l) => l !== 'SUSPENDED').map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-note">Internal note (optional)</Label>
            <Input id="invite-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only your team sees this" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="min-h-11" disabled={!valid || busy} onClick={async () => { setBusy(true); try { await onSubmit(email, label, note) } finally { setBusy(false) } }}>
            {busy ? 'Inviting…' : 'Send invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ═══════════════════════════ CreditManager ═══════════════════════════

export function CreditManager({ orgId }: { orgId: string }) {
  const [facilities, setFacilities] = useState<Facility[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reviewTarget, setReviewTarget] = useState<Facility | null>(null)
  const [chargeTarget, setChargeTarget] = useState<Facility | null>(null)
  const [repayTarget, setRepayTarget] = useState<Facility | null>(null)
  const [suspendTarget, setSuspendTarget] = useState<Facility | null>(null)
  const [closeTarget, setCloseTarget] = useState<Facility | null>(null)

  const load = useCallback(() => {
    apiGet<{ facilities: Facility[] }>(`/api/org/credit?orgId=${orgId}`)
      .then((d) => { setFacilities(d.facilities); setError(null) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load credit facilities'))
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function patch(facility: Facility, body: Record<string, unknown>, successMsg: string) {
    try {
      const d = await apiSend<{ message?: string }>(`/api/org/credit/${facility.id}`, 'PATCH', body)
      toast.success(d.message ?? successMsg)
      load()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed')
      return false
    }
  }

  async function postEntry(facility: Facility, body: Record<string, unknown>): Promise<boolean> {
    try {
      const d = await apiSend<{ outstandingMinor: number }>(`/api/org/credit/${facility.id}`, 'POST', body)
      toast.success(`${body.kind === 'CHARGE' ? 'Charge' : 'Repayment'} recorded: outstanding ${money(d.outstandingMinor)}`)
      load()
      return true
    } catch (e) {
      const code = (e as { code?: string }).code
      const message = e instanceof Error ? e.message : 'Could not record the entry'
      toast.error(message, {
        description: code === 'LIMIT_EXCEEDED'
          ? 'The approved limit is enforced by the ledger; the charge was rejected.'
          : code === 'OVER_REPAYMENT'
            ? 'Repayments cannot exceed the outstanding balance.'
            : code === 'OUTSTANDING_BALANCE'
              ? 'Clear the outstanding balance before closing the facility.'
              : undefined,
      })
      return false
    }
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CircleAlert className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">Could not load credit facilities</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="min-h-11" onClick={() => { setFacilities(null); load() }}><RefreshCw className="h-4 w-4" /> Try again</Button>
        </CardContent>
      </Card>
    )
  }

  if (!facilities) {
    return <Skeleton className="h-56 rounded-xl" aria-busy="true" />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-lg border border-dashed p-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">
          Management technology only. CARMAZE is not a lender; where credit products are regulated, use
          licensed partners and comply with Kenyan law.
        </p>
      </div>

      {facilities.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Landmark className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 font-medium">No customer credit applications</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            When a customer applies for a pay-later facility it appears here for review. Approval is
            entirely at your discretion: you set the deposit and repayment terms.
          </p>
        </div>
      ) : (
        facilities.map((f) => (
          <Card key={f.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {f.customer.name}
                    <Badge variant="outline" className={cn(FACILITY_BADGE[f.status] ?? FACILITY_BADGE.CLOSED)}>
                      {f.status === 'PENDING_APPLICATION' ? 'Application to review' : f.status === 'OFFERED' ? 'Offered: awaiting customer' : f.status.charAt(0) + f.status.slice(1).toLowerCase()}
                    </Badge>
                    {f.overdue && f.status === 'ACTIVE' && (
                      <Badge variant="outline" className="border-rose-300 bg-rose-500/15 text-rose-800 dark:border-rose-500/40 dark:text-rose-300">
                        <CircleAlert className="h-3 w-3" /> Overdue
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {f.refCode} · {f.customer.phone ?? 'no phone'} · applied {timeAgo(f.createdAt)}
                  </CardDescription>
                </div>
                <div className="grid grid-cols-3 gap-2 text-right">
                  <div className="rounded-lg border px-3 py-1.5">
                    <p className="text-[11px] text-muted-foreground">Limit</p>
                    <p className="text-sm font-semibold tabular-nums">{money(f.limitMinor)}</p>
                  </div>
                  <div className="rounded-lg border px-3 py-1.5">
                    <p className="text-[11px] text-muted-foreground">Outstanding</p>
                    <p className="text-sm font-semibold tabular-nums text-primary">{money(f.outstandingMinor)}</p>
                  </div>
                  <div className="rounded-lg border px-3 py-1.5">
                    <p className="text-[11px] text-muted-foreground">Available</p>
                    <p className="text-sm font-semibold tabular-nums">{money(f.availableMinor)}</p>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {f.status === 'OFFERED' && (
                <p className="rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:text-amber-200">
                  Waiting for the customer to accept the repayment terms. The facility activates only
                  when they accept: you cannot activate it for them.
                </p>
              )}

              {f.terms && !['PENDING_APPLICATION', 'OFFERED'].includes(f.status) && (
                <p className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">{f.terms}</p>
              )}

              {f.entries.length > 0 && <Ledger entries={f.entries.slice(0, 10)} />}

              <div className="flex flex-wrap justify-end gap-2">
                {f.status === 'PENDING_APPLICATION' && (
                  <Button className="min-h-11" onClick={() => setReviewTarget(f)}>
                    <BadgeCheck className="h-4 w-4" /> Review application
                  </Button>
                )}
                {f.status === 'ACTIVE' && (
                  <>
                    <Button variant="outline" className="min-h-11" onClick={() => setChargeTarget(f)}>
                      <HandCoins className="h-4 w-4" /> Record charge
                    </Button>
                    <Button variant="outline" className="min-h-11" onClick={() => setRepayTarget(f)}>
                      <Wallet className="h-4 w-4" /> Record repayment
                    </Button>
                    <Button variant="ghost" className="min-h-11 text-muted-foreground hover:text-destructive" onClick={() => setSuspendTarget(f)}>
                      Suspend
                    </Button>
                    <Button variant="ghost" className="min-h-11 text-muted-foreground hover:text-destructive" onClick={() => setCloseTarget(f)}>
                      Close
                    </Button>
                  </>
                )}
                {f.status === 'SUSPENDED' && (
                  <Button variant="outline" className="min-h-11" onClick={() => setRepayTarget(f)}>
                    <Wallet className="h-4 w-4" /> Record repayment
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}

      {/* Review / approve dialog */}
      {reviewTarget && (
        <ReviewDialog
          facility={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onApprove={async (terms, depositMinor) => {
            const done = await patch(reviewTarget, { action: 'approve', terms, depositMinor }, 'Offer sent to the customer')
            if (done) setReviewTarget(null)
          }}
          onReject={async (note) => {
            const done = await patch(reviewTarget, { action: 'reject', ...(note ? { note } : {}) }, 'Application rejected')
            if (done) setReviewTarget(null)
          }}
        />
      )}

      {/* Charge dialog */}
      {chargeTarget && (
        <ChargeDialog
          facility={chargeTarget}
          onClose={() => setChargeTarget(null)}
          onSubmit={async (payload) => {
            const done = await postEntry(chargeTarget, { kind: 'CHARGE', ...payload })
            if (done) setChargeTarget(null)
          }}
        />
      )}

      {/* Repayment dialog */}
      {repayTarget && (
        <RepayDialog
          facility={repayTarget}
          onClose={() => setRepayTarget(null)}
          onSubmit={async (amountMinor) => {
            const done = await postEntry(repayTarget, { kind: 'REPAYMENT', amountMinor })
            if (done) setRepayTarget(null)
          }}
        />
      )}

      {/* Suspend dialog */}
      {suspendTarget && (
        <NoteDialog
          title={`Suspend ${suspendTarget.customer.name}'s facility?`}
          description="New charges are blocked immediately. Outstanding balances still show in the customer's statement and repayments remain recordable."
          confirmLabel="Suspend facility"
          onClose={() => setSuspendTarget(null)}
          onSubmit={async (note) => {
            const done = await patch(suspendTarget, { action: 'suspend', ...(note ? { note } : {}) }, 'Facility suspended')
            if (done) setSuspendTarget(null)
          }}
        />
      )}

      {/* Close confirm */}
      <AlertDialog open={closeTarget !== null} onOpenChange={(o) => { if (!o) setCloseTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close {closeTarget?.customer.name}&apos;s facility?</AlertDialogTitle>
            <AlertDialogDescription>
              Closing is permanent. The balance must be cleared first: the ledger rejects closing a
              facility with outstanding amounts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep facility</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault()
                if (closeTarget) await patch(closeTarget, { action: 'close' }, 'Facility closed')
                setCloseTarget(null)
              }}
            >
              Close facility
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ───────────────────────────── ledger ─────────────────────────────

function Ledger({ entries }: { entries: CreditLedgerEntry[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="overflow-x-auto scrollbar-thin">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Balance after</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead>Paid at</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => {
              const isCharge = e.amountMinor > 0
              return (
                <TableRow key={e.id}>
                  <TableCell>
                    <span className={cn('font-medium', isCharge ? '' : 'text-emerald-700 dark:text-emerald-400')}>
                      {e.kind === 'CHARGE' ? 'Charge' : e.kind === 'REPAYMENT' ? 'Repayment' : e.kind}
                    </span>
                    {e.refType && <p className="text-xs text-muted-foreground">ref: {e.refType}</p>}
                  </TableCell>
                  <TableCell className={cn('text-right tabular-nums', !isCharge && 'text-emerald-700 dark:text-emerald-400')}>
                    {isCharge ? '' : '−'}{money(Math.abs(e.amountMinor))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(e.balanceAfterMinor)}</TableCell>
                  <TableCell className="text-sm">{e.dueDate ? dateLabel(e.dueDate) : 'Not provided'}</TableCell>
                  <TableCell className="text-sm">
                    {e.paidAt ? dateLabel(e.paidAt) : isCharge ? <span className="text-amber-700 dark:text-amber-400">unpaid</span> : 'Not provided'}
                  </TableCell>
                  <TableCell className="max-w-40">
                    <p className="truncate text-xs text-muted-foreground">{e.note ?? 'Not provided'}</p>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ───────────────────────── review (approve) dialog ─────────────────────────

function ReviewDialog({ facility, onClose, onApprove, onReject }: {
  facility: Facility
  onClose: () => void
  onApprove: (terms: string, depositMinor?: number) => Promise<void>
  onReject: (note: string) => Promise<void>
}) {
  const [terms, setTerms] = useState(
    'Repayment terms: amounts charged are due within 30 days of the charge. Late balances suspend further charges. Disputes are settled directly with the business before the ledger is adjusted.'
  )
  const [deposit, setDeposit] = useState('')
  const [rejectNote, setRejectNote] = useState('')
  const [busy, setBusy] = useState(false)
  const depositMinor = deposit.trim() === '' ? null : kesToMinor(deposit)
  const termsValid = terms.trim().length >= 10
  const depositValid = depositMinor === null || (depositMinor >= 0)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review credit application: {facility.customer.name}</DialogTitle>
          <DialogDescription>
            Requested limit {money(facility.limitMinor)} (set by the customer&apos;s application). You set
            the deposit and the repayment terms. Sending an offer does not activate anything; the
            customer must accept the terms first.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="credit-deposit">Refundable deposit (KES, optional)</Label>
            <Input id="credit-deposit" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="credit-terms">Repayment terms (minimum 10 characters)</Label>
            <Textarea id="credit-terms" rows={5} value={terms} onChange={(e) => setTerms(e.target.value)} />
            {!termsValid && <p className="text-xs text-rose-600 dark:text-rose-400">Terms must be at least 10 characters; write them as the customer will read them.</p>}
          </div>
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            Approve → sends the offer to the customer to accept. Reject → the customer is notified with your note.
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex w-full gap-2 sm:w-auto">
            <Input
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Rejection note (optional)"
              aria-label="Rejection note"
              className="h-9 flex-1"
            />
            <Button
              variant="ghost"
              className="min-h-11 text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={async () => { setBusy(true); try { await onReject(rejectNote.trim()) } finally { setBusy(false) } }}
            >
              Reject
            </Button>
          </div>
          <Button
            className="min-h-11"
            disabled={!termsValid || !depositValid || busy}
            onClick={async () => { setBusy(true); try { await onApprove(terms.trim(), depositMinor ?? undefined) } finally { setBusy(false) } }}
          >
            {busy ? 'Working…' : 'Approve & send offer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────── charge / repay dialogs ─────────────────────────

function ChargeDialog({ facility, onClose, onSubmit }: {
  facility: Facility
  onClose: () => void
  onSubmit: (payload: { amountMinor: number; dueDate?: string; refType?: string; note?: string }) => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [refType, setRefType] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const amountMinor = kesToMinor(amount)
  const valid = amountMinor !== null && amountMinor >= 100 && amountMinor <= facility.availableMinor

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a charge: {facility.customer.name}</DialogTitle>
          <DialogDescription>
            {money(facility.availableMinor)} available of the {money(facility.limitMinor)} limit. The
            ledger enforces the limit: a charge beyond it is rejected.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="charge-amount">Amount (KES)</Label>
            <Input id="charge-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(facility.availableMinor / 100).toLocaleString()} />
            {!valid && amount !== '' && (
              <p className="text-xs text-rose-600 dark:text-rose-400">
                Enter between 1 and {(facility.availableMinor / 100).toLocaleString()} KES.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="charge-due">Due date</Label>
              <Input id="charge-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="charge-ref">Reference (optional)</Label>
              <Input id="charge-ref" value={refType} onChange={(e) => setRefType(e.target.value)} placeholder="e.g. SERVICE, BOOKING" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="charge-note">Note (optional)</Label>
            <Input id="charge-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the charge is for" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="min-h-11"
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onSubmit({
                  amountMinor: amountMinor!,
                  ...(dueDate ? { dueDate } : {}),
                  ...(refType.trim() ? { refType: refType.trim().toUpperCase() } : {}),
                  ...(note.trim() ? { note: note.trim() } : {}),
                })
              } finally { setBusy(false) }
            }}
          >
            {busy ? 'Recording…' : 'Record charge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RepayDialog({ facility, onClose, onSubmit }: {
  facility: Facility
  onClose: () => void
  onSubmit: (amountMinor: number) => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const amountMinor = kesToMinor(amount)
  const valid = amountMinor !== null && amountMinor >= 100 && amountMinor <= facility.outstandingMinor

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a repayment: {facility.customer.name}</DialogTitle>
          <DialogDescription>
            Outstanding balance {money(facility.outstandingMinor)}. Repayments are appended to the
            ledger immediately and reduce the balance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="biz-repay-amount">Amount (KES)</Label>
          <Input id="biz-repay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(facility.outstandingMinor / 100).toLocaleString()} />
          {!valid && amount !== '' && (
            <p className="text-xs text-rose-600 dark:text-rose-400">
              Enter between 1 and {(facility.outstandingMinor / 100).toLocaleString()} KES.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="min-h-11"
            disabled={!valid || busy}
            onClick={async () => { setBusy(true); try { await onSubmit(amountMinor!) } finally { setBusy(false) } }}
          >
            {busy ? 'Recording…' : 'Record repayment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────── note dialog (suspend) ─────────────────────────

function NoteDialog({ title, description, confirmLabel, onClose, onSubmit }: {
  title: string
  description: string
  confirmLabel: string
  onClose: () => void
  onSubmit: (note: string) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" /> {title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="suspend-note">Note to the customer (optional)</Label>
          <Input id="suspend-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contact us for details" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            className="min-h-11"
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onSubmit(note.trim()) } finally { setBusy(false) } }}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
