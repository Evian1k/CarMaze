import { NextRequest } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { fail } from '@/lib/api'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ name: string }> }

const MEDIA_DIR = path.join(process.cwd(), 'data', 'uploads', 'media')

/**
 * Public media serving for files uploaded via POST /api/upload.
 * Filenames are `<uploaderUserId>.<16hexrandom>.<ext>` — the strict regex
 * below makes traversal impossible. There is NO ownership check: media is
 * shared (marketplace photos, storefront images, attachments inside
 * authorised conversations).
 */
const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { name } = await ctx.params

  // strict filename validation — no traversal
  if (!/^[A-Za-z0-9_-]+\.[a-f0-9]{16}\.(jpg|jpeg|png|webp|pdf)$/.test(name)) {
    return fail(400, 'INVALID_NAME', 'Invalid media reference.')
  }

  try {
    const data = await readFile(path.join(MEDIA_DIR, name))
    const ext = name.split('.').pop() as string
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': MIME[ext],
        'Content-Length': String(data.byteLength),
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    })
  } catch {
    return fail(404, 'NOT_FOUND', 'Media file no longer exists.')
  }
}
