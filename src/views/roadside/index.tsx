'use client'

/* Roadside: honest roadside assistance coordination. CARMAZE connects
 * drivers with independent garages offering TOWING/ROADSIDE services.
 * Not an emergency service. Data: /api/roadside. */

import { useCallback, useEffect, useState } from 'react'
import {
  LifeBuoy, Phone, MapPin, ShieldCheck, Clock, CheckCircle2, Wrench, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Reveal } from '@/components/motion/reveal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/stores/auth'
import { apiGet, apiSend, navigate, buildQuery } from '@/lib/client'
import { timeAgo, KENYA_COUNTIES } from '@/lib/format'

const ISSUES = ['TOW', 'FLAT_TYRE', 'BATTERY', 'FUEL', 'ENGINE', 'LOCKOUT', 'OTHER'] as const
const ISSUE_LABELS: Record<(typeof ISSUES)[number], string> = {
  TOW: 'Towing needed',
  FLAT_TYRE: 'Flat tyre',
  BATTERY: 'Battery / won\u2019t start',
  FUEL: 'Out of fuel',
  ENGINE: 'Engine breakdown',
  LOCKOUT: 'Locked out',
  OTHER: 'Other issue',
}

const DISCLAIMER =
  'CARMAZE connects you with independent providers: this is not an emergency service. For emergencies call 999/112.'

type Provider = {
  id: string; name: string; phone: string | null; county: string; town: string | null; location: string | null
  services: { category: string; title: string; priceFromMinor: number | null }[]
}
type RoadsideRequest = {
  id: string; refCode: string; county: string; location: string; issue: string; details: string | null
  status: string; providerNote: string | null; acceptedAt: string | null; completedAt: string | null; createdAt: string
  provider: { id: string; name: string; phone: string | null; county: string; town: string | null; location: string | null } | null
}

const STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Requested', ACCEPTED: 'Accepted', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
}

export default function RoadsideView() {
  const { user, loading } = useAuth()
  const [providers, setProviders] = useState<Provider[] | null>(null)
  // Honest failure state: a failed load must not look like "no providers yet".
  const [loadError, setLoadError] = useState(false)
  const [feed, setFeed] = useState<{ userId: string; requests: RoadsideRequest[]; tick: number } | null>(null)
  const [tick, setTick] = useState(0)
  const [created, setCreated] = useState<{ refCode: string; status: string } | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<{ providers: Provider[] }>('/api/roadside?providers=1')
      .then((d) => { if (!cancelled) { setProviders(d.providers); setLoadError(false) } })
      .catch(() => { if (!cancelled) { setProviders([]); setLoadError(true) } })
    return () => { cancelled = true }
  }, [tick])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    apiGet<{ requests: RoadsideRequest[] }>('/api/roadside?mine=1')
      .then((d) => { if (!cancelled) setFeed({ userId: user.id, requests: d.requests, tick }) })
      .catch(() => { if (!cancelled) setFeed({ userId: user.id, requests: [], tick }) })
    return () => { cancelled = true }
  }, [user, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  const myRequests = feed && user && feed.userId === user.id && feed.tick === tick ? feed.requests : null

  function cancelRequest(id: string) {
    setCancelling(id)
    apiSend(`/api/roadside?id=${id}`, 'PATCH', { action: 'cancel' })
      .then(() => { toast.success('Request cancelled'); reload() })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not cancel'))
      .finally(() => setCancelling(null))
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header + honest disclaimer */}
      <section className="border-b bg-[#10130f]">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <Reveal>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#c9a45c]/15 text-[#c9a45c]"><LifeBuoy className="h-6 w-6" /></span>
              <div>
                <h1 className="text-2xl font-bold text-white sm:text-3xl">Roadside assistance</h1>
                <p className="text-sm text-white/70">Stuck on the road? Request help from independent garages near you.</p>
              </div>
            </div>
          </Reveal>
          <div className="mt-5 rounded-xl border border-[#c9a45c]/40 bg-[#c9a45c]/10 p-4">
            <p className="flex items-start gap-2 text-sm text-[#e8c884]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span><strong>Not an emergency service.</strong> CARMAZE connects you with independent providers; response depends on their availability. For emergencies call <a href="tel:999" className="underline">999</a> or <a href="tel:112" className="underline">112</a>.</span>
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Request form / success */}
          <div className="space-y-6 lg:col-span-3">
            {created ? (
              <Card className="p-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><CheckCircle2 className="h-6 w-6" /></div>
                <h2 className="mt-3 text-lg font-semibold">Request sent</h2>
                <p className="mt-1 font-mono text-sm text-muted-foreground">{created.refCode}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Status: <Badge variant="secondary">{STATUS_LABELS[created.status] ?? created.status}</Badge>: nearby garages offering towing &amp; roadside
                  services have been notified. When one accepts, you&apos;ll see their name and phone below.
                </p>
                <p className="mt-3 text-xs text-muted-foreground">{DISCLAIMER}</p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button variant="outline" onClick={() => setCreated(null)}>New request</Button>
                  <Button onClick={() => navigate('account?tab=requests')}>My service requests</Button>
                </div>
              </Card>
            ) : user ? (
              <RequestForm user={user} onSent={(refCode, status) => { setCreated({ refCode, status }); reload() }} />
            ) : (
              <Card className="p-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><LifeBuoy className="h-6 w-6" /></div>
                <h2 className="mt-3 text-lg font-semibold">Sign in to request assistance</h2>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  A CARMAZE account lets garages reach you, shows you provider contact details when they accept, and keeps your request history.
                </p>
                <Button className="mt-4" onClick={() => navigate('signin')}>Sign in / create account</Button>
              </Card>
            )}

            {/* My requests */}
            {user && (
              <section aria-label="My roadside requests">
                <h2 className="text-lg font-semibold">My requests</h2>
                {myRequests === null ? (
                  <div className="mt-3 space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
                ) : myRequests.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                    No roadside requests yet. When you send one, its live status appears here.
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {myRequests.map((r) => (
                      <Card key={r.id} className="p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={r.status === 'COMPLETED' ? 'default' : r.status === 'CANCELLED' ? 'outline' : 'secondary'}
                              className={r.status === 'COMPLETED' ? 'bg-primary text-primary-foreground' : r.status === 'ACCEPTED' ? 'border-primary/40 text-primary' : ''}>
                              {STATUS_LABELS[r.status] ?? r.status}
                            </Badge>
                            <span className="text-sm font-medium">{ISSUE_LABELS[r.issue as (typeof ISSUES)[number]] ?? r.issue}</span>
                            <span className="text-xs text-muted-foreground">{r.refCode}</span>
                          </div>
                          <span className="text-xs text-muted-foreground"><Clock className="mr-1 inline h-3 w-3" />{timeAgo(r.createdAt)}</span>
                        </div>
                        <p className="mt-2 flex items-start gap-1 text-sm text-muted-foreground">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {r.location}, {r.county}
                        </p>
                        {r.details && <p className="mt-1 text-sm text-muted-foreground">{r.details}</p>}
                        {r.status === 'ACCEPTED' && r.provider && (
                          <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
                            <p className="flex items-center gap-1.5 font-medium text-primary"><ShieldCheck className="h-4 w-4" /> {r.provider.name} accepted your request</p>
                            {r.provider.phone && (
                              <p className="mt-1 flex items-center gap-1.5">
                                <Phone className="h-3.5 w-3.5" /> <a className="underline" href={`tel:${r.provider.phone}`}>{r.provider.phone}</a>: call them directly.
                              </p>
                            )}
                            {(r.provider.town || r.provider.location) && (
                              <p className="mt-1 text-xs text-muted-foreground">Based in: {[r.provider.town, r.provider.county].filter(Boolean).join(', ')}{r.provider.location ? ` · ${r.provider.location}` : ''}</p>
                            )}
                            {r.providerNote && <p className="mt-1 text-xs text-muted-foreground">Provider note: {r.providerNote}</p>}
                            {r.acceptedAt && <p className="mt-1 text-xs text-muted-foreground">Accepted {timeAgo(r.acceptedAt)}</p>}
                          </div>
                        )}
                        {r.status === 'COMPLETED' && r.provider && (
                          <p className="mt-2 text-xs text-muted-foreground">Completed by {r.provider.name}{r.completedAt ? ` · ${timeAgo(r.completedAt)}` : ''}.</p>
                        )}
                        {(r.status === 'REQUESTED' || r.status === 'ACCEPTED') && (
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">
                              {r.status === 'REQUESTED' ? 'Waiting for a provider to accept: you will see their contact here.' : 'Provider on it. You can mark it completed below when resolved.'}
                            </p>
                            <div className="flex shrink-0 gap-2">
                              {r.status === 'ACCEPTED' && (
                                <Button size="sm" variant="outline" disabled={cancelling === r.id}
                                  onClick={() => apiSend(`/api/roadside?id=${r.id}`, 'PATCH', { action: 'complete' }).then(reload).catch((e) => toast.error(e instanceof Error ? e.message : 'Failed'))}>
                                  Mark completed
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="text-destructive" disabled={cancelling === r.id} onClick={() => cancelRequest(r.id)}>Cancel</Button>
                            </div>
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Providers directory */}
          <aside className="lg:col-span-2" aria-label="Roadside providers directory">
            <Card className="p-5">
              <h2 className="text-lg font-semibold">Providers near you</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Independent garages on CARMAZE offering towing &amp; roadside services. Business phone numbers are public contact details.
              </p>
              <Separator className="my-4" />
              {providers === null ? (
                <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
              ) : loadError ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
                  <p>Providers could not be loaded. Check your connection and try again.</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setTick((t) => t + 1)}>Retry</Button>
                </div>
              ) : providers.length === 0 ? (
                <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                  <Wrench className="mx-auto h-6 w-6" />
                  <p className="mt-2">No providers listed yet: your request still notifies all garages we can reach.</p>
                </div>
              ) : (
                <div className="scrollbar-thin max-h-[560px] space-y-3 overflow-y-auto pr-1">
                  {providers.map((p) => (
                    <div key={p.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-medium leading-tight">{p.name}</h3>
                        <Badge variant="outline" className="shrink-0 gap-1 border-primary/40 text-primary"><ShieldCheck className="h-3 w-3" /> Approved</Badge>
                      </div>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" /> {[p.location, p.town, p.county].filter(Boolean).join(', ')}
                      </p>
                      {p.phone && (
                        <p className="mt-1.5 flex items-center gap-1.5 text-sm">
                          <Phone className="h-3.5 w-3.5 text-primary" />
                          <a className="underline hover:no-underline" href={`tel:${p.phone}`}>{p.phone}</a>
                        </p>
                      )}
                      {p.services.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {p.services.map((s, i) => (
                            <Badge key={`${p.id}-${i}`} variant="secondary" className="text-[10px]">
                              {s.title}{s.priceFromMinor ? ` · from ${Math.round(s.priceFromMinor / 100).toLocaleString()} KES` : ''}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">{DISCLAIMER}</p>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────── Request form (mounted per session user) ───────────────────────────

function RequestForm({ user, onSent }: { user: { id: string; name: string; phone: string | null }; onSent: (refCode: string, status: string) => void }) {
  const [issue, setIssue] = useState<string>('TOW')
  const [name, setName] = useState(user.name)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [county, setCounty] = useState('Nairobi')
  const [location, setLocation] = useState('')
  const [details, setDetails] = useState('')
  const [sending, setSending] = useState(false)

  function submit() {
    if (location.trim().length < 5) { toast.error('Describe where you are (min 5 characters)'); return }
    if (phone.trim().length < 9) { toast.error('Enter a reachable phone number'); return }
    setSending(true)
    apiSend<{ request: { refCode: string; status: string } }>('/api/roadside', 'POST', {
      name: name.trim(),
      phone: phone.trim(),
      county,
      location: location.trim(),
      issue,
      details: details.trim() || undefined,
    })
      .then((d) => {
        toast.success(`Request ${d.request.refCode} sent`)
        setLocation('')
        setDetails('')
        onSent(d.request.refCode, d.request.status)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not send request'))
      .finally(() => setSending(false))
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Request assistance</h2>
      <p className="mt-1 text-sm text-muted-foreground">Tell us what happened and where you are. Garages with active towing/roadside services get notified.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="rs-issue">What happened? *</Label>
          <Select value={issue} onValueChange={setIssue}>
            <SelectTrigger id="rs-issue"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ISSUES.map((i) => <SelectItem key={i} value={i}>{ISSUE_LABELS[i]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-name">Your name *</Label>
          <Input id="rs-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-phone">Phone the provider should call *</Label>
          <Input id="rs-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" inputMode="tel" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-county">County *</Label>
          <Select value={county} onValueChange={setCounty}>
            <SelectTrigger id="rs-county"><SelectValue /></SelectTrigger>
            <SelectContent>{KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-location">Where exactly are you? *</Label>
          <Input id="rs-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Uhuru Highway near Haile Selassie Ave, towards CBD" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="rs-details">Details (optional)</Label>
          <Textarea id="rs-details" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Vehicle, what led to the breakdown, safe parking spot…" />
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">{DISCLAIMER}</p>
        <Button onClick={submit} disabled={sending || location.trim().length < 5 || phone.trim().length < 9 || name.trim().length < 2}>
          {sending ? 'Sending…' : 'Send request'}
        </Button>
      </div>
    </Card>
  )
}
