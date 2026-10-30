'use client'

/* CARMAZE — shared storefront building blocks: stars, open-now logic
 * (computed in Africa/Nairobi via Intl), gallery lightbox, animated rating
 * distribution, opening-hours table, skeleton + missing-org states. */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Clock, ShieldQuestion, Star, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { navigate } from '@/lib/client'
import { DAY_KEYS, DAY_LABELS, type OpeningHours, type StorefrontReview } from './types'

// ─────────────────────────── Stars ───────────────────────────

export function Stars({ avg, className, starClass = 'h-3.5 w-3.5' }: { avg: number; className?: string; starClass?: string }) {
  const rounded = Math.round(avg)
  return (
    <span className={cn('flex', className)} role="img" aria-label={`Rated ${avg.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(starClass, i <= rounded ? 'fill-[#c9a45c] text-[#c9a45c]' : 'text-muted-foreground/40')}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}

// ─────────────────────────── Open-now (Africa/Nairobi) ───────────────────────────

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10))
  return (h || 0) * 60 + (m || 0)
}

/** Current weekday ('mon'…'sun') + minutes-since-midnight in Nairobi. */
export function nairobiNow(): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  let h = parseInt(get('hour'), 10)
  if (h === 24) h = 0
  return { day: get('weekday').toLowerCase().slice(0, 3), minutes: h * 60 + parseInt(get('minute'), 10) }
}

export function isOpenNow(hours: OpeningHours): boolean {
  const { day, minutes } = nairobiNow()
  const today = hours[day]
  if (!today) return false
  return minutes >= toMinutes(today[0]) && minutes < toMinutes(today[1])
}

export function OpenNowChip({ hours, className }: { hours: OpeningHours; className?: string }) {
  const open = isOpenNow(hours)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        open ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground',
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', open ? 'animate-pulse bg-primary' : 'bg-muted-foreground/60')} aria-hidden="true" />
      {open ? 'Open now' : 'Closed now'}
    </span>
  )
}

export function responseTimeLabel(responseMinutes: number | null): string | null {
  if (!responseMinutes || responseMinutes <= 0) return null
  if (responseMinutes < 60) return `Typically replies in ~${responseMinutes} min`
  const hours = Math.round(responseMinutes / 60)
  return `Typically replies in ~${hours}h`
}

// ─────────────────────────── External-contact hint ───────────────────────────

export function ExternalChip({ label = 'External' }: { label?: string }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded border border-dashed border-current px-1 py-px text-[10px] font-semibold uppercase tracking-wide opacity-70"
      title="This contact happens outside CARMAZE"
    >
      {label}
    </span>
  )
}

// ─────────────────────────── Gallery lightbox ───────────────────────────

export function GalleryLightbox({
  images,
  index,
  onIndexChange,
  open,
  onOpenChange,
  altBase,
}: {
  images: string[]
  index: number | null
  onIndexChange: (i: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  altBase: string
}) {
  const reduce = useReducedMotion()
  const count = images.length

  useEffect(() => {
    if (!open || count === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') onIndexChange(((index ?? 0) + 1) % count)
      if (e.key === 'ArrowLeft') onIndexChange(((index ?? 0) - 1 + count) % count)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, count, index, onIndexChange])

  const step = (dir: 1 | -1) => onIndexChange((((index ?? 0) + dir) % count + count) % count)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] border-none bg-black/95 p-0 sm:max-w-3xl [&>button]:bg-white/10 [&>button]:hover:bg-white/20"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') step(1)
          if (e.key === 'ArrowLeft') step(-1)
        }}
      >
        <DialogTitle className="sr-only">{altBase} — photo {(index ?? 0) + 1} of {count}</DialogTitle>
        <div className="relative flex h-full items-center justify-center" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {index !== null && images[index] && (
              <motion.img
                key={images[index] + index}
                src={images[index]}
                alt={`${altBase} — photo ${(index ?? 0) + 1} of ${count}`}
                className="max-h-[80vh] w-full rounded-lg object-contain"
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, x: 24 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, x: -24 }}
                transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
              />
            )}
          </AnimatePresence>
          {count > 1 && (
            <>
              <button
                onClick={() => step(-1)}
                aria-label="Previous photo"
                className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/25"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={() => step(1)}
                aria-label="Next photo"
                className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/25"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white" aria-hidden="true">
                {(index ?? 0) + 1} / {count}
              </span>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────── Rating distribution ───────────────────────────

export function RatingDistribution({ reviews }: { reviews: StorefrontReview[] }) {
  const counts = [5, 4, 3, 2, 1].map((star) => ({ star, n: reviews.filter((r) => r.rating === star).length }))
  const total = reviews.length
  return (
    <div className="space-y-1.5" role="img" aria-label="Rating distribution">
      {counts.map(({ star, n }) => (
        <div key={star} className="flex items-center gap-2 text-xs">
          <span className="flex w-8 shrink-0 items-center gap-0.5 text-muted-foreground">
            {star} <Star className="h-3 w-3 fill-[#c9a45c] text-[#c9a45c]" aria-hidden="true" />
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full rounded-full bg-[#c9a45c]"
              initial={{ width: 0 }}
              whileInView={{ width: total ? `${(n / total) * 100}%` : '0%' }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.9, ease: [0.22, 0.61, 0.36, 1], delay: 0.1 * (5 - star) }}
            />
          </div>
          <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">{n}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────── Opening-hours table ───────────────────────────

export function OpeningHoursTable({ hours }: { hours: OpeningHours }) {
  const today = nairobiNow().day
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Opening hours (Kenya time)</caption>
      <tbody>
        {DAY_KEYS.map((day) => {
          const range = hours[day]
          return (
            <tr key={day} className={cn('border-b border-border/50 last:border-0', day === today && 'font-semibold text-foreground')} aria-current={day === today ? 'date' : undefined}>
              <td className="py-1.5 pr-2">
                {DAY_LABELS[day]}
                {day === today && <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Today</span>}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {range ? (
                  `${range[0]} – ${range[1]}`
                ) : (
                  <span className="text-muted-foreground">Closed</span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ─────────────────────────── Loading / missing states ───────────────────────────

export function StorefrontSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading storefront">
      <Skeleton className="h-[300px] w-full rounded-none sm:h-[380px]" />
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  )
}

export function StorefrontMissing({ kind }: { kind: 'GARAGE' | 'DEALER' | 'UNKNOWN' }) {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-24 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted"
      >
        {kind === 'DEALER' ? <Store className="h-8 w-8 text-muted-foreground" /> : <ShieldQuestion className="h-8 w-8 text-muted-foreground" />}
      </motion.div>
      <h1 className="mt-5 text-2xl font-bold">This business page isn&rsquo;t available</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The business you&rsquo;re looking for may no longer be listed on CARMAZE, or its storefront is temporarily unavailable.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button className="h-11 px-5" onClick={() => navigate('garages')}>Browse garages</Button>
        <Button variant="outline" className="h-11 px-5" onClick={() => navigate('showrooms')}>Browse showrooms</Button>
      </div>
      <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" /> HTTP 404 — not found or inactive
      </p>
    </div>
  )
}
