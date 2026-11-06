import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireUser, getIp } from '@/lib/api'
import { getSessionUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

const PAGE_SIZE = 15

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

const createSchema = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters').max(120),
  body: z.string().trim().min(10, 'Post body must be at least 10 characters').max(5000),
  category: z.enum(['GENERAL', 'QUESTION', 'SHOWCASE', 'EVENT', 'WANTED', 'FEATURE_REQUEST']),
  linkRef: z.string().trim().max(200).optional().or(z.literal('')),
  pollOptions: z.array(z.string().trim().min(1, 'Poll options cannot be empty').max(80)).min(2).max(4).optional(),
})

// GET /api/community/posts?category=&page=&q=: public read of PUBLISHED posts.
export const GET = route(async (req: NextRequest) => {
  const url = new URL(req.url)
  const category = url.searchParams.get('category') || ''
  const q = (url.searchParams.get('q') || '').trim()
  const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1)

  const where: { status: string; category?: string } = { status: 'PUBLISHED' }
  if (category && category !== 'ALL') where.category = category

  // SQLite's `contains` is case-sensitive, so search filters in JS over a bounded set.
  const qLower = q.toLowerCase()
  const searchFilter = (p: { title: string; body: string }) => !qLower || p.title.toLowerCase().includes(qLower) || p.body.toLowerCase().includes(qLower)

  let rawPosts: Array<{
    id: string; title: string; body: string; category: string; linkRef: string | null; pollOptions: string | null
    isSponsored: boolean; createdAt: Date
    user: { id: string; name: string }
    _count: { comments: number; reactions: number }
  }>
  let total: number

  if (qLower) {
    const all = await db.communityPost.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        user: { select: { id: true, name: true } },
        _count: { select: { comments: { where: { status: 'PUBLISHED' } }, reactions: true } },
      },
    })
    const filtered = all.filter(searchFilter)
    total = filtered.length
    rawPosts = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  } else {
    const [posts, count] = await Promise.all([
      db.communityPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          user: { select: { id: true, name: true } },
          _count: { select: { comments: { where: { status: 'PUBLISHED' } }, reactions: true } },
        },
      }),
      db.communityPost.count({ where }),
    ])
    rawPosts = posts
    total = count
  }

  const session = await getSessionUser()
  let myReactionIds = new Set<string>()
  if (session && rawPosts.length > 0) {
    const mine = await db.postReaction.findMany({
      where: { userId: session.id, postId: { in: rawPosts.map((p) => p.id) } },
      select: { postId: true },
    })
    myReactionIds = new Set(mine.map((r) => r.postId))
  }

  return ok({
    posts: rawPosts.map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body,
      category: p.category,
      linkRef: p.linkRef,
      pollOptions: parsePoll(p.pollOptions),
      isSponsored: p.isSponsored,
      createdAt: p.createdAt,
      author: { id: p.user.id, name: p.user.name },
      commentCount: p._count.comments,
      likeCount: p._count.reactions,
      likedByMe: myReactionIds.has(p.id),
      votes: pollTotals(parsePoll(p.pollOptions), session?.id ?? null),
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  })
})

// POST /api/community/posts: auth; rate limited 5 per 10 minutes.
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`community-post:${user.id}:${getIp(req)}`, 5, 10 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'You are posting too quickly. Try again in a few minutes.')

  const body = await parseBody(req, createSchema)
  const poll = body.pollOptions
    ? body.pollOptions.map((text) => ({ text, userIds: [] as string[] }))
    : null

  const post = await db.communityPost.create({
    data: {
      userId: user.id,
      title: body.title,
      body: body.body,
      category: body.category,
      linkRef: body.linkRef || null,
      pollOptions: poll ? JSON.stringify(poll) : null,
      status: 'PUBLISHED',
      isSponsored: false, // CARMAZE does not sell fake promotion; community posts are always organic.
    },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'COMMUNITY_POST_CREATED', targetType: 'POST', targetId: post.id, metadata: { category: body.category } })
  return ok(
    {
      post: {
        id: post.id,
        title: post.title,
        body: post.body,
        category: post.category,
        linkRef: post.linkRef,
        pollOptions: parsePoll(post.pollOptions),
        isSponsored: post.isSponsored,
        createdAt: post.createdAt,
        author: { id: user.id, name: user.name },
        commentCount: 0,
        likeCount: 0,
        likedByMe: false,
        votes: pollTotals(parsePoll(post.pollOptions), user.id),
      },
    },
    { status: 201 }
  )
})
