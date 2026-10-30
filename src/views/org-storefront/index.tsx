'use client'

/* CARMAZE — OrgStorefront: the shared public business page behind
 * #/garages/<orgId> and #/showrooms/<orgId>. One showpiece view for both
 * GARAGE and DEALER orgs: parallax cover hero, sticky contact bar, about +
 * gallery lightbox, services & pricing or live inventory, earned reviews,
 * FAQ, contact & hours, trust strip — and an in-place storefront editor for
 * OWNER/MANAGER members (PATCH /api/orgs/storefront). */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  motion, useReducedMotion, useScroll, useTransform,
} from 'framer-motion'
import {
  ArrowLeft, CalendarCheck, Clock, MapPin, MessageCircle, Pencil, Phone, ShieldCheck,
  Star, Users, Wrench, Award, ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { VehicleCard } from '@/components/marketplace/vehicle-card'
import { CountUp, Reveal, Stagger, StaggerItem } from '@/components/motion/reveal'
import { apiGet, navigate } from '@/lib/client'
import { money, SERVICE_CATEGORY_LABELS, timeAgo } from '@/lib/format'
import { useAuth } from '@/stores/auth'
import {
  GalleryLightbox, OpenNowChip, OpeningHoursTable, RatingDistribution, responseTimeLabel,
  Stars, StorefrontMissing, StorefrontSkeleton, ExternalChip,
} from '@/components/storefront/parts'
import { BookingDialog, MessageDialog, QuoteDialog, ReviewDialog, TestDriveDialog } from '@/components/storefront/dialogs'
import { HandoverDialog } from '@/components/storefront/handover-dialog'
import { StorefrontSettingsDialog } from '@/components/storefront/settings-dialog'
import type { StorefrontData, StorefrontReview, StorefrontService } from '@/components/storefront/types'

// ─────────────────────────── helpers ───────────────────────────

function memberYear(memberSince: string | number): number {
  if (typeof memberSince === 'number') return memberSince
  const d = new Date(memberSince)
  return Number.isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear()
}

function whatsappHref(phone: string, text: string): string {
  let digits = phone.replace(/[^\d]/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = `254${digits.slice(1)}`
  if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('1'))) digits = `254${digits}`
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

// ─────────────────────────── view ───────────────────────────

export default function OrgStorefront({ orgId }: { orgId: string }) {
  const user = useAuth((s) => s.user)
  const reduce = useReducedMotion()

  const [data, setData] = useState<StorefrontData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liveReviews, setLiveReviews] = useState<StorefrontReview[] | null>(null)
  // memberships of the signed-in user (to reveal the storefront editor)
  const [myMemberships, setMyMemberships] = useState<{ orgId: string; role: string }[] | null>(null)

  // dialogs
  const [messageCfg, setMessageCfg] = useState<{ vehicleId?: string; subject?: string; kind?: 'GENERAL' | 'VEHICLE_ENQUIRY' } | null>(null)
  const [quoteCfg, setQuoteCfg] = useState<{ category?: string; title?: string } | null>(null)
  const [bookingService, setBookingService] = useState<StorefrontService | null>(null)
  const [handoverCfg, setHandoverCfg] = useState<{ open: boolean; presetWork?: string }>({ open: false })
  const [testDriveVehicle, setTestDriveVehicle] = useState<{ id: string; label: string } | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  // scroll-to-top + (re)load per org
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [orgId])

  useEffect(() => {
    let active = true
    apiGet<StorefrontData>(`/api/orgs/${orgId}/storefront`)
      .then((d) => { if (active) setData(d) })
      .catch((e: { status?: number; message?: string }) => {
        if (!active) return
        if (e?.status === 404) setNotFound(true)
        else setError(e?.message ?? 'Could not load this storefront')
      })
    return () => { active = false }
  }, [orgId])

  // can this user edit the storefront? (OWNER/MANAGER of THIS org)
  useEffect(() => {
    if (!user) return
    let active = true
    apiGet<{ memberships: { orgId: string; role: string }[] }>('/api/orgs/me')
      .then((d) => { if (active) setMyMemberships(d.memberships ?? []) })
      .catch(() => { if (active) setMyMemberships([]) })
    return () => { active = false }
  }, [user])

  const canEdit = Boolean(
    user && myMemberships?.some((m) => m.orgId === orgId && (m.role === 'OWNER' || m.role === 'MANAGER'))
  )

  const org = data?.org
  const isGarage = org?.type === 'GARAGE'

  // optimistic review state
  const reviews = liveReviews ?? data?.reviews ?? []
  const rating = useMemo(() => {
    if (liveReviews && org) {
      const avg = liveReviews.length ? Math.round((liveReviews.reduce((a, r) => a + r.rating, 0) / liveReviews.length) * 10) / 10 : 0
      return { avg, count: liveReviews.length }
    }
    return data?.rating ?? { avg: 0, count: 0 }
  }, [liveReviews, data, org])

  if (notFound) return <StorefrontMissing kind={org?.type ?? 'UNKNOWN'} />
  if (error) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-24 text-center">
        <p className="font-medium">Something went wrong loading this storefront.</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" className="mt-6 h-11 px-6" onClick={() => window.location.reload()}>Try again</Button>
      </div>
    )
  }
  if (!data || !org) return <StorefrontSkeleton />

  const cover = org.coverUrl ?? null
  const gallery = org.gallery ?? []
  const place = [org.location, org.town, org.county].filter(Boolean).join(', ') || 'Kenya'
  const responseLabel = responseTimeLabel(org.responseMinutes)
  const services = data.services ?? []
  const vehicles = data.vehicles ?? []
  const stats = data.stats
  const year = memberYear(stats.memberSince)

  function openMessage(cfg: { vehicleId?: string; subject?: string; kind?: 'GENERAL' | 'VEHICLE_ENQUIRY' }) {
    setMessageCfg(cfg)
  }

  function onReviewSubmitted(review: StorefrontReview) {
    // Upsert semantics: the API may return an existing review (same org+author).
    // De-duplicate by id so the optimistic list never renders it twice.
    const base = liveReviews ?? data?.reviews ?? []
    setLiveReviews([review, ...base.filter((r) => r.id !== review.id)])
  }

  function refetch() {
    apiGet<StorefrontData>(`/api/orgs/${orgId}/storefront`)
      .then((d) => { setData(d); setLiveReviews(null) })
      .catch(() => toast.error('Could not refresh the storefront'))
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ── a) Hero / cover with parallax ── */}
      <HeroCover org={org} verified={data.verified} rating={rating} responseLabel={responseLabel} isGarage={Boolean(isGarage)} />

      {/* ── b) Sticky action bar (desktop sticky / mobile bottom bar) ── */}
      <div className="sticky top-16 z-30 hidden border-b border-border bg-background/90 backdrop-blur-md lg:block" aria-label="Contact actions">
        <ActionBar
          org={org}
          isGarage={Boolean(isGarage)}
          onMessage={() => openMessage({})}
          onQuote={() => setQuoteCfg({})}
          onHandover={() => setHandoverCfg({ open: true })}
        />
      </div>
      <div
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-background/95 px-3 py-2 backdrop-blur-md lg:hidden"
        aria-label="Contact actions"
      >
        <ActionBar
          org={org}
          isGarage={Boolean(isGarage)}
          compact
          onMessage={() => openMessage({})}
          onQuote={() => setQuoteCfg({})}
          onHandover={() => setHandoverCfg({ open: true })}
        />
      </div>

      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        {/* ── Stats strip ── */}
        <Reveal className="-mt-0">
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Reviews', node: <CountUp value={stats.reviewCount} className="text-xl font-bold text-foreground" /> },
              isGarage
                ? { label: 'Completed jobs', node: <CountUp value={stats.completedJobs ?? 0} className="text-xl font-bold text-foreground" /> }
                : { label: 'Live listings', node: <CountUp value={stats.listingCount ?? 0} className="text-xl font-bold text-foreground" /> },
              isGarage && stats.serviceCount != null
                ? { label: 'Services listed', node: <CountUp value={stats.serviceCount} className="text-xl font-bold text-foreground" /> }
                : { label: 'County', node: <span className="text-xl font-bold text-foreground">{org.county}</span> },
              { label: 'Member since', node: <span className="text-xl font-bold text-foreground">{year}</span> },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
                <div aria-hidden="true">{s.node}</div>
                <p className="text-xs text-muted-foreground" aria-label={s.label}>{s.label}</p>
              </div>
            ))}
          </div>
        </Reveal>

        {/* ── c) About + gallery ── */}
        {(org.description || org.serviceAreas.length > 0 || gallery.length > 0) && (
          <section className="mt-10" aria-label={`About ${org.name}`}>
            <Reveal>
              <h2 className="text-xl font-bold tracking-tight">About</h2>
              {org.description && (
                <p className="mt-2 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-foreground/90">{org.description}</p>
              )}
              {org.serviceAreas.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Service areas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {org.serviceAreas.map((a) => (
                      <Badge key={a} variant="outline" className="border-[#315e4b]/30 text-[#315e4b]">{a}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </Reveal>
            {gallery.length > 0 && (
              <Reveal delay={0.08}>
                <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Gallery</p>
                <Stagger className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {gallery.slice(0, 9).map((url, i) => (
                    <StaggerItem key={url + i}>
                      <button
                        onClick={() => setLightboxIndex(i)}
                        className="group block w-full overflow-hidden rounded-xl border border-border bg-muted"
                        aria-label={`Open photo ${i + 1} of ${gallery.length}`}
                      >
                        <img
                          src={url}
                          alt={`${org.name} — gallery photo ${i + 1}`}
                          loading="lazy"
                          className="aspect-[4/3] w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                        />
                      </button>
                    </StaggerItem>
                  ))}
                </Stagger>
              </Reveal>
            )}
          </section>
        )}

        {/* ── d) GARAGE: services & pricing ── */}
        {isGarage && (
          <section className="mt-12" aria-label="Services and pricing">
            <Reveal>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Services &amp; pricing</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Transparent menu — request a quote for anything bespoke.</p>
                </div>
                <Button variant="outline" className="hidden h-11 shrink-0 gap-1.5 sm:inline-flex" onClick={() => setHandoverCfg({ open: true })}>
                  <Wrench className="h-4 w-4" aria-hidden="true" /> Hand over vehicle
                </Button>
              </div>
            </Reveal>
            {services.length === 0 ? (
              <Reveal>
                <div className="mt-4 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No fixed services listed yet — request a quote and {org.name} will respond with a tailored price.
                </div>
              </Reveal>
            ) : (
              <Stagger className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {services.map((s) => (
                  <StaggerItem key={s.id}>
                    <motion.article
                      whileHover={reduce ? undefined : { y: -3 }}
                      className="flex h-full flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
                    >
                      <Badge variant="secondary" className="w-fit text-[11px]">{SERVICE_CATEGORY_LABELS[s.category] ?? s.category}</Badge>
                      <h3 className="mt-2.5 font-semibold leading-snug">{s.title}</h3>
                      {s.description && <p className="mt-1.5 line-clamp-3 text-sm text-muted-foreground">{s.description}</p>}
                      <p className="mt-3 text-lg font-bold text-primary">
                        {s.priceFromMinor != null ? <>from {money(s.priceFromMinor)}</> : <span className="text-sm font-medium text-muted-foreground">Quote on request</span>}
                      </p>
                      <div className="mt-auto flex gap-2 pt-4">
                        <Button variant="outline" className="h-10 flex-1" onClick={() => setQuoteCfg({ category: s.category, title: s.title })}>
                          Request quote
                        </Button>
                        {s.priceFromMinor != null && (
                          <Button className="h-10 flex-1" onClick={() => setBookingService(s)}>Book this service</Button>
                        )}
                      </div>
                    </motion.article>
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </section>
        )}

        {/* ── e) DEALER: current inventory ── */}
        {org.type === 'DEALER' && (
          <section className="mt-12" aria-label="Current inventory">
            <Reveal>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Current inventory</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {vehicles.length > 0 ? `${vehicles.length} live ${vehicles.length === 1 ? 'listing' : 'listings'} — sold and reserved badges are always genuine.` : 'No live listings right now.'}
                  </p>
                </div>
                <Button variant="outline" className="hidden h-11 shrink-0 gap-1.5 sm:inline-flex" onClick={() => navigate(`cars?org=${org.id}`)}>
                  See all in marketplace <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </Reveal>
            {vehicles.length === 0 ? (
              <Reveal>
                <div className="mt-4 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Nothing live at the moment — message the showroom and they can alert you when stock arrives.
                </div>
              </Reveal>
            ) : (
              <Stagger className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {vehicles.map((v) => (
                  <StaggerItem key={v.id} className="flex h-full flex-col">
                    <div className="flex-1">
                      <VehicleCard v={v} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => openMessage({ vehicleId: v.id, subject: `Enquiry: ${v.make} ${v.model} ${v.year}`, kind: 'VEHICLE_ENQUIRY' })}
                        className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-card text-xs font-medium transition-colors hover:bg-muted"
                      >
                        <MessageCircle className="h-4 w-4 text-primary" aria-hidden="true" /> Ask about this vehicle
                      </button>
                      <button
                        onClick={() => setTestDriveVehicle({ id: v.id, label: `${v.make} ${v.model} ${v.year}` })}
                        disabled={v.status === 'SOLD'}
                        className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-card text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <CalendarCheck className="h-4 w-4 text-primary" aria-hidden="true" /> Book test drive
                      </button>
                    </div>
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </section>
        )}

        {/* ── f) Reviews ── */}
        <section className="mt-12 rounded-2xl bg-muted/40 p-5 sm:p-8" aria-label="Customer reviews">
          <Reveal>
            <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
              <div className="text-center lg:text-left">
                <div className="flex items-end justify-center gap-2 lg:justify-start">
                  <motion.span
                    initial={reduce ? undefined : { scale: 0.7, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ type: 'spring', stiffness: 220, damping: 18 }}
                    className="text-5xl font-extrabold leading-none text-foreground"
                  >
                    {rating.count > 0 ? rating.avg.toFixed(1) : '—'}
                  </motion.span>
                  <span className="pb-1 text-sm text-muted-foreground">/ 5</span>
                </div>
                <div className="mt-2 flex justify-center lg:justify-start">
                  <Stars avg={rating.avg} starClass="h-4.5 w-4.5" />
                </div>
                <p className="mt-1.5 flex items-center justify-center gap-1 text-xs text-muted-foreground lg:justify-start">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" /> {rating.count} {rating.count === 1 ? 'review' : 'reviews'}
                </p>
                <div className="mt-4">
                  <Button variant="outline" className="h-10 w-full gap-1.5" onClick={() => setReviewOpen(true)}>
                    <Star className="h-4 w-4" aria-hidden="true" /> Write a review
                  </Button>
                  <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground lg:text-left">
                    {isGarage
                      ? 'Earned by completing a booked service here.'
                      : 'Earned by completing a test drive here.'}
                  </p>
                </div>
              </div>
              <div>
                <RatingDistribution reviews={reviews} />
                {reviews.length === 0 ? (
                  <p className="mt-6 rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
                    No reviews yet — be the first to share your experience after a completed service.
                  </p>
                ) : (
                  <Stagger className="mt-6 space-y-3" gap={0.05}>
                    {reviews.slice(0, 10).map((r) => (
                      <StaggerItem key={r.id}>
                        <article className="rounded-xl border border-border bg-card p-4">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#315e4b]/10 text-sm font-bold text-[#315e4b]" aria-hidden="true">
                              {r.authorName.slice(0, 2).toUpperCase()}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{r.authorName}</p>
                              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Stars avg={r.rating} starClass="h-3 w-3" /> {timeAgo(r.createdAt)}
                              </p>
                            </div>
                          </div>
                          {r.comment && <p className="mt-2.5 text-sm leading-relaxed text-foreground/90">{r.comment}</p>}
                        </article>
                      </StaggerItem>
                    ))}
                  </Stagger>
                )}
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── g) FAQ ── */}
        {org.faqs.length > 0 && (
          <section className="mt-12" aria-label="Frequently asked questions">
            <Reveal>
              <h2 className="mb-4 text-xl font-bold tracking-tight">Frequently asked questions</h2>
              <Accordion type="single" collapsible className="rounded-xl border border-border bg-card px-4">
                {org.faqs.map((f, i) => (
                  <AccordionItem key={i} value={`faq-${i}`}>
                    <AccordionTrigger className="text-sm font-semibold">{f.q}</AccordionTrigger>
                    <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </Reveal>
          </section>
        )}

        {/* ── h) Contact & hours ── */}
        <section className="mt-12" aria-label={`Contact ${org.name}`}>
          <Reveal>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
                <h2 className="flex items-center gap-2 text-lg font-bold"><Clock className="h-5 w-5 text-primary" aria-hidden="true" /> Opening hours</h2>
                <p className="mb-3 mt-1 text-xs text-muted-foreground">Kenya time (EAT) · <OpenNowChip hours={org.openingHours} className="align-middle" /></p>
                <OpeningHoursTable hours={org.openingHours} />
              </div>
              <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
                <h2 className="text-lg font-bold">Contact</h2>
                <div className="mt-3 space-y-3 text-sm">
                  <p className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span>{place}</span>
                  </p>
                  {responseLabel && (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4 shrink-0" aria-hidden="true" /> {responseLabel}
                    </p>
                  )}
                  {org.callEnabled && org.phone && (
                    <div>
                      <Button variant="outline" className="h-11 w-full gap-2" asChild>
                        <a href={`tel:${org.phone}`} aria-label="Call business — leaves CARMAZE">
                          <Phone className="h-4 w-4 text-primary" aria-hidden="true" /> Call {org.phone} <ExternalChip />
                        </a>
                      </Button>
                      <p className="mt-1 text-xs text-muted-foreground">Calling happens outside CARMAZE.</p>
                    </div>
                  )}
                  {org.whatsappEnabled && org.phone && (
                    <div>
                      <Button variant="outline" className="h-11 w-full gap-2" asChild>
                        <a
                          href={whatsappHref(org.phone, `Hi ${org.name}, I found you on CARMAZE.`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Chat on WhatsApp — opens WhatsApp, outside CARMAZE"
                        >
                          <MessageCircle className="h-4 w-4 text-[#25D366]" aria-hidden="true" /> WhatsApp {org.phone} <ExternalChip />
                        </a>
                      </Button>
                      <p className="mt-1 text-xs text-muted-foreground">Opens WhatsApp — this happens outside CARMAZE.</p>
                    </div>
                  )}
                  {!org.callEnabled && !org.whatsappEnabled && (
                    <p className="text-xs text-muted-foreground">This business prefers in-app messaging — use the button below.</p>
                  )}
                  <Button className="h-11 w-full gap-2" onClick={() => openMessage({})}>
                    <MessageCircle className="h-4 w-4" aria-hidden="true" /> Message us
                  </Button>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── i) Trust strip ── */}
        <Reveal className="mt-12">
          <footer className="flex flex-col items-center gap-1.5 rounded-xl border border-[#315e4b]/20 bg-[#315e4b]/5 px-4 py-5 text-center" aria-label="Trust information">
            <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm font-medium text-[#315e4b]">
              <Award className="h-4 w-4" aria-hidden="true" />
              {data.verified ? 'Verified by CARMAZE' : 'Listed on CARMAZE'}
              <span aria-hidden="true" className="text-[#315e4b]/40">·</span> Member since {year}
              {isGarage && stats.completedJobs != null && (
                <>
                  <span aria-hidden="true" className="text-[#315e4b]/40">·</span> <CountUp value={stats.completedJobs} className="font-bold" /> completed {stats.completedJobs === 1 ? 'job' : 'jobs'}
                </>
              )}
              {!isGarage && stats.listingCount != null && (
                <>
                  <span aria-hidden="true" className="text-[#315e4b]/40">·</span> <CountUp value={stats.listingCount} className="font-bold" /> live {stats.listingCount === 1 ? 'listing' : 'listings'}
                </>
              )}
            </p>
            <p className="text-xs text-muted-foreground">Payments and workmanship stay between you and the business — CARMAZE keeps the record.</p>
          </footer>
        </Reveal>
      </main>

      {/* ── j) Floating editor for OWNER / MANAGER ── */}
      {canEdit && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Button
            onClick={() => setSettingsOpen(true)}
            className="fixed bottom-[calc(8.5rem+env(safe-area-inset-bottom))] right-4 z-30 h-12 gap-2 rounded-full shadow-lg lg:bottom-6 lg:right-20"
            aria-label="Edit this storefront"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">Edit storefront</span>
          </Button>
        </motion.div>
      )}

      {/* ── Dialogs ── */}
      {org && (
        <MessageDialog
          open={messageCfg !== null}
          onOpenChange={(open) => { if (!open) setMessageCfg(null) }}
          org={{ id: org.id, name: org.name }}
          vehicleId={messageCfg?.vehicleId}
          kind={messageCfg?.kind ?? 'GENERAL'}
          subject={messageCfg?.subject ?? ''}
        />
      )}
      {org && (
        <QuoteDialog
          open={quoteCfg !== null}
          onOpenChange={(open) => { if (!open) setQuoteCfg(null) }}
          org={{ id: org.id, name: org.name, county: org.county, town: org.town }}
          presetCategory={quoteCfg?.category}
          presetTitle={quoteCfg?.title}
        />
      )}
      {org && bookingService && (
        <BookingDialog
          open={bookingService !== null}
          onOpenChange={(open) => { if (!open) setBookingService(null) }}
          org={{ id: org.id, name: org.name, county: org.county, town: org.town }}
          service={bookingService}
        />
      )}
      {org && (
        <HandoverDialog
          open={handoverCfg.open}
          onOpenChange={(open) => setHandoverCfg((c) => ({ ...c, open }))}
          org={{ id: org.id, name: org.name }}
          presetWork={handoverCfg.presetWork}
        />
      )}
      {org && testDriveVehicle && (
        <TestDriveDialog
          open={testDriveVehicle !== null}
          onOpenChange={(open) => { if (!open) setTestDriveVehicle(null) }}
          org={{ id: org.id, name: org.name }}
          vehicleId={testDriveVehicle.id}
          vehicleLabel={testDriveVehicle.label}
        />
      )}
      {org && (
        <ReviewDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          org={{ id: org.id, name: org.name }}
          onSubmitted={onReviewSubmitted}
        />
      )}
      {org && (
        <StorefrontSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          data={data}
          onSaved={refetch}
        />
      )}

      {/* ── Lightbox ── */}
      <GalleryLightbox
        images={gallery}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        open={lightboxIndex !== null}
        onOpenChange={(open) => { if (!open) setLightboxIndex(null) }}
        altBase={org.name}
      />
    </div>
  )
}

// ─────────────────────────── hero (own component so useScroll's target ref
// is always hydrated — the hook must never run before the cover exists) ──

function HeroCover({
  org, verified, rating, responseLabel, isGarage,
}: {
  org: StorefrontData['org']
  verified: boolean
  rating: { avg: number; count: number }
  responseLabel: string | null
  isGarage: boolean
}) {
  const reduce = useReducedMotion()
  // Page-level scroll clamped to the hero region — equivalent to a target-ref
  // parallax (hero always sits at the top of the page) without the
  // "ref not hydrated" failure mode of useScroll({ target }).
  const { scrollY } = useScroll()
  const coverY = useTransform(scrollY, [0, 600], [0, reduce ? 0 : 90], { clamp: true })
  const coverScale = useTransform(scrollY, [0, 600], [1, reduce ? 1 : 1.12], { clamp: true })
  const cover = org.coverUrl
  const place = [org.location, org.town, org.county].filter(Boolean).join(', ') || 'Kenya'

  return (
    <section className="relative overflow-hidden bg-[#10130f]" aria-label={`${org.name} — business overview`}>
      <motion.div className="absolute inset-0" style={cover ? { y: coverY, scale: coverScale } : undefined}>
        {cover ? (
          <img src={cover} alt="" className="h-[115%] w-full object-cover" />
        ) : (
          <div className="h-[115%] w-full bg-gradient-to-br from-[#315e4b] via-[#234237] to-[#10130f]" aria-hidden="true" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#10130f] via-[#10130f]/60 to-[#10130f]/25" aria-hidden="true" />
      </motion.div>

      <div className="relative mx-auto max-w-6xl px-4 pb-8 pt-4 sm:px-6 sm:pb-10">
        <button
          onClick={() => navigate(isGarage ? 'garages' : 'showrooms')}
          className="mb-8 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-medium text-white/90 backdrop-blur transition-colors hover:bg-white/20"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> All {isGarage ? 'garages' : 'showrooms'}
        </button>

        <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
            className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-white/10 text-2xl font-bold text-white shadow-xl backdrop-blur"
          >
            {org.logoUrl ? <img src={org.logoUrl} alt={`${org.name} logo`} className="h-full w-full object-cover" /> : org.name.slice(0, 2).toUpperCase()}
          </motion.div>

          <div className="min-w-0 flex-1">
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-bold text-white sm:text-4xl">{org.name}</h1>
                {verified && (
                  <Badge className="gap-1 border-none bg-[#c9a45c] text-[#10130f] hover:bg-[#c9a45c]">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> CARMAZE Verified
                  </Badge>
                )}
                <Badge variant="outline" className="border-white/30 text-white/85">{isGarage ? 'Garage' : 'Showroom'}</Badge>
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-white/80">
                <MapPin className="h-4 w-4" aria-hidden="true" /> {place}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                <span className="flex items-center gap-1.5">
                  <Stars avg={rating.avg} starClass="h-4 w-4" />
                  <span className="font-semibold text-white">{rating.count > 0 ? rating.avg.toFixed(1) : 'New'}</span>
                  <span className="text-white/70">({rating.count} {rating.count === 1 ? 'review' : 'reviews'})</span>
                </span>
                {responseLabel && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/90">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {responseLabel}
                  </span>
                )}
                <OpenNowChip hours={org.openingHours} className="border-white/25 bg-white/10 text-white/90" />
              </div>
            </motion.div>
          </div>
        </div>

        {org.specialities.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {org.specialities.slice(0, 8).map((s) => (
              <span key={s} className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-xs text-white/90 backdrop-blur">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ─────────────────────────── action bar ───────────────────────────

function ActionBar({
  org, isGarage, compact, onMessage, onQuote, onHandover,
}: {
  org: StorefrontData['org']
  isGarage: boolean
  compact?: boolean
  onMessage: () => void
  onQuote: () => void
  onHandover: () => void
}) {
  return (
    <div className={`mx-auto flex max-w-6xl items-center gap-2 ${compact ? 'scrollbar-thin overflow-x-auto py-0.5' : 'flex-wrap px-4 py-2.5 sm:px-6'}`}>
      <OpenNowChip hours={org.openingHours} className="hidden shrink-0 sm:inline-flex" />
      <Button className="h-10 shrink-0 gap-1.5" onClick={onMessage} aria-label={`Message ${org.name}`}>
        <MessageCircle className="h-4 w-4" aria-hidden="true" /> Message
      </Button>
      {isGarage && (
        <>
          <Button variant="outline" className="h-10 shrink-0 gap-1.5" onClick={onQuote}>
            Request quote
          </Button>
          <Button variant="outline" className="h-10 shrink-0 gap-1.5" onClick={onHandover}>
            <Wrench className="h-4 w-4" aria-hidden="true" /> Hand over vehicle
          </Button>
        </>
      )}
      <span className="flex-1" aria-hidden="true" />
      {org.callEnabled && org.phone && (
        <Button variant="outline" className="h-10 shrink-0 gap-1.5" asChild>
          <a href={`tel:${org.phone}`} aria-label="Call business — leaves CARMAZE" title="Call business — leaves CARMAZE">
            <Phone className="h-4 w-4 text-primary" aria-hidden="true" /> Call <ExternalChip />
          </a>
        </Button>
      )}
      {org.whatsappEnabled && org.phone && (
        <Button variant="outline" className="h-10 shrink-0 gap-1.5" asChild>
          <a
            href={whatsappHref(org.phone, `Hi ${org.name}, I found you on CARMAZE.`)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="WhatsApp — opens WhatsApp, outside CARMAZE"
            title="Opens WhatsApp — this happens outside CARMAZE"
          >
            <MessageCircle className="h-4 w-4 text-[#25D366]" aria-hidden="true" /> WhatsApp <ExternalChip />
          </a>
        </Button>
      )}
    </div>
  )
}
