'use client'

import { useState } from 'react'
import { Loader2, Stethoscope } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AiDisclaimer, AiPanel } from '@/components/ai/shared'

type CategoryChip = { category: string; label: string }

type Props = {
  onSelect: (category: string) => void
}

/** AI garage assistant: turns symptom descriptions into guidance + service categories. */
export function GarageAssistant({ onSelect }: Props) {
  const [symptoms, setSymptoms] = useState('')
  const [guidance, setGuidance] = useState<string | null>(null)
  const [chips, setChips] = useState<CategoryChip[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGuidance() {
    const text = symptoms.trim()
    if (loading) return
    if (text.length < 5) {
      setError('Describe the problem in a few more words (at least 5 characters).')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/garage-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symptoms: text }),
      })
      const data = (await res.json().catch(() => null)) as
        | { guidance?: string; categoryLabels?: CategoryChip[]; message?: string }
        | null
      if (!res.ok || !data?.guidance) {
        throw new Error(data?.message ?? 'Could not get guidance right now. Please try again.')
      }
      setGuidance(data.guidance)
      setChips(Array.isArray(data.categoryLabels) ? data.categoryLabels : [])
      toast.success('Guidance ready: pick a service below to continue.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong. Please try again.'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AiPanel
      ariaLabel="AI garage assistant"
      title="Describe the problem: we'll point you to the right service"
      subtitle="Tell us what your car is doing (or not doing) and we'll suggest where to start."
    >
      <div className="flex flex-col gap-3">
        <Textarea
          value={symptoms}
          onChange={(e) => setSymptoms(e.target.value)}
          maxLength={600}
          rows={3}
          aria-label="Describe the vehicle problem"
          placeholder="e.g. Steering wheel vibrates above 80 km/h and the car pulls slightly right"
          className="resize-none bg-background"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            onClick={handleGuidance}
            disabled={loading || symptoms.trim().length < 5}
            className="min-h-11 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Thinking…
              </>
            ) : (
              <>
                <Stethoscope className="h-4 w-4" aria-hidden="true" />
                Get guidance
              </>
            )}
          </Button>
          <AiDisclaimer>
            General guidance only: not a mechanical diagnosis. Safety concerns: see a professional immediately.
          </AiDisclaimer>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {guidance !== null && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4" aria-live="polite">
            <p className="text-sm leading-relaxed text-foreground">{guidance}</p>
            {chips.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">Suggested services:</p>
                <div className="flex flex-wrap gap-2">
                  {chips.map((chip) => (
                    <Button
                      key={chip.category}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onSelect(chip.category)}
                      className="min-h-9 gap-1.5 border-accent/50 bg-accent/10 text-accent-foreground hover:bg-accent/20 hover:text-accent-foreground"
                      aria-label={`Continue with ${chip.label}`}
                    >
                      {chip.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AiPanel>
  )
}
