import { NextRequest } from 'next/server'
import { route, ok, ApiError, type RouteCtx } from '@/lib/api'
import { buildStorefrontPayload } from '@/lib/storefront'

export const dynamic = 'force-dynamic'

type Ctx = RouteCtx

/** Public storefront payload for a verified dealer/garage business page. */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const payload = await buildStorefrontPayload(id)
  if (!payload) throw new ApiError(404, 'NOT_FOUND', 'Business not found.')
  return ok(payload)
})
