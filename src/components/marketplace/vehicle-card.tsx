'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { Heart, MapPin, BadgeCheck, Eye } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { navigate } from '@/lib/client'
import { money, vehicleTitle } from '@/lib/format'
import { useAuth } from '@/stores/auth'

export type VehicleCardData = {
  id: string
  refCode: string
  make: string
  model: string
  year: number
  priceMinor: number
  currency: string
  mileageKm: number
  fuel: string
  transmission: string
  bodyType: string
  condition: string
  county: string
  status?: string
  featured?: boolean
  photos?: { url: string; order: number }[]
  photo?: string
  sellerType?: string
  orgName?: string | null
  orgIsDemo?: boolean
}

export function VehicleCard({ v, saved, onToggleSave }: { v: VehicleCardData; saved?: boolean; onToggleSave?: (v: VehicleCardData) => void }) {
  const { user } = useAuth()
  const reduce = useReducedMotion()
  const img = v.photo || (v.photos && v.photos.length > 0 ? v.photos[0].url : null)
  return (
    <motion.article
      whileHover={reduce ? undefined : { y: -6 }}
      whileTap={reduce ? undefined : { scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className="cmz-gloss group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow duration-300 hover:shadow-xl"
    >
      <button
        onClick={() => navigate(`vehicle-detail/${v.id}`)}
        className="relative block aspect-[16/10] w-full overflow-hidden bg-muted"
        aria-label={`View ${vehicleTitle(v)}`}
      >
        {img ? (
          <img
            src={img}
            alt={`${vehicleTitle(v)}: ${v.condition === 'FOREIGN_USED' ? 'foreign used' : v.condition === 'LOCAL_USED' ? 'locally used' : 'brand new'} ${v.bodyType.toLowerCase()} in ${v.county}`}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.07]"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-xs text-muted-foreground">No photo yet</span>
        )}
        {/* cinematic hover scrim + view-details pill */}
        <span className="pointer-events-none absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/55 via-black/10 to-transparent pb-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden>
          <span className="flex translate-y-3 items-center gap-1.5 rounded-full bg-white/95 px-3.5 py-1.5 text-[11px] font-semibold text-foreground shadow-lg backdrop-blur transition-transform duration-300 group-hover:translate-y-0">
            <Eye className="h-3.5 w-3.5" /> View details
          </span>
        </span>
        {v.featured && (
          <Badge className="absolute left-2 top-2 border-none bg-accent text-accent-foreground">Featured</Badge>
        )}
        {v.status === 'SOLD' && (
          <Badge className="absolute left-2 top-2 border-none bg-foreground/80 text-background">Sold</Badge>
        )}
        {v.status === 'RESERVED' && (
          <Badge variant="secondary" className="absolute left-2 top-2">Reserved</Badge>
        )}
      </button>

      {user && onToggleSave && (
        <motion.button
          onClick={(e) => { e.stopPropagation(); onToggleSave(v) }}
          whileTap={{ scale: 0.72 }}
          animate={saved ? { scale: [1, 1.28, 1] } : { scale: 1 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          aria-label={saved ? 'Remove from saved' : 'Save vehicle'}
          aria-pressed={saved}
          className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm transition-colors hover:bg-black/55"
        >
          <Heart className={`h-4.5 w-4.5 transition-colors duration-300 ${saved ? 'fill-[#D9B878] text-[#D9B878]' : 'text-white'}`} />
        </motion.button>
      )}

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <button onClick={() => navigate(`vehicle-detail/${v.id}`)} className="text-left text-[15px] font-semibold leading-snug hover:underline">
            {vehicleTitle(v)}
          </button>
          {v.sellerType !== 'PRIVATE' && (
            <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label="Verified dealer listing" />
          )}
        </div>
        <p className="text-lg font-bold text-primary transition-colors duration-300 group-hover:text-primary/85">{money(v.priceMinor, v.currency)}</p>
        <p className="text-xs text-muted-foreground">
          {v.mileageKm.toLocaleString()} km · {v.fuel.charAt(0) + v.fuel.slice(1).toLowerCase()} · {v.transmission === 'AUTOMATIC' ? 'Auto' : 'Manual'}
        </p>
        <p className="mt-auto flex items-center gap-1 pt-1 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> {v.county}
          {v.orgName && <span className="ml-auto max-w-32 truncate">· {v.orgName}</span>}
          {v.orgIsDemo && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400" title="Demo listing: sample data, not real inventory">
              Demo
            </span>
          )}
        </p>
      </div>
    </motion.article>
  )
}
