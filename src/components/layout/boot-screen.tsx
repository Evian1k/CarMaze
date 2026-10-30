import { Logo } from '@/components/brand/logo'

/**
 * Branded pre-hydration screen. Replaces the old empty `<div>` gate: the
 * first server-rendered paint is a warm, on-brand loading state instead of
 * a white void — so slow networks, disabled JS or blocked storage never
 * present a blank page.
 *
 * Deterministic markup (no randomness/dates) so SSR and the hydration
 * render match exactly.
 */
export function BootScreen() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6"
      role="status"
      aria-label="CARMAZE is loading"
    >
      <div className="relative">
        {/* soft brand halo */}
        <div
          className="absolute -inset-6 rounded-full bg-primary/10 blur-2xl"
          aria-hidden
        />
        <div className="relative animate-pulse">
          <Logo size="lg" />
        </div>
      </div>
      <div
        className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent"
        aria-hidden
      />
      <p className="text-sm font-medium tracking-wide text-muted-foreground">
        Warming up the engine…
      </p>
      <noscript>
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          CARMAZE needs JavaScript to run. Please enable it and reload.
        </p>
      </noscript>
    </div>
  )
}
