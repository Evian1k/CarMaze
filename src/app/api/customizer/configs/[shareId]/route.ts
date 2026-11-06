import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, ApiError } from '@/lib/api'

// CARMAZE 3D Customizer: restore a shared configuration by its share id.
// GET /api/customizer/configs/[shareId]
//  - 200 { modelId, config, createdAt, views }
//  - 404 CONFIG_NOT_FOUND     unknown share id
//  - 410 CONFIG_INVALID       stored JSON unreadable / fails validation
// Views counter is incremented fire-and-forget so reads stay fast.

type Ctx = { params: Promise<Record<string, string>> }

export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { shareId } = await ctx.params

  const row = await db.customizerConfig.findUnique({ where: { shareId } })
  if (!row) throw new ApiError(404, 'CONFIG_NOT_FOUND', 'This configuration could not be found.')

  let parsed: unknown
  try {
    parsed = JSON.parse(row.config)
  } catch {
    throw new ApiError(410, 'CONFIG_INVALID', 'This shared configuration is no longer valid')
  }

  if (!isConfigShape(parsed)) {
    throw new ApiError(410, 'CONFIG_INVALID', 'This shared configuration is no longer valid')
  }

  // Fire-and-forget view counter: never blocks or fails the read.
  void db.customizerConfig
    .update({ where: { shareId }, data: { views: { increment: 1 } } })
    .catch(() => {})

  return ok({
    modelId: row.modelId,
    config: parsed,
    createdAt: row.createdAt.toISOString(),
    views: row.views,
  })
})

/** Runtime shape guard mirroring the write-side zod schema. */
function isConfigShape(v: unknown): v is {
  paint: string
  finish: string
  rimStyle: string
  rimColor: string
  glassTint: number
  accessory: string
  rideHeight: number
} {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    typeof c.paint === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(c.paint) &&
    typeof c.finish === 'string' &&
    ['gloss', 'matte', 'metallic'].includes(c.finish) &&
    typeof c.rimStyle === 'string' &&
    ['sport', 'classic', 'mesh'].includes(c.rimStyle) &&
    typeof c.rimColor === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(c.rimColor) &&
    typeof c.glassTint === 'number' &&
    c.glassTint >= 0 &&
    c.glassTint <= 0.9 &&
    typeof c.accessory === 'string' &&
    ['none', 'spoiler', 'roofrack'].includes(c.accessory) &&
    typeof c.rideHeight === 'number' &&
    c.rideHeight >= -0.06 &&
    c.rideHeight <= 0.1
  )
}
