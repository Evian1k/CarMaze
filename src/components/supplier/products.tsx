'use client'

/* SupplierOS: Products tab: wholesale catalogue management.
 * Create/edit with the full product schema, multi-image upload, publish
 * toggle, and a per-product vehicle-compatibility editor (fitment rows are
 * submitted as supplier references: verified:false until platform admins
 * review them).
 *
 * HONESTY RULES:
 *  - authenticityVerified is displayed read-only with an explanation that only
 *    CARMAZE can verify authenticity: suppliers cannot self-verify.
 *  - The categories endpoint does not expose internal category IDs (reported
 *    mismatch), so the form resolves category IDs from the supplier's own
 *    products. Categories never used before are disabled with an explanation.
 */

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  BadgeCheck, Boxes, Loader2, Package, PackagePlus, Pencil, Plus, Search, ShieldCheck, Trash2, Upload, X, GitBranch,
} from 'lucide-react'
import { apiSend } from '@/lib/client'
import { money } from '@/lib/format'
import { VEHICLE_MAKES } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  type FetchState, type ProductItem, type ProductCategory, type CompatibilityRow,
  useFetch, supplierRoleCan, StatusBadge, LoadingBlock, ModuleNotice, EmptyState,
  PRODUCT_STATUS_LABELS, PRODUCT_BADGE_CLASS, CONDITION_LABELS,
  kesToMinor, minorToKesInput, splitComma, uploadOne, errMessage, availableAcrossStocks,
} from './shared'

type Props = {
  products: FetchState<{ products: ProductItem[] }>
  role: string
  orgId: string
}

type ProductForm = {
  name: string
  sku: string
  categorySlug: string // '' = none chosen
  mpn: string
  oemRef: string
  brand: string
  description: string
  condition: 'NEW' | 'REFURBISHED' | 'USED'
  unitPrice: string
  wholesalePrice: string
  wholesaleMinQty: string
  taxRatePct: string
  warrantyMonths: string
  returnable: boolean
  tags: string
  vehicleMakes: string
  batchTracked: boolean
  serialTracked: boolean
  provenanceNote: string
  publish: boolean // create: publish now; edit: target status
}

const EMPTY_FORM: ProductForm = {
  name: '', sku: '', categorySlug: '', mpn: '', oemRef: '', brand: '', description: '',
  condition: 'NEW', unitPrice: '', wholesalePrice: '', wholesaleMinQty: '', taxRatePct: '',
  warrantyMonths: '', returnable: true, tags: '', vehicleMakes: '', batchTracked: false,
  serialTracked: false, provenanceNote: '', publish: true,
}

function formFromProduct(p: ProductItem): ProductForm {
  return {
    name: p.name,
    sku: p.sku,
    categorySlug: p.category.slug,
    mpn: p.mpn ?? '',
    oemRef: p.oemRef ?? '',
    brand: p.brand ?? '',
    description: p.description,
    condition: p.condition,
    unitPrice: minorToKesInput(p.unitPriceMinor),
    wholesalePrice: minorToKesInput(p.wholesalePriceMinor),
    wholesaleMinQty: p.wholesaleMinQty ? String(p.wholesaleMinQty) : '',
    taxRatePct: p.taxRatePct ? String(p.taxRatePct) : '',
    warrantyMonths: p.warrantyMonths ? String(p.warrantyMonths) : '',
    returnable: p.returnable,
    tags: p.tags.join(', '),
    vehicleMakes: p.vehicleMakes.join(', '),
    batchTracked: p.batchTracked,
    serialTracked: p.serialTracked,
    provenanceNote: '',
    publish: p.status === 'PUBLISHED',
  }
}

const STATUS_FILTERS = ['ALL', 'PUBLISHED', 'DRAFT', 'SUSPENDED', 'REJECTED'] as const

export function ProductsTab({ products, role, orgId }: Props) {
  const categories = useFetch<{ categories: ProductCategory[] }>('/api/supply/categories')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('ALL')
  const [editing, setEditing] = useState<ProductItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [compatFor, setCompatFor] = useState<ProductItem | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const canWrite = supplierRoleCan(role, 'catalogue.write')

  // slug → categoryId map harvested from the supplier's own products (the
  // public categories endpoint does not expose IDs; see module header).
  const catIdBySlug = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of products.data?.products ?? []) {
      if (p.category?.slug && p.categoryId) map.set(p.category.slug, p.categoryId)
    }
    return map
  }, [products.data])

  const list = products.data?.products ?? []
  const catalogueBoundElsewhere = list.length > 0 && list.some((p) => p.supplierOrgId !== orgId)
  const filtered = list.filter((p) => {
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.mpn ?? '').toLowerCase().includes(q) ||
      (p.brand ?? '').toLowerCase().includes(q) ||
      p.refCode.toLowerCase().includes(q)
    )
  })

  async function togglePublish(p: ProductItem) {
    if (!canWrite) return
    const target = p.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED'
    setTogglingId(p.id)
    try {
      await apiSend(`/api/supply/products/${p.id}`, 'PATCH', { status: target })
      toast.success(target === 'PUBLISHED' ? 'Product published to the supply catalogue.' : 'Product moved to drafts.')
      products.reload()
    } catch (e) {
      toast.error(await errMessage(e, 'Could not update the product.'))
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Wholesale catalogue</h2>
          <p className="text-sm text-muted-foreground">
            {list.length} product{list.length === 1 ? '' : 's'} · {list.filter((p) => p.status === 'PUBLISHED').length} published to the supply catalogue
          </p>
        </div>
        <Button
          onClick={() => setCreating(true)}
          disabled={!canWrite}
          title={canWrite ? 'Create a product' : 'Your role does not include catalogue editing'}
          className="min-h-11"
        >
          <PackagePlus className="h-4 w-4" /> New product
        </Button>
      </div>

      {!canWrite && (
        <p className="text-xs text-muted-foreground">
          Your role ({role}) has read-only catalogue access. Only the business owner or operations managers can edit products.
        </p>
      )}

      {catalogueBoundElsewhere && (
        <Alert>
          <Boxes className="h-4 w-4" />
          <AlertTitle>Catalogue is bound to your primary supplier business</AlertTitle>
          <AlertDescription>
            The catalogue endpoint resolves your account&apos;s first supplier business, so these products belong to a
            different business than the one selected in the header. Orders, warehouses and inventory below reflect the
            selected business.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, SKU, MPN, brand…" className="pl-8" aria-label="Search products" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                statusFilter === s ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {s === 'ALL' ? 'All' : PRODUCT_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {categories.data && catIdBySlug.size === 0 && (categories.data.categories?.length ?? 0) > 0 && (
        <Alert>
          <Boxes className="h-4 w-4" />
          <AlertTitle>First-product category note</AlertTitle>
          <AlertDescription>
            The platform&apos;s category list currently doesn&apos;t expose the internal IDs new products need (engineering
            ticket filed). Until it does, create your first product in a category via platform support, or pick a
            category once known: afterwards all your used categories become selectable here.
          </AlertDescription>
        </Alert>
      )}

      {products.loading ? (
        <LoadingBlock label="Loading catalogue…" />
      ) : products.error ? (
        <ModuleNotice title="Catalogue could not load" detail={products.error.message} retry={products.reload} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Package className="h-8 w-8" />}
          title={list.length === 0 ? 'No products yet' : 'No products match the filters'}
          detail={list.length === 0
            ? 'Add your first product with pricing, warranty and warehouse stock: published products appear in the supply catalogue for verified garages.'
            : 'Try a different search term or status filter.'}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              busy={togglingId === p.id}
              canWrite={canWrite}
              onEdit={() => setEditing(p)}
              onToggle={() => togglePublish(p)}
              onCompatibility={() => setCompatFor(p)}
            />
          ))}
        </div>
      )}

      {/* Create / edit dialog */}
      {creating && (
        <ProductFormDialog
          categories={categories.data?.categories ?? []}
          catIdBySlug={catIdBySlug}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            products.reload()
          }}
        />
      )}
      {editing && (
        <ProductFormDialog
          product={editing}
          categories={categories.data?.categories ?? []}
          catIdBySlug={catIdBySlug}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            products.reload()
          }}
        />
      )}

      {/* Compatibility editor */}
      {compatFor && (
        <CompatibilityDialog
          product={compatFor}
          canWrite={canWrite}
          onClose={() => setCompatFor(null)}
        />
      )}
    </div>
  )
}

// ───────────────────────────── Product card ─────────────────────────────

function ProductCard({ product, busy, canWrite, onEdit, onToggle, onCompatibility }: {
  product: ProductItem
  busy: boolean
  canWrite: boolean
  onEdit: () => void
  onToggle: () => void
  onCompatibility: () => void
}) {
  const available = availableAcrossStocks(product.stocks)
  const canToggle = canWrite && (product.status === 'PUBLISHED' || product.status === 'DRAFT')
  return (
    <Card className="py-4">
      <CardContent className="flex gap-3 px-4">
        {product.images[0] ? (
          <img src={product.images[0]} alt={product.name} className="h-20 w-24 shrink-0 rounded-lg border border-border object-cover" />
        ) : (
          <span className="flex h-20 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 text-muted-foreground">
            <Package className="h-6 w-6" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{product.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                <span className="font-mono">{product.sku}</span>
                {product.brand ? ` · ${product.brand}` : ''} · {product.category.name}
              </p>
            </div>
            <StatusBadge status={product.status} labels={PRODUCT_STATUS_LABELS} classes={PRODUCT_BADGE_CLASS} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{money(product.unitPriceMinor)}</span>
            {product.wholesalePriceMinor ? (
              <span>Wholesale {money(product.wholesalePriceMinor)}{product.wholesaleMinQty ? ` · min ${product.wholesaleMinQty}` : ''}</span>
            ) : null}
            <span className={cn(available === 0 && 'text-destructive')}>{available} available</span>
            {product.authenticityVerified && (
              <Badge variant="secondary" className="gap-1 border-transparent bg-primary/10 px-1 py-0 text-[10px] text-primary">
                <BadgeCheck className="h-3 w-3" /> Authenticity verified
              </Badge>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-8" disabled={!canWrite} onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={onCompatibility}>
              <GitBranch className="h-3.5 w-3.5" /> Compatibility
            </Button>
            {canToggle && (
              <Button size="sm" variant="ghost" className="h-8" disabled={busy} onClick={onToggle}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {product.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ───────────────────────────── Product form ─────────────────────────────

function ProductFormDialog({ product, categories, catIdBySlug, onClose, onSaved }: {
  product?: ProductItem
  categories: ProductCategory[]
  catIdBySlug: Map<string, string>
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = Boolean(product)
  const [form, setForm] = useState<ProductForm>(() => (product ? formFromProduct(product) : EMPTY_FORM))
  const [images, setImages] = useState<string[]>(product?.images ?? [])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)

  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  const unknownCategory = !isEdit && form.categorySlug !== '' && !catIdBySlug.has(form.categorySlug)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const room = 8 - images.length
    if (room <= 0) {
      toast.error('A product can have at most 8 images.')
      return
    }
    setUploading(true)
    try {
      for (const file of Array.from(files).slice(0, room)) {
        const res = await uploadOne(file)
        setImages((prev) => [...prev, res.url])
      }
      toast.success('Image uploaded')
    } catch (e) {
      toast.error(await errMessage(e, 'Upload failed: please try again.'))
    } finally {
      setUploading(false)
    }
  }

  function validate(): string | null {
    if (form.name.trim().length < 3) return 'Product name must be at least 3 characters.'
    if (!isEdit && (form.sku.trim().length < 2 || form.sku.trim().length > 40)) return 'SKU must be 2–40 characters.'
    if (!form.categorySlug) return 'Choose a product category.'
    if (unknownCategory) return 'That category has no internal ID available yet; pick a category you have used before.'
    if (form.description.trim().length < 10) return 'Description must be at least 10 characters.'
    const unit = kesToMinor(form.unitPrice)
    if (unit === null || unit < 100) return 'Enter a unit price of at least KES 1.'
    if (form.wholesalePrice.trim() && (kesToMinor(form.wholesalePrice) ?? 0) < 0) return 'Wholesale price is invalid.'
    const minQty = form.wholesaleMinQty.trim() ? Number(form.wholesaleMinQty) : 0
    if (!Number.isInteger(minQty) || minQty < 0 || minQty > 10000) return 'Wholesale minimum quantity must be 0–10,000.'
    const tax = form.taxRatePct.trim() ? Number(form.taxRatePct) : 0
    if (!Number.isFinite(tax) || tax < 0 || tax > 50) return 'Tax rate must be 0–50%.'
    const warranty = form.warrantyMonths.trim() ? Number(form.warrantyMonths) : 0
    if (!Number.isInteger(warranty) || warranty < 0 || warranty > 120) return 'Warranty must be 0–120 months.'
    if (images.length > 8) return 'A product can have at most 8 images.'
    if (splitComma(form.tags).length > 12) return 'At most 12 tags.'
    if (splitComma(form.vehicleMakes).length > 30) return 'At most 30 vehicle makes.'
    if (form.provenanceNote.length > 1000) return 'Provenance note must be at most 1000 characters.'
    return null
  }

  async function save() {
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return
    }
    setSaving(true)
    setCategoryError(null)
    try {
      const categoryId = isEdit ? undefined : catIdBySlug.get(form.categorySlug)
      if (!isEdit && !categoryId) {
        setCategoryError('Category ID unavailable: the platform category list does not expose internal IDs for new categories.')
        setSaving(false)
        return
      }
      if (isEdit && product) {
        await apiSend(`/api/supply/products/${product.id}`, 'PATCH', {
          name: form.name.trim(),
          ...(form.categorySlug ? { categoryId: catIdBySlug.get(form.categorySlug) } : {}),
          mpn: form.mpn.trim() || null,
          oemRef: form.oemRef.trim() || null,
          brand: form.brand.trim() || null,
          description: form.description.trim(),
          condition: form.condition,
          unitPriceMinor: kesToMinor(form.unitPrice)!,
          wholesalePriceMinor: form.wholesalePrice.trim() ? kesToMinor(form.wholesalePrice) : null,
          wholesaleMinQty: form.wholesaleMinQty.trim() ? Number(form.wholesaleMinQty) : 0,
          taxRatePct: form.taxRatePct.trim() ? Number(form.taxRatePct) : 0,
          warrantyMonths: form.warrantyMonths.trim() ? Number(form.warrantyMonths) : 0,
          returnable: form.returnable,
          images,
          tags: splitComma(form.tags),
          vehicleMakes: splitComma(form.vehicleMakes),
          provenanceNote: form.provenanceNote.trim() || undefined,
          status: form.publish ? 'PUBLISHED' : 'DRAFT',
        })
        toast.success('Product updated.')
      } else {
        await apiSend('/api/supply/products', 'POST', {
          name: form.name.trim(),
          sku: form.sku.trim(),
          categoryId,
          mpn: form.mpn.trim() || null,
          oemRef: form.oemRef.trim() || null,
          brand: form.brand.trim() || null,
          description: form.description.trim(),
          condition: form.condition,
          unitPriceMinor: kesToMinor(form.unitPrice)!,
          wholesalePriceMinor: form.wholesalePrice.trim() ? kesToMinor(form.wholesalePrice) : null,
          wholesaleMinQty: form.wholesaleMinQty.trim() ? Number(form.wholesaleMinQty) : 0,
          taxRatePct: form.taxRatePct.trim() ? Number(form.taxRatePct) : 0,
          warrantyMonths: form.warrantyMonths.trim() ? Number(form.warrantyMonths) : 0,
          returnable: form.returnable,
          images,
          tags: splitComma(form.tags),
          vehicleMakes: splitComma(form.vehicleMakes),
          batchTracked: form.batchTracked,
          serialTracked: form.serialTracked,
          provenanceNote: form.provenanceNote.trim() || null,
          publish: form.publish,
        })
        toast.success(form.publish ? 'Product published to the supply catalogue.' : 'Product saved as draft.')
      }
      onSaved()
    } catch (e) {
      toast.error(await errMessage(e, 'Could not save the product.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scrollbar-thin sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${product?.name}` : 'New product'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Changes apply to the supply catalogue. Price changes are recorded in the product price history.'
              : 'Published products are visible to verified garages in the Automotive Supply Network catalogue.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pf-name">Product name *</Label>
            <Input id="pf-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Toyota Oil Filter (OEM-spec)" maxLength={140} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-sku">SKU *</Label>
            <Input id="pf-sku" value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="e.g. SIF-FLT-OIL-TY" maxLength={40} disabled={isEdit}
              title={isEdit ? 'SKU is permanent once created' : undefined} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-category">Category *</Label>
            <Select value={form.categorySlug || undefined} onValueChange={(v) => { set('categorySlug', v); setCategoryError(null) }}>
              <SelectTrigger id="pf-category" aria-label="Category"><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {categories.map((c) => {
                  const known = isEdit || catIdBySlug.has(c.slug)
                  return (
                    <SelectItem key={c.slug} value={c.slug} disabled={!known}>
                      {c.name}{!known ? ': ID unavailable' : ''}
                    </SelectItem>
                  )
                })}
                {categories.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">Loading categories…</div>}
              </SelectContent>
            </Select>
            {unknownCategory && (
              <p className="text-xs text-destructive">This category has no internal ID available yet. Pick a category you have used before.</p>
            )}
            {categoryError && <p className="text-xs text-destructive">{categoryError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-condition">Condition *</Label>
            <Select value={form.condition} onValueChange={(v) => set('condition', v as ProductForm['condition'])}>
              <SelectTrigger id="pf-condition" aria-label="Condition"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(CONDITION_LABELS) as ('NEW' | 'REFURBISHED' | 'USED')[]).map((c) => (
                  <SelectItem key={c} value={c}>{CONDITION_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-brand">Brand</Label>
            <Input id="pf-brand" value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="e.g. Denso" maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-mpn">Manufacturer part number (MPN)</Label>
            <Input id="pf-mpn" value={form.mpn} onChange={(e) => set('mpn', e.target.value)} placeholder="e.g. 90915-YZZE1" maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-oem">OEM reference</Label>
            <Input id="pf-oem" value={form.oemRef} onChange={(e) => set('oemRef', e.target.value)} placeholder="e.g. 90915-YZZE1" maxLength={60} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pf-desc">Description * (min 10 characters)</Label>
            <Textarea id="pf-desc" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What the part fits, materials, packaging, brand authorisation…" maxLength={4000} />
          </div>

          <Separator className="sm:col-span-2" />

          <div className="space-y-1.5">
            <Label htmlFor="pf-unit">Unit price (KES) *</Label>
            <Input id="pf-unit" inputMode="decimal" value={form.unitPrice} onChange={(e) => set('unitPrice', e.target.value)} placeholder="e.g. 650" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-ws">Wholesale price (KES)</Label>
            <Input id="pf-ws" inputMode="decimal" value={form.wholesalePrice} onChange={(e) => set('wholesalePrice', e.target.value)} placeholder="Optional bulk price" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-wsq">Wholesale min quantity</Label>
            <Input id="pf-wsq" inputMode="numeric" value={form.wholesaleMinQty} onChange={(e) => set('wholesaleMinQty', e.target.value)} placeholder="e.g. 12" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pf-tax">Tax rate (%)</Label>
              <Input id="pf-tax" inputMode="decimal" value={form.taxRatePct} onChange={(e) => set('taxRatePct', e.target.value)} placeholder="e.g. 16" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-warranty">Warranty (months)</Label>
              <Input id="pf-warranty" inputMode="numeric" value={form.warrantyMonths} onChange={(e) => set('warrantyMonths', e.target.value)} placeholder="e.g. 12" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <Label htmlFor="pf-returnable" className="text-sm">Returnable</Label>
              <p className="text-xs text-muted-foreground">Garages can request returns under your policy.</p>
            </div>
            <Switch id="pf-returnable" checked={form.returnable} onCheckedChange={(v) => set('returnable', v)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <Label htmlFor="pf-publish" className="text-sm">{isEdit ? 'Published' : 'Publish immediately'}</Label>
              <p className="text-xs text-muted-foreground">{isEdit ? 'Toggle to move between catalogue and drafts.' : 'Uncheck to save as a private draft.'}</p>
            </div>
            <Switch id="pf-publish" checked={form.publish} onCheckedChange={(v) => set('publish', v)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pf-tags">Tags (comma separated)</Label>
            <Input id="pf-tags" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="e.g. Toyota, Denso, Service part" maxLength={400} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-makes">Vehicle makes (comma separated)</Label>
            <Input id="pf-makes" value={form.vehicleMakes} onChange={(e) => set('vehicleMakes', e.target.value)} placeholder="e.g. Toyota, Lexus" maxLength={600} />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {VEHICLE_MAKES.slice(0, 8).map((m) => (
                <button
                  key={m}
                  type="button"
                  className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  onClick={() => {
                    const parts = new Set(splitComma(form.vehicleMakes))
                    parts.add(m)
                    set('vehicleMakes', Array.from(parts).join(', '))
                  }}
                >
                  <Plus className="mr-0.5 inline h-3 w-3" />{m}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <Label htmlFor="pf-batch" className="text-sm">Batch tracked</Label>
              <p className="text-xs text-muted-foreground">Trace stock by batch number.</p>
            </div>
            <Switch id="pf-batch" checked={form.batchTracked} onCheckedChange={(v) => set('batchTracked', v)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <Label htmlFor="pf-serial" className="text-sm">Serial tracked</Label>
              <p className="text-xs text-muted-foreground">Trace stock by serial number.</p>
            </div>
            <Switch id="pf-serial" checked={form.serialTracked} onCheckedChange={(v) => set('serialTracked', v)} />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pf-prov">Provenance note</Label>
            <Textarea id="pf-prov" rows={2} value={form.provenanceNote} onChange={(e) => set('provenanceNote', e.target.value)}
              placeholder={isEdit && !form.provenanceNote ? 'Leave empty to keep the existing provenance note.' : 'Source evidence, e.g. “Supplier declaration + invoice documentation on file”.'} maxLength={1000} />
            <p className="text-xs text-muted-foreground">
              Provenance notes are supplier-supplied evidence. They do not verify authenticity: only CARMAZE admins can
              mark a product authenticity-verified.
            </p>
          </div>

          {/* Images */}
          <div className="space-y-2 sm:col-span-2">
            <Label>Images ({images.length}/8)</Label>
            <input
              id="pf-image-file"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <div className="flex flex-wrap gap-2">
              {images.map((url) => (
                <div key={url} className="group relative">
                  <img src={url} alt="Product image" className="h-20 w-20 rounded-lg border border-border object-cover" />
                  <button
                    type="button"
                    aria-label="Remove image"
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                    onClick={() => setImages((prev) => prev.filter((u) => u !== url))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {images.length < 8 && (
                <button
                  type="button"
                  onClick={() => document.getElementById('pf-image-file')?.click()}
                  disabled={uploading}
                  className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  <span className="text-[10px]">{uploading ? 'Uploading…' : 'Upload'}</span>
                </button>
              )}
            </div>
          </div>

          {isEdit && product && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground sm:col-span-2">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>
                Authenticity: {product.authenticityVerified ? 'Independently verified by CARMAZE.' : 'Not verified.'}
                {' '}Suppliers cannot self-verify authenticity: the platform marks it after independent review.
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || uploading} className="min-h-11">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
            {isEdit ? 'Save changes' : form.publish ? 'Publish product' : 'Save draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────────── Compatibility editor ─────────────────────────────

type CompatForm = { make: string; model: string; yearFrom: string; yearTo: string; engine: string; trim: string; chassis: string; note: string }

const EMPTY_COMPAT: CompatForm = { make: '', model: '', yearFrom: '', yearTo: '', engine: '', trim: '', chassis: '', note: '' }

function CompatibilityDialog({ product, canWrite, onClose }: {
  product: ProductItem
  canWrite: boolean
  onClose: () => void
}) {
  const rows = useFetch<{ compatibility: CompatibilityRow[] }>(`/api/supply/products/${product.id}/compatibility`)
  const [form, setForm] = useState<CompatForm>(EMPTY_COMPAT)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const set = (k: keyof CompatForm, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function add() {
    if (form.make.trim().length < 2) {
      toast.error('Enter the vehicle make (at least 2 characters).')
      return
    }
    const yf = form.yearFrom.trim() ? Number(form.yearFrom) : null
    const yt = form.yearTo.trim() ? Number(form.yearTo) : null
    for (const [label, y] of [['Year from', yf], ['Year to', yt]] as const) {
      if (y !== null && (!Number.isInteger(y) || y < 1950 || y > 2100)) {
        toast.error(`${label} must be a year between 1950 and 2100.`)
        return
      }
    }
    if (yf !== null && yt !== null && yf > yt) {
      toast.error('Year range is invalid: “from” must be ≤ “to”.')
      return
    }
    setSaving(true)
    try {
      await apiSend(`/api/supply/products/${product.id}/compatibility`, 'POST', {
        make: form.make.trim(),
        model: form.model.trim() || null,
        yearFrom: yf,
        yearTo: yt,
        engine: form.engine.trim() || null,
        trim: form.trim.trim() || null,
        chassis: form.chassis.trim() || null,
        note: form.note.trim() || null,
      })
      toast.success('Fitment reference added: it stays “pending admin review” until the platform verifies it.')
      setForm(EMPTY_COMPAT)
      rows.reload()
    } catch (e) {
      toast.error(await errMessage(e, 'Could not add the fitment record.'))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setDeletingId(id)
    try {
      await apiSend(`/api/supply/products/${product.id}/compatibility?compatId=${id}`, 'DELETE')
      rows.reload()
    } catch (e) {
      toast.error(await errMessage(e, 'Could not remove the fitment record.'))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scrollbar-thin sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Vehicle compatibility: {product.name}</DialogTitle>
          <DialogDescription>
            Fitment references you add are marked “pending admin review” until the platform verifies them. CARMAZE never
            invents compatibility: these rows tell garages exactly what you declare the part fits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {rows.loading ? (
            <LoadingBlock label="Loading fitment records…" />
          ) : rows.error ? (
            <ModuleNotice title="Fitment records could not load" detail={rows.error.message} retry={rows.reload} />
          ) : (rows.data?.compatibility ?? []).length === 0 ? (
            <EmptyState
              icon={<GitBranch className="h-7 w-7" />}
              title="No fitment records yet"
              detail="Add makes, models and year ranges so garages searching by vehicle can find this part."
            />
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto scrollbar-thin">
              {(rows.data?.compatibility ?? []).map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">
                      {r.make}{r.model ? ` ${r.model}` : ''}
                      {r.yearFrom || r.yearTo ? (
                        <span className="font-normal text-muted-foreground">
                          {' '}· {r.yearFrom ?? '…'}–{r.yearTo ?? '…'}
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[r.engine, r.trim, r.chassis, r.note].filter(Boolean).join(' · ') || 'No additional details'}
                    </p>
                    {r.verified ? (
                      <Badge variant="secondary" className="mt-1 gap-1 border-transparent bg-primary/10 px-1 py-0 text-[10px] text-primary">
                        <BadgeCheck className="h-3 w-3" /> Verified
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="mt-1 border-transparent bg-accent/40 px-1 py-0 text-[10px] text-accent-foreground">
                        Pending admin review
                      </Badge>
                    )}
                  </div>
                  {canWrite && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive" aria-label="Remove fitment record" disabled={deletingId === r.id} onClick={() => remove(r.id)}>
                      {deletingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {canWrite && (
          <>
            <Separator />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cf-make">Make *</Label>
                <Input id="cf-make" value={form.make} onChange={(e) => set('make', e.target.value)} placeholder="e.g. Toyota" list="compat-makes" maxLength={50} />
                <datalist id="compat-makes">{VEHICLE_MAKES.map((m) => <option key={m} value={m} />)}</datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-model">Model</Label>
                <Input id="cf-model" value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="e.g. Prado" maxLength={60} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cf-yf">Year from</Label>
                  <Input id="cf-yf" inputMode="numeric" value={form.yearFrom} onChange={(e) => set('yearFrom', e.target.value)} placeholder="e.g. 2009" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cf-yt">Year to</Label>
                  <Input id="cf-yt" inputMode="numeric" value={form.yearTo} onChange={(e) => set('yearTo', e.target.value)} placeholder="e.g. 2021" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-engine">Engine</Label>
                <Input id="cf-engine" value={form.engine} onChange={(e) => set('engine', e.target.value)} placeholder="e.g. 2.7L 2TR-FE" maxLength={80} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-trim">Trim</Label>
                <Input id="cf-trim" value={form.trim} onChange={(e) => set('trim', e.target.value)} placeholder="e.g. TX" maxLength={80} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-chassis">Chassis code</Label>
                <Input id="cf-chassis" value={form.chassis} onChange={(e) => set('chassis', e.target.value)} placeholder="e.g. GRJ150" maxLength={40} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cf-note">Note</Label>
                <Input id="cf-note" value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Optional note shown to garages" maxLength={300} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Done</Button>
              <Button onClick={add} disabled={saving} className="min-h-11">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add fitment record
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
