'use client'

// Procurement cart for the Automotive Supply Network.
// A cart may contain products from several suppliers — checkout creates one
// purchase order per supplier. Persisted to localStorage so garages can build
// orders across sessions.

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localGet, localSet } from '@/lib/safe-storage'

export type CartItem = {
  productId: string
  name: string
  sku: string
  unitPriceMinor: number
  wholesalePriceMinor?: number | null
  wholesaleMinQty?: number
  qty: number
  supplierId: string
  supplierName: string
  image?: string | null
  availableQty?: number
}

type CartState = {
  items: CartItem[]
  add: (item: Omit<CartItem, 'qty'>, qty?: number) => void
  setQty: (productId: string, qty: number) => void
  remove: (productId: string) => void
  clear: () => void
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      add: (item, qty = 1) =>
        set((state) => {
          const existing = state.items.find((i) => i.productId === item.productId)
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.productId === item.productId ? { ...i, ...item, qty: i.qty + qty } : i
              ),
            }
          }
          return { items: [...state.items, { ...item, qty }] }
        }),
      setQty: (productId, qty) =>
        set((state) => ({
          items: state.items
            .map((i) => (i.productId === productId ? { ...i, qty: Math.max(0, qty) } : i))
            .filter((i) => i.qty > 0),
        })),
      remove: (productId) => set((state) => ({ items: state.items.filter((i) => i.productId !== productId) })),
      clear: () => set({ items: [] }),
    }),
    {
      name: 'carmaze_procurement_cart',
      storage: createJSONStorage(() => ({
        getItem: (name: string) => localGet(name),
        setItem: (name: string, value: string) => localSet(name, value),
        removeItem: (name: string) => localSet(name, ''),
      })),
    }
  )
)

export function cartLineTotal(item: CartItem): number {
  const useWholesale = Boolean(
    item.wholesalePriceMinor && item.wholesaleMinQty && item.qty >= item.wholesaleMinQty
  )
  const unit = useWholesale ? item.wholesalePriceMinor! : item.unitPriceMinor
  return unit * item.qty
}

export function cartUnitPrice(item: CartItem): number {
  const useWholesale = Boolean(
    item.wholesalePriceMinor && item.wholesaleMinQty && item.qty >= item.wholesaleMinQty
  )
  return useWholesale ? item.wholesalePriceMinor! : item.unitPriceMinor
}

export function cartBySupplier(items: CartItem[]): Map<string, CartItem[]> {
  const map = new Map<string, CartItem[]>()
  for (const item of items) {
    const list = map.get(item.supplierId) ?? []
    list.push(item)
    map.set(item.supplierId, list)
  }
  return map
}
