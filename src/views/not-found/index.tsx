'use client'

import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { navigate } from '@/lib/client'
import { Compass } from 'lucide-react'

const EASE = [0.22, 0.61, 0.36, 1] as const

export default function NotFoundView() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      {/* Compass drifts in with a swing, needle keeps gently wandering */}
      <motion.div
        initial={{ opacity: 0, scale: 0.6, rotate: -18 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ duration: 0.7, ease: EASE }}
      >
        <motion.span
          className="block"
          animate={{ rotate: [0, -8, 6, -3, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, repeatDelay: 1.4, ease: 'easeInOut' }}
        >
          <Compass className="h-12 w-12 text-primary" aria-hidden />
        </motion.span>
      </motion.div>
      <motion.h1
        className="text-2xl font-bold"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.55, ease: EASE }}
      >
        Page not found
      </motion.h1>
      <motion.p
        className="max-w-md text-sm text-muted-foreground"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22, duration: 0.55, ease: EASE }}
      >
        The page you were looking for doesn&apos;t exist or has moved. It may have been a link to a vehicle that is no longer listed.
      </motion.p>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.32, duration: 0.55, ease: EASE }}
      >
        <Button onClick={() => navigate('/')} className="cmz-sheen">Back to homepage</Button>
      </motion.div>
    </div>
  )
}
