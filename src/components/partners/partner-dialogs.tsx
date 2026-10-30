'use client'

/* CARMAZE Partner Network — shared dialogs.
 * RequestServiceDialog: signed-in customers send a referral request to a
 *                       verified partner (POST /api/partners/[id]/request).
 * ApplyDialog:          public partner application form
 *                       (POST /api/partners/apply). Honest copy throughout:
 *                       human review, business verification, no fee to apply.
 * Form state lives inside Radix DialogContent (unmounted while closed), so
 * each open starts from a clean, prefilled form without reset effects. */

import { useState } from 'react'
import { BadgeCheck, CheckCircle2, ExternalLink, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiSend } from '@/lib/client'
import { KENYA_COUNTIES } from '@/lib/format'
import { PARTNER_CATEGORIES, partnerCategoryLabel } from '@/lib/partners'
import type { CurrentUser } from '@/stores/auth'

export type PublicPartner = {
  id: string
  refCode: string
  name: string
  category: string
  county: string
  serviceAreas: string[]
  description: string | null
  logoUrl: string | null
  coverUrl: string | null
  phone: string | null
  whatsapp: boolean
  website: string | null
  rating: number | null
  referrals: number
  createdAt: string
}

// ─────────────────────────── Request service ───────────────────────────

export function RequestServiceDialog({
  partner,
  open,
  onOpenChange,
  user,
  onSent,
}: {
  partner: PublicPartner | null
  open: boolean
  onOpenChange: (v: boolean) => void
  user: CurrentUser
  onSent: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {partner && (
          <RequestServiceForm partner={partner} user={user} onSent={onSent} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RequestServiceForm({
  partner,
  user,
  onSent,
  onClose,
}: {
  partner: PublicPartner
  user: CurrentUser
  onSent: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(user.name || '')
  const [phone, setPhone] = useState(user.phone || '')
  const [county, setCounty] = useState('Nairobi')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sentRef, setSentRef] = useState<string | null>(null)

  function submit() {
    setSending(true)
    apiSend<{ refCode: string }>(`/api/partners/${partner.id}/request`, 'POST', {
      name: name.trim(),
      phone: phone.trim(),
      county,
      message: message.trim(),
      email: email.trim() || undefined,
    })
      .then((d) => {
        setSentRef(d.refCode)
        toast.success(`Request ${d.refCode} sent to ${partner.name}`)
        onSent()
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not send the request'))
      .finally(() => setSending(false))
  }

  const canSend = name.trim().length >= 2 && phone.trim().length >= 9 && message.trim().length >= 10 && !sending

  if (sentRef) {
    return (
      <div className="py-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#315e4b]/10 text-[#315e4b]">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h3 className="mt-3 text-lg font-semibold">Request sent</h3>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{sentRef}</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Your request was delivered to {partner.name}. They will contact you on the phone
          number provided — quote ref <span className="font-mono">{sentRef}</span> when they call.
        </p>
        <Button className="mt-4" onClick={onClose}>Done</Button>
      </div>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          Request service
          <Badge variant="outline" className="gap-1 border-gold/60 text-[#8a6d33]">
            <BadgeCheck className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
            Verified
          </Badge>
        </DialogTitle>
        <DialogDescription>
          Send a referral request to <strong>{partner.name}</strong>{' '}
          ({partnerCategoryLabel(partner.category)}, {partner.county}).
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pr-name">Your name *</Label>
            <Input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Amina Wanjiru" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-phone">Phone the partner should call *</Label>
            <Input id="pr-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" inputMode="tel" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pr-county">Where do you need them? *</Label>
            <Select value={county} onValueChange={setCounty}>
              <SelectTrigger id="pr-county"><SelectValue /></SelectTrigger>
              <SelectContent>{KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-email">Email (optional)</Label>
            <Input id="pr-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pr-message">What do you need? *</Label>
          <Textarea
            id="pr-message"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={`e.g. I need ${partnerCategoryLabel(partner.category).toLowerCase()} for my vehicle next week…`}
          />
          <p className="text-xs text-muted-foreground">{message.trim().length}/1000</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Your name and phone are shared with this partner so they can reach you. CARMAZE
          brokers the introduction — service terms are agreed directly with the partner.
        </p>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!canSend}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          {sending ? 'Sending…' : 'Send request'}
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────────────────────────── Partner application ───────────────────────────

const EMPTY_APPLY = {
  name: '',
  category: '',
  county: '',
  serviceAreas: '',
  description: '',
  contactName: '',
  phone: '',
  email: '',
  website: '',
}

export function ApplyDialog({
  open,
  onOpenChange,
  onApplied,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onApplied: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <ApplyForm onApplied={onApplied} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function ApplyForm({ onApplied, onClose }: { onApplied: () => void; onClose: () => void }) {
  const [form, setForm] = useState(EMPTY_APPLY)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ refCode: string; message: string } | null>(null)

  function set<K extends keyof typeof EMPTY_APPLY>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function submit() {
    setSending(true)
    apiSend<{ refCode: string; message: string }>('/api/partners/apply', 'POST', {
      name: form.name.trim(),
      category: form.category,
      county: form.county,
      serviceAreas: form.serviceAreas
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20),
      description: form.description.trim(),
      contactName: form.contactName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || undefined,
      website: form.website.trim() || undefined,
    })
      .then((d) => {
        setResult(d)
        onApplied()
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not submit the application'))
      .finally(() => setSending(false))
  }

  if (result) {
    return (
      <div className="py-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#315e4b]/10 text-[#315e4b]">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h3 className="mt-3 text-lg font-semibold">Application received</h3>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{result.refCode}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{result.message}</p>
        <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
          Keep this reference — quote {result.refCode} if you contact our team about your application.
        </p>
        <Button className="mt-4" onClick={onClose}>Done</Button>
      </div>
    )
  }

  const websiteOk = form.website.trim() === '' || /^https?:\/\/\S+\.\S+/.test(form.website.trim())
  const canSubmit =
    form.name.trim().length >= 2 &&
    form.category !== '' &&
    form.county !== '' &&
    form.description.trim().length >= 20 &&
    form.contactName.trim().length >= 2 &&
    form.phone.trim().length >= 9 &&
    websiteOk &&
    !sending

  return (
    <>
      <DialogHeader>
        <DialogTitle>Become a CARMAZE partner</DialogTitle>
        <DialogDescription>
          Inspection centres, insurers, finance providers, towing operators, parts suppliers
          and transporters — tell us about your business and we will be in touch.
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-lg border border-gold/50 bg-gold/10 p-3 text-xs leading-relaxed text-[#6b5527]">
        <ul className="list-inside list-disc space-y-1">
          <li>Applications are reviewed by the CARMAZE team — we verify every business by hand.</li>
          <li>A listing appears in the public directory only after business verification is complete.</li>
          <li>No payment is charged for applying.</li>
        </ul>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pa-name">Business name *</Label>
            <Input id="pa-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Precision Auto Inspection Ltd" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pa-category">Category *</Label>
            <Select value={form.category} onValueChange={(v) => set('category', v)}>
              <SelectTrigger id="pa-category"><SelectValue placeholder="Select a category" /></SelectTrigger>
              <SelectContent>
                {PARTNER_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pa-county">County *</Label>
            <Select value={form.county} onValueChange={(v) => set('county', v)}>
              <SelectTrigger id="pa-county"><SelectValue placeholder="Select county" /></SelectTrigger>
              <SelectContent>{KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pa-areas">Service areas (comma-separated)</Label>
            <Input id="pa-areas" value={form.serviceAreas} onChange={(e) => set('serviceAreas', e.target.value)} placeholder="e.g. Nairobi, Kiambu, Machakos" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pa-desc">About the business * (20–2000 characters)</Label>
          <Textarea
            id="pa-desc"
            rows={4}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="What you do, certifications, coverage, what makes customers trust you…"
          />
          <p className="text-xs text-muted-foreground">{form.description.trim().length}/2000</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pa-contact">Contact person *</Label>
            <Input id="pa-contact" value={form.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="Full name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pa-phone">Business phone *</Label>
            <Input id="pa-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="07xx xxx xxx" inputMode="tel" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pa-email">Business email</Label>
            <Input id="pa-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="info@business.co.ke" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pa-website">Website</Label>
            <Input id="pa-website" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
            {!websiteOk && <p className="text-xs text-destructive">Enter a full URL starting with https://</p>}
          </div>
        </div>
      </div>

      <Separator />

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!canSubmit}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
          {sending ? 'Submitting…' : 'Submit application'}
        </Button>
      </DialogFooter>
    </>
  )
}
