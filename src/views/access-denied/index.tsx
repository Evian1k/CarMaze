'use client'

/* Access-denied screen — shown when the signed-in user opens a view their
 * role does not authorise. Offers a safe route back to the user's own
 * dashboard, and reports repeated suspicious attempts to the platform
 * (rate-limited, fire-and-forget; the backend independently enforces every
 * permission, so this page never leaks any protected data). */

import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { apiSend, navigate } from '@/lib/client'
import { dashboardFor } from '@/lib/view-guard'
import { useAuth } from '@/stores/auth'

export default function AccessDeniedView({ reason, view }: { reason: 'unauthenticated' | 'forbidden'; view: string }) {
  const { user } = useAuth()
  const reported = useRef(0)

  // Record the attempt (max 1 report per view per mount window) — repeated
  // probes are visible in the platform audit trail.
  useEffect(() => {
    if (reason !== 'forbidden') return
    if (Date.now() - reported.current < 60_000) return
    reported.current = Date.now()
    apiSend('/api/security/access-denied', 'POST', { view }).catch(() => {})
  }, [reason, view])

  const dashboard = dashboardFor(user)

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-14">
      <motion.div
        className="w-full max-w-md"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <Card>
          <CardHeader className="items-center text-center">
            <span className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive" aria-hidden>
              <ShieldAlert className="h-6 w-6" />
            </span>
            <CardTitle>{reason === 'unauthenticated' ? 'Sign in required' : 'Access denied'}</CardTitle>
            <CardDescription>
              {reason === 'unauthenticated'
                ? 'This area is only available to signed-in users with the right role.'
                : 'Your account does not have permission to open this area. This attempt has been recorded.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            <Button className="w-full" onClick={() => navigate(dashboard)}>
              {user ? 'Return to my dashboard' : 'Go to sign in'}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => navigate('/')}>
              Back to homepage
            </Button>
            {!user && (
              <Button variant="ghost" className="w-full" onClick={() => navigate(`signin?next=/${view}`)}>
                Sign in to continue
              </Button>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
