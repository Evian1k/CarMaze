'use client'

/* CARMAZE: HandoverDialog: the Digital Vehicle Handover Record.
 * A 3-step, animated flow for handing a vehicle over to a garage:
 *   1. Vehicle (identity + road-test authorisation)
 *   2. Condition (notes, valuables, up to 6 photos via /api/upload)
 *   3. Work (requested work + optional spending cap) → POST /api/custody
 * The inner form mounts fresh every time the dialog opens. */

import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Camera, CarFront, Check, ImagePlus, Loader2, Trash2, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { apiSend, apiUpload, navigate } from '@/lib/client'
import { useAuth } from '@/stores/auth'
import { SuccessPanel } from './dialogs'

const STEP_TITLES = ['Vehicle', 'Condition', 'Work'] as const
const MAX_PHOTOS = 6
const FUEL_LEVELS = [
  { value: 'EMPTY', label: 'Empty (E)' },
  { value: 'QUARTER', label: '1/4 tank' },
  { value: 'HALF', label: '1/2 tank' },
  { value: 'THREE_QUARTERS', label: '3/4 tank' },
  { value: 'FULL', label: 'Full (F)' },
] as const

const EASE = [0.22, 0.61, 0.36, 1] as const

export function HandoverDialog({
  open, onOpenChange, org, presetWork,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  org: { id: string; name: string }
  presetWork?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-primary" aria-hidden="true" /> Hand over vehicle to {org.name}
          </DialogTitle>
          <DialogDescription>
            Every handover is recorded. The garage must confirm receipt, and collection requires your authorisation code.
          </DialogDescription>
        </DialogHeader>
        <HandoverForm onOpenChange={onOpenChange} org={org} presetWork={presetWork} />
      </DialogContent>
    </Dialog>
  )
}

function HandoverForm({
  onOpenChange, org, presetWork,
}: {
  onOpenChange: (open: boolean) => void
  org: { id: string; name: string }
  presetWork?: string
}) {
  const user = useAuth((s) => s.user)
  const [step, setStep] = useState(0)
  const [sending, setSending] = useState(false)
  const [doneRef, setDoneRef] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const [vehicleDesc, setVehicleDesc] = useState('')
  const [plate, setPlate] = useState('')
  const [odometerKm, setOdometerKm] = useState('')
  const [fuelLevel, setFuelLevel] = useState('HALF')
  const [roadTestAllowed, setRoadTestAllowed] = useState(true)
  const [conditionNotes, setConditionNotes] = useState('')
  const [valuables, setValuables] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [requestedWork, setRequestedWork] = useState(presetWork ?? '')
  const [spendCap, setSpendCap] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function validateStep(): string | null {
    if (step === 0) {
      if (vehicleDesc.trim().length < 4) return 'Describe the vehicle (make, model, year…)'
    }
    if (step === 2) {
      if (requestedWork.trim().length < 5) return 'Describe the work you are authorising'
      if (spendCap.trim() && (!/^\d+$/.test(spendCap.trim()) || parseInt(spendCap, 10) < 100)) return 'Spending cap must be a KES amount of at least 100'
    }
    return null
  }

  function next() {
    const err = validateStep()
    if (err) { toast.error(err); return }
    setStep((s) => Math.min(2, s + 1))
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const room = MAX_PHOTOS - photos.length
    if (room <= 0) { toast.error(`Up to ${MAX_PHOTOS} photos`); return }
    const list = Array.from(files).slice(0, room)
    setUploading(true)
    const uploaded: string[] = []
    for (const file of list) {
      if (file.size > 8 * 1024 * 1024) { toast.error(`${file.name} is over 8 MB: skipped`); continue }
      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('kind', 'evidence') // custody handover photos: private, participants only
        const res = await apiUpload<{ url: string }>('/api/upload', fd)
        if (res?.url) uploaded.push(res.url)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not upload ${file.name}`)
      }
    }
    setUploading(false)
    if (uploaded.length > 0) {
      setPhotos((prev) => [...prev, ...uploaded].slice(0, MAX_PHOTOS))
      toast.success(`${uploaded.length} photo${uploaded.length > 1 ? 's' : ''} added`)
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  function submit() {
    const err = validateStep()
    if (err) { toast.error(err); return }
    if (!user) {
      toast.info('Sign in to hand over your vehicle', { description: 'The handover record is tied to your account so only you can authorise collection.' })
      navigate('signin')
      return
    }
    setSending(true)
    apiSend<{ custody: { refCode: string } }>('/api/custody', 'POST', {
      orgId: org.id,
      vehicleDesc: vehicleDesc.trim(),
      plate: plate.trim() || undefined,
      odometerKm: odometerKm.trim() ? parseInt(odometerKm.replace(/[^\d]/g, ''), 10) || undefined : undefined,
      fuelLevel: fuelLevel || undefined,
      conditionNotes: conditionNotes.trim() || undefined,
      photos: photos.length > 0 ? photos : undefined,
      valuables: valuables.trim() || undefined,
      requestedWork: requestedWork.trim(),
      roadTestAllowed,
      ...(spendCap.trim() ? { authorisedSpendMinor: parseInt(spendCap, 10) * 100 } : {}),
    })
      .then((d) => {
        setDoneRef(d.custody?.refCode ?? null)
        toast.success('Handover recorded')
      })
      .catch((e) => {
        if (typeof e === 'object' && e !== null && 'status' in e && (e as { status?: number }).status === 401) {
          toast.info('Sign in to hand over your vehicle')
          navigate('signin')
          return
        }
        toast.error(e instanceof Error ? e.message : 'Could not record the handover')
      })
      .finally(() => setSending(false))
  }

  if (doneRef) {
    return (
      <SuccessPanel
        refCode={doneRef}
        title="Vehicle handover recorded"
        body="The garage has been asked to confirm receipt. Track it in Account → Vehicle Protection; collection requires your authorisation code."
      >
        <Button onClick={() => navigate('account?tab=protection')}>Track in Vehicle Protection</Button>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
      </SuccessPanel>
    )
  }

  const progressPct = ((step + 1) / 3) * 100

  return (
    <>
      {/* Animated progress */}
      <div className="space-y-2" aria-label={`Step ${step + 1} of 3`}>
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          {STEP_TITLES.map((t, i) => (
            <span key={t} className={`flex items-center gap-1.5 ${i === step ? 'text-foreground' : ''}`} aria-current={i === step ? 'step' : undefined}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${i < step ? 'bg-primary text-primary-foreground' : i === step ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {t}
            </span>
          ))}
        </div>
        <Progress value={progressPct} className="h-1.5" aria-hidden="true" />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -28 }}
          transition={{ duration: 0.28, ease: EASE }}
          className="space-y-4"
        >
          {step === 0 && (
            <section aria-label="Vehicle details" className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="hv-vehicle">Vehicle description *</Label>
                <Input id="hv-vehicle" value={vehicleDesc} onChange={(e) => setVehicleDesc(e.target.value)} placeholder="e.g. Toyota Axio 2015, silver" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="hv-plate">Number plate (optional)</Label>
                  <Input id="hv-plate" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="KDA 123A" className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hv-odo">Odometer (km, optional)</Label>
                  <Input id="hv-odo" inputMode="numeric" value={odometerKm} onChange={(e) => setOdometerKm(e.target.value.replace(/[^\d]/g, ''))} placeholder="e.g. 84500" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Fuel level</Label>
                <Select value={fuelLevel} onValueChange={setFuelLevel}>
                  <SelectTrigger aria-label="Fuel level"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FUEL_LEVELS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Road test authorisation</p>
                  <p className="text-xs text-muted-foreground">I authorise road tests for diagnostic/repair purposes.</p>
                </div>
                <Switch checked={roadTestAllowed} onCheckedChange={setRoadTestAllowed} aria-label="Authorise road tests" />
              </div>
            </section>
          )}

          {step === 1 && (
            <section aria-label="Vehicle condition" className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="hv-notes">Condition notes</Label>
                <Textarea id="hv-notes" rows={3} value={conditionNotes} onChange={(e) => setConditionNotes(e.target.value)} placeholder="Existing scratches, dents, warning lights, known issues…" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hv-valuables">Valuables left in the vehicle (optional)</Label>
                <Input id="hv-valuables" value={valuables} onChange={(e) => setValuables(e.target.value)} placeholder="e.g. JBL subwoofer, toolbox in boot" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Photos ({photos.length}/{MAX_PHOTOS})</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5"
                    disabled={photos.length >= MAX_PHOTOS || uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Add photos
                  </Button>
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => uploadFiles(e.target.files)} aria-label="Upload condition photos" />
                </div>
                {photos.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    <AnimatePresence initial={false}>
                      {photos.map((url) => (
                        <motion.div
                          key={url}
                          layout
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.2, ease: EASE }}
                          className="group relative aspect-square overflow-hidden rounded-md border border-border"
                        >
                          <img src={url} alt="Handover condition photo" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setPhotos((prev) => prev.filter((p) => p !== url))}
                            aria-label="Remove photo"
                            className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="flex h-20 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-60"
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    {uploading ? 'Uploading…' : 'Tap to add up to 6 condition photos'}
                  </button>
                )}
                <p className="text-xs text-muted-foreground">Photos timestamp the condition at handover; they protect both you and the garage.</p>
              </div>
            </section>
          )}

          {step === 2 && (
            <section aria-label="Requested work" className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="hv-work">Work requested *</Label>
                <Textarea id="hv-work" rows={3} value={requestedWork} onChange={(e) => setRequestedWork(e.target.value)} placeholder="Describe the work you are authorising; the garage quotes before starting anything extra." />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hv-cap">Spending cap in KES (optional)</Label>
                <Input
                  id="hv-cap"
                  inputMode="numeric"
                  value={spendCap}
                  onChange={(e) => setSpendCap(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="e.g. 15000"
                />
                <p className="text-xs text-muted-foreground">Spending cap: the garage must get your approval above this amount.</p>
              </div>

              {/* Review summary */}
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <p className="mb-2 flex items-center gap-1.5 font-semibold"><CarFront className="h-4 w-4 text-primary" aria-hidden="true" /> Review your handover</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                  <dt className="text-muted-foreground">Vehicle</dt><dd className="font-medium">{vehicleDesc || 'Not provided'}{plate ? ` · ${plate}` : ''}</dd>
                  <dt className="text-muted-foreground">Odometer</dt><dd>{odometerKm ? `${parseInt(odometerKm, 10).toLocaleString()} km` : 'Not provided'} · {FUEL_LEVELS.find((f) => f.value === fuelLevel)?.label ?? 'Not provided'}</dd>
                  <dt className="text-muted-foreground">Road tests</dt><dd>{roadTestAllowed ? 'Authorised for diagnostics' : 'Not authorised'}</dd>
                  <dt className="text-muted-foreground">Photos</dt><dd>{photos.length} attached</dd>
                  <dt className="text-muted-foreground">Cap</dt><dd>{spendCap ? `KES ${parseInt(spendCap, 10).toLocaleString()}` : 'No cap set'}</dd>
                </dl>
              </div>
            </section>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Nav */}
      <div className="flex items-center justify-between gap-2 pt-1">
        {step > 0 ? (
          <Button variant="ghost" className="h-11" onClick={() => setStep((s) => s - 1)} disabled={sending}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        ) : (
          <span />
        )}
        {step < 2 ? (
          <Button className="h-11 px-5" onClick={next}>
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button className="h-11 px-5" onClick={submit} disabled={sending}>
            {sending ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Recording…</span>
            ) : (
              'Confirm handover'
            )}
          </Button>
        )}
      </div>
    </>
  )
}
