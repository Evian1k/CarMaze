'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { localGet, localSet } from '@/lib/safe-storage'

type Props = { children: ReactNode }
type State = { error: Error | null }

/** Detects "stale chunk" failures: the tab held old build references while
 * the dev server (or a deploy) swapped assets underneath it. The fix is one
 * hard reload; the session guard prevents a reload loop. */
let lastBoundaryError: unknown = null

function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return (
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk [\d]+ failed/i.test(msg) ||
    /dynamically imported module/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  )
}

/** One-shot auto-recovery for stale-chunk crashes. Returns true when a reload
 * has been triggered so the boundary can skip rendering the fallback. */
function recoverChunkError(): boolean {
  if (!isChunkLoadError(lastBoundaryError)) return false
  try {
    if (localGet('carmaze_chunk_recovered') === '1') return false
    localSet('carmaze_chunk_recovered', '1')
  } catch {
    /* storage blocked: still attempt the single reload */
  }
  window.location.reload()
  return true
}

/**
 * Top-level render error boundary. Guarantees the user never sees a white
 * void or a raw "Application error" screen:
 *  - stale-chunk failures (dev recompiles / deploys) auto-reload once
 *  - any other render crash resolves to a branded recovery panel
 * (Event-handler/async errors are handled at call sites.)
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface in devtools for debugging; never rethrow.
    console.error('[CARMAZE] render error captured by boundary:', error, info.componentStack)
    lastBoundaryError = error
    recoverChunkError()
  }

  private reload = () => {
    window.location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6" role="alert">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          </div>
          <h1 className="mt-4 text-lg font-semibold">Something hit a bump</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            The page ran into an unexpected error. Reloading usually gets you
            back on the road.
          </p>
          {process.env.NODE_ENV === 'development' && (
            <pre className="mt-4 max-h-32 overflow-auto rounded-md bg-muted p-3 text-left text-[11px] leading-relaxed text-muted-foreground">
              {error.message}
            </pre>
          )}
          <Button onClick={this.reload} className="mt-5 gap-2">
            <RotateCcw className="h-4 w-4" aria-hidden /> Reload CARMAZE
          </Button>
        </div>
      </div>
    )
  }
}
