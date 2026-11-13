import { db } from '@/lib/db'
import { notify, notifyMany } from '@/lib/notify'

/**
 * Application SLA sweep — the follow-up engine for dealer/garage applications.
 *
 * Idempotent (max one reminder set per application per 12h). Runs from the
 * admin Control Center AND from the scheduled-job runner (src/lib/jobs.ts):
 * the rules below are the single shared implementation.
 *
 * Rules:
 *  - SUBMITTED / RESUBMITTED older than reviewSlaHours without an assigned
 *    reviewer → reminder + escalation flag to reviewers.
 *  - MORE_INFO_REQUIRED past correctionsDueAt → reminder to applicant;
 *    if more than 7 days overdue → escalate to reviewers too.
 */
export async function runApplicationSweep(): Promise<{
  reviewed: number
  reviewerReminders: number
  applicantReminders: number
  escalations: number
}> {
  const now = Date.now()
  const active = await db.application.findMany({
    where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'RESUBMITTED'] } },
  })

  let remindersSent = 0
  let escalations = 0
  let applicantReminders = 0

  const reviewers = await db.user.findMany({
    where: { OR: [{ roles: { contains: 'REVIEWER' } }, { roles: { contains: 'ADMIN' } }, { roles: { contains: 'FOUNDER' } }], status: 'ACTIVE' },
    select: { id: true },
  })
  const reviewerUserIds = reviewers.map((r) => r.id)

  for (const app of active) {
    const lastReminder = app.lastReminderAt?.getTime() ?? 0
    const reminderDue = now - lastReminder > 12 * 60 * 60 * 1000 // 12h idempotency window

    if (app.status === 'SUBMITTED' || app.status === 'RESUBMITTED') {
      const ageH = app.submittedAt ? (now - app.submittedAt.getTime()) / 3600000 : 0
      if (ageH > app.reviewSlaHours && reminderDue) {
        await db.application.update({
          where: { id: app.id },
          data: {
            lastReminderAt: new Date(),
            reminderCount: { increment: 1 },
            escalated: ageH > app.reviewSlaHours * 2 ? true : app.escalated,
            escalatedAt: ageH > app.reviewSlaHours * 2 ? new Date() : app.escalatedAt,
            events: {
              create: {
                type: 'REMINDER',
                note: `Automated follow-up: application age ${Math.round(ageH)}h exceeds the ${app.reviewSlaHours}h review target${ageH > app.reviewSlaHours * 2 ? ' (escalated)' : ''}.`,
              },
            },
          },
        })
        await notifyMany(reviewerUserIds, {
          type: 'APPLICATION_SLA_DUE',
          title: `${app.escalated || ageH > app.reviewSlaHours * 2 ? 'ESCALATED: ' : ''}${app.refCode} past review SLA`,
          body: `${app.orgName} has waited ${Math.round(ageH)}h (target ${app.reviewSlaHours}h).`,
          link: '/admin?tab=applications',
        })
        remindersSent++
        if (ageH > app.reviewSlaHours * 2) escalations++
      }
    }

    if (app.status === 'MORE_INFO_REQUIRED' && app.correctionsDueAt) {
      const overdueH = (now - app.correctionsDueAt.getTime()) / 3600000
      if (overdueH > 0 && reminderDue) {
        await db.application.update({
          where: { id: app.id },
          data: {
            lastReminderAt: new Date(),
            reminderCount: { increment: 1 },
            events: { create: { type: 'REMINDER', note: `Automated reminder to applicant: corrections overdue by ${Math.round(overdueH)}h.` } },
          },
        })
        await notify({
          userId: app.userId,
          type: 'APPLICATION_CORRECTIONS_OVERDUE',
          title: `Reminder: ${app.refCode} corrections are overdue`,
          body: 'Your requested information is past its deadline. Respond to keep your application alive, otherwise it may be closed.',
          link: app.type === 'DEALER' ? '/dealer' : '/garage-dashboard',
        })
        applicantReminders++
        if (overdueH > 24 * 7) {
          await db.application.update({ where: { id: app.id }, data: { escalated: true, escalatedAt: new Date() } })
          await notifyMany(reviewerUserIds, {
            type: 'APPLICATION_SLA_DUE',
            title: `ESCALATED: ${app.refCode} corrections overdue by >7 days`,
            body: `${app.orgName} has not responded to the information request. Consider closing the application per policy.`,
            link: '/admin?tab=applications',
          })
          escalations++
        }
      }
    }
  }

  return { reviewed: active.length, reviewerReminders: remindersSent, applicantReminders, escalations }
}

/** Delete expired password-reset tokens older than the given grace window. */
export async function cleanupExpiredResetTokens(graceDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000)
  const removed = await db.passwordResetToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { not: null, lt: cutoff } }] },
  })
  return removed.count
}

/**
 * Subscription expiry sweep.
 *
 * ACTIVE subscriptions more than 3 days past currentPeriodEnd become
 * PAST_DUE (the same grace window the entitlement service applies). The
 * subscription and all its data are preserved — only the status changes and
 * owners are notified. Idempotent: PAST_DUE rows are never re-notified.
 */
export async function runSubscriptionExpirySweep(): Promise<{ expired: number }> {
  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // matches entitlement grace
  const due = await db.subscription.findMany({
    where: { status: 'ACTIVE', currentPeriodEnd: { lt: cutoff } },
    include: { org: { select: { name: true } } },
  })
  for (const sub of due) {
    await db.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } })
    const members = await db.orgMember.findMany({ where: { orgId: sub.orgId, role: 'OWNER' }, select: { userId: true } })
    await notifyMany(members.map((m) => m.userId), {
      type: 'SUBSCRIPTION_PAST_DUE',
      title: `Subscription expired: ${sub.planCode}`,
      body: `The ${sub.planCode} plan for ${sub.org.name} expired on ${sub.currentPeriodEnd.toISOString().slice(0, 10)}. Pay the renewal invoice to reactivate — your data is safe.`,
      link: '/account?tab=subscriptions',
    })
  }
  return { expired: due.length }
}

/** Campaign expiry sweep: ACTIVE campaigns past endsAt become ENDED. */
export async function runCampaignExpirySweep(): Promise<{ ended: number }> {
  const now = new Date()
  const due = await db.campaign.findMany({
    where: { status: 'ACTIVE', endsAt: { lt: now } },
    select: { id: true, refCode: true, orgId: true },
  })
  for (const c of due) {
    await db.campaign.update({ where: { id: c.id }, data: { status: 'ENDED' } })
    const members = await db.orgMember.findMany({ where: { orgId: c.orgId, role: 'OWNER' }, select: { userId: true } })
    await notifyMany(members.map((m) => m.userId), {
      type: 'CAMPAIGN_ENDED',
      title: `Campaign ${c.refCode} ended`,
      body: 'The promotion period is over. The vehicle is no longer highlighted in search results.',
      link: '/dealer?tab=billing',
    })
  }
  return { ended: due.length }
}

/** Clear expired verification codes (email + phone) — codes never linger. */
export async function cleanupExpiredVerificationCodes(): Promise<{ cleared: number }> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000) // 1h past expiry
  const stale = await db.user.updateMany({
    where: {
      OR: [
        { emailCode: { not: null }, emailCodeExpiresAt: { lt: cutoff } },
        { phoneCode: { not: null }, phoneCodeExpiresAt: { lt: cutoff } },
      ],
    },
    data: { emailCode: null, emailCodeExpiresAt: null, emailCodeAttempts: 0, phoneCode: null, phoneCodeExpiresAt: null, phoneCodeAttempts: 0 },
  })
  return { cleared: stale.count }
}

/**
 * Offer expiry sweep: PENDING dealer offers past expiresAt become EXPIRED.
 * The accept endpoint also checks expiry at decision time, so this sweep only
 * keeps the listing board honest between decisions. Idempotent.
 */
export async function runOfferExpirySweep(): Promise<{ expired: number }> {
  const now = new Date()
  const due = await db.offer.findMany({
    where: { status: 'PENDING', expiresAt: { lt: now } },
    select: { id: true, orgId: true },
  })
  for (const o of due) {
    await db.offer.update({ where: { id: o.id }, data: { status: 'EXPIRED' } })
    const members = await db.orgMember.findMany({
      where: { orgId: o.orgId, role: { in: ['OWNER', 'MANAGER', 'SALES'] } },
      select: { userId: true },
    })
    await notifyMany(members.map((m) => m.userId), {
      type: 'OFFER_UPDATE',
      title: 'Your offer expired',
      body: 'A seller did not respond to your offer before it expired. You can send a new offer at any time.',
      link: '/dealer',
    })
  }
  return { expired: due.length }
}

/**
 * Upload quarantine sweep (hourly): when a malware scanner is available (it
 * may have been installed after files were uploaded), re-scan quarantined
 * documents/evidence and release the clean ones. Files stay locked until a
 * real scan verdict or a staff approval — the sweep never approves by itself.
 */
export async function runUploadQuarantineSweep(): Promise<{ scanned: number; released: number; infected: number }> {
  const { detectScanner, scanStoredFile } = await import('@/lib/malware-scan')
  const scanner = await detectScanner()
  if (!scanner) return { scanned: 0, released: 0, infected: 0 }

  const pending = await db.uploadRecord.findMany({
    where: { quarantined: true, scanStatus: { notIn: ['CLEAN', 'APPROVED_MANUAL'] } },
    select: { id: true, fileName: true, scanStatus: true },
  })
  const { rename, unlink, access } = await import('fs/promises')
  const path = await import('path')
  let scanned = 0
  let released = 0
  let infected = 0
  for (const rec of pending) {
    const qPath = path.join(process.cwd(), 'data', 'quarantine', rec.fileName)
    const pPath = path.join(process.cwd(), 'data', 'uploads', rec.fileName)
    try {
      await access(qPath)
    } catch {
      continue // bytes not in quarantine (already moved or removed)
    }
    const verdict = await scanStoredFile(qPath)
    scanned++
    if (verdict.status === 'CLEAN') {
      await rename(qPath, pPath).catch(() => null)
      await db.uploadRecord.update({ where: { id: rec.id }, data: { scanStatus: 'CLEAN', scannedAt: new Date(), quarantined: false } })
      released++
    } else if (verdict.status === 'INFECTED') {
      await unlink(qPath).catch(() => null)
      await db.uploadRecord.update({ where: { id: rec.id }, data: { scanStatus: 'INFECTED', scannedAt: new Date(), quarantined: false } })
      infected++
    }
    // SCAN_ERROR / SCANNER_UNAVAILABLE: stay quarantined; retried next sweep.
  }
  return { scanned, released, infected }
}

/**
 * Evidence retention sweep (daily): EVIDENCE files whose access expired more
 * than the grace window ago are deleted from disk and their record removed —
 * sensitive evidence does not linger forever after access has ended.
 * Non-evidence files are never touched by this sweep.
 */
export async function runEvidenceRetentionSweep(graceDays = 90): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000)
  const due = await db.uploadRecord.findMany({
    where: { accessKind: 'EVIDENCE', expiresAt: { lt: cutoff } },
    select: { id: true, fileName: true },
  })
  const { unlink } = await import('fs/promises')
  const path = await import('path')
  let deleted = 0
  for (const rec of due) {
    await unlink(path.join(process.cwd(), 'data', 'uploads', rec.fileName)).catch(() => null)
    await db.fileAccessLog.deleteMany({ where: { uploadRecordId: rec.id } })
    await db.uploadRecord.delete({ where: { id: rec.id } }).catch(() => null)
    deleted++
  }
  return { deleted }
}
