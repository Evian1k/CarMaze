import { NextRequest } from 'next/server'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { randomBytes } from 'crypto'
import { route, requireUser, ApiError, fail } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/upload — the single upload gateway for the whole platform.
 *
 * multipart/form-data fields:
 *   file  (File, required)  — the file to store
 *   kind  (string, optional)— 'document' stores a PRIVATE verification document
 *                             (only the uploader and platform reviewers can fetch it,
 *                             served via /api/files/<name>);
 *                             anything else ('image' / default) stores PUBLIC media
 *                             (listing photos, storefront imagery, conversation
 *                             attachments, custody photos — served via /api/media/<name>).
 *
 * Filenames are `<uploaderUserId>.<16hex>.<ext>` — unguessable, and both serving
 * routes validate the exact same pattern, making path traversal impossible.
 * Response: { url, name, size }
 */

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const DOC_TYPES: Record<string, string> = {
  ...IMAGE_TYPES,
  'application/pdf': 'pdf',
}

const MAX_BYTES = 8 * 1024 * 1024 // 8 MB — matches the client-side guidance

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const limited = rateLimit(`upload:${user.id}:${ip}`, 60, 10 * 60 * 1000)
  if (!limited.allowed) {
    throw new ApiError(429, 'RATE_LIMITED', `Too many uploads — try again in ${limited.retryAfterSec}s.`)
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return fail(400, 'INVALID_FORM', 'Upload must be sent as multipart/form-data.')
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    throw new ApiError(400, 'NO_FILE', 'Attach a file in the "file" field.')
  }
  if (file.size === 0) throw new ApiError(400, 'EMPTY_FILE', 'The selected file is empty.')
  if (file.size > MAX_BYTES) {
    throw new ApiError(413, 'TOO_LARGE', 'Files must be 8 MB or smaller.')
  }

  const kind = String(form.get('kind') ?? 'image')
  const isDocument = kind === 'document'
  const allowed = isDocument ? DOC_TYPES : IMAGE_TYPES
  const ext = allowed[file.type]
  if (!ext) {
    throw new ApiError(
      415,
      'UNSUPPORTED_TYPE',
      isDocument
        ? 'Documents must be JPG, PNG, WEBP or PDF.'
        : 'Images must be JPG, PNG or WEBP.',
    )
  }

  // Verify the bytes actually look like the claimed type (magic numbers) —
  // never trust the client-declared Content-Type alone.
  const buf = Buffer.from(await file.arrayBuffer())
  const magicOk =
    (ext === 'jpg' && buf[0] === 0xff && buf[1] === 0xd8) ||
    (ext === 'png' && buf[0] === 0x89 && buf[1] === 0x50) ||
    (ext === 'webp' && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') ||
    (ext === 'pdf' && buf.toString('ascii', 0, 4) === '%PDF')
  if (!magicOk) {
    throw new ApiError(415, 'INVALID_CONTENT', 'The file contents do not match its type.')
  }

  const name = `${user.id}.${randomBytes(8).toString('hex')}.${ext}`
  const dir = isDocument ? path.join(process.cwd(), 'data', 'uploads') : path.join(process.cwd(), 'data', 'uploads', 'media')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, name), buf)

  return Response.json({
    url: isDocument ? `/api/files/${name}` : `/api/media/${name}`,
    name,
    size: buf.byteLength,
    kind: isDocument ? 'document' : 'image',
  })
})
