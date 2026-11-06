'use client'

/* CARMAZE Procurement: GarageOS procurement portal for the Automotive
 * Supply Network. Gate: an ACTIVE GARAGE org membership from /api/orgs/me.
 * Tabs are hash-driven (?tab=) so links from notifications deep-open the
 * right workbench (and ?order=<id> opens an order detail directly). */

import { useCallback, useEffect, useState } from 'react'
import {
  ShoppingCart, Wrench, Store, CarFront, FileQuestion, ClipboardList,
  ShieldCheck, Wallet, Gauge, Building2, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { apiGet, navigate, ClientApiError } from '@/lib/client'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useAuth } from '@/stores/auth'
import { useCart } from '@/stores/cart'
import { cn } from '@/lib/utils'
import { CartSheet } from '@/components/procurement/cart-sheet'
import { OverviewTab } from '@/components/procurement/overview-tab'
import { CatalogueTab } from '@/components/procurement/catalogue-tab'
import { FitmentTab } from '@/components/procurement/fitment-tab'
import { QuotesTab } from '@/components/procurement/quotes-tab'
import { OrdersTab } from '@/components/procurement/orders-tab'
import { ApprovalsTab } from '@/components/procurement/approvals-tab'
import { SpendTab } from '@/components/procurement/spend-tab'
import { canApprove, type Membership } from '@/components/procurement/shared'

const TABS = ['overview', 'catalogue', 'fitment', 'quotes', 'orders', 'approvals', 'spend'] as const

export default function ProcurementView() {
  const { user, loading } = useAuth()
  const route = useHashRoute()
  const [memberships, setMemberships] = useState<Membership[] | null>(null)
  const [membershipsError, setMembershipsError] = useState('')
  const [activeOrgId, setActiveOrgId] = useState('')
  const [cartOpen, setCartOpen] = useState(false)

  const garageMemberships = (memberships ?? []).filter(
    (m) => m.org.type === 'GARAGE' && m.org.status === 'ACTIVE'
  )
  const active = garageMemberships.find((m) => m.orgId === activeOrgId) ?? garageMemberships[0] ?? null
  const cartCount = useCart((s) => s.items.length)

  const loadMemberships = useCallback(() => {
    let stale = false
    apiGet<{ memberships: Membership[] }>('/api/orgs/me')
      .then((d) => { if (!stale) { setMemberships(d.memberships); setMembershipsError('') } })
      .catch((e: unknown) => {
        if (stale) return
        setMemberships([])
        setMembershipsError(e instanceof ClientApiError ? e.message : 'Could not load your business memberships.')
        toast.error(e instanceof ClientApiError ? e.message : 'Could not load your business memberships.')
      })
    return () => { stale = true }
  }, [])

  useEffect(() => {
    if (loading || !user) return
    return loadMemberships()
  }, [loading, user, loadMemberships])

  const tabParam = route.query.get('tab') ?? 'overview'
  const tab = (TABS as readonly string[]).includes(tabParam) ? tabParam : 'overview'
  const setTab = (t: string) => navigate(`procurement?tab=${t}`)
  const role = active?.role ?? ''

  // ── Gates ──
  if (!loading && !user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Wrench className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-2xl font-bold">Procurement</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in with your garage account to buy parts from the verified supplier network; catalogue, fitment, quotes, protected payments and delivery tracking.
        </p>
        <Button className="mt-6" onClick={() => navigate('signin')}>Sign in</Button>
      </div>
    )
  }

  if (loading || memberships === null) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-4 py-8 sm:p-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-10 w-full max-w-xl rounded-lg" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (garageMemberships.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Building2 className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-2xl font-bold">Procurement is for garages</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {membershipsError
            ? 'We could not verify your business memberships just now; that is usually a temporary session issue.'
            : user
              ? <>You are signed in as <span className="font-medium text-foreground">{user.name}</span>, but this workbench needs an <span className="font-medium text-foreground">active garage business</span> membership. Suppliers and dealers have their own portals.</>
              : 'An active garage business membership is required.'}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => navigate('garages')}>Garage onboarding & directory</Button>
          {membershipsError && <Button variant="outline" onClick={loadMemberships}><RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> Retry</Button>}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Onboarding takes a few minutes: apply from the Garage directory, get approved, add a branch: then order parts with protected payments.
        </p>
      </div>
    )
  }

  // ── Portal ──
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">Procurement</h1>
            <Badge variant="outline" className="gap-1 border-primary/40 text-primary"><Gauge className="h-3 w-3" aria-hidden="true" /> GarageOS</Badge>
            <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" aria-hidden="true" /> {role.replaceAll('_', ' ') || 'Member'}</Badge>
          </div>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{active!.org.name}</span>
            <span aria-hidden="true">·</span> {active!.org.county}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {garageMemberships.length > 1 && (
            <Select value={active!.orgId} onValueChange={setActiveOrgId}>
              <SelectTrigger className="w-52" aria-label="Switch garage">
                <SelectValue placeholder="Choose garage" />
              </SelectTrigger>
              <SelectContent>
                {garageMemberships.map((m) => <SelectItem key={m.orgId} value={m.orgId}>{m.org.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" onClick={() => setCartOpen(true)} aria-label={`Open cart (${cartCount} items)`}>
            <ShoppingCart className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Cart
            {cartCount > 0 && (
              <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {cartCount > 9 ? '9+' : cartCount}
              </span>
            )}
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList className="scrollbar-thin h-auto w-full justify-start overflow-x-auto py-0.5">
          <TabsTrigger value="overview" className="gap-1.5"><Gauge className="h-4 w-4" /> Overview</TabsTrigger>
          <TabsTrigger value="catalogue" className="gap-1.5"><Store className="h-4 w-4" /> Catalogue</TabsTrigger>
          <TabsTrigger value="fitment" className="gap-1.5"><CarFront className="h-4 w-4" /> Fitment</TabsTrigger>
          <TabsTrigger value="quotes" className="gap-1.5"><FileQuestion className="h-4 w-4" /> Quotes</TabsTrigger>
          <TabsTrigger value="orders" className="gap-1.5"><ClipboardList className="h-4 w-4" /> Orders</TabsTrigger>
          {canApprove(role) && (
            <TabsTrigger value="approvals" className="gap-1.5"><ShieldCheck className="h-4 w-4" /> Approvals</TabsTrigger>
          )}
          <TabsTrigger value="spend" className="gap-1.5"><Wallet className="h-4 w-4" /> Spend</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab
            orgId={active!.orgId}
            role={role}
            onNav={setTab}
            onBrowse={() => setTab('catalogue')}
            onRequestPart={() => navigate('procurement?tab=quotes&newRequest=1')}
          />
        </TabsContent>

        <TabsContent value="catalogue" className="mt-4">
          <CatalogueTab role={role} />
        </TabsContent>

        <TabsContent value="fitment" className="mt-4">
          <FitmentTab onRequestPart={() => navigate('procurement?tab=quotes&newRequest=1')} />
        </TabsContent>

        <TabsContent value="quotes" className="mt-4">
          <QuotesTab
            orgId={active!.orgId}
            role={role}
            openNew={route.query.get('newRequest') === '1'}
            onNewClosed={() => navigate('procurement?tab=quotes', { replace: true })}
          />
        </TabsContent>

        <TabsContent value="orders" className="mt-4">
          <OrdersTab orgId={active!.orgId} role={role} deepLinkId={route.query.get('order')} />
        </TabsContent>

        <TabsContent value="approvals" className="mt-4">
          {canApprove(role) ? (
            <ApprovalsTab orgId={active!.orgId} role={role} />
          ) : (
            <div className={cn('rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground')}>
              The approvals queue is only visible to the owner or general manager.
            </div>
          )}
        </TabsContent>

        <TabsContent value="spend" className="mt-4">
          <SpendTab orgId={active!.orgId} />
        </TabsContent>
      </Tabs>

      {/* Floating cart: always one tap away from anywhere in the portal */}
      {cartCount > 0 && !cartOpen && (
        <Button
          size="lg"
          className="fixed bottom-24 right-4 z-40 h-14 w-14 rounded-full p-0 shadow-lg sm:bottom-6"
          onClick={() => setCartOpen(true)}
          aria-label={`Open cart (${cartCount} items)`}
        >
          <ShoppingCart className="h-5 w-5" aria-hidden="true" />
          <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground ring-2 ring-background">
            {cartCount > 9 ? '9+' : cartCount}
          </span>
        </Button>
      )}

      <CartSheet
        open={cartOpen}
        onOpenChange={setCartOpen}
        orgId={active!.orgId}
        role={role}
        onBrowse={() => setTab('catalogue')}
        onOrdered={() => {
          toast.info('Track your orders', { description: 'Opening the Orders tab.' })
          navigate('procurement?tab=orders')
        }}
      />
    </div>
  )
}
