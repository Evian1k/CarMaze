import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser } from '@/lib/api'
import { audit } from '@/lib/audit'
import { requireOrgMember } from '@/lib/supply'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const schema = z.object({
  make: z.string().trim().min(2).max(50),
  model: z.string().trim().max(60).optional().nullable(),
  yearFrom: z.number().int().min(1950).max(2100).optional().nullable(),
  yearTo: z.number().int().min(1950).max(2100).optional().nullable(),
  engine: z.string().trim().max(80).optional().nullable(),
  trim: z.string().trim().max(80).optional().nullable(),
  chassis: z.string().trim().max(40).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
})

/** GET — compatibility records for a product (public). */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const rows = await db.productCompatibility.findMany({ where: { productId: id }, orderBy: [{ make: 'asc' }, { model: 'asc' }] })
  return ok({ compatibility: rows })
})

/**
 * POST — owning supplier adds a fitment reference. Records are stored with
 * source=SUPPLIER and verified=false until platform admins review disputed
 * fitment. The engine never invents compatibility.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const product = await db.product.findUnique({ where: { id } })
  if (!product) return fail(404, 'NOT_FOUND', 'Product not found.')
  await requireOrgMember(user, product.supplierOrgId, 'catalogue.write')
  const body = await parseBody(req, schema)
  if (body.yearFrom && body.yearTo && body.yearFrom > body.yearTo) {
    return fail(400, 'BAD_RANGE', 'Year range is invalid.')
  }
  const row = await db.productCompatibility.create({
    data: {
      productId: id,
      make: body.make,
      model: body.model ?? null,
      yearFrom: body.yearFrom ?? null,
      yearTo: body.yearTo ?? null,
      engine: body.engine ?? null,
      trim: body.trim ?? null,
      chassis: body.chassis ?? null,
      source: 'SUPPLIER',
      verified: false,
      note: body.note ?? null,
    },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'FITMENT_ADDED', targetType: 'PRODUCT', targetId: id, metadata: { make: body.make, model: body.model } })
  return ok({ compatibility: row }, { status: 201 })
})

/** DELETE — remove a fitment record (owning supplier). */
export const DELETE = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const user = await requireUser()
  const sp = req.nextUrl.searchParams
  const compatId = sp.get('compatId')
  if (!compatId) return fail(400, 'BAD_REQUEST', 'compatId is required.')
  const product = await db.product.findUnique({ where: { id } })
  if (!product) return fail(404, 'NOT_FOUND', 'Product not found.')
  await requireOrgMember(user, product.supplierOrgId, 'catalogue.write')
  const row = await db.productCompatibility.findUnique({ where: { id: compatId } })
  if (!row || row.productId !== id) return fail(404, 'NOT_FOUND', 'Fitment record not found.')
  await db.productCompatibility.delete({ where: { id: compatId } })
  return ok({ deleted: true })
})
