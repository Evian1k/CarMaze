'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Logo, Emblem } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'

/**
 * Cinematic intro — luxury-commercial feel built with layered CSS/Framer
 * motion over a cinematic night-road frame (no video asset required, so the
 * site stays functional if assets fail). Skippable, session-scoped, and
 * entirely bypassed for prefers-reduced-motion users (page.tsx handles that).
 */
export function Intro({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const [bgOk, setBgOk] = useState(true)

  useEffect(() => {
    const img = new Image()
    img.onerror = () => setBgOk(false)
    img.src = '/images/intro-road.png'
  }, [])

  function finish() {
    sessionStorage.setItem('carmaze_intro_seen', '1')
    setLeaving(true)
    window.setTimeout(onDone, 550)
  }

  useEffect(() => {
    const t = window.setTimeout(finish, 7600)
    return () => window.clearTimeout(t)
     
  }, [])

  return (
    <AnimatePresence>
      {!leaving && (
        <motion.div
          className="fixed inset-0 z-[100] overflow-hidden bg-[#0B0C0A]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          role="dialog"
          aria-label="CARMAZE introduction"
        >
          {/* Night road backdrop */}
          <div
            className="cmz-zoom-road absolute inset-0 bg-cover bg-center"
            style={bgOk ? { backgroundImage: 'url(/images/intro-road.png)' } : { background: 'radial-gradient(ellipse at 50% 70%, #1d241f 0%, #0b0c0a 70%)' }}
          />
          {/* Darkness vignette */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/35 to-black/85" />

          {/* Gold light streaks transforming into the emblem */}
          <div className="absolute inset-x-0 top-[38%] h-24" aria-hidden>
            {[0, 0.9, 1.8].map((delay, i) => (
              <span
                key={i}
                className="cmz-streak absolute h-[2px] w-[42%] rounded-full bg-gradient-to-r from-transparent via-[#D9B878] to-transparent"
                style={{ top: `${i * 34}%`, left: i % 2 ? '30%' : '12%', animationDelay: `${delay}s` }}
              />
            ))}
          </div>

          {/* Emblem + wordmark reveal */}
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.82 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.4, duration: 0.9, ease: [0.2, 0.7, 0.3, 1] }}
            >
              <Emblem className="h-16 w-16 sm:h-20 sm:w-20" />
            </motion.div>
            <motion.div
              className="cmz-fade-up mt-5"
              style={{ animationDelay: '2.2s' }}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 2.2, duration: 0.8 }}
            >
              <span className="text-3xl font-bold tracking-[0.14em] text-[#F7F7F5] sm:text-5xl">
                CAR<span className="text-[#D9B878]">MAZE</span>
              </span>
            </motion.div>
            <motion.p
              className="cmz-fade-up mt-3 text-[11px] font-medium tracking-[0.42em] text-white/60 sm:text-sm"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 3.1, duration: 0.8 }}
            >
              FIND. CONNECT. DRIVE.
            </motion.p>
          </div>

          {/* Skip control — always visible, 44px touch target */}
          <Button
            onClick={finish}
            variant="outline"
            className="absolute bottom-6 right-6 z-10 border-white/25 bg-black/40 text-white hover:bg-black/60 hover:text-white"
            aria-label="Skip introduction"
          >
            Skip Intro
          </Button>
          <span className="absolute bottom-6 left-6 text-[10px] tracking-widest text-white/35">
            <Logo variant="emblem" className="hidden" />
            PREMIUM AUTOMOTIVE ECOSYSTEM
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
