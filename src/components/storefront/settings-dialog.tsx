'use client'

/* CARMAZE — StorefrontSettingsDialog: for garage/dealer OWNER & MANAGER
 * members, edits the public storefront (cover, gallery, hours, specialities,
 * FAQs, service areas, contact toggles, response time) and PATCHes
 * /api/orgs/storefront?id=<orgId>. The inner form mounts fresh each open. */

import { useState } from 'react'
import { Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { apiSend } from '@/lib/client'
import { DAY_KEYS, DAY_LABELS, type DayKey, type StorefrontData } from './types'

type HoursRow = { closed: boolean; open: string; close: string }

function hoursToRows(hours: StorefrontData['org']['openingHours']): Record<DayKey, HoursRow> {
  const rows = {} as Record<DayKey, HoursRow>
  for (const day of DAY_KEYS) {
    const range = hours[day]
    rows[day] = range ? { closed: false, open: range[0], close: range[1] } : { closed: true, open: '08:00', close: '17:00' }
  }
  return rows
}

export function StorefrontSettingsDialog({
  open, onOpenChange, data, onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: StorefrontData
  onSaved: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit storefront</DialogTitle>
          <DialogDescription>
            Changes publish to your public CARMAZE page immediately.
          </DialogDescription>
        </DialogHeader>
        <SettingsForm org={data.org} onSaved={onSaved} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  )
}

function SettingsForm({
  org, onSaved, onOpenChange,
}: {
  org: StorefrontData['org']
  onSaved: () => void
  onOpenChange: (open: boolean) => void
}) {
  const [coverUrl, setCoverUrl] = useState(org.coverUrl ?? '')
  const [gallery, setGallery] = useState(org.gallery.join(', '))
  const [specialities, setSpecialities] = useState(org.specialities.join(', '))
  const [serviceAreas, setServiceAreas] = useState(org.serviceAreas.join(', '))
  const [faqs, setFaqs] = useState<{ q: string; a: string }[]>(org.faqs.map((f) => ({ q: f.q, a: f.a })))
  const [rows, setRows] = useState<Record<DayKey, HoursRow>>(hoursToRows(org.openingHours))
  const [callEnabled, setCallEnabled] = useState(org.callEnabled)
  const [whatsappEnabled, setWhatsappEnabled] = useState(org.whatsappEnabled)
  const [responseMinutes, setResponseMinutes] = useState(org.responseMinutes ? String(org.responseMinutes) : 'none')
  const [saving, setSaving] = useState(false)

  const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

  function save() {
    // light validation
    for (const day of DAY_KEYS) {
      const row = rows[day]
      if (!row.closed && (!row.open || !row.close)) {
        toast.error(`${DAY_LABELS[day]}: set both times or mark it closed`)
        return
      }
    }
    if (faqs.some((f) => !f.q.trim() || !f.a.trim())) {
      toast.error('Every FAQ needs both a question and an answer')
      return
    }
    setSaving(true)
    apiSend(`/api/orgs/storefront?id=${encodeURIComponent(org.id)}`, 'PATCH', {
      coverUrl: coverUrl.trim() || null,
      gallery: splitList(gallery),
      openingHours: Object.fromEntries(
        DAY_KEYS.map((day) => [day, rows[day].closed ? null : ([rows[day].open, rows[day].close] as [string, string])])
      ),
      specialities: splitList(specialities),
      serviceAreas: splitList(serviceAreas),
      faqs: faqs
        .map((f) => ({ q: f.q.trim(), a: f.a.trim() }))
        .filter((f) => f.q && f.a),
      callEnabled,
      whatsappEnabled,
      responseMinutes: responseMinutes === 'none' ? null : parseInt(responseMinutes, 10),
    })
      .then(() => {
        toast.success('Storefront updated', { description: 'Your public page is refreshed.' })
        onOpenChange(false)
        onSaved()
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not save storefront settings'))
      .finally(() => setSaving(false))
  }

  const timeInputClass =
    'flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <>
      <div className="space-y-5">
        {/* Imagery */}
        <section className="space-y-3" aria-label="Imagery">
          <h3 className="text-sm font-semibold">Imagery</h3>
          <div className="space-y-1.5">
            <Label htmlFor="st-cover">Cover image URL</Label>
            <Input id="st-cover" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-gallery">Gallery image URLs (comma-separated)</Label>
            <Input id="st-gallery" value={gallery} onChange={(e) => setGallery(e.target.value)} placeholder="https://photo-1.jpg, https://photo-2.jpg" />
          </div>
        </section>

        {/* Opening hours */}
        <section className="space-y-2" aria-label="Opening hours">
          <h3 className="text-sm font-semibold">Opening hours (Kenya time)</h3>
          <div className="divide-y rounded-lg border border-border">
            {DAY_KEYS.map((day) => {
              const row = rows[day]
              return (
                <div key={day} className="flex items-center gap-2 px-3 py-2">
                  <span className="w-20 shrink-0 text-sm font-medium">{DAY_LABELS[day].slice(0, 3)}</span>
                  <Switch
                    checked={row.closed}
                    onCheckedChange={(c) => setRows((prev) => ({ ...prev, [day]: { ...prev[day], closed: c } }))}
                    aria-label={`${DAY_LABELS[day]} closed`}
                  />
                  <span className="w-12 text-xs text-muted-foreground">{row.closed ? 'Closed' : 'Open'}</span>
                  <input
                    type="time"
                    className={timeInputClass}
                    value={row.open}
                    disabled={row.closed}
                    aria-label={`${DAY_LABELS[day]} opening time`}
                    onChange={(e) => setRows((prev) => ({ ...prev, [day]: { ...prev[day], open: e.target.value } }))}
                  />
                  <span className="text-xs text-muted-foreground">–</span>
                  <input
                    type="time"
                    className={timeInputClass}
                    value={row.close}
                    disabled={row.closed}
                    aria-label={`${DAY_LABELS[day]} closing time`}
                    onChange={(e) => setRows((prev) => ({ ...prev, [day]: { ...prev[day], close: e.target.value } }))}
                  />
                </div>
              )
            })}
          </div>
        </section>

        {/* Specialities + service areas */}
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Specialities and service areas">
          <div className="space-y-1.5">
            <Label htmlFor="st-spec">Specialities (comma-separated)</Label>
            <Input id="st-spec" value={specialities} onChange={(e) => setSpecialities(e.target.value)} placeholder="Brake overhaul, Diagnostics, AC" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-areas">Service areas (comma-separated)</Label>
            <Input id="st-areas" value={serviceAreas} onChange={(e) => setServiceAreas(e.target.value)} placeholder="Nairobi, Kiambu, Thika" />
          </div>
        </section>

        {/* FAQs */}
        <section className="space-y-2" aria-label="Frequently asked questions">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">FAQs</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              onClick={() => setFaqs((prev) => [...prev, { q: '', a: '' }])}
            >
              <Plus className="h-3.5 w-3.5" /> Add FAQ
            </Button>
          </div>
          {faqs.length === 0 && <p className="text-xs text-muted-foreground">No FAQs yet — add common questions customers ask.</p>}
          <div className="space-y-3">
            {faqs.map((f, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={f.q}
                    onChange={(e) => setFaqs((prev) => prev.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))}
                    placeholder={`Question ${i + 1}`}
                    aria-label={`FAQ ${i + 1} question`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove FAQ ${i + 1}`}
                    onClick={() => setFaqs((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <textarea
                  className="flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={f.a}
                  rows={2}
                  onChange={(e) => setFaqs((prev) => prev.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))}
                  placeholder="Answer"
                  aria-label={`FAQ ${i + 1} answer`}
                />
              </div>
            ))}
          </div>
        </section>

        {/* Contact toggles */}
        <section className="space-y-3" aria-label="Contact preferences">
          <h3 className="text-sm font-semibold">Contact &amp; response time</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <span className="text-sm font-medium">Show call button</span>
              <Switch checked={callEnabled} onCheckedChange={setCallEnabled} aria-label="Call enabled" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <span className="text-sm font-medium">Show WhatsApp button</span>
              <Switch checked={whatsappEnabled} onCheckedChange={setWhatsappEnabled} aria-label="WhatsApp enabled" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Expected response time</Label>
            <Select value={responseMinutes} onValueChange={setResponseMinutes}>
              <SelectTrigger aria-label="Response time"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not stated</SelectItem>
                <SelectItem value="15">~15 minutes</SelectItem>
                <SelectItem value="30">~30 minutes</SelectItem>
                <SelectItem value="60">~1 hour</SelectItem>
                <SelectItem value="120">~2 hours</SelectItem>
                <SelectItem value="240">~4 hours</SelectItem>
                <SelectItem value="480">~8 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>
      </div>

      <DialogFooter>
        <Button variant="ghost" className="h-11" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <Button className="h-11 px-5" onClick={save} disabled={saving}>
          {saving ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Saving…</span> : <><Check className="h-4 w-4" /> Save changes</>}
        </Button>
      </DialogFooter>
    </>
  )
}
