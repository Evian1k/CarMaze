import { NextRequest } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { route, ok, ApiError, requireUser, parseBody, type RouteCtx } from '@/lib/api'
import { audit } from '@/lib/audit'
import { notify } from '@/lib/notify'

export const dynamic = 'force-dynamic'

type Ctx = RouteCtx

const collectSchema = z.object({
  collectorName: z.string().trim().min(2).max(120),
  authCode: z.string().trim().regex(/^\d{6}$/, 'The collection code must be 6 digits.'),
})

/**
 * POST — release the vehicle to the named collector after verifying the
 * customer's single-use 6-digit code. Final step of the custody lifecycle.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params

  const custody = await db.vehicleCustody.findUnique({ where: { id } })
  if (!custody) throw new ApiError(404, 'NOT_FOUND', 'Custody record not found.')

  const membership = await db.orgMember.findFirst({ where: { orgId: custody.orgId, userId: user.id } })
  if (!membership) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the garage team can record a collection.')
  }

  const body = await parseBody(req, collectSchema)

  if (custody.status !== 'READY_FOR_COLLECTION') {
    throw new ApiError(400, 'INVALID_TRANSITION', 'The vehicle is not marked ready for collection.')
  }

  const auth = await db.collectionAuthorisation.findUnique({ where: { custodyId: custody.id } })
  const valid =
    auth && !auth.revokedAt && !auth.usedAt && auth.expiresAt.getTime() > Date.now()
  if (!auth || !valid) {
    throw new ApiError(
      400,
      'AUTH_INVALID',
      'No valid collection authorisation — ask the customer to authorise collection.'
    )
  }

  const codeOk = await bcrypt.compare(body.authCode, auth.authCodeHash)
  if (!codeOk) {
    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'COLLECTION_CODE_FAILED',
      targetType: 'VEHICLE_CUSTODY',
      targetId: custody.id,
      metadata: { refCode: custody.refCode, collectorName: body.collectorName },
    })
    throw new ApiError(400, 'INVALID_CODE', 'Incorrect collection code. Ask the customer for the current code.')
  }

  const now = new Date()
  const [updated] = await db.$transaction([
    db.vehicleCustody.update({
      where: { id: custody.id },
      data: { status: 'RETURNED', collectedAt: now, collectedByName: body.collectorName, returnedAt: now },
    }),
    db.collectionAuthorisation.update({ where: { id: auth.id }, data: { usedAt: now } }),
    db.custodyEvent.create({
      data: {
        custodyId: custody.id,
        type: 'COLLECTION',
        fromStatus: custody.status,
        toStatus: 'RETURNED',
        actorId: user.id,
        actorName: user.name,
        actorSide: 'ORG',
        note: `Vehicle collected by ${body.collectorName} (code verified).`,
      },
    }),
  ])

  await notify({
    userId: custody.customerId,
    type: 'CUSTODY_UPDATE',
    title: `Your vehicle was collected — ${custody.refCode}`,
    body: 'Receipt available in Vehicle Protection.',
    link: '/account?tab=protection',
  })

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'CUSTODY_COLLECTED',
    targetType: 'VEHICLE_CUSTODY',
    targetId: custody.id,
    metadata: { refCode: custody.refCode, collectorName: body.collectorName },
  })

  return ok({ custody: { id: updated.id, refCode: updated.refCode, status: updated.status, collectedByName: updated.collectedByName, collectedAt: updated.collectedAt?.toISOString() ?? null } })
})
