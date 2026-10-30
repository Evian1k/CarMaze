'use client'

/* Reusable motion primitives shared across views.
 * All respect prefers-reduced-motion via framer-motion's useReducedMotion. */

import { useEffect, useRef, useState } from 'react'
import { motion, useInView, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { cn } from '@/lib/utils'

const EASE = [0.22, 0.61, 0.36, 1] as const

/** Fade-and-rise reveal with a soft focus pull (de-blur) when the element
 * scrolls into view — the premium "rack focus" feel. */
export function Reveal({
  children,
  delay = 0,
  y = 22,
  className,
  once = true,
  blur = true,
}: {
  children: React.ReactNode
  delay?: number
  y?: number
  className?: string
  once?: boolean
  blur?: boolean
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, ...(blur ? { filter: 'blur(7px)' } : {}) }}
      whileInView={{ opacity: 1, y: 0, ...(blur ? { filter: 'blur(0px)' } : {}) }}
      viewport={{ once, margin: '-60px' }}
      transition={{ duration: 0.65, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

/** Staggered children container — direct children rise in sequence. */
export function Stagger({
  children,
  className,
  gap = 0.07,
  id,
}: {
  children: React.ReactNode
  className?: string
  gap?: number
  id?: string
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className} id={id}>{children}</div>
  return (
    <motion.div
      className={className}
      id={id}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-60px' }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }}
    >
      {children}
    </motion.div>
  )
}

export const staggerItem = {
  hidden: { opacity: 0, y: 24, scale: 0.965, filter: 'blur(5px)' },
  show: {
    opacity: 1, y: 0, scale: 1, filter: 'blur(0px)',
    transition: { duration: 0.6, ease: EASE },
  },
}

export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  return (
    <motion.div className={className} variants={staggerItem}>
      {children}
    </motion.div>
  )
}

/** Animated number counter that runs once when scrolled into view. */
export function CountUp({
  value,
  suffix = '',
  duration = 1.6,
  className,
}: {
  value: number
  suffix?: string
  duration?: number
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const reduce = useReducedMotion()
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (!inView) return
    // Runs inside rAF callbacks (not synchronously in the effect body);
    // reduced-motion users jump straight to the final value on the first frame.
    let raf = 0
    const t0 = performance.now()
    const dur = reduce ? 1 : duration * 1000
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(value * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, value, duration, reduce])

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {display.toLocaleString()}
      {suffix}
    </span>
  )
}

/** Subtle lift + shadow on hover — the standard card micro-interaction. */
export function HoverLift({
  children,
  className,
  lift = 4,
  scale = 1,
}: {
  children: React.ReactNode
  className?: string
  lift?: number
  scale?: number
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      whileHover={{ y: -lift, scale }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
    >
      {children}
    </motion.div>
  )
}

/** Gentle scroll parallax — pass children that should drift as the page scrolls. */
export function Parallax({
  children,
  className,
  distance = 40,
}: {
  children: React.ReactNode
  className?: string
  distance?: number
}) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance])
  if (reduce) return <div className={className}>{children}</div>
  return (
    <div ref={ref} className={className}>
      <motion.div style={{ y }}>{children}</motion.div>
    </div>
  )
}

/** Headline whose words rise in sequence — for hero titles. */
export function WordRise({
  text,
  className,
  delay = 0,
  gap = 0.055,
}: {
  text: string
  className?: string
  delay?: number
  gap?: number
}) {
  const reduce = useReducedMotion()
  const words = text.split(' ')
  if (reduce) return <span className={className}>{text}</span>
  return (
    <span className={cn('inline-block', className)} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.08em] -mb-[0.08em] align-bottom">
          <motion.span
            className="inline-block will-change-transform"
            initial={{ y: '110%' }}
            animate={{ y: 0 }}
            transition={{ duration: 0.7, delay: delay + i * gap, ease: EASE }}
          >
            {w}
            {i < words.length - 1 ? '\u00A0' : ''}
          </motion.span>
        </span>
      ))}
    </span>
  )
}

/** Springy press feedback wrapper for any clickable element. */
export function Pressable({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  return (
    <motion.div className={className} whileTap={{ scale: 0.96 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>
      {children}
    </motion.div>
  )
}

/** Scroll-triggered cascade for hero-adjacent rows: children slide in from
 * alternating sides — for trust strips and module grids. */
export function SlideIn({
  children,
  className,
  from = 'left',
  delay = 0,
}: {
  children: React.ReactNode
  className?: string
  from?: 'left' | 'right'
  delay?: number
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  const x = from === 'left' ? -36 : 36
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, x, filter: 'blur(6px)' }}
      whileInView={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}
