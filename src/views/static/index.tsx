'use client'

/* Static informational views: about/contact (with real support tickets),
 * FAQ (from SystemSetting), terms, privacy, trust & safety. */

import { useEffect, useState } from 'react'
import { useHashRoute } from '@/hooks/use-hash-route'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Textarea } from '@/components/ui/textarea'
import { apiGet, apiSend, navigate } from '@/lib/client'
import { Contact, FileText, LifeBuoy, Mail, MapPin, Phone, ShieldCheck } from 'lucide-react'

type Faq = { q: string; a: string }
type ContactInfo = { email: string; phone: string; location: string; hours: string }

const VIEWS = ['about', 'faq', 'terms', 'privacy', 'safety'] as const

function validInfoView(v: string | null): string | null {
  return v && VIEWS.includes(v as (typeof VIEWS)[number]) ? v : null
}

export default function StaticView() {
  const route = useHashRoute()
  // Derive the view from the hash; local override handles immediate clicks.
  const queryView = validInfoView(route.query.get('view'))
  const [override, setOverride] = useState<string | null>(null)
  const view = queryView ?? override ?? 'about'
  const [faqs, setFaqs] = useState<Faq[] | null>(null)
  const [contact, setContact] = useState<ContactInfo | null>(null)

  useEffect(() => {
    apiGet<{ faqs: Faq[] }>('/api/settings/faqs').then((d) => setFaqs(d.faqs)).catch(() => setFaqs([]))
    apiGet<{ contact: ContactInfo }>('/api/settings/contact').then((d) => setContact(d.contact)).catch(() => {})
  }, [])

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <nav className="mb-8 flex flex-wrap gap-2" aria-label="Information pages">
        {[
          { key: 'about', label: 'About & Contact' },
          { key: 'faq', label: 'FAQ' },
          { key: 'terms', label: 'Terms of Service' },
          { key: 'privacy', label: 'Privacy Policy' },
          { key: 'safety', label: 'Trust & Safety' },
        ].map((t) => (
          <Button key={t.key} size="sm" variant={view === t.key ? 'default' : 'outline'} onClick={() => { setOverride(t.key); navigate(`info?view=${t.key}`, { replace: true }) }}>
            {t.label}
          </Button>
        ))}
      </nav>

      {view === 'about' && <About contact={contact} />}
      {view === 'faq' && (
        <section aria-labelledby="faq-title">
          <h1 id="faq-title" className="text-2xl font-bold">Frequently asked questions</h1>
          <p className="mt-1 text-sm text-muted-foreground">Straight answers about how CARMAZE works during the Kenyan pilot.</p>
          <div className="mt-6">
            {faqs === null ? null : faqs.length === 0 ? (
              <p className="text-sm text-muted-foreground">FAQs are being prepared. Contact us directly with any question.</p>
            ) : (
              <Accordion type="single" collapsible className="w-full">
                {faqs.map((f, i) => (
                  <AccordionItem key={i} value={`item-${i}`}>
                    <AccordionTrigger className="text-left">{f.q}</AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </div>
        </section>
      )}
      {view === 'terms' && <Terms />}
      {view === 'privacy' && <Privacy />}
      {view === 'safety' && <Safety />}
    </div>
  )
}

function About({ contact }: { contact: ContactInfo | null }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [ref, setRef] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const d = await apiSend<{ ticket: { refCode: string } }>('/api/support', 'POST', { name, email, subject, message })
      setRef(d.ticket.refCode)
      toast.success(`Support ticket ${d.ticket.refCode} created — we will reply by email.`)
      setName(''); setEmail(''); setSubject(''); setMessage('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send message')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold">About CARMAZE</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          CARMAZE is a Kenyan automotive ecosystem connecting buyers, private sellers, verified dealerships, garages and roadside
          providers. We combine a trusted marketplace with real operational tools — dealer onboarding with follow-up, a 3D
          customizer connected to garage quoting, and ownership records that stay with the car.
        </p>
      </section>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-start gap-3 p-4">
          <Mail className="mt-0.5 h-4 w-4 text-primary" /><div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="text-sm font-medium">{contact?.email ?? 'support@carmaze.co.ke'}</p>
          </div>
        </CardContent></Card>
        <Card><CardContent className="flex items-start gap-3 p-4">
          <Phone className="mt-0.5 h-4 w-4 text-primary" /><div>
            <p className="text-xs text-muted-foreground">Phone</p>
            <p className="text-sm font-medium">{contact?.phone ?? '+254 700 000 000'}</p>
          </div>
        </CardContent></Card>
        <Card><CardContent className="flex items-start gap-3 p-4">
          <MapPin className="mt-0.5 h-4 w-4 text-primary" /><div>
            <p className="text-xs text-muted-foreground">Office</p>
            <p className="text-sm font-medium">{contact?.location ?? 'Nairobi, Kenya'}</p>
            <p className="text-xs text-muted-foreground">{contact?.hours ?? 'Mon–Sat, 8am–6pm EAT'}</p>
          </div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contact &amp; support</CardTitle>
          <CardDescription>Send us a message and we&apos;ll reply to your email. You&apos;ll receive a ticket reference.</CardDescription>
        </CardHeader>
        <CardContent>
          {ref && (
            <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              Ticket <strong className="font-mono">{ref}</strong> created. Keep the reference for follow-up.
            </div>
          )}
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Your name</Label>
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-subject">Subject</Label>
              <Input id="c-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-msg">Message</Label>
              <Textarea id="c-msg" value={message} onChange={(e) => setMessage(e.target.value)} required minLength={10} rows={5} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function Terms() {
  return (
    <article className="prose-sm space-y-4 text-sm leading-relaxed text-muted-foreground">
      <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><FileText className="h-6 w-6 text-primary" /> Terms of Service</h1>
      <p><em className="text-xs">Pilot version — subject to legal review before commercial launch. Last updated: {new Date().toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })}</em></p>
      <h2 className="pt-2 font-semibold text-foreground">1. What CARMAZE does</h2>
      <p>CARMAZE provides a platform for advertising and discovering vehicles, requesting automotive services and connecting with dealerships and garages in Kenya. We are not a party to any sale between buyers and sellers.</p>
      <h2 className="pt-2 font-semibold text-foreground">2. Vehicle transactions</h2>
      <p>CARMAZE does not hold buyer funds, provide escrow, or guarantee any vehicle. Payment and transfer arrangements are made directly between buyers and sellers. Always inspect a vehicle and verify documents before paying.</p>
      <h2 className="pt-2 font-semibold text-foreground">3. Accounts and listings</h2>
      <p>You must provide accurate information. Listings must describe the actual vehicle being offered. We may remove listings, request corrections, or restrict accounts that breach these terms, mislead buyers, or compromise platform safety. Verification badges are granted only after a documented review.</p>
      <h2 className="pt-2 font-semibold text-foreground">4. Fees</h2>
      <p>Private vehicle listings are free during the pilot. Dealer and garage subscriptions and paid promotions are billed in advance (M-Pesa where configured). We do not charge a commission on vehicle sales during the pilot; any future transaction fee requires a separately signed agreement.</p>
      <h2 className="pt-2 font-semibold text-foreground">5. Services marketplace</h2>
      <p>Quotes and bookings made through CARMAZE are contracts between you and the garage. Garages are independently owned businesses. CARMAZE roadside assistance is a connection service — it is not an emergency service. In an emergency, call 999 or 112.</p>
      <h2 className="pt-2 font-semibold text-foreground">6. Community conduct</h2>
      <p>Be honest and respectful. No impersonation, spam, fake reviews, or misleading verification claims. Sponsored content must be labelled and is moderated.</p>
      <h2 className="pt-2 font-semibold text-foreground">7. Liability</h2>
      <p>To the extent permitted by Kenyan law, CARMAZE is not liable for indirect losses arising from transactions or services arranged through the platform.</p>
      <h2 className="pt-2 font-semibold text-foreground">8. Contact</h2>
      <p>Questions about these terms: support@carmaze.co.ke.</p>
    </article>
  )
}

function Privacy() {
  return (
    <article className="prose-sm space-y-4 text-sm leading-relaxed text-muted-foreground">
      <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><ShieldCheck className="h-6 w-6 text-primary" /> Privacy Policy</h1>
      <p><em className="text-xs">Pilot version — prepared with Kenyan Data Protection Act (2019) principles in mind; subject to legal review.</em></p>
      <h2 className="pt-2 font-semibold text-foreground">What we collect</h2>
      <p>Account details (name, email, optional phone), listing and enquiry content, garage and ownership records you choose to store, verification documents submitted during dealer/garage onboarding, and technical logs needed to run the service.</p>
      <h2 className="pt-2 font-semibold text-foreground">How we use it</h2>
      <p>To operate the marketplace, deliver notifications, verify businesses, personalise saved searches, and keep the platform safe. We do not sell personal data.</p>
      <h2 className="pt-2 font-semibold text-foreground">What stays private</h2>
      <p>Verification documents are stored privately and are only accessible to you and authorised CARMAZE reviewers. Your phone number is only shared with a counterparty when you explicitly choose to include it in an enquiry or accept an offer. My Garage records are private by default.</p>
      <h2 className="pt-2 font-semibold text-foreground">Your rights</h2>
      <p>You can access, correct or delete your personal data by contacting support@carmaze.co.ke. We retain transaction and audit records where required by law.</p>
      <h2 className="pt-2 font-semibold text-foreground">Security</h2>
      <p>Passwords are stored hashed; sessions use httpOnly cookies; uploads are validated and size-limited; financial records are append-only with audit trails.</p>
    </article>
  )
}

function Safety() {
  return (
    <article className="space-y-5 text-sm leading-relaxed text-muted-foreground">
      <h1 className="text-2xl font-bold text-foreground">Trust &amp; safety</h1>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">Verification is earned, not bought</h2>
        <p className="mt-1">Every dealership and garage submits business registration, location and representative details. Our review team verifies documents before a &quot;Verified&quot; badge appears. Badges are never sold and are never automatic subscription perks.</p>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">Safe payment practices</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>CARMAZE never asks you to pay a &quot;release fee&quot; or &quot;customs fee&quot; to receive a vehicle.</li>
          <li>Inspect any vehicle in person (or via a trusted agent) before paying.</li>
          <li>Verify registration documents against the physical number plate and logbook.</li>
          <li>Be wary of prices far below market value and of sellers pressuring urgent payment.</li>
          <li>Report suspicious listings or messages using the Report action — every report is reviewed by our team.</li>
        </ul>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">Roadside assistance disclaimer</h2>
        <p className="mt-1">CARMAZE connects you with independent roadside providers and is not an emergency authority. For police, ambulance or fire emergencies, always call 999 or 112 first. We do not claim live GPS tracking or guaranteed arrival times.</p>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">Reporting &amp; moderation</h2>
        <p className="mt-1">Listings, posts, comments and users can be reported. Reports enter a moderation queue with a documented resolution. Repeated violations lead to warnings, restrictions and suspension with an appeal path.</p>
      </section>
    </article>
  )
}
