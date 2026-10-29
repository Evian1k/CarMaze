import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { route, fail, requireUser, ApiError } from '@/lib/api'
import { hasRole, STAFF_ROLES } from '@/lib/auth'

type Ctx = { params: Promise<{ name: string }> }

/**
 * Authorised access to privately stored verification documents.
 * Filenames are `<uploaderUserId>.<random>.<ext>`; only the uploader and
 * platform reviewers/staff may fetch them. Documents are never public URLs.
 */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { name } = await ctx.params

  // strict filename validation — no traversal
  if (!/^[A-Za-z0-9_-]+\.[a-f0-9]{16}\.(jpg|png|webp|pdf)$/.test(name)) {
    return fail(400, 'INVALID_NAME', 'Invalid document reference.')
  }
  const ownerId = name.split('.')[0]
  if (ownerId !== user.id && !hasRole(user, ...STAFF_ROLES)) {
    throw new ApiError(403, 'FORBIDDEN', 'You are not authorised to view this document.')
  }

  const filePath = path.join(process.cwd(), 'data', 'uploads', name)
  try {
    const data = await readFile(filePath)
    const ext = name.split('.').pop()
    const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    return new NextResponse(new Uint8Array(data), {
      headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=60' },
    })
  } catch {
    return fail(404, 'NOT_FOUND', 'Document no longer exists.')
  }
})
