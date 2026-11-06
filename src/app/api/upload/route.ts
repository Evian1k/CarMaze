import { NextRequest } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { randomBytes } from 'crypto'
import { route, ok, fail, requireUser } from '@/lib/api'

export const dynamic = 'force-dynamic'

/**
 * POST /api/upload — authenticated file upload.
 *
 * kind=image    → shared public media (listing photos, storefront images,
 *                 product images, conversation attachments). Served by
 *                 GET /api/media/[name] with NO ownership check by design.
 * kind=document → private verification documents (IDs, licenses, logbooks,
 *                 business registration). Served ONLY by GET /api/files/[name]
 *                 to the uploader and platform reviewers/staff — never a
 *                 public URL.
 *
 * Filenames are `<uploaderUserId>.<16hexrandom>.<ext>`. The strict regex in
 * both serving routes makes traversal impossible. Uploading is never
 * verification: documents enter the review pipeline as SUBMITTED.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()

  const form = await req.formData()
  const file = form.get('file')
  const kind = String(form.get('kind') ?? 'image')

  if (!(file instanceof File)) {
    return fail(400, 'NO_FILE', 'Attach the file in the "file" field.')
  }
  if (file.size === 0) {
    return fail(400, 'EMPTY_FILE', 'The selected file is empty.')
  }
  if (file.size > 8 * 1024 * 1024) {
    return fail(413, 'TOO_LARGE', 'Maximum upload size is 8 MB.')
  }

  const isDocument = kind === 'document' || kind === 'doc' || kind === 'file'
  const extByMime: Record<string, string> = isDocument
    ? { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }
    : { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

  const ext = extByMime[file.type]
  if (!ext) {
    return fail(
      415,
      'UNSUPPORTED_TYPE',
      isDocument
        ? 'Documents must be JPG, PNG, WEBP or PDF.'
        : 'Images must be JPG, PNG or WEBP.'
    )
  }

  const name = `${user.id}.${randomBytes(8).toString('hex')}.${ext}`
  const dir = isDocument
    ? path.join(process.cwd(), 'data', 'uploads')
    : path.join(process.cwd(), 'data', 'uploads', 'media')

  await mkdir(dir, { recursive: true })
  const bytes = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(dir, name), bytes)

  const url = isDocument ? `/api/files/${name}` : `/api/media/${name}`
  return ok({
    url,
    name: file.name,
    stored: name,
    kind: isDocument ? 'document' : 'image',
  })
})
