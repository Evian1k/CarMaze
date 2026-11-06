'use client'

/* "Become a supplier" application dialog: POST /api/suppliers.
 * Requires sign-in (register mode). Supporting documents are uploaded via
 * POST /api/upload (FormData, field "file") and attached to the application.
 * On success the API's message is shown verbatim: applications are reviewed
 * by the verification team: a supplier is NEVER auto-verified.
 */

import { useEffect, useRef, useState } from 'react'
import { FileText, Loader2, Upload, X, ShieldCheck, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiSend, apiUpload, navigate } from '@/lib/client'
import { KENYA_COUNTIES } from '@/lib/format'
import { useAuth } from '@/stores/auth'

type UploadedDoc = { name: string; url: string }

type ApplyResponse = {
  application: { id: string; refCode: string; status: string }
  message: string
}

export function BecomeSupplierDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [orgName, setOrgName] = useState('')
  const [regNo, setRegNo] = useState('')
  const [county, setCounty] = useState('Nairobi')
  const [town, setTown] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [representative, setRepresentative] = useState('')
  const [categories, setCategories] = useState('')
  const [description, setDescription] = useState('')
  const [consent, setConsent] = useState(false)
  const [documents, setDocuments] = useState<UploadedDoc[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ApplyResponse | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  function resetForm() {
    setOrgName(''); setRegNo(''); setCounty('Nairobi'); setTown(''); setAddress('')
    setPhone(''); setEmail(''); setRepresentative(''); setCategories(''); setDescription('')
    setConsent(false); setDocuments([]); setResult(null); setFormError(null)
  }

  /* Gate: applications require an account. Whatever opens the dialog, a
   * signed-out visitor is sent straight to registration instead. */
  useEffect(() => {
    if (open && !user) {
      onOpenChange(false)
      toast.info('Create a free account first: business applications are tied to it')
      navigate('signin?mode=register')
    }
  }, [open, user, onOpenChange])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const room = 8 - documents.length
    if (room <= 0) {
      toast.error('Up to 8 documents per application')
      return
    }
    setUploading(true)
    for (const file of Array.from(files).slice(0, room)) {
      const fd = new FormData()
      fd.set('file', file)
      try {
        const res = await apiUpload<{ url: string; name: string }>('/api/upload', fd)
        setDocuments((d) => [...d, { name: file.name, url: res.url }])
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not upload ${file.name}`)
      }
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function valid(): string | null {
    if (orgName.trim().length < 3) return 'Enter the registered business name (at least 3 characters).'
    if (phone.trim().length < 9) return 'Enter a reachable phone number.'
    if (representative.trim().length < 2) return 'Enter the name of the contact representative.'
    if (!consent) return 'Please confirm the declaration to submit.'
    return null
  }

  function submit() {
    const problem = valid()
    if (problem) {
      setFormError(problem)
      toast.error(problem)
      return
    }
    setFormError(null)
    setSubmitting(true)
    apiSend<ApplyResponse>('/api/suppliers', 'POST', {
      orgName: orgName.trim(),
      regNo: regNo.trim() || undefined,
      county,
      town: town.trim() || undefined,
      physicalAddress: address.trim() || undefined,
      phone: phone.trim(),
      email: email.trim() || undefined,
      representative: representative.trim(),
      categories: categories.trim() || undefined,
      description: description.trim() || undefined,
      documents,
      consent: true,
    })
      .then((d) => {
        setResult(d)
        toast.success(`Application ${d.application.refCode} submitted`)
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : 'Could not submit application')
      })
      .finally(() => setSubmitting(false))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetForm()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /> Become a supplier
          </DialogTitle>
          <DialogDescription>
            Join the Automotive Supply Network. Our verification team reviews business registration documents before
            any supplier is verified: approval is never automatic.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-2 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <p className="font-semibold">Application {result.application.refCode} submitted</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{result.message}</p>
            </div>
            <DialogFooter className="justify-center sm:justify-center">
              <Button onClick={() => { resetForm(); onOpenChange(false) }}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="sup-org">Registered business name *</Label>
                <Input id="sup-org" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Nairobi Auto Spares Ltd" maxLength={120} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-reg">Registration no.</Label>
                <Input id="sup-reg" value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="e.g. C.123456" maxLength={60} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-county">County *</Label>
                <Select value={county} onValueChange={setCounty}>
                  <SelectTrigger id="sup-county"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-town">Town / area</Label>
                <Input id="sup-town" value={town} onChange={(e) => setTown(e.target.value)} placeholder="e.g. Industrial Area" maxLength={60} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-address">Physical address</Label>
                <Input id="sup-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street / building" maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-phone">Phone *</Label>
                <Input id="sup-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+254 7XX XXX XXX" maxLength={20} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-email">Email</Label>
                <Input id="sup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="business@example.com" maxLength={120} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="sup-rep">Contact representative *</Label>
                <Input id="sup-rep" value={representative} onChange={(e) => setRepresentative(e.target.value)} placeholder="Full name of the person we will talk to" maxLength={80} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="sup-cats">Supply categories</Label>
                <Input
                  id="sup-cats"
                  value={categories}
                  onChange={(e) => setCategories(e.target.value)}
                  placeholder="Comma separated: e.g. Filters, Brake parts, Lubricants, Tyres"
                  maxLength={300}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="sup-desc">About the business</Label>
                <Textarea
                  id="sup-desc"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What you stock, brands carried, warehouses, delivery coverage…"
                  maxLength={2000}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Supporting documents (registration cert, permits: JPG, PNG, WebP or PDF, up to 8)</Label>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                    multiple
                    className="sr-only"
                    id="sup-docs"
                    onChange={(e) => void handleFiles(e.target.files)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 gap-1.5"
                    disabled={uploading || documents.length >= 8}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                    {uploading ? 'Uploading…' : 'Attach documents'}
                  </Button>
                  <span className="text-xs text-muted-foreground">{documents.length}/8 attached</span>
                </div>
                {documents.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {documents.map((doc, i) => (
                      <li key={`${doc.url}-${i}`} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <a href={doc.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{doc.name}</a>
                        <button
                          onClick={() => setDocuments((d) => d.filter((_, idx) => idx !== i))}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={`Remove ${doc.name}`}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-muted/60 p-3 text-sm" htmlFor="sup-consent">
              <Checkbox
                id="sup-consent"
                checked={consent}
                onCheckedChange={(v) => setConsent(v === true)}
                className="mt-0.5"
              />
              <span>
                I confirm the details above are true and I am authorised to apply on behalf of this business. I
                understand verification requires document review and is never automatic.
              </span>
            </label>

            {formError && <p className="text-sm text-destructive">{formError}</p>}

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={submit} disabled={submitting} className="gap-1.5">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {submitting ? 'Submitting…' : 'Submit application'}
              </Button>
            </DialogFooter>
            <p className="text-center text-xs text-muted-foreground">
              Applying as <Badge variant="secondary">{user?.email ?? 'your account'}</Badge>: sign in required
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
