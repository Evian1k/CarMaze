import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, ApiError } from '@/lib/api'

const reactSchema = z.object({
  postId: z.string().min(1),
})

// POST /api/community/react — toggle the signed-in user's LIKE on a post.
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, reactSchema)

  const post = await db.communityPost.findUnique({ where: { id: body.postId }, select: { id: true, status: true } })
  if (!post || post.status !== 'PUBLISHED') throw new ApiError(404, 'NOT_FOUND', 'Post not found.')

  const existing = await db.postReaction.findUnique({
    where: { postId_userId: { postId: post.id, userId: user.id } },
  })

  let liked: boolean
  if (existing) {
    await db.postReaction.delete({ where: { id: existing.id } })
    liked = false
  } else {
    await db.postReaction.create({ data: { postId: post.id, userId: user.id, type: 'LIKE' } })
    liked = true
  }

  const likeCount = await db.postReaction.count({ where: { postId: post.id } })
  return ok({ liked, likeCount })
})
