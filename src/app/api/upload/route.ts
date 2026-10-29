import { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { route, ok, fail, requireUser, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'

const MAX_SIZE = 5 * 1024 * 1024 // 5MB

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const DOC_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

/**
 * Unified upload endpoint.
 *  - kind=image  → vehicle/listing photos → public/uploads (publicly viewable URLs)
 *  - kind=document → verification documents → private data/uploads, served only
 *    through /api/files/<name> to the uploader and authorised reviewers.
 * Private documents never get a public URL.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`upload:${getIp(req)}:${user.id}`, 40, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', `Upload limit reached. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)

  const form = await req.formData()
  const file = form.get('file')
  const kind = String(form.get('kind') || 'image')

  if (!(file instanceof File)) return fail(400, 'NO_FILE', 'Attach a file to upload.')
  if (file.size > MAX_SIZE) return fail(413, 'FILE_TOO_LARGE', 'Files must be 5MB or smaller.')

  const isDoc = kind === 'document'
  const types = isDoc ? DOC_TYPES : IMAGE_TYPES
  const ext = types[file.type]
  if (!ext) {
    return fail(415, 'UNSUPPORTED_TYPE', isDoc ? 'Documents must be JPG, PNG, WEBP or PDF.' : 'Images must be JPG, PNG or WEBP.')
  }

  const id = randomBytes(8).toString('hex')
  // Private docs embed the uploader id so /api/files can authorise access.
  const name = isDoc ? `${user.id}.${id}.${ext}` : `${id}.${ext}`

  const dir = isDoc ? path.join(process.cwd(), 'data', 'uploads') : path.join(process.cwd(), 'public', 'uploads')
  await mkdir(dir, { recursive: true })
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(dir, name), buffer)

  return ok({
    url: isDoc ? `/api/files/${name}` : `/uploads/${name}`,
    name: file.name,
    size: file.size,
    kind: isDoc ? 'document' : 'image',
  })
})
