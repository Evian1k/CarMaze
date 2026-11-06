'use client'

/* Route-level error UI (Next.js App Router). Catches anything that escapes
 * the in-tree boundary so the user always lands on a branded recovery screen
 * instead of the raw "Application error" page. Stale-chunk crashes (dev
 * recompiles / deploys swapping assets under an open tab) auto-reload once. */

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { sessionGet, sessionSet } from '@/lib/safe-storage'

const CHUNK_ERROR = /ChunkLoadError|Loading chunk [\d]+ failed|dynamically imported module/i

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[CARMAZE] route error:', error)
    if (CHUNK_ERROR.test(`${error.name} ${error.message}`)) {
      try {
        if (sessionGet('carmaze_chunk_recovered') !== '1') {
          sessionSet('carmaze_chunk_recovered', '1')
          window.location.reload()
          return
        }
      } catch {
        /* storage blocked: fall through to the recovery UI */
      }
    }
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6" role="alert">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold">Something hit a bump</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This section ran into an unexpected error. Try again: reloading
          usually gets you back on the road.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="outline" onClick={reset} className="gap-2">
            <RotateCcw className="h-4 w-4" aria-hidden /> Try again
          </Button>
          <Button onClick={() => window.location.reload()} className="gap-2">
            Reload CARMAZE
          </Button>
        </div>
      </div>
    </div>
  )
}
