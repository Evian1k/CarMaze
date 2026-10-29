import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, ApiError } from '@/lib/api'

const voteSchema = z.object({
  postId: z.string().min(1),
  optionIndex: z.coerce.number().int().min(0),
})

// POST /api/community/vote — one vote per user per poll; clicking again removes the vote (toggle),
// switching options moves the vote. Poll state is persisted as JSON in CommunityPost.pollOptions.
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const body = await parseBody(req, voteSchema)

  const post = await db.communityPost.findUnique({ where: { id: body.postId }, select: { id: true, status: true, pollOptions: true } })
  if (!post || post.status !== 'PUBLISHED') throw new ApiError(404, 'NOT_FOUND', 'Post not found.')

  let options: { text: string; userIds: string[] }[] | null = null
  if (post.pollOptions) {
    try {
      const parsed = JSON.parse(post.pollOptions) as { text: string; userIds: string[] }[]
      if (Array.isArray(parsed) && parsed.length > 0) options = parsed
    } catch {
      options = null
    }
  }
  if (!options) throw new ApiError(400, 'NO_POLL', 'This post does not have a poll.')
  if (body.optionIndex >= options.length) throw new ApiError(400, 'BAD_OPTION', 'That poll option does not exist.')

  // Toggle: if the user already voted for THIS option, remove the vote entirely.
  const target = options[body.optionIndex]
  const alreadyVotedHere = Array.isArray(target.userIds) && target.userIds.includes(user.id)

  for (const option of options) {
    if (!Array.isArray(option.userIds)) option.userIds = []
    option.userIds = option.userIds.filter((id) => id !== user.id)
  }
  if (!alreadyVotedHere) target.userIds.push(user.id)

  await db.communityPost.update({
    where: { id: post.id },
    data: { pollOptions: JSON.stringify(options) },
  })

  const votes = options.map((o) => ({ text: o.text, count: o.userIds.length, votedByMe: o.userIds.includes(user.id) }))
  return ok({ votes })
})
