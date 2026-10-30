'use client'

/* Sign in / Register — credential auth with httpOnly JWT session cookies. */

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
import { ShieldCheck } from 'lucide-react'

export default function AuthView() {
  const route = useHashRoute()
  const { user, refresh } = useAuth()
  const [mode, setMode] = useState<'signin' | 'register'>(route.query.get('mode') === 'register' ? 'register' : 'signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (user) navigate('account', { replace: true })
     
  }, [user])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        await apiSend('/api/auth/login', 'POST', { email, password })
      } else {
        await apiSend('/api/auth/register', 'POST', { name, email, password, phone: phone || undefined })
      }
      await refresh()
      navigate('account')
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

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
            <CardTitle>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</CardTitle>
            <CardDescription>
              {mode === 'signin'
                ? 'Sign in to save vehicles, track enquiries and manage your listings.'
                : 'Free to join. Browse without an account — sign up to sell, save and enquire.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
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
                {mode === 'register' && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
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
