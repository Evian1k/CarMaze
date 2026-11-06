'use client'

/* Supplier storefront: GET /api/suppliers/[id].
 * Public business page for the Automotive Supply Network: cover hero,
 * verification badge (only when verified), opening hours, branches with
 * delivery areas, categories/brands, live product grid (server-filtered via
 * /api/supply/catalogue?supplier=<id>) and org reviews. Contact details come
 * from the API already gated to verified suppliers, and the UI checks
 * `verified` again before rendering them.
 */

import { useEffect, useState } from 'react'
import {
  ArrowLeft, MapPin, Clock, Phone, Mail, Package, Warehouse, Truck,
  Bookmark, BookmarkCheck, Building2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet, navigate } from '@/lib/client'
import { dateLabel } from '@/lib/format'
import { useAuth } from '@/stores/auth'
import { useSavedSupply } from '@/components/supply/saved-store'
import { ProductCatalogue } from '@/components/supply/product-catalogue'
import { Stars, SupplierAvatar, VerifiedBadge, type CategoryRow } from '@/components/supply/shared'

type OpeningHours = Record<string, [string, string] | null> | null

type Branch = {
  id: string
  name: string
  code: string
  kind: string
  county: string
  town: string | null
  address: string | null
  operatingHours: OpeningHours
  deliveryAreas: string[]
  isPrimary: boolean
}

type StorefrontData = {
  supplier: {
    id: string
    name: string
    regNo: string | null
    verified: boolean
    county: string
    town: string | null
    location: string | null
    description: string | null
    logoUrl: string | null
    coverUrl: string | null
    gallery: string[]
    openingHours: OpeningHours
    serviceAreas: string[]
    specialities: string[]
    whatsappEnabled: boolean
    callEnabled: boolean
    responseMinutes: number | null
    phone: string | null
    email: string | null
    rating: number | null
    reviewCount: number
    productCount: number
    memberSince: string
    policies: { returnsAccepted: boolean; note: string }
  }
  branches: Branch[]
  categories: CategoryRow[]
  brands: (string | null)[]
  reviews: { id: string; rating: number; comment: string | null; author: string; createdAt: string }[]
}

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}

export function SupplierStorefront({ supplierId }: { supplierId: string }) {
  const { user } = useAuth()
  const hydrateSaved = useSavedSupply((s) => s.hydrate)
  const [state, setState] = useState<{ key: string; data: StorefrontData } | null>(null)
  const [errState, setErrState] = useState<{ key: string; message: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // Chips drive the product grid through the catalogue's server-side filters.
  // (Declared before any early return so hook order stays stable.)
  const [activeCat, setActiveCat] = useState('')
  const [activeBrand, setActiveBrand] = useState('')
  // Deep links skip the landing: hydrate saved suppliers for the bookmark.
  useEffect(() => {
    if (user) void hydrateSaved()
  }, [user, hydrateSaved])
  // Derived loading/error keyed to the current request (no sync setState in effects)
  const fetchKey = `${supplierId}|${reloadKey}`
  const loading = state?.key !== fetchKey
  const error = errState?.key === fetchKey ? errState.message : null
  const data = state?.data ?? null

  useEffect(() => {
    let active = true
    const key = `${supplierId}|${reloadKey}`
    apiGet<StorefrontData>(`/api/suppliers/${encodeURIComponent(supplierId)}`)
      .then((d) => { if (active) { setState({ key, data: d }); setErrState(null) } })
      .catch((e: Error) => { if (active) setErrState({ key, message: e.message }) })
    return () => { active = false }
  }, [supplierId, reloadKey])

  if (loading) return <StorefrontSkeleton />

  if (error || !data) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-20 text-center">
        <Building2 className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="mt-4 font-medium">Could not load this supplier</p>
        <p className="mt-1 text-sm text-muted-foreground">{error ?? 'The storefront may no longer be active.'}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" className="h-11 px-6" onClick={() => setReloadKey((k) => k + 1)}>Retry</Button>
          <Button className="h-11 px-6" onClick={() => navigate('/supply')}>Back to the network</Button>
        </div>
      </div>
    )
  }

  const s = data.supplier
  const brands = data.brands.filter((b): b is string => Boolean(b))

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <Button variant="ghost" className="mb-4 h-11 gap-1.5 px-2" onClick={() => navigate('/supply')}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Supply network
      </Button>

      {/* Hero */}
      <section className="overflow-hidden rounded-2xl border border-border">
        <div className="relative h-40 bg-brand-deep sm:h-52">
          {s.coverUrl ? (
            <img src={s.coverUrl} alt={`${s.name} cover`} className="h-full w-full object-cover" />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-[#10130f]/80 via-[#10130f]/35 to-transparent" aria-hidden="true" />
        </div>
        <div className="relative bg-card p-4 sm:p-6">
          <div className="-mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end">
            <SupplierAvatar
              name={s.name}
              logoUrl={s.logoUrl}
              className="h-20 w-20 border-4 border-card shadow-md sm:h-24 sm:w-24"
              textClassName="text-2xl"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">{s.name}</h1>
                <VerifiedBadge verified={s.verified} />
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  {[s.town, s.county].filter(Boolean).join(', ') || s.county}
                </span>
                {s.rating != null && s.rating > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Stars avg={s.rating} />
                    {s.rating.toFixed(1)} ({s.reviewCount})
                  </span>
                )}
                <span>Member since {dateLabel(s.memberSince)}</span>
              </p>
            </div>
            <SaveSupplierButton supplierId={s.id} name={s.name} signedIn={Boolean(user)} />
          </div>

          {s.description && <p className="mt-4 max-w-3xl text-sm leading-relaxed text-foreground/90">{s.description}</p>}
          {s.specialities.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {s.specialities.map((sp) => <Badge key={sp} variant="secondary">{sp}</Badge>)}
            </div>
          )}

          {/* Contact: verified suppliers only (double-gated: API + UI) */}
          {s.verified && (s.phone || s.email) ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {s.phone && (
                <a href={`tel:${s.phone}`} className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm transition-colors hover:bg-muted">
                  <Phone className="h-4 w-4 text-primary" aria-hidden="true" /> {s.phone}
                </a>
              )}
              {s.email && (
                <a href={`mailto:${s.email}`} className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm transition-colors hover:bg-muted">
                  <Mail className="h-4 w-4 text-primary" aria-hidden="true" /> {s.email}
                </a>
              )}
              {s.responseMinutes != null && (
                <Badge variant="secondary">Typically replies in ~{s.responseMinutes} min</Badge>
              )}
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
              Contact details are published once this business completes CARMAZE verification.
            </p>
          )}
        </div>
      </section>

      {/* Info grid: hours + branches + policies */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {s.openingHours && (
          <Card>
            <CardContent className="p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Opening hours
              </h2>
              <ul className="mt-3 space-y-1.5">
                {DAY_ORDER.map((day) => {
                  const hours = s.openingHours?.[day]
                  return (
                    <li key={day} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{DAY_LABELS[day] ?? day}</span>
                      {hours ? (
                        <span className="font-medium">{hours[0]}–{hours[1]}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Closed</span>
                      )}
                    </li>
                  )
                })}
                {Object.keys(s.openingHours)
                  .filter((k) => !DAY_ORDER.includes(k))
                  .map((k) => {
                    const hours = s.openingHours?.[k]
                    return (
                      <li key={k} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{k}</span>
                        <span className="font-medium">{hours ? `${hours[0]}–${hours[1]}` : 'Closed'}</span>
                      </li>
                    )
                  })}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card className={s.openingHours ? '' : 'lg:col-span-2'}>
          <CardContent className="p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Warehouse className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Branches &amp; warehouses ({data.branches.length})
            </h2>
            {data.branches.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No public branches listed yet.</p>
            ) : (
              <ul className="scrollbar-thin mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
                {data.branches.map((b) => (
                  <li key={b.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{b.name}</span>
                      <Badge variant="outline" className="font-mono text-[11px]">{b.code}</Badge>
                      <Badge variant="secondary">{b.kind === 'WAREHOUSE' ? 'Warehouse' : 'Branch'}</Badge>
                      {b.isPrimary && <Badge className="bg-gold text-gold-foreground">HQ</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[b.town, b.county].filter(Boolean).join(', ')}
                      {b.address ? ` · ${b.address}` : ''}
                    </p>
                    {b.deliveryAreas.length > 0 && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <Truck className="h-3.5 w-3.5" aria-hidden="true" /> Delivers to:
                        {b.deliveryAreas.slice(0, 6).map((a) => (
                          <span key={a} className="rounded bg-muted px-1.5 py-0.5">{a}</span>
                        ))}
                        {b.deliveryAreas.length > 6 && <span>+{b.deliveryAreas.length - 6} more</span>}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold">Policies</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{s.policies.note}</p>
            {(s.serviceAreas.length > 0 || s.productCount > 0) && (
              <>
                <p className="mt-3 text-xs font-medium">Delivery coverage</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.serviceAreas.length > 0 ? (
                    s.serviceAreas.map((a) => <Badge key={a} variant="secondary" className="text-[11px]">{a}</Badge>)
                  ) : (
                    <span className="text-xs text-muted-foreground">Not published: ask the supplier.</span>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Products */}
      <section className="mt-8" aria-label={`${s.name} products`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-xl font-bold tracking-tight sm:text-2xl">
            <Package className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> Parts from {s.name}
          </h2>
          <Badge variant="secondary">{s.productCount} published</Badge>
        </div>

        {(data.categories.length > 0 || brands.length > 0) && (
          <div className="mb-3 space-y-2">
            {data.categories.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Categories:</span>
                {data.categories.map((c) => (
                  <button
                    key={c.slug}
                    onClick={() => setActiveCat((cur) => (cur === c.slug ? '' : c.slug))}
                    aria-pressed={activeCat === c.slug}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      activeCat === c.slug ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            {brands.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Brands carried:</span>
                {brands.map((b) => (
                  <button
                    key={b}
                    onClick={() => setActiveBrand((cur) => (cur === b ? '' : b))}
                    aria-pressed={activeBrand === b}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      activeBrand === b ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <ProductCatalogue
          key={`${supplierId}|${activeCat}|${activeBrand}`}
          categories={data.categories}
          fixedSupplierId={s.id}
          fixedSupplierName={s.name}
          initialFilters={{ category: activeCat, brand: activeBrand }}
          showHeader={false}
          pageSize={12}
        />
      </section>

      {/* Org reviews */}
      <section className="mt-8" aria-label="Supplier reviews">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">Supplier reviews</h2>
          {s.reviewCount > 0 && s.rating != null && (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Stars avg={s.rating} /> {s.rating.toFixed(1)} from {s.reviewCount} review{s.reviewCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {data.reviews.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No reviews yet for this supplier.</p>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {data.reviews.map((r) => (
              <li key={r.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars avg={r.rating} />
                  <span className="text-sm font-medium">{r.author}</span>
                  <span className="text-xs text-muted-foreground">{dateLabel(r.createdAt)}</span>
                </div>
                {r.comment && <p className="mt-2 text-sm text-foreground/90">{r.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SaveSupplierButton({ supplierId, name, signedIn }: { supplierId: string; name: string; signedIn: boolean }) {
  const toggleSaved = useSavedSupply((s) => s.toggle)
  const savedSuppliers = useSavedSupply((s) => s.suppliers)
  const saved = Boolean(savedSuppliers[supplierId])
  function onClick() {
    if (!signedIn) {
      toast.info('Sign in to save suppliers')
      navigate('signin')
      return
    }
    void toggleSaved('SUPPLIER', supplierId, name)
  }
  return (
    <Button variant="outline" className="h-11 gap-1.5" onClick={onClick}>
      {saved ? <BookmarkCheck className="h-4 w-4 text-primary" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />}
      {saved ? 'Saved' : 'Save supplier'}
    </Button>
  )
}

function StorefrontSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6" aria-busy="true">
      <Skeleton className="mb-4 h-9 w-36" />
      <div className="overflow-hidden rounded-2xl border border-border">
        <Skeleton className="h-40 w-full rounded-none sm:h-52" />
        <div className="bg-card p-6">
          <div className="flex items-end gap-4">
            <Skeleton className="-mt-12 h-20 w-20 rounded-lg sm:-mt-14" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-64" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </div>
          </div>
          <Skeleton className="mt-4 h-4 w-3/4" />
          <Skeleton className="mt-2 h-4 w-1/2" />
        </div>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="aspect-[4/3] rounded-xl" />)}
      </div>
    </div>
  )
}
