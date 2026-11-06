import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, ok, fail } from '@/lib/api'
import { getSessionUser, isStaff } from '@/lib/auth'

type Ctx = { params: Promise<Record<string, string>> }

type PollVoteSummary = { text: string; count: number; votedByMe: boolean }

type PollOption = { text: string; userIds: string[] }

function parsePoll(raw: string | null): PollOption[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PollOption[]
    if (!Array.isArray(parsed)) return null
    return parsed.filter((o) => o && typeof o.text === 'string')
  } catch {
    return null
  }
}

function pollTotals(options: PollOption[] | null, userId?: string | null): PollVoteSummary[] | null {
  if (!options) return null
  return options.map((o) => ({
    text: o.text,
    count: Array.isArray(o.userIds) ? o.userIds.length : 0,
    votedByMe: Boolean(userId && Array.isArray(o.userIds) && o.userIds.includes(userId)),
  }))
}

// GET /api/community/posts/[id]: public single post with comments + poll state.
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const session = await getSessionUser()

  const post = await db.communityPost.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true } },
      _count: { select: { reactions: true } },
    },
  })
  if (!post) return fail(404, 'NOT_FOUND', 'Post not found.')

  const staff = isStaff(session)
  if (post.status !== 'PUBLISHED' && !staff) return fail(404, 'NOT_FOUND', 'Post not found.')

  const comments = await db.postComment.findMany({
    where: { postId: post.id, status: 'PUBLISHED' },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true } } },
  })

  const likedByMe = session
    ? Boolean(await db.postReaction.findUnique({ where: { postId_userId: { postId: post.id, userId: session.id } } }))
    : false

  const options = parsePoll(post.pollOptions)

  return ok({
    post: {
      id: post.id,
      title: post.title,
      body: post.body,
      category: post.category,
      linkRef: post.linkRef,
      status: post.status,
      isSponsored: post.isSponsored,
      createdAt: post.createdAt,
      author: { id: post.user.id, name: post.user.name },
      commentCount: comments.length,
      likeCount: post._count.reactions,
      likedByMe,
      pollOptions: options,
      votes: pollTotals(options, session?.id ?? null),
    },
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      author: { id: c.user.id, name: c.user.name },
    })),
  })
})

export const dynamic = 'force-dynamic'

