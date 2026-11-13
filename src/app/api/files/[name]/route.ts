import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { route, fail, requireUser, ApiError } from '@/lib/api'
import { hasRole, STAFF_ROLES } from '@/lib/auth'
import { assertNotDemoStaffRead } from '@/lib/demo'
import { db } from '@/lib/db'
import { isEvidenceParticipant } from '@/lib/evidence-acl'

type Ctx = { params: Promise<{ name: string }> }

/**
 * Authorised access to privately stored files: verification documents,
 * application business documents and EVIDENCE files (chat attachments,
 * protection-incident evidence, proof-of-delivery photos, custody photos,
 * dispute evidence).
 *
 * Access rules:
 *  - uploader (owner) always;
 *  - platform staff (never for demo sessions on other people's files);
 *  - EVIDENCE files additionally serve their case participants
 *    (conversation/incident/delivery/custody/dispute), derived from the
 *    entity rows that reference the file — until the file's access expires.
 *  - Quarantine workflow: a file still awaiting a malware verdict
 *    (quarantined, not yet CLEAN/APPROVED_MANUAL) is NOT served to anyone.
 *    An INFECTED record never serves (its bytes were already deleted).
 *
 * Every non-owner view and every denial is recorded in FileAccessLog:
 * data-protection evidence of who saw what, when.
 */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { name } = await ctx.params

  // strict filename validation: no traversal
  if (!/^[A-Za-z0-9_-]+\.[a-f0-9]{16}\.(jpg|png|webp|pdf)$/.test(name)) {
    return fail(400, 'INVALID_NAME', 'Invalid document reference.')
  }

  const record = await db.uploadRecord.findUnique({ where: { fileName: name } })
  const ownerId = name.split('.')[0]
  const isOwner = ownerId === user.id
  const isStaff = hasRole(user, ...STAFF_ROLES)

  // Denial helper — logs then throws.
  const deny = async (reason: string, message: string, status = 403): Promise<never> => {
    if (record) {
      await db.fileAccessLog.create({
        data: { uploadRecordId: record.id, fileName: name, viewerId: user.id, viewerName: user.name, verdict: 'DENIED', reason },
      }).catch(() => null)
    }
    throw new ApiError(status, 'FORBIDDEN', message)
  }

  // Quarantine gate: unscanned private files serve to NOBODY (fail-closed).
  if (record && record.quarantined && !['CLEAN', 'APPROVED_MANUAL'].includes(record.scanStatus)) {
    return fail(423, 'SCAN_PENDING', 'This file is stored pending a malware scan review. It becomes viewable when a scan reports clean or platform staff approve it after review.')
  }
  if (record && record.scanStatus === 'INFECTED') {
    return fail(404, 'NOT_FOUND', 'File no longer exists.') // never reveal infection details
  }

  // Evidence access expiry: after expiresAt only platform staff may still open
  // the file (retention/erasure follow-up), participants can no longer.
  if (record && record.accessKind === 'EVIDENCE' && record.expiresAt && record.expiresAt.getTime() < Date.now() && !isStaff && !isOwner) {
    await deny('EXPIRED', 'Access to this evidence has expired. Contact CARMAZE support if you still need it.', 410)
  }

  if (!isOwner) {
    // Reviewer/staff access to someone else's document: never for demo
    // sessions (identity documents are closed to demo, see demo.ts).
    if (!isStaff) {
      if (record && record.accessKind === 'EVIDENCE') {
        const verdict = await isEvidenceParticipant(name, user.id)
        if (verdict.allowed) {
          await db.fileAccessLog.create({
            data: { uploadRecordId: record.id, fileName: name, viewerId: user.id, viewerName: user.name, verdict: 'ALLOWED', reason: verdict.reason },
          }).catch(() => null)
        } else {
          await deny(verdict.reason ?? 'NOT_AUTHORISED', 'You are not authorised to view this file.')
        }
      } else {
        await deny('NOT_AUTHORISED', 'You are not authorised to view this document.')
      }
    } else {
      assertNotDemoStaffRead(user, 'private documents')
    }
  }

  const filePath = path.join(process.cwd(), 'data', 'uploads', name)
  try {
    const data = await readFile(filePath)
    const ext = name.split('.').pop()
    const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'

    // Legacy access trail: staff views of registered verification documents
    // also land in DocumentAccessLog (the verification console reads it).
    if (isStaff && !isOwner) {
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
    }

    // Primary access trail: every non-owner ALLOWED view is logged.
    if (record && !isOwner) {
      await db.fileAccessLog.create({
        data: { uploadRecordId: record.id, fileName: name, viewerId: user.id, viewerName: user.name, verdict: 'ALLOWED', reason: isStaff ? 'STAFF_REVIEW' : 'EVIDENCE_PARTICIPANT' },
      }).catch(() => null)
    }

    return new NextResponse(new Uint8Array(data), {
      // no-store is REQUIRED here: a cacheable private document would keep
      // being served by the browser's HTTP cache even after the viewer logs
      // out (the cache is keyed by URL, not by credentials) — observed live
      // with `private, max-age=60`. Privacy beats the small re-download cost,
      // and every authorised staff view now always reaches the access log.
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    })
  } catch {
    return fail(404, 'NOT_FOUND', 'Document no longer exists.')
  }
})
