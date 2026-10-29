import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, parseBody, requireRole, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { notify } from '@/lib/notify'
import { audit } from '@/lib/audit'

const LISTING_STATUSES = ['ALL', 'DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'RESERVED', 'SOLD', 'REJECTED', 'SUSPENDED', 'EXPIRED']
const PAGE_SIZE = 12

/**
 * GET /api/admin/listings?status=PENDING_REVIEW&page=1 — moderation queue.
 * Includes photos, owner and org for real review decisions.
 */
export const GET = route(async (req: NextRequest) => {
  await requireRole('REVIEWER', 'MODERATOR', 'ADMIN', 'FOUNDER', 'SUPPORT', 'FINANCE')
  const rl = rateLimit(`admin-listings:${getIp(req)}`, 60, 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many requests. Slow down.')

  const url = new URL(req.url)
  const statusParam = url.searchParams.get('status') || 'PENDING_REVIEW'
  const status = LISTING_STATUSES.includes(statusParam) ? statusParam : 'PENDING_REVIEW'
  const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1)

  const where = status === 'ALL' ? {} : { status }
  const [total, rows] = await Promise.all([
    db.vehicle.count({ where }),
    db.vehicle.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        photos: { orderBy: { order: 'asc' } },
        owner: { select: { id: true, name: true, email: true, phone: true } },
        org: { select: { name: true, type: true } },
      },
    }),
  ])
  return ok({ listings: rows, total, page, pageSize: PAGE_SIZE })
})

const patchSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['approve', 'reject', 'suspend', 'feature', 'unfeature']),
  note: z.string().trim().max(1000).optional(),
})

/**
 * PATCH /api/admin/listings — moderation actions (REVIEWER/MODERATOR/ADMIN/FOUNDER).
 * Every action writes a ListingEvent, an audit log entry and — where relevant —
 * an honest notification to the owner.
 */
export const PATCH = route(async (req: NextRequest) => {
  const user = await requireRole('REVIEWER', 'MODERATOR', 'ADMIN', 'FOUNDER')
  const body = await parseBody(req, patchSchema)

  const vehicle = await db.vehicle.findUnique({
    where: { id: body.id },
    include: { photos: true },
  })
  if (!vehicle) throw new ApiError(404, 'NOT_FOUND', 'Listing not found.')

  switch (body.action) {
    case 'approve': {
      if (vehicle.status === 'PUBLISHED') return fail(409, 'INVALID_STATE', 'This listing is already published.')
      const updated = await db.vehicle.update({
        where: { id: vehicle.id },
        data: {
          status: 'PUBLISHED',
          reviewNote: null,
          events: {
            create: { from: vehicle.status, to: 'PUBLISHED', actorId: user.id, actorName: user.name, note: body.note || 'Approved by review team.' },
          },
        },
      })
      await notify({
        userId: vehicle.ownerId,
        type: 'LISTING_PUBLISHED',
        title: `Your listing ${vehicle.refCode} is now live`,
        body: `${vehicle.make} ${vehicle.model} ${vehicle.year} has passed review and is visible in the marketplace.`,
        link: '/my-listings',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'LISTING_APPROVED', targetType: 'VEHICLE', targetId: vehicle.id, metadata: { ref: vehicle.refCode } })
      return ok({ listing: updated })
    }
    case 'reject': {
      if (!body.note || body.note.length < 10) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'A rejection reason of at least 10 characters is required.')
      }
      const updated = await db.vehicle.update({
        where: { id: vehicle.id },
        data: {
          status: 'REJECTED',
          reviewNote: body.note,
          events: {
            create: { from: vehicle.status, to: 'REJECTED', actorId: user.id, actorName: user.name, note: body.note },
          },
        },
      })
      await notify({
        userId: vehicle.ownerId,
        type: 'LISTING_REJECTED',
        title: `Listing ${vehicle.refCode} was not approved`,
        body: `Reason: ${body.note}`,
        link: '/my-listings',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'LISTING_REJECTED', targetType: 'VEHICLE', targetId: vehicle.id, metadata: { ref: vehicle.refCode } })
      return ok({ listing: updated })
    }
    case 'suspend': {
      if (!body.note || body.note.length < 10) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'A suspension reason of at least 10 characters is required.')
      }
      const updated = await db.vehicle.update({
        where: { id: vehicle.id },
        data: {
          status: 'SUSPENDED',
          reviewNote: body.note,
          events: {
            create: { from: vehicle.status, to: 'SUSPENDED', actorId: user.id, actorName: user.name, note: body.note },
          },
        },
      })
      await notify({
        userId: vehicle.ownerId,
        type: 'LISTING_SUSPENDED',
        title: `Listing ${vehicle.refCode} has been suspended`,
        body: `Reason: ${body.note}`,
        link: '/my-listings',
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'LISTING_SUSPENDED', targetType: 'VEHICLE', targetId: vehicle.id, metadata: { ref: vehicle.refCode } })
      return ok({ listing: updated })
    }
    case 'feature':
    case 'unfeature': {
      if (vehicle.status !== 'PUBLISHED') {
        return fail(409, 'INVALID_STATE', 'Featuring only applies to published listings.')
      }
      const featured = body.action === 'feature'
      const updated = await db.vehicle.update({
        where: { id: vehicle.id },
        data: {
          featured,
          events: {
            create: { from: vehicle.status, to: vehicle.status, actorId: user.id, actorName: user.name, note: featured ? 'Listing featured.' : 'Featuring removed.' },
          },
        },
      })
      await audit({ actorId: user.id, actorName: user.name, action: featured ? 'LISTING_FEATURED' : 'LISTING_UNFEATURED', targetType: 'VEHICLE', targetId: vehicle.id, metadata: { ref: vehicle.refCode } })
      return ok({ listing: updated })
    }
    default:
      return fail(400, 'VALIDATION_ERROR', 'Unknown action.')
  }
})
