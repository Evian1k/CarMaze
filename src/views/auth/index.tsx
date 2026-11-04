'use client'

/* Sign in / Register — credential auth with httpOnly JWT session cookies.
 * Also handles: password reset (?reset=<token> / "Forgot password?" card),
 * the TOTP MFA second sign-in step, and ?next=<path> post-auth routing. */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useHashRoute } from '@/hooks/use-hash-route'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Logo } from '@/components/brand/logo'
import { apiSend, navigate, ClientApiError } from '@/lib/client'
import { useAuth } from '@/stores/auth'
import { Gift, ShieldCheck, X, Info, KeyRound } from 'lucide-react'

type Flow = 'form' | 'forgot' | 'reset' | 'mfa'

type ForgotResponse = { ok: boolean; message: string; devResetToken?: string; devResetPath?: string; devNotice?: string }

/** Post-auth destinations must be plain in-app paths — no protocol, host or
 * query tricks. e.g. "/dealer" ok, "//evil.com" or "/x?y=z" rejected. */
function sanitizeNext(raw: string | null): string | null {
  const v = (raw ?? '').trim()
  if (!v.startsWith('/') || !/^[\w\-/.]+$/.test(v)) return null
  return v
}

export default function AuthView() {
  const route = useHashRoute()
  const { user, refresh } = useAuth()
  const [mode, setMode] = useState<'signin' | 'register'>(route.query.get('mode') === 'register' ? 'register' : 'signin')
  // Referral attribution: ?ref=<code> on the invite link (#/signin?ref=CODE).
  const [ref] = useState<string>(() => (route.query.get('ref') || '').trim().slice(0, 32))
  const [refHintDismissed, setRefHintDismissed] = useState(false)
  // Post-auth destination: ?next=/dealer — read once, sanitized, defaults to account.
  const [nextPath] = useState<string | null>(() => sanitizeNext(route.query.get('next')))
  // ?reset=<token> (from a reset link) switches the card to "set new password".
  const resetParam = (route.query.get('reset') || '').trim()
  const [flow, setFlow] = useState<Flow>(() => (resetParam ? 'reset' : 'form'))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  // Forgot password card
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotResult, setForgotResult] = useState<ForgotResponse | null>(null)
  // Reset password card (holds the API success message once done)
  const [resetDone, setResetDone] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  // MFA second step
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Stay in sync with the hash — e.g. "Open reset link" re-routes to ?reset=…
  // A fresh token also clears any stale error from a previous attempt.
  useEffect(() => {
    if (resetParam) {
      setFlow('reset')
      setResetDone(null)
      setError(null)
    } else {
      setFlow((f) => (f === 'reset' ? 'form' : f))
    }
  }, [resetParam])

  useEffect(() => {
    if (user) navigate(nextPath ?? 'account', { replace: true })
  }, [user, nextPath])

  function goAfterAuth() {
    navigate(nextPath ?? 'account')
  }

  /** Return to the sign-in card and clear any in-flight flow state. */
  function backToForm() {
    setFlow('form')
    setMode('signin')
    setError(null)
    setForgotResult(null)
    setResetDone(null)
    setResetPassword('')
    setResetConfirm('')
    setMfaToken(null)
    setMfaCode('')
    navigate('signin', { replace: true })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        const res = await apiSend<{ mfaRequired?: boolean; mfaToken?: string }>('/api/auth/login', 'POST', { email, password })
        if (res.mfaRequired && res.mfaToken) {
          // No session yet — finish with the authenticator code step.
          setMfaToken(res.mfaToken)
          setMfaCode('')
          setFlow('mfa')
          return
        }
      } else {
        await apiSend('/api/auth/register', 'POST', { name, email, password, phone: phone || undefined, ref: ref || undefined })
      }
      await refresh()
      goAfterAuth()
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault()
    if (!mfaToken) return
    setError(null)
    setBusy(true)
    try {
      await apiSend('/api/auth/mfa/verify', 'POST', { mfaToken, code: mfaCode })
      await refresh()
      goAfterAuth()
    } catch (err) {
      if (err instanceof ClientApiError && err.code === 'MFA_SESSION_EXPIRED') {
        setMfaToken(null)
        setMfaCode('')
        setFlow('form')
      }
      setError(err instanceof ClientApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const d = await apiSend<ForgotResponse>('/api/auth/forgot-password', 'POST', { email: forgotEmail })
      setForgotResult(d)
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (resetPassword !== resetConfirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const d = await apiSend<{ message: string }>('/api/auth/reset-password', 'POST', { token: resetParam, password: resetPassword })
      setResetDone(d.message)
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const title =
    flow === 'forgot' ? 'Reset your password'
    : flow === 'reset' ? (resetDone ? 'Password updated' : 'Set a new password')
    : flow === 'mfa' ? 'Two-factor check'
    : mode === 'signin' ? 'Welcome back' : 'Create your account'

  const description =
    flow === 'forgot'
      ? 'Enter the email on your account. If an account exists for it, a reset link will be issued.'
      : flow === 'reset'
        ? 'Choose a new password for your account (minimum 8 characters).'
        : flow === 'mfa'
          ? 'Enter the 6-digit code from your authenticator app to finish signing in.'
          : mode === 'signin'
            ? 'Sign in to save vehicles, track enquiries and manage your listings.'
            : 'Free to join. Browse without an account — sign up to sell, save and enquire.'

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-10">
      <motion.div
        className="w-full max-w-md"
        initial={{ opacity: 0, y: 26, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <motion.div
          className="mb-6 flex justify-center"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <Logo size="xl" showTagline />
        </motion.div>
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {flow === 'form' && (
              <>
                {mode === 'register' && ref && !refHintDismissed && (
                  <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-accent/50 bg-accent/20 px-3 py-2 text-sm text-primary">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Gift className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      Joining with a referral from a friend
                    </span>
                    <button
                      type="button"
                      onClick={() => setRefHintDismissed(true)}
                      aria-label="Dismiss referral note"
                      className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground sm:h-7 sm:w-7"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                )}
                <form onSubmit={submit} className="space-y-4">
                  {mode === 'register' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="name">Full name</Label>
                      <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
                    {mode === 'register' ? (
                      <p className="text-xs text-muted-foreground">At least 8 characters.</p>
                    ) : (
                      <button
                        type="button"
                        className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                        onClick={() => { setFlow('forgot'); setError(null); setForgotResult(null); setForgotEmail(email) }}
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  {mode === 'register' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="phone">Phone <span className="font-normal text-muted-foreground">(optional, for enquiries)</span></Label>
                      <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" />
                    </div>
                  )}
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
                  </Button>
                </form>
                <div className="mt-4 text-center text-sm text-muted-foreground">
                  {mode === 'signin' ? (
                    <>New to CARMAZE?{' '}
                      <button className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => { setMode('register'); setError(null) }}>
                        Create an account
                      </button>
                    </>
                  ) : (
                    <>Already have an account?{' '}
                      <button className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => { setMode('signin'); setError(null) }}>
                        Sign in
                      </button>
                    </>
                  )}
                </div>
              </>
            )}

            {flow === 'forgot' && (
              forgotResult ? (
                <div className="space-y-4">
                  <Alert>
                    <AlertDescription>{forgotResult.message}</AlertDescription>
                  </Alert>
                  {forgotResult.devResetPath && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                      <p className="flex items-start gap-1.5">
                        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        {forgotResult.devNotice}
                      </p>
                      <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => forgotResult.devResetPath && navigate(forgotResult.devResetPath)}>
                        Open reset link
                      </Button>
                    </div>
                  )}
                  <p className="text-center text-sm text-muted-foreground">
                    <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={backToForm}>
                      Back to sign in
                    </button>
                  </p>
                </div>
              ) : (
                <form onSubmit={submitForgot} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="forgot-email">Email</Label>
                    <Input id="forgot-email" type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} required autoComplete="email" />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? 'Please wait…' : 'Issue reset link'}
                  </Button>
                  <p className="text-center text-sm text-muted-foreground">
                    <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={backToForm}>
                      Back to sign in
                    </button>
                  </p>
                </form>
              )
            )}

            {flow === 'reset' && (
              resetDone ? (
                <div className="space-y-4">
                  <Alert>
                    <AlertDescription>{resetDone}</AlertDescription>
                  </Alert>
                  <Button type="button" className="w-full" onClick={backToForm}>
                    Back to sign in
                  </Button>
                </div>
              ) : (
                <form onSubmit={submitReset} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-password">New password</Label>
                    <Input id="reset-password" type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
                    <p className="text-xs text-muted-foreground">At least 8 characters.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-confirm">Confirm new password</Label>
                    <Input id="reset-confirm" type="password" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy || resetPassword.length < 8 || resetConfirm.length < 8}>
                    {busy ? 'Please wait…' : 'Set new password'}
                  </Button>
                  <p className="text-center text-sm text-muted-foreground">
                    <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={backToForm}>
                      Back to sign in
                    </button>
                  </p>
                </form>
              )
            )}

            {flow === 'mfa' && (
              <form onSubmit={submitMfa} className="space-y-4">
                <div className="flex items-center gap-2 rounded-lg border border-accent/50 bg-accent/20 px-3 py-2 text-sm text-primary">
                  <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Your account is protected with an authenticator app.
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mfa-code">Authenticator code</Label>
                  <Input
                    id="mfa-code"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    className="text-center font-mono text-lg tracking-[0.4em]"
                    placeholder="······"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy || mfaCode.length !== 6}>
                  {busy ? 'Checking…' : 'Verify & sign in'}
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={backToForm}>
                    Back to sign in
                  </button>
                </p>
              </form>
            )}
          </CardContent>
        </Card>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          Passwords are hashed; sessions use secure httpOnly cookies.
        </p>
      </motion.div>
    </div>
  )
}
