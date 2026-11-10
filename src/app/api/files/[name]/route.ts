import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { route, fail, requireUser, ApiError } from '@/lib/api'
import { hasRole, STAFF_ROLES } from '@/lib/auth'
import { assertNotDemoStaffRead } from '@/lib/demo'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ name: string }> }

/**
 * Authorised access to privately stored verification documents.
 * Filenames are `<uploaderUserId>.<random>.<ext>`; only the uploader and
 * platform reviewers/staff may fetch them. Documents are never public URLs.
 */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { name } = await ctx.params

  // strict filename validation: no traversal
  if (!/^[A-Za-z0-9_-]+\.[a-f0-9]{16}\.(jpg|png|webp|pdf)$/.test(name)) {
    return fail(400, 'INVALID_NAME', 'Invalid document reference.')
  }
  const ownerId = name.split('.')[0]
  if (ownerId !== user.id) {
    // Reviewer access to someone else's verification document: never for demo
    // sessions (identity documents are closed to demo, see demo.ts).
    assertNotDemoStaffRead(user, 'verification documents')
    if (!hasRole(user, ...STAFF_ROLES)) {
      throw new ApiError(403, 'FORBIDDEN', 'You are not authorised to view this document.')
    }
  }

  const filePath = path.join(process.cwd(), 'data', 'uploads', name)
  try {
    const data = await readFile(filePath)
    const ext = name.split('.').pop()
    const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'

    // Access history: every staff view of a verification document is logged.
    // (Owner views are not logged: they are accessing their own file.)
    try {
      const doc = await db.verificationDocument.findFirst({
        where: { fileUrl: `/api/files/${name}` },
        select: { id: true, ownerUserId: true },
      })
      if (doc && doc.ownerUserId !== user.id) {
        await db.documentAccessLog.create({
          data: { documentId: doc.id, viewerId: user.id, viewerName: user.name, action: 'VIEWED' },
        })
      }
    } catch {
      // logging must never block serving
    }

    return new NextResponse(new Uint8Array(data), {
      // no-store is REQUIRED here: a cacheable private document would keep
      // being served by the browser's HTTP cache even after the viewer logs
      // out (the cache is keyed by URL, not by credentials) — observed live
      // with `private, max-age=60`. Privacy beats the small re-download cost,
      // and every authorised staff view now always reaches the access log.
      headers: { 'Content-Type': mime, 'Cache-Control': 'private, no-store' },
    })
  } catch {
    return fail(404, 'NOT_FOUND', 'Document no longer exists.')
  }
})
