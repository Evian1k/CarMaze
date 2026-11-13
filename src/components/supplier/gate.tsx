'use client'

/* SupplierOS gate: pre-verification states.
 * A) No supplier business yet → benefits + application form (POST /api/suppliers).
 * B) Submitted successfully → honest "under review" state.
 * C) 409 APPLICATION_EXISTS → "already under review" state.
 * Verification status is never claimed here; only the platform's review team
 * can verify a supplier after document review. */

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BadgeCheck, Boxes, Building2, CheckCircle2, FileText, Hourglass, Loader2, LogIn, Plus,
  ShieldCheck, Truck, Upload, X,
} from 'lucide-react'
import { apiSend, navigate } from '@/lib/client'
import { useAuth } from '@/stores/auth'
import { KENYA_COUNTIES } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

import { uploadOne, errMessage } from './shared'

type DocItem = { name: string; url: string }

const SUPPLY_CATEGORY_OPTIONS = [
  'Spare parts', 'Filters', 'Brakes', 'Suspension', 'Electrical', 'Batteries', 'Tyres', 'Rims',
  'Oils & lubricants', 'Body parts', 'Lighting', 'Workshop equipment', 'Diagnostics', 'Tools', 'Accessories',
]

const BENEFITS = [
  { icon: <BadgeCheck className="h-5 w-5" />, title: 'Verified supplier badge', detail: 'Pass document review and earn the trust marker procurement teams filter by.' },
  { icon: <Boxes className="h-5 w-5" />, title: 'Wholesale catalogue', detail: 'Publish products with list + wholesale pricing, minimum quantities and stock by warehouse.' },
  { icon: <Truck className="h-5 w-5" />, title: 'Protected orders', detail: 'Purchase orders from verified garages with protected funds, OTP-verified handover and inspection.' },
  { icon: <FileText className="h-5 w-5" />, title: 'Quote requests', detail: 'Receive Request-a-Part quotations from garages in your delivery counties.' },
]

type FormState = {
  orgName: string
  regNo: string
  county: string
  town: string
  physicalAddress: string
  phone: string
  email: string
  representative: string
  categories: string
  description: string
}

const EMPTY_FORM: FormState = {
  orgName: '', regNo: '', county: '', town: '', physicalAddress: '', phone: '', email: '',
  representative: '', categories: '', description: '',
}

export function SignInGate() {
  const { user } = useAuth()
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16">
      <Card className="border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Building2 className="h-7 w-7" />
          </div>
          <CardTitle className="text-2xl">Sign in to open SupplierOS</CardTitle>
          <CardDescription>
            SupplierOS is the wholesale workspace of the CARMAZE Automotive Supply Network; catalogue, protected orders,
            quote requests, warehouses and billing in one place.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3 text-center">
          <Button size="lg" className="min-h-11" onClick={() => navigate('/signin?next=/supplier')}>
            <LogIn className="h-4 w-4" /> Sign in
          </Button>
          <p className="text-xs text-muted-foreground">
            {user
              ? 'Your session is loading: this page opens automatically.'
              : 'New to CARMAZE? Create a free account, then apply for supplier verification below.'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: 'Application received: queued for a reviewer.',
  UNDER_REVIEW: 'A reviewer is actively checking your documents right now.',
  MORE_INFO_REQUIRED: 'The review team has requested additional information; check your notifications for what is needed.',
  RESUBMITTED: 'Your updates were received and the review has resumed.',
}

export function UnderReview({
  alreadyExists = false,
  orgName,
  status,
  refCode,
  decisionNote,
  correctionsDueAt,
  onReset,
}: {
  alreadyExists?: boolean
  orgName?: string
  status?: string
  refCode?: string
  decisionNote?: string
  correctionsDueAt?: string
  onReset?: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16">
      <Card className="border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/40 text-accent-foreground">
            <Hourglass className="h-7 w-7" />
          </div>
          <CardTitle className="text-2xl">
            {alreadyExists ? 'Application already under review' : 'Application received: under review'}
          </CardTitle>
          <CardDescription>
            {orgName ? `${orgName}: ` : ''}
            {alreadyExists
              ? 'Our records show a supplier application from your account that is still being processed. You can resubmit only after it is decided.'
              : 'Our verification team reviews business registration documents before any supplier is verified. This typically takes a few working days.'}
          </CardDescription>
          {(refCode || status) && (
            <p className="text-xs text-muted-foreground">
              {refCode ? <span className="font-mono">{refCode}</span> : null}
              {refCode && status ? ' · ' : ''}
              {status ? status.replaceAll('_', ' ').toLowerCase() : ''}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {status && STATUS_COPY[status] && (
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>Current status</AlertTitle>
              <AlertDescription>
                {STATUS_COPY[status]}
                {correctionsDueAt && status === 'MORE_INFO_REQUIRED' ? ` Corrections are due by ${new Date(correctionsDueAt).toLocaleDateString('en-KE')}.` : ''}
              </AlertDescription>
            </Alert>
          )}
          {decisionNote && (
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>Note from the review team</AlertTitle>
              <AlertDescription>{decisionNote}</AlertDescription>
            </Alert>
          )}
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>What happens next</AlertTitle>
            <AlertDescription>
              A reviewer checks your registration documents and premises details. If approved, your supplier workspace
              opens here with catalogue, orders and warehouse tools. Until then your business is never shown as verified
              anywhere on CARMAZE.
            </AlertDescription>
          </Alert>
          <div className="flex justify-center gap-2 pt-1">
            <Button variant="outline" onClick={() => navigate('/cars')}>Browse the marketplace</Button>
            <Button variant="ghost" onClick={() => navigate('/account')}>Account settings</Button>
          </div>
          {onReset && (
            <div className="text-center">
              <Button variant="link" size="sm" className="text-muted-foreground" onClick={onReset}>
                Applied by mistake, or an earlier application was already decided? Start a new application.
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function ApplyForm({ onDone, onExists }: { onDone: (orgName: string) => void; onExists?: () => void }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [docs, setDocs] = useState<DocItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [consent, setConsent] = useState(false)
  const [existsConflict, setExistsConflict] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const res = await uploadOne(file, 'document')
        setDocs((prev) => [...prev, { name: res.name || file.name, url: res.url }])
      }
      toast.success('Document uploaded')
    } catch (e) {
      toast.error(await errMessage(e, 'Upload failed: please try again.'))
    } finally {
      setUploading(false)
    }
  }

  function validate(): string | null {
    if (form.orgName.trim().length < 3) return 'Enter the business name (at least 3 characters).'
    if (!form.county) return 'Select the county where the business is based.'
    const phone = form.phone.replace(/\s+/g, '')
    if (phone.length < 9) return 'Enter a valid business phone number (at least 9 digits).'
    if (form.representative.trim().length < 2) return 'Enter the authorised representative name.'
    if (!consent) return 'Confirm the declaration to submit your application.'
    return null
  }

  async function submit() {
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return
    }
    setSubmitting(true)
    try {
      await apiSend<{ application: { refCode: string } }>('/api/suppliers', 'POST', {
        orgName: form.orgName.trim(),
        regNo: form.regNo.trim() || null,
        county: form.county,
        town: form.town.trim() || null,
        physicalAddress: form.physicalAddress.trim() || null,
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        representative: form.representative.trim(),
        categories: form.categories.trim() || null,
        description: form.description.trim() || null,
        documents: docs,
        consent: true,
      })
      toast.success('Application submitted for verification.')
      onDone(form.orgName.trim())
    } catch (e) {
      const msg = await errMessage(e, 'Could not submit the application.')
      const status = (e as { status?: number }).status
      const code = (e as { code?: string }).code
      if (status === 409 || code === 'APPLICATION_EXISTS') {
        setExistsConflict(true)
        onExists?.()
      } else {
        toast.error(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (existsConflict) return <UnderReview alreadyExists />

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-6 sm:px-6 sm:py-10">
      {/* Marketing header */}
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Become a verified supplier</h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Join the Automotive Supply Network and sell wholesale to verified garages across Kenya. Verification is granted
          by the CARMAZE review team after document checks; it is never automatic and never self-claimed.
        </p>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {BENEFITS.map((b) => (
          <Card key={b.title} className="py-4">
            <CardContent className="px-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{b.icon}</div>
              <p className="mt-2 text-sm font-semibold">{b.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{b.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Application form */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Supplier application</CardTitle>
          <CardDescription>
            Details are reviewed by the CARMAZE verification team. Documents are private and never shown publicly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sup-orgname">Business name *</Label>
              <Input id="sup-orgname" value={form.orgName} onChange={(e) => set('orgName', e.target.value)} placeholder="e.g. Sifa Auto Spares Ltd" maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-regno">Registration number</Label>
              <Input id="sup-regno" value={form.regNo} onChange={(e) => set('regNo', e.target.value)} placeholder="e.g. C.123456" maxLength={60} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-county">County *</Label>
              <Select value={form.county || undefined} onValueChange={(v) => set('county', v)}>
                <SelectTrigger id="sup-county" aria-label="County"><SelectValue placeholder="Select county" /></SelectTrigger>
                <SelectContent>
                  {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-town">Town / area</Label>
              <Input id="sup-town" value={form.town} onChange={(e) => set('town', e.target.value)} placeholder="e.g. Industrial Area" maxLength={60} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sup-address">Physical address</Label>
              <Input id="sup-address" value={form.physicalAddress} onChange={(e) => set('physicalAddress', e.target.value)} placeholder="Street, building, plot" maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-phone">Business phone *</Label>
              <Input id="sup-phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+254 7xx xxx xxx" maxLength={20} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-email">Business email</Label>
              <Input id="sup-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="sales@business.co.ke" maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-rep">Authorised representative *</Label>
              <Input id="sup-rep" value={form.representative} onChange={(e) => set('representative', e.target.value)} placeholder="Full name of the contact person" maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-categories">Supply categories</Label>
              <Input id="sup-categories" value={form.categories} onChange={(e) => set('categories', e.target.value)} placeholder="e.g. Filters, Brakes, Oils & lubricants" maxLength={300} />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {SUPPLY_CATEGORY_OPTIONS.slice(0, 8).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    onClick={() => {
                      const parts = new Set(splitCategories(form.categories))
                      parts.add(c)
                      set('categories', Array.from(parts).join(', '))
                    }}
                  >
                    <Plus className="mr-0.5 inline h-3 w-3" />{c}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sup-desc">Business description</Label>
              <Textarea id="sup-desc" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What you supply, brands you carry, distribution coverage…" maxLength={2000} />
            </div>
          </div>

          {/* Documents */}
          <div className="space-y-3">
            <input
              ref={inputRef}
              id="sup-doc-file"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <div className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-center">
              <Upload className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-1 text-sm font-medium">Business registration, permits or premises photos</p>
              <p className="text-xs text-muted-foreground">JPG, PNG, WEBP or PDF · up to 8 MB each</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => inputRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {uploading ? 'Uploading…' : 'Upload documents'}
              </Button>
            </div>
            {docs.length > 0 && (
              <ul className="space-y-2">
                {docs.map((d) => (
                  <li key={d.url} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{d.name}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${d.name}`} onClick={() => setDocs((prev) => prev.filter((x) => x.url !== d.url))}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" /> Documents are private: only CARMAZE reviewers can view them.
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-3">
            <Checkbox id="sup-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
            <Label htmlFor="sup-consent" className="text-xs font-normal leading-relaxed text-muted-foreground">
              I confirm the details above are accurate and I am authorised to apply on behalf of this business. I understand
              verification requires document review, and CARMAZE may request additional information.
            </Label>
          </div>

          <div className="flex justify-end">
            <Button onClick={submit} disabled={submitting || uploading} className="min-h-11">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Submit application
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function splitCategories(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean)
}
