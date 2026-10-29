'use client'

import { useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AiDisclaimer, AiPanel } from '@/components/ai/shared'
import type { VehicleCardData } from '@/components/marketplace/vehicle-card'

type Props = {
  onResults: (vehicles: VehicleCardData[], message: string) => void
}

/** AI car-finder: turns a free-text buyer description into real published listings. */
export function AiCarFinder({ onResults }: Props) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFind() {
    const text = query.trim()
    if (loading) return
    if (text.length < 5) {
      setError('Describe what you need in a few more words (at least 5 characters).')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/car-finder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text }),
      })
      const data = (await res.json().catch(() => null)) as
        | { message?: string; vehicles?: VehicleCardData[] }
        | { error: string; message?: string }
        | null
      if (!res.ok || !data || !Array.isArray((data as { vehicles?: unknown }).vehicles)) {
        const msg = data && 'message' in data && data.message ? data.message : 'Could not search right now. Please try again.'
        throw new Error(msg)
      }
      const vehicles = (data as { vehicles: VehicleCardData[] }).vehicles
      const message = (data as { message?: string }).message ?? 'Here is what I found for you.'
      onResults(vehicles, message)
      if (vehicles.length > 0) {
        toast.success(`Found ${vehicles.length} matching ${vehicles.length === 1 ? 'listing' : 'listings'}`)
      } else {
        toast.message('No exact matches yet — try widening the budget or body type.')
      }
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
      ariaLabel="AI car finder"
      title="Not sure what to search? Describe your perfect car"
      subtitle="Tell us your budget, size and use case in plain words — we'll find real listings for you."
    >
      <div className="flex flex-col gap-3">
        <Textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={600}
          rows={2}
          aria-label="Describe the car you are looking for"
          placeholder="e.g. Family SUV under 4M for weekend trips around Nairobi, automatic"
          className="min-h-[64px] resize-none bg-background"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            onClick={handleFind}
            disabled={loading || query.trim().length < 5}
            className="min-h-11 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Searching…
              </>
            ) : (
              <>
                <Search className="h-4 w-4" aria-hidden="true" />
                Find cars
              </>
            )}
          </Button>
          <AiDisclaimer>
            Results come from live CARMAZE listings only — we never invent vehicles or prices.
          </AiDisclaimer>
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </AiPanel>
  )
}
