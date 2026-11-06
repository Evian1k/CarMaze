import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, getIp, ApiError } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { notify } from '@/lib/notify'

const createSchema = z.object({
  postId: z.string().min(1),
  body: z.string().trim().min(1, 'Write a comment first').max(2000),
})

// POST /api/community/comments: auth; rate 20 per 10 minutes.
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`community-comment:${user.id}:${getIp(req)}`, 20, 10 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'You are commenting too quickly. Try again in a few minutes.')

  const body = await parseBody(req, createSchema)
  const post = await db.communityPost.findUnique({ where: { id: body.postId }, select: { id: true, userId: true, title: true, status: true } })
  if (!post || post.status !== 'PUBLISHED') throw new ApiError(404, 'NOT_FOUND', 'Post not found.')

  const comment = await db.postComment.create({
    data: { postId: post.id, userId: user.id, body: body.body, status: 'PUBLISHED' },
    include: { user: { select: { id: true, name: true } } },
  })

  // In-app notification for the post author (never notify yourself; failures are non-fatal).
  if (post.userId !== user.id) {
    try {
      await notify({
        userId: post.userId,
        type: 'COMMUNITY_COMMENT',
        title: `${user.name} commented on your post`,
        body: `"${post.title}": ${body.body.slice(0, 120)}`,
        link: '/community',
      })
    } catch (e) {
      console.error('[community] comment notification failed', e)
    }
  }

  await audit({ actorId: user.id, actorName: user.name, action: 'COMMUNITY_COMMENT_CREATED', targetType: 'COMMENT', targetId: comment.id, metadata: { postId: post.id } })

  return ok(
    {
      comment: {
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        author: { id: comment.user.id, name: comment.user.name },
      },
    },
    { status: 201 }
  )
})
