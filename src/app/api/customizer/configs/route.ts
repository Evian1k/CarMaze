import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, getIp } from '@/lib/api'
import { getSessionUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { shareId } from '@/lib/ids'

// CARMAZE 3D Customizer — save a validated configuration and get a share id.
// Session is optional: anonymous visitors can build & try, signed-in users get
// the configuration linked to their account.

const configSchema = z.strictObject({
  paint: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Paint must be a #rrggbb hex color'),
  finish: z.enum(['gloss', 'matte', 'metallic']),
  rimStyle: z.enum(['sport', 'classic', 'mesh']),
  rimColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Rim color must be a #rrggbb hex color'),
  glassTint: z.number().min(0, 'glassTint must be ≥ 0').max(0.9, 'glassTint must be ≤ 0.9'),
  accessory: z.enum(['none', 'spoiler', 'roofrack']),
  rideHeight: z.number().min(-0.06, 'rideHeight must be ≥ -0.06').max(0.1, 'rideHeight must be ≤ 0.10'),
})

const bodySchema = z.strictObject({
  modelId: z.literal('sedan-classic'),
  config: configSchema,
})

export const POST = route(async (req: NextRequest) => {
  const rl = rateLimit(`customizer-save:${getIp(req)}`, 60, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many saves. Please wait a moment and try again.')

  const body = await parseBody(req, bodySchema)

  // Session is optional — attach userId when the visitor is signed in.
  const user = await getSessionUser()

  const row = await db.customizerConfig.create({
    data: {
      shareId: shareId(12),
      modelId: body.modelId,
      config: JSON.stringify(body.config),
      userId: user?.id ?? null,
    },
  })

  return ok({ shareId: row.shareId }, { status: 201 })
})
