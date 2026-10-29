'use client'

import type { ReactNode } from 'react'
import { Info, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/card'

/** Small muted disclaimer line with an info icon. */
export function AiDisclaimer({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

/**
 * Shared brand-styled AI panel header: champagne-gold Sparkles accent on a card.
 * Keeps the three AI assistants visually consistent.
 */
export function AiPanel({ title, subtitle, children, ariaLabel }: { title: string; subtitle?: string; children: ReactNode; ariaLabel?: string }) {
  return (
    <Card
      aria-label={ariaLabel}
      className="gap-0 border-border/80 bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15" aria-hidden="true">
          <Sparkles className="h-4.5 w-4.5 text-accent" />
        </span>
        <div>
          <h3 className="text-[15px] font-semibold leading-tight text-foreground">{title}</h3>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children}
    </Card>
  )
}
