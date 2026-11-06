'use client'

/* CARMAZE: Automotive Supply Network (#/supply)
 * The public B2B marketplace view. Modes by hash query:
 *   #/supply                      → landing: hero, fitment finder, tabs
 *                                    (parts catalogue / verified suppliers)
 *   #/supply?product=<id>         → full product detail page
 *   #/supply?supplier=<orgId>     → supplier storefront page
 * Data comes from the real supply APIs; nothing is mocked or invented.
 * Saved items and the procurement cart require sign-in and prompt for it.
 */

import { useEffect, useState } from 'react'
import { Package, ShieldCheck, Store, MapPin, Warehouse, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Reveal } from '@/components/motion/reveal'
import { useHashRoute } from '@/hooks/use-hash-route'
import { apiGet } from '@/lib/client'
import { useAuth } from '@/stores/auth'
import { ProductDetail } from '@/components/supply/product-detail'
import { SupplierStorefront } from '@/components/supply/supplier-storefront'
import { ProductCatalogue } from '@/components/supply/product-catalogue'
import { FitmentFinder } from '@/components/supply/fitment-finder'
import { SupplierDirectory, SupplierDirectorySkeleton } from '@/components/supply/supplier-directory'
import { BecomeSupplierDialog } from '@/components/supply/become-supplier-dialog'
import { useSavedSupply } from '@/components/supply/saved-store'
import type { CategoryRow, CatalogueResponse, SuppliersResponse } from '@/components/supply/shared'

export default function SupplyView() {
  const route = useHashRoute()

  // ── Mode 2: full product detail ──
  const productId = route.query.get('product')
  // ── Mode 3: supplier storefront ──
  const supplierId = route.query.get('supplier')

  if (productId) return <ProductDetail key={productId} productId={productId} />
  if (supplierId) return <SupplierStorefront key={supplierId} supplierId={supplierId} />

  return <SupplyLanding routeTab={route.query.get('tab')} />
}

// ─────────────────────────────────── Landing ─────────────────────────────────

function SupplyLanding({ routeTab }: { routeTab: string | null }) {
  const { user } = useAuth()
  const hydrateSaved = useSavedSupply((s) => s.hydrate)
  const resetSaved = useSavedSupply((s) => s.reset)

  const [categories, setCategories] = useState<CategoryRow[] | null>(null)
  const [suppliers, setSuppliers] = useState<SuppliersResponse | null>(null)
  const [supplierError, setSupplierError] = useState<string | null>(null)
  const [supplierReload, setSupplierReload] = useState(0)
  const [catalogueTotal, setCatalogueTotal] = useState<number | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)

  // Hydrate saved items for signed-in users; clear on sign-out.
  useEffect(() => {
    if (user) void hydrateSaved()
    else resetSaved()
  }, [user, hydrateSaved, resetSaved])

  // Categories (small, public)
  useEffect(() => {
    let active = true
    apiGet<{ categories: CategoryRow[] }>('/api/supply/categories')
      .then((d) => { if (active) setCategories(d.categories) })
      .catch(() => { if (active) setCategories([]) })
    return () => { active = false }
  }, [])

  // Verified supplier directory (powers the tab + hero stats)
  useEffect(() => {
    let active = true
    apiGet<SuppliersResponse>('/api/suppliers?pageSize=36')
      .then((d) => { if (active) { setSuppliers(d); setSupplierError(null) } })
      .catch((e: Error) => { if (active) setSupplierError(e.message) })
    return () => { active = false }
  }, [supplierReload])

  // Catalogue total for the hero stat chip (light query, first page only)
  useEffect(() => {
    let active = true
    apiGet<CatalogueResponse>('/api/supply/catalogue?pageSize=6')
      .then((d) => { if (active) setCatalogueTotal(d.total) })
      .catch(() => { if (active) setCatalogueTotal(null) })
    return () => { active = false }
  }, [])

  const countiesCovered = suppliers
    ? new Set(suppliers.suppliers.map((s) => s.county).filter(Boolean)).size
    : null

  return (
    <div className="min-h-screen bg-background">
      {/* Hero strip */}
      <section className="cmz-aurora relative overflow-hidden border-b bg-brand-deep text-brand-deep-foreground">
        <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
          <Reveal>
            <Badge className="mb-3 gap-1 bg-gold text-gold-foreground hover:bg-gold">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verified B2B network
            </Badge>
            <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              Automotive Supply Network
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-white/85 sm:text-base">
              Kenya&apos;s procurement marketplace for garages and fleets; verified parts suppliers, honest
              fitment records, wholesale pricing and warehouse-level availability.
            </p>
          </Reveal>

          {/* Live stat chips */}
          <div className="mt-5 flex flex-wrap gap-2" aria-label="Network statistics">
            <StatChip
              icon={<Store className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Verified suppliers"
              value={suppliers ? String(suppliers.total) : null}
            />
            <StatChip
              icon={<Package className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Parts listed"
              value={catalogueTotal != null ? catalogueTotal.toLocaleString() : null}
            />
            <StatChip
              icon={<MapPin className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Counties covered"
              value={countiesCovered != null && countiesCovered > 0 ? String(countiesCovered) : null}
            />
            <StatChip
              icon={<Warehouse className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Branch-level stock"
              value="Live"
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              size="lg"
              className="h-11 gap-1.5 bg-background text-foreground hover:bg-background/90"
              onClick={() => document.getElementById('catalogue-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              <Package className="h-4 w-4" aria-hidden="true" /> Browse parts
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 gap-1.5 border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
              onClick={() => setApplyOpen(true)}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" /> Become a supplier
            </Button>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        {/* Signature feature: always visible on the landing */}
        <FitmentFinder />

        <Tabs defaultValue={routeTab === 'suppliers' ? 'suppliers' : 'catalogue'} id="catalogue-panel">
          <TabsList className="h-11 w-full sm:w-auto" aria-label="Supply network sections">
            <TabsTrigger value="catalogue" className="flex-1 gap-1.5 px-4 sm:flex-none">
              <Package className="h-4 w-4" aria-hidden="true" /> Parts catalogue
            </TabsTrigger>
            <TabsTrigger value="suppliers" className="flex-1 gap-1.5 px-4 sm:flex-none">
              <Store className="h-4 w-4" aria-hidden="true" /> Verified suppliers
              {suppliers && <span className="ml-1 text-xs text-muted-foreground">({suppliers.total})</span>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="catalogue" className="mt-5">
            {categories ? (
              <ProductCatalogue categories={categories} pageSize={24} />
            ) : (
              <CatalogueSkeleton />
            )}
          </TabsContent>

          <TabsContent value="suppliers" className="mt-5">
            {supplierError ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
                <Store className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
                <p className="font-medium">Could not load suppliers</p>
                <p className="max-w-sm text-sm text-muted-foreground">{supplierError}</p>
                <Button variant="outline" onClick={() => setSupplierReload((k) => k + 1)}>Retry</Button>
              </div>
            ) : suppliers ? (
              <SupplierDirectory suppliers={suppliers.suppliers} />
            ) : (
              <SupplierDirectorySkeleton />
            )}
          </TabsContent>
        </Tabs>

        {/* Trust footer note */}
        <p className="pt-2 text-center text-xs text-muted-foreground">
          Fitment verdicts reflect recorded data only: CARMAZE never invents compatibility. Authenticity
          verification is reviewed independently by the platform, separate from supplier verification.
        </p>
      </div>

      <BecomeSupplierDialog open={applyOpen} onOpenChange={setApplyOpen} />
    </div>
  )
}

function StatChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 text-sm backdrop-blur">
      {icon}
      {value ? (
        <strong className="font-semibold">{value}</strong>
      ) : (
        <Skeleton className="h-3 w-8 bg-white/20" />
      )}
      <span className="text-white/75">{label}</span>
    </span>
  )
}

function CatalogueSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-11 w-full" />
        <div className="mt-2 flex gap-2">
          <Skeleton className="h-11 w-56" />
          <Skeleton className="h-11 w-44" />
          <Skeleton className="h-11 w-36" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border p-4">
            <Skeleton className="aspect-[4/3] w-full rounded-lg" />
            <Skeleton className="mt-3 h-4 w-3/4" />
            <Skeleton className="mt-2 h-3 w-1/2" />
            <Skeleton className="mt-3 h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
