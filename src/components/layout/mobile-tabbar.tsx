'use client'

/* Mobile bottom tab bar (app-like navigation for Kenya's mobile-first users)
 * plus a shared back-to-top button. The tab bar is fixed, respects the
 * iOS safe-area inset, and hides while the keyboard is unlikely (it stays
 * put: content padding compensates so the footer is never covered). */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Car, Home, KeyRound, User, Wrench, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { navigate, type RouteInfo } from '@/lib/client'
import { useAuth } from '@/stores/auth'

const TABS = [
  { icon: Home, label: 'Home', match: (v: string) => v === '', href: '/' },
  { icon: Car, label: 'Cars', match: (v: string) => ['cars', 'vehicle-detail', 'showrooms'].includes(v), href: '/cars' },
  { icon: KeyRound, label: 'Sell', match: (v: string) => ['sell', 'my-listings', 'dealer'].includes(v), href: '/sell' },
  { icon: Wrench, label: 'Garage', match: (v: string) => ['my-garage', 'garages', 'garage-dashboard', 'roadside', 'customizer'].includes(v), href: '/my-garage' },
  { icon: User, label: 'Account', match: (v: string) => ['account', 'signin'].includes(v), href: '/account' },
]

export function MobileTabBar({ route }: { route: RouteInfo }) {
  const { user } = useAuth()
  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {TABS.map((t) => {
          const active = t.match(route.view)
          const href = t.href === '/account' && !user ? '/signin' : t.href
          return (
            <li key={t.label}>
              <button
                onClick={() => navigate(href)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {active && (
                  <motion.span
                    layoutId="tabbar-pill"
                    className="absolute top-0 h-0.5 w-8 rounded-full bg-primary"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
                <t.icon className={cn('h-5 w-5 transition-transform', active && 'scale-110')} aria-hidden />
                {t.label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function BackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 640)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, y: 16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.9 }}
          whileHover={{ y: -3 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-20 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-lg backdrop-blur transition-colors hover:bg-muted lg:bottom-6 lg:right-6"
          aria-label="Back to top"
        >
          <ArrowUp className="h-5 w-5" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
