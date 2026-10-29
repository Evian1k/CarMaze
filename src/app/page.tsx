'use client'

/* CARMAZE — single-page application shell.
 * The platform renders on the / route; views are switched via hash routing
 * (#/cars, #/sell, #/dealer, …) so URLs remain shareable while satisfying the
 * single-visible-route deployment. All data comes from real API routes.
 */

import { useState, Suspense, useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useAuth, useAuthInit } from '@/stores/auth'
import { AppShell } from '@/components/layout/app-shell'
import { Intro } from '@/components/layout/intro'

const loading = () => (
  <div className="flex min-h-[50vh] items-center justify-center" aria-busy="true">
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  </div>
)

const ssr = false

const VIEWS: Record<string, React.ComponentType> = {
  '': dynamic(() => import('@/views/home'), { ssr, loading }),
  cars: dynamic(() => import('@/views/marketplace'), { ssr, loading }),
  'vehicle-detail': dynamic(() => import('@/views/vehicle-detail'), { ssr, loading }),
  sell: dynamic(() => import('@/views/sell'), { ssr, loading }),
  'my-listings': dynamic(() => import('@/views/seller-dashboard'), { ssr, loading }),
  showrooms: dynamic(() => import('@/views/showrooms'), { ssr, loading }),
  dealer: dynamic(() => import('@/views/dealer'), { ssr, loading }),
  customizer: dynamic(() => import('@/views/customizer'), { ssr, loading }),
  garages: dynamic(() => import('@/views/garages'), { ssr, loading }),
  'garage-dashboard': dynamic(() => import('@/views/garage-dashboard'), { ssr, loading }),
  roadside: dynamic(() => import('@/views/roadside'), { ssr, loading }),
  'my-garage': dynamic(() => import('@/views/my-garage'), { ssr, loading }),
  community: dynamic(() => import('@/views/community'), { ssr, loading }),
  account: dynamic(() => import('@/views/account'), { ssr, loading }),
  signin: dynamic(() => import('@/views/auth'), { ssr, loading }),
  admin: dynamic(() => import('@/views/admin'), { ssr, loading }),
  info: dynamic(() => import('@/views/static'), { ssr, loading }),
}

const NOT_FOUND = dynamic(() => import('@/views/not-found'), { ssr, loading })

const emptySubscribe = () => () => {}

export default function Page() {
  useAuthInit()
  const route = useHashRoute()
  // Mounted gate via useSyncExternalStore: false during SSR/hydration, true after.
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)
  // Intro policy: first visit per browser session, skipped for reduced-motion
  // users or when arriving at a deep link. Computed client-side only.
  const introSeen = useSyncExternalStore(
    emptySubscribe,
    () =>
      sessionStorage.getItem('carmaze_intro_seen') === '1' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      Boolean(window.location.hash),
    // server snapshot: intro handled post-hydration only
    () => true
  )
  const [introDismissed, setIntroDismissed] = useState(false)

  if (!mounted) {
    return <div className="min-h-screen bg-background" />
  }

  const View = VIEWS[route.view] ?? NOT_FOUND
  const key = route.view || 'home'

  return (
    <>
      {!introSeen && !introDismissed && <Intro onDone={() => setIntroDismissed(true)} />}
      <AppShell route={route}>
        <Suspense fallback={loading()}>
          {/* key on view identity → subtle cinematic rise on every navigation */}
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.38, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <View />
          </motion.div>
        </Suspense>
      </AppShell>
      {/* key={key} hints view identity for debugging tools */}
      <span className="hidden" data-view-key={key} />
    </>
  )
}
