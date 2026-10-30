import { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { route, ok, fail, requireUser } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 6 * 1024 * 1024 // 6MB
const MEDIA_DIR = path.join(process.cwd(), 'data', 'uploads', 'media')

/** ext → mime allowlist; both must match before a file is accepted. */
const ALLOWED: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

/**
 * Shared media upload (storefront images, marketplace photos, chat
 * attachments, custody condition photos…).
 * Stored under data/uploads/media as `<userId>.<16hexrandom>.<ext>` and served
 * publicly via GET /api/media/<name> — media URLs are shareable by design,
 * unlike /api/files which is owner-scoped.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`upload:${user.id}`, 60, 5 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many uploads. Try again shortly.')

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return fail(400, 'INVALID_FORM', 'Request must be multipart form data with a "file" field.')
  }

  const file = form.get('file')
  if (!file || typeof file === 'string') {
    return fail(400, 'NO_FILE', 'No file was provided. Send multipart form data with a "file" field.')
  }

  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  const expectedMime = ALLOWED[ext]
  if (!expectedMime) {
    return fail(400, 'UNSUPPORTED_TYPE', 'Unsupported file type. Allowed: jpg, jpeg, png, webp, pdf.')
  }
  if (file.type !== expectedMime) {
    return fail(400, 'MIME_MISMATCH', `File content type must be ${expectedMime} for a .${ext} file.`)
  }
  if (file.size <= 0) {
    return fail(400, 'EMPTY_FILE', 'The uploaded file is empty.')
  }
  if (file.size > MAX_BYTES) {
    return fail(413, 'FILE_TOO_LARGE', 'File exceeds the 6MB limit.')
  }

  const name = `${user.id}.${randomBytes(8).toString('hex')}.${ext}`
  await mkdir(MEDIA_DIR, { recursive: true })
  await writeFile(path.join(MEDIA_DIR, name), Buffer.from(await file.arrayBuffer()))

  return ok({ url: `/api/media/${name}`, name })
})
