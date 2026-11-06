'use client'

/* DEMO MODE indicator: shown for the whole session whenever the signed-in
 * user is inside a demo experience. Explains isolation and offers Exit Demo. */

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FlaskConical, LogOut, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/stores/auth'

const ROLE_LABELS: Record<string, string> = {
  'customer': 'Customer',
  'private-seller': 'Private Seller',
  'showroom-owner': 'Showroom Owner',
  'showroom-staff': 'Showroom Staff',
  'garage-owner': 'Garage Owner',
  'garage-staff': 'Garage Staff',
  'platform-support': 'Platform Support',
  'platform-admin': 'Platform Admin (restricted)',
}

function expiresLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(ms) || ms <= 0) return 'expired'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins} min left`
  const h = Math.floor(mins / 60)
  if (h < 48) {
    const m = mins % 60
    return m === 0 ? `${h} h left` : `${h} h ${m} min left`
  }
  const d = Math.floor(h / 24)
  const remH = h % 24
  return remH === 0 ? `${d} d left` : `${d} d ${remH} h left`
}

export function DemoBanner() {
  const { demo, logout } = useAuth()
  const [dismissed, setDismissed] = useState(false)

  return (
    <AnimatePresence>
      {demo?.active && !dismissed && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="overflow-hidden border-b border-amber-500/40 bg-amber-50 text-amber-950 dark:border-amber-400/30 dark:bg-amber-950/50 dark:text-amber-100"
          role="status"
          aria-label="Demo mode active"
        >
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-xs sm:px-6 sm:text-sm">
            <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wide">
              <FlaskConical className="h-4 w-4" aria-hidden />
              Demo Mode
            </span>
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-medium">
              {ROLE_LABELS[demo.roleKey] ?? demo.roleKey}
            </span>
            <span className="hidden text-amber-800/90 dark:text-amber-200/80 md:inline">
              You are exploring a sandboxed demo: this data is separate from real customer data. Actions that would affect real users or trigger real payments are blocked.
            </span>
            <span className="ml-auto flex items-center gap-2.5">
              <span className="hidden items-center gap-1 text-amber-700/80 dark:text-amber-300/70 sm:flex">
                <Timer className="h-3.5 w-3.5" aria-hidden />
                {expiresLabel(demo.expiresAt)}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-amber-600/40 px-2.5 text-xs text-amber-900 hover:bg-amber-500/15 dark:border-amber-300/30 dark:text-amber-100 dark:hover:bg-amber-400/10"
                onClick={() => setDismissed(true)}
              >
                Hide
              </Button>
              <Button
                size="sm"
                className="h-7 bg-amber-600 px-2.5 text-xs text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
                onClick={() => logout()}
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden />
                Exit Demo
              </Button>
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
