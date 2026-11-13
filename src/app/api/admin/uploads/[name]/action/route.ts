import { NextRequest } from 'next/server'
import { rename, unlink, access } from 'fs/promises'
import path from 'path'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, fail, parseBody, requireRole } from '@/lib/api'
import { ROLE } from '@/lib/auth'
import { assertNotDemoStaffRead } from '@/lib/demo'
import { audit } from '@/lib/audit'
import { scanStoredFile } from '@/lib/malware-scan'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ name: string }> }

const schema = z.object({
  action: z.enum(['rescan', 'approve', 'reject']),
  note: z.string().trim().max(300).optional(),
})

/**
 * POST /api/admin/uploads/[name]/action — human review of the upload
 * quarantine queue. REVIEWER/MODERATOR/ADMIN/FOUNDER only.
 *
 *  - rescan:  run the malware scanner again (use after installing ClamAV or
 *             fixing the scanner). CLEAN releases the file from quarantine.
 *  - approve: record APPROVED_MANUAL — the file becomes viewable. This is an
 *             explicit human judgement after reviewing the file, audited with
 *             the reviewer identity and an optional note. It is NOT an
 *             automated approval and never happens silently.
 *  - reject:  permanently remove the bytes and mark the record REJECTED —
 *             used for anything suspicious or unwanted.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireRole(ROLE.REVIEWER, ROLE.MODERATOR, ROLE.ADMIN, ROLE.FOUNDER)
  assertNotDemoStaffRead(user, 'upload review actions (real users files)')
  const { name } = await ctx.params
  const body = await parseBody(req, schema)

  if (!/^[A-Za-z0-9_-]+\.[a-f0-9]{16}\.(jpg|png|webp|pdf)$/.test(name)) {
    return fail(400, 'INVALID_NAME', 'Invalid file reference.')
  }
  const record = await db.uploadRecord.findUnique({ where: { fileName: name } })
  if (!record) return fail(404, 'NOT_FOUND', 'Upload record not found.')

  const quarantinePath = path.join(process.cwd(), 'data', 'quarantine', name)
  const privatePath = path.join(process.cwd(), 'data', 'uploads', name)
  const inQuarantine = record.quarantined && !['CLEAN', 'APPROVED_MANUAL'].includes(record.scanStatus)

  if (body.action === 'rescan') {
    const sourcePath = inQuarantine ? quarantinePath : privatePath
    let bytesExist = false
    try { await access(sourcePath); bytesExist = true } catch { /* not on disk */ }
    if (!bytesExist) {
      return fail(409, 'NO_BYTES', record.scanStatus === 'INFECTED'
        ? 'Infected bytes were already destroyed; nothing to rescan.'
        : 'The file bytes are no longer on disk; the record is stale.')
    }
    const verdict = await scanStoredFile(sourcePath)
    if (verdict.status === 'CLEAN') {
      if (inQuarantine && record.visibility === 'PRIVATE') {
        await rename(quarantinePath, privatePath).catch(() => null)
      }
      const updated = await db.uploadRecord.update({
        where: { id: record.id },
        data: { scanStatus: 'CLEAN', scannedAt: new Date(), quarantined: false },
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'UPLOAD_RESCAN_CLEAN', targetType: 'upload', targetId: name, metadata: { scanner: verdict.scanner } })
      return ok({ record: updated, message: 'Scan reported clean; the file is released from quarantine.' })
    }
    if (verdict.status === 'INFECTED') {
      await unlink(quarantinePath).catch(() => null)
      await unlink(privatePath).catch(() => null)
      const updated = await db.uploadRecord.update({
        where: { id: record.id },
        data: { scanStatus: 'INFECTED', scannedAt: new Date(), quarantined: false },
      })
      await audit({ actorId: user.id, actorName: user.name, action: 'UPLOAD_RESCAN_INFECTED', targetType: 'upload', targetId: name, metadata: { detail: verdict.detail, scanner: verdict.scanner } })
      return ok({ record: updated, message: 'Scan reported INFECTED: the bytes were destroyed and the file is permanently blocked.' })
    }
    await audit({ actorId: user.id, actorName: user.name, action: 'UPLOAD_RESCAN_ERROR', targetType: 'upload', targetId: name, metadata: { detail: 'status' in verdict ? verdict.status : 'unknown' } })
    return fail(503, 'SCAN_ERROR', 'The scanner reported an error or is unavailable; the file stays quarantined.')
  }

  if (body.action === 'approve') {
    if (!inQuarantine) {
      return fail(409, 'NOT_QUARANTINED', 'Only a quarantined file needs approval (it may already be released).')
    }
    const sourcePath = quarantinePath
    try { await access(sourcePath) } catch {
      return fail(409, 'NO_BYTES', 'The quarantined bytes are no longer on disk.')
    }
    await rename(sourcePath, privatePath).catch(() => null)
    const updated = await db.uploadRecord.update({
      where: { id: record.id },
      data: { scanStatus: 'APPROVED_MANUAL', scannedAt: new Date(), quarantined: false },
    })
    await audit({
      actorId: user.id,
      actorName: user.name,
      action: 'UPLOAD_MANUALLY_APPROVED',
      targetType: 'upload',
      targetId: name,
      metadata: { note: body.note ?? null, owner: record.ownerUserId, kind: record.kind, accessKind: record.accessKind },
    })
    return ok({ record: updated, message: 'Approved after human review: the file is now viewable under its normal access rules. The approval is audit-logged with your identity.' })
  }

  // reject
  await unlink(quarantinePath).catch(() => null)
  await unlink(privatePath).catch(() => null)
  const updated = await db.uploadRecord.update({
    where: { id: record.id },
    data: { scanStatus: 'INFECTED', quarantined: false },
  })
  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'UPLOAD_REJECTED',
    targetType: 'upload',
    targetId: name,
    metadata: { note: body.note ?? null, owner: record.ownerUserId },
  })
  return ok({ record: updated, message: 'Rejected: the bytes were destroyed and the file is permanently blocked.' })
})
