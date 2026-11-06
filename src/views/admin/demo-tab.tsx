'use client'

/* Admin → Demo tab: manage the demo-experience system.
 * ADMIN/FOUNDER only (server-enforced). Demo admins see a read-only view and
 * can never manage the demo system itself. */

import { useCallback, useEffect, useState } from 'react'
import { FlaskConical, Loader2, Power, RefreshCcw, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { apiGet, apiSend, ClientApiError } from '@/lib/client'
import { useAuth } from '@/stores/auth'
import { dateLabel } from '@/lib/format'

type DemoAccountRow = {
  id: string
  roleKey: string
  email: string
  label: string
  description: string
  dashboard: string
  enabled: boolean
  sessionMinutes: number
  restrictedNote: string | null
  lastResetAt: string | null
  resetCount: number
  createdAt: string
}

type DemoLoginRow = { id: string; createdAt: string; roleKey: string | null }

type DemoAccountsResponse = {
  accounts: (Pick<DemoAccountRow, 'roleKey' | 'label' | 'description' | 'enabled' | 'sessionMinutes' | 'dashboard' | 'restrictedNote'> & Partial<DemoAccountRow>)[]
  sessions: DemoLoginRow[]
  canManage: boolean
}

const SESSION_OPTIONS = [60, 120, 240, 480]

export function DemoTab() {
  const { user } = useAuth()
  const [data, setData] = useState<DemoAccountsResponse | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await apiGet<DemoAccountsResponse>('/api/admin/demo-accounts')
      setData(d)
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Failed to load demo accounts')
      setData({ accounts: [], sessions: [], canManage: false })
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function patchRole(roleKey: string, patch: { enabled?: boolean; sessionMinutes?: number }) {
    setBusy(roleKey)
    try {
      await apiSend('/api/admin/demo-accounts', 'PATCH', { roleKey, ...patch })
      toast.success(`Demo role "${roleKey}" updated.`)
      await load()
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  async function resetDemoData() {
    setResetting(true)
    try {
      const d = await apiSend<{ message: string }>('/api/admin/demo-accounts/reset', 'POST', { confirm: 'RESET_DEMO_DATA' })
      toast.success(d.message)
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Reset failed')
    } finally {
      setResetting(false)
    }
  }

  const canManage = Boolean(data?.canManage) && !user?.isDemo

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <FlaskConical className="h-4 w-4 text-primary" aria-hidden />
              Demo experience management
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Demo accounts open the correct role dashboard with backend-enforced, sandboxed permissions: they can never reach real users,
              trigger real M-Pesa payments or mutate records outside the demo ecosystem. Sessions are short-lived and carry a DEMO MODE banner.
            </p>
          </div>
          {canManage && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" disabled={resetting} className="shrink-0">
                  {resetting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCcw className="h-4 w-4" aria-hidden />}
                  Reset demo data
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reset demo data?</DialogTitle>
                  <DialogDescription>
                    This re-runs the platform seed and restores the full demo baseline on this deployment. Every signed-in session ends
                    (accounts are recreated) and you will need to sign in again. Real user data does not exist on this deployment —
                    the entire database is demo data.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setResetting(false)} disabled={resetting}>Cancel</Button>
                  <Button variant="destructive" onClick={resetDemoData} disabled={resetting}>
                    {resetting ? 'Resetting…' : 'Yes, reset demo data'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {data === null ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !canManage ? (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
            You are signed in as a demo administrator — the demo system is visible read-only and cannot be changed from a demo session.
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {data.accounts.map((a) => (
              <li key={a.roleKey} className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {a.label}
                    <Badge variant={a.enabled ? 'secondary' : 'outline'} className={a.enabled ? '' : 'text-muted-foreground'}>
                      {a.enabled ? 'enabled' : 'disabled'}
                    </Badge>
                    {a.roleKey === 'platform-admin' && <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">restricted</Badge>}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{a.email} → #/{a.dashboard}</p>
                  {a.restrictedNote && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{a.restrictedNote}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.lastResetAt ? `Last data reset: ${dateLabel(a.lastResetAt)} · ${'resetCount' in a ? a.resetCount : 0} total` : 'No data reset yet'}
                  </p>
                </div>
                <div className="flex items-center gap-3 sm:shrink-0">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Session lifetime">
                    <Timer className="h-3.5 w-3.5" aria-hidden />
                    <Select
                      value={String(a.sessionMinutes)}
                      onValueChange={(v) => patchRole(a.roleKey, { sessionMinutes: Number(v) })}
                      disabled={busy === a.roleKey}
                    >
                      <SelectTrigger className="h-8 w-[7.5rem] text-xs" aria-label={`Session length for ${a.label}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SESSION_OPTIONS.map((m) => (
                          <SelectItem key={m} value={String(m)}>{m >= 60 ? `${m / 60} h` : `${m} min`}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {busy === a.roleKey && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
                    <Switch
                      checked={a.enabled}
                      onCheckedChange={(v) => patchRole(a.roleKey, { enabled: v })}
                      disabled={busy === a.roleKey}
                      aria-label={`${a.enabled ? 'Disable' : 'Enable'} ${a.label}`}
                    />
                    <span className="hidden w-16 text-xs text-muted-foreground sm:inline">
                      <Power className="mr-1 inline h-3 w-3" aria-hidden />
                      {a.enabled ? 'on' : 'off'}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data && data.canManage && (
        <Card className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold">Recent demo sign-ins</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            From the audit trail (DEMO_LOGIN events). Demo sessions expire automatically; disabling a role hides it from the sign-in page immediately
            and blocks new sessions for it.
          </p>
          {data.sessions.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No demo sign-ins recorded yet.</p>
          ) : (
            <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto scrollbar-thin pr-1">
              {data.sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm">
                  <span className="font-medium">{s.roleKey ?? 'unknown role'}</span>
                  <span className="text-xs text-muted-foreground">{dateLabel(s.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}
