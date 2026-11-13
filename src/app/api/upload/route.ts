import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile, rename, unlink } from 'fs/promises'
import path from 'path'
import { randomBytes } from 'crypto'
import { route, requireUser, ApiError, getIp } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { scanStoredFile } from '@/lib/malware-scan'

/**
 * POST /api/upload — the single secure upload endpoint for the whole app.
 *
 * Contract (must keep matching every client call site, which send FormData
 * fields `file`, optional `kind` and optional `purpose`):
 *   kind '' | 'image'    → PUBLIC media   (/api/media/<name>): JPG/PNG/WEBP
 *   kind 'document'      → PRIVATE file   (/api/files/<name>): owner/staff only
 *   kind 'evidence'      → PRIVATE file   (/api/files/<name>): owner/staff/case
 *                                             participants, 1-year access expiry,
 *                                             every view/denial audit-logged
 *   → 201 { url, name, size, kind, scanStatus, viewable }
 *
 * Security posture:
 *  - authenticated; 60 uploads / 15 min per user (+IP)
 *  - allowlist + magic-byte sniffing: the DECLARED MIME must match the ACTUAL
 *    bytes (anti-spoof); unknown bytes are refused outright
 *  - size caps: 8 MB images, 10 MB documents/evidence
 *  - server-generated names `<userId>.<16hex>.<ext>` — matches the strict
 *    regexes of both serving routes, so traversal is impossible
 *  - exclusive-create write ('wx') with collision retry
 *  - every upload is recorded (UploadRecord) and audit-logged (FILE_UPLOADED)
 *
 * Malware workflow (fail-closed, honest):
 *  - PDFs (the active-content class) are stored in data/quarantine and are
 *    NEVER served until a scanner verdict reports CLEAN or platform staff
 *    approve after human review (audited console /api/admin/uploads). With no
 *    scanner installed the upload still succeeds but reports
 *    scanStatus=SCANNER_UNAVAILABLE, viewable=false — nothing is silently
 *    approved; the hourly sweep re-scans once a scanner appears.
 *  - PDFs carrying active content (/JavaScript, /JS, /Launch, /EmbeddedFile,
 *    /OpenAction, /AA) are refused outright (415) before any bytes are kept.
 *  - A scanner INFECTED verdict destroys the bytes immediately and records the
 *    verdict; a scanner ERROR keeps the file quarantined (fail-closed).
 *  - Images (PNG/JPEG/WEBP, enforced inert by magic bytes — SVG/HTML can never
 *    be stored) are not quarantined; an honest scan status is still recorded.
 *
 * NOTE: this file has been recreated repeatedly after sandbox file-loss events
 * (5x before 2026-11-11, and the hardened version was lost again on 2026-11-13
 * because it had never been committed). It MUST be committed to git together
 * with its recovery copies (agent-ctx/critical/api-upload-route.ts,
 * agent-ctx/upload-route-backup.ts).
 */

const PUBLIC_DIR = path.join(process.cwd(), 'data', 'uploads', 'media')
const PRIVATE_DIR = path.join(process.cwd(), 'data', 'uploads')
const QUARANTINE_DIR = path.join(process.cwd(), 'data', 'quarantine')

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const RATE_LIMIT = 60
const RATE_WINDOW_MS = 15 * 60 * 1000
const EVIDENCE_ACCESS_DAYS = 365

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
 * Static active-content refusal for PDFs: these operators can execute code or
 * launch embedded files in a viewer regardless of what a signature scanner
 * says, so they are rejected outright before any bytes are kept.
 * (Byte-wise latin1 scan — catches the plain operators; compressed streams
 * remain the scanner's job, which is exactly why PDFs stay quarantined.)
 */
function pdfHasActiveContent(bytes: Uint8Array): boolean {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b/.test(s)
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
  if (rawKind !== '' && rawKind !== 'image' && rawKind !== 'document' && rawKind !== 'evidence') {
    throw new ApiError(400, 'INVALID_KIND', 'Upload kind must be "image", "document" or "evidence".')
  }
  const isEvidence = rawKind === 'evidence'
  const isDocument = rawKind === 'document'
  const isPrivate = isDocument || isEvidence

  const file = fd.get('file')
  if (!(file instanceof File) || file.size === 0) {
    throw new ApiError(400, 'NO_FILE', 'Attach a file to upload.')
  }

  const cap = isPrivate ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES
  if (file.size > cap) {
    throw new ApiError(413, 'FILE_TOO_LARGE', `File exceeds the ${Math.floor(cap / (1024 * 1024))} MB limit for ${isEvidence ? 'evidence' : isDocument ? 'documents' : 'images'}.`)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength > cap) {
    throw new ApiError(413, 'FILE_TOO_LARGE', `File exceeds the ${Math.floor(cap / (1024 * 1024))} MB limit for ${isEvidence ? 'evidence' : isDocument ? 'documents' : 'images'}.`)
  }

  const actual = sniff(bytes)
  if (!actual) {
    throw new ApiError(415, 'UNSUPPORTED_TYPE', 'Unsupported file content. Allowed: JPG, PNG, WEBP images' + (isPrivate ? ' and PDF documents.' : '.'))
  }

  // Images only for public media; PDFs additionally allowed for private kinds.
  const allowed: Sniffed[] = isPrivate ? ['png', 'jpeg', 'webp', 'pdf'] : ['png', 'jpeg', 'webp']
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

  // Active-content PDFs are refused outright — before any bytes are kept.
  if (actual === 'pdf' && pdfHasActiveContent(bytes)) {
    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'FILE_UPLOAD_REFUSED_ACTIVE_CONTENT',
      targetType: 'upload',
      targetId: (file.name || '').slice(0, 120),
      metadata: { mimeType: MIME_OF.pdf, sizeBytes: bytes.byteLength, purpose: String(fd.get('purpose') ?? '').slice(0, 120) || null },
    })
    throw new ApiError(415, 'ACTIVE_CONTENT_REFUSED', 'PDFs with active content (JavaScript, embedded files or launch actions) are not accepted.')
  }

  const purpose = String(fd.get('purpose') ?? '').trim().slice(0, 120)

  // Server-generated name: <userId>.<16hex>.<ext> — the serving routes'
  // regexes whitelist exactly this shape, so the stored name cannot smuggle
  // a traversal or a double extension.
  const kindLabel = isEvidence ? 'EVIDENCE' : isDocument ? 'DOCUMENT' : 'IMAGE'
  const accessKind = isEvidence ? 'EVIDENCE' : isPrivate ? 'PRIVATE_DOC' : 'PUBLIC'
  const visibility = isPrivate ? 'PRIVATE' : 'PUBLIC'
  const pdfQuarantined = actual === 'pdf' // PDFs fail closed until scanned/approved

  const writeDir = pdfQuarantined ? QUARANTINE_DIR : isPrivate ? PRIVATE_DIR : PUBLIC_DIR
  await mkdir(writeDir, { recursive: true })

  let fileName = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = `${user.id}.${randomBytes(8).toString('hex')}.${EXT[actual]}`
    try {
      // 'wx': exclusive create — an existing file is never overwritten.
      await writeFile(path.join(writeDir, candidate), bytes, { flag: 'wx' })
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

  const finalUrl = `${isPrivate ? '/api/files' : '/api/media'}/${fileName}`

  // ── Malware scan (real scanner when installed; honest fail-closed states
  // when not). Never throws: every verdict is mapped below. ──
  const storedPath = path.join(writeDir, fileName)
  let scanStatus: string = 'SCANNER_UNAVAILABLE'
  let scannerUsed: string | null = null
  let infected = false

  const verdict = await scanStoredFile(storedPath)
  if (verdict.status === 'CLEAN') {
    scanStatus = 'CLEAN'
    scannerUsed = verdict.scanner
  } else if (verdict.status === 'INFECTED') {
    scanStatus = 'INFECTED'
    scannerUsed = verdict.scanner
    infected = true
  } else if (verdict.status === 'SCAN_ERROR') {
    // Fail closed for the active-content class (PDFs): they stay locked.
    // Inert images keep serving with the honest SCAN_ERROR on record.
    scanStatus = 'SCAN_ERROR'
  } else {
    scanStatus = 'SCANNER_UNAVAILABLE'
  }

  if (infected) {
    // Destroy the bytes immediately; the record keeps the verdict.
    await unlink(storedPath).catch(() => null)
    await db.uploadRecord.create({
      data: {
        ownerUserId: user.id,
        fileName,
        url: finalUrl,
        kind: kindLabel,
        visibility,
        accessKind,
        scanStatus: 'INFECTED',
        scannedAt: new Date(),
        quarantined: false,
        expiresAt: isEvidence ? new Date(Date.now() + EVIDENCE_ACCESS_DAYS * 24 * 60 * 60 * 1000) : null,
        mimeType: MIME_OF[actual],
        sizeBytes: bytes.byteLength,
        purpose: purpose || null,
      },
    }).catch(() => null)
    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'FILE_UPLOAD_INFECTED',
      targetType: 'upload',
      targetId: fileName,
      metadata: { kind: kindLabel, scanner: scannerUsed, sizeBytes: bytes.byteLength },
    })
    throw new ApiError(415, 'UNSAFE_FILE_REFUSED', 'The file failed the malware scan and was not accepted.')
  }

  // PDF clean-scan release: move the bytes out of quarantine right away.
  if (pdfQuarantined && scanStatus === 'CLEAN') {
    await rename(storedPath, path.join(PRIVATE_DIR, fileName)).catch(() => null)
  }

  const quarantined = pdfQuarantined && !['CLEAN'].includes(scanStatus)
  const viewable = !quarantined

  try {
    await db.uploadRecord.create({
      data: {
        ownerUserId: user.id,
        fileName,
        url: finalUrl,
        kind: kindLabel,
        visibility,
        accessKind,
        scanStatus,
        scannedAt: ['CLEAN', 'INFECTED', 'SCAN_ERROR'].includes(scanStatus) ? new Date() : null,
        quarantined,
        expiresAt: isEvidence ? new Date(Date.now() + EVIDENCE_ACCESS_DAYS * 24 * 60 * 60 * 1000) : null,
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
    action: quarantined ? 'FILE_QUARANTINED' : 'FILE_UPLOADED',
    targetType: 'upload',
    targetId: fileName,
    metadata: {
      kind: kindLabel,
      accessKind,
      visibility,
      mimeType: MIME_OF[actual],
      sizeBytes: bytes.byteLength,
      scanStatus,
      quarantined,
      purpose: purpose || null,
    },
  })

  return NextResponse.json(
    { url: finalUrl, name: fileName, size: bytes.byteLength, kind: kindLabel, scanStatus, viewable },
    { status: 201 }
  )
})
