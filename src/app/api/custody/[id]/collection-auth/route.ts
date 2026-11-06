import { NextRequest } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody, type RouteCtx } from '@/lib/api'
import { sixDigitCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notifyOrgMembers } from '@/lib/orgs'

export const dynamic = 'force-dynamic'

type Ctx = RouteCtx

const createSchema = z.object({
  collectorName: z.string().trim().min(2).max(120),
  collectorPhone: z.string().trim().min(9).max(20),
})

/**
 * POST: the customer authorises a named collector with a single-use 6-digit
 * code. Only one active authorisation exists per custody: because the schema
 * keeps one row per custody (unique custodyId), issuing a new code replaces
 * the previous hash: the old code instantly stops validating, which is the
 * same effect as revoking it.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params

  const custody = await db.vehicleCustody.findUnique({ where: { id }, include: { org: { select: { name: true } } } })
  if (!custody) throw new ApiError(404, 'NOT_FOUND', 'Custody record not found.')
  if (custody.customerId !== user.id) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the vehicle owner can authorise collection.')
  }
  if (custody.status !== 'READY_FOR_COLLECTION') {
    throw new ApiError(400, 'INVALID_TRANSITION', 'Collection can only be authorised once the vehicle is marked ready for collection.')
  }

  const body = await parseBody(req, createSchema)

  const code = sixDigitCode()
  const authCodeHash = await bcrypt.hash(code, 10)
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)

  await db.collectionAuthorisation.upsert({
    where: { custodyId: custody.id },
    create: {
      custodyId: custody.id,
      collectorName: body.collectorName,
      collectorPhone: body.collectorPhone,
      authCodeHash,
      codeHint: code.slice(-2),
      expiresAt,
    },
    update: {
      collectorName: body.collectorName,
      collectorPhone: body.collectorPhone,
      authCodeHash,
      codeHint: code.slice(-2),
      expiresAt,
      usedAt: null,
      revokedAt: null,
    },
  })

  await notifyOrgMembers(custody.orgId, {
    type: 'CUSTODY_UPDATE',
    title: `Collection authorised for ${custody.refCode}`,
    body: `${user.name} authorised ${body.collectorName} to collect the ${custody.vehicleDesc}. Ask them for the 6-digit code at pickup.`,
    link: '/garage-dashboard?tab=custody',
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'COLLECTION_AUTH_CREATED',
    targetType: 'VEHICLE_CUSTODY',
    targetId: custody.id,
    metadata: { refCode: custody.refCode, collectorName: body.collectorName, expiresAt: expiresAt.toISOString() },
  })

  // The plaintext code is shown to the customer exactly once.
  return ok({ code })
})

/** DELETE: revoke the active collection authorisation. */
export const DELETE = route(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params

  const custody = await db.vehicleCustody.findUnique({ where: { id } })
  if (!custody) throw new ApiError(404, 'NOT_FOUND', 'Custody record not found.')
  if (custody.customerId !== user.id) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the vehicle owner can revoke a collection authorisation.')
  }

  const auth = await db.collectionAuthorisation.findUnique({ where: { custodyId: custody.id } })
  const active = auth && !auth.revokedAt && !auth.usedAt && auth.expiresAt.getTime() > Date.now()
  if (!auth || !active) {
    return fail(400, 'NO_ACTIVE_AUTH', 'There is no active collection authorisation to revoke.')
  }

  await db.collectionAuthorisation.update({ where: { id: auth.id }, data: { revokedAt: new Date() } })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'COLLECTION_AUTH_REVOKED',
    targetType: 'VEHICLE_CUSTODY',
    targetId: custody.id,
    metadata: { refCode: custody.refCode },
  })

  return ok({ revoked: true })
})
