'use client'

/* CARMAZE Platforms (#/platforms): public landing page for the ecosystem's
 * nine platform surfaces. Describes what each surface honestly does and links
 * into the relevant hash routes. No fake stats: the live listing count is only
 * shown when /api/vehicles/home actually loads. Verification is performed by a
 * human team: uploading documents never self-verifies an account. */

import { useEffect, useState } from 'react'
import {
  ArrowRight, Car, Globe, LayoutGrid, Package, ShieldCheck, Store, Tag,
  Truck, Users, Wrench,
} from 'lucide-react'
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { apiGet, navigate } from '@/lib/client'

type Platform = {
  icon: React.ComponentType<{ className?: string }>
  name: string
  desc: string
  /** Optional honesty badge (e.g. invitation-only surfaces). */
  badge?: string
  /** One or two calls to action into the app via hash routes. */
  ctas: { label: string; href: string }[]
}

const PLATFORMS: Platform[] = [
  {
    icon: Car,
    name: 'Customer Platform',
    desc: 'Browse, save and compare verified listings, enquire with sellers, book services and test drives, order parts and track your orders.',
    ctas: [
      { label: 'Browse vehicles', href: '/cars' },
      { label: 'Your account', href: '/account' },
    ],
  },
  {
    icon: Tag,
    name: 'Private Seller',
    desc: 'List your car free. An identity-verified seller badge appears only after our team reviews your documents.',
    ctas: [{ label: 'List your vehicle', href: '/sell' }],
  },
  {
    icon: Store,
    name: 'ShowroomOS',
    desc: 'Dealership operations: inventory, offers, staff accounts, branches and billing in one console.',
    ctas: [{ label: 'Apply / open console', href: '/dealer' }],
  },
  {
    icon: Wrench,
    name: 'GarageOS',
    desc: 'Garage operations: service catalog, quotes, bookings, vehicle custody and parts procurement.',
    ctas: [{ label: 'Open GarageOS', href: '/garage-dashboard' }],
  },
  {
    icon: Package,
    name: 'SupplierOS',
    desc: 'Parts distribution: manage your catalogue and warehouses, and fulfil both B2B and consumer orders.',
    ctas: [{ label: 'Open SupplierOS', href: '/supplier' }],
  },
  {
    icon: Truck,
    name: 'LogisticsOS',
    desc: 'Delivery network: accept jobs, manage drivers and confirm every handover with an OTP-confirmed delivery.',
    ctas: [{ label: 'Open LogisticsOS', href: '/logistics' }],
  },
  {
    icon: Users,
    name: 'Company Staff',
    desc: 'Internal CARMAZE staff accounts are created by invitation only. There is no public signup for staff.',
    badge: 'Invitation only',
    ctas: [],
  },
  {
    icon: ShieldCheck,
    name: 'Operations OS (Super Admin)',
    desc: 'Verification center, moderation and finance tools for the CARMAZE operations team.',
    badge: 'Staff only: no public registration',
    ctas: [],
  },
  {
    icon: Globe,
    name: 'Public Website',
    desc: 'Discovery for buyers and vehicle owners: search, showrooms, garages, memberships and the driver community.',
    ctas: [{ label: 'Browse vehicles', href: '/cars' }],
  },
]

export default function PlatformsView() {
  // Real listing count from the live API; omitted silently if the request fails.
  const [publishedListings, setPublishedListings] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<{ stats: { publishedListings: number } }>('/api/vehicles/home')
      .then((d) => { if (!cancelled) setPublishedListings(d.stats.publishedListings) })
      .catch(() => { /* omit the count silently */ })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero: deep brand green stays dark in both themes ── */}
      <section className="bg-brand-deep text-brand-deep-foreground" aria-labelledby="platforms-heading">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <Reveal>
            <Badge variant="outline" className="gap-1.5 border-gold/60 bg-gold/10 text-gold">
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
              One ecosystem
            </Badge>
            <h1 id="platforms-heading" className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              One ecosystem. Nine platforms.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-brand-deep-foreground/80 sm:text-base">
              CARMAZE connects everyone in Kenya&apos;s vehicle journey: buyers, private sellers,
              dealerships, garages, parts suppliers and delivery operators: on nine connected
              surfaces. Here is what each one honestly does.
            </p>
            {publishedListings !== null && (
              <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-brand-deep-foreground/20 bg-brand-deep-foreground/5 px-3 py-1.5 text-xs text-brand-deep-foreground/85">
                <Car className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
                {publishedListings.toLocaleString('en-KE')} live vehicle
                listing{publishedListings === 1 ? '' : 's'} on the marketplace right now
              </p>
            )}
          </Reveal>
        </div>
      </section>

      {/* ── Platform cards ── */}
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6" aria-label="The nine CARMAZE platforms">
        <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORMS.map((p) => (
            <StaggerItem key={p.name}>
              <PlatformCard platform={p} />
            </StaggerItem>
          ))}
        </Stagger>
      </main>

      {/* ── Honest verification note ── */}
      <section className="mx-auto max-w-6xl px-4 pb-14 sm:px-6" aria-labelledby="verification-heading">
        <Reveal>
          <Card className="p-6 sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 id="verification-heading" className="text-lg font-bold sm:text-xl">
                  Verification is done by people, not uploads
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                  Applications for dealer, garage, supplier, seller and logistics accounts are
                  reviewed by a human verification team. Uploading documents never self-verifies
                  an account: badges appear only after our review is complete. No platform
                  subscription or payment grants a verified status.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => navigate('info?view=safety')}>
                    Trust &amp; safety
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" onClick={() => navigate('partners')}>
                    Partner network
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </Reveal>
      </section>
    </div>
  )
}

// ─────────────────────────── Platform card ───────────────────────────

function PlatformCard({ platform: p }: { platform: Platform }) {
  return (
    <Card className="flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
          <p.icon className="h-5 w-5" />
        </span>
        {p.badge && (
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            {p.badge}
          </Badge>
        )}
      </div>
      <h3 className="mt-3 font-semibold leading-tight">{p.name}</h3>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
      {p.ctas.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 pt-1">
          {p.ctas.map((c, i) => (
            <Button
              key={c.href}
              size="sm"
              variant={i === 0 ? 'default' : 'outline'}
              onClick={() => navigate(c.href)}
            >
              {c.label}
              {i === 0 && <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
            </Button>
          ))}
        </div>
      )}
    </Card>
  )
}
