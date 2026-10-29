'use client'

import { cn } from '@/lib/utils'

/**
 * CARMAZE brand logo — single reusable component.
 *
 * NOTE ON ASSETS: the founders' approved logo file was not provided in this
 * repository, so this component implements a clean typographic wordmark and a
 * compact road emblem. Swap the artwork inside this one component when the
 * official asset arrives — every usage across the platform updates at once.
 *
 * Size policy (widths, aspect ratio preserved, height auto):
 *  - sm  ≈ 100px  → mobile header
 *  - md  ≈ 124px  → tablet header
 *  - lg  ≈ 148px  → desktop header
 *  - xl  ≈ 220px  → intro / splash / sign-in screens
 *  - emblem → compact mark for very narrow spaces
 */

type LogoProps = {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'full' | 'emblem' | 'stacked'
  /** Use on dark backgrounds (intro, footer) */
  onDark?: boolean
  showTagline?: boolean
  className?: string
}

const WIDTHS: Record<string, string> = {
  sm: 'w-[100px]',
  md: 'w-[124px]',
  lg: 'w-[148px]',
  xl: 'w-[220px]',
}

export function Emblem({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn('h-auto', className)} role="img" aria-label="CARMAZE emblem">
      <circle cx="20" cy="20" r="19" fill="var(--primary, #315E4B)" />
      <circle cx="20" cy="20" r="19" fill="none" stroke="var(--gold, #D9B878)" strokeOpacity="0.55" strokeWidth="1.4" />
      {/* winding road */}
      <path
        d="M11 31 C 17 26, 15 20, 20 15 C 24 11, 26 10, 29 8"
        fill="none"
        stroke="var(--gold, #D9B878)"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      {/* road center dashes */}
      <path
        d="M11 31 C 17 26, 15 20, 20 15 C 24 11, 26 10, 29 8"
        fill="none"
        stroke="#F7F7F5"
        strokeOpacity="0.85"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeDasharray="2.6 3.4"
      />
    </svg>
  )
}

export function Logo({ size = 'md', variant = 'full', onDark = false, showTagline = false, className }: LogoProps) {
  const textColor = onDark ? 'text-[#F7F7F5]' : 'text-foreground'
  const subColor = onDark ? 'text-white/60' : 'text-muted-foreground'

  if (variant === 'emblem') {
    return <Emblem className={cn('h-8 w-8', className)} />
  }

  const wordmark = (
    <span className={cn('font-bold leading-none tracking-[0.08em]', textColor)} style={{ fontSize: '1.05em' }}>
      CAR<span className="text-[var(--gold)]">MAZE</span>
    </span>
  )

  if (variant === 'stacked') {
    return (
      <span className={cn('inline-flex flex-col items-center', className)} aria-label="CARMAZE">
        <Emblem className="h-[2.4em] w-[2.4em]" />
        <span className="mt-1.5 text-lg">{wordmark}</span>
        {showTagline && (
          <span className={cn('mt-1 text-[0.55em] font-medium tracking-[0.32em]', subColor)}>
            FIND. CONNECT. DRIVE.
          </span>
        )}
      </span>
    )
  }

  return (
    <span
      className={cn('inline-flex select-none items-center gap-1.5', WIDTHS[size], className)}
      aria-label="CARMAZE — Find. Connect. Drive."
    >
      <Emblem className="h-[1.6em] w-[1.6em] shrink-0" />
      <span className="inline-flex min-w-0 flex-col">
        <span className="text-lg leading-tight">{wordmark}</span>
        {showTagline && (
          <span className={cn('text-[7px] font-medium leading-tight tracking-[0.28em]', subColor)}>
            FIND. CONNECT. DRIVE.
          </span>
        )}
      </span>
    </span>
  )
}
