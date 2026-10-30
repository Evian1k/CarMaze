'use client'

/* CARMAZE — Showrooms (#/showrooms)
 * Public directory of verified dealer showrooms. #/showrooms/<orgId>
 * renders the shared OrgStorefront business page; "Browse listings"
 * filters the marketplace to that dealer via ?org=<id>.
 */

import { useEffect, useState } from 'react'
import { Store, MapPin, BadgeCheck, ArrowRight, CarFront, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { VehicleCard, type VehicleCardData } from '@/components/marketplace/vehicle-card'
import OrgStorefront from '@/views/org-storefront'
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal'
import { useHashRoute } from '@/hooks/use-hash-route'
import { apiGet, navigate } from '@/lib/client'
import { timeAgo, money } from '@/lib/format'
import { toast } from 'sonner'

type Showroom = {
  id: string
  name: string
  county: string
  town: string | null
  location: string | null
  description: string | null
  createdAt: string
  listingCount: number
  vehicles: VehicleCardData[]
}

export default function View() {
  const route = useHashRoute()
  const routeOrgId = route.segments[1]
  const [showrooms, setShowrooms] = useState<Showroom[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Reload when the route re-enters this view
  useEffect(() => {
    let active = true
    apiGet<{ dealers: Showroom[] }>('/api/dealers')
      .then((d) => { if (active) { setShowrooms(d.dealers); setError(null) } })
      .catch((e: Error) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [route.view])

  function visit(s: Showroom) {
    if (s.listingCount === 0) {
      toast.info(`${s.name} has no live listings right now`)
      return
    }
    navigate(`cars?org=${s.id}`)
  }

  // ── Storefront detail route: #/showrooms/<orgId> ──
  if (routeOrgId) return <OrgStorefront key={routeOrgId} orgId={routeOrgId} />

  if (error) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-20 text-center">
        <SearchX className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-4 font-medium">Could not load showrooms</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" className="mt-6 h-11 px-6" onClick={() => navigate('showrooms')}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <Reveal>
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Verified dealer showrooms</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every showroom below is a registered, vetted Kenyan dealership. Buy with confidence — inspect,
            enquire and trade with businesses that are accountable to CARMAZE standards.
          </p>
        </header>
      </Reveal>

      {!showrooms ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-6">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-16 w-full" />
                <div className="grid grid-cols-3 gap-2">
                  <Skeleton className="aspect-[16/10] rounded-lg" />
                  <Skeleton className="aspect-[16/10] rounded-lg" />
                  <Skeleton className="aspect-[16/10] rounded-lg" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : showrooms.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Store className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No showrooms yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Verified dealerships appear here as they join CARMAZE. Check back soon.
            </p>
            <Button className="h-11 px-5" onClick={() => navigate('cars')}>Browse all cars</Button>
          </CardContent>
        </Card>
      ) : (
        <Stagger className="grid gap-4 lg:grid-cols-2">
          {showrooms.map((s) => {
            const place = [s.location, s.town, s.county].filter(Boolean).join(', ')
            return (
              <StaggerItem key={s.id}>
                <Card
                  className="cmz-gloss flex h-full cursor-pointer flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
                  onClick={() => navigate(`showrooms/${s.id}`)}
                >
                <CardContent className="flex flex-1 flex-col gap-4 p-6">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`showrooms/${s.id}`) }}
                        className="text-left text-lg font-bold hover:underline"
                      >
                        {s.name}
                      </button>
                      <Badge variant="outline" className="gap-1 text-primary">
                        <BadgeCheck className="h-3.5 w-3.5" /> Verified dealer
                      </Badge>
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4 shrink-0" /> {place || 'Kenya'}
                    </p>
                    {s.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-foreground/85">{s.description}</p>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {s.listingCount} live {s.listingCount === 1 ? 'listing' : 'listings'} · joined {timeAgo(s.createdAt)}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {s.vehicles.length > 0 ? (
                      s.vehicles.map((v) => (
                        <button
                          key={v.id}
                          onClick={(e) => { e.stopPropagation(); navigate(`vehicle-detail/${v.id}`) }}
                          className="group overflow-hidden rounded-lg border border-border text-left"
                          aria-label={`View ${v.make} ${v.model}`}
                        >
                          <div className="aspect-[16/10] overflow-hidden bg-muted">
                            {v.photos && v.photos.length > 0 ? (
                              <img
                                src={v.photos[0].url}
                                alt={`${v.make} ${v.model} ${v.year}`}
                                loading="lazy"
                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                              />
                            ) : (
                              <span className="flex h-full items-center justify-center text-muted-foreground">
                                <CarFront className="h-5 w-5" />
                              </span>
                            )}
                          </div>
                          <div className="p-2">
                            <p className="truncate text-xs font-medium">{v.make} {v.model}</p>
                            <p className="text-xs font-semibold text-primary">{money(v.priceMinor, v.currency)}</p>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="col-span-3 flex h-24 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
                        No live listings right now
                      </div>
                    )}
                  </div>

                  <div className="mt-auto grid grid-cols-2 gap-2">
                    <Button
                      className="h-11 gap-1.5"
                      onClick={(e) => { e.stopPropagation(); navigate(`showrooms/${s.id}`) }}
                      aria-label={`View ${s.name} storefront`}
                    >
                      View storefront <ArrowRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 gap-1.5"
                      onClick={(e) => { e.stopPropagation(); visit(s) }}
                    >
                      Browse listings <CarFront className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
              </StaggerItem>
            )
          })}
        </Stagger>
      )}
    </div>
  )
}
