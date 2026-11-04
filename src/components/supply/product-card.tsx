'use client'

/* Product card for the Automotive Supply Network marketplace.
 * Shows real data only: verified badge when (and only when) the supplier is
 * verified, authenticity badge only when the platform flagged the product,
 * honest stock state, wholesale note with its minimum quantity.
 */

import { useState } from 'react'
import { Bookmark, BookmarkCheck, ShoppingCart, Package, BadgeCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { money } from '@/lib/format'
import { navigate } from '@/lib/client'
import { useCart } from '@/stores/cart'
import { useSavedSupply } from '@/components/supply/saved-store'
import { useAuth } from '@/stores/auth'
import {
  SUPPLY_CONDITION_LABELS,
  Stars,
  StockStatus,
  SupplierAvatar,
  VerifiedTick,
  type CatalogueProduct,
} from '@/components/supply/shared'
import { cn } from '@/lib/utils'

/** Build a procurement-cart line item from any catalogue-shaped product. */
export function cartItemFromProduct(p: CatalogueProduct) {
  return {
    productId: p.id,
    name: p.name,
    sku: p.sku,
    unitPriceMinor: p.unitPriceMinor,
    wholesalePriceMinor: p.wholesalePriceMinor,
    wholesaleMinQty: p.wholesaleMinQty ?? 0,
    supplierId: p.supplier.id,
    supplierName: p.supplier.name,
    image: p.image,
    availableQty: p.availableQty,
  }
}

/** Shared add-to-cart used by cards, fitment rows and the product page. */
export function addProductToCart(p: CatalogueProduct, qty = 1) {
  if (qty <= 0) return
  const capped = p.availableQty > 0 ? Math.min(qty, p.availableQty) : qty
  useCart.getState().add(cartItemFromProduct(p), capped)
  toast.success(`Added ${capped} × ${p.name} to your procurement cart`)
}

export function ProductCard({ product, className }: { product: CatalogueProduct; className?: string }) {
  const { user } = useAuth()
  const toggleSaved = useSavedSupply((s) => s.toggle)
  const savedProducts = useSavedSupply((s) => s.products)
  const [imgBroken, setImgBroken] = useState(false)
  const saved = Boolean(savedProducts[product.id])

  const p = product
  const hasWholesale = Boolean(p.wholesalePriceMinor && p.wholesaleMinQty > 0)

  function onSave(e: React.MouseEvent) {
    e.stopPropagation()
    if (!user) {
      toast.info('Sign in to save parts for later')
      navigate('signin')
      return
    }
    void toggleSaved('PRODUCT', p.id, p.name)
  }

  return (
    <Card
      className={cn(
        'cmz-gloss group flex h-full cursor-pointer flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-lg',
        className
      )}
      onClick={() => navigate(`/supply?product=${p.id}`)}
    >
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        {/* Image */}
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted">
          {p.image && !imgBroken ? (
            <img
              src={p.image}
              alt={p.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              onError={() => setImgBroken(true)}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Package className="h-8 w-8" aria-hidden="true" />
            </span>
          )}
          {p.featured && (
            <Badge className="absolute left-2 top-2 bg-gold text-gold-foreground">Featured</Badge>
          )}
          <button
            onClick={onSave}
            className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted"
            aria-label={saved ? `Remove ${p.name} from saved` : `Save ${p.name}`}
          >
            {saved ? (
              <BookmarkCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            ) : (
              <Bookmark className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Title + meta */}
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{p.name}</h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {p.brand ? `${p.brand} · ` : ''}
            SKU {p.sku}
          </p>
        </div>

        {/* Trust badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          {p.authenticityVerified && (
            <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
              <BadgeCheck className="h-3 w-3" aria-hidden="true" /> Authenticity verified
            </Badge>
          )}
          <Badge variant="secondary">{SUPPLY_CONDITION_LABELS[p.condition] ?? p.condition}</Badge>
          {p.ratingCount > 0 && p.ratingAvg != null && (
            <span className="inline-flex items-center gap-1">
              <Stars avg={p.ratingAvg} />
              <span className="text-xs text-muted-foreground">({p.ratingCount})</span>
            </span>
          )}
        </div>

        {/* Price block */}
        <div className="mt-auto">
          <p className="text-base font-bold text-foreground">{money(p.unitPriceMinor, p.currency)}</p>
          {hasWholesale && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Wholesale from <span className="font-medium text-foreground">{money(p.wholesalePriceMinor!, p.currency)}</span>{' '}
              (min qty {p.wholesaleMinQty})
            </p>
          )}
          <div className="mt-1.5"><StockStatus qty={p.availableQty} /></div>
        </div>

        {/* Supplier row */}
        <button
          onClick={(e) => { e.stopPropagation(); navigate(`/supply?supplier=${p.supplier.id}`) }}
          className="flex min-h-[36px] items-center gap-2 rounded-md text-left transition-colors hover:bg-muted/60"
          aria-label={`View ${p.supplier.name} storefront`}
        >
          <SupplierAvatar name={p.supplier.name} logoUrl={p.supplier.logoUrl} className="h-7 w-7 rounded-md" textClassName="text-[10px]" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{p.supplier.name}</span>
          <VerifiedTick verified={p.supplier.verified} name={p.supplier.name} />
        </button>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            className="h-10 flex-1 gap-1.5"
            disabled={p.availableQty <= 0}
            onClick={(e) => { e.stopPropagation(); addProductToCart(p, 1) }}
          >
            <ShoppingCart className="h-4 w-4" aria-hidden="true" /> Add to cart
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** Compact row used in fitment results. */
export function FitmentRow({ product }: { product: CatalogueProduct }) {
  const hasWholesale = Boolean(product.wholesalePriceMinor && product.wholesaleMinQty > 0)
  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/50"
      onClick={() => navigate(`/supply?product=${product.id}`)}
    >
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
        {product.image ? (
          <img src={product.image} alt={product.name} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center text-muted-foreground">
            <Package className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{product.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {product.brand ? `${product.brand} · ` : ''}SKU {product.sku} · {product.supplier.name}
        </p>
      </div>
      <div className="hidden shrink-0 text-right sm:block">
        <p className="text-sm font-bold">{money(product.unitPriceMinor, product.currency)}</p>
        {hasWholesale && (
          <p className="text-xs text-muted-foreground">wholesale {money(product.wholesalePriceMinor!, product.currency)}</p>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-10 shrink-0 gap-1.5"
        disabled={product.availableQty <= 0}
        onClick={(e) => { e.stopPropagation(); addProductToCart(product, 1) }}
      >
        <ShoppingCart className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Add</span>
      </Button>
    </div>
  )
}
