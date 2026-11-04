'use client'

/* SupplierOS — the supplier portal of the CARMAZE Automotive Supply Network.
 *
 * Gate logic (driven by GET /api/orgs/me):
 *   A) No SUPPLIER membership  → "Become a verified supplier" application form
 *      (POST /api/suppliers). Success shows an honest "under review" state;
 *      409 APPLICATION_EXISTS shows "already under review".
 *   B) Supplier org not ACTIVE → paused notice.
 *   C) Active supplier org(s)  → full dashboard with tabs:
 *      overview · products · orders · quotes · warehouses · inventory · billing
 *
 * All data comes from the live supply API routes. Verification and payment
 * states are always rendered exactly as the API reports them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleAlert, RefreshCw, ShieldCheck, Warehouse } from 'lucide-react'
import { apiGet, navigate } from '@/lib/client'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useAuth } from '@/stores/auth'
import { sessionGet, sessionSet } from '@/lib/safe-storage'
import { dateLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import {
  type MePayload, type Membership, type ProductItem, type OrderListItem, type BranchItem, type SupplierProfile,
  useFetch, ModuleNotice, FadeIn,
} from '@/components/supplier/shared'
import { SignInGate, ApplyForm, UnderReview } from '@/components/supplier/gate'
import { OverviewTab } from '@/components/supplier/overview'
import { ProductsTab } from '@/components/supplier/products'
import { OrdersTab } from '@/components/supplier/orders'
import { QuotesTab } from '@/components/supplier/quotes'
import { WarehousesTab } from '@/components/supplier/warehouses'
import { InventoryTab } from '@/components/supplier/inventory'
import { BillingTab } from '@/components/supplier/billing'

const TABS = ['overview', 'products', 'orders', 'quotes', 'warehouses', 'inventory', 'billing'] as const
type TabKey = (typeof TABS)[number]

/** Session-scoped memory of this browser's own successful submission — the
 * /api/orgs/me payload exposes DEALER applications only, so supplier
 * application status is not readable client-side. We remember only what this
 * session itself did, and the API re-validates every duplicate attempt. */
const APPLIED_KEY = 'carmaze_supplier_applied'

type AppliedState = { mode: 'new' | 'exists'; name?: string }

export default function View() {
  const { user, loading: authLoading } = useAuth()
  const [me, setMe] = useState<MePayload | null>(null)
  const [meError, setMeError] = useState<string | null>(null)
  const [meLoading, setMeLoading] = useState(true)
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const [applied, setApplied] = useState<AppliedState | null>(() => {
    const raw = sessionGet(APPLIED_KEY)
    return raw ? { mode: 'new', name: raw || undefined } : null
  })
  const [existsShown, setExistsShown] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const refresh = useCallback(() => setReloadToken((t) => t + 1), [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const run = async () => {
      try {
        const d = await apiGet<MePayload>('/api/orgs/me')
        if (cancelled) return
        setMe(d)
        setMeError(null)
        setActiveOrgId((prev) => {
          if (prev) return prev
          const firstSupplier = d.memberships.find((m) => m.org?.type === 'SUPPLIER')
          return firstSupplier?.orgId ?? null
        })
      } catch (e) {
        if (!cancelled) setMeError((e as { message?: string })?.message ?? 'Could not load your business profile.')
      } finally {
        if (!cancelled) setMeLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [user, reloadToken])

  const supplierMemberships = useMemo(
    () => (me?.memberships ?? []).filter((m) => m.org?.type === 'SUPPLIER'),
    [me]
  )
  const current = supplierMemberships.find((m) => m.orgId === activeOrgId) ?? supplierMemberships[0] ?? null

  if (authLoading || (user && meLoading && !me && !meError)) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-4 px-3 py-8 sm:px-6" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!user) {
    return <SignInGate />
  }

  if (meError) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16">
        <ModuleNotice title="SupplierOS could not load" detail={meError} retry={refresh} />
      </div>
    )
  }

  // State C — active supplier business(es)
  if (current) {
    if (current.org.status !== 'ACTIVE') {
      return (
        <div className="mx-auto w-full max-w-lg px-4 py-16">
          <Alert variant="destructive">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>{current.org.name} is currently {current.org.status.toLowerCase()}</AlertTitle>
            <AlertDescription>
              Your supplier workspace is paused. Contact CARMAZE support to resolve this — your data is safe.
            </AlertDescription>
          </Alert>
        </div>
      )
    }
    if (activeOrgId) {
      return (
        <SupplierDashboard
          memberships={supplierMemberships}
          membership={current}
          activeOrgId={activeOrgId}
          onOrgChange={setActiveOrgId}
          onRefresh={refresh}
        />
      )
    }
  }

  // State A/B — application flow (no active supplier membership)
  if (applied) {
    return (
      <UnderReview
        orgName={applied.name}
        onReset={() => {
          sessionSet(APPLIED_KEY, '')
          setApplied(null)
        }}
      />
    )
  }
  if (existsShown) {
    return <UnderReview alreadyExists />
  }
  return (
    <ApplyForm
      onDone={(orgName) => {
        sessionSet(APPLIED_KEY, orgName)
        setApplied({ mode: 'new', name: orgName })
      }}
      onExists={() => setExistsShown(true)}
    />
  )
}

// ───────────────────────────── Dashboard shell ─────────────────────────────

function SupplierDashboard({ memberships, membership, activeOrgId, onOrgChange, onRefresh }: {
  memberships: Membership[]
  membership: Membership
  activeOrgId: string
  onOrgChange: (orgId: string) => void
  onRefresh: () => void
}) {
  const route = useHashRoute()
  const tabParam = route.query.get('tab')
  const tab: TabKey = TABS.includes(tabParam as TabKey) ? (tabParam as TabKey) : 'overview'
  const goTab = (t: string) => navigate(`/supplier?tab=${t}`, { replace: true })

  const org = membership.org
  const role = membership.role

  // Shared fetches — one request per tab switch group, reused by several tabs.
  const products = useFetch<{ products: ProductItem[] }>('/api/supply/products')
  const orders = useFetch<{ orders: OrderListItem[] }>(`/api/supply/orders?orgId=${activeOrgId}`)
  const branches = useFetch<{ branches: BranchItem[] }>(`/api/supply/branches?orgId=${activeOrgId}`)
  const verification = useFetch<SupplierProfile>(`/api/suppliers/${activeOrgId}`)

  const awaiting = (orders.data?.orders ?? []).filter((o) => o.status === 'SUBMITTED').length
  const verified = verification.data?.supplier.verified ?? null

  return (
    <div className="mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 sm:py-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">SupplierOS</h1>
            {verified === true && (
              <Badge variant="secondary" className="gap-1 border-transparent bg-primary/10 text-primary">
                <ShieldCheck className="h-3.5 w-3.5" /> Verified supplier
              </Badge>
            )}
            {verified === false && (
              <Badge variant="secondary" className="border-transparent bg-accent/40 text-accent-foreground">
                Verification pending
              </Badge>
            )}
            <Badge variant="outline" className="gap-1 text-[11px] text-muted-foreground">
              <Warehouse className="h-3 w-3" /> Supply Network
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {org.name} · {[org.town, org.county].filter(Boolean).join(', ')}
            {verification.data ? ` · member since ${dateLabel(verification.data.supplier.memberSince)}` : ''}
            {' '}· your role: {role}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {memberships.length > 1 && (
            <Select value={activeOrgId} onValueChange={onOrgChange}>
              <SelectTrigger className="h-10 w-44 sm:w-56" aria-label="Switch supplier business">
                <SelectValue placeholder="Business" />
              </SelectTrigger>
              <SelectContent>
                {memberships.map((m) => (
                  <SelectItem key={m.orgId} value={m.orgId}>{m.org.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="icon" className="h-10 w-10" aria-label="Refresh data" onClick={() => { products.reload(); orders.reload(); branches.reload(); verification.reload(); onRefresh() }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={goTab} className="mt-6">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1 scrollbar-thin">
          {([
            ['overview', 'Overview'],
            ['products', 'Products'],
            ['orders', 'Orders'],
            ['quotes', 'Quotes'],
            ['warehouses', 'Warehouses'],
            ['inventory', 'Inventory'],
            ['billing', 'Billing'],
          ] as [TabKey, string][]).map(([key, label]) => (
            <TabsTrigger key={key} value={key} className="min-h-9 shrink-0 gap-1.5 px-3">
              {label}
              {key === 'orders' && awaiting > 0 && (
                <Badge variant="secondary" className="h-5 min-w-5 border-transparent bg-accent px-1 text-[10px] font-bold text-accent-foreground">
                  {awaiting > 9 ? '9+' : awaiting}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <FadeIn>
            <OverviewTab
              key={activeOrgId}
              orgId={activeOrgId}
              role={role}
              orgName={org.name}
              membership={membership}
              products={products}
              orders={orders}
              branches={branches}
              verification={verification}
            />
          </FadeIn>
        </TabsContent>
        <TabsContent value="products" className="mt-4">
          <FadeIn>
            <ProductsTab key={activeOrgId} products={products} role={role} orgId={activeOrgId} />
          </FadeIn>
        </TabsContent>
        <TabsContent value="orders" className="mt-4">
          <FadeIn>
            <OrdersTab key={activeOrgId} orgId={activeOrgId} role={role} orders={orders} products={products} />
          </FadeIn>
        </TabsContent>
        <TabsContent value="quotes" className="mt-4">
          <FadeIn>
            <QuotesTab key={activeOrgId} orgId={activeOrgId} role={role} verified={verified} />
          </FadeIn>
        </TabsContent>
        <TabsContent value="warehouses" className="mt-4">
          <FadeIn>
            <WarehousesTab key={activeOrgId} orgId={activeOrgId} role={role} branches={branches} />
          </FadeIn>
        </TabsContent>
        <TabsContent value="inventory" className="mt-4">
          <FadeIn>
            <InventoryTab key={activeOrgId} orgId={activeOrgId} role={role} />
          </FadeIn>
        </TabsContent>
        <TabsContent value="billing" className="mt-4">
          <FadeIn>
            <BillingTab key={activeOrgId} />
          </FadeIn>
        </TabsContent>
      </Tabs>
    </div>
  )
}
