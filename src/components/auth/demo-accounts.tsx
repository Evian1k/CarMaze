'use client'

/* Explore CARMAZE Demo Accounts — server-driven catalog of demo experiences.
 * The frontend NEVER holds demo credentials: clicking "Explore Demo" posts a
 * roleKey to /api/auth/demo, and the server maps it to the demo account and
 * creates a secure, short-lived, sandboxed session. */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Building2, Car, ChevronDown, CircleUser, HardHat, Headset, Loader2, Play, ShieldCheck, Wrench, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiGet, apiSend, ClientApiError } from '@/lib/client'
import { useAuth } from '@/stores/auth'
import { navigate } from '@/lib/client'

export type DemoCatalogRole = {
  roleKey: string
  label: string
  description: string
  icon: string
  dashboard: string
  restrictedNote: string | null
}

const ICONS: Record<string, LucideIcon> = {
  user: CircleUser,
  car: Car,
  building: Building2,
  'id-card': Building2,
  wrench: Wrench,
  'hard-hat': HardHat,
  headset: Headset,
  shield: ShieldCheck,
}

export function DemoAccountsSection({ collapsedByDefault = false }: { collapsedByDefault?: boolean }) {
  const refresh = useAuth((s) => s.refresh)
  const [open, setOpen] = useState(!collapsedByDefault)
  const [roles, setRoles] = useState<DemoCatalogRole[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || roles) return
    let cancelled = false
    apiGet<{ roles: DemoCatalogRole[] }>('/api/auth/demo')
      .then((d) => { if (!cancelled) setRoles(d.roles) })
      .catch(() => { if (!cancelled) setRoles([]) })
    return () => { cancelled = true }
  }, [open, roles])

  async function explore(role: DemoCatalogRole) {
    setError(null)
    setBusy(role.roleKey)
    try {
      const d = await apiSend<{ dashboard: string }>('/api/auth/demo', 'POST', { role: role.roleKey })
      await refresh()
      navigate(d.dashboard || 'account')
      window.scrollTo({ top: 0 })
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Could not start the demo. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="demo-accounts-heading" className="mt-6">
      <div className="relative my-6" role="separator" aria-orientation="horizontal">
        <div className="border-t border-border" />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          or explore
        </span>
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="demo-accounts-panel"
        className="group w-full rounded-xl border border-border/70 bg-card/60 px-4 py-3.5 text-left transition-colors hover:border-accent/60 hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span id="demo-accounts-heading" className="flex items-center gap-2 text-sm font-semibold">
              <Play className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              Explore CARMAZE Demo Accounts
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              Experience CARMAZE from different perspectives. Choose a demo account to explore its features.
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${open ? 'rotate-180' : ''}`} aria-hidden />
        </span>
      </button>

      <div id="demo-accounts-panel" hidden={!open}>
        {open && (
          <>
            {error && (
              <p role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            {roles === null ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground" aria-live="polite">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading demo roles…
              </div>
            ) : roles.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Demo accounts are currently unavailable.</p>
            ) : (
              <ul className="mt-3 grid max-h-[22rem] grid-cols-1 gap-2 overflow-y-auto scrollbar-thin sm:grid-cols-2 sm:max-h-none">
                {roles.map((role, i) => {
                  const Icon = ICONS[role.icon] ?? CircleUser
                  const isBusy = busy === role.roleKey
                  return (
                    <motion.li
                      key={role.roleKey}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.3, ease: 'easeOut' }}
                    >
                      <div className="flex h-full flex-col rounded-xl border border-border/70 bg-card p-3 transition-colors hover:border-accent/60 focus-within:border-accent/60">
                        <div className="flex items-start gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold leading-tight">
                              {role.label}
                              {role.restrictedNote && (
                                <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                                  restricted
                                </span>
                              )}
                            </p>
                            <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{role.description}</p>
                          </div>
                        </div>
                        {role.restrictedNote && (
                          <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                            {role.restrictedNote}
                          </p>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2.5 w-full"
                          disabled={busy !== null}
                          onClick={() => explore(role)}
                        >
                          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                          {isBusy ? 'Starting…' : 'Explore Demo'}
                        </Button>
                      </div>
                    </motion.li>
                  )
                })}
              </ul>
            )}
            <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
              Demo sessions run on isolated demo data with a DEMO MODE banner. Actions that would reach real users or trigger real payments are blocked.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
