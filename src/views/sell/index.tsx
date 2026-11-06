'use client'

/* CARMAZE: Sell (#/sell)
 * Three-step listing form: vehicle basics → pricing & details → reach.
 * Supports edit mode via ?id=<vehicleId> (own, editable listings only).
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Car, Tag, Megaphone, Check, Loader2, ImagePlus, X, LockKeyhole,
  ChevronLeft, ChevronRight, PartyPopper,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Reveal } from '@/components/motion/reveal'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ListingAssistant } from '@/components/ai/listing-assistant'
import { VerificationPanel } from '@/components/seller/verification-panel'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useAuth } from '@/stores/auth'
import { apiGet, apiSend, apiUpload, navigate } from '@/lib/client'
import { KENYA_COUNTIES, VEHICLE_MAKES, BODY_TYPES, FUEL_TYPES, TRANSMISSIONS, CONDITIONS, CONDITION_LABELS, money } from '@/lib/format'
import { toast } from 'sonner'

const FEATURES = [
  'Sunroof', 'Leather seats', 'Reverse camera', 'Apple CarPlay', 'Android Auto',
  'AWD', 'Tow bar', 'Alloy wheels', 'Navigation', 'Cruise control', 'Roof rails', 'New tyres',
]

const STEPS = [
  { n: 1, label: 'Vehicle basics', icon: Car },
  { n: 2, label: 'Pricing & details', icon: Tag },
  { n: 3, label: 'Reach & publish', icon: Megaphone },
]

const EDITABLE_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'REJECTED']

type FormState = {
  make: string
  model: string
  year: string
  bodyType: string
  condition: string
  fuel: string
  transmission: string
  engineCc: string
  color: string
  county: string
  town: string
  price: string // major KES in the input
  mileage: string
  description: string
  matchWithDealers: boolean
}

const EMPTY_FORM: FormState = {
  make: '', model: '', year: '', bodyType: '', condition: 'FOREIGN_USED', fuel: 'PETROL',
  transmission: 'AUTOMATIC', engineCc: '', color: '', county: '', town: '',
  price: '', mileage: '', description: '', matchWithDealers: false,
}

export default function View() {
  const route = useHashRoute()
  const { user, loading: authLoading } = useAuth()

  const [step, setStep] = useState(1)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [features, setFeatures] = useState<string[]>([])
  const [photos, setPhotos] = useState<{ url: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState<null | 'DRAFT' | 'PENDING_REVIEW'>(null)
  const [success, setSuccess] = useState<{ refCode: string; status: string } | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editStatus, setEditStatus] = useState<string | null>(null)
  const [editNote, setEditNote] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  const editQueryId = route.query.get('id')

  // ── Edit mode: load own editable vehicle and prefill ──
  useEffect(() => {
    if (!user || !editQueryId) return
    let active = true
    apiGet<{ vehicle: {
      id: string; status: string; reviewNote: string | null; make: string; model: string; year: number;
      priceMinor: number; mileageKm: number; fuel: string; transmission: string; bodyType: string;
      engineCc: number | null; condition: string; county: string; town: string | null; color: string;
      description: string; matchWithDealers: boolean; photos: { url: string; order: number }[];
    } }>(`/api/vehicles/${editQueryId}`)
      .then((d) => {
        if (!active) return
        const v = d.vehicle
        if (!EDITABLE_STATUSES.includes(v.status)) {
          setEditError(`This listing is ${v.status.toLowerCase().replace('_', ' ')} and can no longer be edited.`)
          return
        }
        setEditId(v.id)
        setEditStatus(v.status)
        setEditNote(v.reviewNote)
        setForm({
          make: v.make,
          model: v.model,
          year: String(v.year),
          bodyType: v.bodyType,
          condition: v.condition,
          fuel: v.fuel,
          transmission: v.transmission,
          engineCc: v.engineCc ? String(v.engineCc) : '',
          color: v.color,
          county: v.county,
          town: v.town ?? '',
          price: String(Math.round(v.priceMinor / 100)),
          mileage: String(v.mileageKm),
          description: v.description,
          matchWithDealers: v.matchWithDealers,
        })
        setPhotos(v.photos.map((p) => ({ url: p.url })))
      })
      .catch((e: Error) => { if (active) setEditError(e.message) })
    return () => { active = false }
  }, [user, editQueryId])

  const priceMinor = useMemo(() => {
    const n = Number(form.price)
    return form.price !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
  }, [form.price])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }
  const setDescription = (d: string) => set('description', d)

  function toggleFeature(f: string) {
    setFeatures((fs) => (fs.includes(f) ? fs.filter((x) => x !== f) : [...fs, f]))
  }

  async function handleFiles(fileList: FileList) {
    const slots = 8 - photos.length
    if (slots <= 0) { toast.warning('Maximum of 8 photos'); return }
    const files = Array.from(fileList).slice(0, slots)
    const invalid = files.find((f) => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type))
    if (invalid) { toast.error('Photos must be JPG, PNG or WEBP'); return }
    setUploading(true)
    for (const file of files) {
      try {
        const fd = new FormData()
        fd.set('file', file)
        fd.set('kind', 'image')
        const res = await apiUpload<{ url: string }>('/api/upload', fd)
        setPhotos((p) => (p.length < 8 ? [...p, { url: res.url }] : p))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Upload failed')
      }
    }
    setUploading(false)
  }

  function removePhoto(url: string) {
    setPhotos((p) => p.filter((x) => x.url !== url))
  }

  function validateStep(current: number): string | null {
    if (current === 1) {
      if (!form.make) return 'Select the make'
      if (form.model.trim().length < 1) return 'Enter the model'
      const y = Number(form.year)
      const maxYear = new Date().getFullYear() + 1
      if (!form.year || !Number.isInteger(y) || y < 1980 || y > maxYear) return `Year must be between 1980 and ${maxYear}`
      if (!form.bodyType) return 'Select the body type'
      if (!form.condition) return 'Select the condition'
      if (!form.fuel) return 'Select the fuel type'
      if (!form.transmission) return 'Select the transmission'
      if (!form.color.trim()) return 'Enter the colour'
      if (!form.county) return 'Select the county'
      return null
    }
    if (current === 2) {
      if (!priceMinor) return 'Enter a valid price in KES'
      const m = Number(form.mileage)
      if (form.mileage === '' || !Number.isInteger(m) || m < 0) return 'Enter valid mileage in km'
      if (form.description.trim().length < 30) return 'Description must be at least 30 characters'
      return null
    }
    return null
  }

  function next() {
    const err = validateStep(step)
    if (err) { toast.error(err); return }
    setStep((s) => Math.min(3, s + 1))
  }

  function submit(status: 'DRAFT' | 'PENDING_REVIEW') {
    for (let s = 1; s <= 2; s++) {
      const err = validateStep(s)
      if (err) { toast.error(err); setStep(s); return }
    }
    if (!user) { navigate('signin'); return }
    setSubmitting(status)
    const fields = {
      make: form.make,
      model: form.model.trim(),
      year: Number(form.year),
      priceMinor: priceMinor ?? 0,
      mileageKm: Number(form.mileage),
      fuel: form.fuel,
      transmission: form.transmission,
      bodyType: form.bodyType,
      condition: form.condition,
      county: form.county,
      town: form.town.trim() || undefined,
      color: form.color.trim(),
      engineCc: form.engineCc ? Number(form.engineCc) : undefined,
      description: form.description.trim(),
      matchWithDealers: form.matchWithDealers,
      photos: photos.map((p) => p.url),
    }
    let done: Promise<{ vehicle: { refCode: string; status: string } }>
    if (editId) {
      // Edit mode: PATCH applies fields; submitting additionally moves DRAFT/REJECTED → PENDING_REVIEW.
      const payload: Record<string, unknown> = { ...fields }
      if (status === 'PENDING_REVIEW') payload.action = 'submit'
      done = apiSend<{ vehicle: { refCode: string; status: string } }>(`/api/vehicles/${editId}`, 'PATCH', payload)
    } else {
      done = apiSend<{ vehicle: { refCode: string; status: string } }>('/api/vehicles', 'POST', { ...fields, status })
    }
    done
      .then((res) => {
        setSuccess({ refCode: res.vehicle.refCode, status: res.vehicle.status })
        window.scrollTo({ top: 0 })
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setSubmitting(null))
  }

  // ── Auth gate ──
  if (!authLoading && !user) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16 sm:py-24">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <LockKeyhole className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-xl font-bold">Sign in to start selling</h1>
            <p className="text-sm text-muted-foreground">
              Browsing CARMAZE is free and needs no account. To list a vehicle you&apos;ll need to sign in so
              buyers can reach you securely: your contact details stay private until you choose to share them.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="h-11 px-6" onClick={() => navigate('signin')}>Sign in</Button>
              <Button variant="outline" className="h-11 px-6" onClick={() => navigate('cars')}>Keep browsing</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Success screen ──
  if (success) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16 sm:py-24">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/25">
              <PartyPopper className="h-7 w-7 text-accent-foreground" />
            </div>
            <h1 className="text-xl font-bold">
              {success.status === 'PENDING_REVIEW' ? 'Listing submitted for review' : 'Draft saved'}
            </h1>
            <p className="rounded-lg bg-muted px-3 py-1.5 font-mono text-sm font-semibold tracking-wide">
              {success.refCode}
            </p>
            <p className="text-sm text-muted-foreground">
              {success.status === 'PENDING_REVIEW'
                ? 'Our review team checks every listing to keep the marketplace scam-free. The initial review target is 24 business hours; you\'ll get a notification the moment your car goes live.'
                : 'Your listing is saved as a draft. Submit it for review whenever you\'re ready; nothing is public until it\'s approved.'}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="h-11 px-6" onClick={() => navigate('my-listings')}>Go to my listings</Button>
              <Button variant="outline" className="h-11 px-6" onClick={() => navigate('cars')}>Browse marketplace</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const canContinue = true

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <Reveal>
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {editId ? 'Edit your listing' : 'Sell your car'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {editId
              ? `Editing ${editStatus === 'REJECTED' ? 'a rejected listing' : 'your listing'}: changes go live after re-review.`
              : 'Free to list. Reviewed within 24 business hours. Your phone stays private until you accept an enquiry.'}
          </p>
        </header>
      </Reveal>

      {/* Seller verification: manual document review that adds the verified trust marker */}
      <Reveal className="mb-6">
        <VerificationPanel />
      </Reveal>

      {editError && (
        <Alert className="mb-6">
          <AlertTitle>Can&apos;t edit this listing</AlertTitle>
          <AlertDescription>{editError}</AlertDescription>
        </Alert>
      )}

      {editStatus === 'REJECTED' && editNote && (
        <Alert className="mb-6 border-destructive/40 bg-destructive/5 text-destructive [&>svg]:text-destructive">
          <AlertTitle>Rejected by review: fix and resubmit</AlertTitle>
          <AlertDescription>{editNote}</AlertDescription>
        </Alert>
      )}

      {/* Progress */}
      <ol className="mb-8 flex items-center gap-2" aria-label="Form progress">
        {STEPS.map((s, i) => (
          <li key={s.n} className="flex flex-1 items-center gap-2">
            <span
              aria-current={step === s.n ? 'step' : undefined}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                step > s.n ? 'bg-primary text-primary-foreground' : step === s.n ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              {step > s.n ? <Check className="h-4 w-4" /> : s.n}
            </span>
            <span className={`hidden text-sm font-medium sm:block ${step === s.n ? 'text-foreground' : 'text-muted-foreground'}`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className={`h-px flex-1 ${step > s.n ? 'bg-primary' : 'bg-border'}`} />}
          </li>
        ))}
      </ol>

      <Card>
        <CardContent className="p-6">
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Make *</Label>
                  <Select value={form.make || undefined} onValueChange={(v) => set('make', v)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select make" /></SelectTrigger>
                    <SelectContent>
                      {VEHICLE_MAKES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="s-model">Model *</Label>
                  <Input id="s-model" placeholder="e.g. Harrier Premium" value={form.model} onChange={(e) => set('model', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="s-year">Year of manufacture *</Label>
                  <Input id="s-year" inputMode="numeric" placeholder="2018" value={form.year} onChange={(e) => set('year', e.target.value.replace(/[^\d]/g, ''))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Body type *</Label>
                  <Select value={form.bodyType || undefined} onValueChange={(v) => set('bodyType', v)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select body" /></SelectTrigger>
                    <SelectContent>
                      {BODY_TYPES.map((b) => <SelectItem key={b} value={b}>{b.charAt(0) + b.slice(1).toLowerCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Condition *</Label>
                  <Select value={form.condition || undefined} onValueChange={(v) => set('condition', v)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select condition" /></SelectTrigger>
                    <SelectContent>
                      {CONDITIONS.map((c) => <SelectItem key={c} value={c}>{CONDITION_LABELS[c]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Fuel *</Label>
                  <Select value={form.fuel || undefined} onValueChange={(v) => set('fuel', v)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select fuel" /></SelectTrigger>
                    <SelectContent>
                      {FUEL_TYPES.map((f) => <SelectItem key={f} value={f}>{f.charAt(0) + f.slice(1).toLowerCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Transmission *</Label>
                  <Select value={form.transmission || undefined} onValueChange={(v) => set('transmission', v)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {TRANSMISSIONS.map((t) => <SelectItem key={t} value={t}>{t === 'AUTOMATIC' ? 'Automatic' : 'Manual'}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="s-engine">Engine (cc)</Label>
                  <Input id="s-engine" inputMode="numeric" placeholder="e.g. 2000" value={form.engineCc} onChange={(e) => set('engineCc', e.target.value.replace(/[^\d]/g, ''))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="s-color">Colour *</Label>
                  <Input id="s-color" placeholder="e.g. Pearl White" value={form.color} onChange={(e) => set('color', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>County *</Label>
                  <Select value={form.county || undefined} onValueChange={(v) => set('county', v)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select county" /></SelectTrigger>
                    <SelectContent>
                      {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="s-town">Town / area</Label>
                  <Input id="s-town" placeholder="e.g. Syokimau" value={form.town} onChange={(e) => set('town', e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="s-price">Asking price (KES) *</Label>
                  <Input
                    id="s-price"
                    inputMode="numeric"
                    placeholder="e.g. 1,250,000"
                    value={form.price}
                    onChange={(e) => set('price', e.target.value.replace(/[^\d]/g, ''))}
                  />
                  <p className="text-sm font-semibold text-primary">
                    {priceMinor ? money(priceMinor) : 'Enter a price to see the formatted value'}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="s-mileage">Mileage (km) *</Label>
                  <Input id="s-mileage" inputMode="numeric" placeholder="e.g. 76000" value={form.mileage} onChange={(e) => set('mileage', e.target.value.replace(/[^\d]/g, ''))} />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="s-desc">Description *</Label>
                  <span className={`text-xs ${form.description.trim().length >= 30 ? 'text-primary' : 'text-muted-foreground'}`}>
                    {form.description.trim().length}/30 min
                  </span>
                </div>
                <Textarea
                  id="s-desc"
                  rows={6}
                  placeholder="Describe the condition, service history, why you're selling…"
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                />
                <ListingAssistant
                  facts={{
                    make: form.make,
                    model: form.model,
                    year: Number(form.year) || undefined,
                    mileageKm: Number(form.mileage) || undefined,
                    condition: form.condition,
                    features,
                    notes: form.color ? `Colour: ${form.color}${form.town ? ` · Located in ${form.town}` : ''}` : '',
                  }}
                  onApply={(d) => setDescription(d)}
                />
              </div>

              <div className="space-y-2">
                <Label>Common features (helps AI & buyers)</Label>
                <div className="flex flex-wrap gap-2">
                  {FEATURES.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => toggleFeature(f)}
                      aria-pressed={features.includes(f)}
                      className={`rounded-full border px-3 py-2 text-sm transition-colors ${
                        features.includes(f)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background hover:bg-muted'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Photos ({photos.length}/8)</Label>
                <p className="text-xs text-muted-foreground">Clear, well-lit photos sell faster. Max 5MB each, JPG/PNG/WEBP.</p>
                <div className="flex flex-wrap gap-3">
                  {photos.map((p) => (
                    <div key={p.url} className="group relative h-24 w-32 overflow-hidden rounded-lg border border-border">
                      <img src={p.url} alt="Vehicle photo" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removePhoto(p.url)}
                        aria-label="Remove photo"
                        className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-destructive"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {photos.length < 8 && (
                    <label className="flex h-24 w-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                      {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                      {uploading ? 'Uploading…' : 'Add photos'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        className="sr-only"
                        onChange={(e) => {
                          if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files)
                          e.target.value = ''
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
                <Checkbox
                  className="mt-0.5"
                  checked={form.matchWithDealers}
                  onCheckedChange={(c) => set('matchWithDealers', c === true)}
                />
                <span className="text-sm">
                  <span className="font-medium">Let verified dealers send me offers</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    My contact stays private until I accept an enquiry or offer. Dealers can bid for my car without ever seeing my number.
                  </span>
                </span>
              </label>

              {/* Preview */}
              <div className="rounded-xl border border-border p-4">
                <h3 className="mb-3 text-sm font-semibold">Listing preview</h3>
                <div className="flex gap-4">
                  <div className="flex h-24 w-36 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-xs text-muted-foreground">
                    {photos.length > 0
                      ? <img src={photos[0].url} alt="Listing preview" className="h-full w-full object-cover" />
                      : 'No photo yet'}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-semibold">
                      {form.make || 'Make'} {form.model || 'Model'} {form.year || ''}
                    </p>
                    <p className="font-bold text-primary">{priceMinor ? money(priceMinor) : 'KES not set'}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {form.condition && <Badge variant="secondary">{CONDITION_LABELS[form.condition] ?? form.condition}</Badge>}
                      {form.bodyType && <Badge variant="outline">{form.bodyType.charAt(0) + form.bodyType.slice(1).toLowerCase()}</Badge>}
                      {form.mileage && <Badge variant="outline">{Number(form.mileage).toLocaleString()} km</Badge>}
                      {form.county && <Badge variant="outline">{form.county}</Badge>}
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                By submitting you confirm the details are accurate and you&apos;re authorised to sell this vehicle.
                Listings are checked by our team before going public; the initial review target is 24 business hours.
              </p>
            </div>
          )}

          {/* Nav buttons */}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <div>
              {step > 1 && (
                <Button variant="outline" className="h-11 px-5" onClick={() => setStep((s) => s - 1)}>
                  <ChevronLeft className="h-4 w-4" /> Back
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {step < 3 ? (
                <Button className="h-11 px-6" onClick={next} disabled={!canContinue}>
                  Continue <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="h-11 px-5"
                    disabled={submitting !== null}
                    onClick={() => submit('DRAFT')}
                  >
                    {submitting === 'DRAFT' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save draft
                  </Button>
                  <Button
                    className="h-11 px-6"
                    disabled={submitting !== null}
                    onClick={() => submit('PENDING_REVIEW')}
                  >
                    {submitting === 'PENDING_REVIEW' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Submit for review
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
