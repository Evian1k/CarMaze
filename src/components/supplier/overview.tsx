'use client'

/* SupplierOS — Overview tab: stat cards (published products, open orders,
 * awaiting-response orders, warehouses), verification status card and a
 * recent-orders mini list. All numbers come from the live endpoints; nothing
 * is simulated. Verification is displayed exactly as the API reports it. */

import { Package, ClipboardList, Inbox, Warehouse, ArrowRight, ShieldCheck, ShieldAlert, Star } from 'lucide-react'
import { navigate } from '@/lib/client'
import { money, timeAgo } from '@/lib/format'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  type FetchState, type ProductItem, type OrderListItem, type BranchItem, type SupplierProfile, type Membership,
  StatCard, StatusBadge, LoadingBlock, ModuleNotice, EmptyState,
  PO_STATUS_LABELS, PO_BADGE_CLASS, OPEN_ORDER_STATUSES,
} from './shared'

type Props = {
  orgId: string
  role: string
  orgName: string
  membership: Membership | undefined
  products: FetchState<{ products: ProductItem[] }>
  orders: FetchState<{ orders: OrderListItem[] }>
  branches: FetchState<{ branches: BranchItem[] }>
  verification: FetchState<SupplierProfile>
}

export function OverviewTab({ orgId, orgName, membership, products, orders, branches, verification }: Props) {
  const productList = products.data?.products ?? []
  const published = productList.filter((p) => p.status === 'PUBLISHED').length
  const orderList = orders.data?.orders ?? []
  const open = orderList.filter((o) => OPEN_ORDER_STATUSES.includes(o.status)).length
  const awaiting = orderList.filter((o) => o.status === 'SUBMITTED').length
  const activeBranches = (branches.data?.branches ?? []).filter((b) => b.status === 'ACTIVE').length
  const recent = orderList.slice(0, 5)

  const catalogueBoundElsewhere = membership ? productList.some((p) => p.supplierOrgId !== membership.orgId) : false

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {products.loading ? (
          <Skeleton className="h-20" />
        ) : (
          <StatCard
            label="Published products"
            value={published}
            icon={<Package className="h-5 w-5" />}
            hint={published < productList.length ? `${productList.length - published} in draft/other states` : 'All products live'}
            onClick={() => navigate('/supplier?tab=products')}
          />
        )}
        {orders.loading ? (
          <Skeleton className="h-20" />
        ) : (
          <StatCard
            label="Open orders"
            value={open}
            icon={<ClipboardList className="h-5 w-5" />}
            hint="Live purchase orders from garages"
            onClick={() => navigate('/supplier?tab=orders')}
          />
        )}
        {orders.loading ? (
          <Skeleton className="h-20" />
        ) : (
          <StatCard
            label="Awaiting your response"
            value={awaiting}
            icon={<Inbox className="h-5 w-5" />}
            hint={awaiting > 0 ? 'Garages are waiting — respond early' : 'Inbox clear'}
            onClick={() => navigate('/supplier?tab=orders')}
          />
        )}
        {branches.loading ? (
          <Skeleton className="h-20" />
        ) : (
          <StatCard
            label="Warehouses"
            value={activeBranches}
            icon={<Warehouse className="h-5 w-5" />}
            hint="Active stock locations"
            onClick={() => navigate('/supplier?tab=warehouses')}
          />
        )}
      </div>

      {/* Verification status */}
      <VerificationCard profile={verification} orgName={orgName} />

      {catalogueBoundElsewhere && (
        <Alert>
          <Package className="h-4 w-4" />
          <AlertTitle>Catalogue follows your primary supplier business</AlertTitle>
          <AlertDescription>
            Product counts above come from the catalogue endpoint, which is bound to your account&apos;s primary supplier
            business. Orders, warehouses and inventory on this page reflect <strong>{orgName}</strong>.
          </AlertDescription>
        </Alert>
      )}

      {/* Recent orders */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">Recent orders</CardTitle>
            <CardDescription>Latest purchase orders sent to this business.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/supplier?tab=orders')}>
            All orders <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </CardHeader>
        <CardContent>
          {orders.loading ? (
            <LoadingBlock label="Loading orders…" />
          ) : orders.error ? (
            <ModuleNotice title="Orders could not load" detail={orders.error.message} retry={orders.reload} />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-8 w-8" />}
              title="No orders yet"
              detail="When verified garages send purchase orders, they appear here. Publish products so garages can find you in the supply catalogue."
            />
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      <span className="font-mono text-xs text-muted-foreground">{o.refCode}</span> · {o.garage.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {o.itemCount} line{o.itemCount === 1 ? '' : 's'} · {timeAgo(o.createdAt)}
                      {o.revisedBySupplier ? ' · revision proposed' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{money(o.totalMinor, o.currency)}</span>
                    <StatusBadge status={o.status} labels={PO_STATUS_LABELS} classes={PO_BADGE_CLASS} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function VerificationCard({ profile, orgName }: { profile: FetchState<SupplierProfile>; orgName: string }) {
  if (profile.loading) {
    return (
      <Card>
        <CardContent className="px-6 py-5">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="mt-2 h-4 w-full max-w-md" />
        </CardContent>
      </Card>
    )
  }
  if (profile.error || !profile.data) {
    return (
      <ModuleNotice
        title="Verification status could not load"
        detail={profile.error?.message}
        retry={profile.reload}
      />
    )
  }
  const s = profile.data.supplier
  return s.verified ? (
    <Card className="border-primary/30">
      <CardContent className="flex flex-wrap items-center gap-4 px-6 py-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Verified business</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {orgName} passed CARMAZE document review. The verified badge is shown to garages on your storefront and
            catalogue listings. Verification status is controlled by the platform — it is never self-claimed.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {s.rating != null && (
            <span className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5 text-primary" /> {s.rating.toFixed(1)} ({s.reviewCount})
            </span>
          )}
          <span>{s.productCount} product{s.productCount === 1 ? '' : 's'}</span>
          <span>{profile.data.branches.length} location{profile.data.branches.length === 1 ? '' : 's'}</span>
        </div>
      </CardContent>
    </Card>
  ) : (
    <Alert className={cn('border-accent/60')}>
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>Verification pending — platform review required</AlertTitle>
      <AlertDescription>
        {orgName} is registered but not yet verified. Unverified suppliers are never shown as verified publicly —
        your storefront, contact details and catalogue go live to garages once the CARMAZE review team approves your
        documents. You can keep preparing your catalogue and warehouses in the meantime.
      </AlertDescription>
    </Alert>
  )
}
