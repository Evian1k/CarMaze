'use client'

/* Shared two-pane messaging panel used by the business portals
 * (scope='org' — garage / dealer inboxes) and the customer dashboards
 * (scope='mine'). Talks to /api/conversations only; no view-specific logic.
 *
 * Exports:
 *  - MessagesTab            drop-in tab content for any dashboard
 *  - ConversationPanel      the raw panel (used by MessagesTab)
 *  - useUnreadConversations live unread counter for tab badges
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft, Check, FileText, Loader2, MessageSquareText, MessagesSquare,
  Paperclip, Phone, Search, Send, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { apiGet, apiSend, apiUpload, navigate } from '@/lib/client'
import { money, timeAgo } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { CountUp } from '@/components/motion/reveal'

// ───────────────────────────── Types (API contract) ─────────────────────────────

export type ConversationSummary = {
  id: string
  orgId: string
  orgName: string
  orgType: string
  customerId?: string
  customerName?: string
  subject: string | null
  kind: string
  lastMessageAt: string
  lastMessagePreview: string
  unreadForCustomer?: number
  unreadForOrg?: number
  status: string
}

export type ConversationMessage = {
  id: string
  senderId: string
  senderName: string
  senderSide: 'CUSTOMER' | 'ORG' | 'SYSTEM'
  body: string
  attachments: string[]
  createdAt: string
}

export type ConversationThread = {
  conversation: {
    id: string
    orgId: string
    orgName: string
    orgType: string
    orgPhone: string | null
    whatsappEnabled: boolean
    callEnabled: boolean
    customerId: string
    customerName: string
    subject: string | null
    kind: string
    status: string
    vehicle: { id: string; make: string; model: string; year: number; priceMinor: number; currency: string; photo: string | null } | null
    serviceTitle: string | null
  }
  messages: ConversationMessage[]
}

export type MsgScope = 'mine' | 'org'

const KIND_LABELS: Record<string, string> = {
  VEHICLE_ENQUIRY: 'Vehicle enquiry',
  GENERAL: 'General',
  SUPPORT: 'Support',
  SERVICE: 'Service',
  TEST_DRIVE: 'Test drive',
  CUSTODY: 'Custody',
  OFFER: 'Offer',
  OTHER: 'Other',
}

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.charAt(0) + kind.replaceAll('_', ' ').slice(1).toLowerCase()
}

function unreadOf(c: ConversationSummary, scope: MsgScope): number {
  return (scope === 'org' ? c.unreadForOrg : c.unreadForCustomer) ?? 0
}

function displayNameOf(c: ConversationSummary, scope: MsgScope): string {
  return scope === 'org' ? (c.customerName ?? 'Customer') : c.orgName
}

function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url) || url.startsWith('data:image/')
}

function attachmentName(url: string): string {
  try {
    const clean = url.split('?')[0]
    return decodeURIComponent(clean.split('/').pop() ?? 'attachment') || 'attachment'
  } catch {
    return 'attachment'
  }
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (same(d, today)) return 'Today'
  if (same(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' })
}

// ───────────────────────────── Unread hook (for tab badges) ─────────────────────────────

export function useUnreadConversations(scope: MsgScope): number {
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      apiGet<{ conversations: ConversationSummary[] }>(`/api/conversations?scope=${scope}`)
        .then((d) => {
          if (cancelled) return
          setUnread(d.conversations.reduce((sum, c) => sum + unreadOf(c, scope), 0))
        })
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 20_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [scope])

  return unread
}

// ───────────────────────────── MessagesTab ─────────────────────────────

export function MessagesTab({ scope }: { scope: MsgScope }) {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    apiGet<{ conversations: ConversationSummary[] }>(`/api/conversations?scope=${scope}`)
      .then((d) => {
        if (cancelled) return
        setConversations(d.conversations)
        setUnavailable(false)
      })
      .catch(() => {
        if (cancelled) return
        setConversations([])
        setUnavailable(true)
      })
    return () => {
      cancelled = true
    }
  }, [scope, tick])

  useEffect(() => {
    const t = setInterval(() => setTick((k) => k + 1), 20_000)
    return () => clearInterval(t)
  }, [])

  const reload = useCallback(() => setTick((k) => k + 1), [])

  const unread = useMemo(
    () => (conversations ?? []).reduce((sum, c) => sum + unreadOf(c, scope), 0),
    [conversations, scope],
  )

  return (
    <div className="space-y-4">
      <div className="grid max-w-xs grid-cols-2 gap-3" aria-label="Message summary">
        <div className="rounded-xl border bg-card p-3">
          <p className="text-2xl font-bold tabular-nums">
            <CountUp value={conversations?.length ?? 0} />
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Conversations</p>
        </div>
        <div className={cn('rounded-xl border p-3', unread > 0 && 'border-accent/60 bg-accent/10')}>
          <p className="flex items-center gap-1.5 text-2xl font-bold tabular-nums">
            <CountUp value={unread} />
            {unread > 0 && <UnreadPulseDot />}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Unread {scope === 'org' ? 'from customers' : 'from businesses'}</p>
        </div>
      </div>

      <ConversationPanel
        scope={scope}
        conversations={conversations}
        unavailable={unavailable}
        onChanged={reload}
        onMarkRead={(id) => setConversations((prev) =>
          prev ? prev.map((c) => (c.id === id ? { ...c, ...(scope === 'org' ? { unreadForOrg: 0 } : { unreadForCustomer: 0 }) } : c)) : prev,
        )}
      />
    </div>
  )
}

function UnreadPulseDot() {
  const reduce = useReducedMotion()
  if (reduce) return <span className="inline-flex h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
  return (
    <span className="relative inline-flex h-2 w-2" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
    </span>
  )
}

// ───────────────────────────── ConversationPanel ─────────────────────────────

export function ConversationPanel({ scope, conversations, unavailable, onChanged, onMarkRead }: {
  scope: MsgScope
  conversations: ConversationSummary[] | null
  unavailable?: boolean
  onChanged?: () => void
  onMarkRead?: (id: string) => void
}) {
  const reduce = useReducedMotion()
  const [search, setSearch] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [thread, setThread] = useState<ConversationThread | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [pendingFiles, setPendingFiles] = useState<{ url: string; name: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewerSide: 'CUSTOMER' | 'ORG' = scope === 'org' ? 'ORG' : 'CUSTOMER'

  const loadThread = useCallback(async (id: string, silent = false) => {
    if (!silent) setThreadLoading(true)
    try {
      const d = await apiGet<ConversationThread>(`/api/conversations/${id}`)
      setThread(d)
      // Fetching marks the thread read server-side — reflect it in the list immediately.
      onMarkRead?.(id)
    } catch {
      if (!silent) toast.error('Could not open the conversation.')
    } finally {
      if (!silent) setThreadLoading(false)
    }
  }, [onMarkRead])

  useEffect(() => {
    if (!activeId) return
    loadThread(activeId)
  }, [activeId, loadThread])

  // Live-ish feel: poll the open thread every 8 seconds (with cleanup).
  useEffect(() => {
    if (!activeId) return
    const t = setInterval(() => loadThread(activeId, true), 8_000)
    return () => clearInterval(t)
  }, [activeId, loadThread])

  // Auto-scroll to the newest message when the thread updates or opens.
  const messageCount = thread?.messages.length ?? 0
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? ('instant' as ScrollBehavior) : 'smooth' })
  }, [messageCount, activeId, reduce])

  const list = useMemo(
    () => [...(conversations ?? [])].sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()),
    [conversations],
  )
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((c) =>
      `${displayNameOf(c, scope)} ${c.subject ?? ''} ${c.kind} ${c.lastMessagePreview}`.toLowerCase().includes(q),
    )
  }, [list, search, scope])

  const active = thread?.conversation ?? null
  const closed = active ? active.status !== 'OPEN' : false

  async function sendMessage() {
    if (!activeId || sending) return
    const body = draft.trim()
    if (!body && pendingFiles.length === 0) return
    setSending(true)
    try {
      await apiSend(`/api/conversations/${activeId}`, 'POST', {
        body,
        attachments: pendingFiles.length > 0 ? pendingFiles.map((f) => f.url) : undefined,
      })
      setDraft('')
      setPendingFiles([])
      await loadThread(activeId, true)
      onChanged?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send the message.')
    } finally {
      setSending(false)
    }
  }

  async function uploadAttachment(file: File) {
    if (pendingFiles.length >= 5) {
      toast.error('Maximum 5 attachments per message.')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const d = await apiUpload<{ url: string; name: string }>('/api/upload', fd)
      setPendingFiles((prev) => [...prev, { url: d.url, name: d.name || file.name }])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function statusAction(action: 'close' | 'reopen' | 'archive' | 'unarchive') {
    if (!activeId) return
    setBusyAction(action)
    try {
      await apiSend(`/api/conversations/${activeId}`, 'PATCH', { action })
      toast.success(
        action === 'close' ? 'Conversation closed'
          : action === 'reopen' ? 'Conversation reopened'
            : action === 'archive' ? 'Conversation archived' : 'Conversation restored',
      )
      await loadThread(activeId, true)
      onChanged?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setBusyAction(null)
    }
  }

  const total = conversations?.length ?? 0

  // ── Loading / empty / unavailable states ──
  if (conversations === null) {
    return (
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-2">
          <Skeleton className="h-10 w-full rounded-lg" />
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
        <Skeleton className="hidden h-96 rounded-xl lg:block" />
      </div>
    )
  }

  if (unavailable && total === 0) {
    return (
      <EmptyMessaging
        icon={<MessagesSquare className="h-7 w-7" />}
        title="Messaging is connecting"
        desc="The messaging service is being integrated on this deployment. Your conversations will appear here the moment it is live."
      />
    )
  }

  if (total === 0) {
    return scope === 'mine' ? (
      <EmptyMessaging
        icon={<MessagesSquare className="h-7 w-7" />}
        title="No conversations yet"
        desc="When you ask about a vehicle or book a service, the conversation with the business lands here — with photos, files and the vehicle reference attached."
        actionLabel="Browse cars"
        onAction={() => navigate('cars')}
      />
    ) : (
      <EmptyMessaging
        icon={<MessagesSquare className="h-7 w-7" />}
        title="No customer messages yet"
        desc="Enquiries and follow-ups from customers about your listings and services appear here. Fast replies win the sale."
      />
    )
  }

  return (
    <div className={cn('grid h-[74vh] min-h-[560px] overflow-hidden rounded-xl border bg-card', 'lg:grid-cols-[340px_1fr]')}>
      {/* ── List pane ── */}
      <div className={cn('flex min-h-0 flex-col border-r', activeId !== null && 'hidden lg:flex')}>
        <div className="border-b p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={scope === 'org' ? 'Search customers or subjects…' : 'Search garages, dealers, subjects…'}
              className="pl-9"
              aria-label="Search conversations"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 scrollbar-thin" role="list" aria-label="Conversations">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No conversations match “{search.trim()}”.</p>
          ) : (
            filtered.map((c, i) => {
              const unread = unreadOf(c, scope)
              const isActive = c.id === activeId
              return (
                <motion.button
                  key={c.id}
                  role="listitem"
                  initial={reduce ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.3), ease: 'easeOut' }}
                  onClick={() => setActiveId(c.id)}
                  aria-current={isActive}
                  className={cn(
                    'block w-full rounded-xl border p-3 text-left transition-colors',
                    isActive ? 'border-primary/60 bg-primary/5' : 'border-transparent hover:bg-muted/60',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
                      {unread > 0 && <UnreadPulseDot />}
                      <span className="truncate">{displayNameOf(c, scope)}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(c.lastMessageAt)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">{kindLabel(c.kind)}</Badge>
                    {c.status !== 'OPEN' && (
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">{c.status.toLowerCase()}</Badge>
                    )}
                    {unread > 0 && (
                      <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.lastMessagePreview || 'No messages yet'}</p>
                </motion.button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Thread pane ── */}
      <AnimatePresence mode="wait" initial={false}>
        {activeId === null ? (
          <motion.div
            key="placeholder"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="hidden flex-col items-center justify-center p-8 text-center lg:flex"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <MessageSquareText className="h-6 w-6" aria-hidden="true" />
            </span>
            <h3 className="mt-3 font-semibold">Select a conversation</h3>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Pick a thread to read and reply. New messages arrive live while the thread is open.
            </p>
          </motion.div>
        ) : (
          <motion.div
            key={activeId}
            initial={reduce ? false : { opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex min-h-0 flex-col"
          >
            {/* Header */}
            <div className="border-b p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 lg:hidden"
                    aria-label="Back to conversations"
                    onClick={() => { setActiveId(null); setThread(null) }}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="truncate text-sm font-bold">
                        {active ? (scope === 'org' ? active.customerName : active.orgName) : 'Conversation'}
                      </h3>
                      {active && (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">{kindLabel(active.kind)}</Badge>
                      )}
                      {active && (
                        <Badge
                          variant="secondary"
                          className={cn(
                            'px-1.5 py-0 text-[10px] font-normal',
                            !closed && 'border-transparent bg-primary/15 text-primary dark:text-[#9dc3ae]',
                          )}
                        >
                          {active.status.toLowerCase()}
                        </Badge>
                      )}
                    </div>
                    {active?.subject && <p className="mt-0.5 truncate text-xs text-muted-foreground">{active.subject}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {active && scope === 'mine' && active.orgPhone && (active.callEnabled || active.whatsappEnabled) && (
                    <>
                      {active.whatsappEnabled && (
                        <Button asChild variant="outline" size="icon" className="h-9 w-9">
                          <a
                            href={`https://wa.me/${active.orgPhone.replace(/[^\d]/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Chat on WhatsApp"
                          >
                            <MessageSquareText className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      {active.callEnabled && (
                        <Button asChild variant="outline" size="icon" className="h-9 w-9">
                          <a href={`tel:${active.orgPhone}`} aria-label={`Call ${active.orgName}`}>
                            <Phone className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                    </>
                  )}
                  {active && !closed && (
                    <Button variant="ghost" size="sm" className="h-9 min-h-9 gap-1 text-xs" disabled={busyAction !== null} onClick={() => statusAction('close')}>
                      <X className="h-3.5 w-3.5" /> Close
                    </Button>
                  )}
                  {active && closed && active.status !== 'ARCHIVED' && (
                    <Button variant="ghost" size="sm" className="h-9 min-h-9 gap-1 text-xs" disabled={busyAction !== null} onClick={() => statusAction('reopen')}>
                      <Check className="h-3.5 w-3.5" /> Reopen
                    </Button>
                  )}
                  {active && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hidden h-9 w-9 sm:inline-flex"
                      aria-label={active.status === 'ARCHIVED' ? 'Unarchive conversation' : 'Archive conversation'}
                      title={active.status === 'ARCHIVED' ? 'Unarchive' : 'Archive'}
                      disabled={busyAction !== null}
                      onClick={() => statusAction(active.status === 'ARCHIVED' ? 'unarchive' : 'archive')}
                    >
                      {busyAction === 'archive' || busyAction === 'unarchive'
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <FileText className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
              </div>

              {/* Vehicle / service context chip */}
              {active && (active.vehicle || active.serviceTitle) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {active.vehicle && (
                    <button
                      onClick={() => navigate(`vehicle-detail/${active.vehicle!.id}`)}
                      className="flex items-center gap-2 rounded-full border bg-muted/50 py-1 pl-1 pr-3 text-xs transition-colors hover:bg-muted"
                      aria-label={`Open ${active.vehicle.make} ${active.vehicle.model}`}
                    >
                      {active.vehicle.photo ? (
                         
                        <img src={active.vehicle.photo} alt="" className="h-6 w-8 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">V</span>
                      )}
                      <span className="font-medium">
                        {active.vehicle.make} {active.vehicle.model} {active.vehicle.year}
                      </span>
                      <span className="text-muted-foreground">· {money(active.vehicle.priceMinor, active.vehicle.currency)}</span>
                    </button>
                  )}
                  {active.serviceTitle && (
                    <span className="rounded-full border bg-muted/50 px-2.5 py-1 text-xs">{active.serviceTitle}</span>
                  )}
                </div>
              )}
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-muted/30 p-3 scrollbar-thin" aria-live="polite">
              {threadLoading && !thread ? (
                <div className="space-y-3 pt-2">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className={cn('h-14 rounded-2xl', i % 2 ? 'ml-auto w-2/3' : 'w-1/2')} />)}
                </div>
              ) : (
                <>
                  {thread?.messages.map((m, i) => {
                    const prev = thread.messages[i - 1]
                    const showDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)
                    const mine = m.senderSide === viewerSide
                    const system = m.senderSide === 'SYSTEM'
                    return (
                      <div key={m.id}>
                        {showDay && (
                          <div className="my-3 flex justify-center">
                            <span className="rounded-full bg-background px-3 py-1 text-[10px] font-medium text-muted-foreground shadow-sm">
                              {dayLabel(m.createdAt)}
                            </span>
                          </div>
                        )}
                        {system ? (
                          <div className="flex justify-center py-1">
                            <p className="max-w-md rounded-full border bg-background px-3 py-1 text-center text-[11px] text-muted-foreground">
                              {m.body}
                            </p>
                          </div>
                        ) : (
                          <motion.div
                            initial={reduce ? false : { opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.25, ease: 'easeOut' }}
                            className={cn('flex', mine ? 'justify-end' : 'justify-start')}
                          >
                            <div className={cn('max-w-[82%] sm:max-w-[72%]', mine ? 'items-end' : 'items-start')}>
                              {!mine && (
                                <p className="mb-0.5 px-1 text-[10px] font-semibold text-muted-foreground">{m.senderName}</p>
                              )}
                              <div
                                className={cn(
                                  'rounded-2xl px-3 py-2 text-sm shadow-sm',
                                  mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border bg-card',
                                )}
                              >
                                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                                {m.attachments.length > 0 && (
                                  <div className={cn('mt-1.5 flex flex-wrap gap-1.5', !m.body && 'mt-0')}>
                                    {m.attachments.map((url) =>
                                      isImageUrl(url) ? (
                                        <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
                                          { }
                                          <img
                                            src={url}
                                            alt="Attachment"
                                            className="h-24 w-32 rounded-lg border object-cover transition-transform hover:scale-[1.02]"
                                          />
                                        </a>
                                      ) : (
                                        <a
                                          key={url}
                                          href={url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className={cn(
                                            'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs underline-offset-2 hover:underline',
                                            mine ? 'border-primary-foreground/30' : 'bg-muted/60',
                                          )}
                                        >
                                          <FileText className="h-3.5 w-3.5 shrink-0" />
                                          <span className="max-w-40 truncate">{attachmentName(url)}</span>
                                        </a>
                                      ),
                                    )}
                                  </div>
                                )}
                                <p className={cn('mt-1 text-right text-[10px]', mine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                                  {timeLabel(m.createdAt)}
                                </p>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    )
                  })}
                  {thread && thread.messages.length === 0 && (
                    <p className="py-10 text-center text-sm text-muted-foreground">No messages yet — say hello.</p>
                  )}
                </>
              )}
            </div>

            {/* Composer */}
            <div className="border-t p-3">
              {closed && (
                <p className="mb-2 rounded-lg border bg-muted/50 px-3 py-2 text-center text-xs text-muted-foreground">
                  This conversation is {active?.status.toLowerCase()} — reopen it to send a new message.
                </p>
              )}
              {pendingFiles.length > 0 && (
                <ul className="mb-2 flex flex-wrap gap-1.5">
                  {pendingFiles.map((f, i) => (
                    <li key={f.url} className="flex items-center gap-1 rounded-full border bg-muted/60 py-1 pl-2.5 pr-1 text-xs">
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="max-w-36 truncate">{f.name}</span>
                      <button
                        className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-background"
                        aria-label={`Remove attachment ${f.name}`}
                        onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-end gap-1.5">
                <label
                  className={cn(
                    'flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-muted',
                    (uploading || closed || pendingFiles.length >= 5) && 'pointer-events-none opacity-50',
                  )}
                  aria-label="Attach a file"
                  title="Attach a file (max 5 per message)"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                  <input
                    type="file"
                    className="sr-only"
                    accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                    disabled={uploading || closed}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) uploadAttachment(f)
                      e.currentTarget.value = ''
                    }}
                  />
                </label>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"
                  rows={1}
                  disabled={closed}
                  className="max-h-32 min-h-11 flex-1 resize-none py-2.5"
                  aria-label="Message"
                />
                <Button
                  onClick={sendMessage}
                  disabled={sending || closed || (!draft.trim() && pendingFiles.length === 0)}
                  className="h-11 w-11 shrink-0 p-0"
                  aria-label="Send message"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ───────────────────────────── Empty state ─────────────────────────────

function EmptyMessaging({ icon, title, desc, actionLabel, onAction }: {
  icon: React.ReactNode
  title: string
  desc: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</span>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">{desc}</p>
      {actionLabel && onAction && (
        <Button className="mt-5 min-h-11" variant="outline" onClick={onAction}>{actionLabel}</Button>
      )}
    </div>
  )
}
