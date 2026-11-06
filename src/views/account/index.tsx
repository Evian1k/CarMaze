'use client'

/* Account — profile, phone & email verification, two-factor authentication (TOTP),
 * saved vehicles, enquiries, service requests, saved searches and notifications. */

import { useEffect, useCallback, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Heart, MailCheck, Bell, MessageSquareText, Wrench, Search, PhoneCall, Copy, ShieldCheck, KeyRound, MessagesSquare, Gift, CreditCard, Smartphone, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { VehicleCard, type VehicleCardData } from '@/components/marketplace/vehicle-card'
import { MessagesTab } from '@/components/messaging/conversation-panel'
import { VehicleProtection } from '@/components/protection/vehicle-protection'
import { RewardsPanel } from '@/components/loyalty/rewards-panel'
import { CustomerTestDrives } from '@/components/protection/customer-test-drives'
import { SubscriptionsPanel } from '@/components/account/subscriptions-panel'
import { CustomerOrders } from '@/components/account/customer-orders'
import { useAuth } from '@/stores/auth'
import { navigate, apiGet, apiSend } from '@/lib/client'
import { useHashRoute } from '@/hooks/use-hash-route'
import { timeAgo, dateLabel, money } from '@/lib/format'

type SavedVehicle = { id: string; vehicle: VehicleCardData }
type EnquiryItem = {
  id: string; refCode: string; status: string; createdAt: string
  vehicle: { id: string; make: string; model: string; year: number; priceMinor: number; currency: string }
  messages: { id: string; body: string; senderSide: string; createdAt: string }[]
}
type RequestItem = {
  id: string; refCode: string; category: string; status: string; description: string; county: string; createdAt: string
  quotes: { id: string; amountMinor: number; leadDays: number | null; message: string | null; status: string; org: { name: string } }[]
  booking: { status: string; scheduledAt: string | null } | null
}
type SavedSearchItem = { id: string; name: string; query: string; createdAt: string }
type NotificationItem = { id: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }

const TABS = ['profile', 'saved', 'enquiries', 'messages', 'requests', 'orders', 'searches', 'rewards', 'protection', 'testdrives', 'subscriptions', 'notifications'] as const

export default function AccountView() {
  const route = useHashRoute()
  const { user, loading, refresh, refreshNotifications } = useAuth()
  const [tab, setTab] = useState<string>(() => {
    const t = route.query.get('tab')
    return TABS.includes(t as (typeof TABS)[number]) ? t! : 'profile'
  })

  const [saved, setSaved] = useState<SavedVehicle[] | null>(null)
  const [enquiries, setEnquiries] = useState<EnquiryItem[] | null>(null)
  const [requests, setRequests] = useState<RequestItem[] | null>(null)
  const [searches, setSearches] = useState<SavedSearchItem[] | null>(null)
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null)
  const [phone, setPhone] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [newSearch, setNewSearch] = useState('')
  // Email verification
  const [emailDevCode, setEmailDevCode] = useState<string | null>(null)
  const [emailCode, setEmailCode] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  // Two-factor authentication (TOTP)
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaPassword, setMfaPassword] = useState('')
  const [mfaBusy, setMfaBusy] = useState(false)

  useEffect(() => {
    if (!loading && !user) navigate('signin', { replace: true })
  }, [loading, user])

  const loadNotifications = useCallback(() => {
    apiGet<{ notifications: NotificationItem[] }>('/api/notifications?take=30')
      .then((d) => setNotifications(d.notifications))
      .catch(() => setNotifications([]))
  }, [])

  useEffect(() => {
    if (!user) return
    apiGet<{ saved: SavedVehicle[] }>('/api/saved-vehicles').then((d) => setSaved(d.saved)).catch(() => setSaved([]))
    apiGet<{ enquiries: EnquiryItem[] }>('/api/enquiries?mine=1').then((d) => setEnquiries(d.enquiries)).catch(() => setEnquiries([]))
    apiGet<{ requests: RequestItem[] }>('/api/service-requests?mine=1').then((d) => setRequests(d.requests)).catch(() => setRequests([]))
    apiGet<{ searches: SavedSearchItem[] }>('/api/saved-searches').then((d) => setSearches(d.searches)).catch(() => setSearches([]))
    loadNotifications()
  }, [user?.id, loadNotifications])

  // Sync phone input when the profile loads/changes (derived, not effect-driven).
  useEffect(() => {
    let cancelled = false
    apiGet<{ user: { phone: string | null } }>('/api/auth/profile')
      .then((d) => { if (!cancelled) setPhone(d.user.phone ?? '') })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (loading || !user) {
    return <div className="mx-auto max-w-4xl space-y-4 p-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 rounded-xl" /></div>
  }

  async function requestCode() {
    try {
      const d = await apiSend<{ devCode?: string; message: string }>('/api/auth/verify-phone', 'POST', { action: 'request' })
      setDevCode(d.devCode ?? null)
      toast.info(d.message)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send code')
    }
  }

  async function confirmCode() {
    try {
      await apiSend('/api/auth/verify-phone', 'POST', { action: 'confirm', code })
      await refresh()
      toast.success('Phone verified')
      setDevCode(null)
      setCode('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verification failed')
    }
  }

  async function requestEmailCode() {
    setEmailBusy(true)
    try {
      const d = await apiSend<{ devCode?: string; message: string }>('/api/auth/verify-email', 'POST', { action: 'request' })
      setEmailDevCode(d.devCode ?? null)
      toast.info(d.message)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send code')
    } finally {
      setEmailBusy(false)
    }
  }

  async function confirmEmailCode() {
    setEmailBusy(true)
    try {
      await apiSend('/api/auth/verify-email', 'POST', { action: 'confirm', code: emailCode })
      await refresh()
      toast.success('Email verified')
      setEmailDevCode(null)
      setEmailCode('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verification failed')
    } finally {
      setEmailBusy(false)
    }
  }

  async function startMfaSetup() {
    setMfaBusy(true)
    try {
      const d = await apiSend<{ secret: string; uri: string }>('/api/auth/mfa/setup', 'POST')
      setMfaSetup(d)
      setMfaCode('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Setup failed')
    } finally {
      setMfaBusy(false)
    }
  }

  async function confirmMfaEnable() {
    setMfaBusy(true)
    try {
      await apiSend('/api/auth/mfa/enable', 'POST', { code: mfaCode })
      await refresh()
      toast.success('Two-factor authentication enabled')
      setMfaSetup(null)
      setMfaCode('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not enable two-factor authentication')
    } finally {
      setMfaBusy(false)
    }
  }

  async function disableMfa() {
    setMfaBusy(true)
    try {
      await apiSend('/api/auth/mfa/disable', 'POST', { password: mfaPassword })
      await refresh()
      toast.success('Two-factor authentication disabled')
      setMfaPassword('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not disable two-factor authentication')
    } finally {
      setMfaBusy(false)
    }
  }

  async function saveProfile() {
    try {
      await apiSend('/api/auth/profile', 'PATCH', { name: user!.name, phone })
      await refresh()
      toast.success('Profile updated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  async function unsave(vehicleId: string) {
    await apiSend(`/api/saved-vehicles?vehicleId=${vehicleId}`, 'DELETE').catch(() => {})
    setSaved((s) => s?.filter((x) => x.vehicle.id !== vehicleId) ?? null)
  }

  async function closeEnquiry(id: string) {
    try {
      await apiSend(`/api/enquiries/${id}`, 'PATCH', { status: 'CLOSED' })
      const d = await apiGet<{ enquiries: EnquiryItem[] }>('/api/enquiries?mine=1')
      setEnquiries(d.enquiries)
      toast.success('Enquiry closed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function acceptQuote(requestId: string, quoteId: string) {
    try {
      await apiSend(`/api/quotes/${quoteId}`, 'PATCH', { action: 'accept' })
      const d = await apiGet<{ requests: RequestItem[] }>('/api/service-requests?mine=1')
      setRequests(d.requests)
      toast.success('Quote accepted — the garage will confirm your booking')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function declineQuote(quoteId: string) {
    try {
      await apiSend(`/api/quotes/${quoteId}`, 'PATCH', { action: 'decline' })
      const d = await apiGet<{ requests: RequestItem[] }>('/api/service-requests?mine=1')
      setRequests(d.requests)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function addSearch() {
    if (!newSearch.trim()) return
    try {
      await apiSend('/api/saved-searches', 'POST', { name: newSearch.trim(), query: route.query.get('seed') ?? '' })
      setNewSearch('')
      const d = await apiGet<{ searches: SavedSearchItem[] }>('/api/saved-searches')
      setSearches(d.searches)
      toast.success('Search saved — you will get alerts for new matches')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My Account</h1>
          <p className="text-sm text-muted-foreground">{user.email}{user.createdAt ? ` · member since ${dateLabel(user.createdAt)}` : ''}</p>
        </div>
        {!user.phoneVerified && user.phone && <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300"><PhoneCall className="h-3.5 w-3.5" /> Phone not verified</Badge>}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList className="scrollbar-thin h-auto w-full justify-start overflow-x-auto py-0.5">
          <TabsTrigger value="profile" className="gap-1.5"><MailCheck className="h-4 w-4" /> Profile</TabsTrigger>
          <TabsTrigger value="saved" className="gap-1.5"><Heart className="h-4 w-4" /> Saved</TabsTrigger>
          <TabsTrigger value="enquiries" className="gap-1.5"><MessageSquareText className="h-4 w-4" /> Enquiries</TabsTrigger>
          <TabsTrigger value="messages" className="gap-1.5"><MessagesSquare className="h-4 w-4" /> Messages</TabsTrigger>
          <TabsTrigger value="requests" className="gap-1.5"><Wrench className="h-4 w-4" /> Requests</TabsTrigger>
          <TabsTrigger value="orders" className="gap-1.5"><ShoppingCart className="h-4 w-4" /> Orders</TabsTrigger>
          <TabsTrigger value="searches" className="gap-1.5"><Search className="h-4 w-4" /> Searches</TabsTrigger>
          <TabsTrigger value="rewards" className="gap-1.5"><Gift className="h-4 w-4" /> Rewards</TabsTrigger>
          <TabsTrigger value="protection" className="gap-1.5"><ShieldCheck className="h-4 w-4" /> Vehicle protection</TabsTrigger>
          <TabsTrigger value="subscriptions" className="gap-1.5"><CreditCard className="h-4 w-4" /> Memberships & credit</TabsTrigger>
          <TabsTrigger value="testdrives" className="gap-1.5"><KeyRound className="h-4 w-4" /> Test drives</TabsTrigger>
          <TabsTrigger value="notifications" className="gap-1.5"><Bell className="h-4 w-4" /> Alerts</TabsTrigger>
        </TabsList>

        {/* Profile */}
        <TabsContent value="profile" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle>Contact details</CardTitle>
              <CardDescription>Sellers only see your phone number when you tick &quot;share my number&quot; on an enquiry.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="acc-name">Full name</Label>
                <Input id="acc-name" value={user.name} disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-email">Email</Label>
                <Input id="acc-email" value={user.email} disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-phone">Phone</Label>
                <div className="flex gap-2">
                  <Input id="acc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" />
                  <Button variant="outline" onClick={saveProfile}>Save</Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Phone verification</Label>
                {user.phoneVerified ? (
                  <Badge className="w-fit gap-1 bg-primary text-primary-foreground"><PhoneCall className="h-3.5 w-3.5" /> Verified</Badge>
                ) : (
                  <div className="space-y-2">
                    <Button variant="outline" size="sm" onClick={requestCode} disabled={!phone}>Send code</Button>
                    {devCode && (
                      <div className="rounded-md border border-dashed p-2 text-xs">
                        <p className="flex items-center justify-between">
                          <span>Dev code: <strong className="font-mono">{devCode}</strong></span>
                          <button className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => { navigator.clipboard?.writeText(devCode); toast.success('Copied') }}>
                            <Copy className="h-3 w-3" /> copy
                          </button>
                        </p>
                        <p className="mt-1 text-muted-foreground">SMS gateway not configured on this deployment — code shown here instead of a real SMS.</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" maxLength={6} className="max-w-32" />
                      <Button size="sm" variant="outline" onClick={confirmCode} disabled={code.length !== 6}>Verify</Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Email verification</CardTitle>
              <CardDescription>Confirming your email helps with account recovery and keeps seller and staff accounts secure.</CardDescription>
            </CardHeader>
            <CardContent>
              {user.emailVerified ? (
                <Badge className="w-fit gap-1 bg-emerald-600 text-white"><ShieldCheck className="h-3.5 w-3.5" /> Verified</Badge>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="gap-1 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"><ShieldCheck className="h-3.5 w-3.5" /> Not verified</Badge>
                    <Button variant="outline" size="sm" onClick={requestEmailCode} disabled={emailBusy}>{emailBusy ? 'Please wait…' : 'Send code'}</Button>
                  </div>
                  {emailDevCode && (
                    <div className="rounded-md border border-dashed p-2 text-xs">
                      <p className="flex items-center justify-between">
                        <span>Dev code: <strong className="font-mono">{emailDevCode}</strong></span>
                        <button className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => { navigator.clipboard?.writeText(emailDevCode); toast.success('Copied') }}>
                          <Copy className="h-3 w-3" /> copy
                        </button>
                      </p>
                      <p className="mt-1 text-muted-foreground">Email delivery not configured on this deployment — code shown here instead of a real email.</p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input value={emailCode} onChange={(e) => setEmailCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" maxLength={6} className="max-w-32" />
                    <Button size="sm" variant="outline" onClick={confirmEmailCode} disabled={emailBusy || emailCode.length !== 6}>Verify</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Two-factor authentication (TOTP)</CardTitle>
              <CardDescription>
                Add a second sign-in step with an authenticator app (Google Authenticator, Authy, 1Password…). Codes rotate every 30 seconds and are required at every sign-in. Staff accounts should enable this.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {user.mfaEnabled ? (
                <div className="space-y-3">
                  <Badge className="w-fit gap-1 bg-emerald-600 text-white"><Smartphone className="h-3.5 w-3.5" /> Enabled</Badge>
                  <p className="text-sm text-muted-foreground">To turn this off, confirm your password. We recommend keeping two-factor authentication on.</p>
                  <div className="flex max-w-sm gap-2">
                    <Input type="password" value={mfaPassword} onChange={(e) => setMfaPassword(e.target.value)} placeholder="Current password" autoComplete="current-password" />
                    <Button variant="destructive" onClick={disableMfa} disabled={mfaBusy || !mfaPassword}>{mfaBusy ? 'Please wait…' : 'Disable'}</Button>
                  </div>
                </div>
              ) : mfaSetup ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">1. Add the secret to your authenticator app</p>
                    <p className="text-xs text-muted-foreground">Paste the key below, or scan/use the otpauth link with an app that supports manual setup.</p>
                    <div className="flex items-center justify-between gap-2 rounded-md border border-dashed p-2">
                      <code className="select-all break-all font-mono text-sm">{mfaSetup.secret}</code>
                      <button className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline" onClick={() => { navigator.clipboard?.writeText(mfaSetup.secret); toast.success('Copied') }}>
                        <Copy className="h-3 w-3" /> copy
                      </button>
                    </div>
                    <p className="select-all break-all font-mono text-[11px] text-muted-foreground">{mfaSetup.uri}</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">2. Enter the current 6-digit code</p>
                    <div className="flex flex-wrap gap-2">
                      <Input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" maxLength={6} className="max-w-32" />
                      <Button size="sm" onClick={confirmMfaEnable} disabled={mfaBusy || mfaCode.length !== 6}>Confirm & enable</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setMfaSetup(null); setMfaCode('') }}>Cancel</Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Badge variant="outline" className="w-fit gap-1 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"><Smartphone className="h-3.5 w-3.5" /> Not enabled</Badge>
                  <div>
                    <Button variant="outline" size="sm" onClick={startMfaSetup} disabled={mfaBusy}>{mfaBusy ? 'Please wait…' : 'Set up authenticator app'}</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Privacy</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p>Your saved vehicles, garage records and searches are private by default. Dealer documents uploaded during verification are stored privately and only visible to you and authorised reviewers.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Saved */}
        <TabsContent value="saved" className="mt-4">
          {saved === null ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[16/10] rounded-xl" />)}</div>
          ) : saved.length === 0 ? (
            <EmptyState icon={<Heart className="h-6 w-6" />} title="No saved vehicles yet" desc="Tap the heart on any listing to keep an eye on it." action="Browse cars" onAction={() => navigate('cars')} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {saved.map((s) => <VehicleCard key={s.id} v={s.vehicle} saved onToggleSave={() => unsave(s.vehicle.id)} />)}
            </div>
          )}
        </TabsContent>

        {/* Enquiries */}
        <TabsContent value="enquiries" className="mt-4 space-y-3">
          {enquiries === null ? <Skeleton className="h-40 rounded-xl" /> : enquiries.length === 0 ? (
            <EmptyState icon={<MessageSquareText className="h-6 w-6" />} title="No enquiries yet" desc="When you ask about a vehicle, the conversation appears here." action="Find a car" onAction={() => navigate('cars')} />
          ) : (
            enquiries.map((en) => (
              <Card key={en.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button className="text-left font-semibold hover:underline" onClick={() => navigate(`vehicle-detail/${en.vehicle.id}`)}>
                      {en.vehicle.make} {en.vehicle.model} {en.vehicle.year} · {money(en.vehicle.priceMinor, en.vehicle.currency)}
                    </button>
                    <div className="flex items-center gap-2">
                      <Badge variant={en.status === 'OPEN' ? 'secondary' : en.status === 'ANSWERED' ? 'outline' : 'secondary'} className={en.status === 'OPEN' ? 'bg-accent/30' : ''}>{en.status}</Badge>
                      <span className="text-xs text-muted-foreground">{en.refCode}</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="scrollbar-thin max-h-40 space-y-2 overflow-y-auto rounded-lg bg-muted/60 p-3">
                    {en.messages.map((m) => (
                      <div key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.senderSide === 'CUSTOMER' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-card border'}`}>
                        <p>{m.body}</p>
                        <p className="mt-1 text-[10px] opacity-70">{timeAgo(m.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                  {en.status !== 'CLOSED' && (
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => closeEnquiry(en.id)}>Close enquiry</Button>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Messages (unified conversations) */}
        <TabsContent value="messages" className="mt-4">
          <FadeIn><MessagesTab scope="mine" /></FadeIn>
        </TabsContent>

        {/* Service requests */}
        <TabsContent value="requests" className="mt-4 space-y-3">
          {requests === null ? <Skeleton className="h-40 rounded-xl" /> : requests.length === 0 ? (
            <EmptyState icon={<Wrench className="h-6 w-6" />} title="No service requests yet" desc="Request quotes from verified garages — including directly from the 3D customizer." action="Find a garage" onAction={() => navigate('garages')} />
          ) : (
            requests.map((r) => (
              <Card key={r.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{r.category.replaceAll('_', ' ').toLowerCase()} · {r.county}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{r.status}</Badge>
                      <span className="text-xs text-muted-foreground">{r.refCode} · {timeAgo(r.createdAt)}</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{r.description}</p>
                  {r.quotes.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">Quotes received</h4>
                      {r.quotes.map((q) => (
                        <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                          <div>
                            <p className="font-medium">{q.org.name}</p>
                            <p className="text-xs text-muted-foreground">{q.message}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-primary">{money(q.amountMinor)}</span>
                            {q.status === 'PENDING' ? (
                              <>
                                <Button size="sm" onClick={() => acceptQuote(r.id, q.id)}>Accept</Button>
                                <Button size="sm" variant="ghost" onClick={() => declineQuote(q.id)}>Decline</Button>
                              </>
                            ) : (
                              <Badge variant="outline">{q.status}</Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {r.booking && (
                    <p className="text-sm">
                      Booking: <Badge variant="outline">{r.booking.status}</Badge>
                      {r.booking.scheduledAt && <span className="ml-2 text-muted-foreground">{dateLabel(r.booking.scheduledAt)}</span>}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Parts orders */}
        <TabsContent value="orders" className="mt-4">
          <FadeIn><CustomerOrders /></FadeIn>
        </TabsContent>

        {/* Saved searches */}
        <TabsContent value="searches" className="mt-4 space-y-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Save a search</CardTitle>
              <CardDescription>We alert you when new published listings match a saved search.</CardDescription></CardHeader>
            <CardContent className="flex gap-2">
              <Input value={newSearch} onChange={(e) => setNewSearch(e.target.value)} placeholder="e.g. Family SUV under 4M" />
              <Button onClick={addSearch}>Save</Button>
            </CardContent>
          </Card>
          {searches && searches.length > 0 && (
            <div className="space-y-2">
              {searches.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.query || 'no filters'} · saved {timeAgo(s.createdAt)}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={async () => { await apiSend(`/api/saved-searches?id=${s.id}`, 'DELETE'); setSearches((x) => x!.filter((y) => y.id !== s.id)) }}>Remove</Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Rewards (loyalty points & referrals) */}
        <TabsContent value="rewards" className="mt-4">
          <FadeIn><RewardsPanel /></FadeIn>
        </TabsContent>

        {/* Vehicle protection */}
        <TabsContent value="protection" className="mt-4">
          <FadeIn><VehicleProtection /></FadeIn>
        </TabsContent>

        {/* Test drives */}
        <TabsContent value="testdrives" className="mt-4">
          <FadeIn><CustomerTestDrives /></FadeIn>
        </TabsContent>

        {/* Memberships & credit */}
        <TabsContent value="subscriptions" className="mt-4">
          <FadeIn><SubscriptionsPanel /></FadeIn>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications" className="mt-4 space-y-2">
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={async () => { await apiSend('/api/notifications', 'PATCH', { all: true }); loadNotifications(); refreshNotifications() }}>
              Mark all read
            </Button>
          </div>
          {notifications === null ? <Skeleton className="h-40 rounded-xl" /> : notifications.length === 0 ? (
            <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications" desc="Enquiries, offers, quotes and reminders will show up here." />
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => n.link && navigate(n.link)}
                className={`block w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 ${!n.readAt ? 'border-accent/40 bg-accent/5' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{n.title}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
                </div>
                {n.body && <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>}
              </button>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function FadeIn({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}

function EmptyState({ icon, title, desc, action, onAction }: { icon: React.ReactNode; title: string; desc: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</span>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{desc}</p>
      {action && onAction && <Button className="mt-4" variant="outline" onClick={onAction}>{action}</Button>}
    </div>
  )
}
