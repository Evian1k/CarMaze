'use client'

/* Light/dark theme toggle: a small sun/moon icon button with a smooth
 * cross-fade rotation. Hydration-safe: renders a stable placeholder until
 * mounted, so SSR markup and the first client render always match.
 *
 * Uses useSyncExternalStore (same pattern as the app boot gate) instead of
 * the classic useEffect+useState mounted flag: no extra render pass.
 */

import { useSyncExternalStore, useCallback } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const emptySubscribe = () => () => {}

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()

  // false during SSR/hydration, true after mount: avoids hydration mismatch
  // while `resolvedTheme` is still undefined on the server.
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

  const isDark = mounted && resolvedTheme === 'dark'
  const toggle = useCallback(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'), [resolvedTheme, setTheme])

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn('relative', className)}
    >
      {/* Both icons stacked; cross-fade + rotate driven purely by the .dark
          class: zero flicker, no JS-driven animation state. */}
      <Sun
        className={cn(
          'absolute h-5 w-5 transition-all duration-300',
          isDark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'
        )}
        aria-hidden
      />
      <Moon
        className={cn(
          'absolute h-5 w-5 transition-all duration-300',
          isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'
        )}
        aria-hidden
      />
      {/* Keeps the button sized before mount (icons are absolutely positioned) */}
      <span className="h-5 w-5" aria-hidden />
    </Button>
  )
}
