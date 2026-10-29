'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ThumbsUp, MessageSquare, Flag, Plus, Search, Send, CircleHelp, Megaphone, Trophy,
  Users, ChevronDown, ChevronUp, X, PenLine,
} from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiSend, buildQuery, navigate } from '@/lib/client'
import { useAuth } from '@/stores/auth'
import { timeAgo } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

// ─────────────────────────────── Types ───────────────────────────────

type PollVote = { text: string; count: number; votedByMe: boolean }
type PollOption = { text: string; userIds: string[] }

type FeedPost = {
  id: string
  title: string
  body: string
  category: string
  linkRef: string | null
  pollOptions: PollOption[] | null
  isSponsored: boolean
  createdAt: string
  author: { id: string; name: string }
  commentCount: number
  likeCount: number
  likedByMe: boolean
  votes: PollVote[] | null
}

type CommentItem = {
  id: string
  body: string
  createdAt: string
  author: { id: string; name: string }
}

type CurrentUserLite = { id: string; name: string }

const CATEGORIES = [
  { value: 'ALL', label: 'All' },
  { value: 'GENERAL', label: 'General' },
  { value: 'QUESTION', label: 'Questions' },
  { value: 'SHOWCASE', label: 'Showcases' },
  { value: 'EVENT', label: 'Events' },
  { value: 'WANTED', label: 'Wanted' },
  { value: 'FEATURE_REQUEST', label: 'Feature requests' },
]

const CATEGORY_LABELS: Record<string, string> = {
  GENERAL: 'General',
  QUESTION: 'Question',
  SHOWCASE: 'Showcase',
  EVENT: 'Event',
  WANTED: 'Wanted',
  FEATURE_REQUEST: 'Feature request',
}

const PAGE_SIZE = 15

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

// ─────────────────────────────── View ───────────────────────────────

export default function View() {
  const user = useAuth((s) => s.user)
  const authLoading = useAuth((s) => s.loading)

  const [posts, setPosts] = useState<FeedPost[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [feedLoading, setFeedLoading] = useState(true)

  const [category, setCategory] = useState('ALL')
  const [q, setQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')

  const [createOpen, setCreateOpen] = useState(false)

  // comments expansion
  const [openPostId, setOpenPostId] = useState<string | null>(null)
  const [commentsMap, setCommentsMap] = useState<Record<string, CommentItem[]>>({})
  const [commentsLoadingId, setCommentsLoadingId] = useState<string | null>(null)

  // reporting
  const [reportTarget, setReportTarget] = useState<{ type: 'POST' | 'COMMENT'; id: string; label: string } | null>(null)

  // Debounce search input → appliedQ
  useEffect(() => {
    const t = setTimeout(() => {
      setAppliedQ(q.trim())
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [q])

  // Feed loader
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) setFeedLoading(true)
    })
    const url = buildQuery('/api/community/posts', { category, q: appliedQ, page })
    apiGet<{ posts: FeedPost[]; total: number }>(url)
      .then((d) => {
        if (cancelled) return
        setPosts(d.posts)
        setTotal(d.total)
        setFeedLoading(false)
      })
      .catch((e: Error) => {
        if (cancelled) return
        toast.error(e.message || 'Could not load the community feed.')
        setFeedLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [category, appliedQ, page, user])

  function updatePost(id: string, patch: Partial<FeedPost>) {
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  function toggleLike(post: FeedPost) {
    if (!user) {
      toast.error('Sign in to like posts.')
      return
    }
    apiSend<{ liked: boolean; likeCount: number }>('/api/community/react', 'POST', { postId: post.id })
      .then((d) => updatePost(post.id, { likedByMe: d.liked, likeCount: d.likeCount }))
      .catch((e: Error) => toast.error(e.message || 'Could not update like.'))
  }

  function vote(post: FeedPost, optionIndex: number) {
    if (!user) {
      toast.error('Sign in to vote in polls.')
      return
    }
    apiSend<{ votes: PollVote[] }>('/api/community/vote', 'POST', { postId: post.id, optionIndex })
      .then((d) => updatePost(post.id, { votes: d.votes }))
      .catch((e: Error) => toast.error(e.message || 'Could not record your vote.'))
  }

  function toggleComments(post: FeedPost) {
    if (openPostId === post.id) {
      setOpenPostId(null)
      return
    }
    setOpenPostId(post.id)
    if (!commentsMap[post.id]) {
      setCommentsLoadingId(post.id)
      apiGet<{ post: FeedPost; comments: CommentItem[] }>('/api/community/posts/' + post.id)
        .then((d) => {
          setCommentsMap((prev) => ({ ...prev, [post.id]: d.comments }))
          updatePost(post.id, { commentCount: d.post.commentCount, likeCount: d.post.likeCount, likedByMe: d.post.likedByMe, votes: d.post.votes })
        })
        .catch((e: Error) => toast.error(e.message || 'Could not load comments.'))
        .finally(() => setCommentsLoadingId(null))
    }
  }

  function addComment(post: FeedPost, body: string, onDone: () => void) {
    apiSend<{ comment: CommentItem }>('/api/community/comments', 'POST', { postId: post.id, body })
      .then(() => {
        toast.success('Comment posted.')
        return apiGet<{ post: FeedPost; comments: CommentItem[] }>('/api/community/posts/' + post.id)
      })
      .then((d) => {
        if (!d) return
        setCommentsMap((prev) => ({ ...prev, [post.id]: d.comments }))
        updatePost(post.id, { commentCount: d.post.commentCount })
      })
      .catch((e: Error) => toast.error(e.message || 'Could not post comment.'))
      .finally(() => onDone())
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasNext = page * PAGE_SIZE < total

  return (
    <div className="min-h-screen bg-background pb-24 sm:pb-10">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
        {/* Header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Community</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {total > 0 ? `${total} post${total === 1 ? '' : 's'} from Kenyan motorists` : 'Conversations from Kenyan motorists'}
            </p>
          </div>
          <Button className="hidden sm:inline-flex" onClick={() => (user ? setCreateOpen(true) : navigate('signin'))}>
            <Plus className="mr-1.5 h-4 w-4" /> Create post
          </Button>
        </header>

        {/* Search */}
        <div className="relative mt-6">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search posts…"
            className="pl-9 pr-9"
            aria-label="Search community posts"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {/* Category chips */}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => {
                setCategory(c.value)
                setPage(1)
              }}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                category === c.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Feed */}
        <div className="mt-6 space-y-4">
          {feedLoading ? (
            <>
              <Skeleton className="h-44 w-full rounded-xl" />
              <Skeleton className="h-44 w-full rounded-xl" />
              <Skeleton className="h-44 w-full rounded-xl" />
            </>
          ) : posts.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center py-14 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <MessageSquare className="h-7 w-7 text-muted-foreground" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-foreground">
                  {appliedQ || category !== 'ALL' ? 'No posts match' : 'No posts yet'}
                </h2>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  {appliedQ || category !== 'ALL'
                    ? 'Try a different search term or category.'
                    : 'Be the first to start a conversation with fellow Kenyan motorists.'}
                </p>
                {user ? (
                  <Button className="mt-5" onClick={() => setCreateOpen(true)}>
                    <PenLine className="mr-1.5 h-4 w-4" /> Write the first post
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                user={user}
                expanded={openPostId === post.id}
                comments={commentsMap[post.id] ?? null}
                commentsLoading={commentsLoadingId === post.id}
                onLike={() => toggleLike(post)}
                onVote={(i) => vote(post, i)}
                onToggleComments={() => toggleComments(post)}
                onAddComment={(body, onDone) => addComment(post, body, onDone)}
                onReport={() => setReportTarget({ type: 'POST', id: post.id, label: post.title })}
                onReportComment={(c) => setReportTarget({ type: 'COMMENT', id: c.id, label: c.body.slice(0, 60) })}
              />
            ))
          )}
        </div>

        {/* Pagination */}
        {!feedLoading && totalPages > 1 ? (
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        ) : null}
      </div>

      {/* Floating create button (mobile) */}
      <button
        type="button"
        onClick={() => (user ? setCreateOpen(true) : navigate('signin'))}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 sm:hidden"
        aria-label="Create post"
      >
        <Plus className="h-6 w-6" />
      </button>

      <CreatePostDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(post) => {
          if (category === 'ALL' && appliedQ === '' && page === 1) {
            setPosts((prev) => [post, ...prev])
            setTotal((t) => t + 1)
          } else {
            setCategory('ALL')
            setAppliedQ('')
            setQ('')
            setPage(1)
          }
        }}
      />

      <ReportDialog target={reportTarget} onClose={() => setReportTarget(null)} />
    </div>
  )
}

// ─────────────────────────────── Post card ───────────────────────────────

function PostCard({
  post,
  user,
  expanded,
  comments,
  commentsLoading,
  onLike,
  onVote,
  onToggleComments,
  onAddComment,
  onReport,
  onReportComment,
}: {
  post: FeedPost
  user: CurrentUserLite | null
  expanded: boolean
  comments: CommentItem[] | null
  commentsLoading: boolean
  onLike: () => void
  onVote: (optionIndex: number) => void
  onToggleComments: () => void
  onAddComment: (body: string, onDone: () => void) => void
  onReport: () => void
  onReportComment: (c: CommentItem) => void
}) {
  const [bodyExpanded, setBodyExpanded] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [sending, setSending] = useState(false)

  const totalVotes = useMemo(() => (post.votes ? post.votes.reduce((s, v) => s + v.count, 0) : 0), [post.votes])

  function submitComment(e: React.FormEvent) {
    e.preventDefault()
    const body = commentText.trim()
    if (!body) return
    setSending(true)
    onAddComment(body, () => {
      setSending(false)
      setCommentText('')
    })
  }

  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        {/* Author row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {initials(post.author.name)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{post.author.name}</p>
              <p className="text-xs text-muted-foreground">{timeAgo(post.createdAt)}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {post.isSponsored ? (
              <Badge className="gap-1 border-gold/60 bg-gold/20 text-[#7a5f22] dark:text-gold">
                <Megaphone className="h-3 w-3" /> Sponsored
              </Badge>
            ) : null}
            <CategoryBadge category={post.category} />
          </div>
        </div>

        {/* Title + body */}
        <h2 className="mt-3 text-base font-semibold leading-snug text-foreground">{post.title}</h2>
        <p className={`mt-1.5 whitespace-pre-line text-sm leading-relaxed text-foreground/80 ${bodyExpanded ? '' : 'line-clamp-3'}`}>
          {post.body}
        </p>
        {post.body.length > 180 ? (
          <button
            type="button"
            onClick={() => setBodyExpanded((v) => !v)}
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {bodyExpanded ? (
              <>
                Show less <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                Read more <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        ) : null}

        {post.linkRef ? (
          <div className="mt-2.5">
            <Badge variant="outline" className="font-mono text-[11px] text-muted-foreground">
              {post.linkRef}
            </Badge>
          </div>
        ) : null}

        {/* Poll */}
        {post.votes && post.votes.length > 0 ? (
          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3.5">
            <p className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> Poll · {totalVotes} vote{totalVotes === 1 ? '' : 's'}
            </p>
            <div className="space-y-2">
              {post.votes.map((v, i) => {
                const pct = totalVotes > 0 ? Math.round((v.count / totalVotes) * 100) : 0
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onVote(i)}
                    className="group relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/50"
                    aria-label={`Vote for ${v.text}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute inset-y-0 left-0 transition-all ${v.votedByMe ? 'bg-gold/25' : 'bg-primary/10'}`}
                      style={{ width: `${pct}%` }}
                    />
                    <span
                      className={`relative h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                        v.votedByMe ? 'border-primary bg-primary' : 'border-muted-foreground/40 bg-transparent'
                      }`}
                    />
                    <span className="relative flex-1 truncate text-sm text-foreground">
                      {v.text}
                      {v.votedByMe ? <span className="ml-1.5 text-[10px] font-semibold uppercase text-primary">your vote</span> : null}
                    </span>
                    <span className="relative text-xs tabular-nums text-muted-foreground">
                      {v.count} · {pct}%
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Tap an option to vote — tap again to remove your vote.</p>
          </div>
        ) : null}

        <Separator className="my-3.5" />

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onLike}
            className={`gap-1.5 ${post.likedByMe ? 'text-primary' : 'text-muted-foreground'}`}
            aria-pressed={post.likedByMe}
          >
            <ThumbsUp className={`h-4 w-4 ${post.likedByMe ? 'fill-current' : ''}`} />
            {post.likeCount}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onToggleComments}
            className="gap-1.5 text-muted-foreground"
            aria-expanded={expanded}
          >
            <MessageSquare className="h-4 w-4" />
            {post.commentCount}
          </Button>
          <div className="ml-auto">
            <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-destructive" onClick={onReport}>
              <Flag className="h-4 w-4" />
              <span className="sr-only">Report post</span>
            </Button>
          </div>
        </div>

        {/* Comments section */}
        {expanded ? (
          <div className="mt-3 rounded-lg bg-muted/40 p-3.5">
            {commentsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-3/4" />
              </div>
            ) : (comments?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No comments yet — start the conversation.</p>
            ) : (
              <ul className="space-y-3">
                {comments?.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs">
                        <span className="font-medium text-foreground">{c.author.name}</span>{' '}
                        <span className="text-muted-foreground">· {timeAgo(c.createdAt)}</span>
                      </p>
                      <p className="mt-0.5 whitespace-pre-line break-words text-sm text-foreground/85">{c.body}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onReportComment(c)}
                      className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-background hover:text-destructive"
                      aria-label="Report comment"
                    >
                      <Flag className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3">
              {user ? (
                <form onSubmit={submitComment} className="flex gap-2">
                  <Input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Add a comment…"
                    maxLength={2000}
                    aria-label="Write a comment"
                  />
                  <Button type="submit" size="icon" disabled={sending || !commentText.trim()} aria-label="Send comment">
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
                  <p className="text-xs text-muted-foreground">Sign in to join the conversation.</p>
                  <Button size="sm" variant="outline" onClick={() => navigate('signin')}>
                    Sign in
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function CategoryBadge({ category }: { category: string }) {
  const icon =
    category === 'QUESTION' ? (
      <CircleHelp className="h-3 w-3" />
    ) : category === 'EVENT' ? (
      <Megaphone className="h-3 w-3" />
    ) : category === 'SHOWCASE' ? (
      <Trophy className="h-3 w-3" />
    ) : null
  return (
    <Badge variant="secondary" className="gap-1 text-[11px]">
      {icon}
      {CATEGORY_LABELS[category] ?? category}
    </Badge>
  )
}

// ─────────────────────────────── Create post dialog ───────────────────────────────

function CreatePostDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (post: FeedPost) => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('GENERAL')
  const [linkRef, setLinkRef] = useState('')
  const [hasPoll, setHasPoll] = useState(false)
  const [pollOptions, setPollOptions] = useState<string[]>(['', ''])
  const [busy, setBusy] = useState(false)

  function setOption(i: number, value: string) {
    setPollOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (title.trim().length < 5) {
      toast.error('Title must be at least 5 characters.')
      return
    }
    if (body.trim().length < 10) {
      toast.error('Post body must be at least 10 characters.')
      return
    }
    let options: string[] | undefined
    if (hasPoll) {
      const cleaned = pollOptions.map((o) => o.trim()).filter(Boolean)
      if (cleaned.length < 2) {
        toast.error('A poll needs at least 2 non-empty options.')
        return
      }
      options = cleaned
    }
    setBusy(true)
    apiSend<{ post: FeedPost }>('/api/community/posts', 'POST', {
      title: title.trim(),
      body: body.trim(),
      category,
      linkRef: linkRef.trim() || undefined,
      pollOptions: options,
    })
      .then((d) => {
        toast.success('Post published to the community.')
        setTitle(''); setBody(''); setLinkRef(''); setHasPoll(false); setPollOptions(['', '']); setCategory('GENERAL')
        onClose()
        onCreated(d.post)
      })
      .catch((err: Error) => toast.error(err.message || 'Could not publish post.'))
      .finally(() => setBusy(false))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a post</DialogTitle>
          <DialogDescription>Share advice, ask questions or show off your ride. Be kind — real people read this.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="p-title">Title *</Label>
            <Input id="p-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ask or share something specific" maxLength={120} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger aria-label="Post category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.filter((c) => c.value !== 'ALL').map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-link">Link reference (optional)</Label>
              <Input id="p-link" value={linkRef} onChange={(e) => setLinkRef(e.target.value)} placeholder="e.g. VHL-3XK2Q1" maxLength={200} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-body">Body *</Label>
            <Textarea id="p-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your post…" rows={5} maxLength={5000} required />
            <p className="text-right text-[11px] text-muted-foreground">{body.length}/5000</p>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="p-poll" className="text-sm font-normal">Attach a poll</Label>
              <p className="text-[11px] text-muted-foreground">2–4 options · one vote per person</p>
            </div>
            <Switch id="p-poll" checked={hasPoll} onCheckedChange={setHasPoll} />
          </div>
          {hasPoll ? (
            <div className="space-y-2">
              <Label>Poll options</Label>
              {pollOptions.map((o, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={o}
                    onChange={(e) => setOption(i, e.target.value)}
                    placeholder={`Option ${i + 1}`}
                    maxLength={80}
                  />
                  {pollOptions.length > 2 ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setPollOptions((prev) => prev.filter((_, idx) => idx !== i))}
                      aria-label={`Remove option ${i + 1}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
              {pollOptions.length < 4 ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setPollOptions((prev) => [...prev, ''])}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add option
                </Button>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Publishing…' : 'Publish post'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────── Report dialog ───────────────────────────────

function ReportDialog({
  target,
  onClose,
}: {
  target: { type: 'POST' | 'COMMENT'; id: string; label: string } | null
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!target) return
    if (reason.trim().length < 3) {
      toast.error('Give a short reason (at least 3 characters).')
      return
    }
    setBusy(true)
    apiSend('/api/reports', 'POST', {
      targetType: target.type,
      targetId: target.id,
      reason: reason.trim(),
      details: details.trim() || undefined,
    })
      .then(() => {
        toast.success('Report submitted. Our moderators will review it.')
        setReason(''); setDetails('')
        onClose()
      })
      .catch((err: Error) => toast.error(err.message || 'Could not submit report.'))
      .finally(() => setBusy(false))
  }

  return (
    <Dialog open={target !== null} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report {target?.type === 'COMMENT' ? 'comment' : 'post'}</DialogTitle>
          <DialogDescription>
            {target ? `“${target.label}”` : ''} — tell us what is wrong and our moderation team will take a look.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="rep-reason">Reason *</Label>
            <Input id="rep-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Spam, harassment, misinformation…" maxLength={80} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rep-details">Details (optional)</Label>
            <Textarea id="rep-details" value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={1000} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit report'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
