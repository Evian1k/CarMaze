'use client'

import { useState } from 'react'
import { FileText, Loader2, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AiDisclaimer, AiPanel } from '@/components/ai/shared'

export type ListingFacts = {
  make?: string
  model?: string
  year?: number
  mileageKm?: number
  condition?: string
  county?: string
  features?: string[]
  notes?: string
}

type Props = {
  facts: ListingFacts
  onApply: (description: string) => void
}

/** AI listing assistant: drafts an honest description strictly from the seller's own details. */
export function ListingAssistant({ facts, onApply }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = Boolean(facts.make?.trim()) && Boolean(facts.model?.trim())

  async function handleDraft() {
    if (loading || !ready) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/listing-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facts }),
      })
      const data = (await res.json().catch(() => null)) as { description?: string; message?: string } | null
      if (!res.ok || !data?.description) {
        throw new Error(data?.message ?? 'Could not draft a description right now. Please try again.')
      }
      setDraft(data.description)
      toast.success('Draft ready — review and edit before using it.')
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
      ariaLabel="AI listing assistant"
      title="AI listing assistant"
      subtitle={ready ? 'Draft an honest description from the details you have entered.' : 'Add the make and model first, then let AI draft your description.'}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={handleDraft}
            disabled={loading || !ready}
            variant="outline"
            className="min-h-11 gap-2 border-primary/30 text-primary hover:bg-primary/5 hover:text-primary"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Drafting…
              </>
            ) : (
              <>
                <WandSparkles className="h-4 w-4 text-accent" aria-hidden="true" />
                Draft description from my details
              </>
            )}
          </Button>
          <AiDisclaimer>Drafts use only the details you provided — review before submitting.</AiDisclaimer>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {draft !== null && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <label htmlFor="ai-listing-draft" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              Draft description — editable
            </label>
            <Textarea
              id="ai-listing-draft"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              maxLength={1500}
              className="resize-y bg-background text-sm"
            />
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => onApply(draft.trim())}
                disabled={draft.trim().length === 0}
                className="min-h-11 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Use this description
              </Button>
            </div>
          </div>
        )}
      </div>
    </AiPanel>
  )
}
