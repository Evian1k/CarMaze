/**
 * Verification Center: the dedicated document verification management console
 * for platform reviewers (part of the Super Admin / Operations OS).
 *
 * Features:
 * - Review queue of every submitted/under-review/more-info document
 * - Inline document preview (private /api/files URL: uploader or staff only)
 * - Full state machine actions: start review, verify (+expiry), reject,
 *   request info (+due date): every decision records actor, time and reason
 * - Access history per document (who viewed, when)
 * - Filters: status, kind, text search; expired docs are auto-lapsed
 */
import { useCallback, useEffect, useState } from 'react'
import {
  BadgeCheck,
  Eye,
  FileQuestion,
  FileSearch,
  RefreshCw,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { apiGet, apiSend } from '@/lib/client'
import { timeAgo, dateLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Doc = {
  id: string
  refCode: string
  kind: string
  label: string | null
  fileUrl: string
  fileName: string
  status: string
  reviewNote: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  expiresAt: string | null
  infoRequestedAt: string | null
  correctionsDueAt: string | null
  createdAt: string
  owner: { id: string; name: string; email: string; phone: string | null }
  application: { id: string; refCode: string; type: string; orgName: string; status: string } | null
  org: { id: string; name: string; type: string } | null
}

type AccessLog = { id: string; viewerName: string; action: string; createdAt: string }

const KIND_LABELS: Record<string, string> = {
  ID_FRONT: 'ID: front', ID_BACK: 'ID: back', PASSPORT: 'Passport',
  PIN_CERTIFICATE: 'KRA PIN certificate', BUSINESS_LICENSE: 'Business license',
  DIRECTOR_ID: 'Director ID', LOGBOOK: 'Vehicle logbook', OWNERSHIP_AUTH: 'Ownership authorisation',
  DRIVER_LICENSE: 'Driver license', INSURANCE: 'Insurance', VEHICLE_REG: 'Vehicle registration',
  REGISTRATION_CERT: 'Registration certificate', SUPPORTING: 'Supporting', OTHER: 'Other',
}

const STATUS_TONES: Record<string, string> = {
  SUBMITTED: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  UNDER_REVIEW: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30',
  MORE_INFO_REQUIRED: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
  VERIFIED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  REJECTED: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
  EXPIRED: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
  SUPERSEDED: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
}

const ACTIVE = ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED']

export function VerificationCenter() {
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [counts, setCounts] = useState<{ total: number; pending: number } | null>(null)
  const [status, setStatus] = useState('SUBMITTED')
  const [kind, setKind] = useState('all')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Doc | null>(null)
  const [logs, setLogs] = useState<AccessLog[]>([])
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [dueDays, setDueDays] = useState('7')
  const [expiry, setExpiry] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ scope: 'queue' })
      if (status !== 'all') params.set('status', status)
      if (kind !== 'all') params.set('kind', kind)
      if (q.trim()) params.set('q', q.trim())
      const d = await apiGet<{ documents: Doc[]; counts: { total: number; pending: number } }>(`/api/documents?${params.toString()}`)
      setDocs(d.documents)
      setCounts(d.counts)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load documents')
      setDocs([])
    }
  }, [status, kind, q])

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  async function openDoc(d: Doc) {
    setSelected(d)
    setNote('')
    setExpiry('')
    try {
      const res = await apiGet<{ document: Doc; accessLogs: AccessLog[] }>(`/api/documents/${d.id}`)
      setSelected(res.document)
      setLogs(res.accessLogs)
    } catch {
      // detail load is best-effort; the row data is already shown
    }
  }

  async function act(action: string, extra?: Record<string, unknown>) {
    if (!selected) return
    setBusy(action)
    try {
      const res = await apiSend<{ document: Doc }>(`/api/documents/${selected.id}`, 'PATCH', { action, ...extra })
      setSelected(res.document)
      toast.success(`Document ${action.replace('_', ' ')}: decision recorded`)
      setNote('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy('')
    }
  }

  const activeDocs = (docs ?? []).filter((d) => ACTIVE.includes(d.status))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FileSearch className="h-5 w-5 text-primary" aria-hidden="true" /> Verification Center
          </h2>
          <p className="text-sm text-muted-foreground">
            Document review pipeline. Uploading never verifies: only a recorded reviewer decision does.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {counts && (
            <>
              <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
                {counts.pending} pending
              </Badge>
              <Badge variant="outline">{counts.total} total</Badge>
            </>
          )}
          <Button variant="outline" size="sm" onClick={load} aria-label="Reload queue">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full max-w-60">
          <Label htmlFor="vc-status">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="vc-status" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="SUBMITTED">Submitted</SelectItem>
              <SelectItem value="UNDER_REVIEW">Under review</SelectItem>
              <SelectItem value="MORE_INFO_REQUIRED">More info required</SelectItem>
              <SelectItem value="VERIFIED">Verified</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="EXPIRED">Expired</SelectItem>
              <SelectItem value="SUPERSEDED">Superseded</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-full max-w-56">
          <Label htmlFor="vc-kind">Kind</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger id="vc-kind" aria-label="Filter by document kind"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-48 flex-1">
          <Label htmlFor="vc-q" className="sr-only">Search documents</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input id="vc-q" className="pl-8" placeholder="Search ref, owner, file…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      {docs === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : docs.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No documents match this filter. Submitted application documents land here automatically.
        </Card>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <Card key={d.id} className={`p-3 transition-colors hover:bg-muted/40 ${ACTIVE.includes(d.status) ? 'border-l-4 border-l-amber-500/60' : ''}`}>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="outline" className={`shrink-0 ${STATUS_TONES[d.status] ?? ''}`}>{d.status.replace(/_/g, ' ')}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {KIND_LABELS[d.kind] ?? d.kind}{d.label ? ` · ${d.label}` : ''}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {d.refCode} · {d.owner.name} ({d.owner.email})
                    {d.application ? ` · application ${d.application.refCode} (${d.application.type})` : ''}
                    {d.org ? ` · ${d.org.name}` : ''} · uploaded {timeAgo(d.createdAt)}
                    {d.reviewedByName ? ` · decided by ${d.reviewedByName}` : ''}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => openDoc(d)}>
                  <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Review
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(v) => { if (!v) { setSelected(null); setPreviewUrl(null) } }}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
                  <Badge variant="outline" className={STATUS_TONES[selected.status] ?? ''}>{selected.status.replace(/_/g, ' ')}</Badge>
                  {selected.refCode}: {KIND_LABELS[selected.kind] ?? selected.kind}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-1 text-sm">
                <p><span className="text-muted-foreground">Owner:</span> {selected.owner.name} · {selected.owner.email}{selected.owner.phone ? ` · ${selected.owner.phone}` : ''}</p>
                {selected.application && (
                  <p><span className="text-muted-foreground">Application:</span> {selected.application.refCode} ({selected.application.type}), {selected.application.orgName} · status {selected.application.status}</p>
                )}
                {selected.expiresAt && <p><span className="text-muted-foreground">Valid until:</span> {dateLabel(selected.expiresAt)}</p>}
                {selected.reviewNote && <p><span className="text-muted-foreground">Last decision note:</span> {selected.reviewNote}</p>}
              </div>

              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm">{selected.fileName}</p>
                  <Button size="sm" variant="outline" onClick={() => setPreviewUrl(previewUrl ? null : selected.fileUrl)}>
                    <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {previewUrl ? 'Hide' : 'View document'}
                  </Button>
                </div>
                {previewUrl && (
                  <div className="mt-3 max-h-72 overflow-auto rounded border bg-background">
                    {selected.fileUrl.endsWith('.pdf') ? (
                      <iframe src={previewUrl} title={`Document ${selected.refCode}`} className="h-72 w-full" />
                    ) : (
                       
                      <img src={previewUrl} alt={`Document ${selected.refCode}`} className="max-h-72 w-full object-contain" />
                    )}
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Served via the permissioned private-files endpoint: every staff view is recorded in the access history.
                </p>
              </div>

              {ACTIVE.includes(selected.status) && (
                <div className="space-y-3 rounded-lg border p-3">
                  <p className="text-sm font-medium">Reviewer decision</p>
                  <div>
                    <Label htmlFor="vc-note">Decision note {selected.status === 'SUBMITTED' ? '(optional for starting review)' : '(recorded with the decision)'}</Label>
                    <Textarea id="vc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Business license matches registry search; PIN certificate name matches director ID." />
                  </div>
                  {selected.status === 'SUBMITTED' && (
                    <Button size="sm" disabled={busy !== ''} onClick={() => act('start_review', note ? { note } : {})}>
                      <FileSearch className="mr-1.5 h-4 w-4" aria-hidden="true" /> Start review
                    </Button>
                  )}
                  {selected.status !== 'SUBMITTED' && (
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <Label htmlFor="vc-expiry" className="text-xs">Expiry (optional)</Label>
                        <Input id="vc-expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-40" />
                      </div>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy !== ''} onClick={() => act('verify', { note: note || undefined, expiresAt: expiry ? new Date(expiry).toISOString() : undefined })}>
                        <BadgeCheck className="mr-1.5 h-4 w-4" aria-hidden="true" /> Verify
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busy !== '' || note.trim().length < 10} onClick={() => act('reject', { note })} title={note.trim().length < 10 ? 'A reason of at least 10 characters is required' : ''}>
                        <XCircle className="mr-1.5 h-4 w-4" aria-hidden="true" /> Reject
                      </Button>
                      <div className="flex items-end gap-1">
                        <div>
                          <Label htmlFor="vc-due" className="text-xs">Due in days</Label>
                          <Input id="vc-due" inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} className="w-20" />
                        </div>
                        <Button size="sm" variant="outline" disabled={busy !== '' || note.trim().length < 10} onClick={() => act('request_info', { note, dueDays: Number(dueDays) || 7 })} title={note.trim().length < 10 ? 'State what is missing (min 10 chars)' : ''}>
                          <FileQuestion className="mr-1.5 h-4 w-4" aria-hidden="true" /> Request info
                        </Button>
                      </div>
                    </div>
                  )}
                  {selected.status === 'VERIFIED' && (
                    <Button size="sm" variant="outline" disabled={busy !== '' || note.trim().length < 5} onClick={() => act('expire', { note })}>
                      <ShieldAlert className="mr-1.5 h-4 w-4" aria-hidden="true" /> Mark expired
                    </Button>
                  )}
                  {activeDocs.length > 1 && (
                    <p className="text-xs text-muted-foreground">{activeDocs.length - 1} other document(s) still pending across the queue.</p>
                  )}
                </div>
              )}

              {selected.status === 'MORE_INFO_REQUIRED' && (
                <div className="rounded-lg border border-orange-500/40 bg-orange-500/5 p-3 text-sm">
                  <p className="font-medium text-orange-700 dark:text-orange-400">Waiting for the applicant</p>
                  <p className="text-muted-foreground">
                    Requested {selected.infoRequestedAt ? timeAgo(selected.infoRequestedAt) : 'recently'}{selected.correctionsDueAt ? ` · due ${dateLabel(selected.correctionsDueAt)}` : ''}.
                    The applicant submits a replacement document through their portal; the replacement appears as a new SUBMITTED entry.
                  </p>
                </div>
              )}

              {logs.length > 0 && (
                <div>
                  <p className="mb-1.5 text-sm font-medium">Access history</p>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2 text-xs text-muted-foreground">
                    {logs.map((l) => (
                      <p key={l.id}>{l.viewerName}: {l.action.replace('_', ' ').toLowerCase()} · {timeAgo(l.createdAt)}</p>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
