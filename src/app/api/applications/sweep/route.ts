import { db } from '@/lib/db'
import { route, ok, requireRole } from '@/lib/api'
import { demoStaffMutationGuard } from '@/lib/demo'
import { notify, notifyMany } from '@/lib/notify'
import { audit } from '@/lib/audit'

/**
 * Follow-up engine sweep for dealer/garage applications.
 *
 * Runs idempotently (max one reminder set per application per 12h). Called
 * from the admin Control Center on load; in production this would also be a
 * scheduled job — documented limitation of this single-process deployment.
 *
 * Rules:
 *  - SUBMITTED / RESUBMITTED older than reviewSlaHours without an assigned
 *    reviewer → reminder + escalation flag to reviewers.
 *  - MORE_INFO_REQUIRED past correctionsDueAt → reminder to applicant;
 *    if more than 7 days overdue → escalate to reviewers too.
 */
export const POST = route(async () => {
  const staffUser = await requireRole('REVIEWER', 'ADMIN', 'FOUNDER', 'SUPPORT')
  // DEMO SANDBOX: SLA automation is a platform-wide operation.
  await demoStaffMutationGuard(staffUser, { platformWide: true })

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
                note: `Automated follow-up: application age ${Math.round(ageH)}h exceeds the ${app.reviewSlaHours}h review target${ageH > app.reviewSlaHours * 2 ? ' — escalated' : ''}.`,
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

  await audit({
    action: 'APPLICATION_SWEEP',
    metadata: { reviewed: active.length, reviewerReminders: remindersSent, applicantReminders, escalations },
  })

  return ok({
    reviewed: active.length,
    reviewerReminders: remindersSent,
    applicantReminders,
    escalations,
  })
})
