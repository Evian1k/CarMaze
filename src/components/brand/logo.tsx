'use client'

import { cn } from '@/lib/utils'

/**
 * CARMAZE official brand logo — the founders' approved emblem asset.
 *
 * ASSET POLICY: this component renders the official logo files generated from
 * `public/brand/carmaze-logo.png` (see scripts/build-brand.ts). Do NOT redraw,
 * distort or substitute the artwork. The circular emblem already contains the
 * wordmark "CARMAZE" and the tagline "FIND. CONNECT. DRIVE." — it is never
 * stretched, cropped or recoloured. All sizes across the platform (desktop,
 * mobile, tablet, splash, dashboards) use the appropriately optimised PNG.
 */

type LogoProps = {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'full' | 'emblem' | 'stacked'
  /** Kept for API compatibility — the official emblem reads well on both surfaces. */
  onDark?: boolean
  /** Kept for API compatibility — the tagline is part of the official asset. */
  showTagline?: boolean
  className?: string
}

// Height policy (width auto — aspect ratio is always preserved, square asset)
const SIZE_CLASS: Record<string, string> = {
  sm: 'h-10 w-10',   // mobile header
  md: 'h-12 w-12',   // tablet header
  lg: 'h-14 w-14',   // desktop header
  xl: 'h-36 w-36 sm:h-44 sm:w-44', // intro / splash / sign-in
}

// Optimised files per rendered size (crisp at every breakpoint, no pixelation)
const SIZE_SRC: Record<string, string> = {
  sm: '/brand/carmaze-logo-128.png',
  md: '/brand/carmaze-logo-128.png',
  lg: '/brand/carmaze-logo-128.png',
  xl: '/brand/carmaze-logo-512.png',
}

export function Emblem({ className }: { className?: string }) {
  return (
    <img
      src="/brand/carmaze-logo-128.png"
      alt="CARMAZE emblem"
      width={128}
      height={128}
      className={cn('h-8 w-8 select-none rounded-lg object-contain', className)}
      draggable={false}
    />
  )
}

export function Logo({ size = 'md', variant = 'full', className }: LogoProps) {
  const src = SIZE_SRC[size] ?? SIZE_SRC.md
  const sizeClass = SIZE_CLASS[size] ?? SIZE_CLASS.md

  return (
    <img
      src={src}
      alt="CARMAZE — Find. Connect. Drive."
      width={512}
      height={512}
      className={cn(
        'select-none rounded-xl object-contain shadow-[0_1px_2px_rgba(0,0,0,0.18)]',
        sizeClass,
        variant === 'emblem' && 'rounded-lg',
        className,
      )}
      draggable={false}
    />
  )
}
