'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Volume2, VolumeX } from 'lucide-react'

/**
 * Cinematic intro — luxury-commercial sequence built as layered motion:
 *
 *   0.0s  darkness + rising gold embers (engine-warmth mood)
 *   0.5s  night-road reveal with slow cinematic dolly push
 *         (uses the AI-generated intro video when available, with a
 *          graceful image + CSS fallback so the site never breaks)
 *   1.4s  headlight sweeps + converging gold light trails
 *   2.6s  trails form the emblem (SVG road path draws in)
 *   3.5s  CARMAZE wordmark — letter-by-letter reveal
 *   4.5s  FIND. CONNECT. DRIVE. with expanding tracking
 *   7.6s  automatic hand-off to the homepage
 *
 * Skippable at any moment, session-scoped, synthesised engine rumble via
 * Web Audio (user-gesture gated, off by default), fully bypassed for
 * prefers-reduced-motion users (page.tsx handles that).
 */

const WORD = 'CARMAZE'
const EASE_OUT = [0.22, 0.61, 0.36, 1] as const

/** Synthesised low engine rumble — no audio asset required. */
function useEngineRumble() {
  const ctxRef = useRef<AudioContext | null>(null)
  const nodesRef = useRef<{ osc: OscillatorNode; sub: OscillatorNode; gain: GainNode } | null>(null)
  const [on, setOn] = useState(false)

  const stop = useCallback(() => {
    const { osc, sub, gain } = nodesRef.current ?? {}
    if (gain && ctxRef.current) {
      const t = ctxRef.current.currentTime
      gain.gain.cancelScheduledValues(t)
      gain.gain.setValueAtTime(gain.gain.value, t)
      gain.gain.linearRampToValueAtTime(0, t + 0.5)
      window.setTimeout(() => {
        try { osc?.stop(); sub?.stop() } catch { /* already stopped */ }
      }, 600)
    }
    nodesRef.current = null
    setOn(false)
  }, [])

  const start = useCallback(() => {
    if (nodesRef.current) return
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      const ctx = ctxRef.current ?? new Ctx()
      ctxRef.current = ctx
      void ctx.resume()

      const gain = ctx.createGain()
      gain.gain.value = 0
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 180
      filter.Q.value = 0.8

      // Layered detuned saws ≈ idling V8; sub sine adds the chest feel
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = 52
      const sub = ctx.createOscillator()
      sub.type = 'sine'
      sub.frequency.value = 27

      // slow wobble on the main osc for a mechanical, non-static tone
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 8.5
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = 3.5
      lfo.connect(lfoGain)
      lfoGain.connect(osc.frequency)
      lfo.start()

      osc.connect(filter)
      sub.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      sub.start()

      const t = ctx.currentTime
      gain.gain.linearRampToValueAtTime(0.055, t + 1.2) // subtle
      nodesRef.current = { osc, sub, gain }
      setOn(true)
    } catch {
      /* audio unavailable — silent intro is fine */
    }
  }, [])

  useEffect(() => () => {
    try {
      nodesRef.current?.osc.stop()
      nodesRef.current?.sub.stop()
      void ctxRef.current?.close()
    } catch { /* noop */ }
  }, [])

  return { on, start, stop }
}

export function Intro({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const [stage, setStage] = useState(0) // drives converging trails → emblem handoff
  const [videoOk, setVideoOk] = useState(false)
  const [imgOk, setImgOk] = useState(true)
  const rumble = useEngineRumble()
  const finished = useRef(false)

  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    rumble.stop()
    sessionStorage.setItem('carmaze_intro_seen', '1')
    setLeaving(true)
    window.setTimeout(onDone, 620)
  }, [onDone, rumble])

  // Ref-stable finish so the auto-advance timers are scheduled exactly once,
  // regardless of re-renders (stage changes, sound toggle, …).
  const finishRef = useRef(finish)
  useEffect(() => {
    finishRef.current = finish
  }, [finish])

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setStage(1), 1500),   // trails converge
      window.setTimeout(() => setStage(2), 2600),   // emblem draws
      window.setTimeout(() => finishRef.current(), 7600),
    ]
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [])

  // Probe the cinematic video asset; fall back to the still + CSS layers.
  useEffect(() => {
    const v = document.createElement('video')
    v.oncanplaythrough = () => setVideoOk(true)
    v.onerror = () => setVideoOk(false)
    v.src = '/video/intro.mp4'
    v.load()
    const img = new Image()
    img.onerror = () => setImgOk(false)
    img.src = '/images/intro-road.png'
  }, [])

  return (
    <motion.div
      className="fixed inset-0 z-[100] overflow-hidden bg-[#0B0C0A]"
      initial={{ opacity: 1 }}
      animate={leaving ? { opacity: 0, scale: 1.04 } : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: EASE_OUT }}
      role="dialog"
      aria-label="CARMAZE introduction"
    >
      {/* ── Layer 1: cinematic backdrop (video → image → gradient) ── */}
      {videoOk ? (
        <video
          className="absolute inset-0 h-full w-full object-cover opacity-80"
          src="/video/intro.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
        />
      ) : (
        <div className="absolute inset-0" aria-hidden>
          <div
            className={`cmz-zoom-road absolute inset-0 bg-cover bg-center ${stage > 0 ? 'cmz-dolly' : ''}`}
            style={imgOk
              ? { backgroundImage: 'url(/images/intro-road.png)' }
              : { background: 'radial-gradient(ellipse at 50% 72%, #1d241f 0%, #0b0c0a 72%)' }}
          />
          {/* wet-road reflection sheen */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="cmz-headlight absolute -top-1/4 left-0 h-[150%] w-40 bg-gradient-to-r from-transparent via-[#D9B878]/12 to-transparent blur-md" />
          </div>
        </div>
      )}

      {/* darkness vignette */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/30 to-black/90" />

      {/* ── Layer 2: rising gold embers (engine warmth) ── */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden>
        {Array.from({ length: 14 }).map((_, i) => (
          <span
            key={i}
            className="cmz-ember absolute h-1 w-1 rounded-full bg-[#D9B878]/70 blur-[1px]"
            style={{
              left: `${(i * 37 + 8) % 100}%`,
              bottom: '-2vh',
              animationDelay: `${(i * 0.65) % 5}s`,
              animationDuration: `${4.4 + (i % 4) * 0.7}s`,
            }}
          />
        ))}
      </div>

      {/* ── Layer 3: converging light trails → emblem ── */}
      <div className="absolute inset-0" aria-hidden>
        <div className="absolute inset-x-0 top-[41%] flex items-center justify-center">
          {stage >= 1 && (
            <>
              <span className="cmz-converge-l absolute right-1/2 h-[3px] w-[44vw] rounded-full bg-gradient-to-l from-[#D9B878] via-[#D9B878]/70 to-transparent shadow-[0_0_18px_rgba(217,184,120,0.8)]" />
              <span className="cmz-converge-r absolute left-1/2 h-[3px] w-[44vw] rounded-full bg-gradient-to-r from-[#D9B878] via-[#D9B878]/70 to-transparent shadow-[0_0_18px_rgba(217,184,120,0.8)]" />
              <span className="cmz-converge-l absolute right-1/2 top-2 h-[2px] w-[30vw] rounded-full bg-gradient-to-l from-[#F7F7F5]/90 to-transparent" style={{ animationDelay: '0.12s' }} />
              <span className="cmz-converge-r absolute left-1/2 top-2 h-[2px] w-[30vw] rounded-full bg-gradient-to-r from-[#F7F7F5]/90 to-transparent" style={{ animationDelay: '0.12s' }} />
            </>
          )}
          {/* flash at convergence moment */}
          {stage >= 1 && (
            <motion.span
              className="absolute h-24 w-24 rounded-full bg-[#D9B878]/25 blur-2xl"
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: [0, 1, 0], scale: [0.4, 1.6, 2.4] }}
              transition={{ delay: 0.95, duration: 1.1, ease: 'easeOut' }}
            />
          )}
        </div>

        {/* ── Layer 4: emblem — road path draws itself in ── */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.72 }}
            animate={stage >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.72 }}
            transition={{ delay: stage >= 2 ? 0.35 : 0, duration: 0.7, ease: EASE_OUT }}
            className="relative"
          >
            <span className="cmz-glow-pulse absolute inset-0" aria-hidden>
              <EmblemGlyph />
            </span>
            <EmblemGlyph animated={stage >= 2} />
          </motion.div>

          {/* wordmark — letters cascade in */}
          <div className="mt-5 flex overflow-hidden" aria-label="CARMAZE">
            {WORD.split('').map((ch, i) => (
              <motion.span
                key={i}
                aria-hidden
                className={`text-3xl font-bold tracking-[0.12em] sm:text-5xl ${i >= 3 ? 'text-[#D9B878]' : 'text-[#F7F7F5]'}`}
                initial={{ y: '110%', opacity: 0 }}
                animate={stage >= 2 ? { y: 0, opacity: 1 } : { y: '110%', opacity: 0 }}
                transition={{ delay: stage >= 2 ? 0.55 + i * 0.055 : 0, duration: 0.55, ease: EASE_OUT }}
              >
                {ch}
              </motion.span>
            ))}
          </div>

          {/* tagline with expanding tracking */}
          <motion.p
            className="mt-3 text-[11px] font-medium tracking-[0.42em] text-white/65 sm:text-sm"
            initial={{ opacity: 0, letterSpacing: '0.18em' }}
            animate={stage >= 2 ? { opacity: 1, letterSpacing: '0.42em' } : { opacity: 0 }}
            transition={{ delay: stage >= 2 ? 1.35 : 0, duration: 0.9, ease: EASE_OUT }}
          >
            FIND. CONNECT. DRIVE.
          </motion.p>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="absolute inset-x-0 bottom-6 z-10 flex items-end justify-between px-4 sm:px-6">
        <button
          onClick={() => (rumble.on ? rumble.stop() : rumble.start())}
          className="flex h-11 items-center gap-2 rounded-full border border-white/20 bg-black/45 px-4 text-xs font-medium text-white/80 backdrop-blur-sm transition-colors hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={rumble.on ? 'Mute engine sound' : 'Enable engine sound'}
          aria-pressed={rumble.on}
        >
          {rumble.on ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          {rumble.on ? 'Sound on' : 'Sound'}
          {rumble.on && (
            <span className="cmz-eq flex h-3 items-end gap-[2px]" aria-hidden>
              <span className="h-full w-[2px] origin-bottom bg-[#D9B878]" />
              <span className="h-full w-[2px] origin-bottom bg-[#D9B878]" />
              <span className="h-full w-[2px] origin-bottom bg-[#D9B878]" />
              <span className="h-full w-[2px] origin-bottom bg-[#D9B878]" />
            </span>
          )}
        </button>

        <Button
          onClick={finish}
          variant="outline"
          className="h-11 border-white/25 bg-black/40 text-white hover:bg-black/60 hover:text-white"
          aria-label="Skip introduction"
        >
          Skip Intro
        </Button>
      </div>

      {/* progress hairline */}
      <div className="absolute inset-x-0 bottom-0 h-[2px] bg-white/10" aria-hidden>
        <div className="cmz-progress h-full bg-gradient-to-r from-[#D9B878]/60 via-[#D9B878] to-[#D9B878]/60" />
      </div>
    </motion.div>
  )
}

/** CARMAZE road emblem as inline SVG so the road stroke can draw itself. */
function EmblemGlyph({ animated = false }: { animated?: boolean }) {
  return (
    <svg viewBox="0 0 40 40" className="h-16 w-16 sm:h-20 sm:w-20" role="img" aria-label="CARMAZE emblem">
      <circle cx="20" cy="20" r="19" fill="#12241B" />
      <circle cx="20" cy="20" r="19" fill="none" stroke="#D9B878" strokeOpacity="0.55" strokeWidth="1.4" />
      <motion.path
        d="M11 31 C 17 26, 15 20, 20 15 C 24 11, 26 10, 29 8"
        fill="none"
        stroke="#D9B878"
        strokeWidth="3.4"
        strokeLinecap="round"
        initial={animated ? { pathLength: 0 } : { pathLength: 1 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: animated ? 0.45 : 0, duration: 1.1, ease: 'easeInOut' }}
      />
      <motion.path
        d="M11 31 C 17 26, 15 20, 20 15 C 24 11, 26 10, 29 8"
        fill="none"
        stroke="#F7F7F5"
        strokeOpacity="0.85"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeDasharray="2.6 3.4"
        initial={animated ? { opacity: 0 } : { opacity: 1 }}
        animate={{ opacity: 1 }}
        transition={{ delay: animated ? 1.15 : 0, duration: 0.5 }}
      />
    </svg>
  )
}
