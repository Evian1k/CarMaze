import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, ok, ApiError, requireUser, parseBody, type RouteCtx } from '@/lib/api'
import { hasRole, STAFF_ROLES } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { notify } from '@/lib/notify'
import { notifyOrgMembers } from '@/lib/orgs'
import { demoStaffMutationGuard } from '@/lib/demo'
import { parseJson } from '@/lib/json'

export const dynamic = 'force-dynamic'

type Ctx = RouteCtx

/** reporter, platform staff, or member of the involved org. */
async function accessLevel(
  incident: { reporterId: string; orgId: string | null },
  userId: string,
  isStaff: boolean
): Promise<'REPORTER' | 'STAFF' | 'ORG' | null> {
  if (incident.reporterId === userId) return 'REPORTER'
  if (isStaff) return 'STAFF'
  if (incident.orgId) {
    const membership = await db.orgMember.findFirst({ where: { orgId: incident.orgId, userId } })
    if (membership) return 'ORG'
  }
  return null
}

function iso(d: Date): string {
  return d.toISOString()
}

/** GET: incident with timeline, for the reporter, staff, or involved org. */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params

  const incident = await db.securityIncident.findUnique({
    where: { id },
    include: {
      reporter: { select: { name: true } },
      timeline: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!incident) throw new ApiError(404, 'NOT_FOUND', 'Incident not found.')

  const access = await accessLevel(incident, user.id, hasRole(user, ...STAFF_ROLES))
  if (!access) throw new ApiError(403, 'FORBIDDEN', 'You are not authorised to view this incident.')

  const org = incident.orgId ? await db.org.findUnique({ where: { id: incident.orgId }, select: { name: true } }) : null

  return ok({
    incident: {
      id: incident.id,
      refCode: incident.refCode,
      category: incident.category,
      reporterId: incident.reporterId,
      reporterName: incident.reporter.name,
      reporterSide: incident.reporterSide,
      orgId: incident.orgId,
      orgName: org?.name ?? null,
      custodyId: incident.custodyId,
      testDriveId: incident.testDriveId,
      vehicleDesc: incident.vehicleDesc,
      subjectDesc: incident.subjectDesc,
      title: incident.title,
      details: incident.details,
      evidence: parseJson<string[]>(incident.evidence, []),
      status: incident.status,
      severity: incident.severity,
      assignedTo: incident.assignedTo,
      resolutionNote: incident.resolutionNote,
      resolvedAt: incident.resolvedAt ? iso(incident.resolvedAt) : null,
      createdAt: iso(incident.createdAt),
      updatedAt: iso(incident.updatedAt),
    },
    timeline: incident.timeline.map((e) => ({
      id: e.id,
      type: e.type,
      actorId: e.actorId,
      actorName: e.actorName,
      note: e.note,
      createdAt: iso(e.createdAt),
    })),
    access,
  })
})

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('note'), note: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal('evidence'), evidence: z.array(z.string().trim().min(1).max(500)).min(1).max(6) }),
  z.object({
    action: z.literal('status'),
    status: z.enum(['UNDER_REVIEW', 'ESCALATED', 'RESOLVED', 'DISMISSED']),
    note: z.string().trim().max(4000).optional(),
    assignedTo: z.string().trim().max(120).optional(),
  }),
])

/**
 * PATCH: append a note, add evidence (reporter only), or change status
 * (STAFF ONLY: org members can never resolve/dismiss incidents about their
 * own business).
 */
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser()
  const { id } = await ctx.params

  const incident = await db.securityIncident.findUnique({ where: { id } })
  if (!incident) throw new ApiError(404, 'NOT_FOUND', 'Incident not found.')

  const isStaff = hasRole(user, ...STAFF_ROLES)
  const access = await accessLevel(incident, user.id, isStaff)
  if (!access) throw new ApiError(403, 'FORBIDDEN', 'You are not authorised to act on this incident.')

  const body = await parseBody(req, patchSchema)
  const now = new Date()

  if (body.action === 'note') {
    await db.incidentEvent.create({
      data: { incidentId: id, type: 'NOTE', actorId: user.id, actorName: user.name, note: body.note },
    })
    await audit({ actorId: user.id, actorName: user.name, action: 'INCIDENT_NOTE_ADDED', targetType: 'SECURITY_INCIDENT', targetId: id, metadata: { refCode: incident.refCode } })
    return ok({ incident: { id, refCode: incident.refCode, status: incident.status } })
  }

  if (body.action === 'evidence') {
    if (access !== 'REPORTER') {
      throw new ApiError(403, 'FORBIDDEN', 'Only the reporter can add evidence to this incident.')
    }
    const existing = parseJson<string[]>(incident.evidence, [])
    const merged = [...new Set([...existing, ...body.evidence])]
    if (merged.length > 6) {
      throw new ApiError(400, 'EVIDENCE_LIMIT', 'A maximum of 6 evidence files is allowed.')
    }
    await db.securityIncident.update({ where: { id }, data: { evidence: JSON.stringify(merged) } })
    await db.incidentEvent.create({
      data: { incidentId: id, type: 'EVIDENCE', actorId: user.id, actorName: user.name, note: `${body.evidence.length} evidence file(s) added.` },
    })
    await audit({ actorId: user.id, actorName: user.name, action: 'INCIDENT_EVIDENCE_ADDED', targetType: 'SECURITY_INCIDENT', targetId: id, metadata: { refCode: incident.refCode, count: merged.length } })
    return ok({ incident: { id, refCode: incident.refCode, status: incident.status } })
  }

  // action === 'status': staff only, hard block for org members.
  if (!isStaff) {
    throw new ApiError(403, 'FORBIDDEN', 'Only CARMAZE security staff can change an incident status.')
  }
  // Demo isolation: a demo support session must never mutate a REAL incident
  // (or the real custody record its resolution would move back into the
  // workflow). Demo-owned incidents remain workable for the demo tour.
  await demoStaffMutationGuard(user, { subjectUserId: incident.reporterId, subjectOrgId: incident.orgId })
  if (incident.status === 'RESOLVED' || incident.status === 'DISMISSED') {
    throw new ApiError(400, 'INVALID_TRANSITION', `This incident is already ${incident.status.toLowerCase()} and cannot be reopened here.`)
  }
  if ((body.status === 'RESOLVED' || body.status === 'DISMISSED') && (!body.note || body.note.trim().length < 10)) {
    throw new ApiError(400, 'NOTE_REQUIRED', 'A note (min 10 characters) is required to resolve or dismiss an incident.')
  }

  const data: { status: string; assignedTo?: string; resolutionNote?: string; resolvedAt?: Date } = { status: body.status }
  if (body.assignedTo !== undefined) data.assignedTo = body.assignedTo
  if (body.status === 'RESOLVED' || body.status === 'DISMISSED') {
    data.resolutionNote = body.note?.trim()
    data.resolvedAt = now
  }
  const updated = await db.securityIncident.update({ where: { id }, data })

  const eventType =
    body.status === 'RESOLVED' || body.status === 'DISMISSED'
      ? 'RESOLUTION'
      : body.status === 'ESCALATED'
        ? 'ESCALATION'
        : 'STATUS_CHANGE'
  await db.incidentEvent.create({
    data: {
      incidentId: id,
      type: eventType,
      actorId: user.id,
      actorName: user.name,
      note: body.note ?? `Status changed to ${body.status}.`,
    },
  })
  await audit({ actorId: user.id, actorName: user.name, action: 'INCIDENT_STATUS_CHANGED', targetType: 'SECURITY_INCIDENT', targetId: id, metadata: { refCode: incident.refCode, from: incident.status, to: body.status } })

  // Custody lifecycle exit: a disputed custody record previously had NO path
  // back into the workflow once its incident was resolved/dismissed. When the
  // linked incident is closed, return the custody record to work in progress
  // (the customer/garage can re-run inspection or mark ready as usual) and
  // tell both sides.
  if ((body.status === 'RESOLVED' || body.status === 'DISMISSED') && incident.custodyId) {
    const custody = await db.vehicleCustody.findUnique({ where: { id: incident.custodyId } })
    if (custody && custody.status === 'DISPUTED') {
      await db.$transaction([
        db.vehicleCustody.update({ where: { id: custody.id }, data: { status: 'WORK_IN_PROGRESS' } }),
        db.custodyEvent.create({
          data: {
            custodyId: custody.id,
            type: 'STATUS_CHANGE',
            fromStatus: 'DISPUTED',
            toStatus: 'WORK_IN_PROGRESS',
            actorId: user.id,
            actorName: user.name,
            actorSide: 'STAFF',
            note: `Security incident ${incident.refCode} ${body.status.toLowerCase()}: custody returned to the normal workflow.`,
          },
        }),
      ])
      await notify({
        userId: custody.customerId,
        type: 'CUSTODY_UPDATE',
        title: `Custody review closed: ${custody.refCode}`,
        body: `The security review of your vehicle was ${body.status.toLowerCase()}. The job resumes its normal workflow.`,
        link: '/account?tab=protection',
      })
      await notifyOrgMembers(custody.orgId, {
        type: 'CUSTODY_UPDATE',
        link: '/garage-dashboard?tab=custody',
        title: `Custody review closed: ${custody.refCode}`,
        body: `Security incident ${incident.refCode} was ${body.status.toLowerCase()}: the custody job resumes its normal workflow.`,
      })
    }
  }

  return ok({ incident: { id: updated.id, refCode: updated.refCode, status: updated.status, resolvedAt: updated.resolvedAt ? iso(updated.resolvedAt) : null } })
})
