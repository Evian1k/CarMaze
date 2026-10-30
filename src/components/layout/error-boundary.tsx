'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RotateCcw } from 'lucide-react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * Top-level render error boundary. Guarantees the user never sees a white
 * void: render-time crashes resolve to a branded recovery panel with a
 * one-click reload. (Event-handler/async errors are handled at call sites.)
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface in devtools for debugging; never rethrow.
    console.error('[CARMAZE] render error captured by boundary:', error, info.componentStack)
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
