'use client'

/* Saved supply items (products & suppliers) — backed by /api/supply/saved.
 * Hydrates once per session for signed-in users; toggles optimistically and
 * reverts on failure. Signed-out users are sent to sign-in, never silently
 * failed.
 */

import { create } from 'zustand'
import { apiGet, apiSend, navigate } from '@/lib/client'
import { toast } from 'sonner'

export type SavedTargetType = 'PRODUCT' | 'SUPPLIER'

type SavedState = {
  products: Record<string, true>
  suppliers: Record<string, true>
  hydrated: boolean
  hydrating: boolean
  hydrate: () => Promise<void>
  reset: () => void
  /** Returns the resulting saved state, or null when the toggle failed. */
  toggle: (targetType: SavedTargetType, targetId: string, label?: string) => Promise<boolean | null>
  isSaved: (targetType: SavedTargetType, targetId: string) => boolean
}

export const useSavedSupply = create<SavedState>()((set, get) => ({
  products: {},
  suppliers: {},
  hydrated: false,
  hydrating: false,

  hydrate: async () => {
    if (get().hydrated || get().hydrating) return
    set({ hydrating: true })
    try {
      const data = await apiGet<{ suppliers: { id: string }[]; products: { id: string }[] }>('/api/supply/saved')
      const products: Record<string, true> = {}
      const suppliers: Record<string, true> = {}
      for (const p of data.products ?? []) products[p.id] = true
      for (const s of data.suppliers ?? []) suppliers[s.id] = true
      set({ products, suppliers, hydrated: true, hydrating: false })
    } catch {
      // 401 or network issue — treat as not-signed-in state; toggles will prompt.
      set({ hydrated: true, hydrating: false })
    }
  },

  reset: () => set({ products: {}, suppliers: {}, hydrated: false, hydrating: false }),

  isSaved: (targetType, targetId) =>
    Boolean(targetType === 'PRODUCT' ? get().products[targetId] : get().suppliers[targetId]),

  toggle: async (targetType, targetId, label) => {
    const saved = get().isSaved(targetType, targetId)
    const next = !saved
    const flip = (map: Record<string, true>, add: boolean): Record<string, true> => {
      const copy = { ...map }
      if (add) copy[targetId] = true
      else delete copy[targetId]
      return copy
    }
    // optimistic flip
    if (targetType === 'PRODUCT') set((s) => ({ products: flip(s.products, next) }))
    else set((s) => ({ suppliers: flip(s.suppliers, next) }))
    try {
      if (next) {
        await apiSend('/api/supply/saved', 'POST', { targetType, targetId })
        toast.success(label ? `Saved ${label}` : 'Saved')
      } else {
        await apiSend(`/api/supply/saved?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`, 'DELETE')
        toast.success(label ? `Removed ${label} from saved` : 'Removed from saved')
      }
      return next
    } catch (e) {
      // revert
      if (targetType === 'PRODUCT') set((s) => ({ products: flip(s.products, saved) }))
      else set((s) => ({ suppliers: flip(s.suppliers, saved) }))
      const status = (e as { status?: number }).status
      if (status === 401) {
        toast.info('Sign in to save parts and suppliers')
        navigate('signin')
      } else {
        toast.error(e instanceof Error ? e.message : 'Could not update saved items')
      }
      return null
    }
  },
}))
