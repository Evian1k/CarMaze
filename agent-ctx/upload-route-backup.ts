import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { randomBytes } from 'crypto'
import { route, requireUser, ApiError, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { db } from '@/lib/db'

/**
 * POST /api/upload — the single secure upload endpoint for the whole app.
 *
 * Contract (must keep matching every client call site, which send FormData
 * fields `file`, optional `kind` ('document' | 'image') and optional `purpose`):
 *   → 201 { url, name, size, kind }   url: /api/media/<name> (PUBLIC) or /api/files/<name> (PRIVATE)
 *
 * Security posture:
 *  - authenticated; 60 uploads / 15 min per user (+IP)
 *  - allowlist: JPG / PNG / WEBP for public media; PDF additionally allowed
 *    for `kind=document` (stored privately, served owner/staff-only)
 *  - magic-byte sniffing: the DECLARED MIME must match the ACTUAL bytes
 *    (anti-spoof); unknown bytes are refused outright
 *  - size caps: 8 MB images, 10 MB documents
 *  - server-generated names `<userId>.<16hex>.<ext>` — matches the strict
 *    regexes of both serving routes, so traversal is impossible
 *  - exclusive-create write ('wx') with collision retry; private documents
 *    live in data/uploads, public media in data/uploads/media
 *  - every upload is recorded (UploadRecord) and audit-logged (FILE_UPLOADED)
 *
 * NOTE: this file was recreated three times after sandbox file-loss events —
 * it MUST stay tracked in git (see the remediation addendum in
 * docs/CARMAZE_PRODUCTION_READINESS_REPORT.md). A restore copy lives at
 * agent-ctx/upload-route-backup.ts.
 */

const PUBLIC_DIR = path.join(process.cwd(), 'data', 'uploads', 'media')
const PRIVATE_DIR = path.join(process.cwd(), 'data', 'uploads')

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const RATE_LIMIT = 60
const RATE_WINDOW_MS = 15 * 60 * 1000

type Sniffed = 'png' | 'jpeg' | 'webp' | 'pdf'

/** Actual type from magic bytes only — the client's declared type is never trusted. */
function sniff(buf: Uint8Array): Sniffed | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'webp'
  if (buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d) return 'pdf' // "%PDF-"
  return null
}

const EXT: Record<Sniffed, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', pdf: 'pdf' }
const MIME_OF: Record<Sniffed, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' }

/** Declared MIME → canonical kind. `image/jpg` is normalised to jpeg. */
const DECLARED: Record<string, Sniffed> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

/**
 * Malware-scanning hook point. No scanner is configured in this deployment —
 * stated honestly rather than simulated: the function is a pass-through and
 * a real scanner (e.g. ClamAV via a sidecar service) plugs in here without
 * touching any call site.
 */
async function scanForMalware(_bytes: Uint8Array, _meta: { name: string; mimeType: string }): Promise<void> {
  return
}

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()

  const rl = rateLimit(`upload:${user.id}:${getIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', message: `Too many uploads. Try again in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }

  let fd: FormData
  try {
    fd = await req.formData()
  } catch {
    throw new ApiError(400, 'INVALID_FORM', 'Upload must be sent as multipart form data.')
  }

  const rawKind = String(fd.get('kind') ?? '').trim().toLowerCase()
  if (rawKind !== '' && rawKind !== 'image' && rawKind !== 'document') {
    throw new ApiError(400, 'INVALID_KIND', 'Upload kind must be "image" or "document".')
  }
  const isDocument = rawKind === 'document'

  const file = fd.get('file')
  if (!(file instanceof File) || file.size === 0) {
    throw new ApiError(400, 'NO_FILE', 'Attach a file to upload.')
  }

  const cap = isDocument ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES
  if (file.size > cap) {
    throw new ApiError(413, 'FILE_TOO_LARGE', `File exceeds the ${Math.floor(cap / (1024 * 1024))} MB limit for ${isDocument ? 'documents' : 'images'}.`)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength > cap) {
    throw new ApiError(413, 'FILE_TOO_LARGE', `File exceeds the ${Math.floor(cap / (1024 * 1024))} MB limit for ${isDocument ? 'documents' : 'images'}.`)
  }

  const actual = sniff(bytes)
  if (!actual) {
    throw new ApiError(415, 'UNSUPPORTED_TYPE', 'Unsupported file content. Allowed: JPG, PNG, WEBP images' + (isDocument ? ' and PDF documents.' : '.'))
  }

  // PDFs are only accepted as private documents — never public media.
  const allowed: Sniffed[] = isDocument ? ['png', 'jpeg', 'webp', 'pdf'] : ['png', 'jpeg', 'webp']
  if (!allowed.includes(actual)) {
    throw new ApiError(415, 'UNSUPPORTED_TYPE', 'This file type is not allowed for this upload kind.')
  }

  const declaredRaw = (file.type || '').split(';')[0].trim().toLowerCase()
  // Anti-spoof: if the client declared ANY concrete type, it must agree with
  // the magic bytes (e.g. PNG bytes declared "text/plain" → CONTENT_MISMATCH).
  // An empty declaration is tolerated — the magic bytes decide.
  if (declaredRaw && DECLARED[declaredRaw] !== actual) {
    throw new ApiError(415, 'CONTENT_MISMATCH', 'The file content does not match its declared type.')
  }

  const purpose = String(fd.get('purpose') ?? '').trim().slice(0, 120)

  await scanForMalware(bytes, { name: file.name, mimeType: MIME_OF[actual] })

  // Server-generated name: <userId>.<16hex>.<ext> — the serving routes'
  // regexes whitelist exactly this shape, so the stored name cannot smuggle
  // a traversal or a double extension.
  const dir = isDocument ? PRIVATE_DIR : PUBLIC_DIR
  await mkdir(dir, { recursive: true })

  let fileName = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = `${user.id}.${randomBytes(8).toString('hex')}.${EXT[actual]}`
    try {
      // 'wx': exclusive create — an existing file is never overwritten.
      await writeFile(path.join(dir, candidate), bytes, { flag: 'wx' })
      fileName = candidate
      break
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code
      if (code === 'EEXIST') continue // astronomically unlikely; retry with fresh randomness
      throw e
    }
  }
  if (!fileName) {
    throw new ApiError(500, 'UPLOAD_FAILED', 'Could not store the file. Please try again.')
  }

  const url = `${isDocument ? '/api/files' : '/api/media'}/${fileName}`
  const kindLabel = isDocument ? 'DOCUMENT' : 'IMAGE'

  try {
    await db.uploadRecord.create({
      data: {
        ownerUserId: user.id,
        fileName,
        url,
        kind: kindLabel,
        visibility: isDocument ? 'PRIVATE' : 'PUBLIC',
        mimeType: MIME_OF[actual],
        sizeBytes: bytes.byteLength,
        purpose: purpose || null,
      },
    })
  } catch (e) {
    console.error('[upload] record failed', e)
    throw new ApiError(500, 'UPLOAD_FAILED', 'File stored but could not be registered. Please retry.')
  }

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'FILE_UPLOADED',
    targetType: 'upload',
    targetId: fileName,
    metadata: { kind: kindLabel, visibility: isDocument ? 'PRIVATE' : 'PUBLIC', mimeType: MIME_OF[actual], sizeBytes: bytes.byteLength, purpose: purpose || null },
  })

  return NextResponse.json(
    { url, name: fileName, size: bytes.byteLength, kind: kindLabel },
    { status: 201 }
  )
})
